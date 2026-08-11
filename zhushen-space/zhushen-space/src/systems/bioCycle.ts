/* ════════════════════════════════════════════
   🌸 生理周期·确定性引擎（借鉴 色色灵感状态栏V3.2 的经期孕育系统）
   - 纯前端推算：世界时间 → 绝对日序 → 周期相位/孕周/预产/产后；种子+日序 → 当日基调（零 API·可复现）；
   - 注入只给「状态底色 + 描写参考」，绝不让 AI 算数，也不把生理术语推成剧情话题；
   - 全局开关关 / 日序解析不出 / 无在场启用角色 → 空注入零 token。
   数据在 store/bioCycleStore.ts；管理面板 components/BioCyclePanel.tsx。
════════════════════════════════════════════ */
import { parseWorldTime } from './evoGuard';
import { useBioCycle, type BioProfile } from '../store/bioCycleStore';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';

/* ── 日序：worldTime → 绝对天数（虚构历法近似：年×360 + (月-1)×30 + 日）。
   只有「第N日」→ 直接用 N；什么都抠不出 → null（引擎休眠）。 */
export function worldDayIndex(worldTime: string | undefined): number | null {
  const p = parseWorldTime(worldTime);
  if (p.md) return (p.year ?? 0) * 360 + (p.md.month - 1) * 30 + p.md.day;
  if (p.seq != null) return p.seq;
  return null;
}

export type CyclePhase = '经期' | '卵泡期' | '排卵期' | '黄体期';

export interface CycleState {
  phase: CyclePhase;
  dayOfPeriod: number | null;   // 经期第几天（非经期=null）
  daysIntoCycle: number;        // 周期第几天（1 起）
  cycleLen: number;
  nextPeriodInDays: number;     // 距下次来潮
  fertile: boolean;             // 排卵窗口（±2天）
}

export function cycleStateOf(p: BioProfile, dayIndex: number): CycleState {
  const cycleLen = Math.max(21, Math.min(45, p.cycleLen || 28));
  const periodLen = Math.max(2, Math.min(10, p.periodLen || 5));
  const delta = Math.max(0, dayIndex - (p.lastPeriodStartDay || 0));
  const into = delta % cycleLen;                    // 0 起
  const ovu = cycleLen - 14;                        // 排卵日（黄体期恒定14天的生理常识近似）
  const phase: CyclePhase = into < periodLen ? '经期' : Math.abs(into - ovu) <= 2 ? '排卵期' : into < ovu - 2 ? '卵泡期' : '黄体期';
  return {
    phase,
    dayOfPeriod: phase === '经期' ? into + 1 : null,
    daysIntoCycle: into + 1,
    cycleLen,
    nextPeriodInDays: cycleLen - into,
    fertile: Math.abs(into - ovu) <= 2,
  };
}

export const GESTATION_DAYS = 280;   // 40 周
export const POSTPARTUM_DAYS = 42;   // 产后恢复

export interface PregnancyState {
  weeks: number;
  trimester: 1 | 2 | 3;
  dueInDays: number;            // 负数=已过预产
  postpartumDay: number | null; // 产后第几天（仍在孕程内=null）
}

export function pregnancyStateOf(p: BioProfile, dayIndex: number): PregnancyState | null {
  if (!p.pregnant) return null;
  const days = dayIndex - p.pregnant.sinceDay;
  if (days < 0) return null;
  if (days > GESTATION_DAYS) {
    const pp = days - GESTATION_DAYS;
    if (pp > POSTPARTUM_DAYS) return null;   // 恢复期结束=状态自然消失（档案上 pregnant 仍在，管理面板可清）
    return { weeks: 40, trimester: 3, dueInDays: GESTATION_DAYS - days, postpartumDay: pp };
  }
  const weeks = Math.floor(days / 7);
  return { weeks, trimester: weeks < 14 ? 1 : weeks < 28 ? 2 : 3, dueInDays: GESTATION_DAYS - days, postpartumDay: null };
}

