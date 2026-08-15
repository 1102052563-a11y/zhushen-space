/* 公共频道·发帖动机抽签（借鉴Zsd网游论坛的「发帖动机多样化」清单思想·纯函数）：
   每个频道一池动机，每次刷新随机抽 N 个注入提示词，逼帖子动机多样、随刷新轮换。
   与 worldLib.sampleWorldPoolText 同思路：抽签本身在前端做，AI 只照单取材。 */
import { CHANNEL_DEFS, type ChannelKey } from '../store/channelStore';

export const CHANNEL_MOTIVES: Partial<Record<ChannelKey, string[]>> = {
  general: [
    '发泄情绪', '求助提问', '分享日常', '八卦闲聊', '理论分析', '晒图炫耀', '吐槽抱怨', '寻人启事',
    '玩梗接龙', '深夜emo', '炫富拉仇恨', '新人报道', '抽奖许愿', '键盘吵架', '冷知识科普', '情感树洞',
    '匿名爆料', '许愿还愿', '整活钓鱼', '怀旧回忆杀',
  ],
  trade: [
    '急出装备', '求购材料', '询价鉴定', '挂骗子曝光', '以物换物', '大宗收购', '甩卖清仓', '代工定制',
    '拍卖预告', '砍价拉扯', '行情分析', '稀货炫耀', '亏本吐槽', '囤货被套', '免费白送(有条件)',
  ],
  team: [
    '开荒招募', '速刷搭子', '固定队招人', '求带萌新', '缺奶缺坦', '跨阶借人', '团队纠纷仲裁',
    '战利品分配规则讨论', '鸽子挂人', '老队友寻人', '仅限女队员(被喷)', '土豪包躺', '试用期考核招募',
  ],
  battle: [
    '实时战况转播', '求支援', '集火目标通报', '战败复盘', '击杀炫耀', '遗言帖', '战术求教',
    '装备耐久告急', '悬赏敌人', '偷袭预警', '停战谈判喊话', '战场捡漏汇报',
  ],
  world: [
    '副本见闻', '风土人情', '奇遇分享', '美食测评', '土著趣事', '世界风险预警', '失踪者线索',
    '遗迹探报', '传闻求证', '风景晒图', '当地禁忌科普', '土著恋爱奇谈', '离奇死法盘点',
  ],
  intel: [
    '机制解析', '敌情通报', '攻略发布', '情报悬赏', '数据考据', '辟谣打假', '阴谋论推演',
    '血泪教训', '冷门技巧', '前人笔记解读', '乐园规则钻研', '概率玄学争论',
  ],
  // system 频道 = 乐园公告，无发帖动机池
};

// Fisher-Yates 前 n 个（池子不足 n 时全取）
function pickN<T>(pool: T[], n: number): T[] {
  const arr = [...pool];
  const take = Math.min(n, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}

/* 为启用的频道各抽 perChannel 个动机，拼成注入块；没有动机池的频道（system）跳过。
   每次调用重新抽 → 每次刷新的帖子动机随之轮换。空结果返回 ''（调用方跳过注入）。 */
export function buildMotiveDraw(enabledKeys: ChannelKey[], perChannel = 5): string {
  const lines: string[] = [];
  for (const key of enabledKeys) {
    const pool = CHANNEL_MOTIVES[key];
    if (!pool || pool.length === 0) continue;
    const label = CHANNEL_DEFS.find((d) => d.key === key)?.label ?? key;
    lines.push(`- ${label}：${pickN(pool, perChannel).join('、')}`);
  }
  if (lines.length === 0) return '';
  return `【本次发帖动机抽签（每次刷新随机轮换）】各频道新帖的发帖动机应**大体覆盖**本次抽到的这些（不必全用、允许少量其他动机，但禁止全员同一动机）：\n${lines.join('\n')}`;
}
