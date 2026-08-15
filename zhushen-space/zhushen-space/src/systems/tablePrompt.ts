/* ── 表格数据库 · 填表提示词构建（AI 维护的 4 张剧情记忆表）─────────────────
   1c 后其余镜像表由引擎每回合从 store 自动派生，AI 只负责 4 张剧情记忆表：
   纪要表（编年史·只追加）+ 进程/伏笔/约定表（可 insert/update）。
   填表提示词 = TABLE_FILL_RULE（规则+示例）
             + 纪要表最近几行（续写连贯、避免重复记同一段）
             + 进程/伏笔/约定表的当前数据（带 0 基行号，供 AI 判 update-vs-insert）。
   设计文档：`指导/ACU星数据库-移植-设计.md` §3 + §6 Step 5 / 1c。 */
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useChronicle } from '../store/chronicleStore';
import { useMisc } from '../store/miscStore';
import { useSettings } from '../store/settingsStore';
import {
  isCustomSheet, type AcuSheet,
  CHRONICLE_UID, BIG_SUMMARY_UID, BIG_SUMMARY_THRESHOLD,
  visibleChronicleRows, planChronicleCompaction,
} from './acuTableSpec';
import { TABLE_FILL_RULE } from '../promptRules';
import { getPrompt } from '../store/promptOverrideStore';   // 预设中心：玩家可覆盖填表规则，留空回退内置常量

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

/** 一张跟踪表 →「[编号] 列=值 …」清单（[ ] 内=row_id·行的永久编号，updateRow 照抄它）；空表给新增提示。
   🔒=玩家锁定行：AI 改删会被引擎拒收，提示词里直接打标让它别浪费尝试。 */
function dumpTracker(uid: string, name: string): string {
  const sheet = useTables.getState().getSheet(uid);
  const headers = (sheet?.content[0] ?? []).slice(1);
  const dataRows = sheet?.content.slice(1) ?? [];
  const locked = new Set(sheet?.lockedRowIds ?? []);
  const body = dataRows.length === 0
    ? '  （暂无·按需 insertRow 新增）'
    : dataRows.map((row, ri) => `  [${row[0] || ri}]${locked.has(row[0] ?? '') ? '🔒' : ''} ${fmtRow(headers, row) || '（空）'}`).join('\n');
  const lockNote = dataRows.some((row) => locked.has(row[0] ?? '')) ? '；🔒=玩家锁定行，**禁止 updateRow/deleteRow**' : '';
  return `## ${name}·当前（改已有条目用 updateRow(表, 行号, {...})·行号=[ ] 里的编号，是该行的**永久编号**·照抄即可，别自己数位置${lockNote}）\n${body}`;
}

/** 一张用户自定义表 →「## 表名（自定义·AI 维护）+【维护规则】note +【当前数据】带行号」。
   note 是玩家写的**固定维护规则**——只给 AI 看、AI 只改行不改 note（防篡改）；空表给新增提示。 */
function dumpCustomTable(sheet: AcuSheet): string {
  const headers = (sheet.content[0] ?? []).slice(1);
  const dataRows = sheet.content.slice(1);
  const locked = new Set(sheet.lockedRowIds ?? []);
  const kind = sheet.single ? '单行·只 updateRow("' + sheet.name + '", 0, {...})' : '多行·insertRow/updateRow(行号=[ ]内编号)/deleteRow(同)';
  const body = dataRows.length === 0
    ? '  （暂无数据·按维护规则需要时 insertRow 新增）'
    : dataRows.map((row, ri) => `  [${row[0] || ri}]${locked.has(row[0] ?? '') ? '🔒' : ''} ${fmtRow(headers, row) || '（空）'}`).join('\n');
  const lockNote = dataRows.some((row) => locked.has(row[0] ?? '')) ? '·🔒=玩家锁定行禁止改删' : '';
  return `## ${sheet.name}（用户自定义·AI 维护·${kind}）\n【维护规则·必须遵守】${sheet.sourceData.note || '（未填）'}\n【当前数据·列：${headers.join('/')}·[ ] 内=行的永久编号·照抄${lockNote}】\n${body}`;
}

