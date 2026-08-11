import { useEffect, useMemo, useRef, useState } from 'react';
import { useTraining } from '../store/trainingStore';
import { useNpc } from '../store/npcStore';
import { useBioCycle, DEFAULT_BIO } from '../store/bioCycleStore';
import { useMisc } from '../store/miscStore';
import { useJoy, hydrateJoyWorldBooks } from '../store/joyStore';
import { runTrainingTurn } from '../systems/training';
import { PRIVATE_COLS } from '../systems/privateCols';
import { worldDayIndex, cycleStateOf, pregnancyStateOf } from '../systems/bioCycle';
import { loadJoyPlays, MAX_SELECTED_PLAYS, type JoyPlayLib } from '../systems/joyPlays';
import { findJoyBook, quickInsertTitles } from '../systems/joyWorldBook';
import { generateTrainingShot, removeTrainingShot } from '../systems/trainingImage';
import { trainImageKey } from '../systems/trainImages';
import { getImg } from '../systems/imageDb';
import { shrinkDataUrl } from '../systems/imageGen';
import { usePlayer } from '../store/playerStore';
import { useChannel } from '../store/channelStore';
import ApiRoutePicker from './ApiRoutePicker';

/* 🔗 调教系统（对剧情 NPC 的长线私密养成·可选成人向模块·默认关）：
   左=名册 / 中=对话+快捷动作条 / 右=隐私档案（与 NPC 详情页同源·含生理周期卡合并）。
   隐私变化经 <调教> 块落 npc.extra；对话永不进正文/叙事记忆。 */

const num = (v: unknown): number => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const shortName = (s: string): string => String(s ?? '').split('|')[0].trim();

