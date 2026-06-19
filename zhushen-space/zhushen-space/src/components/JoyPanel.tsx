import { useState, useEffect, useRef, useMemo } from 'react';
import { useJoy, hydrateJoyPortraits, hydrateJoyWorldBooks, JOY_PRIVATE_COLS } from '../store/joyStore';
import { loadGirlManifest, pickStagePortrait, stageFromDesire, girlCardPortrait, type GirlManifest } from '../systems/joyGirls';
import { findJoyBook, quickInsertTitles } from '../systems/joyWorldBook';

/* 欢愉宫：大厅(看板娘迎宾) → 选妃(竖排立绘选择) → 包间(上立绘 / 下左聊天·右状态)。
   每轮对话由 App.onSend 调 AI、解析 <joy>、写 store；本面板按 store 响应式渲染。
   立绘 1215×832：选妃卡裁剪显示(object-cover)，包间立绘完整显示(object-contain)。*/

const RACE_EMOJI = (race = ''): string =>
  /蛇/.test(race) ? '🐍' : /火|法师|魔法/.test(race) ? '🔥' : /魅魔|梦魔/.test(race) ? '😈' : /精灵/.test(race) ? '🧝‍♀️'
  : /青楼|花魁|古/.test(race) ? '🏮' : '💋';

const STAGE_LABEL: Record<number, string> = { 1: '初见', 2: '微醺', 3: '沉沦', 4: '极致' };
const PER_PAGE = 4;   // 选妃每页竖卡数

function DesireBar({ desire }: { desire: number }) {
  const stage = stageFromDesire(desire);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-mono mb-1">
        <span className="text-pink-300/70">情欲值 · 第{stage}阶 {STAGE_LABEL[stage]}</span>
        <span className="text-pink-200/90">{desire} / 100</span>
      </div>
      <div className="h-2 rounded-full bg-void border border-edge overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-rose-500/70 via-pink-500/80 to-fuchsia-400/90 transition-all duration-500"
             style={{ width: `${Math.max(2, desire)}%` }} />
      </div>
    </div>
  );
}

