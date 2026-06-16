/* Cloudflare Pages Function：把 /joy-girls/* 从 R2 桶提供（R2-only 部署）。
   需在 Pages 项目把 R2 桶绑到变量名 R2_BUCKET（与 enhance-bosses 共用同一个桶）。*/
export async function onRequest(context) {
  const { params, env } = context;
  if (!env.R2_BUCKET) return new Response('R2 binding R2_BUCKET 未配置', { status: 500 });
  const sub = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  const obj = await env.R2_BUCKET.get('joy-girls/' + sub);
  if (!obj || !obj.body) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', sub.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
