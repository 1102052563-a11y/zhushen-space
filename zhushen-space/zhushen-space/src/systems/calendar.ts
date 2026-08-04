/* ══════════ 世界历（节日 / 生日 / 纪念日）· 纯逻辑层 ══════════
   借鉴 ST-SevenDaysCal「构画」的「历」：一年之中**每年固定到期**的日子（节日/生日/纪念日），
   与「任务」这种一次性事项分开存——任务会结算掉，历不会。

   ⚠ 与插件的关键差异：插件必须**额外调一次 AI** 去猜「现在剧情演到几月几日」（ST 没有结构化时间）；
     本项目的 `miscStore.worldTime` 本来就由杂项演化每回合维护，所以这里
     **纯前端正则从 worldTime 抠月日，零 API 调用**。抠不出来就降级（不显示七天条、只按月日列清单）。

   ⚠ 历法只存 (月, 日)：年份在扮演里无意义。月长用固定的公历表**只为把 (月,日) 压成一个可比较、
     可做「未来七天」环绕运算的序号**，不代表世界真的用公历——异界写法（腊月廿三 / 火之月第三日）
     另存 `displayDate` 原样展示。 */

export type AlmanacType = 'festival' | 'birthday' | 'anniversary' | 'custom';

export interface AlmanacItem {
  id: string;
  name: string;
  type: AlmanacType;
  month: number;          // 1-12
  day: number;            // 1-31
  days: number;           // 持续天数（单日=1；长假填实际天数、month/day 填第一天）
  displayDate?: string;   // 给人看的写法（腊月廿三 / 七夕 / 火之月第三日）；空=用 M月D日
  note?: string;          // 一句话说明
  world?: string;         // 所属世界名；空=跨世界（乐园级，如契约者纪念日）
}

/* 月长表：固定含闰日（2月29），使 (月,日) → 序号 的映射对 2/29 也成立。总长 366。 */
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const DAYS_IN_YEAR = 366;
export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const TYPE_META: Record<AlmanacType, { label: string; glyph: string }> = {
  festival:    { label: '节日',   glyph: '🎊' },
  birthday:    { label: '生日',   glyph: '🎂' },
  anniversary: { label: '纪念日', glyph: '🕯' },
  custom:      { label: '其它',   glyph: '📌' },
};

export function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** (月, 日) → 年内序号 1..366。越界的月/日先夹取，保证永远返回合法序号。 */
export function dayOfYear(month: number, day: number): number {
  const mo = clampInt(month, 1, 12, 1);
  const da = clampInt(day, 1, DAYS_IN_MONTH[mo - 1], 1);
  let doy = da;
  for (let i = 0; i < mo - 1; i++) doy += DAYS_IN_MONTH[i];
  return doy;
}

/** 年内序号 → (月, 日)。入参可越界，按 366 环绕（未来七天跨年时用到）。 */
export function monthDayFromDoy(doy: number): { month: number; day: number } {
  let d = ((Math.floor(doy) - 1) % DAYS_IN_YEAR + DAYS_IN_YEAR) % DAYS_IN_YEAR + 1;
  for (let i = 0; i < 12; i++) {
    if (d <= DAYS_IN_MONTH[i]) return { month: i + 1, day: d };
    d -= DAYS_IN_MONTH[i];
  }
  return { month: 12, day: 31 };
}

// ─── 从世界时间串里抠出「今天是几月几日」（零 API）────────────────────────────
// 认得的写法：「2 月 17 日」「斗罗历 3月15日」「2024-03-15」「3/15」「三月十五」。
// 认不出（如「进入世界第 3 天」）→ null，调用方降级：不显示七天条，只按月日列清单。

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字 → 阿拉伯（只需覆盖 1..31：十/十一/二十/二十五/三十一）。认不出返回 NaN。 */
export function cnNum(s: string): number {
  const t = String(s || '').trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  const i = t.indexOf('十');
  if (i < 0) {   // 纯个位：三 → 3
    let v = 0;
    for (const ch of t) { const d = CN_DIGIT[ch]; if (d === undefined) return NaN; v = v * 10 + d; }
    return t.length ? v : NaN;
  }
  const head = t.slice(0, i), tail = t.slice(i + 1);
  const tens = head === '' ? 1 : CN_DIGIT[head];         // 十五=15、二十=20
  const ones = tail === '' ? 0 : CN_DIGIT[tail];
  if (tens === undefined || ones === undefined) return NaN;
  return tens * 10 + ones;
}

function valid(mo: number, da: number): { month: number; day: number } | null {
  if (!Number.isFinite(mo) || !Number.isFinite(da)) return null;
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return { month: mo, day: da };
}

