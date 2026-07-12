/* 提取全站界面中文源字符串 → public/ui-strings.json（翻译映射表的「静态全集」）。
   用法：node tools/gen-ui-strings.mjs [输出路径]  或  npm run gen-ui-strings
   注：这只是「静态兜底全集」；运行时 i18n/seen.ts 会把真正渲染过的中文（含 systems/ 动态文案）
       也并进导出表，所以就算这里漏扫某文件，只要那句真在界面出现过，导出时也不会丢。 */
import fs from 'fs';
import path from 'path';

// 扫 components + App + store（UI 枚举）。systems/ 多是提示词/逻辑，交给运行时 SEEN 捕获真渲染的，避免大量提示词噪声。
const ROOTS = ['src/components', 'src/store', 'src/App.tsx', 'src/systems/equipSlots.ts'];   // + 枚举标签源(装备槽等·纯数据文件)
const SKIP_FILE = /promptRules|worldCodexModules|abyssPrompts|joyWorldBook|casinoBattleWb|\.test\.|\.d\.ts$|vite-env/;

const files = [];
function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  if (!/\.(tsx|ts)$/.test(p) || SKIP_FILE.test(p)) return;
  files.push(p);
}
for (const r of ROOTS) if (fs.existsSync(r)) walk(r);

const CJK = /[㐀-鿿]/;
// 噪声：代码字面量/属性访问/正则/模板/提示词碎片
const NOISE = /[{}$`<>\\=]|json|JSON|\{\{|\*\*|http|function|return|import|const |=>|prompt|\|\||\.test\(|\.split\(|\.map\(|\.replace\(|talent|realm|npcTag|slot/i;
const set = new Set();
function add(raw) {
  const s = (raw || '').trim();
  if (!s || !CJK.test(s)) return;
  if (s.length > 120) return;                         // 标签/短句 + 面板整段说明文案（长描述也收，交给词库整串翻）
  if (NOISE.test(s)) return;
  if (/^[，。、；：,.\/|·—-]/.test(s)) return;          // 标点/分隔开头=代码或正文碎片
  if (/^\d/.test(s)) return;                          // 数字开头=数值/公式/概率碎片
  if (/[a-z]\.[a-z]/i.test(s)) return;                // 属性访问 d.talent
  if (/\/[^/]{1,20}\/\./.test(s)) return;             // 正则字面量 /宝石/.test
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  if (latin > s.length * 0.5 && s.length > 6) return; // 半数以上拉丁字母=代码
  const core = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');   // 去首尾装饰，对齐词库 key
  if (!core || !CJK.test(core)) return;
  set.add(core);
}

for (const file of files) {
  const t = fs.readFileSync(file, 'utf8');
  for (const m of t.matchAll(/[>}]([^<>{}\n]{1,120})(?=[<{])/g)) add(m[1]);           // JSX 文本（含 >文本{expr} 与 {expr}文本< 之间的片段，如「🎁 开启宝箱{…}」「…{n} 只)」；含面板整段说明）
  for (const m of t.matchAll(/^[ \t]+(?![/*])([^\s<>{}][^<>{}\n]{0,119}?)(?=\s*[<{]|\s*$)/gm)) add(m[1]);   // 多行 JSX 文本：标签在上一行、文本自成一行缩进（如 button 里独占一行的「开始战斗」「普通升级」）；非注释行·add() 再滤代码
  for (const m of t.matchAll(/(?:title|label|desc|placeholder|aria-label|alt|header|text|tip|tooltip|confirmText|cancelText|emptyText|name)\s*[:=]\s*["']([^"'\n]{1,120})["']/g)) add(m[1]);   // 属性标签(JSX label= 与对象字面量 label: 都收，抓装备槽等枚举 + 长 placeholder 说明)
  for (const m of t.matchAll(/["']([^"'\n]{1,30})["']/g)) add(m[1]);                // 短字符串字面量
}

const arr = [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans'));
const out = process.argv[2] || 'public/ui-strings.json';
fs.writeFileSync(out, JSON.stringify(arr, null, 0), 'utf8');
console.log('ui strings:', arr.length, '→', out);
