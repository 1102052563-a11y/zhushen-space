/* Cloudflare Pages Function：把 /audio/bgm/* 从 R2 桶提供（背景音乐 R2-only 部署，同源无需 CORS）。
   需在 Pages 项目 → Settings → Bindings 把 R2 桶绑到变量名 R2_BUCKET（与 enhance-bosses/joy-girls 同一个桶）。
   - 用「解码后的 URL 路径」当 R2 key（正确处理中文文件名）。
   - 支持 Range 请求 → 206，供 <audio> 流式播放/拖动进度。
   - manifest.json 短缓存；音频文件长缓存 immutable。前端 /audio/bgm/manifest.json + /audio/bgm/<file> 同源取用。*/
export async function onRequest(context) {
  const { env, request } = context;
  if (!env.R2_BUCKET) return new Response('R2 binding R2_BUCKET 未配置', { status: 500 });

  let key;
  try { key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, ''); }
  catch { key = new URL(request.url).pathname.replace(/^\/+/, ''); }

  // 解析 Range: bytes=start-end / bytes=start- / bytes=-suffix
  let range;
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (m) {
      const s = m[1] ? parseInt(m[1], 10) : NaN;
      const e = m[2] ? parseInt(m[2], 10) : NaN;
      if (!isNaN(s) && !isNaN(e)) range = { offset: s, length: e - s + 1 };
      else if (!isNaN(s)) range = { offset: s };
      else if (!isNaN(e)) range = { suffix: e };
    }
  }

  const obj = await env.R2_BUCKET.get(key, range ? { range } : undefined);
  if (!obj || !obj.body) return new Response('Not found: ' + key, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', key.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable');

  if (range && obj.range) {                       // 命中 Range → 206 Partial Content
    const start = obj.range.offset || 0;
    const len = obj.range.length != null ? obj.range.length : obj.size - start;
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}