/** 从自由中文时间串抠 (月, 日)。抠不出返回 null（不猜、不瞎填——「无信号不动」）。 */
export function extractMonthDay(text: string | undefined): { month: number; day: number } | null {
  const s = String(text || '').trim();
  if (!s) return null;
  let m: RegExpExecArray | null;
  // ① M月D日（最常见：「斗罗历 2 月 17 日 · 卯时」）
  if ((m = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(s))) return valid(+m[1], +m[2]);
  // ② YYYY-M-D / YYYY/M/D
  if ((m = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})/.exec(s))) return valid(+m[2], +m[3]);
  // ③ 中文数字：三月十五 / 腊月廿三 认不了廿，只认一~三十一
  if ((m = /([一二三四五六七八九十]{1,3})\s*月\s*([一二三四五六七八九十]{1,3})\s*[日号]?/.exec(s))) {
    return valid(cnNum(m[1]), cnNum(m[2]));
  }
  // ④ 裸 M/D（放最后：优先级最低，避免把别的数字对当日期）
  if ((m = /(?:^|[^\d/:-])(\d{1,2})\/(\d{1,2})(?![\d/:-])/.exec(s))) return valid(+m[1], +m[2]);
  return null;
}

// ─── 覆盖判定 / 未来七天 ─────────────────────────────────────────────────────

/** 某历条目是否覆盖年内第 doy 天（多日节日按 366 环绕，跨年也算得对）。 */
export function itemCoversDoy(item: AlmanacItem, doy: number): boolean {
  const start = dayOfYear(item.month, item.day);
  const span = clampInt(item.days, 1, DAYS_IN_YEAR, 1);
  const offset = ((doy - start) % DAYS_IN_YEAR + DAYS_IN_YEAR) % DAYS_IN_YEAR;
  return offset < span;
}

export interface DayCell {
  doy: number;
  month: number;
  day: number;
  offset: number;          // 距今天几天（0=今天）
  items: AlmanacItem[];    // 覆盖这天的历条目
}

/** 从锚点起的连续 N 天（默认 7）；每格带上覆盖它的历条目。 */
export function daysFrom(anchor: { month: number; day: number }, items: AlmanacItem[], n = 7): DayCell[] {
  const base = dayOfYear(anchor.month, anchor.day);
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const doy = ((base - 1 + i) % DAYS_IN_YEAR) + 1;
    const md = monthDayFromDoy(doy);
    return { doy, month: md.month, day: md.day, offset: i, items: items.filter((it) => itemCoversDoy(it, doy)) };
  });
}

/** 未来 within 天内（含今天）将到期的条目，按「还有几天」升序。多日条目只报它的首日距离。 */
export function upcoming(items: AlmanacItem[], anchor: { month: number; day: number }, within = 7): { item: AlmanacItem; inDays: number }[] {
  const base = dayOfYear(anchor.month, anchor.day);
  const out: { item: AlmanacItem; inDays: number }[] = [];
  for (const it of items) {
    const span = clampInt(it.days, 1, DAYS_IN_YEAR, 1);
    const start = dayOfYear(it.month, it.day);
    const ahead = ((start - base) % DAYS_IN_YEAR + DAYS_IN_YEAR) % DAYS_IN_YEAR;   // 首日还有几天
    if (ahead <= within) { out.push({ item: it, inDays: ahead }); continue; }
    // 长假：首日已过但仍在会期内（如昨天开始、连放 5 天）→ 记为 0（正在进行）
    const since = ((base - start) % DAYS_IN_YEAR + DAYS_IN_YEAR) % DAYS_IN_YEAR;
    if (since < span) out.push({ item: it, inDays: 0 });
  }
  out.sort((a, b) => a.inDays - b.inDays || dayOfYear(a.item.month, a.item.day) - dayOfYear(b.item.month, b.item.day));
  return out;
}

/** 按月日排序（无锚点时的清单序）。 */
export function sortByDate(items: AlmanacItem[]): AlmanacItem[] {
  return items.slice().sort((a, b) => dayOfYear(a.month, a.day) - dayOfYear(b.month, b.day));
}

/** 本世界可见的历条目：本世界专属 + 跨世界（world 为空）。worldName 为空时只留跨世界的。 */
export function visibleIn(items: AlmanacItem[], worldName: string | undefined): AlmanacItem[] {
  const wn = String(worldName || '').trim();
  return items.filter((it) => {
    const w = String(it.world || '').trim();
    return !w || (!!wn && w === wn);
  });
}

/** 展示日期：优先异界写法，否则 M月D日（多日追加「共N天」）。 */
export function dateLabel(it: AlmanacItem): string {
  const base = String(it.displayDate || '').trim() || `${it.month}月${it.day}日`;
  const span = clampInt(it.days, 1, DAYS_IN_YEAR, 1);
  return span > 1 ? `${base}（共${span}天）` : base;
}
