const fs = require('fs');
const path = require('path');
const dir = __dirname;

function extractBooks(html, label) {
  const books = [];
  // pattern: data-bid="ID" ... title ... author
  const re = /data-bid="(\d+)"[\s\S]{0,800}?title="([^"]+)"[\s\S]{0,1200}?class="_searchBookAuthor[^"]*">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) {
    books.push({ id: m[1], title: m[2].replace(/在线阅读$/, ''), author: m[3].trim() });
  }
  // also JSON blobs
  const jsonRe = /\{"subCateId":\d+,"bName":"([^"]+)"[\s\S]*?"author":"([^"]+)"[\s\S]*?"bookId":"?(\d+)/g;
  while ((m = jsonRe.exec(html))) {
    books.push({ id: m[3], title: m[1], author: m[2], from: 'json' });
  }
  // bName fields
  const bName = [...html.matchAll(/"bName":"([^"]+)"/g)].map(x => x[1]);
  const authors = [...html.matchAll(/"author":"([^"]+)"/g)].map(x => x[1]);
  const bids = [...html.matchAll(/"bookId":"?(\d+)/g)].map(x => x[1]);
  const descs = [...html.matchAll(/"desc":"([^"]{20,400})"/g)].map(x => x[1].replace(/\\n/g, ' '));
  console.log('LABEL', label);
  console.log('bName', bName.slice(0, 15));
  console.log('authors', authors.slice(0, 15));
  console.log('bids', bids.slice(0, 15));
  console.log('descs0', descs[0]);
  console.log('books', books.slice(0, 10));
  // first book block author p
  const authorPs = [...html.matchAll(/_searchBookAuthor[^"]*">([^<]+)</g)].map(x => x[1]);
  console.log('authorPs', authorPs.slice(0, 15));
  // chapter links
  const ch = [...html.matchAll(/m\.qidian\.com\/chapter\/(\d+)\/(\d*)/g)].slice(0, 10);
  console.log('chapters', ch.map(x => x[0]));
}

for (const f of fs.readdirSync(dir)) {
  if (!f.includes('m_qidian')) continue;
  extractBooks(fs.readFileSync(path.join(dir, f), 'utf8'), f);
}
