import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { resolveWithin } from "./path-sandbox.js";

const MAX_SCREENSHOT_BYTES = 4_000_000;

export async function captureWebpageScreenshot({
  workspaceDir,
  url,
  endpoint,
  signal,
  fetchImpl = fetch,
}) {
  if (!endpoint) throw new Error("WEB_SCREENSHOT_API_URL belum dikonfigurasi");
  const targetUrl = await validatePublicWebUrl(url);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: targetUrl,
      json: false,
      compress: true,
      quality: 75,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`Screenshot API ${response.status}: ${detail || response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Screenshot API mengembalikan file kosong");
  if (buffer.length > MAX_SCREENSHOT_BYTES) throw new Error("Hasil screenshot melebihi batas 4 MB");
  const imageFormat = detectImageFormat(buffer);
  if (!imageFormat) throw new Error("Screenshot API tidak mengembalikan file PNG atau WebP yang valid");

  const hostname = new URL(targetUrl).hostname
    .replace(/^www\./i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "webpage";
  const path = `screenshots/${hostname}-${randomUUID().slice(0, 8)}${imageFormat.extension}`;
  const fullPath = await resolveWithin(workspaceDir, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return {
    path,
    name: `${hostname}${imageFormat.extension}`,
    type: imageFormat.mimeType,
    size: buffer.length,
    dataUrl: `data:${imageFormat.mimeType};base64,${buffer.toString("base64")}`,
    sourceUrl: targetUrl,
  };
}

export async function validatePublicWebUrl(value, lookupImpl = lookup) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("URL website tidak valid");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("URL website harus menggunakan http atau https");
  }
  if (url.username || url.password) throw new Error("URL website tidak boleh berisi credential");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("URL lokal/private tidak diizinkan");
  }

  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (isPrivateIp(hostname)) throw new Error("URL lokal/private tidak diizinkan");
  } else {
    let addresses;
    try {
      addresses = await lookupImpl(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("Hostname website tidak dapat di-resolve");
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error("URL lokal/private tidak diizinkan");
    }
  }
  return url.toString();
}

function detectImageFormat(buffer) {
  const png = buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
  if (png) return { extension: ".png", mimeType: "image/png" };

  const webp = buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
  if (webp) return { extension: ".webp", mimeType: "image/webp" };

  return null;
}

function isPrivateIp(address) {
  const normalized = String(address).toLowerCase().split("%", 1)[0];
  if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (isIP(normalized) === 6) {
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff");
  }
  return true;
}
