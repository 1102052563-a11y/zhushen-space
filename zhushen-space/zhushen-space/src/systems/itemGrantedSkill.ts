import { useItems } from '../store/itemStore';

/* ════════════════════════════════════════════
   「物品附带/待学技能 ≠ 角色已习得技能」代码护栏（systems/itemGrantedSkill.ts）
   配合提示词 ITEM_GRANTED_SKILL_RULE。两类漏点都在这里【机械拦截】：
   ① 装备/法宝 effect 写「附带【X】/装备后可用 X」——随物品走、卸下即失，绝不是角色学会的技能。
   ② 技能卷轴/秘籍/丹药 effect 写「捏碎后/使用后 你将学会【X】」——是"用了才学会"的待学技能，
      刚拿到（没使用）时 AI 常直接把 X 加进技能栏（用户："拿到技能卷轴直接就有技能了，没有使用"）。
   规则：技能名若来自某件物品的附带/待学文本，则默认拦下——
   只有本轮正文在技能名附近出现真正的【获得动作】才放行：
   · 内化成自身本领（内化/炼化入体/参透…不持也能） → 装备类真习得；
   · 使用/消耗了那件物品（捏碎/服下/阅读/激活…）           → 卷轴/秘籍/丹药真习得。
   —— 纯提示词拦不住（AI 会分类错/抢跑），故把纪律下沉成代码守卫。
   仅作用于 AI 解析出的指令；玩家手动加技能 / 技能树 / 融合等直接调 store.addSkill，不受影响。
════════════════════════════════════════════ */

/** 归一化：去掉包裹括号/空白/间隔号/常见标点，便于把「【极乐咏唱】」与「极乐咏唱」视为同名。 */
function norm(s: string): string {
  return String(s ?? '').replace(/[【】\[\]（）()<>《》「」\s·、,，.。!！?？:：;；]/g, '').toLowerCase();
}

/** 物品文本里"把某技能给持有者 / 用了就学会"的触发词（弱信号：需与技能名同时出现才算数）。 */
const GRANT_TRIGGER = /(附带|自带|内置|装备后|装备时|装备者|持有时|持有者|穿戴|佩戴|催动|激活|引动|赋予|可使用|可施展|可释放|能使用|能施展|使用后|施放出|捏碎后|碾碎后|服(?:用|下)后|阅读后|撕开后|你将学会|将可学会|可学会|学会专属|习得专属|学会[^，。；\n]{0,8}技能)/;

/** 正文里"真正获得了这门技能"的动作措辞——命中（且在技能名附近）才放行收录进技能栏：
 *  内化类（装备招式化为己有） + 使用/消耗类（把卷轴·秘籍·丹药用掉/读掉）。 */
const ACQUIRE = /(内化|炼化入体|化为己用|化作己身|真正学会|彻底习得|融会贯通|铭刻入体|烙印于身|自身本领|据为己有|不(?:持|拿|靠|凭|依靠|凭借)[^，。；\n]{0,10}(?:也能|亦能|仍能|依旧能|照样能|一样能)|捏碎|碾碎|捏爆|捏裂|粉碎|撕碎|撕开|揉碎|捻碎|捏破|服下|服用|吞下|吞服|喝下|打碎|激活|阅读|研读|翻阅|参悟|参透)/;

/** 纯函数：技能名是否"来自某件物品的附带/待学文本"。itemTexts = 各物品的文本块（effect/affix/简介/外观）。
 *  判据：① 名字被【】包裹（强信号），或 ② 名字出现在文本里 且 该文本含"附带/装备后/捏碎后学会…"等触发词。 */
export function skillNameIsItemGranted(skillName: string, itemTexts: string[]): boolean {
  const raw = String(skillName ?? '').trim();
  const n = norm(raw);
  if (n.length < 2) return false;                          // 太短（单字）易误伤，不判定
  return itemTexts.some((t) => {
    const text = String(t ?? '');
    if (text.includes(`【${raw}】`)) return true;           // 强信号：名字被【】包裹
    if (!norm(text).includes(n)) return false;
    return GRANT_TRIGGER.test(text);                        // 弱信号：名字出现 + 该物品文本含触发词
  });
}

/** 纯函数：本轮正文是否在"这一个技能名"附近（±60 字）写出了真正的获得动作
 *  （装备招式内化，或把卷轴/秘籍/丹药 使用/消耗掉）。命中则视为真习得、放行。 */
export function narrativeShowsAcquisition(skillName: string, narrative?: string): boolean {
  const name = String(skillName ?? '').trim();
  const nar = String(narrative ?? '');
  if (name.length < 2 || !nar) return false;
  const idx = nar.indexOf(name);
  if (idx < 0) return false;                                // 正文压根没提这个招式名 → 谈不上"这一招刚获得"
  const w = nar.slice(Math.max(0, idx - 60), idx + name.length + 60);
  return ACQUIRE.test(w);
}

/** 收集玩家(itemStore)所有物品里可能写有"附带/待学技能"的文本（装备与背包都算：
 *  装备＝随物品走的附带招，背包＝卷轴/秘籍等"用了才学会"的待学招；两者都不该未触发就进技能栏）。 */
export function itemGrantTexts(): string[] {
  const items = useItems.getState().items ?? [];
  const texts: string[] = [];
  for (const it of items) {
    for (const f of [it.effect, it.affix, it.intro, it.appearance]) if (f) texts.push(String(f));
  }
  return texts;
}

/** 闸门用：主角这条 addSkill 是否该被拦（＝技能来自某件物品的附带/待学文本，且正文没写出真正的获得动作）。 */
export function shouldBlockItemGrantedSkill(skillName: string, narrative?: string): boolean {
  if (narrativeShowsAcquisition(skillName, narrative)) return false;   // 正文明写"内化/用掉了那件物品·学会" → 放行
  return skillNameIsItemGranted(skillName, itemGrantTexts());
}
