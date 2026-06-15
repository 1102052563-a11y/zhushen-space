import { useMisc, type MiscTask, type WorldEvent } from '../store/miscStore';

/* 杂项演化指令解析（不含小地图）
   只认 timeLocation.* / addSmall|LargeSummary / addWorldEvent.. / T_ 任务
   —— 用字面量前缀短路，避免与物品/NPC 的 add/set/de 冲突 */

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch {
    try { return JSON.parse(s.replace(/'/g, '"')); } catch { return null; }
  }
}
function unquote(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

function taskFromCols(o: Record<string, any>): MiscTask {
  return {
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
  return p;
}

export function applyMiscCommands(reply: string, opts: { allowLarge?: boolean } = {}): number {
  const allowLarge = opts.allowLarge !== false;   // 默认允许；非大总结周期传 false，丢弃 AI 误输出的大总结
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  const M = useMisc.getState();
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
      M.addWorldEvent({ time: m[1], location: m[2], desc: unquote(m[3]) }); n++; continue;
    }
    if ((m = /^updateWorldEvent\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([\s\S]*)"\s*\)$/.exec(line))) {
      M.updateWorldEvent(m[1], { time: m[2], location: m[3], desc: unquote(m[4]) }); n++; continue;
    }
    if ((m = /^deleteWorldEvent\(\s*"([^"]+)"\s*\)$/.exec(line))) { M.removeWorldEvent(m[1]); n++; continue; }

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

/* ── 上下文序列化（注入提示词）── */
export function serializeTasks(tasks: MiscTask[]): string {
  if (tasks.length === 0) return '（无进行中任务）';
  return tasks.map((t) =>
    `${t.id}｜${t.name}｜${t.status}｜${t.desc}` +
    (t.startTime || t.endTime ? `｜${t.startTime || '—'}~${t.endTime || '—'}` : '')
  ).join('\n');
}
export function serializeEvents(events: WorldEvent[]): string {
  if (events.length === 0) return '（无）';
  return events.slice(-10).map((e) => `${e.id}｜${e.time}｜${e.location}｜${e.desc}`).join('\n');
}
