const fs = require('fs');
const https = require('https');
const queries = [
  ['ero', 'エロゲー!'],
  ['ingoku', '淫獄学園'],
  ['saimin', '催眠術'],
  ['nurse', 'ナースのお勤め'],
  ['yasuri', '鑢の恋'],
  ['enbo', '艶母'],
  ['inma', '淫魔の見えない手'],
  ['hime', '姫奴隷'],
  ['namaiki', 'ナマイキ姫'],
  ['kankin', '少女的監禁日記'],
];
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}
(async () => {
  for (const [k, q] of queries) {
    const url = 'https://vndb.org/v?sq=' + encodeURIComponent(q);
    try {
      const h = await get(url);
      const links = [...h.matchAll(/href="\/(v\d+)"[^>]*>([^<]{2,100})/g)].slice(0, 6).map((m) => m[1] + '|' + m[2].trim());
      console.log('==', q, '==');
      console.log(links.join('\n') || '(none)');
    } catch (e) {
      console.log('==', q, 'ERR', e.message);
    }
  }
})();
