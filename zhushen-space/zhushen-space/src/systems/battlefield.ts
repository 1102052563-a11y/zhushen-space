/* ════════════════════════════════════════════
   战场词缀（P1·环境入数值）—— 天气/地点关键词 → 确定性推导 0~2 个词缀，
   开战时烘焙进 BattleState.battlefieldAffixes，引擎在四个挂钩点读取：
   ① dealDamage 元素通道倍率 ② tickRoundStart 燃烧/中毒 DoT 与回蓝倍率
   ③ block 护盾获取倍率 ④ rollInitiative 敏捷贡献倍率。
   纯函数、无 store 依赖、可单测；词缀同时写进 BATTLE_RECORD 让润色叙事与数值咬合。
   参考杀戮尖塔"事件/进阶修饰词缀"思路（本体无地形系统）。
════════════════════════════════════════════ */

export interface BattlefieldAffix {
  id: string;
  name: string;
  emoji: string;
  desc: string;                             // 面板 tooltip + 战报效果说明（保持精炼）
  elementMult?: Record<string, number>;     // 元素通道伤害倍率（键=skillElement 返回值：火/水冰/雷/毒/风）
  burnDotMult?: number;                     // 燃烧类 DoT 每回合伤害倍率
  poisonDotMult?: number;                   // 中毒 DoT 每回合伤害倍率
  epRegenMult?: number;                     // 每回合回蓝倍率（含防御姿态的额外回蓝）
  blockMult?: number;                       // block 标签护盾获取量倍率
  agiInitMult?: number;                     // 先攻里敏捷贡献倍率
}

/* ── 词缀注册表（id 唯一；天气表与地点表分开推导、各取首个命中） ── */
const AFFIXES: Record<string, BattlefieldAffix> = {
  rain:    { id: 'rain',    name: '雨幕', emoji: '🌧️', desc: '火系伤害-30%·燃烧每回合减半·雷系+20%', elementMult: { 火: 0.7, 雷: 1.2 }, burnDotMult: 0.5 },
  snow:    { id: 'snow',    name: '霜天', emoji: '❄️', desc: '水冰系伤害+20%·先攻中敏捷贡献-20%', elementMult: { 水冰: 1.2 }, agiInitMult: 0.8 },
  scorch:  { id: 'scorch',  name: '灼日', emoji: '☀️', desc: '火系伤害+20%·燃烧每回合×1.5·水冰系-20%', elementMult: { 火: 1.2, 水冰: 0.8 }, burnDotMult: 1.5 },
  storm:   { id: 'storm',   name: '狂风', emoji: '🌪️', desc: '风系伤害+20%·先攻中敏捷贡献+20%', elementMult: { 风: 1.2 }, agiInitMult: 1.2 },
  fog:     { id: 'fog',     name: '迷雾', emoji: '🌫️', desc: '视线受阻，掩蔽易得：护盾获取+20%', blockMult: 1.2 },
  swamp:   { id: 'swamp',   name: '瘴泽', emoji: '🦠', desc: '毒系伤害+30%·中毒每回合×1.5·先攻中敏捷贡献-20%', elementMult: { 毒: 1.3 }, poisonDotMult: 1.5, agiInitMult: 0.8 },
  ruins:   { id: 'ruins',   name: '断壁', emoji: '🧱', desc: '残垣掩体充足：护盾获取+20%', blockMult: 1.2 },
  ley:     { id: 'ley',     name: '灵潮', emoji: '✨', desc: '能量充沛：每回合回蓝×1.5', epRegenMult: 1.5 },
  barren:  { id: 'barren',  name: '荒芜', emoji: '🏜️', desc: '能量枯竭：每回合回蓝×0.7', epRegenMult: 0.7 },
  volcano: { id: 'volcano', name: '熔野', emoji: '🌋', desc: '火系伤害+20%·燃烧每回合×1.5·水冰系-20%', elementMult: { 火: 1.2, 水冰: 0.8 }, burnDotMult: 1.5 },
  water:   { id: 'water',   name: '澜场', emoji: '🌊', desc: '水冰系伤害+20%·火系-30%', elementMult: { 水冰: 1.2, 火: 0.7 } },
};
export const BATTLEFIELD_AFFIXES = AFFIXES;   // 面板/测试可枚举

