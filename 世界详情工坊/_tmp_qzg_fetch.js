const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

function titleOf(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].replace(/&[^;]+;/g, ' ') : 'no-title';
}

function textOf(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '\n');
  return t
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

(async () => {
  const base = 19709663;
  const tests = [
    base - 1727,
    base - 1726,
    base - 1700,
    base - 1500,
    base - 1200,
    base - 1000,
    base - 800,
    base - 500,
    base - 200,
    base - 50,
    base - 1,
    base,
  ];
  const out = [];
  for (const id of tests) {
    try {
      const h = await get('https://www.sobqg.com/read/quanzhigaoshou/' + id + '.html');
      out.push(id + '\t' + titleOf(h));
    } catch (e) {
      out.push(id + '\terr');
    }
  }
  // also fetch end chapter summary
  const end = await get('https://www.sobqg.com/read/quanzhigaoshou/' + base + '.html');
  const lines = textOf(end);
  fs.writeFileSync('_tmp_qzg_titles.txt', out.join('\n'), 'utf8');
  fs.writeFileSync('_tmp_qzg_end.txt', lines.join('\n'), 'utf8');
  console.log(out.join('\n'));
  console.log('---END SNIP---');
  console.log(lines.slice(0, 60).join('\n'));
  console.log('...');
  console.log(lines.slice(-30).join('\n'));
})();
