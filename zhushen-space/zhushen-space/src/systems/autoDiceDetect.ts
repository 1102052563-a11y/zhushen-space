import type { AttrKey, Difficulty } from './diceEngine';

/* ════════════════════════════════════════════
   自动检定·关键词门（纯函数·零 store/DOM 依赖 → 可单测）
   - detectAutoAction：扫用户输入的动作动词 → 命中判定属性；未命中=日常/闲聊/情感，不 roll。
   - detectDifficulty：从措辞粗判相对难度（默认普通）。
   编排（掷骰/AI裁判/拼块）在 autoDice.ts。
════════════════════════════════════════════ */

/** 命中动作类型 → 判定属性（按序，先匹配到的胜；社交/敏捷/智力/体质/幸运优先于力量以降误判） */
const ACTION_KEYWORDS: { attrKey: AttrKey; words: string[] }[] = [
  { attrKey: 'cha', words: ['说服', '劝说', '谈判', '交涉', '威胁', '恐吓', '欺骗', '诓骗', '忽悠', '勾引', '魅惑', '讨价', '砍价', '求情', '安抚', '挑衅', '嘲讽', '游说', '招募', '策反', '谈条件', '交谈', '搭讪'] },
  { attrKey: 'agi', words: ['闪避', '躲避', '躲开', '潜行', '潜入', '攀爬', '翻越', '跳跃', '逃跑', '逃脱', '追赶', '偷', '扒窃', '平衡', '翻滚', '疾走', '溜走', '摸进', '轻功'] },
  { attrKey: 'int', words: ['破解', '解谜', '推理', '分析', '研究', '钻研', '参悟', '领悟', '施法', '结印', '观察', '侦查', '搜查', '察觉', '辨识', '鉴定', '回忆', '计算', '编写', '解读', '翻译', '布阵', '炼制', '推演'] },
  { attrKey: 'con', words: ['硬抗', '抵抗', '耐受', '忍受', '忍耐', '扛住', '解毒', '抗毒', '屏息', '负重', '跋涉', '硬撑', '撑住', '顶住'] },
  { attrKey: 'luck', words: ['碰运气', '赌一把', '赌运气', '祈祷', '许愿', '听天由命', '摸奖'] },
  { attrKey: 'str', words: ['战斗', '攻击', '出手', '挥', '劈', '砍', '刺', '斩', '搏斗', '格斗', '格挡', '推开', '举起', '掰', '撞', '踹', '踢', '出拳', '破开', '强攻', '厮杀', '硬闯', '抢夺', '夺过', '扛起', '交手', '动手', '拼杀', '施展'] },
];

/** 关键词门：命中返回判定属性，否则 null（=日常/闲聊/情感，不 roll） */
export function detectAutoAction(text: string): { attrKey: AttrKey } | null {
  const t = String(text || '');
  if (!t) return null;
  for (const a of ACTION_KEYWORDS) {
    for (const w of a.words) if (t.includes(w)) return { attrKey: a.attrKey };
  }
  return null;
}

/** 从措辞粗判相对难度（默认普通） */
export function detectDifficulty(text: string): Difficulty {
  const t = String(text || '');
  if (/几乎不可能|绝无可能|不可能完成|痴人说梦/.test(t)) return '几乎不可能';
  if (/极难|极其困难|难如登天|九死一生|万分凶险/.test(t)) return '极难';
  if (/困难|艰难|吃力|勉力|勉强|冒险|凶险|棘手/.test(t)) return '困难';
  if (/轻松|简单|容易|随手|信手|不费吹灰/.test(t)) return '简单';
  return '普通';
}
