import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(base).filter((f) => f.startsWith('qd_') && f.endsWith('.html'));
const out = {};
for (const f of files) {
  const html = fs.readFileSync(path.join(base, f), 'utf8');
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
  const author = (html.match(/"authorName"\s*:\s*"([^"]+)"/) || [])[1] || '';
  const book = (html.match(/"bookName"\s*:\s*"([^"]+)"/) || [])[1] || '';
  let desc = (html.match(/"desc"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1] || '';
  desc = desc
    .replace(/\\n/g, '\n')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\"/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
  const meta = (html.match(/name="description"\s+content="([^"]+)"/) || [])[1] || '';
  const chars = (html.match(/主要角色[：:]([^<"\n]{0,300})/) || [])[1] || '';
  const chs = [...html.matchAll(/第[\d一二三四五六七八九十百千零]+[章节卷][^<"\n]{0,40}/g)]
    .map((x) => x[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 20);
  const key = f.replace(/^qd_/, '').replace(/\.html$/, '');
  out[key] = { title, author, book, desc: desc.slice(0, 1500), meta: meta.slice(0, 800), chars, chs };
  console.log('---', key, book || title, author);
  console.log('desc:', desc.slice(0, 400));
  console.log('chars:', chars);
  console.log('chs:', chs.slice(0, 8).join(' | '));
}
fs.writeFileSync(path.join(base, 'parsed_qd.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('wrote parsed_qd.json');
