/* Cloudflare Pages Function：把 /joy-girls/* 从 R2 桶提供（R2-only 部署，与 enhance-bosses 共用桶 R2_BUCKET）。
   直接用「解码后的 URL 路径」当 R2 key，正确处理中文路径。*/
export async function onRequest(context) {
  const { env, request } = context;
  if (!env.R2_BUCKET) return new Response('R2 binding R2_BUCKET 未配置', { status: 500 });
  let key;
  try { key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, ''); }
  catch { key = new URL(request.url).pathname.replace(/^\/+/, ''); }
  const obj = await env.R2_BUCKET.get(key);
  if (!obj || !obj.body) return new Response('Not found: ' + key, { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', key.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
