const https = require('https');

function get(u) {
  return new Promise((res, rej) => {
    https
      .get(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' } }, (r) => {
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ');
}

(async () => {
  for (const id of ['RJ080542', 'RJ147727', 'VJ013441', 'RJ126642', 'VJ01001863']) {
    const floors = { RJ: 'maniax', VJ: 'pro', BJ: 'books' };
    const floor = floors[id.slice(0, 2)];
    const u = `https://www.dlsite.com/${floor}/work/=/product_id/${id}.html`;
    const h = await get(u);
    const t = strip(h);
    console.log('====', id);
    const i = t.indexOf('作品内容');
    console.log(t.slice(i > 0 ? i : 0, (i > 0 ? i : 0) + 3000));
    console.log();
  }
})();
