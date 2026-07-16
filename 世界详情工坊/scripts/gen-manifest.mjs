// 世界详情工坊 · 清单生成器
// 解析 世界书/世界选择.json（一~九阶）+ 世界书/休闲世界.json，产出：
//   清单/manifest.json — 每个唯一世界：所属库、覆盖阶位、各阶编号、目录简介（若有）
//   清单/批次表.md    — 按目录顺序 5 个一批切好的推进清单
// 用法：node scripts/gen-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // 世界详情工坊/
const REPO = path.resolve(ROOT, '..');                                            // 仓库根
const WB_MAIN = path.join(REPO, '世界书', '世界选择.json');
const WB_LEISURE = path.join(REPO, '世界书', '休闲世界.json');
const OUT_DIR = path.join(ROOT, '清单');

// 与 WorldSelector.tsx parseWorldLib 一致的解析（多一路捕获散文式简介）
function parseWorldLib(content) {
  const nameById = new Map();
  const blurbById = new Map();
  const add = (idStr, name, blurb = '') => {
    const nm = String(name).replace(/\*+/g, '').replace(/^["「\s]+|["」\s]+$/g, '').trim();
    if (!nm) return;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || nameById.has(id)) return;
    nameById.set(id, nm);
    if (blurb) blurbById.set(id, blurb.replace(/\*+/g, '').trim());
  };
  const proseRe = /(?:^|[\r\n])[ \t]*(\d+)[.、]\s*\*\*([^*\n|]+?)\*\*\s*[|｜]([^\r\n]*)/g;
  let m;
  while ((m = proseRe.exec(content)) !== null) add(m[1], m[2], m[3]);
  const patterns = [
    /"(\d+)\|([^"|]+)"/g,
    /\*\*(\d+)\|([^*|]+)\*\*/g,
    /(?:^|[\r\n])[ \t>*-]*(\d+)\|([^"\n\r*|]+)/g,
    /id:\s*(\d+)\s*[\r\n]+\s*name:\s*"?([^"\n\r]+?)"?\s*(?=[\r\n]|$)/g,
  ];
  for (const re of patterns) { let mm; while ((mm = re.exec(content)) !== null) add(mm[1], mm[2]); }
  return { nameById, blurbById };
}

function loadEntries(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data.entries ? (Array.isArray(data.entries) ? data.entries : Object.values(data.entries)) : [];
}

const CN_TIERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// ── 主库：按【选择N阶世界】识别各阶条目 ──
const worlds = new Map();   // name → {name, lib, tiers:Set, ids:{tier:id}, minId, blurb}
for (const e of loadEntries(WB_MAIN)) {
  const tm = String(e.comment || '').match(/选择([一二三四五六七八九])阶世界/);
  if (!tm) continue;
  const tier = tm[1];
  const { nameById, blurbById } = parseWorldLib(e.content || '');
  for (const [id, name] of nameById) {
    let w = worlds.get(name);
    if (!w) { w = { name, lib: '主库', tiers: new Set(), ids: {}, minId: Infinity, blurb: '' }; worlds.set(name, w); }
    w.tiers.add(tier);
    if (w.ids[tier] === undefined) w.ids[tier] = id;
    if (id < w.minId) w.minId = id;
    if (!w.blurb && blurbById.has(id)) w.blurb = blurbById.get(id);
  }
}

// ── 休闲库 ──
const leisure = new Map();
for (const e of loadEntries(WB_LEISURE)) {
  const { nameById, blurbById } = parseWorldLib(e.content || '');
  for (const [id, name] of nameById) {
    if (leisure.has(name)) continue;
    leisure.set(name, { name, lib: '休闲', tiers: new Set(['休闲']), ids: { 休闲: id }, minId: id, blurb: blurbById.get(id) || '' });
  }
}

const mainList = [...worlds.values()].sort((a, b) => a.minId - b.minId || a.name.localeCompare(b.name, 'zh'));
const leisureList = [...leisure.values()].sort((a, b) => a.minId - b.minId);
const all = [...mainList, ...leisureList].map((w) => ({
  name: w.name,
  lib: w.lib,
  tiers: w.lib === '主库' ? CN_TIERS.filter((t) => w.tiers.has(t)) : ['休闲'],
  ids: w.ids,
  blurb: w.blurb,
}));

