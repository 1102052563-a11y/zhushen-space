import { useMisc, isMainQuest, mergeRings, type MiscTask, type ArchivedTask, type WorldEvent, type QuestRing } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { isHomeWorld } from './playerVitals';
import { guardTimeAdvance } from './evoGuard';
import { normVisibility } from './worldEvent';
import { filterAiTaskPatch, gateNewAiTask, gateRingAdvance, gateRingsPatch, gateTaskSettle, isTerminalTaskStatus } from './questGuard';
import { logArbitration } from './npcGrowthGuard';
import { useCanonRoute } from '../store/canonRouteStore';
import { useCalendar } from '../store/calendarStore';
import { lenientJsonParse } from './stateParser';
import { normPhase, normSupply, normTrend, normCommodityKey, ECON_EVENT_CAP, type Economy } from './economy';
import { CANON_STATIONS } from '../data/canonRoute';
import { grantCanonAchievement } from './canonRoute';

/* 杂项演化指令解析（不含小地图）
   只认 timeLocation.* / addSmall|LargeSummary / addWorldEvent.. / T_ 任务 / ringAdvance
   —— 用字面量前缀短路，避免与物品/NPC 的 add/set/de 冲突 */

/* 任务线类型归一：只接受 主线/支线（含 main/side 英文），其余返回 undefined（=不改动既有/默认支线） */
function normKind(v: any): MiscTask['kind'] | undefined {
  const s = String(v ?? '').trim();
  if (/主线|main/i.test(s)) return '主线';
  if (/支线|side/i.test(s)) return '支线';
  return undefined;
}
/* 把 AI 输出的 rings JSON 校验/归一成 QuestRing[]；无效或空返回 undefined（=不动既有 rings） */
function sanitizeRings(raw: any): QuestRing[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: QuestRing[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const goal = String(r.goal ?? r['目标'] ?? '').trim();
    if (!goal) return;
    const st = String(r.status ?? '').trim();
    const status: QuestRing['status'] =
      /^(active|进行中|当前)$/i.test(st) ? 'active'
      : /^(done|已完成|完成|达成)$/i.test(st) ? 'done'
      : /^(skipped|跳过|已跳过)$/i.test(st) ? 'skipped'
      : 'planned';
    const rSummary = r.summary ?? r['总结'] ?? r['行为总结'];
    const rRating = r.rating ?? r['评级'] ?? r['评分'];
    out.push({
      idx: Number.isFinite(Number(r.idx)) ? Number(r.idx) : i + 1,
      goal,
      hint: r.hint != null && String(r.hint).trim() ? String(r.hint).trim() : undefined,
      status,
      // 空串奖惩视作"未提供"(=undefined)：这样 mergeRings 不会拿空值把既有奖励覆盖掉（保留原有奖励）
      reward: r.reward != null && String(r.reward).trim() ? String(r.reward) : undefined,
      penalty: r.penalty != null && String(r.penalty).trim() ? String(r.penalty) : undefined,
      optional: (r.optional === true || r.optional === 'true' || r.optional === 1) ? true : undefined,
      startTime: r.startTime != null ? String(r.startTime) : undefined,
      endTime: r.endTime != null ? String(r.endTime) : undefined,
      summary: rSummary != null && String(rSummary).trim() ? String(rSummary).trim() : undefined,
      rating: rRating != null && String(rRating).trim() ? String(rRating).trim() : undefined,
    });
  });
  if (!out.length) return undefined;
  // 环数上限=12（创建时一次规划死整条路线图，容纳史诗级长线）：AI 建更多时保留 idx 最小的 12 个
  return [...out].sort((a, b) => a.idx - b.idx).slice(0, 12);
}
/* 从任务载荷里提取多环字段，按存在与否条件写入（缺省不覆盖既有），并在给了 rings 没给 currentRing 时自动取 active 环 idx */
function applyQuestFields(target: Partial<MiscTask>, o: Record<string, any>): void {
  const kind = normKind(o.kind);
  if (kind) target.kind = kind;
  const rings = sanitizeRings(o.rings);
  if (rings) target.rings = rings;
  if (o.currentRing != null && Number.isFinite(Number(o.currentRing))) target.currentRing = Number(o.currentRing);
  if (o.finale != null && String(o.finale).trim()) target.finale = String(o.finale).trim();
  // 当前任务进度（仅在给了非空值时写入，缺省则保留既有，不被空值清掉）
  if (o.progress != null && String(o.progress).trim()) target.progress = String(o.progress).trim();
  else if (o['进度'] != null && String(o['进度']).trim()) target.progress = String(o['进度']).trim();
  if (target.rings && target.currentRing == null) {
    const active = target.rings.find((r) => r.status === 'active');
    if (active) target.currentRing = active.idx;
  }
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch {
    try { return JSON.parse(s.replace(/'/g, '"')); } catch { return null; }
  }
}
function unquote(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

function taskFromCols(o: Record<string, any>): MiscTask {
  const t: MiscTask = {
    id: String(o['0'] ?? ''),
    name: String(o['1'] ?? ''),
    desc: String(o['2'] ?? ''),
    reward: String(o['3'] ?? ''),
    penalty: String(o['4'] ?? ''),
    status: String(o['5'] ?? '进行中'),
    startTime: String(o['startTime'] ?? ''),
    endTime: String(o['endTime'] ?? ''),
    addedAt: Date.now(),
  };
  applyQuestFields(t, o);
  if (o.rating != null || o['评分'] != null) t.rating = String(o.rating ?? o['评分']);
  return t;
}
/* 任务状态是否为"已结算" → 已移入 questGuard.ts（isTerminalTaskStatus），闸门与解析共用 */

function patchFromCols(o: Record<string, any>): Partial<MiscTask> {
  const p: Partial<MiscTask> = {};
  if (o['1'] != null) p.name = String(o['1']);
  if (o['2'] != null) p.desc = String(o['2']);
  if (o['3'] != null) p.reward = String(o['3']);
  if (o['4'] != null) p.penalty = String(o['4']);
  if (o['5'] != null) p.status = String(o['5']);
  if (o['startTime'] != null) p.startTime = String(o['startTime']);
  if (o['endTime'] != null) p.endTime = String(o['endTime']);
  applyQuestFields(p, o);
  if (o.rating != null || o['评分'] != null) p.rating = String(o.rating ?? o['评分']);
  return p;
}

export function applyMiscCommands(reply: string, opts: { allowLarge?: boolean; taskGuard?: boolean; domain?: 'all' | 'tasks' | 'world'; narrative?: string } = {}): number {
  const allowLarge = opts.allowLarge !== false;   // 默认允许；非大总结周期传 false，丢弃 AI 误输出的大总结
  // 域过滤（任务演化与杂项演化拆成两个独立阶段后，各自只应用自己域的指令，互不越权）：
  //   'tasks' = 只应用 T_ 任务四类指令（set/add/de/ringAdvance），其余（总结/时间/天气/大事/truths/canon*/contractors）静默丢弃 —— 任务演化阶段用
  //   'world' = 应用除任务外的全部指令，任务指令静默丢弃 —— 杂项演化阶段用
  //   缺省 'all' = 全部应用（手动生成任务、旧调用路径行为不变）
  const dom = opts.domain ?? 'all';
  const doTasks = dom !== 'world';
  const doWorld = dom !== 'tasks';
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  const M = useMisc.getState();
  // 任务闸门（questGuard）：AI 侧护栏，默认开；玩家主动路径（manualGenTask 等）传 taskGuard:false 全豁免
  const guardOn = opts.taskGuard !== false;
  const lockOn = guardOn && M.settings.questGuardLock !== false;         // AI 结构锁：已建档任务只许推进
  const sideMax = M.settings.questSideMax ?? 4;                          // 在场支线上限（0=不限）
  const perRound = M.settings.questNewPerRound ?? 1;                     // 每轮新建配额（0=不限）
  let tasksCreated = 0;                                                  // 本轮已放行的新建条数
  // 环推进闸门（questAdvanceGate·治"部分完成就乱推/跳环/整条报完成"；纯函数在 questGuard.ts）
  const advOn = guardOn && M.settings.questAdvanceGate !== false;
  const jumpMax = M.settings.questRingJumpMax ?? 1;                      // 每轮每任务最多翻 done/skipped 的环数（0=不限）
  const roundRingOps = new Set<string>();                                // 本轮已做过环操作的任务（每轮每任务最多一种环操作）
  /* 对既有任务的更新载荷套推进闸：环状态单向+跨环限幅+每轮一种环操作+成功结算闸；被驳回的字段剔除并记仲裁 */
  const applyAdvanceGates = (existing: MiscTask, p0: Partial<MiscTask>): Partial<MiscTask> => {
    if (!advOn) return p0;
    let p = p0;
    if (p.rings !== undefined || p.currentRing !== undefined) {
      if (roundRingOps.has(existing.id)) {
        p = { ...p }; delete p.rings; delete p.currentRing;
        logArbitration(`任务 ${existing.id}`, '环状态调整驳回：单条任务每轮最多一种环操作（本轮已动过环）');
      } else {
        const g = gateRingsPatch(existing, p, jumpMax);
        if (g.dropped.length) logArbitration(`任务 ${existing.id}`, `环推进闸驳回：${g.dropped.join('；')}`);
        p = g.patch;
        if (g.flips > 0) roundRingOps.add(existing.id);
      }
    }
    // 整条成功结算闸：以"环状态更新落地后"的任务状态判定（AI 同一条指令里推完终局环再结算是合法的）
    if (p.status != null && isTerminalTaskStatus(p.status)) {
      const after = Array.isArray(p.rings) && existing.rings?.length
        ? { ...existing, rings: mergeRings(existing.rings, p.rings) } : existing;
      const reason = gateTaskSettle(after, String(p.status));
      if (reason) {
        p = { ...p }; delete p.status;
        logArbitration(`任务 ${existing.id}`, `整条成功结算驳回：${reason}（任务保持进行中；确已完成可在任务面板手动结算）`);
      }
    }
    return p;
  };
  // 世界大事「地点」补全所处世界前缀：让地点成为「所处世界 … 具体位置」的完整路径（如「生化危机2 浣熊市 警察局 二楼回廊」）。
  // 已含当前世界名则不重复前缀；地点为空则不强加。
  const withWorld = (loc: string) => {
    const wn = (M.worldName || '').trim();
    const l = (loc || '').trim();
    if (!wn || !l) return l;
    return l.includes(wn) ? l : `${wn} ${l}`;
  };
  // 本块是否切换了世界（timeLocation.worldName 写了别的世界名）→ 世界钟「只进不退」闸整块跳过（新旧世界时间不可比）
  const blockSwitchesWorld = (() => {
    const mm = /^\s*timeLocation\.worldName\s*=\s*"([^"]*)"\s*$/m.exec(block);
    return !!mm && mm[1].trim() !== (M.worldName || '').trim();
  })();
  let n = 0;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;

    if (doWorld && (m = /^addSmallSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) { M.pushSmall(unquote(m[1])); n++; continue; }
    if (doWorld && (m = /^addLargeSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) { if (allowLarge) { M.pushLarge(unquote(m[1])); n++; } continue; }

    // 已确立真相清单（世界真相周期强化数据源·覆盖式 ≤12 条·非数组静默忽略；见 systems/plotThreads）
    if (doWorld && (m = /^truths\(\s*(\[[\s\S]*?\])\s*\)$/.exec(line))) {
      const arr = lenientJsonParse(m[1]);
      if (Array.isArray(arr)) { M.setTruths(arr.map((t: unknown) => String(t ?? ''))); n++; }
      continue;
    }

    // 🗓 世界历（节日/生日/纪念日）：`almanac([{...},...])` 增量落库（同名同世界→更新），
    //    `almanacRemove("名")` 删一条。数据进 calendarStore；纯前端消费（楼层信息条七天格 + 临近日子注入）。
    //    ⚠ 挂在杂项阶段里、**不新增 API 调用**；条目为空时下游注入整块不出现，零 token 浪费。
    if (doWorld && (m = /^almanac\(\s*(\[[\s\S]*?\])\s*\)$/.exec(line))) {
      const arr = lenientJsonParse(m[1]);
      if (Array.isArray(arr)) { const k = useCalendar.getState().applyMany(arr, M.worldName); if (k) n++; }   // 传当前世界名：AI 漏写 world 时归本世界，别变成跨世界跟着到处跑
      continue;
    }
    if (doWorld && (m = /^almanacRemove\(\s*"([\s\S]*?)"\s*\)$/.exec(line))) {
      if (useCalendar.getState().removeByName(unquote(m[1]))) n++;
      continue;
    }

    // 🛤 原著路线状态维护（仅模式开启时生效；canon* 前缀短路，不与其他指令冲突）
    if (doWorld && (m = /^canonPhase\(\s*(\d+)\s*\)$/.exec(line))) {
      const CR = useCanonRoute.getState();
      if (CR.enabled) {
        const station = CANON_STATIONS[CR.stationIndex];
        const maxLen = Math.max(1, station?.suxiao.track.length ?? 1);
        const next = Math.min(Number(m[1]), CR.worldPhase + 2, maxLen);   // 只进不退·单轮最多+2·不超本站轨道长度
        if (next > CR.worldPhase) { CR.setWorldPhase(next); n++; }
      }
      continue;
    }
    if (doWorld && (m = /^canonDivergence\(\s*(\d+)\s*(?:,\s*"[\s\S]*?"\s*)?\)$/.exec(line))) {
      const CR = useCanonRoute.getState();
      if (CR.enabled) { CR.setDivergence(Number(m[1])); n++; }
      continue;
    }
    if (doWorld && (m = /^canonSuxiao\(\s*"(on-track|derailed|allied|dead)"\s*(?:,\s*"([\s\S]*?)"\s*)?\)$/.exec(line))) {
      const CR = useCanonRoute.getState();
      if (CR.enabled) {
        const state = m[1] as 'on-track' | 'derailed' | 'allied' | 'dead';
        const note = m[2] ? unquote(m[2]).slice(0, 120) : '';
        const station = CANON_STATIONS[CR.stationIndex];
        const where = station ? `${station.name}·阶段${CR.worldPhase}` : '';
        if (state === 'derailed') CR.setSuxiao({ state, derailedAt: note ? `${where}：${note}` : where, note: note || undefined });
        else CR.setSuxiao({ state, note: note || undefined });
        if (state === 'dead') { try { grantCanonAchievement('slain'); } catch { /* */ } }   // ☠ 击杀白夜 → 传说级隐藏成就
        n++;
      }
      continue;
    }
    if (doWorld && (m = /^canonEncounter\(\s*"([\s\S]+?)"\s*\)$/.exec(line))) {
      const CR = useCanonRoute.getState();
      const station = CANON_STATIONS[CR.stationIndex];
      if (CR.enabled && station) { CR.addEncounter(station.id, unquote(m[1]).slice(0, 80)); n++; }
      continue;
    }
    if (doWorld && (m = /^canonChecklist\(\s*"([\s\S]+?)"\s*\)$/.exec(line))) {
      const CR = useCanonRoute.getState();
      const station = CANON_STATIONS[CR.stationIndex];
      if (CR.enabled && station) {
        // 模糊对上〈本站剧本〉列出的原著支线/隐藏/猎杀条目才打勾（存原文条目串，路线图据此 ✅），对不上则忽略防垃圾
        const cn = (x: string) => x.replace(/[\s·•・\-—_,，。、|｜()（）【】「」：:*＊]/g, '').toLowerCase();
        const arg = cn(unquote(m[1]));
        const cands = [...(station.world.sideMissions ?? []), ...(station.world.triggerQuests ?? [])];
        const hitEntry = arg ? cands.find((c) => { const e = cn(c); return e.includes(arg) || arg.includes(e.slice(0, 16)); }) : undefined;
        if (hitEntry) {
          const first = !(CR.stations[station.id]?.checklist ?? []).includes(hitEntry);
          CR.tickChecklist(station.id, hitEntry);
          if (first) {   // 首次打勾发成就；条目里记着「苏晓放弃/未做」→ 额外淡金隐藏成就（他放弃的路，你走完了）
            try {
              grantCanonAchievement('checklist', { station, entry: hitEntry });
              if (/放弃|未接|未做/.test(hitEntry)) grantCanonAchievement('abandoned', { station, entry: hitEntry });
            } catch { /* */ }
          }
          n++;
        }
      }
      continue;
    }

    // 世界钟只进不退（P0·evoGuard.guardTimeAdvance）：确定倒退的 AI 写入丢弃（保留原值+记一致性日志），认不出格式=放行。
    //   跳过比对的两种情况：① 本块同时切了 worldName（换世界，新旧时间不可比）；② 身处乐园（worldTime 由「回归乐园·时间一致」同步治理）。
    //   手动改时间走 MiscManager 面板，不经解析器、不受此闸。
    if (doWorld && (m = /^timeLocation\.paradiseTime\s*=\s*"([^"]*)"$/.exec(line))) {
      if (!guardTimeAdvance('轮回历', M.paradiseTime, m[1])) { M.setTime({ paradiseTime: m[1] }); n++; }
      continue;
    }
    if (doWorld && (m = /^timeLocation\.worldTime\s*=\s*"([^"]*)"$/.exec(line))) {
      const skipClamp = blockSwitchesWorld || isHomeWorld(M.worldName || '');
      if (skipClamp || !guardTimeAdvance('世界时间', M.worldTime, m[1])) { M.setTime({ worldTime: m[1] }); n++; }
      continue;
    }
    if (doWorld && (m = /^timeLocation\.worldName\s*=\s*"([^"]*)"$/.exec(line)))    {
      const prevWorld = M.worldName;   // 本次解析前的世界名（M 为快照，setTime 后仍是旧值）
      M.setTime({ worldName: m[1] });
      // 回到轮回乐园/枢纽（从任务世界返回）→ 重置主角「身份」，避免把上个世界的身份带进下个世界
      if (isHomeWorld(m[1]) && !isHomeWorld(prevWorld) && usePlayer.getState().profile.identity) {
        usePlayer.getState().setProfile({ identity: '' });
      }
      n++; continue;
    }
    if (doWorld && (m = /^timeLocation\.weather\s*=\s*"([^"]*)"$/.exec(line)))      { M.setWeather(m[1]); n++; continue; }
    // 本世界其他契约者人口：contractors(数量) 或 contractors(数量, "分布/变动说明")
    if (doWorld && (m = /^contractors\(\s*(\d+)\s*(?:,\s*"([\s\S]*?)"\s*)?\)$/.exec(line))) { M.setContractors(Number(m[1]), m[2] != null ? unquote(m[2]) : undefined); n++; continue; }

    if (doWorld && (m = /^addWorldEvent\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.addWorldEvent({ time: m[1], location: withWorld(m[2]), desc: unquote(m[3]) }); n++; continue;
    }
    if (doWorld && (m = /^updateWorldEvent\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.updateWorldEvent(m[1], { time: m[2], location: withWorld(m[3]), desc: unquote(m[4]) }); n++; continue;
    }
    if (doWorld && (m = /^deleteWorldEvent\(\s*"([^"]+)"\s*\)$/.exec(line))) { M.removeWorldEvent(m[1]); n++; continue; }

    // ── 世界事件生命周期（systems/worldEvent.ts）──
    // newEvent("事件名", {档位,地点,参与,结算条件,首节}) —— 建带生命周期的事件（旧的三参 addWorldEvent 仍兼容）
    if (doWorld && (m = /^newEvent\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p) {
        const sc = String(p.scope ?? p['档位'] ?? p['范围'] ?? '');
        const first = String(p.text ?? p['首节'] ?? p['进展'] ?? p['描述'] ?? '');
        const vis = normVisibility(String(p.visibility ?? p['可见性'] ?? ''));   // P1：认不出=不落字段（缺省 known）
        M.addWorldEvent({
          time: String(p.date ?? p['日期'] ?? ''), location: withWorld(String(p.location ?? p['地点'] ?? '')),
          desc: first, name: m[1],
          scope: /背景|background/i.test(sc) ? 'background' : 'region',
          actors: String(p.actors ?? p['参与'] ?? p['参与角色'] ?? '') || undefined,
          settleCond: String(p.settleCond ?? p['结算条件'] ?? '') || undefined,
          chain: first ? [{ date: String(p.date ?? p['日期'] ?? ''), text: first }] : [],
          ...(vis ? { visibility: vis } : {}),
          publicTrace: String(p.publicTrace ?? p['表象'] ?? p['公开痕迹'] ?? '') || undefined,
          knownBy: String(p.knownBy ?? p['知情者'] ?? p['知情人'] ?? '') || undefined,
          due: String(p.due ?? p['到期'] ?? p['预计结算'] ?? '') || undefined,
        });
        n++;
      }
      continue;
    }
    // eventChain("W_1", "本期进展") —— **只追加**一节脉络，绝不覆盖既有描述
    if (doWorld && (m = /^eventChain\(\s*"(W_\d+)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.appendEventChain(m[1], { text: unquote(m[2]) }); n++; continue;
    }
    // settleEvent("W_1", "historic|derived|faded", "落幕陈述")
    if (doWorld && (m = /^settleEvent\(\s*"(W_\d+)"\s*,\s*"([^"]+)"\s*(?:,\s*"([\s\S]*)"\s*)?\)$/.exec(line))) {
      const o = /historic|重大|历史/i.test(m[2]) ? 'historic' : /derived|派生|后续/i.test(m[2]) ? 'derived' : 'faded';
      M.settleWorldEvent(m[1], o, m[3] ? unquote(m[3]) : undefined); n++; continue;
    }
    // setEvent("W_1", {结算条件,参与,地点,档位,可见性,表象,知情者,到期}) —— 只改根字段，不动脉络
    if (doWorld && (m = /^setEvent\(\s*"(W_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p) {
        const patch: Partial<WorldEvent> = {};
        const nm = p.name ?? p['名称']; if (nm) patch.name = String(nm);
        const sd = p.settleCond ?? p['结算条件']; if (sd) patch.settleCond = String(sd);
        const ac = p.actors ?? p['参与'] ?? p['参与角色']; if (ac) patch.actors = String(ac);
        const lo = p.location ?? p['地点']; if (lo) patch.location = withWorld(String(lo));
        const sc = p.scope ?? p['档位'] ?? p['范围'];
        if (sc) patch.scope = /背景|background/i.test(String(sc)) ? 'background' : 'region';
        // P1：可见性/表象/知情者/到期（reveal 不开放给 AI 直改——只能走 settleEvent 建、eventRevealed 递交）
        const vi = normVisibility(String(p.visibility ?? p['可见性'] ?? '')); if (vi) patch.visibility = vi;
        const pt = p.publicTrace ?? p['表象'] ?? p['公开痕迹']; if (pt) patch.publicTrace = String(pt);
        const kb = p.knownBy ?? p['知情者'] ?? p['知情人']; if (kb) patch.knownBy = String(kb);
        const du = p.due ?? p['到期'] ?? p['预计结算']; if (du) patch.due = String(du);
        if (Object.keys(patch).length) { M.updateWorldEvent(m[1], patch); n++; }
      }
      continue;
    }
    // eventRevealed("W_1") —— 杂项 AI 判断"本轮正文已自然带出该落幕事件的结果" → 显露递交完成（P1·worldEvent.ts）
    if (doWorld && (m = /^eventRevealed\(\s*"(W_\d+)"\s*\)$/.exec(line))) {
      const ev = useMisc.getState().worldEvents.find((w) => w.id === m![1]);
      if (ev?.reveal && ev.reveal.state !== 'delivered') { M.updateWorldEvent(m[1], { reveal: { ...ev.reveal, state: 'delivered' } }); n++; }
      continue;
    }

    // ── 传闻流变（systems/rumor.ts）──
    // addRumor("传闻名", {影响力,流传范围,真相,传闻,偏差,诱因,时效}) —— 新建，首节点写在同一条里
    if (doWorld && (m = /^addRumor\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p) {
        M.addRumor({
          name: m[1],
          impact: String(p.impact ?? p['影响力'] ?? ''),
          scope: String(p.scope ?? p['流传范围'] ?? ''),
          node: {
            truth: String(p.truth ?? p['真相'] ?? ''), told: String(p.told ?? p['传闻'] ?? p['传闻描述'] ?? ''),
            drift: String(p.drift ?? p['偏差'] ?? p['事实偏差'] ?? ''), cause: String(p.cause ?? p['诱因'] ?? p['流变诱因'] ?? ''),
            expire: String(p.expire ?? p['时效'] ?? p['预计时效'] ?? ''),
          },
        });
        n++;
      }
      continue;
    }
    // rumorNode("R_1", {...}) —— 已有传闻的新流变节点（**只 append 新编号**，绝不覆盖旧节点）
    if (doWorld && (m = /^rumorNode\(\s*"(R_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p) {
        M.appendRumorNode(m[1], {
          truth: String(p.truth ?? p['真相'] ?? ''), told: String(p.told ?? p['传闻'] ?? p['传闻描述'] ?? ''),
          drift: String(p.drift ?? p['偏差'] ?? p['事实偏差'] ?? ''), cause: String(p.cause ?? p['诱因'] ?? p['流变诱因'] ?? ''),
          expire: String(p.expire ?? p['时效'] ?? p['预计时效'] ?? ''),
        });
        n++;
      }
      continue;
    }
    // setRumor("R_1", {影响力,流传范围,名称}) —— 只改根字段，不动流变历程
    if (doWorld && (m = /^setRumor\(\s*"(R_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p) {
        const patch: Record<string, string> = {};
        const nm = p.name ?? p['名称']; if (nm) patch.name = String(nm);
        const im = p.impact ?? p['影响力']; if (im) patch.impact = String(im);
        const sc = p.scope ?? p['流传范围']; if (sc) patch.scope = String(sc);
        if (Object.keys(patch).length) { M.updateRumor(m[1], patch as never); n++; }
      }
      continue;
    }
    if (doWorld && (m = /^deleteRumor\(\s*"(R_\d+)"\s*\)$/.exec(line))) { M.removeRumor(m[1]); n++; continue; }

    // ── 经济气候（systems/economy.ts）──
    // setEconomy({"phase":"衰退","note":"...","commodities":[{"key":"粮食","supply":"紧缺","trend":"↑","note":"","driver":""}],"events":[...]})
    // ⚠ 物价指数(index)由前端按公式推进，**不接受** AI 写——写了也会被忽略。
    if (doWorld && (m = /^setEconomy\(\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[1]);
      const cur = M.economy;
      if (p && cur) {
        const patch: Partial<Economy> = {};
        const ph = p.phase ?? p['相位'] ?? p['经济气候']; if (ph) patch.phase = normPhase(String(ph));
        const nt = p.note ?? p['说明'] ?? p['驱动']; if (nt != null) patch.phaseNote = String(nt).slice(0, 60);
        if (Array.isArray(p.commodities ?? p['大宗'])) {
          const raw = (p.commodities ?? p['大宗']) as any[];
          const next = cur.commodities.map((c) => {
            const hit = raw.find((r) => normCommodityKey(String(r?.key ?? r?.['品类'] ?? '')) === c.key);
            if (!hit) return c;
            return {
              ...c,
              supply: normSupply(String(hit.supply ?? hit['供需'] ?? '')),
              trend: normTrend(String(hit.trend ?? hit['趋势'] ?? '')),
              note: String(hit.note ?? hit['行情'] ?? c.note).slice(0, 40),
              driver: String(hit.driver ?? hit['影响因素'] ?? c.driver).slice(0, 40),
            };
          });
          patch.commodities = next;
        }
        if (Array.isArray(p.events ?? p['经济事件'])) {
          const raw = (p.events ?? p['经济事件']) as any[];
          patch.events = raw
            .filter((x) => x && (x.name ?? x['名称']))
            .slice(0, ECON_EVENT_CAP)   // 上限由前端裁，不指望 AI 数
            .map((x) => ({
              name: String(x.name ?? x['名称']).slice(0, 24),
              desc: String(x.desc ?? x['描述'] ?? '').slice(0, 80),
              stage: (['酝酿', '推进中', '趋稳', '消退', '转折'] as const)
                .find((s) => String(x.stage ?? x['态势'] ?? '').includes(s)) ?? '推进中',
            }));
        }
        if (Object.keys(patch).length) { M.patchEconomy(patch); n++; }
      }
      continue;
    }

    if (doTasks && (m = /^ringAdvance\(\s*"(T_\d+)"\s*(?:,\s*(\{[\s\S]*\})\s*)?\)$/.exec(line))) {
      const tid = m[1];
      const pl = m[2] ? safeJson(m[2]) : null;
      const sv = pl?.summary ?? pl?.['总结'] ?? pl?.['行为总结'];
      const rt = pl?.rating ?? pl?.['评级'] ?? pl?.['评分'];
      const ev = pl?.evidence ?? pl?.['证据'] ?? pl?.['引用'];
      // 环推进闸门：每轮每任务一种环操作 + summary 必给 + evidence 正文原句锚定（推不动≠信息丢：summary 转存 progress）
      if (advOn) {
        const t = useMisc.getState().tasks.find((x) => x.id === tid);
        if (t) {
          if (roundRingOps.has(tid)) {
            logArbitration(`任务 ${tid}`, '环推进驳回：单条任务每轮最多一种环操作（本轮已动过环）');
            continue;
          }
          const reason = gateRingAdvance(t, {
            summary: sv != null ? String(sv) : undefined,
            evidence: ev != null ? String(ev) : undefined,
          }, opts.narrative);
          if (reason) {
            logArbitration(`任务 ${tid}`, `环推进驳回：${reason}（本环保持 active，本次已转为进度记录）`);
            if (sv != null && String(sv).trim()) M.updateTask(tid, { progress: String(sv).trim() });
            continue;
          }
          roundRingOps.add(tid);
        }
      }
      M.advanceRing(tid, pl ? { summary: sv != null ? String(sv) : undefined, rating: rt != null ? String(rt) : undefined } : undefined);
      n++; continue;
    }
    if (doTasks && (m = /^de\(\s*"(T_\d+)"\s*\)$/.exec(line))) {
      // 图书馆铁则「只存不删」：AI 的删除一律转为「作废」归档留底（面板可查、玩家可 ✏️ 复原），绝不物理删除；玩家在面板删除不受此限
      const tid = m[1];   // 先取出：m 是 let，闭包内 TS 不保证仍非 null（TS18047）
      if (useMisc.getState().tasks.some((t) => t.id === tid)) {
        M.settleTask(tid, '已作废');
        logArbitration(`任务 ${tid}`, '删除指令已转为「作废」归档留底（数据库只存不删）');
      }
      n++; continue;
    }
    if (doTasks && (m = /^set\(\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const o = safeJson(m[1]);
      if (o && typeof o['0'] === 'string' && /^T_\d+$/.test(o['0'])) {
        const id = o['0'] as string;
        const t = taskFromCols(o);
        const existing = useMisc.getState().tasks.find((x) => x.id === id);
        if (existing) {
          // 已建档任务的 set = 更新。AI 结构锁：只放行推进类字段（status/progress/rating/rings/currentRing），
          // 名称/描述/奖惩/时限/线别/终局冻结（环内容另有 mergeRings 冻结）；再过环推进闸（状态单向/跨环限幅/结算闸）。
          let p: Partial<MiscTask>;
          if (lockOn) {
            const { patch, dropped } = filterAiTaskPatch(existing, t);
            if (dropped.length) logArbitration(`任务 ${id}`, `结构锁驳回改写：${dropped.join('；')}（要改结构请在任务面板 ✏️ 手动编辑）`);
            p = applyAdvanceGates(existing, patch);
            M.updateTask(id, p);
          } else {
            // 闸门可能剔除 rings/status 等字段（delete 后键不存在），upsertTask 内部 {...旧,...新} 会自动保留旧值
            p = applyAdvanceGates(existing, t);
            M.upsertTask(p as MiscTask);
          }
          // 状态直接给的就是已结算（如 AI 一次性给出"已完成"任务）→ 立即归档；被结算闸剔除的状态不触发归档
          if (p.status != null && isTerminalTaskStatus(p.status)) M.settleTask(id, String(p.status));
          n++;
        } else {
          // 全新任务：布置闸（每轮配额 + 在场支线上限；主线/职业任务/进阶通告豁免——见 questGuard）
          const reason = guardOn ? gateNewAiTask(t, useMisc.getState().tasks, { sideMax, newPerRound: perRound, roundCreated: tasksCreated }) : null;
          if (reason) {
            logArbitration(`任务 ${id}`, `驳回新建「${t.name || id}」：${reason}`);
          } else {
            tasksCreated++;
            M.upsertTask(t);
            if (isTerminalTaskStatus(o['5'])) M.settleTask(id, String(o['5']));
            n++;
          }
        }
      }
      continue;
    }
    if (doTasks && (m = /^add\(\s*"(T_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const o = safeJson(m[2]);
      if (o) {
        const id = m[1];
        let p = patchFromCols(o);
        const existing = useMisc.getState().tasks.find((x) => x.id === id);
        if (existing && lockOn) {
          // AI 结构锁：add 增量更新同样只放行推进类字段
          const { patch, dropped } = filterAiTaskPatch(existing, p);
          if (dropped.length) logArbitration(`任务 ${id}`, `结构锁驳回改写：${dropped.join('；')}（要改结构请在任务面板 ✏️ 手动编辑）`);
          p = patch;
        }
        // 环推进闸：状态单向 + 跨环限幅 + 每轮一种环操作 + 强制环未全达成时驳回整条成功结算
        if (existing) p = applyAdvanceGates(existing, p);
        M.updateTask(id, p);
        // 任务被标记为完成/失败/放弃 → 移出进行中列表（归档），修复"完成后任务仍在"；被结算闸剔除的状态不触发归档
        if (p.status != null && isTerminalTaskStatus(p.status)) M.settleTask(id, String(p.status));
        n++;
      }
      continue;
    }
    // 其余（SCENE_MAP / 物品 / NPC 的 add 等）忽略
  }
  return n;
}

/* 提取本轮小/大总结（用于挂到当前 assistant 楼层，供叙事记忆三档注入）*/
export function extractTurnSummaries(reply: string): { small?: string; large?: string } {
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  let small: string | undefined;
  let large: string | undefined;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!small && (m = /^addSmallSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) small = unquote(m[1]);
    if (!large && (m = /^addLargeSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) large = unquote(m[1]);
  }
  return { small, large };
}

/* ── 多环显示 helper ── */
/* 当前目标：多环取 active 环 goal，否则退回 desc/name */
function activeGoal(t: MiscTask): string {
  if (Array.isArray(t.rings) && t.rings.length) {
    const a = t.rings.find((r) => r.status === 'active');
    if (a) return a.goal;
  }
  return t.desc || t.name;
}
/* 下一环提示（最小 idx 的 planned 环；优先 hint，退回 goal）*/
function nextRingHint(t: MiscTask): string {
  if (!Array.isArray(t.rings)) return '';
  const p = t.rings.filter((r) => r.status === 'planned').sort((a, b) => a.idx - b.idx)[0];
  return p ? (p.hint || p.goal || '') : '';
}
/* 环进度 "第N/共M环"（无 rings 返回空）*/
function ringProgress(t: MiscTask): string {
  if (!Array.isArray(t.rings) || !t.rings.length) return '';
  const total = Math.max(t.rings.length, ...t.rings.map((r) => r.idx));
  const cur = t.rings.find((r) => r.status === 'active');
  const pos = cur ? cur.idx : t.rings.filter((r) => r.status === 'done').length;
  return `第${pos}/共${total}环`;
}
/* 当前 active 环对象（取本环 reward/penalty 等；无环则 null）*/
function activeRing(t: MiscTask): QuestRing | null {
  if (!Array.isArray(t.rings) || !t.rings.length) return null;
  return t.rings.find((r) => r.status === 'active') ?? null;
}

/* ── 上下文序列化（注入杂项/结算阶段提示词）：多环任务展开完整路线图供对账 ── */
export function serializeTasks(tasks: MiscTask[]): string {
  if (tasks.length === 0) return '（无进行中任务）';
  return tasks.map((t) => {
    const prog = ringProgress(t);
    const head =
      `${t.id}｜[${t.prof ? '职业' : t.kind ?? '支线'}]${t.locked ? '🔒' : ''}${t.name}｜${t.status}` +
      (prog ? `｜${prog}` : '') +
      `｜${activeGoal(t)}` +
      (t.startTime || t.endTime ? `｜${t.startTime || '—'}~${t.endTime || '—'}` : '') +
      (t.progress ? `｜近况:${t.progress}` : '');
    if (!Array.isArray(t.rings) || !t.rings.length) return head;
    const ringsStr = t.rings
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((r) => `  环${r.idx}[${r.status}] ${r.goal}${r.hint ? `（提示:${r.hint}）` : ''}`)
      .join('\n');
    return head + (t.finale ? `\n  终局: ${t.finale}` : '') + '\n' + ringsStr;
  }).join('\n');
}

/* ── 结算对账序列化：已完成任务/已达成环的清单，仅在【结算任务】那一回合注入。
   平时已归档任务不进提示词、进行中任务的达成环也不单列，导致结算 AI 数不到"本世界已完成的任务/环" →
   结算时喂它一份如实清单：每条任务 + 逐环「目标·评级·主角行为总结·本环奖励」，供正文 API 据此逐环、逐任务核算发奖。
   接受 ArchivedTask（已归档）与普通 MiscTask（进行中但已达成若干环）混列。 */
export function serializeSettledTasks(tasks: (MiscTask | ArchivedTask)[]): string {
  if (!tasks.length) return '（无）';
  return tasks.map((t) => {
    const rings = Array.isArray(t.rings) ? [...t.rings].sort((a, b) => a.idx - b.idx) : [];
    const doneCnt = rings.filter((r) => r.status === 'done').length;
    const head = `${t.id}｜[${t.kind ?? '支线'}]${t.name}｜${t.status}` +
      (t.rating ? `｜整体评${t.rating}` : '') +
      (rings.length ? `｜${doneCnt}/${rings.length}环达成` : '') +
      (t.finale ? `｜终局:${t.finale}` : '');
    // 只列"已达成/已跳过"的环（未完成的环不进结算）
    const settledRings = rings.filter((r) => r.status === 'done' || r.status === 'skipped');
    if (!settledRings.length) return head;
    const ringLines = settledRings.map((r) =>
      `  环${r.idx}${r.rating ? `[评${r.rating}]` : ''}${r.status === 'skipped' ? '[跳过]' : ''} ${r.goal}` +
      (r.summary ? ` — 行为:${r.summary}` : '') +
      (r.reward ? `（本环预设奖励:${r.reward}）` : ''),
    ).join('\n');
    return head + '\n' + ringLines;
  }).join('\n');
}

/* ── 正文注入序列化：主线(重·含当前目标+下一步+终局) + 相关支线(轻·相关性排序+封顶) ──
   sceneText=当前地点/在场NPC，用于支线相关性排序；sideCap 封顶注入支线条数。 */
export function serializeQuestsForNarrative(
  tasks: MiscTask[],
  opts: { sideCap?: number; sceneText?: string } = {},
): string {
  const sideCap = opts.sideCap ?? 3;
  const mains = tasks.filter((t) => isMainQuest(t));
  let sides = tasks.filter((t) => !isMainQuest(t));
  // 相关性：与当前场景(地点/在场NPC)关键词重合优先，否则按最近优先
  const scene = (opts.sceneText ?? '').trim();
  if (scene) {
    const toks = scene.split(/[\s，。、,;；|｜]+/).filter((x) => x.length >= 2);
    const score = (t: MiscTask) => {
      const hay = `${t.name} ${activeGoal(t)}`;
      return toks.reduce((s, tok) => (hay.includes(tok) ? s + 1 : s), 0);
    };
    sides = sides
      .map((t) => ({ t, s: score(t) }))
      .sort((x, y) => y.s - x.s || y.t.addedAt - x.t.addedAt)
      .map((x) => x.t);
  } else {
    sides = sides.slice().sort((a, b) => b.addedAt - a.addedAt);
  }
  sides = sides.slice(0, Math.max(0, sideCap));

  const lines: string[] = [];
  if (mains.length) {
    lines.push('▼ 主线（剧情大方向·正文须据此推进当前环）');
    for (const t of mains) {
      const rings = Array.isArray(t.rings) ? t.rings : [];
      const greedy = rings.filter((r) => r.optional);
      const forcedAllDone = rings.some((r) => !r.optional) && rings.filter((r) => !r.optional).every((r) => r.status === 'done' || r.status === 'skipped');
      const inGreedy = greedy.some((r) => r.status === 'active');
      const nextGreedy = greedy.find((r) => r.status === 'planned');
      const prog = ringProgress(t);
      const ar = activeRing(t);
      if (forcedAllDone && nextGreedy && !inGreedy) {
        // 选择点：强制环全清＝主线已达成；给"见好就收 / 继续赌(贪婪环)"的抉择
        lines.push(`【${t.name}】✅ 主线已达成（强制环全清，可安全离场结算）。`);
        lines.push(`  · ⚖ 选择点：见好就收离场 / 接受隐藏委托·继续赌——贪婪环奖励预览：${nextGreedy.reward || '跳一大档的超额奖励'}；难度陡增、失败仅损失该额外奖励。把选择权交给主角、别替他决定。`);
      } else {
        const arType = ar?.optional ? '贪婪环(可选·失败仅丢本环额外奖励)' : '强制环(必经·失败=死亡或重罚)';
        lines.push(`【${t.name}】${prog ? prog + '：' : ''}[${ar ? arType : '主线'}] 当前环目标 → ${activeGoal(t)}`);
        if (ar?.reward) lines.push(`  · 本环奖励：${ar.reward}`);
        if (ar?.penalty) lines.push(`  · 本环惩罚：${ar.penalty}`);
        const hint = nextRingHint(t);
        if (hint) lines.push(`  · 完成本环后下一环走向：${hint}`);
      }
      if (t.progress) lines.push(`  · 上回合推进：${t.progress}`);
      if (t.finale) lines.push(`  · 终局(高潮)：${t.finale}`);
    }
  }
  if (sides.length) {
    lines.push('▼ 支线（相关场景/人物契合时按当前环目标推进）');
    for (const t of sides) {
      const ar = activeRing(t);
      const rp = [ar?.reward && `奖励:${ar.reward}`, ar?.penalty && `惩罚:${ar.penalty}`].filter(Boolean).join('｜');
      lines.push(`· ${t.name}：当前目标 ${activeGoal(t)}${rp ? `（${rp}）` : ''}`);
    }
  }
  return lines.join('\n');
}
export function serializeEvents(events: WorldEvent[]): string {
  if (events.length === 0) return '（无）';
  return events.slice(-10).map((e) => `${e.id}｜${e.time}｜${e.location}｜${e.desc}`).join('\n');
}
