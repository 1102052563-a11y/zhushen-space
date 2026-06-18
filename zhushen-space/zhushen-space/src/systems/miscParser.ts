import { useMisc, isMainQuest, type MiscTask, type WorldEvent, type QuestRing } from '../store/miscStore';

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
    out.push({
      idx: Number.isFinite(Number(r.idx)) ? Number(r.idx) : i + 1,
      goal,
      hint: r.hint != null && String(r.hint).trim() ? String(r.hint).trim() : undefined,
      status,
      reward: r.reward != null ? String(r.reward) : undefined,
      penalty: r.penalty != null ? String(r.penalty) : undefined,
      optional: (r.optional === true || r.optional === 'true' || r.optional === 1) ? true : undefined,
      startTime: r.startTime != null ? String(r.startTime) : undefined,
      endTime: r.endTime != null ? String(r.endTime) : undefined,
    });
  });
  return out.length ? out : undefined;
}
/* 从任务载荷里提取多环字段，按存在与否条件写入（缺省不覆盖既有），并在给了 rings 没给 currentRing 时自动取 active 环 idx */
function applyQuestFields(target: Partial<MiscTask>, o: Record<string, any>): void {
  const kind = normKind(o.kind);
  if (kind) target.kind = kind;
  const rings = sanitizeRings(o.rings);
  if (rings) target.rings = rings;
  if (o.currentRing != null && Number.isFinite(Number(o.currentRing))) target.currentRing = Number(o.currentRing);
  if (o.finale != null && String(o.finale).trim()) target.finale = String(o.finale).trim();
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
/* 任务状态是否为"已结算"（完成/失败/放弃/结束）——用于把任务移出进行中列表。
   先排除明确的进行态（进行中/未完成/待…），再匹配结算关键词。*/
function isTerminalTaskStatus(s?: string): boolean {
  const t = String(s ?? '');
  if (/进行中|未完成|待执行|待完成|进行|执行中|跟进中/.test(t)) return false;
  return /已?完成|已达成|达成|成功|已?失败|失败|已?放弃|放弃|已结束|结束|作废|取消/.test(t);
}

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

export function applyMiscCommands(reply: string, opts: { allowLarge?: boolean } = {}): number {
  const allowLarge = opts.allowLarge !== false;   // 默认允许；非大总结周期传 false，丢弃 AI 误输出的大总结
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  const M = useMisc.getState();
  // 世界大事「地点」补全所处世界前缀：让地点成为「所处世界 … 具体位置」的完整路径（如「生化危机2 浣熊市 警察局 二楼回廊」）。
  // 已含当前世界名则不重复前缀；地点为空则不强加。
  const withWorld = (loc: string) => {
    const wn = (M.worldName || '').trim();
    const l = (loc || '').trim();
    if (!wn || !l) return l;
    return l.includes(wn) ? l : `${wn} ${l}`;
  };
  let n = 0;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;

    if ((m = /^addSmallSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) { M.pushSmall(unquote(m[1])); n++; continue; }
    if ((m = /^addLargeSummary\(\s*"([\s\S]*)"\s*\)$/.exec(line))) { if (allowLarge) { M.pushLarge(unquote(m[1])); n++; } continue; }

    if ((m = /^timeLocation\.paradiseTime\s*=\s*"([^"]*)"$/.exec(line))) { M.setTime({ paradiseTime: m[1] }); n++; continue; }
    if ((m = /^timeLocation\.worldTime\s*=\s*"([^"]*)"$/.exec(line)))    { M.setTime({ worldTime: m[1] }); n++; continue; }
    if ((m = /^timeLocation\.worldName\s*=\s*"([^"]*)"$/.exec(line)))    { M.setTime({ worldName: m[1] }); n++; continue; }
    if ((m = /^timeLocation\.weather\s*=\s*"([^"]*)"$/.exec(line)))      { M.setWeather(m[1]); n++; continue; }

    if ((m = /^addWorldEvent\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.addWorldEvent({ time: m[1], location: withWorld(m[2]), desc: unquote(m[3]) }); n++; continue;
    }
    if ((m = /^updateWorldEvent\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.updateWorldEvent(m[1], { time: m[2], location: withWorld(m[3]), desc: unquote(m[4]) }); n++; continue;
    }
    if ((m = /^deleteWorldEvent\(\s*"([^"]+)"\s*\)$/.exec(line))) { M.removeWorldEvent(m[1]); n++; continue; }

    if ((m = /^ringAdvance\(\s*"(T_\d+)"\s*\)$/.exec(line))) { M.advanceRing(m[1]); n++; continue; }
    if ((m = /^de\(\s*"(T_\d+)"\s*\)$/.exec(line))) { M.removeTask(m[1]); n++; continue; }
    if ((m = /^set\(\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const o = safeJson(m[1]);
      if (o && typeof o['0'] === 'string' && /^T_\d+$/.test(o['0'])) {
        M.upsertTask(taskFromCols(o));
        // 状态直接给的就是已结算（如 AI 一次性给出"已完成"任务）→ 立即归档
        if (isTerminalTaskStatus(o['5'])) M.settleTask(o['0'], String(o['5']));
        n++;
      }
      continue;
    }
    if ((m = /^add\(\s*"(T_\d+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const o = safeJson(m[2]);
      if (o) {
        M.updateTask(m[1], patchFromCols(o));
        // 任务被标记为完成/失败/放弃 → 移出进行中列表（归档），修复"完成后任务仍在"
        if (o['5'] != null && isTerminalTaskStatus(o['5'])) M.settleTask(m[1], String(o['5']));
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
  const total = t.rings.length;
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
      `${t.id}｜[${t.kind ?? '支线'}]${t.name}｜${t.status}` +
      (prog ? `｜${prog}` : '') +
      `｜${activeGoal(t)}` +
      (t.startTime || t.endTime ? `｜${t.startTime || '—'}~${t.endTime || '—'}` : '');
    if (!Array.isArray(t.rings) || !t.rings.length) return head;
    const ringsStr = t.rings
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((r) => `  环${r.idx}[${r.status}] ${r.goal}${r.hint ? `（提示:${r.hint}）` : ''}`)
      .join('\n');
    return head + (t.finale ? `\n  终局: ${t.finale}` : '') + '\n' + ringsStr;
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
