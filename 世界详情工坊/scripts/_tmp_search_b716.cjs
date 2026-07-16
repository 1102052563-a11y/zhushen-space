const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: 20000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location).then(resolve, reject);
          return;
        }
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d, url }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout ' + url));
    });
  });
}

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const queries = [
    'https://myanimelist.net/anime.php?q=Tencho+Arubaito+Musume&cat=anime',
    'https://myanimelist.net/anime.php?q=Yue+ni+Hitozuma&cat=anime',
    'https://myanimelist.net/anime.php?q=Kami-machi+Sana&cat=anime',
    'https://myanimelist.net/anime.php?q=Venus+Blood+BRAVE&cat=anime',
    'https://myanimelist.net/anime.php?q=Tiny+Evil&cat=anime',
    'https://hanime.tv/search?q=tencho',
    'https://hanime.tv/search?q=yueni+hitozuma',
    'https://hanime.tv/search?q=kami-machi',
    'https://hanime.tv/search?q=venus+blood+brave',
  ];
  const outDir = path.join(__dirname, '_tmp_b716_search');
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < queries.length; i++) {
    const u = queries[i];
    try {
      const r = await get(u);
      const text = strip(r.body).slice(0, 4000);
      const links = [...r.body.matchAll(/href="(\/anime\/\d+\/[^"]+)"/g)].map((m) => m[1]);
      const uniq = [...new Set(links)].slice(0, 20);
      const hlinks = [...r.body.matchAll(/href="(\/videos\/hentai\/[^"]+)"/g)].map((m) => m[1]);
      const hunq = [...new Set(hlinks)].slice(0, 20);
      fs.writeFileSync(
        path.join(outDir, i + '.txt'),
        'URL ' +
          u +
          '\nSTATUS ' +
          r.status +
          '\nMAL ' +
          uniq.join('\n') +
          '\nHANIME ' +
          hunq.join('\n') +
          '\nTEXT\n' +
          text,
        'utf8'
      );
      console.log('OK', i, r.status, uniq.slice(0, 5).join('|'), hunq.slice(0, 3).join('|'));
    } catch (e) {
      console.log('ERR', i, e.message);
      fs.writeFileSync(path.join(outDir, i + '.err.txt'), String(e), 'utf8');
    }
  }
  console.log('done');
})();
