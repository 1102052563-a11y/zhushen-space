import { useMap } from '../store/mapStore';
import { usePlayer } from '../store/playerStore';
import { splitLocationPath } from './mapEngine';

/* 地图演化指令解析（照 miscParser 范式：字面量前缀短路 + 中英双键 + 宽松 JSON）。
   只认 discoverNode / setNode / linkNodes 三条；仅地图演化阶段调用，正文与其他阶段不解析。
   护栏在 mapEngine（状态只升不降 / 危险夹取 / 场所必须有区域 / 别名吸收），这里只管把行拆成调用。 */

/* 宽松 JSON（照 stateParser.lenientJsonParse 的阶梯策略，另容忍**中文裸键**——
   本阶段键名允许写中文（备注/危险/上级…），AI 常不带引号）。标准 JSON 先行，失败逐级放宽。 */
function safeJson(s: string): Record<string, unknown> | null {
  const quoteKeys = (x: string) => x.replace(/([{,]\s*)([A-Za-z_$一-鿿][\w$一-鿿]*)(\s*):/g, '$1"$2"$3:');
  const candidates = [s, s.replace(/'/g, '"'), quoteKeys(s), quoteKeys(s.replace(/'/g, '"'))];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* 试下一级放宽 */ }
  }
  return null;
}

export function applyMapCommands(reply: string, opts: { worldName: string; turn: number }): number {
  const block = (reply.match(/<upstore>([\s\S]*?)<\/upstore>/i)?.[1] ?? reply);
  const mp = useMap.getState();
  if (!mp.settings.enabled) return 0;
  const cap = Math.max(1, Math.floor(mp.settings.maxNewPerTurn || 5));
  // 场所缺 parent 时的兜底区域 = 主角当前所在区域（每回合 ingest 已保证它存在）
  const fallbackRegionName = splitLocationPath(usePlayer.getState().profile.location || '', opts.worldName)[0] ?? '';
  let created = 0;
  let n = 0;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^discoverNode\(\s*"([^"]+)"\s*(?:,\s*(\{[\s\S]*\})\s*)?\)$/.exec(line))) {
      const p = (m[2] ? safeJson(m[2]) : {}) ?? {};
      const r = mp.aiDiscover(opts.worldName, m[1], p, opts.turn, { fallbackRegionName, allowCreate: created < cap });
      if (r === 'created') { created++; n++; }
      else if (r === 'merged') n++;
      continue;
    }
    if ((m = /^setNode\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*\})\s*\)$/.exec(line))) {
      const p = safeJson(m[2]);
      if (p && mp.aiSet(opts.worldName, m[1], p, opts.turn)) n++;
      continue;
    }
    if ((m = /^linkNodes\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*(\{[\s\S]*\})\s*)?\)$/.exec(line))) {
      const p = (m[3] ? safeJson(m[3]) : {}) ?? {};
      if (mp.aiLink(opts.worldName, m[1], m[2], p)) n++;
      continue;
    }
  }
  return n;
}
