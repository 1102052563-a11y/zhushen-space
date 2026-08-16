import type { WorldBook } from '../store/settingsStore';
import { passActiveWhen } from './tableTemplate';    // 🎯 activeWhen 条件门（与正文世界书同款）
import { buildRuntimeVars } from './runtimeVars';

/* 战斗写作指导世界书 → 注入角斗场/灵魂决斗场「战斗过程生成」(genGladiatorBattle) 的 system 提示词。
   注入规则与正文/欢愉宫一致：constant=蓝灯·常驻必注入；selective && key 命中 matchCtx=绿灯·关键词触发。
   matchCtx = 两名角斗士的种族/职业/风格/技能/天赋/物品名 + 本场特殊桥段，lowercased。 */

/** 选中本场要注入的条目（蓝灯常驻 + 绿灯关键词命中），按 order 排序。 */
export function selectBattleWbEntries(books: WorldBook[], matchCtx: string) {
  const ctx = (matchCtx || '').toLowerCase();
  let vars: Record<string, string> | undefined;   // 🎯 activeWhen 条件门（惰性采集变量·无条件条目=零开销）
  const whenPass = (e: { activeWhen?: string }) => {
    const w = (e.activeWhen || '').trim();
    if (!w) return true;
    if (!vars) vars = buildRuntimeVars();
    return passActiveWhen(w, { seedContent: ctx, vars });
  };
  return (books ?? [])
    .filter((b) => b.enabled)
    .flatMap((b) => b.entries.filter((e) =>
      e.enabled && whenPass(e) && (
        e.constant ||                                                          // 蓝灯：常驻
        (e.selective && e.key.some((k) => k && ctx.includes(k.toLowerCase())))  // 绿灯：关键词触发
      )
    ))
    .sort((a, b) => a.order - b.order);
}

/** 拼成注入文本（追加在 GLADIATOR_BATTLE_RULE 之后）。无可注入条目则返回空串。 */
export function buildBattleWbInjection(books: WorldBook[], matchCtx: string): string {
  const entries = selectBattleWbEntries(books, matchCtx);
  if (!entries.length) return '';
  const body = entries.map((e) => `▸ ${e.comment}\n${e.content}`).join('\n\n');
  return `# 战斗写作指导（世界书 · 务必融入下面的战斗演绎、提升精彩度；这是写作风格指引，勿照抄标题或复述本段）\n${body}`;
}
