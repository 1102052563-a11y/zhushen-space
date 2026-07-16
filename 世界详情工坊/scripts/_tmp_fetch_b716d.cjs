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
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

(async () => {
  const urls = [
    'https://www.dlsite.com/pro/work/=/product_id/VJ013234.html',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/JK%E3%81%A8%E3%82%A8%E3%83%AD%E3%82%B3%E3%83%B3%E3%83%93%E3%83%8B%E5%BA%97%E9%95%B7',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%BE%8E%E6%A8%B9',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E3%82%A2%E3%83%AB%E3%83%90%E3%82%A4%E3%83%88%E5%A8%98',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E7%A5%9E%E5%BE%85%E3%81%A1',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/VenusBlood',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/%E3%83%B4%E3%82%A3%E3%83%BC%E3%83%8A%E3%82%B9',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/work_category%5B0%5D/movie/keyword/Tiny%20Evil',
  ];
  const out = path.join(__dirname, '_tmp_b716_pages2');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await get(urls[i]);
      const t = strip(r.body);
      // extract work titles roughly
      const titles = [];
      const re = /(?:動画|アドベンチャー|マンガ)\s+([^\n]{4,80})/g;
      let m;
      while ((m = re.exec(t)) && titles.length < 40) titles.push(m[1].trim());
      fs.writeFileSync(
        path.join(out, i + '.txt'),
        'URL ' +
          urls[i] +
          '\nSTATUS ' +
          r.status +
          '\nTITLES\n' +
          titles.join('\n') +
          '\n\n' +
          t.slice(0, 9000),
        'utf8'
      );
      console.log('OK', i, r.status, 'titles', titles.slice(0, 8).join(' | '));
    } catch (e) {
      console.log('ERR', i, e.message);
    }
  }
})();
