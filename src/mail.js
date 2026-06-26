import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { Buffer } from "node:buffer";

/**
 * SMTP client minimal (pure node:net + node:tls), tanpa dependency.
 * Mendukung: EHLO, STARTTLS, AUTH LOGIN, pesan MIME multipart/alternative.
 * Dirancang untuk Hostinger SMTP (smtp.hostinger.com:587, STARTTLS).
 */

const DEFAULT_TIMEOUT = 30_000;
const CRLF = "\r\n";

/**
 * Mengirim email. Konfigurasi via options:
 *   { host, port, username, password, encryption, fromAddress, fromName,
 *     to, subject, html, text, timeout }
 */
export async function sendMail(options) {
  const cfg = {
    host: options.host,
    port: options.port || 587,
    username: options.username,
    password: options.password,
    encryption: (options.encryption || "tls").toLowerCase(),
    fromAddress: options.fromAddress,
    fromName: options.fromName || "",
    to: options.to,
    timeout: options.timeout || DEFAULT_TIMEOUT,
  };
  if (!cfg.host) throw new Error("MAIL_HOST belum dikonfigurasi");
  if (!cfg.fromAddress) throw new Error("MAIL_FROM_ADDRESS belum dikonfigurasi");
  if (!cfg.to) throw new Error("Penerima email (to) wajib diisi");

  const mime = buildMimeMessage({
    fromAddress: cfg.fromAddress,
    fromName: cfg.fromName,
    to: cfg.to,
    subject: options.subject || "(no subject)",
    text: options.text || "",
    html: options.html || "",
  });

  // Koneksi awal: port 465 + encryption ssl -> langsung TLS; lainnya plain lalu STARTTLS.
  const directTls = cfg.encryption === "ssl" || (cfg.port === 465 && cfg.encryption !== "tls");
  let socket = directTls
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : netConnect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(cfg.timeout);

  const smtp = new SmtpConversation(socket);
  try {
    await smtp.read(220, "Server tidak merespons koneksi SMTP");

    await smtp.command(`EHLO ${cfg.host}`, 250);

    // Upgrade ke TLS bila diminta (encryption tls / starttls).
    if (!directTls && (cfg.encryption === "tls" || cfg.encryption === "starttls")) {
      await smtp.command("STARTTLS", 220);
      socket = await upgradeToTls(socket, cfg.host, cfg.timeout);
      smtp.attach(socket);
      await smtp.command(`EHLO ${cfg.host}`, 250);
    }

    if (cfg.username) {
      await smtp.command("AUTH LOGIN", 334);
      await smtp.command(Buffer.from(cfg.username).toString("base64"), 334);
      await smtp.command(Buffer.from(cfg.password || "").toString("base64"), 235);
    }

    await smtp.command(`MAIL FROM:<${cfg.fromAddress}>`, 250);
    for (const recipient of splitRecipients(cfg.to)) {
      await smtp.command(`RCPT TO:<${recipient}>`, 250);
    }
    await smtp.command("DATA", 354);

    // Tulis body MIME, akhiri dengan <CRLF>.<CRLF>.
    socket.write(mime.split(/\r?\n/).map((line) => (line.startsWith(".") ? `.${line}` : line)).join(CRLF));
    socket.write(CRLF + "." + CRLF);
    await smtp.read(250, "Server menolak isi email");

    await smtp.command("QUIT", 221).catch(() => {});
  } catch (error) {
    throw new Error(`Pengiriman email gagal: ${error.message}`);
  } finally {
    socket.destroy();
  }
}

/**
 * Membangun pesan MIME multipart/alternative (text + html).
 * Pure function, mudah diuji tanpa koneksi jaringan.
 */
