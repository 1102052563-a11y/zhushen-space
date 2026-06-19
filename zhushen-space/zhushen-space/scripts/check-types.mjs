// ─────────────────────────────────────────────────────────────────────────────
// 类型检查门禁（tsc gate）
//
// 背景：本仓库长期关着 tsc（`npm run build` 的 `tsc &&` 会因预存错误失败，故一直
//   用 `vite build` 跳过）。经过一轮整改，类型错误已清到一个**很小且已知**的集合
//   （WorldSelector 的中文键索引 23 个 + 3 个故意保留的未用声明）。
//
// 这个门禁的作用：把当前这些已知错误存成「基线」，之后只要**冒出基线之外的新错误**
//   就让构建失败——既不强迫去改 WorldSelector / 删那 3 个信号，又能挡住真 bug 回流。
//   这是业界给「有存量错误的代码库接入 tsc」的标准做法（baseline / betterer 思路）。
//
// 健壮性：失败路径会**复跑一次 tsc，只报两次都出现的错误**（瞬时抖动只会出现在一次里，
//   真错误两次都在）。clean tree 实测确定（直跑 tsc 8/8、门禁 6/6 一致），复跑只是兜底。
//
// 用法：
//   node scripts/check-types.mjs           # 门禁：有稳定新错误则退出码 1
//   node scripts/check-types.mjs --update  # 把当前错误写成新基线（修了错误后收紧用）
//
// 基线文件：scripts/tsc-baseline.json（按 文件|错误码|消息 归一，**不含行号**，
//   所以代码上下挪动不会误报）。
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE = join(__dirname, 'tsc-baseline.json');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const keyOf = (e) => `${e.file}|${e.code}|${e.msg}`;

// 跑一次 tsc --noEmit，解析出错误（去行列号归一，便于跨改动比对）
function runTsc() {
  const res = spawnSync(process.execPath, [TSC, '--noEmit'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  const errors = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(RE);
    if (m) {
      const file = m[1].replace(/\\/g, '/');
      errors.push({ file, code: m[4], msg: m[5].trim(), raw: `${file}(${m[2]},${m[3]}): error ${m[4]}: ${m[5].trim()}` });
    }
  }
  return { errors, status: res.status, out };
}

// 计数表：key -> 出现次数
function countErrors(errors) {
  const c = {};
  for (const e of errors) c[keyOf(e)] = (c[keyOf(e)] || 0) + 1;
  return c;
}

// 相对基线的「新增错误」：逐条消耗基线额度，超额者即为新增
function freshAgainst(errors, base) {
  const allow = { ...base };
  const fresh = [];
  for (const e of errors) {
    const k = keyOf(e);
    if (allow[k] > 0) allow[k] -= 1;
    else fresh.push(e);
  }
  return fresh;
}

const first = runTsc();

// tsc 自身崩溃（工具异常而非类型报错）：输出里没有可解析的 error 行但退出码非 0 → 直接失败
if (first.errors.length === 0 && first.status !== 0) {
  console.error('[typecheck] ❌ tsc 执行异常（非类型错误）：\n' + first.out.trim());
  process.exit(1);
}

// ── --update：跑 3 次取并集（按 key 取最大计数），把瞬时抖动也纳入基线，避免基线偏窄 ──
if (process.argv.includes('--update')) {
  const merged = countErrors(first.errors);
  for (let i = 0; i < 2; i++) {
    const c = countErrors(runTsc().errors);
    for (const k in c) merged[k] = Math.max(merged[k] || 0, c[k]);
  }
  writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  const total = Object.values(merged).reduce((a, n) => a + n, 0);
  console.log(`[typecheck] 基线已更新：纳入 ${total} 个已知错误（${Object.keys(merged).length} 类，3 次并集）`);
  process.exit(0);
}

// ── 门禁：对比基线 ──
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
let fresh = freshAgainst(first.errors, base);

// 失败兜底：复跑一次，只保留两次都判为新增的错误（滤掉瞬时抖动）
if (fresh.length > 0) {
  const second = freshAgainst(runTsc().errors, base);
  const confirmedKeys = new Set(second.map(keyOf));
  const transient = fresh.filter((e) => !confirmedKeys.has(keyOf(e)));
  fresh = fresh.filter((e) => confirmedKeys.has(keyOf(e)));
  if (transient.length) {
    console.log(`[typecheck] （已忽略 ${transient.length} 个仅出现一次的瞬时抖动错误）`);
  }
}

// 提示：基线里有、本次没有的 → 已修复，可收紧基线
const hit = countErrors(first.errors);
let fixedCount = 0;
for (const k in base) fixedCount += Math.max(0, base[k] - (hit[k] || 0));
if (fixedCount > 0) {
  console.log(`[typecheck] 👍 检测到 ${fixedCount} 个基线错误已修复——可跑 \`npm run typecheck:update\` 收紧基线。`);
}

if (fresh.length > 0) {
  console.error(`\n[typecheck] ❌ 发现 ${fresh.length} 个新增类型错误（基线之外，已复跑确认）：\n`);
  for (const e of fresh) console.error('  ' + e.raw);
  console.error('\n请修掉它们；若确属预期，跑 `npm run typecheck:update` 纳入基线。\n');
  process.exit(1);
}

console.log(`[typecheck] ✓ 无新增类型错误（${first.errors.length} 个已知错误均在基线内）`);
process.exit(0);
