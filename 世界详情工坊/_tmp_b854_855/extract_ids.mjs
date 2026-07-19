import fs from 'fs';
const h = fs.readFileSync('_tmp_b854_855/ly_search2.html', 'utf8');
const ids = [...h.matchAll(/data-bid="(\d+)"|bookId[=:]["']?(\d+)|\/book\/(\d{8,})/g)].map(
  (x) => x[1] || x[2] || x[3],
);
console.log('ids', [...new Set(ids)].slice(0, 30));
const t = h.replace(/<[^>]+>/g, ' ');
const i = t.indexOf('三阳开太泰');
console.log(t.slice(Math.max(0, i - 200), i + 500));
