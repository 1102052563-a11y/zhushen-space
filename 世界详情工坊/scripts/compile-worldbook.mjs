// 世界详情工坊 · 编译器 + 机检门禁
// 把 产出/**/*.md（实惠模型产出）校验后编译成 SillyTavern 格式世界书 JSON：
//   世界书/世界详情库·主库.json / 世界书/世界详情库·休闲.json
// 每世界 2 条目：`<名>·剧情`（key=[名]）与 `<名>·阶位切入点`（key=[名], keysecondary=[切入点]），
// 均绿灯 selective。uid 稳定：清单/uid-map.json 持久映射，重复编译不变。
// 用法：
//   node scripts/compile-worldbook.mjs                 # 全量校验+编译
//   node scripts/compile-worldbook.mjs --check <file>  # 只校验单个 md（机检门禁，不写盘）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');
const OUT_DIR = path.join(ROOT, '产出');
const LIST_DIR = path.join(ROOT, '清单');
const WB_DIR = path.join(REPO, '世界书');
const MIN_PLOT = 10000;         // 主库(战斗世界)剧情最少字数（去空白后）
const MIN_PLOT_LEISURE = 6000;  // 休闲世界剧情最少字数（角色/情感为主·门槛略低）
const MIN_ENTRY = 1500;    // 切入点最少字数
const MIN_SOURCES = 3;

// ── 清单 ──
const manifestPath = path.join(LIST_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) { console.error('缺 清单/manifest.json，先跑 node scripts/gen-manifest.mjs'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const byName = new Map(manifest.worlds.map((w) => [w.name, w]));

// ── md 解析 ──
function parseMd(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const nameM = text.match(/^#\s+(.+?)\s*$/m);
  const metaM = text.match(/<!--\s*meta\s+([^>]*?)-->/);
  const meta = {};
  if (metaM) for (const kv of metaM[1].trim().split(/\s+/)) { const [k, v] = kv.split('='); if (k && v) meta[k] = v; }
  const sections = {};
  const secRe = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const marks = [];
  let m;
  while ((m = secRe.exec(text)) !== null) marks.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    sections[marks[i].name] = text.slice(marks[i].bodyStart, end).trim();
  }
  return { file, name: nameM ? nameM[1].trim() : '', meta, sections };
}

const charCount = (s) => (s || '').replace(/\s/g, '').length;

// ── 校验 ──
function validate(doc) {
  const errors = [], warnings = [];
  const raw = fs.readFileSync(doc.file, 'utf8');
  // 年龄政策 ABORT：短文件占位，跳过剧情/切入字数门禁
  if (/status=ABORT|reason=age-policy|## ABORT/.test(raw)) {
    if (!doc.name) errors.push('缺文件首行 `# 世界名` 标题');
    const world = byName.get(doc.name);
    if (doc.name && !world) warnings.push(`ABORT 占位：世界名「${doc.name}」暂不在清单（可后续同步）`);
    warnings.push('年龄政策 ABORT：不写真稿（剧情/切入字数=0）');
    return { errors, warnings, world, abort: true };
  }
  if (!doc.name) errors.push('缺文件首行 `# 世界名` 标题');
  const world = byName.get(doc.name);
  if (doc.name && !world) errors.push(`世界名「${doc.name}」不在清单里（错别字？全名不精确？对照 清单/manifest.json）`);
  const isLeisure = world && world.lib === '休闲';
  const plot = doc.sections['剧情'], src = doc.sections['来源'];
  const entry = doc.sections['阶位切入点'] || doc.sections['休闲切入点'];
  const entryLabel = isLeisure ? '休闲切入点' : '阶位切入点';
  const minPlot = isLeisure ? MIN_PLOT_LEISURE : MIN_PLOT;
  if (!plot) errors.push('缺 `## 剧情` 段');
  if (!entry) errors.push(`缺 \`## ${entryLabel}\` 段`);
  else if (isLeisure && doc.sections['阶位切入点']) warnings.push('休闲世界应用 `## 休闲切入点`（写的是「阶位切入点」——休闲世界无阶位/战力）');
  if (plot && charCount(plot) < minPlot) errors.push(`剧情 ${charCount(plot)} 字 < ${minPlot}（去空白计）`);
  if (entry && charCount(entry) < MIN_ENTRY) errors.push(`切入点 ${charCount(entry)} 字 < ${MIN_ENTRY}`);
  // 必备段落按 lib 分流：休闲＝情感/角色向；主库＝力量/剧情向
  const REQ = isLeisure
    ? ['【作品来源】', '【世界观 · 舞台设定】', '【故事主线 · 情感线】', '【可攻略角色 / 主要人物】', '【氛围基调 · 雷区】']
    : ['【作品来源】', '【世界观 · 力量体系】', '【世界剧情线】', '【主要人物】', '【贵重物品】', '【隐藏剧情 · 伏笔】'];
  if (plot) for (const seg of REQ) if (!plot.includes(seg)) errors.push(`剧情缺必备段落 ${seg}`);
  if (isLeisure && plot && /力量体系|战力|阶位|巅峰战力/.test(plot)) warnings.push('休闲世界剧情出现「力量体系/战力/阶位」等战斗向措辞，应改写为日常/情感向');
  if (world && world.lib === '主库') {
    if (plot && !plot.includes('乐园阶位映射')) errors.push('剧情缺「乐园阶位映射」锚定行（须对照 参考/阶位战力图鉴.md，工单铁令7）');
    if (entry && !entry.includes('阶位↔')) errors.push('切入点缺开头「阶位↔」对照行（须对照 参考/阶位战力图鉴.md）');
  }
  const links = (src || '').match(/\]\(https?:\/\/[^)]+\)/g) || [];
  if (links.length < MIN_SOURCES) warnings.push(`来源链接 ${links.length} 条 < ${MIN_SOURCES}`);
  if (world && entry && world.lib === '主库') {
    const missing = world.tiers.filter((t) => !entry.includes(`${t}阶`));
    if (missing.length) warnings.push(`切入点未覆盖清单阶位：${missing.join('、')}`);
    const extra = ['一', '二', '三', '四', '五', '六', '七', '八', '九'].filter((t) => !world.tiers.includes(t) && new RegExp(`\\*\\*${t}阶`).test(entry));
    if (extra.length) errors.push(`切入点写了该世界不覆盖的阶位：${extra.join('、')}（严禁硬凑）`);
  }
  for (const bad of ['被封印', '被削弱', '战力限制', '任务公证限制']) {
    if (entry && entry.includes(bad)) warnings.push(`切入点疑似出现"${bad}"式顶点解释，人工复核（铁令6）`);
  }
  return { errors, warnings, world };
}

