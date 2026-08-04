import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMisc } from '../store/miscStore';
import { useTables } from '../store/tableStore';
import { useSettings } from '../store/settingsStore';
import { useCalendar } from '../store/calendarStore';
import { pickThreads, pickQuests, weatherGlyph } from '../systems/storyStrip';
import { extractMonthDay, visibleIn, daysFrom, sortByDate, dateLabel, TYPE_META, type AlmanacItem } from '../systems/calendar';

/* ══════════ 楼层信息条（贴在最新正文末尾的一条扁条）══════════
   借鉴 ST-SevenDaysCal「构画」的楼内条：状态别锁在右侧面板里等人点，直接贴到正文底下。
   四段：世界时间·天气 / 任务 / 伏笔 / 历（未来七天）；点某一段就地展开该段详情，再点收起。

   ⚠ 零 props + memo：App 每次重渲（打字/流式 100ms 合帧/任意 state 变化）都会走到这里，
     但零 props ⇒ memo 恒判「props 未变」⇒ 本组件整棵子树跳过，只有它自己订阅的 store 变了才重渲。
     **绝不要给它加 props**，否则就把 App 的高频重渲引进来了（见 CLAUDE.md「打字卡顿」教训）。
   ⚠ 纯只读展示：不调 API、不写 store、不参与注入。伏笔的 ⚠ 与正文里 <伏笔催收> 是同一口径，
     玩家看到的「久无进展」正是这一轮 AI 收到的催收清单；历的七天格与 <当前时空> 的「临近的日子」同源。 */

type Seg = 'quest' | 'thread' | 'almanac' | null;

const REL_LABEL = ['今天', '明天', '后天'];

/** 历条目一行（七天格展开 / 无锚点清单 共用） */
function AlmanacRow({ it, showDate }: { it: AlmanacItem; showDate: boolean }) {
  const meta = TYPE_META[it.type];
  return (
    <div className="leading-relaxed">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{meta.glyph}</span>
        <span className="text-slate-300">{it.name}</span>
        <span className="text-dim/50">{meta.label}</span>
        {showDate && <span className="text-dim/45">{dateLabel(it)}</span>}
        {it.world && <span className="text-dim/40">· {it.world}</span>}
      </div>
      {it.note && <div className="text-dim/50 pl-1">{it.note}</div>}
    </div>
  );
}