export default function TrainingPanel({ onClose }: { onClose: () => void }) {
  const enabled = useTraining((s) => s.enabled);
  const setEnabled = useTraining((s) => s.setEnabled);
  const roster = useTraining((s) => s.roster);
  const sessions = useTraining((s) => s.sessions);
  const currentId = useTraining((s) => s.currentId);
  const setCurrent = useTraining((s) => s.setCurrent);
  const addToRoster = useTraining((s) => s.addToRoster);
  const removeFromRoster = useTraining((s) => s.removeFromRoster);
  const clearSession = useTraining((s) => s.clearSession);
  const setSelectedPlays = useTraining((s) => s.setSelectedPlays);
  const setPregConfirm = useTraining((s) => s.setPregConfirm);
  const quickPhrases = useTraining((s) => s.quickPhrases);
  const addQuickPhrase = useTraining((s) => s.addQuickPhrase);
  const removeQuickPhrase = useTraining((s) => s.removeQuickPhrase);
  const resetQuickPhrases = useTraining((s) => s.resetQuickPhrases);
  const clickToSend = useTraining((s) => s.clickToSend);
  const setClickToSend = useTraining((s) => s.setClickToSend);
  const npcs = useNpc((s) => s.npcs);
  const worldBooks = useJoy((s) => s.worldBooks);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [gening, setGening] = useState(false);   // 🎨 场景图生成中
  const [genErr, setGenErr] = useState('');
  const [apiOpen, setApiOpen] = useState(false);   // ⚙ API 路由折叠
  async function doGenShot() {
    if (gening || !currentId) return;
    setGening(true); setGenErr('');
    try { await generateTrainingShot(currentId); }
    catch (e: any) { setGenErr(e?.message || '生成失败'); setTimeout(() => setGenErr(''), 6000); }
    finally { setGening(false); }
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchive, setShowArchive] = useState(false);   // 右侧档案抽屉（移动端叠下）
  const [quickKind, setQuickKind] = useState<'plays' | 'pose' | 'bdsm' | 'phrase' | null>(null);
  const [phraseManage, setPhraseManage] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { hydrateJoyWorldBooks(); }, []);

  const curNpc = currentId ? npcs[currentId] : null;
  const curSess = currentId ? sessions[currentId] : undefined;
  const msgs = curSess?.msgs ?? [];
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  // 加人选择器候选：排除已死/归档/已在名册
  const candidates = useMemo(() => {
    const all = Object.values(npcs).filter((n: any) => n?.name && n.name !== n.id && !n.isDead && !n.archived && !roster.includes(n.id));
    const q = search.trim();
    const list = q ? all.filter((n: any) => String(n.name).includes(q)) : all;
    return [...list].sort((a: any, b: any) => Number(!!b.onScene) - Number(!!a.onScene)).slice(0, 40);
  }, [npcs, search, roster]);

  const poseTitles = useMemo(() => quickInsertTitles(findJoyBook(worldBooks, 'pose')), [worldBooks]);
  const bdsmTitles = useMemo(() => quickInsertTitles(findJoyBook(worldBooks, 'bdsm')), [worldBooks]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || !currentId || sending) return;
    setInput('');
    setSending(true);
    try { await runTrainingTurn(currentId, t); } finally { setSending(false); }
  }
  // 快捷动作：clickToSend=直接发（包动作壳），否则填入输入框
  function quickAction(text: string, wrap = false) {
    const payload = wrap ? `（本轮行动：${text}）` : text;
    if (clickToSend) void send(payload);
    else setInput((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + ' ' + payload : payload));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={sending ? undefined : onClose}>
      <div className="bg-void border border-rose-500/25 rounded-2xl w-full max-w-5xl h-[88dvh] flex flex-col overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}>
        {/* 头 */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-rose-500/15 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔗</span>
            <h2 className="text-base font-bold text-slate-100">调教系统</h2>
            <span className="text-[12px] font-mono text-dim/50">对剧情角色的私密养成</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enabled && (
              <button onClick={() => setApiOpen((v) => !v)} title="配置调教对话用的 AI 接口（留空=回退正文 API）"
                className={`text-[12px] font-mono px-2 py-0.5 rounded border transition-colors ${apiOpen ? 'border-rose-400/60 text-rose-100 bg-rose-500/15' : 'border-rose-500/30 text-rose-200/80 hover:bg-rose-500/10'}`}>⚙ API</button>
            )}
            <label className="flex items-center gap-1.5 text-[12px] text-dim/70 cursor-pointer" title="启用后对话链路与档案更新才生效（数据保留）">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />启用
            </label>
            <button onClick={onClose} disabled={sending} className="text-dim/50 hover:text-rose-300 text-lg font-mono disabled:opacity-40">✕</button>
          </div>
        </header>

        {/* ⚙ 调教对话 API 路由（featureKey: training）——通用 ApiRoutePicker，留空=回退正文 API */}
        {enabled && apiOpen && (
          <div className="shrink-0 border-b border-rose-500/15 bg-void/40 px-4 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-rose-300/70">调教对话 · AI 接口路由</span>
              <span className="text-[11px] text-dim/45">从「综合设置 → API 接口库」勾选，按优先级轮流 + 失败 fallback；留空 = 回退正文 API。建议选尺度宽松的模型。</span>
              <button onClick={() => setApiOpen(false)} className="ml-auto text-dim/40 hover:text-rose-200 text-[12px] font-mono">收起 ✕</button>
            </div>
            <ApiRoutePicker routeKey="training" />
          </div>
        )}

        {!enabled ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="max-w-sm space-y-2">
              <div className="text-4xl">🔗</div>
              <div className="text-sm text-slate-200 font-semibold">调教系统（可选成人向模块）</div>
              <div className="text-[13px] text-dim/60 leading-relaxed">把剧情 NPC 加入名册，通过专属对话进行私密调教；产生的变化会实时写进<b>该角色的隐私档案</b>（与 NPC 详情页同源），生理周期也在此统一管理。对话不进正文、不进记忆。</div>
              <button onClick={() => setEnabled(true)} className="mt-2 px-4 py-1.5 rounded-lg text-sm font-bold border border-rose-500/50 text-rose-200 hover:bg-rose-500/10">启用</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* 左·名册 */}
            <aside className="w-40 sm:w-48 shrink-0 border-r border-rose-500/15 flex flex-col min-h-0">
              <div className="p-2 shrink-0">
                <button onClick={() => setPickerOpen(true)} className="w-full py-1.5 rounded-lg text-[13px] font-mono border border-rose-500/40 text-rose-200/90 hover:bg-rose-500/10">＋ 加入角色</button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
                {roster.length === 0 && <div className="text-[12px] text-dim/40 text-center py-4">名册空<br />点上方加入</div>}
                {roster.map((id) => {
                  const n: any = npcs[id];
                  if (!n) return null;
                  const ex = (n.extra ?? {}) as Record<string, string>;
                  const on = id === currentId;
                  return (
                    <button key={id} onClick={() => setCurrent(id)}
                      className={`w-full text-left rounded-lg border px-2 py-1.5 transition-colors ${on ? 'border-rose-400/60 bg-rose-500/10' : 'border-edge hover:border-rose-500/30'}`}>
                      <div className="text-[13px] text-slate-200 font-semibold truncate">{shortName(n.name)}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] font-mono">
                        {num(ex['调教值']) > 0 && <span className="text-rose-300/80">🔗{num(ex['调教值'])}</span>}
                        {num(n.corruption) > 0 && <span className="text-fuchsia-300/80">💜{num(n.corruption)}</span>}
                        <BadgeBio id={id} />
                      </div>
                    </button>
                  );
                })}
              </div>
              <label className="shrink-0 flex items-center gap-1.5 px-2 py-2 border-t border-rose-500/15 text-[11px] text-dim/60 cursor-pointer" title="开=点快捷动作直接发送；关=填进输入框可编辑">
                <input type="checkbox" checked={clickToSend} onChange={(e) => setClickToSend(e.target.checked)} />快捷点击即发送
              </label>
            </aside>

            {/* 中·对话 */}
            <section className="flex-1 flex flex-col min-w-0">
              {!curNpc ? (
                <div className="flex-1 flex items-center justify-center text-dim/40 text-sm">从左侧名册选一位角色开始</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-rose-500/10 shrink-0">
                    <span className="text-[13px] font-semibold text-slate-200">{shortName(curNpc.name)}</span>
                    {curSess?.appellation && <span className="text-[11px] text-rose-300/70">称你：{curSess.appellation}</span>}
                    <span className="flex-1" />
                    <button onClick={() => setShowArchive((v) => !v)} className="text-[12px] font-mono px-2 py-0.5 rounded border border-edge text-dim/70 hover:text-rose-200">{showArchive ? '收起档案' : '📋 档案'}</button>
                    <button onClick={() => { if (window.confirm('清空与该角色的对话记录？（档案数据保留）')) clearSession(curNpc.id); }} className="text-[12px] text-dim/50 hover:text-rose-300">清空</button>
                    <button onClick={() => { if (window.confirm(`把「${shortName(curNpc.name)}」移出调教名册？（档案数据保留）`)) removeFromRoster(curNpc.id); }} className="text-[12px] text-dim/50 hover:text-blood">移出</button>
                  </div>

                  {/* 受孕确认 chip */}
                  {curSess?.pregConfirmPending && (
                    <div className="mx-3 mt-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-200/90 flex items-center gap-2 shrink-0">
                      <span className="flex-1">本轮情节可能致孕。确认为「{shortName(curNpc.name)}」标记受孕？（之后按世界时间确定性推进孕程）</span>
                      <button onClick={() => { const d = worldDayIndex(useMisc.getState().worldTime); const B = useBioCycle.getState(); if (!B.chars[curNpc.id]) B.upsertChar(curNpc.id, { ...DEFAULT_BIO, lastPeriodStartDay: Math.max(0, (d ?? 0) - 7) }); B.setPregnant(curNpc.id, d ?? 0); if (!B.enabled) B.setEnabled(true); setPregConfirm(curNpc.id, false); }}
                        className="shrink-0 px-2 py-0.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/20">确认受孕</button>
                      <button onClick={() => setPregConfirm(curNpc.id, false)} className="shrink-0 text-dim/50 hover:text-slate-200">忽略</button>
                    </div>
                  )}

                  {/* 气泡区 */}
                  <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
                    {msgs.length === 0 && <div className="text-center text-dim/40 text-[13px] py-6">对她下达第一个指令，或用下方快捷动作</div>}
                    {msgs.map((m, i) => (
                      m.role === 'user' ? (
                        <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-rose-500/15 border border-rose-500/25 px-3 py-1.5 text-[13px] text-rose-100/90 whitespace-pre-wrap">{m.text}</div></div>
                      ) : (
                        <div key={i} className="flex justify-start"><div className="max-w-[85%] space-y-1">
                          <div className="rounded-2xl rounded-bl-sm bg-panel border border-edge px-3 py-1.5 text-[13px] text-slate-200 whitespace-pre-wrap">{m.text}</div>
                          {m.scene && <div className="text-[12px] text-dim/60 italic px-2 whitespace-pre-wrap leading-relaxed">{m.scene}</div>}
                        </div></div>
                      )
                    ))}
                    {sending && <div className="text-[12px] text-rose-300/60 px-2"><span className="inline-block animate-spin mr-1">⟳</span>她正在回应…</div>}
                    <div ref={chatEndRef} />
                  </div>

                  {/* 快捷动作条 */}
                  <div className="shrink-0 border-t border-rose-500/15 px-2.5 py-2 space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <QuickTab label="✍ 短语" n={quickPhrases.length} active={quickKind === 'phrase'} onClick={() => setQuickKind(quickKind === 'phrase' ? null : 'phrase')} />
                      <QuickTab label="🎯 玩法" active={quickKind === 'plays'} onClick={() => setQuickKind(quickKind === 'plays' ? null : 'plays')} badge={curSess?.selectedPlays.length} />
                      {poseTitles.length > 0 && <QuickTab label="🤸 姿势" n={poseTitles.length} active={quickKind === 'pose'} onClick={() => setQuickKind(quickKind === 'pose' ? null : 'pose')} />}
                      {bdsmTitles.length > 0 && <QuickTab label="⛓ BDSM" n={bdsmTitles.length} active={quickKind === 'bdsm'} onClick={() => setQuickKind(quickKind === 'bdsm' ? null : 'bdsm')} />}
                      <button onClick={() => { void doGenShot(); }} disabled={gening}
                        title="按当前调教情境（情欲阶段/私密穿着/选中玩法/最近一句）生成一张场景图，存入右侧图库"
                        className="text-[12px] font-mono px-2 py-1 rounded-lg border border-fuchsia-500/40 text-fuchsia-300/90 hover:bg-fuchsia-500/10 disabled:opacity-40 transition-colors">
                        {gening ? '🎨 生成中…' : '🎨 生图'}
                      </button>
                      {quickKind && <button onClick={() => setQuickKind(null)} className="ml-auto text-dim/40 hover:text-rose-200 text-[12px] font-mono">收起 ✕</button>}
                    </div>
                    {genErr && <div className="text-[11px] font-mono text-blood/80">✗ {genErr}</div>}

                    {quickKind === 'phrase' && (
                      <div className="rounded-lg border border-rose-500/15 bg-void/50 p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-dim/50">{phraseManage ? '编辑短语：点 ✕ 删除、下方新增' : '点短语快发/填入'}</span>
                          <span className="flex-1" />
                          <button onClick={() => setPhraseManage((v) => !v)} className="text-[11px] font-mono text-rose-300/70 hover:text-rose-200">{phraseManage ? '完成' : '＋管理'}</button>
                          {phraseManage && <button onClick={() => { if (window.confirm('恢复默认短语？（自定义的将丢失）')) resetQuickPhrases(); }} className="text-[11px] font-mono text-dim/50 hover:text-rose-200">恢复默认</button>}
                        </div>
                        <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5">
                          {quickPhrases.map((p, i) => (
                            phraseManage ? (
                              <span key={i} className="inline-flex items-center rounded-full border border-rose-500/25 bg-rose-500/5 text-[12px] text-rose-100/90">
                                <span className="pl-2 pr-1 py-0.5">{p}</span>
                                <button onClick={() => removeQuickPhrase(i)} className="pr-1.5 py-0.5 text-dim/50 hover:text-blood">✕</button>
                              </span>
                            ) : <Chip key={i} onClick={() => quickAction(p, true)}>{p}</Chip>
                          ))}
                        </div>
                        {phraseManage && (
                          <div className="flex items-center gap-1.5">
                            <input value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && newPhrase.trim()) { addQuickPhrase(newPhrase); setNewPhrase(''); } }}
                              placeholder="新增一条短语，回车添加…" className="flex-1 bg-panel border border-rose-500/20 rounded px-2 py-0.5 text-[12px] text-slate-200 focus:outline-none focus:border-rose-400/50" />
                            <button onClick={() => { if (newPhrase.trim()) { addQuickPhrase(newPhrase); setNewPhrase(''); } }} className="text-[12px] font-mono px-2 py-0.5 rounded border border-rose-500/40 text-rose-300/90 hover:bg-rose-500/10">＋</button>
                          </div>
                        )}
                      </div>
                    )}
                    {quickKind === 'pose' && <ChipWrap>{poseTitles.map((t) => <Chip key={t} onClick={() => quickAction(t)}>{t}</Chip>)}</ChipWrap>}
                    {quickKind === 'bdsm' && <ChipWrap>{bdsmTitles.map((t) => <Chip key={t} onClick={() => quickAction(t)}>{t}</Chip>)}</ChipWrap>}
                    {quickKind === 'plays' && (
                      <PlaysPicker
                        selected={curSess?.selectedPlays ?? []}
                        onToggle={(name) => {
                          const cur = curSess?.selectedPlays ?? [];
                          setSelectedPlays(curNpc.id, cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= MAX_SELECTED_PLAYS ? cur : [...cur, name]);
                        }}
                        onQuickSend={(name) => quickAction(name)}
                      />
                    )}

                    <div className="flex items-end gap-2">
                      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                        placeholder={`对${shortName(curNpc.name)}下达指令…（Enter 发送）`}
                        className="flex-1 resize-none bg-void border border-rose-500/25 rounded-xl px-3 py-2 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-rose-400/50 max-h-28" />
                      <button onClick={() => void send(input)} disabled={!input.trim() || sending}
                        className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${input.trim() && !sending ? 'bg-gradient-to-r from-rose-600/50 to-fuchsia-600/50 border border-rose-400/50 text-white hover:from-rose-600/70' : 'bg-void border border-edge/40 text-dim/30 cursor-not-allowed'}`}>
                        {sending ? '…' : '发送'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* 右·隐私档案 */}
            {curNpc && showArchive && <ArchivePane npcId={curNpc.id} />}
          </div>
        )}

        {/* 加人选择器 */}
        {pickerOpen && (
          <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-6" onClick={() => setPickerOpen(false)}>
            <div className="w-full max-w-md max-h-[70vh] flex flex-col rounded-xl border border-rose-500/30 bg-panel p-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-semibold text-slate-200">加入角色到调教名册</span>
                <span className="flex-1" />
                <button onClick={() => setPickerOpen(false)} className="text-dim/50 hover:text-rose-300 text-sm">✕</button>
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜姓名…"
                className="w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-rose-400 mb-2" />
              <div className="flex-1 overflow-y-auto flex flex-wrap gap-1.5 content-start">
                {candidates.length === 0 && <span className="text-[12px] text-dim/40">没有可加入的角色</span>}
                {candidates.map((n: any) => (
                  <button key={n.id} onClick={() => { addToRoster(n.id); setPickerOpen(false); }}
                    className="text-[12px] px-2 py-1 rounded-full border border-edge text-slate-300 hover:border-rose-400/50 hover:text-rose-200">
                    {shortName(n.name)}{n.onScene ? ' ·在场' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 名册徽章·生理周期相位（自订阅） */
function BadgeBio({ id }: { id: string }) {
  const prof = useBioCycle((s) => (s.enabled ? s.chars[id] : undefined));
  const worldTime = useMisc((s) => s.worldTime);
  if (!prof?.on) return null;
  const day = worldDayIndex(worldTime);
  if (day == null) return null;
  const preg = pregnancyStateOf(prof, day);
  if (preg) return <span className="text-pink-300/80">{preg.postpartumDay != null ? '🤱' : `🤰${preg.weeks}w`}</span>;
  const c = cycleStateOf(prof, day);
  return <span className="text-pink-300/70">🌸{c.phase === '经期' ? `经${c.dayOfPeriod}` : c.phase[0]}</span>;
}

function QuickTab({ label, n, badge, active, onClick }: { label: string; n?: number; badge?: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${active ? 'border-rose-400/60 text-rose-100 bg-rose-500/15' : 'border-rose-500/30 text-rose-200/80 hover:bg-rose-500/10'}`}>
      {label}{badge ? <span className="text-amber-300/90"> {badge}</span> : n != null ? <span className="text-rose-300/40"> {n}</span> : null}
    </button>
  );
}
function ChipWrap({ children }: { children: React.ReactNode }) {
  return <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-rose-500/15 bg-void/50 p-2">{children}</div>;
}
function Chip({ children, onClick, on }: { children: React.ReactNode; onClick: () => void; on?: boolean }) {
  return <button onClick={onClick} className={`text-[12px] px-2 py-0.5 rounded-full border transition-colors ${on ? 'border-amber-400/70 bg-amber-500/15 text-amber-200' : 'border-rose-500/25 text-rose-100/90 bg-rose-500/5 hover:bg-rose-500/20'}`}>{children}</button>;
}

