// 主角档案短指令 + 限时状态·指令应用（从 App.tsx 抽出）。
// turnCountRef 改为 turn 入参（调用方传 turnCountRef.current），其余只读/写 store，无组件耦合。
import { usePlayer, type StatusEffect } from '../store/playerStore';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { normalizeTier, realmFromLevel, attrCapForTier } from './derivedStats';
import { ATTR_GROWTH_RE } from './stateApply';
import { parseGameMinutes, parseDurationMinutes, parseDurationTurns } from './gameClock';

// 限时状态常量（仅下面两个 applier 用，随之从 App 移入）
const CC_STATUS_RE = /昏迷|眩晕|晕眩|麻痹|麻痺|定身|冰冻|冻结|石化|沉默|击晕|僵直|瘫痪|震慑|束缚|禁锢|缴械|致盲|恐惧|魅惑|催眠|休克|窒息|击飞|倒地|失神|眩/;
const INDEFINITE_STATUS_RE = /永久|永远|长期|永续|不限|无限|terminal|permanent/i;
const DEFAULT_STATUS_TURNS = 4;   // 限时状态无明确时长时的默认持续回合
const STALE_STATUS_TURNS = 5;     // 旧存档无时限、未标永久的限时状态，超此回合数强制清理（兜底）

/* ── 忠于正文·状态时长守卫（治"正文说3回合、状态却给15回合"）──
   narratedMaxTurns：本轮正文里**明确声明**的最长「前向回合时长」。只认明确时长短语(接下来/持续/维持/…N回合、N回合内)，
   避开"第3回合/3回合前"等非时长数字；并**先剥掉 <state>/<upstore> 指令块**，否则会把状态指令自己写的 15回合 当成"正文声明"。*/
export function narratedMaxTurns(reply: string): number {
  const prose = (reply || '').replace(/<(?:state|upstore)>[\s\S]*?<\/(?:state|upstore)>/gi, '');
  const re = /(?:接下来的?|未来的?|之后|往后|持续|维持|长达|连续|接连)\s*(\d{1,3})\s*个?回合|(\d{1,3})\s*个?回合(?:之?内)/g;
  let m: RegExpExecArray | null, max = 0;
  while ((m = re.exec(prose))) { const v = Number(m[1] ?? m[2]); if (v > 0 && v < 1000) max = Math.max(max, v); }
  return max;
}
/* 把一段文本里「N回合」中超过上限的回合数夹下来（上限来自正文声明；上限≤0 时原样返回、不动）。
   只动"数字+回合"，不碰"每回合/无数字回合"，对短状态文本足够安全。*/