function report(doc, v) {
  const status = v.abort
    ? (v.errors.length ? '✗ 不过关' : '✓ ABORT')
    : v.errors.length ? '✗ 不过关' : v.warnings.length ? '△ 过关(有警告)' : '✓ 过关';
  console.log(`\n${status}  ${doc.name || path.basename(doc.file)}  [${path.relative(ROOT, doc.file)}]`);
  if (v.abort) console.log('   剧情 0 字 · 切入点 0 字（年龄政策不写真稿）');
  else {
    const plot = doc.sections['剧情'], entry = doc.sections['阶位切入点'] || doc.sections['休闲切入点'];
    if (plot || entry) console.log(`   剧情 ${charCount(plot)} 字 · 切入点 ${charCount(entry)} 字`);
  }
  for (const e of v.errors) console.log(`   [错误] ${e}`);
  for (const w of v.warnings) console.log(`   [警告] ${w}`);
}

// ── --check 单文件模式（机检门禁） ──
const argv = process.argv.slice(2);
const checkIdx = argv.indexOf('--check');
if (checkIdx !== -1) {
  const file = argv[checkIdx + 1];
  if (!file || !fs.existsSync(file)) { console.error('用法：node scripts/compile-worldbook.mjs --check <md文件>'); process.exit(1); }
  const doc = parseMd(path.resolve(file));
  const v = validate(doc);
  report(doc, v);
  process.exit(v.errors.length ? 2 : 0);
}

// ── 全量编译 ──
function* walkMd(dir) {
  if (!fs.existsSync(dir)) return;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) yield* walkMd(p);
    else if (it.name.endsWith('.md') && !it.name.startsWith('_')) yield p;
  }
}

// uid 稳定映射（首编分配、复编不变）
const uidMapPath = path.join(LIST_DIR, 'uid-map.json');
const uidMap = fs.existsSync(uidMapPath) ? JSON.parse(fs.readFileSync(uidMapPath, 'utf8')) : {};
let nextUid = Object.values(uidMap).reduce((mx, v) => Math.max(mx, v + 1), 1000);
const uidOf = (name) => { if (uidMap[name] === undefined) { uidMap[name] = nextUid; nextUid += 2; } return uidMap[name]; };

const books = { 主库: {}, 休闲: {} };
let pass = 0, fail = 0;
const failed = [];
for (const file of walkMd(OUT_DIR)) {
  const doc = parseMd(file);
  const v = validate(doc);
  report(doc, v);
  if (v.errors.length) { fail++; failed.push(doc.name || file); continue; }
  if (v.abort) { pass++; continue; }
  pass++;
  const lib = v.world.lib;
  const base = uidOf(doc.name);
  books[lib][base] = {
    uid: base, key: [doc.name], keysecondary: [], comment: `${doc.name}·剧情`,
    content: doc.sections['剧情'], constant: false, selective: true, enabled: true, order: base, position: 0,
  };
  const cutLabel = lib === '休闲' ? '休闲切入点' : '阶位切入点';
  books[lib][base + 1] = {
    uid: base + 1, key: [doc.name], keysecondary: ['切入点'], comment: `${doc.name}·${cutLabel}`,
    content: doc.sections['阶位切入点'] || doc.sections['休闲切入点'], constant: false, selective: true, enabled: true, order: base + 1, position: 0,
  };
}

for (const [lib, entries] of Object.entries(books)) {
  if (!Object.keys(entries).length) continue;
  const out = path.join(WB_DIR, `世界详情库·${lib}.json`);
  // 增量：已有输出文件则合并（本次编译的世界覆盖旧版，其余保留）
  if (fs.existsSync(out)) {
    const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
    for (const [k, v] of Object.entries(prev.entries || {})) if (!entries[k]) entries[k] = v;
  }
  fs.writeFileSync(out, JSON.stringify({ entries }, null, 1), 'utf8');
  console.log(`\n→ ${path.relative(REPO, out)}：${Object.keys(entries).length} 条目（${Object.keys(entries).length / 2} 个世界）`);
}
fs.writeFileSync(uidMapPath, JSON.stringify(uidMap, null, 1), 'utf8');

const doneWorlds = Object.keys(uidMap).length;
console.log(`\n本次：过关 ${pass} · 不过关 ${fail}${failed.length ? `（${failed.join('、')}）` : ''}`);
console.log(`总进度：${doneWorlds} / ${manifest.stats.合计} 个世界`);
