const https = require('https');
const urls = [
  'https://www.sobqg.com/book/shediaoyingxiongzhuan.html',
  'https://www.sobqg.com/searchBook.html?keyword=%E5%B0%84%E9%9B%95%E8%8B%B1%E9%9B%84%E4%BC%A0',
  'https://www.sobqg.com/searchBook.html?keyword=%E9%87%91%E5%BA%B8',
];
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d, url }));
    }).on('error', reject);
  });
}
(async () => {
  for (const u of urls) {
    try {
      const r = await get(u);
      const text = r.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log('===', r.status, u, 'len', r.body.length);
      console.log(text.slice(0, 800));
      const links = [...r.body.matchAll(/href="(\/book\/[^"]+)"/g)].map((x) => x[1]);
      console.log('booklinks', [...new Set(links)].slice(0, 20));
    } catch (e) {
      console.log('ERR', u, e.message);
    }
  }
})();
