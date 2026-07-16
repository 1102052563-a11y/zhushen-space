const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve({ code: res.statusCode, body: d, loc: res.headers.location }));
        }
      )
      .on('error', reject);
  });
}

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const urls = [
    'https://zh.moegirl.org.cn/%E6%A3%95%E8%89%B2%E5%B0%98%E5%9F%83',
    'https://browndust.app/',
    'https://news.qoo-app.com/post/26058',
    'https://apps.qoo-app.com/app/6042',
  ];
  for (const u of urls) {
    try {
      const r = await get(u);
      const t = strip(r.body);
      console.log('\n====', u, 'code', r.code, 'len', t.length);
      console.log(t.slice(0, 5000));
      fs.writeFileSync(
        'C:/Users/ADMINI~1/AppData/Local/Temp/opencode/bd_' + Buffer.from(u).toString('hex').slice(0, 16) + '.txt',
        t.slice(0, 20000),
        'utf8'
      );
    } catch (e) {
      console.log('ERR', u, e.message);
    }
  }
})();
