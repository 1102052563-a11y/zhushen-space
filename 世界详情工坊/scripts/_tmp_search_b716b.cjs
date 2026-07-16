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
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        timeout: 25000,
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

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const urls = [
    // known series / likely pages
    'https://myanimelist.net/anime.php?cat=anime&q=%E5%BA%97%E9%95%B7',
    'https://myanimelist.net/anime.php?cat=anime&q=%E6%95%85%E3%81%AB%E4%BA%BA%E5%A6%BB',
    'https://myanimelist.net/anime.php?cat=anime&q=%E7%A5%9E%E5%BE%85%E3%81%A1',
    'https://myanimelist.net/anime.php?cat=anime&q=VenusBlood',
    'https://myanimelist.net/anime.php?cat=anime&q=JK%E3%81%A8%E3%82%A8%E3%83%AD%E3%82%B3%E3%83%B3%E3%83%93%E3%83%8B',
    'https://hanime.tv/search?q=tenchou',
    'https://hanime.tv/search?q=hitozuma',
    'https://hanime.tv/search?q=sana-chan',
    'https://hanime.tv/search?q=venus+blood',
    'https://hanime.tv/search?q=arubaito',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%95%85%E3%81%AB%E4%BA%BA%E5%A6%BB',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%A5%9E%E5%BE%85%E3%81%A1%E3%82%B5%E3%83%8A',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%82%A2%E3%83%AB%E3%83%90%E3%82%A4%E3%83%88%E5%A8%98',
    'https://www.dlsite.com/pro/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/VenusBlood%20BRAVE',
  ];
  const out = path.join(__dirname, '_tmp_b716_search2');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await get(urls[i]);
      const mal = [...r.body.matchAll(/href="(\/anime\/\d+\/[^"#?]+)"/g)].map((m) => m[1]);
      const titles = [...r.body.matchAll(/anime\/\d+\/([^"/#?]+)/g)].map((m) => decodeURIComponent(m[1]));
      const han = [...r.body.matchAll(/href="(\/videos\/hentai\/[^"]+)"/g)].map((m) => m[1]);
      const dl = [...r.body.matchAll(/product_id\/([A-Z]{2}\d+)/g)].map((m) => m[1]);
      const workTitles = [...r.body.matchAll(/work_name[^>]*>([^<]+)/g)].map((m) => m[1]);
      fs.writeFileSync(
        path.join(out, i + '.txt'),
        [
          'URL ' + urls[i],
          'STATUS ' + r.status,
          'MAL ' + [...new Set(mal)].slice(0, 25).join('\n'),
          'TITLES ' + [...new Set(titles)].slice(0, 25).join('\n'),
          'HANIME ' + [...new Set(han)].slice(0, 25).join('\n'),
          'DLSITE ' + [...new Set(dl)].slice(0, 25).join('\n'),
          'WORKS ' + [...new Set(workTitles)].slice(0, 25).join('\n'),
          'TEXT ' + text(r.body).slice(0, 3500),
        ].join('\n\n'),
        'utf8'
      );
      console.log(
        'OK',
        i,
        r.status,
        'mal',
        [...new Set(mal)].length,
        'han',
        [...new Set(han)].length,
        'dl',
        [...new Set(dl)].length
      );
    } catch (e) {
      console.log('ERR', i, e.message);
    }
  }
})();