/* ── 种子日基调（借鉴V3.2：seed+day 确定性抽签·同日重算结果不变） ── */
const MOODS: Record<CyclePhase, { base: string[]; extra: string[] }> = {
  经期:   { base: ['倦怠', '畏寒', '嗜睡', '恹恹', '低气压'], extra: ['小腹坠痛', '腰酸', '偏头痛', '想吃甜食', '食欲不振', '贪恋温热'] },
  卵泡期: { base: ['轻快', '精神饱满', '状态平稳', '心情爽利'], extra: [] },
  排卵期: { base: ['气色极佳', '情绪高涨', '格外黏人', '感官敏锐'], extra: [] },
  黄体期: { base: ['易感疲惫', '情绪起伏', '胃口大开', '有些浮肿', '敏感易恼'], extra: ['犯困', '想独处'] },
};

function hashInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** 当日基调（确定性）：基调必有；附加按 40% 概率带一条（同样确定性）。 */
export function dailyMood(seed: string, dayIndex: number, phase: CyclePhase): { base: string; extra: string | null } {
  const t = MOODS[phase];
  const h = hashInt(`${seed}#${dayIndex}#${phase}`);
  const base = t.base[h % t.base.length];
  const extra = t.extra.length && (h >> 8) % 10 < 4 ? t.extra[(h >> 16) % t.extra.length] : null;
  return { base, extra };
}

/* ── 注入块：在场且启用的角色各一行（cap 4）。全局关/日序不明/无人=[]（零 token）。 ── */
export function buildBioInjection(): { role: 'system'; content: string }[] {
  try {
    const S = useBioCycle.getState();
    if (!S.enabled) return [];
    const day = worldDayIndex(useMisc.getState().worldTime);
    if (day == null) return [];
    const npcs = useNpc.getState().npcs;
    const lines: string[] = [];
    for (const [id, prof] of Object.entries(S.chars)) {
      if (lines.length >= 4) break;
      if (!prof?.on) continue;
      const n: any = npcs[id];
      if (!n || !n.onScene || n.isDead) continue;
      const name = String(n.name || id).split('|')[0].trim();
      const preg = pregnancyStateOf(prof, day);
      if (preg) {
        if (preg.postpartumDay != null) {
          lines.push(`· ${name}：产后第 ${preg.postpartumDay} 天·恢复期——需静养、避免剧烈、情绪需平复`);
        } else {
          const stage = preg.trimester === 1 ? '孕早期' : preg.trimester === 2 ? '孕中期' : '孕晚期';
          const hint = preg.trimester === 1 ? '体态未显·易倦嗜睡、晨间不适' : preg.trimester === 2 ? '小腹渐显·状态平稳、偶有胎动' : '行动渐重·易腰酸浮肿、需人照拂';
          lines.push(`· ${name}：孕 ${preg.weeks} 周·${stage}（距预产约 ${Math.max(0, preg.dueInDays)} 天）——${hint}`);
        }
        continue;
      }
      const c = cycleStateOf(prof, day);
      const mood = dailyMood(id, day, c.phase);
      const head = c.phase === '经期' ? `经期第 ${c.dayOfPeriod} 天` : `${c.phase}（周期第 ${c.daysIntoCycle}/${c.cycleLen} 天）`;
      lines.push(`· ${name}：${head}·基调「${mood.base}」${mood.extra ? `·${mood.extra}` : ''}`);
    }
    if (!lines.length) return [];
    return [{
      role: 'system' as const,
      content: `【在场角色·生理周期参考（幕后设定·由系统按世界时间推算）】\n${lines.join('\n')}\n—— 只作为该角色今日状态的**底色**轻描淡写（气色/精力/情绪/小动作），除非剧情主动谈及，否则不点破生理术语、不当成公开话题、不改变既定剧情走向。`,
    }];
  } catch { return []; }
}
