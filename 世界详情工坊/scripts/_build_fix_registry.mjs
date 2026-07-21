// 从 _audit_report.json 生成"修复注册表"：
//   清单/修复清单.json  —— 机器可读，每文件一行，含 status(待修复/已修复) 与 fixed 标志
//   修复清单.md          —— 人类可读表格，按优先级+批次分组
// 已存在的注册表若某行已是"已修复"，保留其状态（增量，不回退已修复项）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_DIR = path.join(ROOT, '清单');
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '_audit_report.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(LIST_DIR, 'manifest.json'), 'utf8'));
const byName = new Map(manifest.worlds.map((w) => [w.name, w]));

const REG_PATH = path.join(LIST_DIR, '修复清单.json');
const prev = fs.existsSync(REG_PATH) ? JSON.parse(fs.readFileSync(REG_PATH, 'utf8')) : { rows: [] };
const prevByFile = new Map((prev.rows || []).map((r) => [r.file, r]));

// 已修复标志：文件里含 <!--repaired ...--> 且当前无致命问题
const REPAIR_MARK = /<!--\s*repaired[^>]*-->/;

// 聚合每文件的问题
const files = new Map(); // file -> {file,name,batch,lib,issues:[],cross:[]}
function ensure(file, name) {
  if (!files.has(file)) {
    const m = file.match(/批次(\d+)/);
    const world = byName.get(name);
    files.set(file, { file, name, batch: m ? parseInt(m[1]) : -1, lib: world ? world.lib : '?', issues: [], crossGroups: [] });
  }
  return files.get(file);
}
for (const e of audit.report) {
  const t = ensure(e.file, e.name);
  for (const i of e.issues) t.issues.push({ type: i.type, detail: i.detail });
}
// 跨世界重复：只登记"有意义"的组（size>=3，排除2处巧合短语），标注组ID+样例+同组世界数
let gid = 0;
for (const grp of audit.crossDup) {
  gid++;
  if (grp.length < 3) continue;
  const names = [...new Set(grp.map((o) => o.name))];
  for (const o of grp) {
    const t = ensure(o.file, o.name);
    t.crossGroups.push({ gid, size: grp.length, worlds: names.length, snippet: grp[0].snippet.slice(0, 40) });
  }
}

// 优先级判定
function priority(t) {
  const types = new Set(t.issues.map((i) => i.type));
  if (types.has('结构') || types.has('机检-错误')) return 'P0';
  if (types.has('灌水标记') || t.crossGroups.some((g) => g.size >= 3)) return 'P1';
  if (types.has('文件内重复段')) return 'P1';
  return 'P2'; // 仅文件名不符 / 机检-警告
}

// 把"上一版注册表里存在、但本次审计已不再报问题"的文件也纳入（它们大概率已被修好）
for (const pr of prev.rows || []) {
  if (!files.has(pr.file)) {
    files.set(pr.file, { file: pr.file, name: pr.name, batch: pr.batch, lib: pr.lib, issues: [], crossGroups: [], resolved: true });
  }
}

