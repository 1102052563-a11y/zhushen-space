const fs = require('fs');
const path = require('path');
const dir = __dirname;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.html') && !f.endsWith('.txt')) continue;
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  console.log('====', f, c.length);
  const kws = ['三国神话世界', '天命游戏平台', '天运玩家', 'bookId', 'bookName', 'authorName', '作者', 'qidian.com/book'];
  for (const kw of kws) {
    let i = 0, n = 0;
    while ((i = c.indexOf(kw, i)) >= 0 && n < 8) {
      console.log(' ', kw, '@', i, JSON.stringify(c.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, ' ')));
      i += kw.length;
      n++;
    }
  }
  const bookNames = [...c.matchAll(/"bookName"\s*:\s*"([^"]+)"/g)].slice(0, 20).map(x => x[1]);
  const authors = [...c.matchAll(/"authorName"\s*:\s*"([^"]+)"/g)].slice(0, 20).map(x => x[1]);
  const ids = [...c.matchAll(/"bookId"\s*:\s*"?(\d+)/g)].slice(0, 20).map(x => x[1]);
  const hrefs = [...c.matchAll(/https?:\/\/[^\s"'<>]*qidian[^\s"'<>]*/g)].slice(0, 20);
  const titles = [...c.matchAll(/<title[^>]*>([^<]+)/gi)].map(x => x[1]);
  if (bookNames.length) console.log('bookNames', bookNames);
  if (authors.length) console.log('authors', authors);
  if (ids.length) console.log('ids', ids);
  if (hrefs.length) console.log('hrefs', hrefs.map(x => x[0]));
  if (titles.length) console.log('titles', titles);
  // ddg results
  const ddg = [...c.matchAll(/uddg=([^&"]+)/g)].slice(0, 15).map(x => decodeURIComponent(x[1]));
  if (ddg.length) console.log('ddg', ddg);
  const links = [...c.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(x => x[1]).filter(u =>
    /qidian|fanqie|zongheng|17k|jjwxc|biqu|penq|uukanshu|69shu|sfacg|ciweimao|book\.qq|hongxiu|readnovel|xxsy|faloo|xbiquge|69xinshu|qu\.la/i.test(u)
  ).slice(0, 20);
  if (links.length) console.log('novelLinks', links);
}