/* 天气/地点 → 词缀 id（首个命中生效；表驱动、无随机 → 同天气同地点必同词缀） */
const WEATHER_TABLE: [RegExp, string][] = [
  [/暴雨|雷雨|阴雨|细雨|大雨|骤雨|雨/, 'rain'],
  [/暴雪|冰雹|风雪|严寒|大雪|雪/, 'snow'],
  [/烈日|酷暑|干旱|炎热|骄阳|热浪/, 'scorch'],
  [/风暴|狂风|台风|飓风|沙暴/, 'storm'],
  [/浓雾|迷雾|大雾|雾/, 'fog'],
];
const LOCATION_TABLE: [RegExp, string][] = [
  [/沼泽|瘴|毒雾|腐沼|泥潭/, 'swamp'],
  [/火山|熔岩|岩浆|炼狱|地火/, 'volcano'],
  [/废墟|断壁|残垣|城区|街巷|巷战|工事|堡垒|要塞/, 'ruins'],
  [/灵脉|灵气|圣地|秘境|神殿|祭坛|灵泉/, 'ley'],
  [/荒漠|沙漠|荒原|戈壁|废土|枯地|焦土/, 'barren'],
  [/深海|海上|水上|河畔|湖畔|海边|水域|河底|湖中/, 'water'],
];

/** 由天气+地点确定性推导战场词缀（≤2 个：天气 1 + 地点 1，去重）。 */
export function deriveBattlefieldAffixes(weather?: string, location?: string): BattlefieldAffix[] {
  const out: BattlefieldAffix[] = [];
  const w = String(weather ?? '');
  const l = String(location ?? '');
  for (const [re, id] of WEATHER_TABLE) if (w && re.test(w)) { out.push(AFFIXES[id]); break; }
  for (const [re, id] of LOCATION_TABLE) if (l && re.test(l)) { const a = AFFIXES[id]; if (!out.some((x) => x.id === a.id)) out.push(a); break; }
  return out;
}

/* ── 技能元素通道嗅探（与 isMagicSkill 同款文本嗅探思路；首个命中生效） ── */
const ELEMENT_TABLE: [RegExp, string][] = [
  [/火|炎|焰|灼|焚|熔|燎/, '火'],
  [/冰|霜|雪|寒|凛|水|潮|浪/, '水冰'],
  [/雷|电|霹雳|闪电/, '雷'],
  [/毒|瘴|腐蚀|酸/, '毒'],
  [/风|飓|旋|岚/, '风'],
];
export function skillElement(text: string): string | null {
  if (!text) return null;
  for (const [re, el] of ELEMENT_TABLE) if (re.test(text)) return el;
  return null;
}

/** 词缀对某技能文本的元素伤害倍率（多词缀取乘积；by=首个生效词缀名，供日志标注）。普攻/无元素 → 1。 */
export function bfElementMult(affixes: BattlefieldAffix[] | undefined, skillText: string): { mult: number; by?: string } {
  if (!affixes?.length || !skillText) return { mult: 1 };
  const el = skillElement(skillText);
  if (!el) return { mult: 1 };
  let mult = 1; let by: string | undefined;
  for (const a of affixes) {
    const m = a.elementMult?.[el];
    if (m != null && m !== 1) { mult *= m; if (!by) by = a.name; }
  }
  return { mult, by };
}

/** 词缀数值键的乘积（burnDotMult/poisonDotMult/epRegenMult/blockMult/agiInitMult）。无词缀=1。 */
export function bfNum(affixes: BattlefieldAffix[] | undefined, key: 'burnDotMult' | 'poisonDotMult' | 'epRegenMult' | 'blockMult' | 'agiInitMult'): number {
  if (!affixes?.length) return 1;
  let m = 1;
  for (const a of affixes) { const v = a[key]; if (v != null) m *= v; }
  return m;
}

/** 战报「环境=」段（空词缀 → null，不占战报字段）。 */
export function bfRecordText(affixes?: BattlefieldAffix[]): string | null {
  if (!affixes?.length) return null;
  return affixes.map((a) => `${a.name}(${a.desc})`).join('、');
}