// 生成行
const rows = [];
for (const t of files.values()) {
  // 读取文件判断是否已带修复标志
  const abs = path.join(ROOT, t.file);
  let hasMark = false;
  try { hasMark = REPAIR_MARK.test(fs.readFileSync(abs, 'utf8')); } catch {}
  const pr = priority(t);
  // 问题摘要
  const issueSummary = [];
  const wc = t.issues.find((i) => i.type === '机检-错误');
  if (wc) issueSummary.push('机检错误:' + wc.detail.join('/'));
  if (t.issues.some((i) => i.type === '结构')) issueSummary.push('结构异常');
  if (t.issues.some((i) => i.type === '灌水标记')) {
    const d = t.issues.filter((i) => i.type === '灌水标记').flatMap((i) => i.detail);
    issueSummary.push('灌水标记:' + [...new Set(d)].join('、'));
  }
  if (t.issues.some((i) => i.type === '文件内重复段')) issueSummary.push('文件内重复段');
  if (t.crossGroups.length) {
    const big = t.crossGroups.sort((a, b) => b.size - a.size)[0];
    issueSummary.push(`跨世界重复(组#${big.gid}·${big.worlds}个世界共用)`);
  }
  if (t.issues.some((i) => i.type === '文件名不符')) issueSummary.push('文件名不符');
  if (t.issues.some((i) => i.type === '机检-警告')) {
    const d = t.issues.filter((i) => i.type === '机检-警告').flatMap((i) => i.detail);
    issueSummary.push('警告:' + [...new Set(d)].slice(0, 2).join('；'));
  }

  const prevRow = prevByFile.get(t.file);
  // 判定"已修复"：文件已盖 <!--repaired--> 标志（此标志只有通过 _verify_and_mark 全部门禁才会被盖，可信），
  // 或本次审计已完全不再报该文件问题(resolved)，或上版已标已修复。
  let status = '待修复';
  if (hasMark) status = '已修复';
  else if (t.resolved) status = '已修复';
  else if (prevRow && prevRow.status === '已修复') status = '已修复';

  rows.push({
    priority: pr,
    batch: t.batch,
    file: t.file,
    name: t.name,
    lib: t.lib,
    issue: issueSummary.join(' | '),
    hasCrossDup: t.crossGroups.length > 0,
    crossGroupIds: [...new Set(t.crossGroups.map((g) => g.gid))],
    status,
    fixedMark: hasMark,
  });
}

// 排序：P0>P1>P2, 再按批次
const prank = { P0: 0, P1: 1, P2: 2 };
rows.sort((a, b) => prank[a.priority] - prank[b.priority] || a.batch - b.batch || a.file.localeCompare(b.file));

const out = { generatedAt: '20260721', total: rows.length, byStatus: {}, byPriority: {}, rows };
for (const r of rows) {
  out.byStatus[r.status] = (out.byStatus[r.status] || 0) + 1;
  out.byPriority[r.priority] = (out.byPriority[r.priority] || 0) + 1;
}
fs.writeFileSync(REG_PATH, JSON.stringify(out, null, 1), 'utf8');

// 人类可读 md
const md = [];
md.push('# 世界详情工坊 · 修复清单（表驱动）');
md.push('');
md.push(`> 生成于 20260721 全库审计。总计 **${rows.length}** 个待处理文件。执行流程见 [修复工作流.md](修复工作流.md)。`);
md.push(`> 状态统计：${Object.entries(out.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
md.push(`> 优先级统计：${Object.entries(out.byPriority).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
md.push('');
md.push('**优先级含义**：P0=机检不过关(字数/缺段/结构，必须修)；P1=灌水标记/跨世界雷同大段(内容质量)；P2=文件名不符/软警告(可选)。');
md.push('**状态列**：`待修复` / `已修复`。修复完成的判定＝文件内已插入 `<!--repaired ...-->` 标志且机检无错误。');
md.push('');
for (const pr of ['P0', 'P1', 'P2']) {
  const sub = rows.filter((r) => r.priority === pr);
  if (!sub.length) continue;
  md.push(`## ${pr}（${sub.length}）`);
  md.push('');
  md.push('| 状态 | 批次 | 世界名 | lib | 问题摘要 | 文件 |');
  md.push('|---|---|---|---|---|---|');
  for (const r of sub) {
    const st = r.status === '已修复' ? '✅已修复' : '⬜待修复';
    const nm = (r.name || '(空)').replace(/\|/g, '＼');
    const iss = r.issue.replace(/\|/g, '／').slice(0, 120);
    md.push(`| ${st} | ${r.batch} | ${nm} | ${r.lib} | ${iss} | \`${r.file}\` |`);
  }
  md.push('');
}
fs.writeFileSync(path.join(ROOT, '修复清单.md'), md.join('\n'), 'utf8');

console.log(`修复注册表已生成：`);
console.log(`  清单/修复清单.json（机器可读，${rows.length} 行）`);
console.log(`  修复清单.md（人类可读表格）`);
console.log(`状态：`, out.byStatus);
console.log(`优先级：`, out.byPriority);
