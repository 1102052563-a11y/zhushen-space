// 助战卡分类：8 类固定枚举 + 按职业/技能关键词自动推断（上传者可在面板下拉里手动改）。
// 与后端 multiplayer-worker/src/AssistDO.js 的 CATEGORIES 白名单保持一致。
import type { AssistSnapshot } from './assistProtocol';

export const ASSIST_CATEGORIES = ['近战', '远程', '法师', '辅助', '坦克', '召唤', '刺客', '全能'] as const;
export type AssistCategory = typeof ASSIST_CATEGORIES[number];

export const CATEGORY_EMOJI: Record<string, string> = {
  近战: '⚔️', 远程: '🏹', 法师: '🔮', 辅助: '💖', 坦克: '🛡️', 召唤: '🐾', 刺客: '🗡️', 全能: '✨',
};

// 关键词 → 分类（按优先级从上到下匹配；命中即定）。
const RULES: { cat: AssistCategory; re: RegExp }[] = [
  { cat: '坦克', re: /(坦克|护盾|守护|防御|铁壁|嘲讽|重甲|盾)/ },
  { cat: '辅助', re: /(治疗|医疗|医师|药剂|奶|牧师|辅助|加持|增益|治愈|圣疗|回复|祝福)/ },
  { cat: '召唤', re: /(召唤|御兽|驭兽|傀儡|尸傀|亡灵|操控|分身|宠物|养蛊)/ },
  { cat: '刺客', re: /(刺客|暗杀|潜行|盗贼|忍|背刺|暗影|匕首|毒刃)/ },
  { cat: '法师', re: /(法师|术士|巫|魔法|咒|元素|冰|火|雷|灵能|秘术|施法|符咒|阵法|道术)/ },
  { cat: '远程', re: /(弓|箭|枪手|铳|火铳|狙|射|远程|投掷|飞镖|炮)/ },
  { cat: '近战', re: /(近战|剑|刀|拳|枪法|战士|武者|斗士|格斗|肉搏|重击|蛮力|武僧|剑客|刀客)/ },
];

/** 按 职业 + 技能/天赋名 自动推断分类；命中不到回落「全能」。 */
export function inferCategory(snap: AssistSnapshot | null | undefined): AssistCategory {
  if (!snap) return '全能';
  const hay = [
    snap.profession || '',
    ...(snap.skills || []).map((s: any) => `${s?.name || ''} ${s?.desc || ''} ${s?.effect || ''}`),
    ...(snap.traits || []).map((t: any) => `${t?.name || ''} ${t?.desc || ''} ${t?.effect || ''}`),
  ].join(' ');
  for (const { cat, re } of RULES) if (re.test(hay)) return cat;
  return '全能';
}
