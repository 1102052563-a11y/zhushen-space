import type { AttrKey, Difficulty } from './diceEngine';

/* ════════════════════════════════════════════
   自动检定·关键词门（纯函数·零 store/DOM 依赖 → 可单测）
   - detectAutoActions：扫用户输入的动作动词 → 命中的**全部**判定属性（去重·保序）；空=日常/闲聊/情感，不 roll。
     · AI 模式用它当「要不要 roll」的便宜门（命中才调 AI）；真正挑属性交给 AI。
     · frontend 纯前端模式用它直接定属性（可多类 → 多次摇）。
   - detectDifficulty：从措辞粗判相对难度（默认普通）。
   编排（掷骰/AI裁判/拼块）在 autoDice.ts。
════════════════════════════════════════════ */

/** 命中动作类型 → 判定属性（按序，社交/敏捷/智力/体质/幸运优先于力量以降误判） */
const ACTION_KEYWORDS: { attrKey: AttrKey; words: string[] }[] = [
  { attrKey: 'cha', words: ['说服', '劝说', '劝降', '劝阻', '谈判', '交涉', '斡旋', '调解', '威胁', '恐吓', '欺骗', '诓骗', '忽悠', '哄骗', '勾引', '魅惑', '色诱', '讨价', '砍价', '还价', '求情', '求和', '安抚', '示好', '道歉', '赔礼', '挑衅', '嘲讽', '游说', '招募', '招安', '策反', '煽动', '鼓动', '谈条件', '交谈', '攀谈', '搭讪', '寒暄', '赠', '赠送', '馈赠', '馈礼', '献上', '进献', '奉上', '给予', '施舍', '打赏', '贿赂', '收买', '邀请', '款待', '宴请', '拉拢', '安慰', '鼓励', '恳求', '央求', '哀求'] },
  { attrKey: 'agi', words: ['闪避', '躲避', '躲开', '闪身', '潜行', '潜入', '摸进', '攀爬', '翻越', '跳跃', '腾挪', '疾走', '疾奔', '逃跑', '逃脱', '逃窜', '追赶', '追击', '偷', '扒窃', '摸走', '平衡', '翻滚', '溜走', '溜进', '轻功', '身法', '快步', '侧身'] },
  { attrKey: 'int', words: ['破解', '解谜', '解密', '推理', '推演', '分析', '研究', '钻研', '参悟', '领悟', '顿悟', '施法', '结印', '布阵', '炼制', '炼丹', '炼器', '观察', '侦查', '搜查', '搜寻', '察觉', '辨识', '鉴定', '识破', '看穿', '回忆', '记忆', '计算', '推算', '编写', '解读', '翻译', '勘破', '算计', '谋划', '设计'] },
  { attrKey: 'con', words: ['硬抗', '抵抗', '硬撑', '耐受', '忍受', '忍耐', '扛住', '顶住', '撑住', '解毒', '抗毒', '抗击', '屏息', '憋气', '负重', '跋涉', '死扛', '硬顶', '强忍'] },
  { attrKey: 'luck', words: ['碰运气', '赌一把', '赌运气', '押注', '祈祷', '许愿', '祈愿', '听天由命', '摸奖', '抽签', '碰碰运气'] },
  { attrKey: 'str', words: ['战斗', '攻击', '出手', '挥', '劈', '砍', '刺', '斩', '搏斗', '格斗', '格挡', '推开', '推动', '举起', '扛起', '掰', '撞', '踹', '踢', '出拳', '挥拳', '重击', '破开', '强攻', '厮杀', '硬闯', '闯', '抢夺', '夺过', '夺取', '交手', '动手', '拼杀', '压制', '扭断', '掀翻', '砸', '扛'] },
];

/** 关键词门（多命中·去重保序）：返回命中的全部判定属性；空数组=不 roll */
export function detectAutoActions(text: string): { attrKey: AttrKey }[] {
  const t = String(text || '');
  if (!t) return [];
  const out: { attrKey: AttrKey }[] = [];
  const seen = new Set<AttrKey>();
  for (const a of ACTION_KEYWORDS) {
    if (seen.has(a.attrKey)) continue;
    for (const w of a.words) {
      if (t.includes(w)) { seen.add(a.attrKey); out.push({ attrKey: a.attrKey }); break; }
    }
  }
  return out;
}

/** 关键词门（单个·取第一个命中）：命中返回判定属性，否则 null */
export function detectAutoAction(text: string): { attrKey: AttrKey } | null {
  return detectAutoActions(text)[0] ?? null;
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
