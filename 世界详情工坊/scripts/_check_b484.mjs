import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '产出', '批次484');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
const req = [
  '【作品来源】',
  '【世界定位】',
  '【世界观 · 舞台设定】',
  '【地理 · 生活舞台】',
  '【故事主线 · 情感线】',
  '【可攻略角色 / 主要人物】',
  '【人际关系网 / 社团势力】',
  '【情感事件 · 名场面】',
  '【隐藏剧情 · 真结局 · 伏笔】',
  '【氛围基调 · 雷区】',
];
const ban = [
  '力量体系',
  '战力',
  '阶位',
  '巅峰战力',
  '${props',
  '见上文对应线',
  '家里没人会注意',
  '心结与攻略以同意与边界为核心',
  '第一天把名牌',
  '表摆反',
  '永远准时',
  '拖鞋摆在最角落',
  '欢迎喊得很亮',
];
const cc = (s) => s.replace(/\s/g, '').length;
const all = [];
console.log('file | plot | entry | segs | meta | src | banned');
let allOk = true;
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const meta = /lib=休闲/.test(t) && /tiers=休闲/.test(t);
  const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
  const entry = (t.split('## 休闲切入点')[1] || '').split('## 来源')[0] || '';
  const segs = req.every((r) => t.includes(r));
  const banned = ban.filter((b) => t.includes(b));
  const src = (t.match(/^- \[/gm) || []).length;
  const cast = [...t.matchAll(/- \*\*([^*]+?)（/g)].map((x) => x[1]);
  cast.forEach((n) => all.push({ n, f }));
  const ok =
    meta &&
    segs &&
    cc(plot) >= 6000 &&
    cc(entry) >= 1500 &&
    banned.length === 0 &&
    src >= 3 &&
    t.includes('## 休闲切入点');
  if (!ok) allOk = false;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${f} | 剧情=${cc(plot)} | 切入=${cc(entry)} | segs=${segs} | meta=${meta} | src=${src} | ban=${banned.join('|') || 'ok'}`,
  );
}
const map = {};
for (const { n, f } of all) {
  (map[n] = map[n] || []).push(f);
}
const cross = Object.entries(map).filter(([, fs]) => new Set(fs).size > 1);
console.log('cross-file name dups:', cross.length ? cross : 'none');
console.log('unique names:', Object.keys(map).length);
console.log(allOk && !cross.length ? 'ALL PASS' : 'HAS FAIL');
