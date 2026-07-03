/* ── 表格数据库 · 填表提示词构建（AI 维护的 4 张剧情记忆表）─────────────────
   1c 后其余镜像表由引擎每回合从 store 自动派生，AI 只负责 4 张剧情记忆表：
   纪要表（编年史·只追加）+ 进程/伏笔/约定表（可 insert/update）。
   填表提示词 = TABLE_FILL_RULE（规则+示例）
             + 纪要表最近几行（续写连贯、避免重复记同一段）
             + 进程/伏笔/约定表的当前数据（带 0 基行号，供 AI 判 update-vs-insert）。
   设计文档：`指导/ACU星数据库-移植-设计.md` §3 + §6 Step 5 / 1c。 */
import { useTables } from '../store/tableStore';
import { TABLE_FILL_RULE } from '../promptRules';

const CHRONICLE_UID = 'chronicle';   // 纪要表（编年史·只追加）
const RECENT_N = 6;                  // 纪要表只展示最近几条，够续写连贯即可
/** 可更新的剧情记忆表（uid → 中文名）：需带行号给 AI 判 insert-vs-update。 */
const TRACKER_TABLES: [string, string][] = [
  ['progress', '进程表'],
  ['foreshadowing', '伏笔表'],
  ['pacts', '约定表'],
];

/** 一行 content（含 row_id）→「列=值 ｜ …」（跳过空值）。 */
function fmtRow(headers: string[], row: string[]): string {
  return headers.map((h, ci) => (row[ci + 1] ? `${h}=${row[ci + 1]}` : '')).filter(Boolean).join(' ｜ ');
}

/** 一张跟踪表 →「[0] 列=值 …」清单（0 基行号供 updateRow）；空表给新增提示。 */
function dumpTracker(uid: string, name: string): string {
  const sheet = useTables.getState().getSheet(uid);
  const headers = (sheet?.content[0] ?? []).slice(1);
  const dataRows = sheet?.content.slice(1) ?? [];
  const body = dataRows.length === 0
    ? '  （暂无·按需 insertRow 新增）'
    : dataRows.map((row, ri) => `  [${ri}] ${fmtRow(headers, row) || '（空）'}`).join('\n');
  return `## ${name}·当前（改已有条目用 updateRow(表, 行号, {...})·行号=[ ] 里的数字·0基）\n${body}`;
}

/** 剧情状态快照（供「剧情指导」导演做状态感知）：纪要表最近几条 + 进程/伏笔/约定表当前非空行。
   与填表提示词共用渲染，但不含填表规则、只给状态；全空→''（导演照旧只看最近5楼）。 */
export function buildPlotStateSnapshot(): string {
  const T = useTables.getState();
  const parts: string[] = [];
  const chron = T.getSheet(CHRONICLE_UID);
  const chronHeaders = (chron?.content[0] ?? []).slice(1);
  const recent = (chron?.content.slice(1) ?? []).slice(-RECENT_N).map((row) => fmtRow(chronHeaders, row)).filter(Boolean);
  if (recent.length) parts.push(`【纪要·最近】\n${recent.map((s) => `· ${s}`).join('\n')}`);
  for (const [uid, name] of TRACKER_TABLES) {
    const sheet = T.getSheet(uid);
    const headers = (sheet?.content[0] ?? []).slice(1);
    const rows = (sheet?.content.slice(1) ?? []).map((r) => fmtRow(headers, r)).filter(Boolean);
    if (rows.length) parts.push(`【${name}】\n${rows.map((s) => `· ${s}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** 构建填表提示词：TABLE_FILL_RULE + 纪要表最近 N 条 + 进程/伏笔/约定表当前数据。读 tableStore 当前态。
   only=只维护这些表(uid: chronicle/progress/foreshadowing/pacts)；undefined/空=全部（＝原行为）。 */
export function buildTableFillPrompt(only?: string[]): string {
  const want = (uid: string) => !only || only.length === 0 || only.includes(uid);
  const parts: string[] = [TABLE_FILL_RULE];
  if (want(CHRONICLE_UID)) {
    const chron = useTables.getState().getSheet(CHRONICLE_UID);
    const chronHeaders = (chron?.content[0] ?? []).slice(1);
    const recent = (chron?.content.slice(1) ?? []).slice(-RECENT_N);
    const recentText = recent.length === 0
      ? '  （暂无·本段可记第一条）'
      : recent.map((row) => `  · ${fmtRow(chronHeaders, row) || '（空）'}`).join('\n');
    parts.push(`## 纪要表·最近记录（续写用·勿重复记同一段）\n${recentText}`);
  }
  const trackers = TRACKER_TABLES.filter(([uid]) => want(uid)).map(([uid, name]) => dumpTracker(uid, name)).join('\n\n');
  if (trackers) parts.push(trackers);
  return parts.join('\n\n');
}
