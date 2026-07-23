import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useMisc } from '../store/miscStore';

/* ── 剧情护卫：伏笔催收 + 世界真相周期强化（纯提示词机制·零新增 API 调用）──
   借鉴 Talemate 的 World State Reinforcement 与 World-Engine-LLM 的 active threads：
   1. 伏笔催收：伏笔表已有「埋下→发展中→已回收/已废弃」状态机，但没有【账龄】——
      这里从表编辑日志（tableJournalStore）机械算出每行最后触碰回合，把陈旧未收的线头
      拼成 <伏笔催收> 注入正文深处（每回合最多回收一条·允许标废弃），治长线烂尾。
   2. 真相重申：常驻注入会被模型「背景脱敏」（本项目实证：纪要表规则常驻、却曾 190 回合只记几条），
      所以每 TRUTH_PERIOD 回合才把 ≤TRUTH_CAP 条「已确立真相」以新鲜块重申一次——周期性+深位置=重置注意力。
      真相清单由杂项演化阶段用 truths([...]) 覆盖式维护（miscStore.truths / miscParser 解析）。 */

export const FORESHADOW_UID = 'foreshadowing';
export const DUN_AGE = 15;         // 埋下/发展中 且 ≥15 回合未触碰 → 开始催收
export const DUN_URGENT_AGE = 30;  // ≥30 回合 → 升级措辞（建议明确废弃）
export const DUN_MAX = 5;          // 单次最多列 5 条（防注入块膨胀）
export const TRUTH_PERIOD = 6;     // 每 6 回合重申一次真相
export const TRUTH_CAP = 12;       // 真相清单硬上限（miscStore.setTruths 同步裁剪·那边是字面量 12，防循环依赖）

export interface StaleThread {
  rowId: string;
  title: string;
  expect: string;
  age: number | null;   // null=日志已无该行记录（早于 300 条封顶留存期=久远）
}

/* 伏笔表某行最后一次被 insert/update 的回合号；无记录返回 null（久远） */
function lastTouchTurn(rowId: string): number | null {
  const entries = useTableJournal.getState().entries;
  let last: number | null = null;
  for (const e of entries) {
    if (e.uid !== FORESHADOW_UID || e.rowId !== rowId || e.turn < 0) continue;
    if (last === null || e.turn > last) last = e.turn;
  }
  return last;
}

/* 收集陈旧未回收伏笔：状态非「已回收/已废弃」（含留空）且账龄 ≥DUN_AGE 或久远。
   排序：久远(null)最前，其余按账龄降序——最老的债最先催。 */
export function collectStaleThreads(turn: number): StaleThread[] {
  const sheet = useTables.getState().tables[FORESHADOW_UID];
  const rows: string[][] = sheet?.content?.slice(1) ?? [];
  const out: StaleThread[] = [];
  for (const row of rows) {
    const rowId = String(row?.[0] ?? '').trim();
    const title = String(row?.[1] ?? '').trim();
    if (!rowId || !title) continue;
    const state = String(row?.[4] ?? '').trim();
    if (/已回收|已废弃/.test(state)) continue;
    const last = lastTouchTurn(rowId);
    const age = last === null ? null : Math.max(0, turn - last);
    if (age === null || age >= DUN_AGE) out.push({ rowId, title, expect: String(row?.[5] ?? '').trim(), age });
  }
  const w = (t: StaleThread) => (t.age === null ? Number.MAX_SAFE_INTEGER : t.age);
  out.sort((a, b) => w(b) - w(a));
  return out;
}

/** <伏笔催收> 块；无陈旧线头返回 ''（块整个不出现，零 token 浪费）。 */
export function buildForeshadowDunning(turn: number): string {
  const stale = collectStaleThreads(turn);
  if (!stale.length) return '';
  const shown = stale.slice(0, DUN_MAX);
  const lines = shown.map((t) => {
    const ageTxt = t.age === null ? '久远（早于日志留存期）' : `已 ${t.age} 回合`;
    const urgent = t.age === null || t.age >= DUN_URGENT_AGE;
    const expect = t.expect ? `（预期回收：${t.expect}）` : '';
    return `- [${t.rowId}]「${t.title}」：${ageTxt}无进展${expect}${urgent ? ' ——**若再无规划，建议本回合直接标「已废弃」**' : ''}`;
  });
  const more = stale.length > shown.length ? `\n（另有 ${stale.length - shown.length} 条较陈旧未列出，处理完上面的会轮到）` : '';
  return `<伏笔催收>\n（前端按表编辑日志机械核账、非臆测：下列伏笔久无进展。原则——**到火候的才自然回收，一回合最多推进/回收一条**；时机不到就继续养着，绝不为交差硬凑；确认不要的在 <tableEdit> 用 updateRow 把该行「状态」改为「已废弃」并在「说明」补一句缘由。）\n${lines.join('\n')}${more}\n</伏笔催收>`;
}

/** <世界真相·重申> 块；仅每 TRUTH_PERIOD 回合且清单非空时出现。 */
export function buildTruthReinforcement(turn: number): string {
  if (turn <= 0 || turn % TRUTH_PERIOD !== 0) return '';
  const truths = (useMisc.getState().truths ?? []).map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!truths.length) return '';
  const lines = truths.slice(0, TRUTH_CAP).map((t, i) => `${i + 1}. ${t}`);
  return `<世界真相·重申>\n（周期性强化注入·每 ${TRUTH_PERIOD} 回合一次：以下为已确立的关键事实，正文**不得违背**；若角色行为与之冲突，必须给出剧情内的合理理由。这些事实可能很久没被提及——那正是最容易写崩的地方。）\n${lines.join('\n')}\n</世界真相·重申>`;
}

/** 正文注入组装用：两块合一（空块自动省略）；自身绝不抛错、不阻断正文。 */
export function buildPlotGuardInjection(turn: number): { role: 'system'; content: string }[] {
  const out: { role: 'system'; content: string }[] = [];
  try {
    const dun = buildForeshadowDunning(turn);
    if (dun) out.push({ role: 'system', content: dun });
    const truth = buildTruthReinforcement(turn);
    if (truth) out.push({ role: 'system', content: truth });
  } catch (e) { console.warn('[plotGuard] 注入构建失败（跳过·不阻断正文）：', e); }
  return out;
}

/* 杂项演化阶段的清单维护规则（拼进杂项 systemPrompt；数据经 miscParser 的 truths(...) 指令落库） */
export const TRUTHS_MAINTAIN_RULE = `【已确立真相清单·维护规则（「世界真相周期强化注入」的数据源）】
- 用 truths(["事实1","事实2",...]) **单行·覆盖式**维护一个 ≤${TRUTH_CAP} 条的清单：只收「一旦违背，读者会觉得崩设定」的硬事实——身份秘密及知情人范围、誓言与债、身体特征/伤残、世界铁律、重大死亡。
- 每条 ≤40 字、写成可判定的陈述句（谁+什么，如「凯莉知道主角是契约者，其余土著不知」）；剧情进展/情绪变化不进清单（那是纪要表的事）；任务与数值也不进（各有其表）。
- 满 ${TRUTH_CAP} 条还要新增时，先合并或淘汰最不再要紧的；离开某任务世界后，该世界专属铁律应从清单移除（跨世界长线如主角自身之谜、乐园层面的秘密保留）。
- 清单无变化就**不输出** truths 指令。`;
