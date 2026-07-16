// 世界详情工坊 · 阶位战力图鉴同步器
// 从 世界书/轮回乐园小说.json 抽 uid300「规则：阶位·战力表现图鉴」→ 参考/阶位战力图鉴.md
// 图鉴（正文世界书）更新后重跑本脚本即可同步；参考文件勿手改。
// 用法：node scripts/sync-tier-codex.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');
const SRC = path.join(REPO, '世界书', '轮回乐园小说.json');
const OUT = path.join(ROOT, '参考', '阶位战力图鉴.md');

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const entries = data.entries ? (Array.isArray(data.entries) ? data.entries : Object.values(data.entries)) : [];
const e = entries.find((x) => x.uid === 300);
if (!e || !e.content) { console.error('未在 世界书/轮回乐园小说.json 找到 uid300 阶位·战力图鉴'); process.exit(1); }

const header = `# 阶位战力图鉴（乐园官方标尺 · 写手必读）

> 来源：正文世界书〈轮回乐园小说.json〉uid300「${e.comment || '规则：阶位·战力表现图鉴'}」，由 scripts/sync-tier-codex.mjs 自动同步——**勿手改本文件**，图鉴更新后重跑脚本。
>
> 写手用法：写「乐园阶位映射」和切入点的阶位锚定时，拿该世界各境界/等级的**实际破坏力表现**（能毁一条街？夷平一城？打爆行星？）对照下表各阶的破坏力描述逐档对齐——**宁低勿高**；一~九阶照表落位，「绝强」及以上一律记为**超阶**；原作真实顶点忠实标注、不许压低。

---

`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + e.content + '\n', 'utf8');
console.log(`已同步 → ${path.relative(ROOT, OUT)}（正文 ${e.content.length} 字）`);