/** 纪要召回语料（借鉴 ACU 交火模式·喂 factVec 向量记忆池）：
   · chronicleRows = 全部纪要行——**含已被大总结压实折叠的行**（"离开上下文但向量仍能按需捞回"正是压实的另一半），
     只排除最近 excludeRecent 行（它们大概率还在最近楼层窗口里，召回是重复）。
   · bigSummaries = 除最近 2 条外的大总结（最近 2 条已固定注入正文，池里只放更早的、会掉出注入窗的）。 */
export function chronicleRecallCorpus(excludeRecent = 3): { chronicleRows: { time: string; location: string; text: string }[]; bigSummaries: string[] } {
  const T = useTables.getState();
  const all = T.getSheet(CHRONICLE_UID)?.content.slice(1) ?? [];
  const chronicleRows = all.slice(0, Math.max(0, all.length - excludeRecent))
    .map((r) => ({ time: r[1] ?? '', location: r[2] ?? '', text: (r[3] ?? '').trim() }))
    .filter((r) => r.text);
  const bigAll = (T.getSheet(BIG_SUMMARY_UID)?.content.slice(1) ?? []).map((r) => String(r[1] ?? '').trim()).filter(Boolean);
  return { chronicleRows, bigSummaries: bigAll.slice(0, Math.max(0, bigAll.length - 2)) };
}

/** 填表积压检测（借鉴 ACU 仪表盘 overdue：「表已到触发点但更新楼层没前进」）：
   最后一条纪要的记账回合（chronicleStore.rowMeta 旁路索引） vs 当前回合（misc.turnCount）。
   gap ≥ 填表调度 everyN + 3 → 判积压（留一次调度周期 + 2 回合余量，不误报）。
   有纪要但全查不到回合索引（老档无 rowMeta）→ 返回 null：不知道就不报。 */
export function chronicleFillBacklog(): { gap: number; lastTurn: number; turnNow: number; threshold: number; overdue: boolean } | null {
  const turnNow = useMisc.getState().turnCount ?? 0;
  const everyN = Math.max(1, useSettings.getState().tableFill?.everyN ?? 1);
  const threshold = everyN + 3;
  const rows = useTables.getState().getSheet(CHRONICLE_UID)?.content.slice(1) ?? [];
  const meta = useChronicle.getState().rowMeta;
  let lastTurn = -1;
  for (let i = rows.length - 1; i >= 0 && i >= rows.length - 10; i--) {   // 只回看末10行（够了·别扫全表）
    const t = meta[String(rows[i][0] ?? '')]?.turn;
    if (typeof t === 'number') { lastTurn = t; break; }
  }
  if (lastTurn < 0) {
    if (rows.length > 0) return null;   // 有纪要但无回合索引（老档）→ 不误报
    lastTurn = 0;                       // 纪要全空：从 0 起算（新档 threshold 回合内不打扰）
  }
  const gap = Math.max(0, turnNow - lastTurn);
  return { gap, lastTurn, turnNow, threshold, overdue: gap >= threshold };
}

/** 剧情状态快照（供「剧情指导」导演做状态感知）：纪要表最近几条 + 进程/伏笔/约定表当前非空行。
   与填表提示词共用渲染，但不含填表规则、只给状态；全空→''（导演照旧只看最近5楼）。 */