export default function JoyPanel({
  onClose, onSend, onGreet,
}: {
  onClose: () => void;
  onSend: (girlId: string, text: string) => Promise<void>;
  onGreet: (madamId: string) => Promise<string>;
}) {
  const settings      = useJoy((s) => s.settings);
  const sessions      = useJoy((s) => s.sessions);
  const currentGirlId = useJoy((s) => s.currentGirlId);
  const selectMadam   = useJoy((s) => s.selectMadam);
  const enterGirl     = useJoy((s) => s.enterGirl);
  const leaveGirl     = useJoy((s) => s.leaveGirl);
  const resetSession  = useJoy((s) => s.resetSession);
  const setDesire     = useJoy((s) => s.setDesire);
  const worldBooks    = useJoy((s) => s.worldBooks);

  const girls = settings.girls;
  const madams = girls.filter((g) => g.isMadam);
  const madamPool = madams.length ? madams : girls;
  const madam = madamPool.find((g) => g.id === settings.selectedMadamId) ?? madamPool[0];

  const [view, setView] = useState<'lobby' | 'picker' | 'chamber'>(currentGirlId ? 'chamber' : 'lobby');
  const [manifest, setManifest] = useState<GirlManifest | null>(null);
  const [greetText, setGreetText] = useState('');
  const [greetLoading, setGreetLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chamberPortrait, setChamberPortrait] = useState<string | null>(null);
  const [quickKind, setQuickKind] = useState<'pose' | 'bdsm' | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const curGirl = girls.find((g) => g.id === currentGirlId) ?? null;
  const curSess = currentGirlId ? sessions[currentGirlId] : undefined;
  const desire = curSess?.desire ?? 0;
  const stage = stageFromDesire(desire);

  useEffect(() => {
    hydrateJoyPortraits();
    hydrateJoyWorldBooks();   // 确保内置世界书已加载，姿势/BDSM 快捷按钮才有标题
    loadGirlManifest().then(setManifest).catch(() => {});
  }, []);

  // 姿势 / BDSM 快捷按钮：从对应世界书提取可插入的条目标题
  const poseTitles = useMemo(() => quickInsertTitles(findJoyBook(worldBooks, 'pose')), [worldBooks]);
  const bdsmTitles = useMemo(() => quickInsertTitles(findJoyBook(worldBooks, 'bdsm')), [worldBooks]);
  const quickTitles = quickKind === 'pose' ? poseTitles : quickKind === 'bdsm' ? bdsmTitles : [];
  const insertQuick = (title: string) => setInput((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + ' ' + title : title));

  // 包间立绘：每回合 / 跨情欲阶段 / 换人 都重选（按阶段取图——拖动滑块同阶段内不闪图，跨阈值才换阶段）
  useEffect(() => {
    if (!curGirl) { setChamberPortrait(null); return; }
    setChamberPortrait(pickStagePortrait(manifest, curGirl.portraitFolder, desire) ?? curGirl.portrait ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, currentGirlId, stage, curSess?.turns]);

  // 聊天时立绘每 5 秒自动切换一张（在当前情欲阶段的多张图之间轮换，尽量不连续重复）
  useEffect(() => {
    if (view !== 'chamber' || !curGirl) return;
    const id = setInterval(() => {
      setChamberPortrait((prev) => {
        let url = pickStagePortrait(manifest, curGirl.portraitFolder, desire);
        for (let i = 0; i < 5 && url && url === prev; i++) url = pickStagePortrait(manifest, curGirl.portraitFolder, desire);
        return url ?? prev;
      });
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, manifest, currentGirlId, stage, curGirl?.portraitFolder]);

  // 聊天自动滚到底
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [curSess?.messages.length, sending]);

  // 立绘缓存：避免每次渲染都重新随机取图导致闪烁（仅在 manifest/人物/页/情欲阶段变化时重选）
  const madamPortrait = useMemo(
    () => (madam ? girlCardPortrait(manifest, madam, 0) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifest, madam?.id, madam?.portrait, madam?.portraitFolder],
  );
  const pagePortraits = useMemo(() => {
    const slice = girls.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    const out: Record<string, string | null> = {};
    for (const g of slice) out[g.id] = girlCardPortrait(manifest, g, sessions[g.id]?.desire ?? 0);
    return out;
  }, [manifest, page, girls, sessions]);

  const cycleMadam = (dir: 1 | -1) => {
    if (madamPool.length < 2) return;
    const i = Math.max(0, madamPool.findIndex((g) => g.id === madam?.id));
    selectMadam(madamPool[(i + dir + madamPool.length) % madamPool.length].id);
    setGreetText('');
  };

  const askGreet = async () => {
    if (greetLoading || !madam) return;
    setGreetLoading(true);
    try { const t = await onGreet(madam.id); if (t) setGreetText(t.trim()); }
    catch { /* ignore */ }
    finally { setGreetLoading(false); }
  };

  const confirmPick = () => {
    if (!picked) return;
    enterGirl(picked);
    setView('chamber');
    setInput('');
  };

  const backToLobby = () => { leaveGirl(); setView('lobby'); };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !currentGirlId) return;
    setInput('');
    setSending(true);
    try { await onSend(currentGirlId, text); }
    finally { setSending(false); }
  };

  const pageGirls = girls.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const maxPage = Math.max(0, Math.ceil(girls.length / PER_PAGE) - 1);

  return (
    <div className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-5xl h-[90vh] rounded-2xl border border-pink-500/30 bg-void shadow-[0_0_70px_rgba(244,114,182,0.18)] overflow-hidden flex flex-col">

        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-pink-500/20 bg-gradient-to-r from-pink-950/40 via-panel to-fuchsia-950/30">
          <span className="text-lg">💗</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-pink-100">欢愉宫</div>
            <div className="text-[11px] font-mono text-pink-300/50">
              {view === 'lobby' ? '大厅 · 迎宾' : view === 'picker' ? '选妃 · 今夜挑一位' : `包间 · ${curGirl?.name ?? ''}`}
            </div>
          </div>
          {view === 'chamber' && (
            <button onClick={backToLobby} className="text-[12px] font-mono px-2.5 py-1 rounded-lg border border-pink-500/30 text-pink-200/80 hover:bg-pink-500/10">← 回大厅</button>
          )}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg ml-1">✕</button>
        </header>

        {/* ══════════ 大厅 ══════════ */}
        {view === 'lobby' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-[56%] shrink-0 border-b border-pink-500/15 bg-panel2/30 p-3 flex flex-col min-h-0">
              <div className="flex items-center justify-center gap-4 mb-2 shrink-0">
                <button onClick={() => cycleMadam(-1)} className="w-7 h-7 rounded-lg border border-pink-500/30 text-pink-200/70 hover:text-pink-100 hover:border-pink-400/50 shrink-0">‹</button>
                <div className="text-center min-w-0">
                  <div className="text-sm font-bold text-pink-100 truncate">{madam?.name ?? '—'}</div>
                  <div className="text-[11px] font-mono text-pink-300/50">{madam?.race}{madam?.title ? ' · ' + madam.title : ' · 看板娘'}</div>
                </div>
                <button onClick={() => cycleMadam(1)} className="w-7 h-7 rounded-lg border border-pink-500/30 text-pink-200/70 hover:text-pink-100 hover:border-pink-400/50 shrink-0">›</button>
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <button onClick={askGreet} disabled={!madam || greetLoading} title="点看板娘，听她说一句"
                  className="relative h-full max-h-full aspect-[1215/832] max-w-full rounded-xl border border-pink-500/25 bg-void overflow-hidden group">
                  {madamPortrait
                    ? <img src={madamPortrait} alt={madam?.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-pink-300/30">
                        <span className="text-6xl">{RACE_EMOJI(madam?.race)}</span>
                        <span className="text-[11px] font-mono">（未设置立绘）</span>
                      </div>}
                </button>
              </div>
              <div className="mt-2 shrink-0 min-h-[40px] max-h-[64px] overflow-y-auto rounded-xl border border-pink-500/20 bg-pink-500/5 px-3 py-1.5 text-[13px] text-pink-50/90 leading-snug">
                {greetLoading ? <span className="text-pink-300/40 font-mono">……</span>
                  : greetText ? `「${greetText}」`
                  : madam?.greetingPreset ? madam.greetingPreset
                  : <span className="text-pink-300/30">点看板娘立绘，听她招呼一句</span>}
              </div>
            </div>

            {/* 名册预览 + 进入选妃 */}
            <div className="flex-1 flex flex-col min-h-0 p-3">
              <div className="text-[12px] font-mono text-pink-300/50 mb-1.5 px-1">今夜在馆的姑娘（{girls.length}）</div>
              <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                {girls.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-edge/50 bg-void/40">
                    <span className="text-base shrink-0">{RACE_EMOJI(g.race)}</span>
                    <span className="text-[13px] text-pink-50/90 font-medium truncate">{g.name}</span>
                    <span className="text-[11px] font-mono text-dim/45 truncate">{g.race}{g.title ? ' · ' + g.title : ''}</span>
                    {sessions[g.id] && <span className="ml-auto text-[10px] font-mono shrink-0 text-pink-300/60">情欲 {sessions[g.id].desire}</span>}
                  </div>
                ))}
              </div>
              <button onClick={() => { setView('picker'); setPicked(null); setPage(0); }}
                className="mt-2.5 shrink-0 w-full py-2.5 rounded-xl text-base font-bold bg-gradient-to-r from-pink-600/30 to-fuchsia-600/30 border border-pink-400/40 text-pink-100 hover:from-pink-600/40 hover:to-fuchsia-600/40 transition-all joy-glow-soft">
                是，今夜就挑一位 →
              </button>
            </div>
          </div>
        )}

        {/* ══════════ 选妃 ══════════ */}
        {view === 'picker' && (
          <div className="flex-1 flex flex-col min-h-0 p-3">
            <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
              <button onClick={() => setView('lobby')} className="text-[12px] font-mono px-2.5 py-1 rounded-lg border border-edge text-dim hover:text-slate-100">← 返回大厅</button>
              <div className="text-[12px] font-mono text-pink-300/60">第 {page + 1} / {maxPage + 1} 页</div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}
                  className="w-7 h-7 rounded-lg border border-pink-500/30 text-pink-200/70 disabled:opacity-25 hover:border-pink-400/50">‹</button>
                <button onClick={() => setPage((p) => Math.min(maxPage, p + 1))} disabled={page >= maxPage}
                  className="w-7 h-7 rounded-lg border border-pink-500/30 text-pink-200/70 disabled:opacity-25 hover:border-pink-400/50">›</button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {pageGirls.map((g) => {
                const url = pagePortraits[g.id];
                const sel = picked === g.id;
                return (
                  <button key={g.id} onClick={() => setPicked(g.id)}
                    className={`relative rounded-xl border-2 overflow-hidden flex flex-col transition-all ${sel ? 'border-pink-400 shadow-[0_0_20px_rgba(244,114,182,0.4)]' : 'border-edge/60 hover:border-pink-500/40'}`}>
                    <div className="flex-1 min-h-0 bg-void overflow-hidden flex items-center justify-center">
                      {url
                        ? <img src={url} alt={g.name} className="w-full h-full object-cover" />
                        : <span className="text-5xl text-pink-300/30">{RACE_EMOJI(g.race)}</span>}
                    </div>
                    <div className={`shrink-0 px-2 py-1.5 text-center ${sel ? 'bg-pink-500/25' : 'bg-black/55'}`}>
                      <div className="text-[13px] font-bold text-pink-50 truncate">{g.name}</div>
                      <div className="text-[10px] font-mono text-pink-200/55 truncate">{g.race}</div>
                    </div>
                    {sel && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-pink-500 text-white text-xs flex items-center justify-center">✓</div>}
                  </button>
                );
              })}
              {Array.from({ length: Math.max(0, PER_PAGE - pageGirls.length) }).map((_, i) => (
                <div key={`ph-${i}`} className="rounded-xl border-2 border-dashed border-edge/30" />
              ))}
            </div>

            <button onClick={confirmPick} disabled={!picked}
              className={`mt-2.5 shrink-0 w-full py-2.5 rounded-xl text-base font-bold transition-all ${picked ? 'bg-gradient-to-r from-pink-600/40 to-fuchsia-600/40 border border-pink-400/50 text-pink-50 hover:from-pink-600/55 hover:to-fuchsia-600/55 joy-glow-soft' : 'bg-void border border-edge/40 text-dim/30 cursor-not-allowed'}`}>
              {picked ? `确定 · 与「${girls.find((g) => g.id === picked)?.name}」共度今宵 →` : '请先选择一位'}
            </button>
          </div>
        )}

        {/* ══════════ 包间 ══════════ */}
        {view === 'chamber' && curGirl && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 上：立绘（完整显示·不裁剪）*/}
            <div className="h-[50%] max-lg:h-[30vh] shrink-0 border-b border-pink-500/15 bg-gradient-to-b from-pink-950/20 to-void p-2 flex items-center justify-center min-h-0">
              <div className="relative h-full max-h-full aspect-[1215/832] max-w-full rounded-xl border border-pink-500/20 bg-void overflow-hidden flex items-center justify-center">
                {chamberPortrait
                  ? <img src={chamberPortrait} alt={curGirl.name} className="w-full h-full object-contain" />
                  : <div className="flex flex-col items-center justify-center gap-2 text-pink-300/30">
                      <span className="text-7xl">{RACE_EMOJI(curGirl.race)}</span>
                      <span className="text-[11px] font-mono">阶段{stageFromDesire(desire)}立绘 · 把图放进 欢愉宫图片/{curGirl.portraitFolder || curGirl.name}/阶段1~4/</span>
                    </div>}
                <div className="absolute left-2 top-2 px-2 py-0.5 rounded-full bg-black/55 text-[11px] font-mono text-pink-100/90">
                  {curGirl.name} · 第{stageFromDesire(desire)}阶 {STAGE_LABEL[stageFromDesire(desire)]}
                </div>
              </div>
            </div>

            {/* 下：左聊天 / 右状态 */}
            <div className="flex-1 flex flex-col lg:flex-row min-h-0">
              {/* 左：聊天 */}
              <div className="flex-1 lg:w-3/5 shrink-0 border-b lg:border-b-0 lg:border-r border-pink-500/15 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
                  {(!curSess || curSess.messages.length === 0) && (
                    <div className="text-center text-pink-300/35 text-[13px] py-6">
                      与「{curGirl.name}」独处一室……说点什么吧。<br />
                      <span className="text-[11px] font-mono text-dim/40">（每句对话都会牵动她的情欲值与神态）</span>
                    </div>
                  )}
                  {curSess?.messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-pink-600/25 border border-pink-500/30 text-pink-50 rounded-br-sm'
                          : 'bg-panel border border-edge text-slate-200 rounded-bl-sm'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sending && <div className="flex justify-start"><div className="px-3 py-2 rounded-2xl bg-panel border border-edge text-pink-300/50 text-[13px] font-mono">{curGirl.name}正在回应…</div></div>}
                  <div ref={chatEndRef} />
                </div>
                <div className="shrink-0 border-t border-pink-500/15 bg-panel2/40 p-2.5 space-y-2">
                  {/* 快捷：姿势 / BDSM —— 展开世界书条目标题，点一下填进输入框，再点发送 */}
                  {(poseTitles.length > 0 || bdsmTitles.length > 0) && (
                    <div>
                      <div className="flex items-center gap-2">
                        {poseTitles.length > 0 && (
                          <button onClick={() => setQuickKind(quickKind === 'pose' ? null : 'pose')}
                            className={`text-[12px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${quickKind === 'pose' ? 'border-pink-400/60 text-pink-100 bg-pink-500/15' : 'border-pink-500/30 text-pink-200/80 hover:bg-pink-500/10'}`}>
                            🤸 姿势 <span className="text-pink-300/40">{poseTitles.length}</span>
                          </button>
                        )}
                        {bdsmTitles.length > 0 && (
                          <button onClick={() => setQuickKind(quickKind === 'bdsm' ? null : 'bdsm')}
                            className={`text-[12px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${quickKind === 'bdsm' ? 'border-pink-400/60 text-pink-100 bg-pink-500/15' : 'border-pink-500/30 text-pink-200/80 hover:bg-pink-500/10'}`}>
                            ⛓ BDSM <span className="text-pink-300/40">{bdsmTitles.length}</span>
                          </button>
                        )}
                        {quickKind && <span className="text-[11px] font-mono text-dim/45">点选填入输入框 · 可多选</span>}
                        {quickKind && <button onClick={() => setQuickKind(null)} className="ml-auto text-dim/40 hover:text-pink-200 text-[12px] font-mono">收起 ✕</button>}
                      </div>
                      {quickKind && (
                        <div className="mt-2 max-h-28 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-pink-500/15 bg-void/50 p-2">
                          {quickTitles.map((t) => (
                            <button key={t} onClick={() => insertQuick(t)}
                              className="text-[12px] px-2 py-0.5 rounded-full border border-pink-500/25 text-pink-100/90 bg-pink-500/5 hover:bg-pink-500/20 hover:border-pink-400/50 transition-colors">
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      placeholder={`对${curGirl.name}说……（Enter 发送 / Shift+Enter 换行）`}
                      className="flex-1 resize-none bg-void border border-pink-500/25 rounded-xl px-3 py-2 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-pink-400/50 max-h-28" />
                    <button onClick={send} disabled={!input.trim() || sending}
                      className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${input.trim() && !sending ? 'bg-gradient-to-r from-pink-600/50 to-fuchsia-600/50 border border-pink-400/50 text-white hover:from-pink-600/70 hover:to-fuchsia-600/70' : 'bg-void border border-edge/40 text-dim/30 cursor-not-allowed'}`}>
                      {sending ? '…' : '发送'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 右：状态 */}
              <div className="flex-1 lg:w-2/5 shrink-0 bg-panel2/30 overflow-y-auto p-3 space-y-3 min-h-0 max-lg:flex-none max-lg:max-h-[26vh]">
                <div className="rounded-xl border border-pink-500/20 bg-void p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{RACE_EMOJI(curGirl.race)}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-pink-100 truncate">{curGirl.name}</div>
                      <div className="text-[11px] font-mono text-dim/50 truncate">{curGirl.race}{curGirl.title ? ' · ' + curGirl.title : ''}</div>
                    </div>
                  </div>
                  <DesireBar desire={desire} />
                  <div className="pt-0.5">
                    <div className="flex items-center justify-between text-[10px] font-mono text-pink-300/45 mb-0.5">
                      <span>🎚 自定义情欲值</span><span className="text-pink-200/70">拖动直接设定</span>
                    </div>
                    <input type="range" min={0} max={100} value={desire}
                      onChange={(e) => currentGirlId && setDesire(currentGirlId, Number(e.target.value))}
                      className="w-full h-1.5 accent-pink-500 cursor-pointer" />
                  </div>
                  {curSess?.appellation && (
                    <div className="text-[11px] font-mono text-pink-300/60">她唤你：<span className="text-pink-200/90">「{curSess.appellation}」</span></div>
                  )}
                </div>

                {curSess?.innerThought && (
                  <div className="rounded-xl border border-pink-500/15 bg-void p-3">
                    <div className="text-[11px] font-mono text-pink-300/50 mb-1">💭 此刻心声</div>
                    <div className="text-[13px] text-slate-300/90 leading-snug italic whitespace-pre-wrap">{curSess.innerThought}</div>
                  </div>
                )}

                <div className="rounded-xl border border-edge bg-void p-3">
                  <div className="text-[11px] font-mono text-pink-300/50 mb-2">私密状态</div>
                  <PrivacyView privacy={curSess?.privacy ?? {}} />
                </div>

                <button onClick={() => { if (confirm(`重置与「${curGirl.name}」的状态？情欲值、私密信息与聊天记录将清空。`)) resetSession(curGirl.id); }}
                  className="w-full text-[12px] font-mono py-1.5 rounded-lg border border-edge text-dim/60 hover:text-blood hover:border-blood/40 transition-colors">
                  ↺ 重置状态
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 私密信息渲染（复用 NPC「私密信息」schema）*/
function PrivacyView({ privacy }: { privacy: Record<string, string> }) {
  const rows = JOY_PRIVATE_COLS
    .filter((c) => c.key !== '情欲值')   // 情欲值已在上方进度条展示
    .map((c) => ({ ...c, value: privacy?.[c.key] }));   // 全部字段都显示（未填的标"未开发"），不再过滤
  return (
    <div className="space-y-2.5">
      {rows.map((p) => (
        <div key={p.key}>
          <div className="text-[12px] font-mono text-pink-300/45 mb-0.5">{p.label}</div>
          {!(p.value != null && String(p.value).trim())
            ? <div className="text-[12px] text-dim/25 italic">未开发</div>
            : p.num
            ? (() => { const n = Number(String(p.value).replace(/[^\d.-]/g, '')); return <div className="text-sm font-mono text-rose-300/85">{Number.isFinite(n) ? `${n} / 100` : String(p.value)}</div>; })()
            : <div className="text-[13px] text-slate-200/90 leading-snug whitespace-pre-wrap">{String(p.value)}</div>}
        </div>
      ))}
    </div>
  );
}
