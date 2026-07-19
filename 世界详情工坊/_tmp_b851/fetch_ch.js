const fs = require('fs');
const path = require('path');
const https = require('https');
const dir = __dirname;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 30000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractChapterIds(catalogHtml) {
  const items = [];
  const re = /href="\/\/m\.qidian\.com\/chapter\/(\d+)\/(\d+)\/?"[^>]*alt="([^"]+)"/g;
  let m;
  while ((m = re.exec(catalogHtml))) {
    items.push({ bid: m[1], cid: m[2], title: m[3] });
  }
  // fallback data-cid
  if (!items.length) {
    const re2 = /data-bid="(\d+)"\s+data-cid="(\d+)"[\s\S]{0,200}?<h2>([^<]+)/g;
    while ((m = re2.exec(catalogHtml))) {
      items.push({ bid: m[1], cid: m[2], title: m[3] });
    }
  }
  return items;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const catalogs = [
    { key: 'sg', file: 'sg_m_qidian_com_book_1009795401_catalog.html', pick: [0,1,2,3,4,5,6,7,10,20,50,100,200,500,1000,1500,2000,2500,3000,3100] },
    { key: 'tm', file: 'tm_m_qidian_com_book_1049582478_catalog.html', pick: 'all' },
    { key: 'ty', file: 'ty_m_qidian_com_book_1049375385_catalog.html', pick: 'all' }
  ];
  for (const cat of catalogs) {
    const html = fs.readFileSync(path.join(dir, cat.file), 'utf8');
    const items = extractChapterIds(html);
    console.log(cat.key, 'chapters found', items.length);
    fs.writeFileSync(path.join(dir, cat.key + '_chlist.json'), JSON.stringify(items.slice(0, 50).concat(items.slice(-10)), null, 2));
    const picks = cat.pick === 'all' ? items : cat.pick.map(i => items[i]).filter(Boolean);
    // also always take first 15 story chapters
    const first = items.slice(0, Math.min(15, items.length));
    const set = new Map();
    for (const it of [...first, ...picks]) if (it) set.set(it.cid, it);
    let n = 0;
    for (const it of set.values()) {
      if (n >= 25) break;
      const url = `https://m.qidian.com/chapter/${it.bid}/${it.cid}/`;
      try {
        const r = await get(url);
        const text = stripHtml(r.data);
        // try content markers
        const bodyMatch = r.data.match(/class="[^"]*read[^"]*"[^>]*>([\s\S]{200,})/i);
        let body = text;
        if (bodyMatch) body = stripHtml(bodyMatch[1]).slice(0, 8000);
        // content from JSON
        const contentJson = r.data.match(/"content"\s*:\s*"((?:\\.|[^"\\]){100,})"/);
        if (contentJson) {
          body = contentJson[1]
            .replace(/\\n/g, '\n')
            .replace(/\\u003c/g, '<')
            .replace(/\\u003e/g, '>')
            .replace(/\\"/g, '"')
            .replace(/<\/?p>/g, '\n')
            .replace(/<[^>]+>/g, '');
        }
        const out = path.join(dir, `${cat.key}_ch_${it.cid}.txt`);
        fs.writeFileSync(out, `TITLE: ${it.title}\nURL: ${url}\nSTATUS: ${r.status}\nLEN: ${body.length}\n\n${body.slice(0, 12000)}`);
        console.log('OK', cat.key, it.title, body.length);
        n++;
      } catch (e) {
        console.log('FAIL', it.title, e.message);
      }
    }
  }
}
main().catch(e => console.error(e));
