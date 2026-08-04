import { describe, it, expect, beforeEach } from 'vitest';
import {
  cnNum, extractMonthDay, dayOfYear, monthDayFromDoy, itemCoversDoy, daysFrom, upcoming,
  sortByDate, visibleIn, dateLabel, DAYS_IN_YEAR, type AlmanacItem,
} from './calendar';
import { useCalendar, normalizeItem } from '../store/calendarStore';
// ⚠ 上面这行同时导入 store 与 normalizeItem：世界归属兜底（resolveWorld）在 store 层，
//    因为只有那里能同时看到「AI 给的原始键」与「当前世界名」。

const item = (p: Partial<AlmanacItem> & { name: string; month: number; day: number }): AlmanacItem => ({
  id: p.name, type: 'festival', days: 1, ...p,
});

describe('cnNum（中文数字 1..31）', () => {
  it('个位 / 十 / 十几 / 几十 / 几十几', () => {
    expect(cnNum('三')).toBe(3);
    expect(cnNum('十')).toBe(10);
    expect(cnNum('十五')).toBe(15);
    expect(cnNum('二十')).toBe(20);
    expect(cnNum('三十一')).toBe(31);
    expect(cnNum('7')).toBe(7);
  });
  it('认不出返回 NaN', () => {
    expect(cnNum('廿三')).toBeNaN();
    expect(cnNum('')).toBeNaN();
  });
});

describe('extractMonthDay（从世界时间串抠今天·零 API）', () => {
  it('M月D日：认得带前缀/后缀的异界纪年', () => {
    expect(extractMonthDay('斗罗历 2 月 17 日 · 卯时')).toEqual({ month: 2, day: 17 });
    expect(extractMonthDay('帝国历三年3月15日申时')).toEqual({ month: 3, day: 15 });
  });
  it('YYYY-M-D / YYYY年M月D日', () => {
    expect(extractMonthDay('2024-03-15 08:00')).toEqual({ month: 3, day: 15 });
    expect(extractMonthDay('1287/04/01')).toEqual({ month: 4, day: 1 });
  });
  it('中文数字：三月十五', () => {
    expect(extractMonthDay('大周 三月十五 巳时')).toEqual({ month: 3, day: 15 });
  });
  it('裸 M/D（优先级最低）', () => {
    expect(extractMonthDay('第二纪 7/4')).toEqual({ month: 7, day: 4 });
  });
  it('抠不出就返回 null——绝不瞎猜（无信号不动）', () => {
    expect(extractMonthDay('进入世界第 3 天')).toBeNull();
    expect(extractMonthDay('乐园时 07:12')).toBeNull();   // 时刻不是日期
    expect(extractMonthDay('')).toBeNull();
    expect(extractMonthDay(undefined)).toBeNull();
  });
  it('越界的月日视为认不出', () => {
    expect(extractMonthDay('13 月 40 日')).toBeNull();
  });
});

describe('dayOfYear / monthDayFromDoy（互逆·含闰日）', () => {
  it('边界与闰日', () => {
    expect(dayOfYear(1, 1)).toBe(1);
    expect(dayOfYear(2, 29)).toBe(60);
    expect(dayOfYear(12, 31)).toBe(DAYS_IN_YEAR);
    expect(monthDayFromDoy(1)).toEqual({ month: 1, day: 1 });
    expect(monthDayFromDoy(60)).toEqual({ month: 2, day: 29 });
    expect(monthDayFromDoy(DAYS_IN_YEAR)).toEqual({ month: 12, day: 31 });
  });
  it('越界序号按 366 环绕', () => {
    expect(monthDayFromDoy(DAYS_IN_YEAR + 1)).toEqual({ month: 1, day: 1 });
    expect(monthDayFromDoy(0)).toEqual({ month: 12, day: 31 });
  });
  it('全年往返一致', () => {
    for (let doy = 1; doy <= DAYS_IN_YEAR; doy++) {
      const md = monthDayFromDoy(doy);
      expect(dayOfYear(md.month, md.day)).toBe(doy);
    }
  });
});