/* 🎯 玩法选择器（复用 joy-plays.json·分类+搜索+勾选持续注入/单击快发） */
function PlaysPicker({ selected, onToggle, onQuickSend }: { selected: string[]; onToggle: (name: string) => void; onQuickSend: (name: string) => void }) {
  const [lib, setLib] = useState<JoyPlayLib | null>(null);
  const [cat, setCat] = useState('全部');
  const [q, setQ] = useState('');
  useEffect(() => { loadJoyPlays().then(setLib).catch(() => {}); }, []);
  const list = useMemo(() => {
    if (!lib) return [];
    const s = q.trim();
    return lib.plays.filter((p) => (cat === '全部' || p.category === cat) && (!s || p.name.includes(s)));
  }, [lib, cat, q]);
  return (
    <div className="rounded-lg border border-rose-500/15 bg-void/50 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {['全部', ...(lib?.categories ?? [])].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`text-[11px] font-mono px-2 py-0.5 rounded border ${cat === c ? 'border-rose-400/60 text-rose-100 bg-rose-500/15' : 'border-rose-500/25 text-rose-200/70'}`}>{c}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜玩法…" className="w-24 bg-panel border border-rose-500/20 rounded px-2 py-0.5 text-[11px] text-slate-200 focus:outline-none" />
        <span className="text-[10px] text-dim/45">勾选=每轮持续注入(≤{MAX_SELECTED_PLAYS}) · 单击名字=本轮快发</span>
      </div>
      <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5">
        {!lib && <span className="text-[11px] text-dim/45">玩法库加载中…</span>}
        {list.map((p) => {
          const on = selected.includes(p.name);
          return (
            <span key={p.name} className={`inline-flex items-center rounded-full border text-[12px] ${on ? 'border-amber-400/70 bg-amber-500/15 text-amber-200' : 'border-rose-500/25 text-rose-100/90 bg-rose-500/5'}`}>
              <button onClick={() => onQuickSend(p.name)} title="本轮快发" className="pl-2 pr-1 py-0.5 hover:text-white">{p.name}</button>
              <button onClick={() => onToggle(p.name)} title={on ? '取消持续注入' : '加入持续注入'} className="pr-1.5 py-0.5 opacity-70 hover:opacity-100">{on ? '✓' : '＋'}</button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* 右·隐私档案（与 NPC 详情页同源·PRIVATE_COLS 渲染 + 开发度进度条 + 生理周期卡合并 + 手动编辑） */
function ArchivePane({ npcId }: { npcId: string }) {
  const npc = useNpc((s) => s.npcs[npcId]);
  const mergeExtra = useNpc((s) => s.mergeExtra);
  const removeExtraKey = useNpc((s) => s.removeExtraKey);
  const [editKey, setEditKey] = useState('');
  const [editVal, setEditVal] = useState('');
  if (!npc) return null;
  const ex = (npc.extra ?? {}) as Record<string, string>;
  const rows = PRIVATE_COLS.map((c) => ({ ...c, value: ex[c.key] ?? ex[c.alias] })).filter((r) => r.value != null && String(r.value).trim());
  const desire = num(ex['情欲值']);
  const heatLabel = desire >= 75 ? '情动欲焚' : desire >= 50 ? '芳心暗涌' : desire >= 25 ? '面泛春潮' : '心如止水';

  return (
    <aside className="w-56 sm:w-64 shrink-0 border-l border-rose-500/15 overflow-y-auto p-3 space-y-3 hidden md:block">
      {/* 立绘 + 情欲状态徽章（NPC 单张 avatar·与详情页同源；情欲阶段只叠徽章不换图，NPC 无多图库） */}
      <div className="relative rounded-xl overflow-hidden border border-rose-500/20 bg-void aspect-[3/4] flex items-center justify-center">
        {npc.avatar ? <img src={npc.avatar} alt={shortName(npc.name)} className="w-full h-full object-cover" />
          : <span className="text-4xl opacity-30">👤</span>}
        <div className="absolute left-0 right-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-slate-100 truncate">{shortName(npc.name)}</span>
          <span className="flex-1" />
          {desire > 0 && <span className="text-[10px] font-mono text-rose-300/90" title={`情欲值 ${desire}`}>🔥{heatLabel}</span>}
        </div>
      </div>
      <div className="text-[10px] text-dim/45 leading-relaxed">与 NPC 详情页同源；调教对话产生的变化实时落在这里。点数值/文字可手动改，🗑 清空该条。</div>

      <BioCard npcId={npcId} />

      <GalleryCard npcId={npcId} />

      {rows.length === 0 ? <div className="text-[12px] text-dim/40">尚无私密档案数据——开始调教后逐步积累</div> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center gap-1">
                <div className="text-[11px] font-mono text-rose-300/50 flex-1">{r.label}</div>
                <button onClick={() => { setEditKey(r.key); setEditVal(String(r.value)); }} className="text-[10px] text-dim/40 hover:text-rose-200">✎</button>
                <button onClick={() => { if (window.confirm(`清空「${r.label}」？`)) { removeExtraKey(npcId, r.key); if (ex[r.alias] != null && r.alias !== r.key) removeExtraKey(npcId, r.alias); } }} className="text-[10px] text-dim/40 hover:text-blood">🗑</button>
              </div>
              {editKey === r.key ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="flex-1 bg-void border border-edge rounded px-1.5 py-0.5 text-[12px] text-slate-200 outline-none focus:border-rose-400" />
                  <button onClick={() => { if (editVal.trim()) mergeExtra(npcId, { [r.key]: editVal.trim() }); setEditKey(''); }} className="text-[11px] text-rose-300 hover:text-rose-200">存</button>
                </div>
              ) : r.num ? (
                (() => { const n = num(r.value); return (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1.5 rounded bg-edge/50 overflow-hidden"><div className="h-full bg-rose-400/60" style={{ width: `${Math.max(0, Math.min(100, n))}%` }} /></div>
                    <span className="text-[11px] font-mono text-rose-300/85">{r.label.startsWith('开发') || ['情欲值', '快感值'].includes(r.label) ? `${n}/100` : n}</span>
                  </div>
                ); })()
              ) : (
                <div className="text-[12px] text-slate-300/90 leading-relaxed whitespace-pre-wrap">{String(r.value)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/* 🖼 场景图库卡（调教档案区·缩略图墙 + 放大/删除/分享到频道） */
function GalleryCard({ npcId }: { npcId: string }) {
  const gallery = useTraining((s) => s.sessions[npcId]?.gallery) ?? EMPTY_GALLERY;
  const updateShotCaption = useTraining((s) => s.updateShotCaption);
  const npcName = useNpc((s) => shortName(s.npcs[npcId]?.name ?? ''));
  const [imgMap, setImgMap] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState('');   // 放大的 shotId
  const [shareMsg, setShareMsg] = useState('');
  const [capEdit, setCapEdit] = useState('');      // 正在编辑 caption 的 shotId

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const shot of gallery) {
        const url = await getImg(trainImageKey(npcId, shot.id));
        if (url) next[shot.id] = url;
      }
      if (alive) setImgMap(next);
    })();
    return () => { alive = false; };
  }, [npcId, gallery.map((g) => g.id).join(',')]);

  async function share(shotId: string, caption: string) {
    const url = imgMap[shotId] || (await getImg(trainImageKey(npcId, shotId)));
    if (!url) { setShareMsg('✗ 图未就绪'); return; }
    const small = await shrinkDataUrl(url, 380, 0.82);   // 频道帖缩略图（随 localStorage/存档，控体积）
    const pf = usePlayer.getState().profile;
    const text = caption.trim() || `${npcName}的一张私房照，你们要看吗？`;
    useChannel.getState().addPlayerImage('general', pf.name || '主角', text, small, pf.tier);
    setShareMsg('✓ 已分享到公共频道');
    setTimeout(() => setShareMsg(''), 3000);
  }

  if (!gallery.length) {
    return <div className="rounded-lg border border-rose-500/12 bg-void/30 p-2 text-[11px] text-dim/40 leading-relaxed">🖼 场景图库空——在对话区点「🎨 生图」按当前情境生成，会存到这里（随存档）。</div>;
  }
  const cur = gallery.find((g) => g.id === lightbox);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] font-mono text-rose-300/60">🖼 场景图库</div>
        <span className="text-[10px] text-dim/40">{gallery.length}/30</span>
      </div>
      {shareMsg && <div className={`text-[10px] font-mono ${shareMsg.startsWith('✓') ? 'text-emerald-300/80' : 'text-blood/80'}`}>{shareMsg}</div>}
      <div className="grid grid-cols-2 gap-1.5">
        {gallery.map((shot) => (
          <button key={shot.id} onClick={() => setLightbox(shot.id)}
            className="relative aspect-[3/4] rounded-lg overflow-hidden border border-rose-500/20 bg-void group">
            {imgMap[shot.id]
              ? <img src={imgMap[shot.id]} alt="" className="w-full h-full object-cover" />
              : <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-dim/40">载入…</span>}
            {shot.caption && <div className="absolute left-0 right-0 bottom-0 px-1 py-0.5 bg-black/70 text-[9px] text-slate-200 truncate">{shot.caption}</div>}
          </button>
        ))}
      </div>

      {/* 放大 + 操作 */}
      {cur && (
        <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={() => { setLightbox(''); setCapEdit(''); }}>
          <div className="max-w-md w-full space-y-2" onClick={(e) => e.stopPropagation()}>
            {imgMap[cur.id] && <img src={imgMap[cur.id]} alt="" className="w-full max-h-[70vh] object-contain rounded-lg border border-rose-500/25" />}
            {capEdit === cur.id ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus defaultValue={cur.caption} onKeyDown={(e) => { if (e.key === 'Enter') { updateShotCaption(npcId, cur.id, (e.target as HTMLInputElement).value); setCapEdit(''); } }}
                  placeholder="给这张图配一句话…" className="flex-1 bg-panel border border-rose-500/25 rounded px-2 py-1 text-[13px] text-slate-100 focus:outline-none focus:border-rose-400/50"
                  onBlur={(e) => { updateShotCaption(npcId, cur.id, e.target.value); setCapEdit(''); }} />
              </div>
            ) : (
              <div className="text-[13px] text-slate-200 min-h-[1.2em]" onClick={() => setCapEdit(cur.id)} title="点击编辑配文">{cur.caption || <span className="text-dim/40">＋ 点此加配文</span>}</div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => { void share(cur.id, cur.caption); }} className="flex-1 px-3 py-1.5 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10">📢 分享到公共频道</button>
              <button onClick={() => { if (window.confirm('删除这张场景图？')) { void removeTrainingShot(npcId, cur.id); setLightbox(''); } }}
                className="px-3 py-1.5 text-[13px] font-mono border border-blood/40 text-blood/80 rounded hover:bg-blood/10">🗑 删除</button>
              <button onClick={() => { setLightbox(''); setCapEdit(''); }} className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:text-slate-200">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const EMPTY_GALLERY: import('../store/trainingStore').TrainShot[] = [];

/* 生理周期卡（合并进调教档案·操作 bioCycleStore） */
function BioCard({ npcId }: { npcId: string }) {
  const enabled = useBioCycle((s) => s.enabled);
  const prof = useBioCycle((s) => s.chars[npcId]);
  const setEnabled = useBioCycle((s) => s.setEnabled);
  const upsertChar = useBioCycle((s) => s.upsertChar);
  const setPregnant = useBioCycle((s) => s.setPregnant);
  const worldTime = useMisc((s) => s.worldTime);
  const day = worldDayIndex(worldTime);

  if (!prof) {
    return (
      <button onClick={() => { if (!enabled) setEnabled(true); upsertChar(npcId, { ...DEFAULT_BIO, lastPeriodStartDay: Math.max(0, (day ?? 0) - 7) }); }}
        className="w-full text-[12px] font-mono py-1 rounded border border-pink-500/30 text-pink-300/80 hover:bg-pink-500/10">🌸 纳入生理周期</button>
    );
  }
  const preg = day != null ? pregnancyStateOf(prof, day) : null;
  const cyc = day != null && !preg ? cycleStateOf(prof, day) : null;
  return (
    <div className="rounded-lg border border-pink-500/25 bg-pink-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] font-mono text-pink-300/80">
        <span className="flex-1">🌸 生理周期</span>
        {!enabled && <span className="text-amber-300/70">系统总开关关</span>}
      </div>
      <div className="text-[12px] text-pink-200/85 font-mono">
        {day == null ? '世界时间解析不出·推算休眠' :
          preg ? (preg.postpartumDay != null ? `产后第 ${preg.postpartumDay} 天` : `孕 ${preg.weeks} 周·距预产约 ${Math.max(0, preg.dueInDays)} 天`) :
          cyc ? `${cyc.phase}${cyc.dayOfPeriod ? ` 第 ${cyc.dayOfPeriod} 天` : ''}·周期 ${cyc.daysIntoCycle}/${cyc.cycleLen}${cyc.fertile ? '·易孕' : ''}` : ''}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
        <button disabled={day == null} onClick={() => upsertChar(npcId, { lastPeriodStartDay: day! })} className="px-1.5 py-0.5 rounded border border-edge text-dim/70 hover:text-pink-200 disabled:opacity-40">今天来潮</button>
        {!prof.pregnant ? (
          <button disabled={day == null} onClick={() => { if (window.confirm('标记今日受孕？')) setPregnant(npcId, day!); }} className="px-1.5 py-0.5 rounded border border-pink-500/40 text-pink-300/90 hover:bg-pink-500/10 disabled:opacity-40">受孕</button>
        ) : (
          <button onClick={() => { if (window.confirm('清除孕期状态？')) setPregnant(npcId, null); }} className="px-1.5 py-0.5 rounded border border-blood/40 text-blood/80 hover:bg-blood/10">清孕期</button>
        )}
      </div>
    </div>
  );
}
