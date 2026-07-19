const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ s: res.statusCode, b: d, loc: res.headers.location }));
    }).on('error', reject);
  });
}
(async () => {
  const u = 'https://www.sobqg.com/search.html?searchkey=' + encodeURIComponent('射雕英雄传');
  const r = await get(u);
  console.log('status', r.s, 'len', r.b.length);
  const text = r.b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(text.slice(0, 500));
  const links = [...r.b.matchAll(/href="([^"]+)"/g)].map((x) => x[1]).filter((x) => /book|read|chapter|shediao|jinyong/i.test(x)).slice(0, 30);
  console.log('links', links);
})();
