// 主角档案短指令 + 限时状态·指令应用（从 App.tsx 抽出）。
// turnCountRef 改为 turn 入参（调用方传 turnCountRef.current），其余只读/写 store，无组件耦合。
import { usePlayer, type StatusEffect } from '../store/playerStore';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';
import { normalizeTier, realmFromLevel, attrCapForTier } from './derivedStats';
import { ATTR_GROWTH_RE } from './stateApply';
import { parseGameMinutes, parseDurationMinutes, parseDurationTurns } from './gameClock';

// 限时状态常量（仅下面两个 applier 用，随之从 App 移入）
const CC_STATUS_RE = /昏迷|眩晕|晕眩|麻痹|麻痺|定身|冰冻|冻结|石化|沉默|击晕|僵直|瘫痪|震慑|束缚|禁锢|缴械|致盲|恐惧|魅惑|催眠|休克|窒息|击飞|倒地|失神|眩/;
const INDEFINITE_STATUS_RE = /永久|永远|长期|永续|不限|无限|terminal|permanent/i;
const DEFAULT_STATUS_TURNS = 4;   // 限时状态无明确时长时的默认持续回合
const STALE_STATUS_TURNS = 5;     // 旧存档无时限、未标永久的限时状态，超此回合数强制清理（兜底）
/* 主角档案短指令（character.B1.* / 仅主角演化阶段）→ playerStore
   narrative=本轮正文（用于「基础六维只在正文写明成长时才许上调」的防乱加校验；缺省回退用 reply 自身查信号） */
