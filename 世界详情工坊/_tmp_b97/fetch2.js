const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ s: res.statusCode, b: d }));
    }).on('error', reject);
  });
}
(async () => {
  const urls = [
    'https://www.sobqg.com/book/1_1/',
    'https://www.sobqg.com/book/shediao/',
    'https://www.sobqg.com/info/1.html',
    'https://www.sobqg.com/xs/1/',
    'https://www.sobqg.com/modules/article/search.php?searchkey=' + encodeURIComponent('射雕'),
  ];
  for (const u of urls) {
    try {
      const r = await get(u);
      console.log(r.s, u, r.b.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,200));
    } catch (e) { console.log('E', u, e.message); }
  }
})();
