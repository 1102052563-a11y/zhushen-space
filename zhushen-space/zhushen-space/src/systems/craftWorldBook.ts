import type { WorldBook } from '../store/settingsStore';

/* 合成图鉴世界书 → 注入合成工坊「产物生成」(runCraftPhase) 的 system 提示词。
   注入规则与正文/欢愉宫/赌场战斗一致：constant=蓝灯·常驻必注入；selective && key 命中 matchCtx=绿灯·关键词触发。
   matchCtx = 当前门类关键词种子(mode.wbSeed) + 投入材料名/分类 + 玩家倾向，lowercased。 */

/** 选中本次要注入的条目（蓝灯常驻 + 绿灯关键词命中），按 order 排序。 */
export function selectCraftWbEntries(books: WorldBook[], matchCtx: string) {
  const ctx = (matchCtx || '').toLowerCase();
  return (books ?? [])
    .filter((b) => b.enabled)
    .flatMap((b) => b.entries.filter((e) =>
      e.enabled && (
        e.constant ||                                                           // 蓝灯：常驻
        (e.selective && e.key.some((k) => k && ctx.includes(k.toLowerCase())))   // 绿灯：关键词触发
      )
    ))
    .sort((a, b) => a.order - b.order);
}

/** 拼成注入文本（追加在 CRAFT_RULE 之后）。无可注入条目则返回空串。 */
export function buildCraftWbInjection(books: WorldBook[], matchCtx: string): string {
  const entries = selectCraftWbEntries(books, matchCtx);
  if (!entries.length) return '';
  const body = entries.map((e) => `▸ ${e.comment}\n${e.content}`).join('\n\n');
  return `# 合成图鉴（世界书 · 生成产物时务必遵循下面的工艺/守恒/风味指引；这是设定与写作指引，勿照抄标题或复述本段）\n${body}`;
}