// ── 合并「新增世界」（判重新加·据 maxTier 生成覆盖阶位 一~maxTier）──
// 读取 清单/新增世界*.json 全部（分批加时各写一个文件即可，按文件名排序）
let extraCount = 0;      // 新增·战斗(主库轨道)
let extraLeisure = 0;    // 新增·休闲(休闲轨道·leisure:true)
{
  const extraFiles = fs.readdirSync(OUT_DIR).filter((f) => /^新增世界.*\.json$/.test(f)).sort();
  const extra = extraFiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')).worlds || []);
  const existing = new Set(all.map((w) => w.name));
  for (const e of extra) {
    if (!e.name || existing.has(e.name)) continue;   // 与主/休闲/彼此判重
    existing.add(e.name);
    // 休闲世界（leisure:true 或 lib:'休闲'）：无阶位/战力，走休闲轨道
    if (e.leisure === true || e.lib === '休闲') {
      all.push({
        name: e.name,
        lib: '休闲',
        tiers: ['休闲'],
        ids: {},
        blurb: e.cat ? `【新增·${e.cat}】` : '【新增·休闲】',
        source: '新增',
      });
      extraLeisure++;
      continue;
    }
    const mt = Math.max(1, Math.min(9, e.maxTier || 1));
    all.push({
      name: e.name,
      lib: '主库',
      tiers: CN_TIERS.slice(0, mt),                    // 一阶 .. maxTier阶
      ids: {},
      blurb: e.cat ? `【新增·${e.cat}】` : '【新增】',
      maxTier: CN_TIERS[mt - 1],
      peakBeyond: !!e.peakBeyond,                       // 峰值达超阶(绝强+)
      source: '新增',
    });
    extraCount++;
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
  stats: { 主库: mainList.length, 休闲: leisureList.length, 新增战斗: extraCount, 新增休闲: extraLeisure, 合计: all.length },
  worlds: all,
}, null, 1), 'utf8');

// ── 批次表：5 个一批 ──
const lines = ['# 批次表（5 个/批 · 按目录顺序）', '', `> 主库 ${mainList.length} + 休闲 ${leisureList.length} + 新增战斗 ${extraCount} + 新增休闲 ${extraLeisure} = ${all.length} 个世界，共 ${Math.ceil(all.length / 5)} 批。`, '> 完成一个划一个勾；实惠模型产出放 产出/批次NN/。战斗世界阶位＝一阶..最高阶(据战力图鉴)，峰值超阶者标注；休闲世界走休闲轨道(无阶位·见 README)。', ''];
const firstExtraIdx = all.findIndex((w) => w.source === '新增');
for (let i = 0; i < all.length; i += 5) {
  const nn = String(Math.floor(i / 5) + 1).padStart(3, '0');
  const isExtraBatch = firstExtraIdx >= 0 && i >= firstExtraIdx;
  lines.push(`## 批次${nn}${isExtraBatch ? '　【新增世界】' : ''}`);
  for (const w of all.slice(i, i + 5)) {
    if (w.source === '新增') {
      lines.push(`- [ ] ${w.name}（新增·最高${w.maxTier}阶${w.peakBeyond ? '·峰值超阶' : ''}·切入点覆盖：${w.tiers.join('、')}）`);
    } else {
      lines.push(`- [ ] ${w.name}（${w.lib}·阶位：${w.tiers.join('、')}）`);
    }
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT_DIR, '批次表.md'), lines.join('\n'), 'utf8');

console.log(`manifest.json：主库 ${mainList.length} + 休闲 ${leisureList.length} + 新增战斗 ${extraCount} + 新增休闲 ${extraLeisure} = ${all.length} 个世界`);
console.log(`批次表.md：${Math.ceil(all.length / 5)} 批 · 新增世界从批次 ${firstExtraIdx >= 0 ? String(Math.floor(firstExtraIdx / 5) + 1).padStart(3, '0') : '—'} 起`);
