import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function captureFullPage({ url, width = 1440, timeout = 60_000 }) {
  const executable = await findChromeExecutable();
  if (!executable) throw new Error("Browser Chrome/Chromium tidak ditemukan pada server");
  const profile = await mkdtemp(join(tmpdir(), "sibercraft-capture-"));
  const browser = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let stderr = "";
  browser.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  const cdp = new CdpPipe(browser.stdio[3], browser.stdio[4]);
  const timer = setTimeout(() => browser.kill("SIGKILL"), timeout);

  try {
    const { targetId } = await cdp.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
    const viewportWidth = clamp(Number(width) || 1440, 320, 2560);
    await cdp.call("Page.enable", {}, sessionId);
    await cdp.call("Runtime.enable", {}, sessionId);
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth, height: 900, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 30_000);
    await cdp.call("Page.navigate", { url }, sessionId);
    await loaded;
    await cdp.call("Runtime.evaluate", {
      expression: `(async()=>{if(document.fonts)await document.fonts.ready;await Promise.all([...document.images].map(img=>img.complete?null:new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true})})));await new Promise(r=>setTimeout(r,350));return true})()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    const metrics = await cdp.call("Page.getLayoutMetrics", {}, sessionId);
    const content = metrics.cssContentSize || metrics.contentSize;
    const screenshotWidth = clamp(Math.ceil(content.width), 1, 4096);
    const screenshotHeight = clamp(Math.ceil(content.height), 1, 30_000);
    const result = await cdp.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: screenshotWidth, height: screenshotHeight, scale: 1 },
    }, sessionId);
    await cdp.call("Target.closeTarget", { targetId }).catch(() => {});
    return Buffer.from(result.data, "base64");
  } catch (error) {
    if (stderr && !error.message.includes("Chrome")) error.message = `${error.message} — ${stderr.split("\n").at(-2) || "Chrome gagal"}`;
    throw error;
  } finally {
    clearTimeout(timer);
    cdp.close();
    browser.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  }
}

export async function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Coba lokasi browser berikutnya.
    }
  }
  return null;
}

class CdpPipe {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.waiters = [];
    output.on("data", (chunk) => this.consume(chunk));
    output.on("error", (error) => this.fail(error));
    output.on("close", () => this.fail(new Error("Koneksi ke browser ditutup")));
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(`${JSON.stringify(payload)}\0`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  waitFor(method, sessionId, timeout) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`Timeout menunggu ${method}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let separator;
    while ((separator = this.buffer.indexOf(0)) >= 0) {
      const raw = this.buffer.subarray(0, separator).toString("utf8");
      this.buffer = this.buffer.subarray(separator + 1);
      if (!raw) continue;
      let message;
      try { message = JSON.parse(raw); } catch { continue; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "Perintah browser gagal"));
        else pending.resolve(message.result || {});
        continue;
      }
      if (!message.method) continue;
      const waiter = this.waiters.find((item) => item.method === message.method && (!item.sessionId || item.sessionId === message.sessionId));
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      waiter.resolve(message.params || {});
    }
  }

  fail(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.waiters = [];
  }

  close() {
    this.input?.destroy();
    this.output?.destroy();
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
