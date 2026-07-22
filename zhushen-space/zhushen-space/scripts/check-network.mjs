// ─────────────────────────────────────────────────────────────────────────────
// 网络规约门禁（network gate）——把 docs/NETWORK_HANG_AUDIT.md 的静态扫描清单变成机器检查。
//
// 检查两类「卡网」高危写法（与 check-types.mjs 同样的 baseline 思路：存量入基线，
// 只拦【新增】违规——既不逼着一次修完历史存量，又保证问题不再变多）：
//   1. bareFetch          ：业务代码里的裸 fetch(。铁则：AI 调用必须走
//      resolveApiChain + apiChatFallback（有全局 abort/空闲超时/硬超时/节流 release/fallback）；
//      合法裸 fetch（静态资源、短 REST、apiChat.ts 自身、crashReport 等）都已在基线里。
//   2. fallbackNoTimeout  ：apiChatFallback(...) 调用点第三参没写 timeoutMs（=0 → 无空闲
//      超时、无硬超时 → 可永久挂）。实参里 timeoutMs 经变量透传的历史调用点也在基线里。
//
// 用法：
//   node scripts/check-network.mjs           # 门禁：有基线之外的新增违规则退出码 1
//   node scripts/check-network.mjs --update  # 把当前计数写成新基线（修掉存量后收紧用）
//
// 基线文件：scripts/network-baseline.json（按 文件 → 出现次数 归一，不含行号，
//   代码上下挪动不误报；行号只在报错时现算给人看）。
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASELINE = join(__dirname, 'network-baseline.json');

// 递归收集 src 下的 .ts/.tsx（测试文件不扫：测试里 mock fetch 属正常）
function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name.name) && !/\.test\.(ts|tsx)$/.test(name.name)) out.push(p);
  }
  return out;
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// 从 startIdx（指向 '('）提取括号平衡的实参段；跳过字符串/模板串/注释。
// 模板串内 ${} 嵌套反引号等极端写法可能算偏——无妨：门禁只要求【确定性】（同输入同计数），
// 偏差会一并进基线，不产生抖动误报。
function extractArgs(text, startIdx) {
  let depth = 0;
  let inStr = null;
  let i = startIdx;
  for (; i < text.length && i < startIdx + 20000; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr || (inStr !== '`' && c === '\n')) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return text.slice(startIdx, i);
}

// 扫描一个文件 → { bareFetch: [行号...], fallbackNoTimeout: [行号...] }
function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  const bareFetch = [];
  const fallbackNoTimeout = [];

  // 1) 裸 fetch(：排除 obj.fetch( / myFetch( 之类（前一个字符是 [.\w$] 的不算）
  for (const m of text.matchAll(/(?<![.\w$])fetch\s*\(/g)) {
    bareFetch.push(lineOf(text, m.index));
  }

  // 2) apiChatFallback( 调用点实参里没有 timeoutMs 的（跳过函数定义处）
  for (const m of text.matchAll(/apiChatFallback\s*\(/g)) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/function\s+$/.test(before)) continue;   // 定义而非调用
    const args = extractArgs(text, m.index + m[0].length - 1);
    if (!/\btimeoutMs\b/.test(args)) fallbackNoTimeout.push(lineOf(text, m.index));
  }
  return { bareFetch, fallbackNoTimeout };
}

// 全量扫描 → { bareFetch: {相对路径: 次数}, fallbackNoTimeout: {...} }，附行号明细供报错展示
const counts = { bareFetch: {}, fallbackNoTimeout: {} };
const details = { bareFetch: {}, fallbackNoTimeout: {} };
for (const abs of walk(SRC)) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  const r = scanFile(abs);
  for (const cat of ['bareFetch', 'fallbackNoTimeout']) {
    if (r[cat].length) { counts[cat][rel] = r[cat].length; details[cat][rel] = r[cat]; }
  }
}

// ── --update：写基线 ──
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n', 'utf8');
  const n = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`[netcheck] 基线已更新：裸 fetch ${n(counts.bareFetch)} 处 / 缺 timeoutMs ${n(counts.fallbackNoTimeout)} 处（均为已审计存量）`);
  process.exit(0);
}

// ── 门禁：对比基线 ──
if (!existsSync(BASELINE)) {
  console.error('[netcheck] ❌ 缺基线文件 scripts/network-baseline.json——先跑 `npm run check-network:update` 生成。');
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const LABEL = {
  bareFetch: '裸 fetch(（应走 resolveApiChain + apiChatFallback，或自带 timeout+abort 后纳入基线）',
  fallbackNoTimeout: 'apiChatFallback 调用缺 timeoutMs（=可永久挂起；建议值见 docs/NETWORK_HANG_AUDIT.md §2.2）',
};
let bad = 0;
let fixed = 0;
for (const cat of ['bareFetch', 'fallbackNoTimeout']) {
  const b = base[cat] || {};
  for (const file of new Set([...Object.keys(counts[cat]), ...Object.keys(b)])) {
    const now = counts[cat][file] || 0;
    const allow = b[file] || 0;
    if (now > allow) {
      if (!bad) console.error('');
      console.error(`[netcheck] ❌ ${file}：${LABEL[cat]}`);
      console.error(`  基线允许 ${allow} 处，现在有 ${now} 处（该文件全部命中行：${(details[cat][file] || []).join(', ')}）`);
      bad += now - allow;
    } else if (now < allow) fixed += allow - now;
  }
}
if (fixed > 0) console.log(`[netcheck] 👍 检测到 ${fixed} 处基线违规已修掉——可跑 \`npm run check-network:update\` 收紧基线。`);
if (bad > 0) {
  console.error(`\n[netcheck] ❌ 共 ${bad} 处新增网络规约违规（基线之外）。修法见 docs/NETWORK_HANG_AUDIT.md；确属合法（静态资源/自带超时的短 REST）则跑 \`npm run check-network:update\` 纳入基线。\n`);
  process.exit(1);
}
const n = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(`[netcheck] ✓ 无新增网络规约违规（基线内：裸 fetch ${n(base.bareFetch || {})} / 缺 timeoutMs ${n(base.fallbackNoTimeout || {})}）`);
process.exit(0);
