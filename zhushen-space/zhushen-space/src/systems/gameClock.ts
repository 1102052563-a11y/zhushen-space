/* 游戏时钟解析：把杂项演化的"游戏时间字符串"与"时长描述"转成可比较的分钟数。
   用于限时状态(buff/debuff)的自动过期判定。解析尽力而为，解析不出返回 null（则退回回合制）。 */

/* 解析游戏时间字符串 → 绝对分钟数（年×365天 + 月×30天 + 日 + 时:分）。
   兼容："轮回历0001年01月01日 08:00"、"二战1943年5月3日 14:30"、"第3日 黄昏"等部分含数字的格式。 */
export function parseGameMinutes(s?: string | null): number | null {
  if (!s) return null;
  const y  = /(\d+)\s*年/.exec(s);
  const mo = /(\d+)\s*月/.exec(s);
  const d  = /(\d+)\s*[日号]/.exec(s);
  const hm = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(s);
  if (!y && !mo && !d && !hm) return null;   // 完全无数字时间，放弃
  const Y = y ? Number(y[1]) : 0;
  const Mo = mo ? Number(mo[1]) : 0;
  const D = d ? Number(d[1]) : 0;
  const H = hm ? Number(hm[1]) : 0;
  const Mi = hm ? Number(hm[2]) : 0;
  return (((Y * 365 + Mo * 30 + D) * 24) + H) * 60 + Mi;
}

/* 解析时长描述 → 分钟数。"5分钟"→5、"2小时"→120、"3天"→4320、"1天2小时"→累加。
   含"回合/turn"则返回 null（交给回合制处理）。解析不出也返回 null。 */
export function parseDurationMinutes(s?: string | null): number | null {
  if (!s) return null;
  if (/回合|turn/i.test(s)) return null;
  let total = 0; let matched = false;
  const day = /(\d+(?:\.\d+)?)\s*[天日]/.exec(s);   if (day) { total += Number(day[1]) * 1440; matched = true; }
  const hr  = /(\d+(?:\.\d+)?)\s*(?:小时|个?时|hours?|h)/.exec(s); if (hr) { total += Number(hr[1]) * 60; matched = true; }
  const min = /(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/.exec(s); if (min) { total += Number(min[1]); matched = true; }
  return matched ? Math.round(total) : null;
}

/* 解析"回合数"描述 → 回合数。"3回合"→3、"持续5回合"→5。无则 null。 */
export function parseDurationTurns(s?: string | null): number | null {
  if (!s) return null;
  const m = /(\d+)\s*回合/.exec(s);
  return m ? Number(m[1]) : null;
}

/* 把剩余分钟数格式化成简短可读串，用于胶囊展示。 */
export function fmtMinutes(min: number): string {
  if (min <= 0) return '即将结束';
  if (min < 60) return `${Math.ceil(min)}分钟`;
  if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return m ? `${h}时${m}分` : `${h}小时`; }
  const dDays = Math.floor(min / 1440); const h = Math.floor((min % 1440) / 60);
  return h ? `${dDays}天${h}时` : `${dDays}天`;
}
