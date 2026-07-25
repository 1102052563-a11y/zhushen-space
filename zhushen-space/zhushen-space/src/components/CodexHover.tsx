/* 正文关键词悬浮图鉴 · 悬浮卡宿主（2026-07-24）
   参考 Tyranny / Pillars of Eternity 的名词 tooltip：正文里的专有名词带虚线下划线，悬浮/点按弹百科卡。

   ⚠ 性能铁则（打字卡顿的教训）——本组件是**全局唯一一份**、挂在 App 里，但：
   - 不订阅任何 store（词条走 lookupCodex 的非响应式查表），故 store 写入不会经它引发重渲；
   - 不给每个 .zs-ent 挂 React 事件，而是在 document 上**委托监听**——正文里几十个实体名 = 0 个监听器，
     MessageRow 的行级 memo 完全不受影响（渲染器只吐静态 span，行内没有任何新 hook / 新订阅）；
   - 自身 state 变化只重渲这张卡（portal 到 body，不在楼层树里）。
   ⚠ 传进来的 onOpenNpc 必须是 App 侧 useCallback 的稳定引用。 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lookupCodex, type CodexAccent, type CodexEntry } from '../systems/codexIndex';
import { hasDetailDoc } from '../systems/codexDetail';

const HOVER_IN = 130;    // 悬停多久才弹（防扫视时满屏乱弹）
const HOVER_OUT = 180;   // 移开多久才收（留出「从词条挪到卡上」的时间）
const LONG_PRESS = 500;  // 长按多久直接进完整档案（手机主路径；桌面另有右键）
const CARD_W = 300;

/* 四色系。Tailwind 只收录源码里出现的**完整类名**，故这里写死全字面量，勿做片段拼接。 */
const ACCENT: Record<CodexAccent, { badge: string; name: string; ring: string }> = {
  person: { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', name: 'text-sky-200', ring: 'border-sky-500/30' },
  thing: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', name: 'text-amber-200', ring: 'border-amber-500/30' },
  power: { badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30', name: 'text-violet-200', ring: 'border-violet-500/30' },
  world: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', name: 'text-emerald-200', ring: 'border-emerald-500/30' },
};

interface Placement { x: number; y: number; w: number; below: boolean }

function place(el: HTMLElement): Placement {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 16);
  const below = r.bottom + 220 < vh || r.top < 240;              // 下方放不下且上方够 → 翻到上面
  const x = Math.min(Math.max(8, r.left - 8), Math.max(8, vw - w - 8));
  return { x, y: below ? r.bottom + 8 : r.top - 8, w, below };
}

function CodexHover({ onOpenNpc, onOpenDoc }: { onOpenNpc?: (npcId: string) => void; onOpenDoc?: (ek: string) => void }) {
  const [entry, setEntry] = useState<CodexEntry | null>(null);
  const [pos, setPos] = useState<Placement>({ x: 0, y: 0, w: CARD_W, below: true });
  const [pinned, setPinned] = useState(false);

  const inT = useRef<number | null>(null);
  const outT = useRef<number | null>(null);
  const overCard = useRef(false);
  const pinRef = useRef(false);
  pinRef.current = pinned;                                        // 供 document 监听器读到最新值（闭包里 state 会过期）
  const docRef = useRef(onOpenDoc);
  docRef.current = onOpenDoc;                                     // 同上：document 监听器只装一次，靠 ref 读最新回调

  const pressT = useRef<number | null>(null);
  const longFired = useRef(false);                                // 长按已触发 → 抑制随后那记 click（否则会顺手把卡片钉住）

  const clearIn = () => { if (inT.current) { clearTimeout(inT.current); inT.current = null; } };
  const clearOut = () => { if (outT.current) { clearTimeout(outT.current); outT.current = null; } };
  const clearPress = () => { if (pressT.current) { clearTimeout(pressT.current); pressT.current = null; } };
  const hide = useCallback(() => { clearIn(); clearOut(); clearPress(); setEntry(null); setPinned(false); overCard.current = false; }, []);

  useEffect(() => {
    const show = (span: HTMLElement, pin: boolean) => {
      const e = lookupCodex(span.dataset.ek || '');
      if (!e) return;                                             // 词条已不在档案里（实体被删）→ 静默不弹
      setEntry(e); setPos(place(span)); setPinned(pin);
    };
    const entOf = (t: EventTarget | null): HTMLElement | null => {
      const el = t as HTMLElement | null;
      return el && typeof el.closest === 'function' ? (el.closest('.zs-ent') as HTMLElement | null) : null;
    };

    const onOver = (e: MouseEvent) => {
      const span = entOf(e.target);
      if (!span || pinRef.current) return;                        // 钉住时不被扫过的词条抢走
      clearOut(); clearIn();
      inT.current = window.setTimeout(() => show(span, false), HOVER_IN);
    };
    const onOut = (e: MouseEvent) => {
      if (!entOf(e.target)) return;
      clearIn();
      if (pinRef.current) return;
      clearOut();
      outT.current = window.setTimeout(() => { if (!overCard.current) hide(); }, HOVER_OUT);
    };
    const onClick = (e: MouseEvent) => {
      if (longFired.current) { longFired.current = false; return; }    // 长按刚开过详情页，别再钉卡片
      const span = entOf(e.target);
      if (span) { clearIn(); clearOut(); show(span, true); return; }   // 点按 = 钉住（手机没有 hover，靠这条）
      const el = e.target as HTMLElement | null;
      if (el && typeof el.closest === 'function' && el.closest('.zs-codex-card')) return;
      hide();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onScroll = () => { clearPress(); hide(); };             // 滚动后位置会漂，直接收起

    /* 长按（手机）/ 右键（桌面）→ 直接进完整档案，跳过卡片这一步。
       只对有档案的词条生效；本档实体（NPC 等）照常走卡片底栏的「查看详情 →」。 */
    const docEkOf = (t: EventTarget | null): string | null => {
      const span = entOf(t);
      const ek = span?.dataset.ek || '';
      return ek && hasDetailDoc(ek) && docRef.current ? ek : null;
    };
    const openDoc = (ek: string) => { longFired.current = true; hide(); docRef.current?.(ek); };
    const onPressStart = (e: Event) => {
      const ek = docEkOf(e.target);
      if (!ek) return;
      clearPress();
      pressT.current = window.setTimeout(() => { pressT.current = null; openDoc(ek); }, LONG_PRESS);
    };
    const onCtx = (e: MouseEvent) => {
      const ek = docEkOf(e.target);
      if (!ek) return;
      e.preventDefault();
      openDoc(ek);
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPressStart);
    document.addEventListener('touchstart', onPressStart, { passive: true });
    document.addEventListener('mouseup', clearPress);
    document.addEventListener('touchend', clearPress);
    document.addEventListener('touchmove', clearPress, { passive: true });
    document.addEventListener('contextmenu', onCtx);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPressStart);
      document.removeEventListener('touchstart', onPressStart);
      document.removeEventListener('mouseup', clearPress);
      document.removeEventListener('touchend', clearPress);
      document.removeEventListener('touchmove', clearPress);
      document.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      clearIn(); clearOut(); clearPress();
    };
  }, [hide]);

  if (!entry) return null;
  const ac = ACCENT[entry.accent] ?? ACCENT.world;
  return createPortal(
    <div
      className={`zs-codex-card fixed rounded-xl border ${ac.ring} bg-panel/95 shadow-2xl shadow-black/60 backdrop-blur-sm overflow-hidden`}
      style={{ left: pos.x, top: pos.y, width: pos.w, zIndex: 200, transform: pos.below ? undefined : 'translateY(-100%)' }}
      onMouseEnter={() => { overCard.current = true; clearOut(); }}
      onMouseLeave={() => { overCard.current = false; if (!pinRef.current) { clearOut(); outT.current = window.setTimeout(hide, HOVER_OUT); } }}
    >
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
        {entry.img
          ? <img src={entry.img} alt="" className="w-10 h-10 rounded-lg object-cover border border-edge shrink-0" />
          : <span className="w-10 h-10 rounded-lg border border-edge bg-void/60 flex items-center justify-center text-lg shrink-0">{entry.icon}</span>}
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-semibold leading-tight truncate ${ac.name}`}>{entry.name}</div>
          {entry.meta && <div className="text-[11px] font-mono text-dim/70 mt-0.5 line-clamp-2 leading-snug">{entry.meta}</div>}
        </div>
        <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${ac.badge}`}>{entry.kindLabel}</span>
      </div>
      {entry.lines.length > 0 && (
        <div className="px-3 pb-2.5 space-y-1 border-t border-edge/60 pt-2">
          {entry.lines.map((l, i) => (
            <div key={i} className="text-[12px] text-slate-300/90 leading-relaxed">{l}</div>
          ))}
        </div>
      )}
      {(entry.spoiler || (entry.npcId && onOpenNpc) || (onOpenDoc && hasDetailDoc(entry.key))) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-edge/60 bg-void/40">
          {entry.spoiler && <span className="text-[10px] font-mono text-dim/50">📚 原著设定 · 或含剧透</span>}
          {onOpenDoc && hasDetailDoc(entry.key) && (
            <button
              onClick={() => { const k = entry.key; hide(); onOpenDoc(k); }}
              className="ml-auto text-[11px] font-mono text-god/80 hover:text-god transition-colors shrink-0"
            >完整档案 →</button>
          )}
          {entry.npcId && onOpenNpc && (
            <button
              onClick={() => { const id = entry.npcId!; hide(); onOpenNpc(id); }}
              className="ml-auto text-[11px] font-mono text-god/80 hover:text-god transition-colors"
            >查看详情 →</button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default memo(CodexHover);
