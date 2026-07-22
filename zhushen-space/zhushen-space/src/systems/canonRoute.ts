import { CANON_STATIONS, CANON_SUXIAO } from '../data/canonRoute';
import type { CanonStation } from '../data/canonRouteTypes';
import { useCanonRoute } from '../store/canonRouteStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import type { WorldOption } from '../components/WorldSelector';

/* 原著路线：站点 → 世界卡/注入/苏晓建档 的纯逻辑助手（无 React）。 */

export function getCanonStation(index: number): CanonStation | undefined {
  return CANON_STATIONS[index];
}

/** 当前站（未启用/越界 → undefined） */
export function currentCanonStation(): CanonStation | undefined {
  const st = useCanonRoute.getState();
  if (!st.enabled) return undefined;
  return CANON_STATIONS[st.stationIndex];
}

const worldNorm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】：:]/g, '').toLowerCase();

/** 原著路线开启、且当前所在世界=当前站世界 → 返回该站；否则 null（各注入/过滤共用的单一判定） */
export function activeCanonStation(): { station: CanonStation; idx: number } | null {
  const st = useCanonRoute.getState();
  if (!st.enabled) return null;
  const station = CANON_STATIONS[st.stationIndex];
  if (!station) return null;
  const wn = worldNorm((useMisc.getState().worldName || '').trim());
  if (!wn) return null;
  const sn = worldNorm(station.name);
  if (wn.includes(sn) || sn.includes(wn)) return { station, idx: st.stationIndex };
  const base = worldNorm(station.name.split(/[：:（(]/)[0] || '');   // 「海贼王：首入（哥亚王都）」→「海贼王」（杂项演化可能把世界名写成基础名）
  if (base && (wn.includes(base) || base.includes(wn))) return { station, idx: st.stationIndex };
  return null;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 「第X卷…」→ 卷号 int（中文数字支持 一~九十九；阿拉伯数字直读）；解析不了 → null */
export function cnVolToInt(s: string): number | null {
  const m = String(s).match(/第\s*([0-9]+|[一二三四五六七八九十]{1,3})\s*卷/);
  if (!m) return null;
  const x = m[1];
  if (/^[0-9]+$/.test(x)) return parseInt(x, 10);
  const shi = x.indexOf('十');
  if (shi < 0) return x.length === 1 ? (CN_NUM[x] ?? null) : null;
  const tens = shi === 0 ? 1 : (CN_NUM[x[0]] ?? null);
  const ones = shi === x.length - 1 ? 0 : (CN_NUM[x[x.length - 1]] ?? null);
  if (tens == null || ones == null) return null;
  return tens * 10 + ones;
}

/** 🛤 剧透闸：身处某站世界 → 该站卷号（向量召回只放行 ≤ 此卷的小说片段）；否则 null=不过滤 */
export function canonMaxVolume(): number | null {
  const hit = activeCanonStation();
  if (!hit) return null;
  return cnVolToInt(`第${hit.station.volume}卷`);
}

/* ── 任务关系池：本站玩家主线与白夜任务的关系（进站掷定·每站每档固定）── */
export const QUEST_REL_TEXT: Record<'协同' | '对立' | '无关', string> = {
  对立: '你的主线与白夜的任务**正面冲突**——他要达成的事恰与你的目标相抵，或同一目标只容一人达成。乐园不会告知你们彼此的任务详情，冲突须在剧情中自然显形。',
  协同: '你的主线与白夜的任务**同向交叉**——目标不同但利益同向，存在合作窗口（他只认利益交换，绝不白帮）。',
  无关: '你的主线与白夜的任务**互不相干**——但行动路径会不时交叉，狭路相逢时如何相处由玩家决定。',
};

/** 取本站任务关系；未掷定则掷一次并落档。
    权重：同属轮回乐园 对立35/协同35/无关30；主角属他乐园 对立50/协同20/无关30（天然竞争者·对抗浓度更高）。 */
export function ensureQuestRelation(idx: number): '协同' | '对立' | '无关' {
  const CR = useCanonRoute.getState();
  const st = CANON_STATIONS[idx];
  if (!st) return '无关';
  const cur = CR.stations[st.id]?.questRelation;
  if (cur) return cur;
  const foreign = ((usePlayer.getState().profile.homeParadise || '轮回乐园').trim()) !== '轮回乐园';
  const r = Math.random();
  const rel = foreign
    ? (r < 0.5 ? '对立' : r < 0.7 ? '协同' : '无关')
    : (r < 0.35 ? '对立' : r < 0.7 ? '协同' : '无关');
  CR.patchStation(st.id, { questRelation: rel });
  return rel;
}

/** 站点 → enterWorld 用的世界卡。玩家主线独立于苏晓（开场由乐园现场发布），原著任务只作参照。 */
export function stationToWorldOption(s: CanonStation): WorldOption {
  const dead = useCanonRoute.getState().suxiao.state === 'dead';
  const settle = s.suxiao.settle;
  const canonRef = [
    settle?.sourcePct != null ? `世界之源 ${settle.sourcePct}%` : '',
    settle?.rating ? `综合评价 ${settle.rating}` : '',
  ].filter(Boolean).join(' · ');
  return {
    name: s.name,
    desc: s.world.desc,
    tier: s.recommendedTier,
    worldType: `${s.stationType} · 原著路线 第${s.order}站（${s.volume}卷）`,
    dangerLevel: s.difficulty || '（见世界简介）',
    entryPoint: s.world.era ? `原著时间线锚定：${s.world.era}` : '按原著该站的切入时点进入（以每回合注入的原著剧本为准）',
    mainMission: `进入后由乐园现场发布你的专属主线——与原著主线同场交叉、但目标独立（原著参照：${s.world.mainMission || '见原著剧本'}）。${(() => { const rel = useCanonRoute.getState().stations[s.id]?.questRelation; return rel ? `\n本站任务关系（据此设计你的主线）：${QUEST_REL_TEXT[rel]}` : ''; })()}\n首回合正文须正式公布该主线（名称·目标·时限·奖惩）。`,
    sideMission: (s.world.sideMissions?.length || s.world.triggerQuests?.length)
      ? '本世界存在原著同款支线 / 隐藏 / 猎杀任务的线索（详见每回合注入的原著剧本，可复刻可另辟蹊径）。'
      : '',
    warning: s.world.rules || '',
    reward: canonRef ? `结算基准参照：原著猎杀者「${s.suxiao.alias}」本站成绩 ${canonRef}——超越他将获得额外认可。` : '',
    peakPower: '',
    contractorDist: dead
      ? '原著同期本应有轮回乐园猎杀者「白夜」（苏晓）在此执行任务，但他已陨落——本站再无原著轨道，世界按惯性与你的行动自由演化。'
      : `原著同期：轮回乐园猎杀者「${s.suxiao.alias}」（苏晓）也在本世界按他的原著轨道执行任务（轨道见每回合注入的原著剧本）；其余契约者 / 土著按世界惯性存在。`,
    region: '',
    identity: '',
    entryComment: '',
    entryContent: '',
    entryKeys: [],
  };
}

/* ── 原著路线成就（addAchievement 按 id upsert·重复调用幂等）─────── */
const entryShort = (entry: string) => entry.replace(/[（(].*$/, '').split(/[：:]/)[0].replace(/^[-·\s]*/, '').slice(0, 18) || '原著任务';

export function grantCanonAchievement(kind: 'checklist' | 'abandoned' | 'beat' | 'slain', ctx: { station?: CanonStation; entry?: string } = {}): void {
  const P = usePlayer.getState();
  const st = ctx.station;
  if (kind === 'checklist' && st && ctx.entry) {
    const short = entryShort(ctx.entry);
    P.addAchievement({ id: `canon-cl-${st.id}-${short}`, name: `原著复刻·${short}`, desc: `在《${st.name}》复刻达成了原著中的「${short}」。`, category: '任务', type: '特殊', rarity: '蓝', hidden: false, condition: '原著路线：完成本站剧本列出的原著支线/隐藏/猎杀之一' });
  } else if (kind === 'abandoned' && st && ctx.entry) {
    const short = entryShort(ctx.entry);
    P.addAchievement({ id: `canon-ab-${st.id}-${short}`, name: '他放弃的路，你走完了', desc: `《${st.name}》：完成了苏晓在原著中主动放弃的「${short}」。`, category: '隐藏', type: '隐藏', rarity: '淡金', hidden: false, condition: '原著路线：达成白夜在本站原著中放弃/未做的选择' });
  } else if (kind === 'beat' && st) {
    const canon = st.suxiao.settle;
    const his = canon ? [canon.sourcePct != null ? `世界之源 ${canon.sourcePct}%` : '', canon.rating || ''].filter(Boolean).join(' · ') : '';
    P.addAchievement({ id: `canon-beat-${st.id}`, name: `超越白夜·第${st.order}站`, desc: `《${st.name}》通关结算超越了原著猎杀者白夜的成绩${his ? `（他：${his}）` : ''}。`, category: '任务', type: '阶段', rarity: '紫', hidden: false, condition: '原著路线：本站结算评价/世界之源高于白夜基准' });
  } else if (kind === 'slain') {
    P.addAchievement({ id: 'canon-slain-suxiao', name: '命运篡夺者', desc: '亲手终结了原著的主角——白夜（苏晓）陨落，此后的路线再无他的轨道，世界只随你而动。', category: '隐藏', type: '特殊', rarity: '传说级', hidden: false, condition: '原著路线：击杀白夜' });
  }
}

/* ── 苏晓 NPC 建档 / 锁数值 ─────────────────────────────────── */

/** 苏晓第 idx 站入场数值 = 上一站离世定格（+站间乐园变化说明）；首站为初始新人 */
export function suxiaoEntryStats(idx: number): { lv: number; tier: string; attrs?: PlayerAttrs; basisNote: string } {
  const tier = CANON_STATIONS[idx]?.recommendedTier || '一阶';
  const prev = idx > 0 ? CANON_STATIONS[idx - 1] : undefined;
  if (!prev) {
    return {
      lv: 1, tier,
      attrs: { str: 6, agi: 7, con: 5, int: 6, cha: 3, luck: 1 },
      basisNote: '初入乐园的新人猎杀者：持「斩龙闪（白·稀有）」与「亡妻的项坠」，天赋噬灵者，尚无职业与技能。',
    };
  }
  const e = prev.suxiao.exit;
  const a = e.attrs;
  const attrs: PlayerAttrs | undefined = a
    ? { str: a.力量 ?? 1, agi: a.敏捷 ?? 1, con: a.体力 ?? 1, int: a.智力 ?? 1, cha: a.魅力 ?? 1, luck: a.幸运 ?? 1 }
    : undefined;
  const basisNote = `上一站《${prev.name}》离世定格：\n${e.text.slice(0, 520)}${prev.suxiao.paradiseAfter ? `\n【站间乐园变化】${prev.suxiao.paradiseAfter}` : ''}`;
  return { lv: e.lv ?? 1, tier: e.realm || tier, attrs, basisNote };
}

/** 进站时建/更新苏晓（白夜）的 NPC 档案：数值查表锁死（isCanonLocked），离场待剧情登场。返回 npc id。 */
export function upsertSuxiaoNpc(idx: number): string | undefined {
  const CR = useCanonRoute.getState();
  if (!CR.enabled || CR.suxiao.state === 'dead') return CR.suxiao.npcId;
  const station = CANON_STATIONS[idx];
  if (!station) return CR.suxiao.npcId;
  const N = useNpc.getState();
  let id = CR.suxiao.npcId && N.npcs[CR.suxiao.npcId] ? CR.suxiao.npcId : undefined;
  if (!id) id = Object.values(N.npcs).find((r) => (r.name || '').trim() === '白夜')?.id;
  if (!id) id = N.createArchivedContractor({ name: '白夜', tag: '契约者' });
  const s = suxiaoEntryStats(idx);
  const alias = station.suxiao.alias;
  const personaLines = CANON_SUXIAO.persona.split('\n');
  const keepHistory = CR.suxiao.state === 'allied';   // 同盟跨站保持：不覆写他与主角共同经历出的性格/背景，只刷数值
  useNpc.getState().applyAutonomy([{ id, patch: {
    gender: '男',
    realm: `${s.tier}·Lv.${s.lv}`,
    ...(s.attrs ? { attrs: s.attrs, attrsEstablished: true } : {}),
    ...(keepHistory ? {} : {
      personality: (personaLines[1] || personaLines[0] || '').slice(0, 120),
      background: `轮回乐园猎杀者（真名苏晓·在衍生世界以化名行事，本站化名「${alias}」）。${personaLines[0] || ''}\n${s.basisNote}`.slice(0, 1200),
      title: alias !== '白夜' ? alias : '',
    }),
    profession: idx >= 1 ? '灭法之影' : '',
    npcTag: '契约者',
    keepForever: true,
    isCanonLocked: true,
    updatedAt: Date.now(),
  } }]);
  useCanonRoute.getState().setSuxiao({ npcId: id });
  return id;
}

/* ── 世界结算捕获：盖章 + 你 vs 白夜 对比 ─────────────────── */

const RATING_BASE: Record<string, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
/** 评级 → 可比分数（E-…S+）；无法识别 → -1 */
export function ratingScore(r?: string): number {
  const m = (r || '').trim().replace(/[−–—]/g, '-').match(/^([EDCBAS])\s*([+-])?$/i);
  if (!m) return -1;
  return RATING_BASE[m[1].toUpperCase()] * 3 + (m[2] === '+' ? 1 : m[2] === '-' ? -1 : 0);
}

const settleNorm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】：:]/g, '').toLowerCase();

/** 正文出现 <世界结算> 时调用：属当前站则抽 评价/世界之源 盖章，并返回横幅文案（非原著路线/对不上世界 → null）。 */
export function captureCanonSettlement(reply: string): string | null {
  const CR = useCanonRoute.getState();
  if (!CR.enabled) return null;
  const station = CANON_STATIONS[CR.stationIndex];
  if (!station) return null;
  const block = reply.match(/<世界结算>([\s\S]*?)<\/世界结算>/)?.[1] ?? '';
  if (!block) return null;
  // 世界名校验（宽松互含）：结算卡写的衍生世界须对得上当前站；卡里没写世界名则放行（模式+当前站已是强上下文）
  const cardWorld = block.match(/衍生世界[*＊\s]*[：:]\s*([^\n]+)/)?.[1]?.trim();
  if (cardWorld) {
    const cw = settleNorm(cardWorld.replace(/\*/g, ''));
    const sn = settleNorm(station.name);
    const base = settleNorm(station.name.split(/[：:（(]/)[0] || '');
    if (cw && !(sn.includes(cw) || cw.includes(sn) || (base && (cw.includes(base) || base.includes(cw))))) return null;
  }
  const src = block.match(/获得世界之源[^\d]{0,16}([\d.]+)\s*%/);
  const rat = block.replace(/[−–—]/g, '-').match(/综合评价[^SABCDE]{0,24}([SABCDE][+-]?)/);
  const sourcePct = src ? Number(src[1]) : undefined;
  const rating = rat ? rat[1] : undefined;
  const canon = station.suxiao.settle;
  const my = ratingScore(rating), his = ratingScore(canon?.rating);
  const beatCanon = (my >= 0 && his >= 0)
    ? (my > his || (my === his && sourcePct != null && canon?.sourcePct != null && sourcePct > canon.sourcePct))
    : undefined;
  CR.markCleared(station.id, { rating, sourcePct, beatCanon });
  if (beatCanon) grantCanonAchievement('beat', { station });
  const mine = [sourcePct != null ? `世界之源 ${sourcePct}%` : '', rating ? `评价 ${rating}` : ''].filter(Boolean).join(' · ') || '已通关';
  const hisTxt = canon ? [canon.sourcePct != null ? `世界之源 ${canon.sourcePct}%` : '', canon.rating ? `评价 ${canon.rating}` : ''].filter(Boolean).join(' · ') : '';
  return `🛤 原著路线·第${station.order}站《${station.name}》通关盖章：你 ${mine}${hisTxt ? ` ｜ 白夜 ${hisTxt}` : ''}${beatCanon ? ' —— 你超越了原著！🏆' : ''}（路线图可前往下一站）`;
}

/** 回合 settle 清扫：把白夜的 阶位/等级/六维 复位回本站 canon 基准（AI 演化漂移一律钉回）；已死则补 isDead。 */
export function enforceCanonLock(): void {
  const CR = useCanonRoute.getState();
  if (!CR.enabled || !CR.suxiao.npcId) return;
  const id = CR.suxiao.npcId;
  const rec = useNpc.getState().npcs[id];
  if (!rec || !rec.isCanonLocked) return;
  if (CR.suxiao.state === 'dead') {
    if (!rec.isDead) useNpc.getState().applyAutonomy([{ id, patch: { isDead: true, status: '已死亡', updatedAt: Date.now() } }]);
    return;
  }
  const s = suxiaoEntryStats(CR.stationIndex);
  const suffix = (rec.realm || '').split('|')[1];   // 列2 格式「阶位·Lv.X|身份」：身份后缀保留
  const wantRealm = `${s.tier}·Lv.${s.lv}${suffix ? `|${suffix}` : ''}`;
  const patch: Record<string, unknown> = {};
  if ((rec.realm || '').trim() !== wantRealm) patch.realm = wantRealm;
  if (s.attrs && JSON.stringify(rec.attrs ?? null) !== JSON.stringify(s.attrs)) { patch.attrs = s.attrs; patch.attrsEstablished = true; }
  // 轨道态/同盟：动向/短期目标同步成 canon 轨道当前/下一阶段（通用离场自治已排除他，这是其档案"活着感"的来源）
  if (CR.suxiao.state === 'on-track' || CR.suxiao.state === 'allied') {
    const hit = activeCanonStation();
    if (hit) {
      const t = hit.station.suxiao.track;
      const phase = Math.min(Math.max(1, CR.worldPhase), Math.max(1, t.length));
      const cur = t[phase - 1], nxt = t[phase];
      if (cur && (rec.motiveNow || '') !== cur.title) {
        patch.motiveNow = cur.title;
        if (nxt) patch.shortGoal = nxt.title;
      }
    }
  }
  if (Object.keys(patch).length) {
    useNpc.getState().applyAutonomy([{ id, patch: { ...patch, updatedAt: Date.now() } }]);
    console.log('[原著路线] 白夜档案已按 canon 同步:', Object.keys(patch).join('、'));
  }
}
