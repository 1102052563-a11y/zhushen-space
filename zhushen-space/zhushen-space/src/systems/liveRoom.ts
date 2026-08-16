/* 📺 乐园直播间（借鉴 Abstract外置手机 live 思想·代码全自写）：
   乐园娱乐设施——挑一名契约者/随从 NPC 当主播，生成直播现场（主播言行+弹幕+积分榜+醒目留言+主播心声）。
   核心借鉴=**礼物价值三档 × 主播反应分档**（1币玫瑰只道谢、万币游艇会失态——"数值→演出分档"）；
   送礼=前端确定性扣乐园币（AI 不碰钱）+ 好感小幅棘轮 + facilityBridge 通报。 */
import { lenientJsonParse } from './stateParser';

export interface LiveGift { key: string; emoji: string; name: string; price: number; tier: 1 | 2 | 3; favor: number }
/* 三档十二礼（价格按本作乐园币物价 ×10 于原型：白装300起的经济里，10币小礼~12万币炫富礼）*/
export const LIVE_GIFTS: LiveGift[] = [
  { key: 'rose',    emoji: '🌹', name: '玫瑰',   price: 10,     tier: 1, favor: 0 },
  { key: 'heart',   emoji: '💖', name: '爱心',   price: 50,     tier: 1, favor: 0 },
  { key: 'candy',   emoji: '🍬', name: '糖果',   price: 100,    tier: 1, favor: 1 },
  { key: 'box',     emoji: '🎁', name: '礼盒',   price: 200,    tier: 1, favor: 1 },
  { key: 'star',    emoji: '🌟', name: '星星',   price: 500,    tier: 2, favor: 1 },
  { key: 'rocket',  emoji: '🚀', name: '火箭',   price: 1000,   tier: 2, favor: 2 },
  { key: 'diamond', emoji: '💎', name: '钻石',   price: 2000,   tier: 2, favor: 2 },
  { key: 'crown',   emoji: '👑', name: '皇冠',   price: 5000,   tier: 2, favor: 2 },
  { key: 'unicorn', emoji: '🦄', name: '独角兽', price: 10000,  tier: 3, favor: 3 },
  { key: 'castle',  emoji: '🏰', name: '城堡',   price: 20000,  tier: 3, favor: 3 },
  { key: 'rainbow', emoji: '🌈', name: '彩虹',   price: 50000,  tier: 3, favor: 3 },
  { key: 'yacht',   emoji: '🚢', name: '游艇',   price: 120000, tier: 3, favor: 3 },
];
export const giftByKey = (k: string) => LIVE_GIFTS.find((g) => g.key === k);

/* 礼物价值表+反应分档（注入提示词·借鉴其"经常有人送/忠实粉丝才送/通常没人送"三档指导原文思想）*/
export function giftGuideBlock(): string {
  const t1 = LIVE_GIFTS.filter((g) => g.tier === 1).map((g) => `${g.emoji}${g.name}=${g.price}币`).join(' ');
  const t2 = LIVE_GIFTS.filter((g) => g.tier === 2).map((g) => `${g.emoji}${g.name}=${g.price}币`).join(' ');
  const t3 = LIVE_GIFTS.filter((g) => g.tier === 3).map((g) => `${g.emoji}${g.name}=${g.price}币`).join(' ');
  return `【礼物价值表与主播反应分档（乐园币）】
- 小礼（常有人送，礼貌即可）：${t1} —— 主播口头道谢就行，小主播会更热情。
- 中礼（熟客/有钱人才送）：${t2} —— 主播重点感谢并主动与送礼人互动一两句。
- 豪礼（通常没人送得起）：${t3} —— 主播会惊讶/失态/受宠若惊（按性格来），全场弹幕起哄；大主播稍平常但也必与送礼人互动。
弹幕对礼物的反应也按档位分层：小礼没人理，豪礼全场刷屏。`;
}

export interface LiveShow {
  roomTitle: string;
  roomDesc: string;
  viewers: number;
  thought: string;                                  // 主播内心（幕后条·观众看不到）
  contents: { dialogue: string; state: string }[];  // 主播言行 4~8 条
  barrage: { name: string; c: string }[];           // 弹幕 8~15 条
  ranking: { name: string; score: number }[];       // 贡献榜 3 条
  superchat: { name: string; amount: number; c: string }[];   // 醒目留言 0~2 条
}

