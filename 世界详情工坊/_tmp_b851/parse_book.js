const fs = require('fs');
const path = require('path');
const dir = __dirname;

function parseBook(file) {
  const c = fs.readFileSync(path.join(dir, file), 'utf8');
  console.log('\n====', file, c.length);
  const title = (c.match(/<title[^>]*>([^<]+)/i) || [])[1];
  console.log('title', title);
  // meta description
  const desc = (c.match(/name="description"\s+content="([^"]+)"/i) || [])[1];
  console.log('metaDesc', desc && desc.slice(0, 400));
  // JSON fields
  for (const key of ['bookName', 'bName', 'author', 'authorName', 'bookStatus', 'wordsCnt', 'categoryName', 'subCateName', 'intro', 'desc', 'lastChapterName', 'chapterName']) {
    const ms = [...c.matchAll(new RegExp('"' + key + '"\\s*:\\s*"([^"]{1,500})"', 'g'))].map(x => x[1]);
    if (ms.length) console.log(key, ms.slice(0, 5));
  }
  // plain author tags
  const authorPs = [...c.matchAll(/author[^>]{0,40}>([^<]{2,30})</gi)].slice(0, 10).map(x => x[1]);
  console.log('authorTags', authorPs);
  // chapter list from catalog
  const chNames = [...c.matchAll(/"cN"\s*:\s*"([^"]+)"/g)].map(x => x[1]);
  const chIds = [...c.matchAll(/"id"\s*:\s*(\d{6,})/g)].map(x => x[1]);
  const chTitles = [...c.matchAll(/class="[^"]*chapter[^"]*"[^>]*>([^<]{2,80})</gi)].slice(0, 30).map(x => x[1]);
  console.log('cN count', chNames.length, 'sample', chNames.slice(0, 40));
  console.log('cN mid', chNames.slice(Math.floor(chNames.length/2), Math.floor(chNames.length/2)+20));
  console.log('cN end', chNames.slice(-30));
  // volume names
  const vols = [...c.matchAll(/"vN"\s*:\s*"([^"]+)"/g)].map(x => x[1]);
  console.log('vols', [...new Set(vols)].slice(0, 40));
  // chapter href titles
  const hrefTitles = [...c.matchAll(/href="\/\/m\.qidian\.com\/chapter\/\d+\/\d+\/?"[^>]*>([^<]+)</g)].map(x => x[1].trim()).filter(Boolean);
  console.log('hrefTitles', hrefTitles.slice(0, 50));
  console.log('hrefTitles end', hrefTitles.slice(-30));
  // any 主角 name patterns
  for (const kw of ['主角', '林玄宇', '建村', '命运币', '龙运', '赵云', '貂蝉', '游戏', '玩家', '天运', '天命']) {
    let i = c.indexOf(kw);
    if (i >= 0) console.log('kw', kw, JSON.stringify(c.slice(i, i + 120).replace(/\s+/g, ' ')));
  }
}

for (const f of fs.readdirSync(dir)) {
  if (f.includes('m_qidian_com_book') || f.match(/^(sg|tm|ty)_/)) {
    parseBook(f);
  }
}
