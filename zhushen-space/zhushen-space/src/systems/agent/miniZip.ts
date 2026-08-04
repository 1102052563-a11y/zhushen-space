/* 极简 zip 文本解包器（零依赖）：解 TauriTavern skill 包（ttskill-archive-base64-v1 = base64(zip)）。
   只支持 method 0（store）与 8（deflate·经浏览器/Node≥18 原生 DecompressionStream('deflate-raw')），
   只取 UTF-8 文本文件（SKILL.md / references/*.md 等），目录与超大/二进制文件跳过。
   解析走中央目录（EOCD→CEN→LOC），坏包抛错由调用方兜。 */

export interface ZipTextFile { path: string; content: string }

const MAX_FILE_BYTES = 300 * 1024;   // 单文件上限（skill 都是小文本）

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** base64 zip → 文本文件列表。非文本/超大/解不开的文件静默跳过；整包结构坏才抛。 */
export async function unzipTextFiles(base64: string): Promise<ZipTextFile[]> {
  const bytes = b64ToBytes(base64);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 找 EOCD（0x06054b50）：从尾部回扫（注释区最长 64KB）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  const cenCount = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);   // 中央目录偏移
  const out: ZipTextFile[] = [];
  const utf8 = new TextDecoder('utf-8');
  for (let n = 0; n < cenCount; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error('zip: bad central header');
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const cmtLen = dv.getUint16(ptr + 32, true);
    const locOff = dv.getUint32(ptr + 42, true);
    const name = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + cmtLen;
    if (name.endsWith('/')) continue;                        // 目录
    if (compSize > MAX_FILE_BYTES) continue;                 // 超大跳过
    // 本地头：跳过其 name/extra（长度可能与中央目录不同，必须现读）
    if (dv.getUint32(locOff, true) !== 0x04034b50) continue;
    const locName = dv.getUint16(locOff + 26, true);
    const locExtra = dv.getUint16(locOff + 28, true);
    const start = locOff + 30 + locName + locExtra;
    const comp = bytes.subarray(start, start + compSize);
    try {
      const raw = method === 0 ? comp : method === 8 ? await inflateRaw(comp) : null;
      if (!raw) continue;                                    // 不支持的压缩法
      if (raw.length > MAX_FILE_BYTES) continue;
      const text = utf8.decode(raw);
      if (text.includes('\u0000')) continue;                 // 二进制（含 NUL）跳过
      out.push({ path: name.replace(/^\.?\//, ''), content: text });
    } catch { /* 单文件解不开跳过 */ }
  }
  return out;
}