export function applyPlayerProfileCommands(reply: string, narrative: string, turn: number): number {
  const sp = usePlayer.getState().setProfile;
  const sa = usePlayer.getState().setAttr;
  let n = 0; let m: RegExpExecArray | null;

  const strMap: Record<string, string> = {
    title: 'title', profession: 'profession', arenaRank: 'arenaRank',
    role: 'identity', identity: 'identity', brandLevel: 'brandLevel', contractorId: 'contractorId',
  };
  for (const [field, key] of Object.entries(strMap)) {
    const re = new RegExp(`\\bcharacter\\.B\\d+\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
    while ((m = re.exec(reply))) { sp({ [key]: m[1] } as any); n++; }
  }
  // 阶位：只接受合法阶位名（一阶~无上之境）；非法则按当前等级推导，绝不写入"结丹/三阶中期"等
  const tierRe = /\bcharacter\.B\d+\.identity\.tier\s*=\s*"([^"]*)"/g;
  while ((m = tierRe.exec(reply))) { sp({ tier: normalizeTier(m[1]) || realmFromLevel(usePlayer.getState().profile.level) }); n++; }
  for (const field of ['appearance', 'location', 'bioStrength', 'homeParadise', 'preParadiseJob', 'imageTags', 'gender', 'race', 'raceDetail'] as const) {
    const re = new RegExp(`\\bcharacter\\.B\\d+\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
    while ((m = re.exec(reply))) { sp({ [field]: m[1] } as any); n++; }
  }
  // 当前状态：固定格式 = 含「:Emoji(…)」结构。若新值是纯状态名、而当前已是固定格式，拒绝覆盖
  // （避免主角演化阶段用纯文本把主正文写好的"带图标+可展开详情"的状态胶囊清掉）。
  const statusRe = /\bcharacter\.B\d+\.status\s*=\s*"([^"]*)"/g;
  const isFmtStatus = (s: string) => /[:：]\s*\S{0,4}\s*[（(]/.test(s || '');
  while ((m = statusRe.exec(reply))) {
    const incoming = m[1];
    const cur = usePlayer.getState().profile.status ?? '';
    if (incoming && !isFmtStatus(incoming) && isFmtStatus(cur)) continue;   // 纯文本不覆盖已格式化状态
    sp({ status: incoming }); n++;
  }
  // 等级变化时，阶位随等级自动对应（保证阶位↔等级一致、且只为合法阶位）
  const lvRe = /\bcharacter\.B\d+\.level\s*=\s*(\d+)/g;
  while ((m = lvRe.exec(reply))) { const lv = Number(m[1]); sp({ level: lv, tier: realmFromLevel(lv) }); n++; }
  const attrRe = /\bcharacter\.B\d+\.attrs\.(str|agi|con|int|cha|luck)\s*(=|\+=|-=)\s*(-?\d+)/g;
  const hasGrowth = ATTR_GROWTH_RE.test(narrative || reply);   // 本轮正文是否写了「属性/实力成长」依据
  while ((m = attrRe.exec(reply))) {
    const prof = usePlayer.getState().profile;
    const a = prof.attrs as unknown as Record<string, number>;
    const cur = a[m[1]] ?? 5;
    const v = Number(m[3]);
    const next0 = m[2] === '=' ? v : m[2] === '+=' ? cur + v : cur - v;
    // 忠于原文·防乱加：正文毫无「属性/实力成长」描写时，拒绝任何让基础六维「上调」的指令（下调/受损不挡）
    if (next0 > cur && !hasGrowth) { console.warn(`[Player] 拒绝无正文依据的基础属性上调 ${m[1]} ${cur}→${next0}（本轮正文无成长描写）`); continue; }
    const cap = attrCapForTier(prof.tier, prof.level);   // 基础属性夹到本阶上限（装备/技能/天赋加成另算，不受限）
    sa(m[1] as any, Math.min(cap, Math.max(0, next0)));
    n++;
  }
  // 兼容预设的列写法 add("B1",{"16":动作|穿着|位置|身段|样貌,"10":背景}) → 同步到 profile.appearance/location/background
  // （侧栏外观描写读 profile.appearance，旧预设却用列16输出，导致外观不更新——这里做映射）
  const b1AddRe = /\badd\s*\(\s*"B\d+"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
  while ((m = b1AddRe.exec(reply))) {
    let payload: any;
    try { payload = JSON.parse(m[1]); } catch { try { payload = JSON.parse(m[1].replace(/'/g, '"')); } catch { continue; } }
    if (typeof payload['16'] === 'string' && payload['16'].trim()) {
      const parts = payload['16'].split('|').map((s: string) => s.trim());
      if (parts.length >= 5) {
        sp({ appearance: [parts[1], parts[3], parts[4]].filter(Boolean).join('；') });
        if (parts[2]) sp({ location: parts[2] });
      } else {
        sp({ appearance: payload['16'].trim() });
      }
      n++;
    }
    if (typeof payload['4'] === 'string' && payload['4'].trim()) {
      sp({ status: payload['4'].trim() });  // 列4 当前状态/Buff → 侧栏当前状态
      n++;
    }
    if (typeof payload['10'] === 'string' && payload['10'].trim()) {
      usePlayer.getState().setBackground(payload['10'].trim());
      n++;
    }
    // 列19 / imageTags：生图提示词（英文 NAI tags）→ profile.imageTags
    const tags19 = payload['19'] ?? payload.imageTags ?? payload['生图提示词'];
    if (typeof tags19 === 'string' && tags19.trim()) { sp({ imageTags: tags19.trim() }); n++; }
  }
  // 世界之源：character.B1.worldSource += N（正文获取）/ = 0（回归乐园归零，支持小数百分比）
  const wsRe = /\bcharacter\.B\d+\.worldSource\s*(=|-=|\+=)\s*([\d.]+)/g;
  while ((m = wsRe.exec(reply))) {
    const cur = usePlayer.getState().profile.worldSource ?? 0;
    const v = Number(m[2]);
    const raw = m[1] === '=' ? v : m[1] === '+=' ? cur + v : Math.max(0, cur - v);
    sp({ worldSource: Math.round(raw * 10) / 10 });   // 最多保留 1 位小数，避免 0.3000000004 浮点误差
    n++;
  }
  // 属性点 / 真实属性点：**只在「世界结算」时由正文发放**（平时只"计入/统计"不入账，消耗交前端确定性系统；演化阶段输出不含 <世界结算> 故不会重复计数）
  if (/<世界结算>/.test(reply)) {
    const ptRe = /\bcharacter\.B\d+\.(attrPoints|realAttrPoints)\s*(=|-=|\+=)\s*(\d+)/g;
    const seenPt = new Set<string>();
    while ((m = ptRe.exec(reply))) {
      const dk = m[0].replace(/\s+/g, ''); if (seenPt.has(dk)) continue; seenPt.add(dk);   // 去重：统计+发放同一条只算一次
      const key = m[1] as 'attrPoints' | 'realAttrPoints';
      const cur = (usePlayer.getState().profile as any)[key] ?? 0;
      const v = Number(m[3]);
      sp({ [key]: m[2] === '=' ? v : m[2] === '+=' ? cur + v : Math.max(0, cur - v) } as any);
      n++;
    }
  }
  applyTimedStatusCommands(reply, turn);   // 主角限时状态 addStatus/deStatus
  return n;
}

/* 限时状态指令：addStatus("B1"/"C1",{name,emoji,tone,effect,source,duration}) / deStatus("id","name")
   duration 例："3回合"（回合制）/ "5分钟"/"2小时"/"3天"（游戏时间制，需杂项演化时间可解析）。
   引擎据此自动过期（见 expireStatuses）。仅处理 onlyId（若给）以适配策略B单角色。 */
export function applyTimedStatusCommands(reply: string, turn: number, onlyId?: string) {
  const M = useMisc.getState();
  const nowGameMin = parseGameMinutes(M.worldTime || M.paradiseTime);
  let m: RegExpExecArray | null;
  // 新增/更新
  const addRe = /\baddStatus\s*\(\s*"([A-Za-z]\w*)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
  while ((m = addRe.exec(reply))) {
    const cid = m[1];
    if (onlyId && cid !== onlyId) continue;
    let d: any; try { d = JSON.parse(m[2]); } catch { try { d = JSON.parse(m[2].replace(/'/g, '"')); } catch { continue; } }
    const name = String(d.name ?? '').trim();
    if (!name) continue;
    const durStr = String(d.duration ?? d.dur ?? d.durationDesc ?? '').trim();
    let durTurns = parseDurationTurns(durStr);
    const durMin = parseDurationMinutes(durStr);
    // 无明确时长（如"持续"）→ 按类型给默认回合数，避免限时状态永不过期；显式"永久/长期"才保留无限期
    if (durTurns == null && durMin == null && !INDEFINITE_STATUS_RE.test(durStr)) {
      durTurns = CC_STATUS_RE.test(`${name}${d.type ?? ''}${d.effect ?? ''}`) ? 2 : DEFAULT_STATUS_TURNS;
    }
    const eff: StatusEffect = {
      id: `ST_${cid}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      type: d.type,
      emoji: d.emoji,
      tone: d.tone === 'buff' || d.tone === 'debuff' || d.tone === 'neutral' ? d.tone : undefined,
      effect: d.effect,
      desc: d.desc ?? d.description,
      tags: Array.isArray(d.tags) ? d.tags : undefined,
      source: d.source,
      startTurn: turn,
      durationTurns: durTurns ?? undefined,
      durationDesc: durStr || undefined,
      startGameMin: nowGameMin,
      expireAtMin: (durMin != null && nowGameMin != null) ? nowGameMin + durMin : null,
      addedAt: Date.now(),
    };
    if (/^B\d+$/.test(cid)) usePlayer.getState().addStatusEffect(eff);
    else if (/^[CG]\d+$/.test(cid)) { if (useNpc.getState().npcs[cid]) useNpc.getState().addNpcStatus(cid, eff); }
  }
  // 移除
  const delRe = /\bdeStatus\s*\(\s*"([A-Za-z]\w*)"\s*,\s*"([^"]*)"\s*\)/g;
  while ((m = delRe.exec(reply))) {
    const cid = m[1]; const nm = m[2];
    if (onlyId && cid !== onlyId) continue;
    if (/^B\d+$/.test(cid)) usePlayer.getState().removeStatusEffect(nm);
    else if (/^[CG]\d+$/.test(cid)) useNpc.getState().removeNpcStatus(cid, nm);
  }
}

/* 限时状态过期清理：按回合数或游戏时间判定，移除已过期项。每回合发请求前调用。 */
export function expireStatuses(turn: number) {
  const M = useMisc.getState();
  const nowMin = parseGameMinutes(M.worldTime || M.paradiseTime);
  const isExpired = (e: StatusEffect): boolean => {
    if (e.durationTurns != null && turn - e.startTurn >= e.durationTurns) return true;
    if (e.expireAtMin != null && nowMin != null && nowMin >= e.expireAtMin) return true;
    // 兜底：旧存档里既无回合上限也无时间上限、且未标注永久/长期的限时状态，超过 STALE 回合强制清理
    if (e.durationTurns == null && e.expireAtMin == null
        && !INDEFINITE_STATUS_RE.test(e.durationDesc ?? '')
        && typeof e.startTurn === 'number' && turn - e.startTurn >= STALE_STATUS_TURNS) return true;
    return false;
  };
  // 主角
  const pe = usePlayer.getState().profile.statusEffects ?? [];
  const peKept = pe.filter((e) => !isExpired(e));
  if (peKept.length !== pe.length) usePlayer.getState().setStatusEffects(peKept);
  // NPC
  const npcs = useNpc.getState().npcs;
  for (const id of Object.keys(npcs)) {
    const list = npcs[id].statusEffects ?? [];
    if (list.length === 0) continue;
    const kept = list.filter((e) => !isExpired(e));
    if (kept.length !== list.length) useNpc.getState().setNpcStatuses(id, kept);
  }
}
