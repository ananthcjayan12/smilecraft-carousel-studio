// Small dependency-free ZIP writer (STORE, ZIP32). Images are already compressed; fine for carousel exports.
const enc = new TextEncoder();
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1); table[i] = c >>> 0; }
function crc32(arr) { let c = 0xffffffff; for (const b of arr) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u16 = (v, a, o) => new DataView(a.buffer).setUint16(o, v, true);
const u32 = (v, a, o) => new DataView(a.buffer).setUint32(o, v, true);
export async function makeZip(files) {
  if (files.length > 65535) throw new Error('Too many files');
  const local = [], central = []; let offset = 0, centralSize = 0;
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name); const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
    if (bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('ZIP32 size limit exceeded');
    const crc = crc32(bytes); const head = new Uint8Array(30 + nameBytes.length); u32(0x04034b50, head, 0); u16(20, head, 4); u16(0x800, head, 6); u32(crc, head, 14); u32(bytes.length, head, 18); u32(bytes.length, head, 22); u16(nameBytes.length, head, 26); head.set(nameBytes, 30);
    local.push(head, bytes);
    const cd = new Uint8Array(46 + nameBytes.length); u32(0x02014b50, cd, 0); u16(20, cd, 4); u16(20, cd, 6); u16(0x800, cd, 8); u32(crc, cd, 16); u32(bytes.length, cd, 20); u32(bytes.length, cd, 24); u16(nameBytes.length, cd, 28); u32(offset, cd, 42); cd.set(nameBytes, 46); central.push(cd); centralSize += cd.length; offset += head.length + bytes.length;
  }
  const end = new Uint8Array(22); u32(0x06054b50, end, 0); u16(files.length, end, 8); u16(files.length, end, 10); u32(centralSize, end, 12); u32(offset, end, 16);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export function downloadBlob(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 15000); }
export function dataURLBlob(data) { const [prefix, content] = data.split(','); const mime = prefix.match(/data:([^;]+)/)?.[1] || 'application/octet-stream'; const bin = atob(content); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return new Blob([out], { type: mime }); }