describe('itemCoversDoy（多日节日·跨年环绕）', () => {
  it('单日只覆盖当天', () => {
    const it = item({ name: '七夕', month: 7, day: 7 });
    expect(itemCoversDoy(it, dayOfYear(7, 7))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(7, 8))).toBe(false);
  });
  it('长假覆盖连续 N 天', () => {
    const it = item({ name: '春祭', month: 3, day: 1, days: 5 });
    expect(itemCoversDoy(it, dayOfYear(3, 1))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(3, 5))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(3, 6))).toBe(false);
  });
  it('跨年长假（12/30 起 4 天）覆盖到次年 1/2', () => {
    const it = item({ name: '岁末', month: 12, day: 30, days: 4 });
    expect(itemCoversDoy(it, dayOfYear(12, 31))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(1, 1))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(1, 2))).toBe(true);
    expect(itemCoversDoy(it, dayOfYear(1, 3))).toBe(false);
  });
});

describe('daysFrom（未来七天格）', () => {
  it('7 格连续、offset 0..6、跨月跨年正确', () => {
    const items = [item({ name: '元旦', month: 1, day: 1 })];
    const cells = daysFrom({ month: 12, day: 29 }, items, 7);
    expect(cells).toHaveLength(7);
    expect(cells[0]).toMatchObject({ month: 12, day: 29, offset: 0 });
    expect(cells[2]).toMatchObject({ month: 12, day: 31, offset: 2 });
    expect(cells[3]).toMatchObject({ month: 1, day: 1, offset: 3 });
    expect(cells[3].items.map((i) => i.name)).toEqual(['元旦']);
    expect(cells[0].items).toEqual([]);
  });
});

describe('upcoming（未来 N 天内到期）', () => {
  const items = [
    item({ name: '今天就是', month: 5, day: 10 }),
    item({ name: '三天后', month: 5, day: 13 }),
    item({ name: '很久以后', month: 11, day: 1 }),
  ];
  it('按还有几天升序，窗口外的不报', () => {
    const out = upcoming(items, { month: 5, day: 10 }, 7);
    expect(out.map((u) => u.item.name)).toEqual(['今天就是', '三天后']);
    expect(out[0].inDays).toBe(0);
    expect(out[1].inDays).toBe(3);
  });
  it('长假首日已过但仍在会期内 → 记为 0（正在进行）', () => {
    const holiday = [item({ name: '连放五天', month: 5, day: 8, days: 5 })];
    const out = upcoming(holiday, { month: 5, day: 10 }, 3);
    expect(out).toHaveLength(1);
    expect(out[0].inDays).toBe(0);
  });
  it('刚过去的单日节日不再报（明年才轮到，超出窗口）', () => {
    const past = [item({ name: '昨天过完了', month: 5, day: 9 })];
    expect(upcoming(past, { month: 5, day: 10 }, 7)).toEqual([]);
  });
});

describe('visibleIn / sortByDate / dateLabel', () => {
  const items = [
    item({ name: '本世界节', month: 6, day: 1, world: '斗罗大陆' }),
    item({ name: '别的世界节', month: 2, day: 1, world: '海贼王' }),
    item({ name: '主角生日', month: 4, day: 1 }),
  ];
  it('只见本世界 + 跨世界', () => {
    expect(visibleIn(items, '斗罗大陆').map((i) => i.name)).toEqual(['本世界节', '主角生日']);
  });
  it('无世界名时只见跨世界的', () => {
    expect(visibleIn(items, '').map((i) => i.name)).toEqual(['主角生日']);
  });
  it('按月日排序', () => {
    expect(sortByDate(items).map((i) => i.name)).toEqual(['别的世界节', '主角生日', '本世界节']);
  });
  it('展示日期：优先本地写法，多日追加共N天', () => {
    expect(dateLabel(item({ name: 'x', month: 7, day: 7 }))).toBe('7月7日');
    expect(dateLabel(item({ name: 'x', month: 7, day: 7, displayDate: '七夕' }))).toBe('七夕');
    expect(dateLabel(item({ name: 'x', month: 3, day: 1, days: 5 }))).toBe('3月1日（共5天）');
  });
});

