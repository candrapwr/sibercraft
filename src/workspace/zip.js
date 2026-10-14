// Minimal zero-dependency ZIP reader/writer.
// Supports STORE and DEFLATE entries, which is enough for application backup
// archives without adding an npm dependency.
import { inflateRawSync, deflateRawSync } from "node:zlib";

// Precomputed CRC32 table (IEEE 802.3 polynomial).
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/** Compute CRC32 of a Buffer/Uint8Array. */
export function crc32(buf) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeEntryPath(path) {
  const clean = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = clean.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
}

function isSafeArchivePath(path) {
  const value = String(path || "");
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every((part) => part && part !== "." && part !== "..");
}

const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/**
 * Build a ZIP archive. `compress: true` uses DEFLATE when it makes the entry
 * smaller; the default remains STORE for backwards compatibility.
 */
export function zipFile(entries, { compress = false } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  let count = 0;

  for (const entry of entries) {
    const name = safeEntryPath(entry.path);
    if (!name) continue;
    const original = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const compressed = compress ? deflateRawSync(original, { level: 6 }) : original;
    const useDeflate = compress && compressed.length < original.length;
    const data = useDeflate ? compressed : original;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(original);
    assertZipUInt32(data.length, "compressed size");
    assertZipUInt32(original.length, "uncompressed size");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(useDeflate ? 8 : 0, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(original.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(original.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
    count++;
  }

  const centralBuf = Buffer.concat(central);
  const centralStart = offset;
  if (count > 0xffff || centralBuf.length > 0xffffffff || centralStart > 0xffffffff) {
    throw new Error("ZIP terlalu besar untuk format ZIP32");
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Read a ZIP archive produced by zipFile. Returns {path,data} entries. */
export function unzipFile(buffer, { maxEntries = 100_000, maxTotalBytes = 1_000_000_000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("Arsip ZIP tidak valid");
  const eocd = findEndRecord(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > maxEntries || centralOffset + centralSize > buffer.length) throw new Error("Metadata ZIP tidak valid");

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Central directory ZIP tidak valid");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (!isSafeArchivePath(name) || seen.has(name) || flags & 1) throw new Error("Entry ZIP tidak aman atau terenkripsi");
    seen.add(name);
    if (name.endsWith("/")) throw new Error("Direktori ZIP eksplisit tidak didukung");
    if (uncompressedSize > maxTotalBytes || total + uncompressedSize > maxTotalBytes) throw new Error("Ukuran hasil ekstraksi ZIP terlalu besar");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Local header ZIP tidak valid");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("Data ZIP terpotong");
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Metode kompresi ZIP tidak didukung: ${method}`);
    if (data.length !== uncompressedSize || crc32(data) !== crc) throw new Error(`Checksum ZIP tidak cocok: ${name}`);
    entries.push({ path: name, data });
    total += data.length;
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndRecord(buffer) {
  const start = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) return offset;
    }
  }
  throw new Error("End of central directory ZIP tidak ditemukan");
}

function assertZipUInt32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${label} melebihi batas ZIP32`);
}