const StoryStrip = memo(function StoryStrip() {
  const cfg = useSettings(useShallow((s) => s.storyStrip));
  const time = useMisc(useShallow((s) => ({
    worldName: s.worldName, worldTime: s.worldTime, paradiseTime: s.paradiseTime, weather: s.weather,
  })));
  const turn = useMisc((s) => s.turnCount);
  const tasks = useMisc(useShallow((s) => s.tasks));
  const fsSheet = useTables((s) => s.tables['foreshadowing']);
  const almItems = useCalendar(useShallow((s) => s.items));
  const [open, setOpen] = useState<Seg>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);   // 七天格里展开的那一格（doy）

  const threads = useMemo(
    () => (cfg.thread ? pickThreads(fsSheet?.content, turn) : []),
    [cfg.thread, fsSheet?.content, turn],
  );
  const quests = useMemo(() => (cfg.quest ? pickQuests(tasks) : []), [cfg.quest, tasks]);

  // 历：先按世界过滤（本世界专属 + 跨世界），再从 worldTime 抠「今天」定位七天窗口。
  // 抠不出（如「进入世界第 3 天」）→ anchor=null，降级成按月日排的清单，不硬猜日期。
  const alm = useMemo(() => {
    if (!cfg.almanac) return { items: [] as AlmanacItem[], cells: null, covered: 0 };
    const items = visibleIn(almItems, time.worldName);
    if (!items.length) return { items, cells: null, covered: 0 };
    const anchor = extractMonthDay(time.worldTime) ?? extractMonthDay(time.paradiseTime);
    if (!anchor) return { items: sortByDate(items), cells: null, covered: items.length };
    const cells = daysFrom(anchor, items, 7);
    const covered = new Set(cells.flatMap((c) => c.items.map((i) => i.id))).size;
    return { items: sortByDate(items), cells, covered };
  }, [cfg.almanac, almItems, time.worldName, time.worldTime, time.paradiseTime]);

  if (!cfg.on) return null;
  const staleN = threads.filter((t) => t.stale).length;
  const timeText = time.worldTime || time.paradiseTime;
  const showTime = cfg.time && !!(timeText || time.weather);
  if (!showTime && !quests.length && !threads.length && !alm.items.length) return null;   // 全空 → 不打扰正文

  const toggle = (seg: Exclude<Seg, null>) => setOpen((cur) => (cur === seg ? null : seg));
  const segBtn = 'px-3 py-1.5 flex items-center gap-1.5 border-l border-edge first:border-l-0 hover:text-god transition-colors';
  const dayCell = alm.cells?.find((c) => c.doy === openDay);

  return (
    <div className="rounded-lg border border-edge bg-panel/30 text-[12px] font-mono text-dim select-none">
      <div className="flex items-stretch flex-wrap">
        {showTime && (
          <div className="px-3 py-1.5 flex items-center gap-1.5 min-w-0 flex-1">
            {time.weather && <span title={`天气：${time.weather}`}>{weatherGlyph(time.weather)}</span>}
            <span className="truncate text-dim/80">{[time.worldName, timeText, time.weather].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {quests.length > 0 && (
          <button onClick={() => toggle('quest')} className={segBtn} title="点击展开进行中的任务">
            <span className="text-god/70">任务</span>
            <span className="px-1 rounded bg-void/60 text-dim/80">{quests.length}</span>
            <span className={`transition-transform ${open === 'quest' ? 'rotate-180' : ''}`}>▾</span>
          </button>
        )}
        {threads.length > 0 && (
          <button onClick={() => toggle('thread')} className={segBtn} title="点击展开未回收的伏笔（⚠=久无进展，本回合已催收 AI）">
            <span className="text-god/70">伏笔</span>
            <span className="px-1 rounded bg-void/60 text-dim/80">{threads.length}</span>
            {staleN > 0 && <span className="text-amber-400/90" title={`${staleN} 条久无进展，已在本回合催收`}>⚠{staleN}</span>}
            <span className={`transition-transform ${open === 'thread' ? 'rotate-180' : ''}`}>▾</span>
          </button>
        )}
        {alm.items.length > 0 && (
          <button onClick={() => toggle('almanac')} className={segBtn}
            title={alm.cells ? '点击展开未来七天（有日子的格子可再点开看当天）' : '点击展开本世界的节日/生日/纪念日（当前世界时间看不出月日，暂不排七天）'}>
            <span className="text-god/70">历</span>
            <span className="px-1 rounded bg-void/60 text-dim/80">{alm.cells ? alm.covered : alm.items.length}</span>
            {alm.cells && alm.covered > 0 && <span className="text-god/60" title="未来七天内有日子">·近</span>}
            <span className={`transition-transform ${open === 'almanac' ? 'rotate-180' : ''}`}>▾</span>
          </button>
        )}
      </div>

      {open === 'quest' && (
        <div className="border-t border-edge px-3 py-2 space-y-2">
          {quests.map((q) => (
            <div key={q.id} className="leading-relaxed">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={q.main ? 'text-god/90' : 'text-slate-300'}>{q.main ? '【主线】' : q.prof ? '【职业】' : '【支线】'}{q.name}</span>
                {q.ringTotal > 0 && <span className="text-dim/50">环 {q.ringIdx}/{q.ringTotal}</span>}
                {q.locked && <span className="text-dim/50" title="任务链已锁定，AI 只推进进度、不改结构">🔒</span>}
                {q.endTime && <span className="text-dim/45">截止 {q.endTime}</span>}
              </div>
              {q.ringGoal && <div className="text-dim/75 pl-1">◦ {q.ringGoal}</div>}
              {q.progress && <div className="text-dim/50 pl-1">进度：{q.progress}</div>}
            </div>
          ))}
        </div>
      )}

      {open === 'thread' && (
        <div className="border-t border-edge px-3 py-2 space-y-1.5">
          {threads.map((t) => (
            <div key={t.rowId} className="leading-relaxed">
              <div className="flex items-center gap-1.5 flex-wrap">
                {t.stale && <span className="text-amber-400/90" title={t.age === null ? '久远（早于日志留存期）无进展' : `已 ${t.age} 回合无进展`}>⚠</span>}
                <span className="text-slate-300">{t.title}</span>
                {t.state && <span className="text-dim/50">{t.state}</span>}
                {t.stale && <span className="text-amber-400/60">{t.age === null ? '久远' : `${t.age} 回合无进展`}</span>}
              </div>
              {t.expect && <div className="text-dim/50 pl-1">预期回收：{t.expect}</div>}
            </div>
          ))}
        </div>
      )}

      {open === 'almanac' && (
        <div className="border-t border-edge px-3 py-2 space-y-2">
          {alm.cells ? (
            <>
              {/* 未来七天格：相对日（今天/明天/后天/+N）+ 月/日，有条目的格子高亮打点、可点开 */}
              <div className="flex gap-1 overflow-x-auto">
                {alm.cells.map((c) => {
                  const has = c.items.length > 0;
                  const active = openDay === c.doy;
                  return (
                    <button
                      key={c.doy}
                      onClick={() => setOpenDay(active ? null : c.doy)}
                      disabled={!has}
                      title={has ? `${c.month}月${c.day}日 · ${c.items.length} 个日子` : `${c.month}月${c.day}日 · 无`}
                      className={`shrink-0 flex-1 min-w-[52px] px-1 py-1 rounded border text-center leading-tight transition-colors
                        ${active ? 'border-god/60 bg-god/10' : has ? 'border-god/30 bg-god/5 hover:border-god/50' : 'border-edge/60 bg-void/20 cursor-default'}`}
                    >
                      <div className={c.offset === 0 ? 'text-god/80' : has ? 'text-slate-300' : 'text-dim/40'}>
                        {REL_LABEL[c.offset] ?? `+${c.offset}`}
                      </div>
                      <div className={`text-[11px] ${has ? 'text-dim/70' : 'text-dim/35'}`}>{c.month}/{c.day}</div>
                      <div className="h-[10px] leading-[10px]">{has ? <span className="text-god/70">{TYPE_META[c.items[0].type].glyph}</span> : ''}</div>
                    </button>
                  );
                })}
              </div>
              {dayCell && (
                <div className="space-y-1.5 pt-1 border-t border-edge/60">
                  <div className="text-dim/60">{dayCell.month}月{dayCell.day}日{dayCell.offset === 0 ? '（今天）' : ` · ${REL_LABEL[dayCell.offset] ?? `${dayCell.offset} 天后`}`}</div>
                  {dayCell.items.map((it) => <AlmanacRow key={it.id} it={it} showDate={false} />)}
                </div>
              )}
              {alm.covered === 0 && <div className="text-dim/45">未来七天没有特别的日子</div>}
            </>
          ) : (
            <>
              <div className="text-dim/45">当前世界时间看不出月/日，暂不排七天；按日期列出本世界的日子：</div>
              {alm.items.map((it) => <AlmanacRow key={it.id} it={it} showDate />)}
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default StoryStrip;
