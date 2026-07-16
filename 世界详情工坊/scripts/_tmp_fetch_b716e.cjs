const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'text/html',
          Cookie: 'adultchecked=1',
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(new URL(res.headers.location, url).href).then(resolve, reject);
          return;
        }
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

(async () => {
  const urls = [
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E3%82%A8%E3%83%AD%E3%82%B3%E3%83%B3%E3%83%93%E3%83%8B',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E7%BE%8E%E6%A8%B9',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E7%B5%90%E8%A1%A3',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E6%9E%B6',
    'https://hanime.tv/search?q=convenience',
    'https://hanime.tv/search?q=yue+ni',
    'https://hanime.tv/search?q=netorare',
    'https://hanime.tv/search?q=sana',
  ];
  const out = path.join(__dirname, '_tmp_b716_pages3');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await get(urls[i]);
      const t = strip(r.body);
      const titles = [];
      for (const m of t.matchAll(/(?:動画|アドベンチャー)\s+([^\n]{6,100})/g)) {
        titles.push(m[1].trim());
        if (titles.length >= 30) break;
      }
      const han = [...r.body.matchAll(/href="(\/videos\/hentai\/[^"]+)"/g)].map((x) => x[1]);
      fs.writeFileSync(
        path.join(out, i + '.txt'),
        'URL ' +
          urls[i] +
          '\nSTATUS ' +
          r.status +
          '\nHAN ' +
          [...new Set(han)].slice(0, 20).join('\n') +
          '\nTITLES\n' +
          titles.join('\n') +
          '\n\n' +
          t.slice(0, 6000),
        'utf8'
      );
      console.log('OK', i, r.status, titles.slice(0, 6).join(' || '), 'han', [...new Set(han)].length);
    } catch (e) {
      console.log('ERR', i, e.message);
    }
  }
})();
