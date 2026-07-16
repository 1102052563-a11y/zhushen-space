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
          Accept: 'text/html,application/xhtml+xml',
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
        res.on('end', () => resolve({ status: res.statusCode, body: d, url }));
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
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

(async () => {
  const urls = [
    'https://www.dlsite.com/pro/work/=/product_id/VJ013234.html', // 故に人妻 第一巻 Queen Bee
    'https://www.dlsite.com/pro/work/=/product_id/VJ013427.html', // 第二巻
    'https://www.dlsite.com/books/work/=/product_id/BJ178893.html', // 漫画 あらくれ
    'https://www.dlsite.com/pro/work/=/product_id/VJ006326.html', // JKとエロコンビニ店長 ADV
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%A5%9E%E5%BE%85%E3%81%A1',
    'https://www.dlsite.com/books/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%A5%9E%E5%BE%85%E3%81%A1%E3%82%B5%E3%83%8A',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%8A%E3%83%9E%E3%82%A4%E3%82%AD%E8%A2%AB%E5%AE%B3',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%BE%8E%E6%A8%B9%20%E3%82%A2%E3%83%AB%E3%83%90%E3%82%A4%E3%83%88',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/Queen%20Bee%20%E6%95%85%E3%81%AB',
    'https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%A5%9E%E5%BE%85%E3%81%A1%E3%82%B5%E3%83%8A%E3%81%A1%E3%82%83%E3%82%93',
    'https://ninetail.tk/',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%B4%E3%82%A3%E3%83%BC%E3%83%8A%E3%82%B9%E3%83%96%E3%83%A9%E3%83%83%E3%83%89%20%E3%83%96%E3%83%AC%E3%82%A4%E3%83%B4',
  ];
  const out = path.join(__dirname, '_tmp_b716_pages');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await get(urls[i]);
      const t = strip(r.body);
      const ids = [...r.body.matchAll(/product_id\/([A-Z]{2}\d+)/g)].map((m) => m[1]);
      fs.writeFileSync(
        path.join(out, i + '.txt'),
        'URL ' +
          urls[i] +
          '\nSTATUS ' +
          r.status +
          '\nIDS ' +
          [...new Set(ids)].slice(0, 30).join(',') +
          '\n\n' +
          t.slice(0, 8000),
        'utf8'
      );
      console.log('OK', i, r.status, t.slice(0, 120).replace(/\n/g, ' '));
    } catch (e) {
      console.log('ERR', i, e.message);
    }
  }
})();
