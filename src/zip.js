// Minimal zero-dependency ZIP writer (STORE method, no compression).
// Produces a valid ZIP archive readable by all OSes / unzip tools.
// Reference: PKWARE APPNOTE 6.3.x (https://support.pkware.com/pkzip/appnote).
//
// Layout produced:
//   [local file header 1][file data 1]
//   [local file header 2][file data 2]
//   ...
//   [central directory header 1]
//   [central directory header 2]
//   ...
//   [end of central directory record]

// Precomputed CRC32 table (IEEE 802.3 polynomial).
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/** Compute CRC32 of a Buffer/Uint8Array. */
export function crc32(buf) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Sanitize a ZIP entry path: forward slashes only, no leading slash, no .. segments. */
function safeEntryPath(path) {
  const clean = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = clean.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
}

// DOS time/date conversion for the fixed timestamp field.
const DOS_DATE = 0x0021; // 1980-01-01 (minimum valid DOS date)
const DOS_TIME = 0x0000;

/**
 * Build a ZIP archive buffer from entries.
 * @param {Array<{path: string, data: Buffer|string}>} entries
 * @returns {Buffer}
 */
export function zipFile(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = safeEntryPath(entry.path);
    if (!name) continue;
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const size = data.length;

    // --- Local file header (30 bytes + name) ---
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method: 0 = store
    localHeader.writeUInt16LE(DOS_TIME, 10); // mod time
    localHeader.writeUInt16LE(DOS_DATE, 12); // mod date
    localHeader.writeUInt32LE(crc, 14); // crc-32
    localHeader.writeUInt32LE(size, 18); // compressed size (== uncompressed for store)
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    chunks.push(localHeader, nameBuf, data);

    // --- Central directory header (46 bytes + name) ---
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed to extract
    cdh.writeUInt16LE(0, 8); // flags
    cdh.writeUInt16LE(0, 10); // method: store
    cdh.writeUInt16LE(DOS_TIME, 12); // mod time
    cdh.writeUInt16LE(DOS_DATE, 14); // mod date
    cdh.writeUInt32LE(crc, 16); // crc-32
    cdh.writeUInt32LE(size, 20); // compressed size
    cdh.writeUInt32LE(size, 24); // uncompressed size
    cdh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdh.writeUInt16LE(0, 30); // extra field length
    cdh.writeUInt16LE(0, 32); // comment length
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42); // offset of local header
    central.push(cdh, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const centralStart = offset;

  // --- End of central directory record (22 bytes) ---
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where central dir starts
  eocd.writeUInt16LE(central.length ? entries.length : 0, 8); // entries on this disk (approx)
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(centralStart, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
}
