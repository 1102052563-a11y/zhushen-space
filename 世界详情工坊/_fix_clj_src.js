const fs = require('fs');
const path = '产出/批次600/苍兰诀.md';
let c = fs.readFileSync(path, 'utf8');
// normalize literal \n sequences that were written as two chars
c = c.replace(/\\n/g, '\n');
const src =
  '\n\n## 来源\n\n' +
  '- [搜笔趣阁搜索·苍兰诀](https://www.sobqg.com/searchBook.html?keyword=%E8%8B%8D%E5%85%B0%E8%AF%80)（已检索，未收录）\n' +
  '- [中文维基·苍兰诀](https://zh.wikipedia.org/wiki/%E8%8B%8D%E5%85%B0%E8%AF%80)\n' +
  '- [English Wikipedia·Love Between Fairy and Devil](https://en.wikipedia.org/wiki/Love_Between_Fairy_and_Devil)\n' +
  '- [中国新闻网·开机](https://www.chinanews.com.cn/m/yl/2021/02-19/9414587.shtml)\n' +
  '- [新京报·定档](https://www.bjnews.com.cn/detail/1659604527168850.html)\n' +
  '- [百度百科·苍兰诀](https://baike.baidu.com/item/%E8%8B%8D%E5%85%B0%E8%AF%80)\n';
// cut at first ## 来源 or 切入点加厚 garbage
let cut = c.indexOf('## 来源');
if (cut < 0) cut = c.indexOf('切入点加厚');
if (cut < 0) cut = c.indexOf('- [搜笔趣阁搜索·苍兰诀]');
if (cut > 0) c = c.slice(0, cut).trimEnd();
c = c + src;
fs.writeFileSync(path, c, 'utf8');
const links = (c.match(/https:\/\//g) || []).length;
console.log('links', links, 'len', c.length);