export function buildPlotStateSnapshot(): string {
  const T = useTables.getState();
  const parts: string[] = [];
  // 最近一条大总结（早期剧情的压缩记忆）先于最近纪要——导演拿它衔接长线，不至于只见最近5楼
  const bigRows = T.getSheet(BIG_SUMMARY_UID)?.content.slice(1) ?? [];
  const lastBig = bigRows.length ? String(bigRows[bigRows.length - 1][1] ?? '').trim() : '';
  if (lastBig) parts.push(`【大总结·最近（早期剧情归纳）】\n· ${lastBig}`);
  const chron = T.getSheet(CHRONICLE_UID);
  const chronHeaders = (chron?.content[0] ?? []).slice(1);
  const recent = visibleChronicleRows(chron).slice(-RECENT_N).map((row) => fmtRow(chronHeaders, row)).filter(Boolean);
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
  const parts: string[] = [getPrompt('TABLE_FILL_RULE', TABLE_FILL_RULE)];   // 预设中心可覆盖·留空回退内置
  if (want(CHRONICLE_UID)) {
    const chron = useTables.getState().getSheet(CHRONICLE_UID);
    const chronHeaders = (chron?.content[0] ?? []).slice(1);
    const recent = visibleChronicleRows(chron).slice(-RECENT_N);   // 已压实行不回显（大总结替它们说话）
    const recentText = recent.length === 0
      ? '  （暂无·本段可记第一条）'
      : recent.map((row) => `  · ${fmtRow(chronHeaders, row) || '（空）'}`).join('\n');
    parts.push(`## 纪要表·最近记录（续写用·勿重复记同一段）\n${recentText}`);
    // ── 大总结·压实点名（借鉴 ACU 飞行模式）：可见纪要满阈值 → 本批必须归纳最早一段成一行大总结。
    //    写路径（tableEditParser）按同一 planChronicleCompaction 公式重算并推水位线；没点名时写大总结会被确定性拒绝。
    const plan = planChronicleCompaction(chron);
    if (plan) {
      const bigSheet = useTables.getState().getSheet(BIG_SUMMARY_UID);
      const bigTail = (bigSheet?.content.slice(1) ?? []).slice(-2)
        .map((row) => `  · ${String(row[1] ?? '').trim() || '（空）'}`).join('\n');
      const listed = plan.rows.map((row) => `  [${row[0]}] ${fmtRow(chronHeaders, row) || '（空）'}`).join('\n');
      parts.push(`## ⚠ 大总结·本回合归纳（系统触发·必须执行）
可见纪要已满 ${BIG_SUMMARY_THRESHOLD} 条。本批指令中**必须**对「大总结表」insertRow **恰好一行**，把下面这 ${plan.rows.length} 条最早的纪要完整归纳成一段大总结：
${listed}
${bigTail ? `【已有大总结·最近（新总结必须与其在时间顺序/因果/人物状态上衔接连贯，不得矛盾）】\n${bigTail}\n` : ''}归纳纪律：
- **完整归纳上面列出的全部条目**——不许只挑重点、不许遗漏会改变整体脉络的事实；按时间顺序写成连贯的一段话。
- 格式：insertRow("大总结表", {"总结":"……"})　←只填「总结」列；「覆盖纪要」由系统自动记，**勿填**。
- 禁止：修改/删除任何已有大总结；一批写多条大总结。
- 归纳后这些纪要会被系统折叠（数据仍保留），后续续写靠 大总结+最近纪要 衔接。本回合其余表照常维护。`);
    }
  }
  const trackers = TRACKER_TABLES.filter(([uid]) => want(uid)).map(([uid, name]) => dumpTracker(uid, name)).join('\n\n');
  if (trackers) parts.push(trackers);
  // 用户自定义 AI 维护表（uid custom:*）：连同各自「维护规则」(note) 注入，让 AI 据规则维护其行。规则固定、AI 只改行。
  const customSheets = useTables.getState().sortedSheets().filter(isCustomSheet);
  if (customSheets.length) {
    parts.push(`# 用户自定义表（各按其【维护规则】维护·行=可变值随剧情更新、维护规则固定不许改）\n${customSheets.map(dumpCustomTable).join('\n\n')}`);
  }
  // 失败回喂：上一批填表有指令没应用成功 → 把失败清单交给 AI 本回合修正补写（零额外 API 调用的自纠闭环）。
  //   成功批会把 lastErrors 清空，故此块只在真有遗留失败时出现。
  const { lastErrors, lastErrorsTurn } = useTableJournal.getState();
  if (lastErrors.length) {
    parts.push(`## ⚠ 上回合填表失败清单（第 ${lastErrorsTurn} 回合·这些指令**没有生效**，对应内容仍缺失——本回合请修正后补写）\n${lastErrors.map((e) => `- ${e}`).join('\n')}\n（常见原因：表名/行号写错、JSON 引号或逗号缺失。改已有行时，行号照抄上方清单 [ ] 里的编号。）`);
  }
  return parts.join('\n\n');
}
