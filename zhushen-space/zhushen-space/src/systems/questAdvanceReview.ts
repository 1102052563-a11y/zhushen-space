import type { MiscTask } from '../store/miscStore';
import { lenientJsonParse } from './stateParser';
import { logArbitration } from './npcGrowthGuard';
import { isSuccessSettleStatus } from './questGuard';

/* 任务推进复核裁判（questAdvanceReview·治"AI 太媚 user，看半截要求就推进度"的语义层防线）
 *
 * 定位：questGuard 的环推进闸门是确定性检查（证据引用真实性/限幅/单向/结算闸），但它读不懂语义——
 *   AI 引用一句真实存在、却只证明"部分进展"的正文，确定性闸拦不住。本模块在任务演化回复落库前，
 *   把其中的「推进/跳环/整条结算」主张抽出来，再调一次任务 API 当**复核裁判**：逐要件拆目标、
 *   逐件找"已完成级"证据，任何一件缺证据即 FAIL。裁判看不到玩家期待、没有讨好压力，只对正文事实负责。
 * 成本：仅在 AI 试图推进的回合才多一次调用（多数回合任务无变动，零成本）。
 * 失败语义：裁判 API 出错/输出解析不了 → fail-open 放行原回复（确定性闸门仍兜底），绝不因裁判故障卡死推进。
 * 被驳回的主张：整行剔除；环推进类若带 summary 则改写成 progress 更新（信息不丢），并记回合洞察仲裁日志。
 */

export interface AdvanceClaim {
  rawLine: string;                       // <upstore> 里的原始指令行（trim 后，用于回执时定位/剔除）
  id: string;                            // T_x
  kind: 'ring' | 'jump' | 'settle';
  taskName: string;
  goal: string;                          // 被主张达成的目标（当前环 goal / 被翻环 goal 列表 / 终局），选择点场景会改写成"核验表态"判据
  evidence?: string;
  summary?: string;
  progress?: string;                     // 该任务已记录的进度（此前回合确认过的实际进展）——环目标跨多回合完成时，早先要件可采信它
}

/* 「见好就收/继续赌」选择点：active 环=最后一个强制环、其余强制环全 done/skipped、后面还有 planned 贪婪环。
   此时终局环的达成发生在此前回合（规则④要求先呈现选择、不许当轮自动推进），本回合正文只会有主角的表态——
   对这种推进/结算主张，判据改成"核验主角明确的接受(继续)/收手(结算)表态"，不再要求终局战斗证据重现。 */
function atGreedyChoicePoint(t: MiscTask): boolean {
  if (!Array.isArray(t.rings) || !t.rings.length) return false;
  const active = t.rings.find((r) => r.status === 'active');
  if (!active || active.optional) return false;
  const forced = t.rings.filter((r) => !r.optional);
  const lastForcedIdx = Math.max(...forced.map((r) => r.idx));
  if (active.idx !== lastForcedIdx) return false;
  if (!forced.every((r) => r.idx === active.idx || r.status === 'done' || r.status === 'skipped')) return false;
  return t.rings.some((r) => r.status === 'planned' && r.optional);
}

const lenientObj = (s: string): any => {
  const v = lenientJsonParse(s);
  return v && typeof v === 'object' ? v : null;
};

