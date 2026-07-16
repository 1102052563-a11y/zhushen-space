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
          Accept: 'application/json,text/html,*/*',
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

(async () => {
  // Jikan API (MAL unofficial)
  const qs = [
    'JK to Ero Convenience',
    'Tencho Arubaito',
    'Yue ni Hitozuma',
    'Kami-machi Sana',
    'Venus Blood BRAVE',
    'Tiny Evil',
    'Hitozuma wa Netorareta',
    'Arubaito Musume',
  ];
  const out = path.join(__dirname, '_tmp_b716_jikan');
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < qs.length; i++) {
    const u =
      'https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(qs[i]) + '&limit=10';
    try {
      await new Promise((r) => setTimeout(r, 1100));
      const r = await get(u);
      fs.writeFileSync(path.join(out, i + '.json'), r.body, 'utf8');
      let data;
      try {
        data = JSON.parse(r.body);
      } catch {
        console.log('BADJSON', i, r.status);
        continue;
      }
      const rows = (data.data || []).map(
        (a) => a.mal_id + ' | ' + a.title + ' | ' + (a.title_japanese || '') + ' | eps=' + a.episodes
      );
      console.log('===', qs[i], '===');
      console.log(rows.join('\n') || '(none)');
    } catch (e) {
      console.log('ERR', qs[i], e.message);
    }
  }
})();
