const fs = require('fs');
const path = require('path');
const dir = __dirname;

function dump(file) {
  const c = fs.readFileSync(path.join(dir, file), 'utf8');
  console.log('\n====', file, c.length);
  const title = (c.match(/<title[^>]*>([^<]+)/i) || [])[1];
  console.log('title', title);
  const desc = (c.match(/name="description"\s+content="([^"]+)"/i) || [])[1];
  console.log('metaDesc', desc && desc.slice(0, 500));
  for (const key of ['bookName', 'authorName', 'bookStatus', 'subCateName', 'wordsCnt', 'chapterTotal', 'lastChapterName']) {
    const ms = [...c.matchAll(new RegExp('"' + key + '"\\s*:\\s*"?([^",}]+)"?', 'g'))].map(x => x[1]);
    if (ms.length) console.log(key, ms.slice(0, 5));
  }
  const chNames = [...c.matchAll(/"cN"\s*:\s*"([^"]+)"/g)].map(x => x[1]);
  console.log('cN count', chNames.length);
  console.log('cN head', chNames.slice(0, 50));
  console.log('cN mid', chNames.slice(Math.floor(chNames.length/2), Math.floor(chNames.length/2)+20));
  console.log('cN end', chNames.slice(-40));
  const vols = [...new Set([...c.matchAll(/"vN"\s*:\s*"([^"]+)"/g)].map(x => x[1]))];
  console.log('vols', vols);
  // roles/tags
  for (const kw of ['林玄宇', '主角', '命运币', '天运', '天命', '玩家', '系统', '主要角色', '角色']) {
    let i = 0, n = 0;
    while ((i = c.indexOf(kw, i)) >= 0 && n < 3) {
      console.log('kw', kw, JSON.stringify(c.slice(i, i + 150).replace(/\s+/g, ' ')));
      i += kw.length; n++;
    }
  }
}

for (const f of fs.readdirSync(dir)) {
  if (f.startsWith('tm_') || f.startsWith('ty_')) dump(f);
}
