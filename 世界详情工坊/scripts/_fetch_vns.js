const https = require('https');
const fs = require('fs');
function get(url) {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 worldbook-bot' } }, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(d));
      })
      .on('error', rej);
  });
}
function strip(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
(async () => {
  const ids = ['v1603', 'v346', 'v63878', 'v9588', 'v1604'];
  for (const id of ids) {
    const h = await get('https://vndb.org/' + id);
    const t = (h.match(/<title>([^<]+)/) || [])[1];
    const plain = strip(h).slice(0, 2500);
    fs.writeFileSync('_vn_' + id + '.txt', t + '\n' + plain);
    console.log('saved', id, t);
  }
})();