export function buildMimeMessage({ fromAddress, fromName, to, subject, text, html }) {
  const date = formatRfc5322Date(new Date());
  const messageId = `<${Date.now()}.${randomId()}@sibercraft>`;
  const boundary = `----=_sibercraft_${randomId()}`;

  const headers = [
    `Date: ${date}`,
    `From: ${formatAddress(fromAddress, fromName)}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const parts = [];
  if (text) {
    parts.push(
      `--${boundary}${CRLF}Content-Type: text/plain; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${chunkBase64(Buffer.from(text, "utf8").toString("base64"))}`,
    );
  }
  if (html) {
    parts.push(
      `--${boundary}${CRLF}Content-Type: text/html; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${chunkBase64(Buffer.from(html, "utf8").toString("base64"))}`,
    );
  }
  const body = parts.join(CRLF) + CRLF + `--${boundary}--` + CRLF;

  return headers.join(CRLF) + CRLF + CRLF + body;
}

/**
 * RFC 2047 Q-encoding untuk nilai header (mis. Subject). Mengembalikan
 * nilai yang sudah di-encode, TANPA prefix "Subject:".
 */
export function encodeHeaderValue(value) {
  const str = String(value || "");
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const encoded = Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/(.{1,76})/g, "=?UTF-8?B?$1?=")
    .trim();
  return encoded;
}

function formatAddress(address, name) {
  if (!name) return address;
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/"/g, '\\"')}" <${address}>`;
  const encoded = `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?=`;
  return `${encoded} <${address}>`;
}

function splitRecipients(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatRfc5322Date(date) {
  // Contoh: Mon, 01 Jan 2025 09:00:00 +0000
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const tz = `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  return `${days[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tz}`;
}

function chunkBase64(value) {
  return String(value || "").replace(/(.{1,76})/g, "$1" + CRLF).trim();
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Wrapper untuk membaca balasan SMTP berbaris. Stateful terhadap socket.
 */
class SmtpConversation {
  constructor(socket) {
    this.handlers = null;
    this.attach(socket);
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    this.buffer = "";
    const onData = (chunk) => {
      this.buffer += chunk.toString("utf8");
      this.tryResolve();
    };
    const onError = (error) => {
      this.waiter?.reject(error);
      this.waiter = null;
    };
    const onTimeout = () => {
      this.waiter?.reject(new Error("Timeout SMTP"));
      this.waiter = null;
      this.socket.destroy();
    };
    const onClose = () => {
      this.waiter?.reject(new Error("Koneksi SMTP tertutup"));
      this.waiter = null;
    };
    this.handlers = { data: onData, error: onError, timeout: onTimeout, close: onClose };
    this.socket.on("data", onData);
    this.socket.on("error", onError);
    this.socket.on("timeout", onTimeout);
    this.socket.on("close", onClose);
  }

  detach() {
    if (!this.socket || !this.handlers) return;
    for (const [event, handler] of Object.entries(this.handlers)) {
      this.socket.off(event, handler);
    }
    this.handlers = null;
  }

  /** Membaca balasan SMTP hingga baris final (kode spasi, bukan '-'). */
  read(expectedCode, errorMessage) {
    return new Promise((resolve, reject) => {
      this.waiter = {
        resolve: (line) => {
          const code = Number.parseInt(line.slice(0, 3), 10);
          if (expectedCode && (Number.isNaN(code) || code !== expectedCode)) {
            reject(new Error(`${errorMessage || "SMTP error"}: ${line.trim()}`));
          } else {
            resolve(line);
          }
        },
        reject,
      };
      this.tryResolve();
    });
  }

  command(text, expectedCode, errorMessage) {
    this.socket.write(text + CRLF);
    return this.read(expectedCode, errorMessage);
  }

  tryResolve() {
    if (!this.waiter) return;
    // Cari balasan final: baris berawalan "NNN " (spasi), bukan "NNN-" (lanjutan).
    // Gunakan indexOf berbasis byte agar pemotongan buffer akurat untuk \r\n.
    const match = /(?:^|\n)\d{3} [^\n]*\r?\n/.exec(this.buffer);
    if (!match) return;
    const block = this.buffer.slice(0, match.index + match[0].length);
    this.buffer = this.buffer.slice(match.index + match[0].length);
    const finalLine = block.split(/\r?\n/).find((line) => /^\d{3} /.test(line));
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve(finalLine || block.trim());
  }
}

function upgradeToTls(socket, host, timeout) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tlsConnect({
      socket,
      servername: host,
    });
    tlsSocket.setTimeout(timeout);
    tlsSocket.once("secureConnect", () => resolve(tlsSocket));
    tlsSocket.once("error", reject);
    tlsSocket.once("timeout", () => reject(new Error("Timeout STARTTLS")));
  });
}