/* 从任务演化回复里提取"推进/跳环/整条成功结算"主张（只认既有任务；新建/失败向结算/纯 progress 不复核） */
export function extractAdvanceClaims(reply: string, tasks: MiscTask[]): AdvanceClaim[] {
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  const claims: AdvanceClaim[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;

    if ((m = /^ringAdvance\(\s*"(T_\d+)"\s*(?:,\s*(\{[\s\S]*\})\s*)?\)$/.exec(line))) {
      const t = tasks.find((x) => x.id === m![1]);
      if (!t || !Array.isArray(t.rings) || !t.rings.length) continue;   // 无环任务的 ringAdvance 本就 no-op
      const pl = m[2] ? lenientObj(m[2]) : null;
      const active = t.rings.find((r) => r.status === 'active');
      claims.push({
        rawLine: line, id: t.id, kind: 'ring', taskName: t.name,
        goal: atGreedyChoicePoint(t)
          ? `主角在"见好就收/继续赌"选择点明确选择【继续】进贪婪环（终局环「${active?.goal ?? ''}」的达成已在此前回合确认——本回合只核验主角**明确的接受/继续**表态，不要求终局战斗证据重现）`
          : (active?.goal || t.desc || t.name),
        evidence: pl?.evidence ?? pl?.['证据'] ?? pl?.['引用'] ?? undefined,
        summary: pl?.summary ?? pl?.['总结'] ?? pl?.['行为总结'] ?? undefined,
        progress: t.progress || undefined,
      });
      continue;
    }

    let id = ''; let o: any = null;
    if ((m = /^add\(\s*"(T_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) { id = m[1]; o = lenientObj(m[2]); }
    else if ((m = /^set\(\s*(\{[\s\S]*\})\s*\)$/.exec(line))) { o = lenientObj(m[1]); id = typeof o?.['0'] === 'string' ? o['0'] : ''; }
    if (!o || !/^T_\d+$/.test(id)) continue;
    const t = tasks.find((x) => x.id === id);
    if (!t) continue;   // 新建任务不在复核范围（另有布置闸/防乱推守着）

    // 整条成功结算主张（优先级最高：它已隐含"剩余环都达成"）
    if (isSuccessSettleStatus(String(o['5'] ?? ''))) {
      claims.push({
        rawLine: line, id, kind: 'settle', taskName: t.name,
        goal: atGreedyChoicePoint(t)
          ? `主角在"见好就收/继续赌"选择点明确选择【见好就收】离场结算（终局「${t.finale || t.desc || t.name}」的达成已在此前回合确认——本回合只核验主角**明确的收手/离场/结算**表态）`
          : (t.finale || t.desc || t.name),
        progress: t.progress || undefined,
      });
      continue;
    }
    // 跳环主张：载荷把既有环翻成 done/skipped（含把 active 指到后面环的隐式跨越）
    if (Array.isArray(o.rings) && Array.isArray(t.rings) && t.rings.length) {
      const flippedGoals: string[] = [];
      for (const inc of o.rings) {
        const idx = Number(inc?.idx);
        const st = String(inc?.status ?? '');
        if (!Number.isFinite(idx)) continue;
        const prev = t.rings.find((r) => r.idx === idx);
        if (!prev || prev.status === 'done' || prev.status === 'skipped') continue;
        if (/done|已完成|完成|达成/i.test(st)) flippedGoals.push(`环${idx}「${prev.goal}」标 done`);
        else if (/skipped|跳过/i.test(st)) flippedGoals.push(`环${idx}「${prev.goal}」标 skipped`);
        else if (/active|进行中|当前/i.test(st) && prev.status === 'planned') {
          // 把 active 指到后面 → 被跨越的中间环会被归一成 done，一并算进主张
          const cur = t.rings.find((r) => r.status === 'active');
          if (cur && idx > cur.idx) flippedGoals.push(`把 active 从环${cur.idx}跳到环${idx}（跨越的环视为达成）`);
        }
      }
      if (flippedGoals.length) {
        claims.push({ rawLine: line, id, kind: 'jump', taskName: t.name, goal: flippedGoals.join('；'), progress: t.progress || undefined });
      }
    }
  }
  return claims;
}

const KIND_LABEL: Record<AdvanceClaim['kind'], string> = { ring: '环推进', jump: '跳环/环状态', settle: '整条结算' };

export function buildReviewMessages(claims: AdvanceClaim[], narrative: string): { system: string; user: string } {
  const system = `你是「任务推进复核裁判」。唯一职责：核验【本回合正文】的事实是否足以支撑下列每一条任务推进/结算主张。你与叙事无关、与玩家体验无关，不需要"识趣"，只对证据负责。

判定铁则（对每条主张独立执行）：
1. 把该主张的目标拆成**全部要件**——每个并列的动作/对象/条件各算一件（如"潜入据点夺回样本、并护送线人撤离"=潜入/夺回/护送 3 件）。
2. 逐件找**已完成级**证据：只认已经发生、已有结果的事实；「出发/正在/前往/计划/答应/同意/找到线索/取得部分进展/即将/几乎/准备」一律不算达成。
3. 证据来源：优先【本回合正文】；目标跨多回合完成时，**此前回合已完成的要件可采信主张附带的「已记录进度」**——但**临门的最后要件必须在本回合正文有实据**，进度记录本身不能替代本回合的完成事实。
4. **任何一件缺证据或只有部分进展 → 该主张 FAIL**。部分达成≠达成；叙事氛围、角色的自信台词、任务方的口头认可都不是完成证据。
5. 拿不准 → FAIL（推迟一轮无害；误推会污染路线图与结算，代价大得多）。
6. [整条结算]类主张：终局目标本身也必须有完成证据。
7. [跳环/环状态]标 skipped 的主张：不要求"达成"，但正文须有该环**作废/失去意义/被绕过**的明确剧情依据。
8. 主张文本若注明"选择点·只核验表态"：按其注明的判据核验（明确的接受/继续或收手/结算表态），不要求重现此前回合的战斗/达成证据。

输出格式（铁律）：只输出一个 JSON 对象、无任何其他文字：
{"verdicts":[{"i":<主张序号>,"pass":true|false,"reason":"<一句话；FAIL 必须点名缺证据的要件>"}]}`;
  const list = claims.map((c, i) => {
    const parts = [`${i + 1}. [${KIND_LABEL[c.kind]}] 任务「${c.taskName}」(${c.id})：${c.kind === 'settle' ? `主张整条任务成功完成（终局：${c.goal}）` : `主张目标已达成 —— ${c.goal}`}`];
    if (c.evidence) parts.push(`   AI 提交的正文证据引用：「${c.evidence}」`);
    if (c.summary) parts.push(`   AI 提交的行为总结：「${c.summary}」`);
    if (c.progress) parts.push(`   该任务已记录进度（此前回合确认的实际进展）：「${c.progress}」`);
    return parts.join('\n');
  }).join('\n');
  const user = `【本回合正文】\n${narrative}\n\n【待复核主张】（逐条给出 verdict，序号对应 i）\n${list}`;
  return { system, user };
}

/* 解析裁判输出 → i(1-based) → {pass, reason}；解析不出返回 null（fail-open 交给调用方） */
export function parseReviewVerdicts(text: string): Map<number, { pass: boolean; reason: string }> | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  const o = lenientObj(m[0]);
  if (!o || !Array.isArray(o.verdicts)) return null;
  const map = new Map<number, { pass: boolean; reason: string }>();
  for (const v of o.verdicts) {
    const i = Number(v?.i);
    if (!Number.isFinite(i)) continue;
    map.set(i, { pass: v?.pass === true || v?.pass === 'true', reason: String(v?.reason ?? '').trim() });
  }
  return map.size ? map : null;
}

/** 复核主流程：抽主张 → 调裁判 → FAIL 的整行剔除（ring 类带 summary 则改写成 progress 更新）+ 记仲裁日志。
 *  返回过滤后的 reply；无主张/裁判故障/解析失败 → 原样放行（fail-open，确定性闸门仍兜底）。 */
export async function reviewQuestAdvancement(
  reply: string,
  narrative: string,
  tasks: MiscTask[],
  chat: (system: string, user: string) => Promise<string>,
): Promise<string> {
  const claims = extractAdvanceClaims(reply, tasks);
  if (!claims.length) return reply;
  let verdicts: Map<number, { pass: boolean; reason: string }> | null = null;
  try {
    const { system, user } = buildReviewMessages(claims, narrative);
    verdicts = parseReviewVerdicts(await chat(system, user));
  } catch (e) {
    console.warn('[QuestReview] 推进复核调用失败，放行原指令（确定性闸门仍兜底）:', (e as Error)?.message ?? e);
    return reply;
  }
  if (!verdicts) { console.warn('[QuestReview] 裁判输出解析失败，放行原指令'); return reply; }

  // 同一行可能挂多条主张（罕见）：任何一条 FAIL 即整行剔除，理由合并
  const rejected = new Map<string, { claim: AdvanceClaim; reasons: string[] }>();
  claims.forEach((c, idx) => {
    const v = verdicts!.get(idx + 1);
    if (v && v.pass === false) {
      const hit = rejected.get(c.rawLine);
      const reason = v.reason || '要件缺完成证据';
      if (hit) hit.reasons.push(reason);
      else rejected.set(c.rawLine, { claim: c, reasons: [reason] });
    }
  });
  if (!rejected.size) return reply;

  for (const { claim, reasons } of rejected.values()) {
    logArbitration(`任务 ${claim.id}`, `推进复核未通过[${KIND_LABEL[claim.kind]}]：${reasons.join('；')}${claim.kind === 'ring' && claim.summary ? '（已转为进度记录，待正文给出全部要件的完成证据再推进）' : ''}`);
  }
  return reply.split('\n').map((rawLine): string | null => {
    const hit = rejected.get(rawLine.trim());
    if (!hit) return rawLine;
    const { claim } = hit;
    // 环推进被驳回但带行为总结 → 降级成 progress 更新，正文里的实际进展不丢
    if (claim.kind === 'ring' && claim.summary && String(claim.summary).trim()) {
      return `add("${claim.id}",${JSON.stringify({ progress: String(claim.summary).trim() })})`;
    }
    return null;   // 其余被驳回的行整行剔除
  }).filter((l): l is string => l !== null).join('\n');
}
