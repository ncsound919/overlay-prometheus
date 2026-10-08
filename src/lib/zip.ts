/**
 * Minimal ZIP archive writer — ZERO dependencies (node:zlib only).
 *
 * Format: PKZIP APPNOTE — local file headers (PK\x03\x04) + central directory
 * (PK\x01\x02) + end-of-central-directory record (PK\x05\x06). Entries are
 * DEFLATE-compressed (method 8) via zlib.deflateRawSync when that actually
 * shrinks the data, otherwise STORED (method 0). Pure + synchronous: same
 * inputs → byte-identical archive except for mtimes.
 *
 * Limits (fine for snapshot bundles): ≤ 65535 entries, no ZIP64, no
 * encryption, UTF-8 filenames, no data descriptors (sizes/CRC go in the
 * local header).
 */

import { deflateRawSync } from 'node:zlib';

// ─── CRC-32 (IEEE 802.3, reflected poly 0xEDB88320) — table-based ────────────

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── MS-DOS date/time (local time, 2-second resolution) ──────────────────────

function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear()); // DOS epoch starts at 1980
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date: date & 0xffff, time: time & 0xffff };
}

// ─── Writer ──────────────────────────────────────────────────────────────────

export interface ZipEntry {
  /** Entry path inside the archive (UTF-8, forward slashes). */
  name: string;
  data: Buffer | string;
  mtime?: Date;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — deflate support
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export function createZip(files: ZipEntry[]): Buffer {
  if (files.length > 0xffff) throw new Error('createZip: too many entries (ZIP64 unsupported)');

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0; // running offset of each local header

  for (const file of files) {
    if (file.name.length > 0xffff) throw new Error('createZip: filename too long');
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const { date, time } = dosDateTime(file.mtime ?? new Date());
    const crc = crc32(raw);

    // DEFLATE (method 8) when it helps; STORE (0) on failure or growth.
    let method = METHOD_STORE;
    let payload = raw;
    try {
      const deflated = deflateRawSync(raw);
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    } catch {
      // keep STORE fallback
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(0, 6); // flags: none (sizes/CRC known upfront)
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    parts.push(local, name, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(SIG_CENTRAL, 0);
    dir.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    dir.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    dir.writeUInt16LE(0, 8); // flags
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra length
    dir.writeUInt16LE(0, 32); // comment length
    dir.writeUInt16LE(0, 34); // disk number start
    dir.writeUInt16LE(0, 36); // internal attributes
    dir.writeUInt32LE(0o100644 * 0x10000, 38); // external attrs: rw-r--r-- (<<16 overflows int32)
    dir.writeUInt32LE(offset, 42); // relative offset of local header
    central.push(Buffer.concat([dir, name]));

    offset += local.length + name.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  if (centralBuf.length > 0xffffffff || offset > 0xffffffff) {
    throw new Error('createZip: archive too large (ZIP64 unsupported)');
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralBuf, eocd]);
}

/*
 * Self-test (throwaway bun script, not shipped):
 *   import { createZip } from './src/lib/zip';
 *   const zip = createZip([
 *     { name: 'a.txt', data: 'hello compressed world '.repeat(200), mtime: new Date(0) },
 *     { name: 'b.json', data: '{"ok":true}' },
 *   ]);
 *   await Bun.write('/tmp/z.selftest.zip', zip);
 *   // $ unzip -t /tmp/z.selftest.zip   → "No errors detected"
 *   // $ unzip -o /tmp/z.selftest.zip -d /tmp/zx && cat /tmp/zx/a.txt /tmp/zx/b.json
 *   //   → 200×"hello compressed world " followed by {"ok":true}
 */
