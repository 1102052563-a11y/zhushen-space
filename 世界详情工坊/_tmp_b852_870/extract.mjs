import fs from 'fs';
import path from 'path';

const list = JSON.parse(fs.readFileSync('_tmp_b852_870/list.json', 'utf8'));
const packs = [];

function section(t, label) {
  const needle = `【${label}】`;
  const i = t.indexOf(needle);
  if (i < 0) return '';
  let start = i + needle.length;
  if (t[start] === '*') start += 1; // after **
  // find next **【 or ## or 乐园阶位映射 at line start-ish
  const rest = t.slice(start);
  const m = rest.match(/\n\*\*【|\n## |\n乐园阶位映射/);
  const body = m ? rest.slice(0, m.index) : rest.slice(0, 800);
  return body.replace(/\s+/g, ' ').trim();
}

for (const x of list) {
  const t = fs.readFileSync(x.path, 'utf8').replace(/\r\n/g, '\n');
  // sources from existing
  const links = [...t.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((m) => ({ title: m[1], url: m[2] }));
  packs.push({
    b: x.b,
    name: x.name,
    file: x.file,
    path: x.path,
    tiers: x.tiers,
    maxTier: x.maxTier,
    peakBeyond: x.peakBeyond,
    blurb: x.blurb,
    src: section(t, '作品来源'),
    loc: section(t, '世界定位'),
    pow: section(t, '世界观 · 力量体系'),
    geo: section(t, '地理 · 舞台'),
    plot: section(t, '世界剧情线'),
    people: section(t, '主要人物'),
    force: section(t, '势力图谱'),
    items: section(t, '贵重物品'),
    hide: section(t, '隐藏剧情 · 伏笔'),
    tone: section(t, '叙事基调 · 雷区'),
    map: (t.match(/乐园阶位映射[^\n]*/) || [''])[0],
    links,
  });
}
fs.writeFileSync('_tmp_b852_870/packs.json', JSON.stringify(packs, null, 2));
console.log(packs.length);
console.log(packs[2].name, packs[2].src);
console.log(packs[40].name, packs[40].src.slice(0, 120));