describe('calendarStore（AI 指令落库口径）', () => {
  beforeEach(() => { useCalendar.getState().clearAll(); });

  it('normalizeItem 夹取越界值、兜底非法 type、丢弃无名条目', () => {
    const n = normalizeItem({ name: ' 秋祭 ', type: '乱写', month: 99, day: 0, days: -3, note: 'x' });
    expect(n).toMatchObject({ name: '秋祭', type: 'custom', month: 12, day: 1, days: 1 });
    expect(normalizeItem({ name: '   ' })).toBeNull();
  });

  it('applyMany：同名同世界→更新（保留 id），不同世界→各存一条', () => {
    const s = useCalendar.getState();
    s.applyMany([{ name: '丰收祭', month: 9, day: 9, world: '斗罗大陆' }]);
    const firstId = useCalendar.getState().items[0].id;
    s.applyMany([{ name: '丰收祭', month: 9, day: 10, world: '斗罗大陆', note: '改期了' }]);
    let items = useCalendar.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: firstId, day: 10, note: '改期了' });

    s.applyMany([{ name: '丰收祭', month: 9, day: 9, world: '海贼王' }]);
    items = useCalendar.getState().items;
    expect(items).toHaveLength(2);
  });

  it('applyMany：名称归一化判重（空格/标点差异视为同一条）', () => {
    const s = useCalendar.getState();
    s.applyMany([{ name: '魂师大赛', month: 5, day: 1 }]);
    s.applyMany([{ name: ' 魂师·大赛 ', month: 5, day: 2 }]);
    expect(useCalendar.getState().items).toHaveLength(1);
    expect(useCalendar.getState().items[0].day).toBe(2);
  });

  /* worldScope 铁则：历是 world+paradise 混合作用域。AI 漏写 world 时若默认「跨世界」，
     本世界的节日会跟着主角进下一个世界并被注入正文 → 串味。故按「键在不在」兜底。 */
  it('★AI 没给 world 键 → 归当前任务世界（别变成跨世界跟着到处跑）', () => {
    useCalendar.getState().applyMany([{ name: '开炉祭', month: 2, day: 22 }], '斗罗大陆');
    expect(useCalendar.getState().items[0].world).toBe('斗罗大陆');
  });

  it('★显式写 world:"" → 尊重「跨世界」意图，不被兜底吃掉（面板取消勾选走的就是这条）', () => {
    useCalendar.getState().applyMany([{ name: '主角生日', month: 4, day: 1, world: '' }], '斗罗大陆');
    expect(useCalendar.getState().items[0].world).toBeUndefined();
  });

  it('★在乐园/枢纽时不兜底——那里建的本就该是跨世界的', () => {
    useCalendar.getState().applyMany([{ name: '契约者纪念日', month: 6, day: 1 }], '轮回乐园');
    expect(useCalendar.getState().items[0].world).toBeUndefined();
  });

  it('无当前世界名（老存档/未进世界）→ 不兜底', () => {
    expect(normalizeItem({ name: 'x', month: 1, day: 1 }, undefined, '')?.world).toBeUndefined();
  });

  it('removeByName 按归一化名字删；非数组/空入参不炸', () => {
    const s = useCalendar.getState();
    s.applyMany([{ name: '春祭', month: 3, day: 1 }, { name: '秋祭', month: 9, day: 1 }]);
    expect(s.removeByName('春·祭')).toBe(1);
    expect(useCalendar.getState().items.map((i) => i.name)).toEqual(['秋祭']);
    expect(s.applyMany([])).toBe(0);
    expect(s.applyMany(['垃圾', null, 123] as unknown[])).toBe(0);
  });
});
