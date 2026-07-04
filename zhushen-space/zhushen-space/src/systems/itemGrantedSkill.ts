import { useItems } from '../store/itemStore';

/* ════════════════════════════════════════════
   「物品附带技能 ≠ 角色习得技能」代码护栏（systems/itemGrantedSkill.ts）
   配合提示词 ITEM_GRANTED_SKILL_RULE：装备/法宝的 effect/affix/简介里写的
   「附带【X】/装备后可用 X/催动放出 X」是随物品走的能力，卸下即失。
   AI 演化阶段常把它误当"角色学会了 X"→ addSkill 漏进主角技能栏（"过几楼"才冒出来）。
   这里在 AI 指令闸门里【机械拦截】：技能名若来自某件"已装备"物品的附带文本，
   且本轮正文没有"内化成自身本领"的明确措辞，就不收进技能栏。
   —— 纯提示词拦不住（AI 会分类错），故把纪律下沉成代码守卫。
   仅作用于 AI 解析出的指令；玩家手动加技能 / 技能树 / 融合等直接调 store.addSkill，不受影响。
════════════════════════════════════════════ */

/** 归一化：去掉包裹括号/空白/间隔号/常见标点，便于把「【烈焰斩】」与「烈焰斩」视为同名。 */
function norm(s: string): string {
  return String(s ?? '').replace(/[【】\[\]（）()<>《》「」\s·、,，.。!！?？:：;；]/g, '').toLowerCase();
}

/** 物品文本里"把某技能赋予持有者"的触发词（弱信号：需与技能名同时出现才算数）。 */
const GRANT_TRIGGER = /(附带|自带|内置|装备后|装备时|装备者|持有时|持有者|穿戴|佩戴|催动|激活|引动|赋予|可使用|可施展|可释放|能使用|能施展|使用后可|施放出)/;

/** 正文明确写到"角色把该招内化成了自身本领（脱离物品也会）"的措辞——命中则视为真习得、放行。 */
const INTERNALIZE = /(内化|炼化入体|化为己用|化作己身|真正学会|彻底习得|融会贯通|铭刻入体|烙印于身|自身本领|据为己有|不(?:持|拿|靠|凭|依靠|凭借)[^，。；\n]{0,10}(?:也能|亦能|仍能|依旧能|照样能|一样能))/;

/** 纯函数：技能名是否"来自某件已装备物品的附带能力"。itemTexts = 各已装备物品的文本块（effect/affix/简介/外观）。
 *  判据：① 名字被【】包裹（强信号），或 ② 名字出现在文本里 且 该文本含"附带/装备后/催动…"等赋予触发词。 */
export function skillNameIsItemGranted(skillName: string, itemTexts: string[]): boolean {
  const raw = String(skillName ?? '').trim();
  const n = norm(raw);
  if (n.length < 2) return false;                          // 太短（单字）易误伤，不判定
  return itemTexts.some((t) => {
    const text = String(t ?? '');
    if (text.includes(`【${raw}】`)) return true;           // 强信号：名字被【】包裹
    if (!norm(text).includes(n)) return false;
    return GRANT_TRIGGER.test(text);                        // 弱信号：名字出现 + 该物品文本含赋予触发词
  });
}

/** 纯函数：本轮正文是否明确把"这一个招式"内化成了自身本领（技能名附近 ±50 字出现内化措辞）。 */
export function narrativeInternalizes(skillName: string, narrative?: string): boolean {
  const name = String(skillName ?? '').trim();
  const nar = String(narrative ?? '');
  if (name.length < 2 || !nar) return false;
  const idx = nar.indexOf(name);
  if (idx < 0) return false;                                // 正文压根没提这个招式名 → 谈不上"这一招内化了"
  const w = nar.slice(Math.max(0, idx - 50), idx + name.length + 50);
  return INTERNALIZE.test(w);
}

/** 收集玩家(itemStore)当前【已装备】物品里可能写有"附带技能"的文本。
 *  只看已装备：技能书/背包物不算（避免误伤"读技能书真习得"这类合法学习）。 */
export function equippedItemGrantTexts(): string[] {
  const items = useItems.getState().items ?? [];
  const texts: string[] = [];
  for (const it of items) {
    if (!it.equipped) continue;
    for (const f of [it.effect, it.affix, it.intro, it.appearance]) if (f) texts.push(String(f));
  }
  return texts;
}

/** 闸门用：主角这条 addSkill 是否该被拦（＝技能来自已装备物品的附带能力 且 正文没写"内化成自身本领"）。 */
export function shouldBlockItemGrantedSkill(skillName: string, narrative?: string): boolean {
  if (narrativeInternalizes(skillName, narrative)) return false;   // 正文明写内化成自身本领 → 放行收录
  return skillNameIsItemGranted(skillName, equippedItemGrantTexts());
}