export function clampTurnsInText(text: string, maxTurns: number): string {
  if (!text || maxTurns <= 0) return text;
  return text.replace(/(\d{1,3})(\s*个?回合)/g, (full, n: string, unit: string) =>
    Number(n) > maxTurns ? `${maxTurns}${unit}` : full);
}
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
  for (const field of ['appearance', 'baseAppearance', 'location', 'bioStrength', 'homeParadise', 'preParadiseJob', 'imageTags', 'gender', 'race', 'raceDetail'] as const) {
    const re = new RegExp(`\\bcharacter\\.B\\d+\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
    while ((m = re.exec(reply))) {
      // 护栏：基底外观=常驻长相基准（身高/发色/瞳色/体型/骨相），一旦已有非空值就锁定、忽略 AI 覆盖
      //（专治"1m4 矮子被演化阶段瞎写成 2m 龙傲天"的漂移）；仅"空→有"时允许首次建锚。要改长相走玩家手动编辑。
      if (field === 'baseAppearance' && (usePlayer.getState().profile.baseAppearance ?? '').trim()) {
        console.warn('[Player] 基底外观已锁定，忽略 AI 覆盖:', (m[1] || '').slice(0, 40));
        continue;
      }
      sp({ [field]: m[1] } as any); n++;
    }
  }
  // 当前状态：固定格式 = 含「:Emoji(…)」结构。若新值是纯状态名、而当前已是固定格式，拒绝覆盖
  // （避免主角演化阶段用纯文本把主正文写好的"带图标+可展开详情"的状态胶囊清掉）。
  const statusRe = /\bcharacter\.B\d+\.status\s*=\s*"([^"]*)"/g;
  const isFmtStatus = (s: string) => /[:：]\s*\S{0,4}\s*[（(]/.test(s || '');
  const maxTurns = narratedMaxTurns(narrative || reply);   // 正文声明的最长回合时长 → 夹状态文本里"持续N回合"
  while ((m = statusRe.exec(reply))) {
    const incoming = clampTurnsInText(m[1], maxTurns);      // 忠于正文：状态里的持续回合数不得超过正文写明的回合数
    const cur = usePlayer.getState().profile.status ?? '';
    if (incoming && !isFmtStatus(incoming) && isFmtStatus(cur)) continue;   // 纯文本不覆盖已格式化状态
    sp({ status: incoming }); n++;
  }
  // 等级变化时，阶位随等级自动对应；并按「真实上升的级数」自动结算每级奖励：+3 属性点 + 1 技能点。
  //（前端确定性·仿潜能点 4/级；delta 守卫=仅 lv>旧值才发，AI 每轮重写同一等级 delta=0 不重复发，本函数被多处多次调用亦幂等）
  const lvRe = /\bcharacter\.B\d+\.level\s*=\s*(\d+)/g;
  while ((m = lvRe.exec(reply))) {
    const lv = Number(m[1]);
    const oldLv = usePlayer.getState().profile.level ?? 1;
    const gained = Math.max(0, lv - oldLv);
    const prof0 = usePlayer.getState().profile;
    // 四阶起(Lv.31+)「六维即真实属性」→ 每级奖励发「真实属性点」(realAttrPoints)；否则发「普通属性点」(attrPoints)
    const ptPatch = gained <= 0 ? {}
      : lv >= 31 ? { realAttrPoints: (prof0.realAttrPoints ?? 0) + 3 * gained }
      : { attrPoints: (prof0.attrPoints ?? 0) + 3 * gained };
    sp({ level: lv, tier: realmFromLevel(lv), ...ptPatch });
    if (gained > 0) { try { useItems.getState().adjustCurrency('技能点', gained); } catch { /* 货币 store 未就绪兜底 */ } }
    n++;
  }
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
      sp({ status: clampTurnsInText(payload['4'].trim(), maxTurns) });  // 列4 当前状态/Buff → 侧栏（持续回合数夹到正文上限）
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
  // ★忠于正文可见值（治"正文说总计6.3%、侧栏世界之源却显示4"的对不上）：正文里明确写出的
  //   「世界之源…累计/总计/合计 X%」是玩家亲眼所见的当前总量。世界之源由主角演化阶段读隐藏块 <世界之源>
  //   的绝对总量落库，而它与主叙事(另一次 AI 调用)可见的"当前总计"可能因基数看法不一致而分叉——
  //   本阶段能拿到主叙事 narrative，故非归零回合**以玩家可见的总量为准**覆盖块值/指令算出的值。
  //   只认带"累计/总计/合计/已达/共计"关键词、且紧邻"世界之源"的百分比，避开"获得3.5%"这类单回合明细增量。
  {
    const dirs: { op: string; v: number }[] = [];
    const wsRe = /\bcharacter\.B\d+\.worldSource\s*(=|-=|\+=)\s*([\d.]+)/g;
    while ((m = wsRe.exec(reply))) dirs.push({ op: m[1], v: Number(m[2]) });
    const homeNow = /轮回乐园|专属房间|主神空间/.test(useMisc.getState().worldName || '');   // 人在乐园
    if (homeNow) {
      // ★回归乐园：世界之源**必归零**（每个任务世界独立累计、绝不跨世界带入）——正文里的"总计X%"只是
      //   已结束世界的回顾、不入账；与 reconcileHomeWorld 同口径，双保险不靠 AI 记得发 = 0。
      if ((usePlayer.getState().profile.worldSource ?? 0) !== 0) { sp({ worldSource: 0 }); n++; }
    } else {
      const hasReset = dirs.some((d) => d.op === '=' && d.v === 0);   // 显式归零：最高优先，绝不被可见总量覆盖
      let visTotal: number | null = null;
      if (!hasReset && narrative) {
        const mv = /世界之源[\s\S]{0,24}?(?:累计|总计|合计|已达|共计)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/.exec(narrative);
        if (mv) { const t = Number(mv[1]); if (Number.isFinite(t)) visTotal = t; }
      }
      if (visTotal != null) {
        sp({ worldSource: Math.round(visTotal * 10) / 10 });   // 忠于玩家可见的"当前总计 X%"（含小数），侧栏与正文一致
        n++;
      } else {
        for (const d of dirs) {
          const cur = usePlayer.getState().profile.worldSource ?? 0;
          const raw = d.op === '=' ? d.v : d.op === '+=' ? cur + d.v : Math.max(0, cur - d.v);
          sp({ worldSource: Math.round(raw * 10) / 10 });   // 最多保留 1 位小数，避免 0.3000000004 浮点误差
          n++;
        }
      }
    }
  }
  // 属性点 / 真实属性点：**只在「世界结算」时由正文发放**（平时只"计入/统计"不入账，消耗交前端确定性系统；演化阶段输出不含 <世界结算> 故不会重复计数）
  if (/<世界结算>/.test(reply)) {
    const ptRe = /\bcharacter\.B\d+\.(attrPoints|realAttrPoints)\s*(=|-=|\+=)\s*(\d+)/g;
    const seenPt = new Set<string>();
    while ((m = ptRe.exec(reply))) {
      const dk = m[0].replace(/\s+/g, ''); if (seenPt.has(dk)) continue; seenPt.add(dk);   // 去重：统计+发放同一条只算一次
      let key = m[1] as 'attrPoints' | 'realAttrPoints';
      // 四阶前·真实属性点绝对封锁：主角未达四阶(本阶单属性上限<150)时，AI 若误发真实属性点，自动降级为等价的普通属性点——真实属性是四阶「属性觉醒」后才解锁的专属概念。
      if (key === 'realAttrPoints' && attrCapForTier(usePlayer.getState().profile.tier, usePlayer.getState().profile.level) < 150) {
        console.warn('[Player] 四阶前禁真实属性点 → 自动降级为普通 attrPoints'); key = 'attrPoints';
      }
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
    // 忠于正文：回合制时长不得超过本轮正文明确声明的最长回合时长（治"正文3回合、状态15回合"），并同步胶囊显示文本
    let durDesc = durStr;
    const maxTurns = narratedMaxTurns(reply);
    if (durTurns != null && maxTurns > 0 && durTurns > maxTurns) {
      console.warn(`[Status] "${name}" 时长 ${durTurns} 回合 > 正文声明的最长 ${maxTurns} 回合，按正文夹到 ${maxTurns}`);
      durTurns = maxTurns;
      durDesc = clampTurnsInText(durStr, maxTurns) || `${maxTurns}回合`;
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
      durationDesc: durDesc || undefined,
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