/* 宽容解析：代码围栏剥离→最外层对象→lenientJsonParse→逐字段夹取 */
export function parseLiveReply(raw: string): LiveShow | null {
  const s = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  const j: any = m ? lenientJsonParse(m[0]) : null;
  if (!j || typeof j !== 'object') return null;
  const num = (v: any, d = 0) => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : d; };
  const contents = (Array.isArray(j.contents) ? j.contents : [])
    .map((x: any) => ({ dialogue: String(x?.dialogue ?? '').trim().slice(0, 200), state: String(x?.state ?? '').trim().slice(0, 100) }))
    .filter((x: any) => x.dialogue).slice(0, 8);
  if (!contents.length) return null;
  const barrage = (Array.isArray(j.barrage) ? j.barrage : [])
    .map((x: any) => ({ name: String(x?.name ?? '').trim().slice(0, 20), c: String(x?.c ?? '').trim().slice(0, 40) }))
    .filter((x: any) => x.name && x.c).slice(0, 15);
  const ranking = (Array.isArray(j.ranking) ? j.ranking : [])
    .map((x: any) => ({ name: String(x?.name ?? '').trim().slice(0, 20), score: num(x?.score) }))
    .filter((x: any) => x.name).slice(0, 3);
  const superchat = (Array.isArray(j.superchat) ? j.superchat : [])
    .map((x: any) => ({ name: String(x?.name ?? '').trim().slice(0, 20), amount: num(x?.amount), c: String(x?.c ?? '').trim().slice(0, 60) }))
    .filter((x: any) => x.name && x.c).slice(0, 2);
  return {
    roomTitle: String(j.roomTitle ?? '').trim().slice(0, 40) || '直播间',
    roomDesc: String(j.roomDesc ?? '').trim().slice(0, 80),
    viewers: num(j.viewers, 100),
    thought: String(j.thought ?? '').trim().slice(0, 120),
    contents, barrage, ranking, superchat,
  };
}

/* ── 生成（自包含·面板零 App 穿线）：featureKey='liveRoom' 回退频道接口 ── */
export async function generateLiveShow(streamerId: string, userAction?: string): Promise<{ ok: boolean; msg: string; show: LiveShow | null }> {
  const { useNpc } = await import('../store/npcStore');
  const { useMisc } = await import('../store/miscStore');
  const { usePlayer } = await import('../store/playerStore');
  const { useChannel } = await import('../store/channelStore');
  const { useSettings, resolveApiChain } = await import('../store/settingsStore');
  const { apiChatFallback } = await import('./apiChat');
  const { getPrompt } = await import('../store/promptOverrideStore');
  const { LIVE_ROOM_RULE } = await import('../promptRules');

  const rec = useNpc.getState().npcs[streamerId];
  if (!rec || rec.isDead) return { ok: false, msg: '主播不在了', show: null };
  // 频道 API 口径（与 App.getChannelApi 同逻辑：频道自有或共享正文 API）
  const cs = useChannel.getState() as any;
  const ss = useSettings.getState();
  const legacy = cs.channelUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : cs.channelApi;
  const chain = resolveApiChain('liveRoom', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return { ok: false, msg: '接口未配置：接口路由 liveRoom 或频道接口', show: null };
  const M = useMisc.getState();
  const playerName = usePlayer.getState().profile.name || '主角';
  const card = [
    `【主播】${rec.name}（${[rec.npcTag, rec.realm, rec.profession].filter(Boolean).join('·')}）`,
    rec.personality && `性格：${String(rec.personality).slice(0, 60)}`,
    rec.status && `近况：${String(rec.status).slice(0, 50)}`,
    `与${playerName}（主角）：好感 ${rec.favor}${rec.callPlayer ? `，称呼TA「${rec.callPlayer}」` : ''}`,
    `【场景】轮回乐园·契约者直播频道；乐园时间：${M.paradiseTime || M.worldTime || '（未设定）'}`,
  ].filter(Boolean).join('\n');
  const sys = getPrompt('LIVE_ROOM_RULE', LIVE_ROOM_RULE) + '\n\n' + giftGuideBlock() + '\n\n' + card;
  const user = userAction
    ? `${userAction}\n请生成直播间的**最新一段**现场（主播对上述行为要有相称档位的反应），按【输出】只输出 JSON。`
    : `${playerName}刚点进${rec.name}的直播间。请生成此刻的直播现场，按【输出】只输出 JSON。`;
  try {
    const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeoutMs: 120000 });
    const show = parseLiveReply(content || '');
    if (!show) return { ok: false, msg: '信号不佳（生成不合格），再试一次', show: null };
    return { ok: true, msg: '', show };
  } catch (e) {
    console.warn('[直播] 生成失败', e);
    return { ok: false, msg: '生成失败（网络/接口错误）', show: null };
  }
}
