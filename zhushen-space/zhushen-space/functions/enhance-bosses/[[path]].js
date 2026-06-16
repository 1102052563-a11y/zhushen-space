/* Cloudflare Pages Function：把 /enhance-bosses/* 从 R2 桶提供（R2-only 部署）。
   需在 Pages 项目 → Settings → Functions → R2 bindings 里，把 R2 桶绑到变量名 R2_BUCKET。
   前端原有的 fetch('/enhance-bosses/manifest.json') 和 /enhance-bosses/<图> 路径无需改动，会被本 Function 接管。*/
export async function onRequest(context) {
  const { params, env } = context;
  if (!env.R2_BUCKET) return new Response('R2 binding R2_BUCKET 未配置', { status: 500 });
  const sub = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  const obj = await env.R2_BUCKET.get('enhance-bosses/' + sub);
  if (!obj || !obj.body) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // manifest.json 短缓存（会变），图片长缓存不可变
  headers.set('cache-control', sub.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}
