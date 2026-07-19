import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.dirname(fileURLToPath(import.meta.url));
const keys = ['tianguo', 'xiong', 'miwu', 'yidu', 'qianhao', 'keji', 'feitu', 'jiji', 'minqi'];
const all = {};
for (const k of keys) {
  const html = fs.readFileSync(path.join(base, `qd_${k}.html`), 'utf8');
  const roles = [...html.matchAll(/"roleName"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
  const descs = [...html.matchAll(/"roleDesc"\s*:\s*"((?:\\.|[^"\\])*)"/g)].map((x) =>
    x[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').slice(0, 200),
  );
  const roleline = (html.match(/主要角色[：:][^<\n"]{0,400}/) || [])[0] || '';
  // chapter titles unique
  const chs = [
    ...new Set(
      [...html.matchAll(/>(第[\d一二三四五六七八九十百千零]+[章节卷][^<]{0,40})</g)].map((x) => x[1]),
    ),
  ].slice(0, 30);
  all[k] = { roles, descs, roleline, chs };
  console.log('===', k);
  console.log('roles', roles.join(' | '));
  console.log('roleline', roleline);
  console.log('chs sample', chs.slice(0, 10).join(' | '));
}
fs.writeFileSync(path.join(base, 'roles.json'), JSON.stringify(all, null, 2), 'utf8');
