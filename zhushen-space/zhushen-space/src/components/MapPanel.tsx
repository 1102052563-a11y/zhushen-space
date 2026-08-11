import { useEffect, useMemo, useState } from 'react';
import MapCanvas from './MapCanvas';
import ImagePromptEditModal from './ImagePromptEditModal';
import { useMap } from '../store/mapStore';
import { useMisc } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { useComposer } from '../store/composerStore';
import { usePinchPanZoom } from '../systems/usePinchPanZoom';
import { reportFacilityOutcome } from '../systems/facilityBridge';
import { openSettingsPage } from '../systems/navBus';
import { generateImage, shrinkDataUrl, buildScenePrompt } from '../systems/imageGen';
import { useImageGen, effectiveSceneService } from '../store/imageGenStore';
import { genSceneTags, isTagService } from '../systems/imageTags';
import { mapImageKey, mapImgDel, mapImgGet, mapImgSet } from '../systems/mapImages';
import { getImg } from '../systems/imageDb';
import {
  emptyWorldMap, mapWorldKey, resolveNodeIn, splitLocationPath, statusLabel, travelQuote, eventPinsFor,
  type MapNode,
} from '../systems/mapEngine';

/* 🧭 小地图面板：世界层（大区域）⇄ 场景层（区域内场所）双层视图。
   画布=MapCanvas + usePinchPanZoom（滚轮/双指缩放、拖拽平移）；右栏=选中详情 / 地点清单。
   「前往」两档（引擎哲学：前端拍板安全事实，AI 裁决危险叙事）：
     安全速移=travelQuote 报价 → 写 location + 〈前置须知〉通报，AI 只顺承呈现；
     冒险前往=把「前往X探查」填进输入框作为玩家行动提交，遭遇战裁决权留给正文 AI。 */

const EMPTY = emptyWorldMap();

export default function MapPanel({ onClose }: { onClose: () => void }) {
  const worldName = useMisc((s) => s.worldName);
  const worldEvents = useMisc((s) => s.worldEvents);
  const turn = useMisc((s) => s.turnCount);
  const location = usePlayer((s) => s.profile.location);
  const key = mapWorldKey(worldName);
  const data = useMap((s) => s.byWorld[key]) ?? EMPTY;
  const enabled = useMap((s) => s.settings.enabled);

  const [view, setView] = useState<string>('auto');   // 'auto' | 'world' | regionId
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // 🧭 地点生图：nodeId→dataURL 显示缓存 / 在飞的生成 / 错误 / 提示词编辑 / 灯箱
  const [imgMap, setImgMap] = useState<Record<string, string>>({});
  const [genBusyId, setGenBusyId] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState('');
  const [promptEditId, setPromptEditId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const pz = usePinchPanZoom({ min: 0.55, max: 2.6 });

  const all = useMemo(() => Object.values(data.nodes), [data]);
  const regions = useMemo(() => all.filter((n) => n.kind === 'region' && !n.archived), [all]);
  const curSegs = useMemo(() => splitLocationPath(location || '', key), [location, key]);
  const curRegion = useMemo(() => (curSegs[0] ? resolveNodeIn(regions, curSegs[0]) : null), [regions, curSegs]);
  const curSite = useMemo(() => {
    if (!curRegion || !curSegs[1]) return null;
    return resolveNodeIn(all.filter((n) => n.kind === 'site' && n.parentId === curRegion.id), curSegs[1]);
  }, [all, curRegion, curSegs]);

  const effView = view === 'auto' ? (curRegion?.id ?? 'world') : view;
  const viewRegion = effView !== 'world' ? (data.nodes[effView]?.kind === 'region' ? data.nodes[effView] : null) : null;

  const layerNodes = useMemo(() => (
    viewRegion
      ? all.filter((n) => n.kind === 'site' && n.parentId === viewRegion.id && !n.archived)
      : regions
  ), [all, regions, viewRegion]);
  const layerIds = useMemo(() => new Set(layerNodes.map((n) => n.id)), [layerNodes]);
  const layerEdges = useMemo(() => data.edges.filter((e) => layerIds.has(e.a) && layerIds.has(e.b)), [data.edges, layerIds]);
  const pins = useMemo(() => eventPinsFor(data, key, worldEvents ?? []), [data, key, worldEvents]);
  const siteCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of all) if (n.kind === 'site' && !n.archived) m[n.parentId] = (m[n.parentId] ?? 0) + 1;
    return m;
  }, [all]);
  const currentId = viewRegion ? (curSite && curSite.parentId === viewRegion.id ? curSite.id : undefined) : curRegion?.id;

  const selNode: MapNode | null = sel ? (data.nodes[sel] ?? null) : null;
  const quote = useMemo(() => {
    if (!selNode) return null;
    const from = curSite ?? curRegion;
    return travelQuote(data, from?.id, selNode.id);
  }, [data, selNode, curSite, curRegion]);

  const archived = useMemo(() => all.filter((n) => n.archived), [all]);
  const searched = useMemo(() => {
    const t = q.trim();
    if (!t) return null;
    return all.filter((n) => !n.archived && (n.name.includes(t) || n.aliases.some((a) => a.includes(t)) || n.tags.some((x) => x.includes(t)))).slice(0, 30);
  }, [all, q]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 4000); };

  const regionNameOf = (n: MapNode) => (n.kind === 'region' ? n.name : data.nodes[n.parentId]?.name ?? '');

  // 🧭 地点图加载（照 OutfitPanel 的 imgMap 范式）：本层节点 + 当前选中，内存缓存优先、imageDb 兜底
  const imgDepKey = `${key}|${layerNodes.map((n) => `${n.id}:${n.hasImage ? 1 : 0}`).join(',')}|${sel ?? ''}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      const wanted = selNode ? [...layerNodes, selNode] : layerNodes;
      const next: Record<string, string> = {};
      for (const n of wanted) {
        if (!n.hasImage) continue;
        const k = mapImageKey(key, n.id);
        const url = mapImgGet(k) ?? await getImg(k);
        if (url) next[n.id] = url;
      }
      if (alive) setImgMap(next);
    })();
    return () => { alive = false; };
  }, [imgDepKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 生图：无 customPrompt=重建提示词（标签服务先走 LLM 翻译，失败/自然语言服务用中文模板）；有=按编辑后的提示词直出 */
  const genImage = async (node: MapNode, customPrompt?: string) => {
    if (genBusyId) return;
    setGenBusyId(node.id); setImgErr('');
    try {
      const ig = useImageGen.getState();
      const service = effectiveSceneService(ig);
      let prompt = (customPrompt ?? '').trim();
      if (!prompt) {
        const desc = [key, regionNameOf(node), node.name, node.kind === 'region' ? '区域' : '场所',
          node.tags.length ? `标签：${node.tags.join('/')}` : '', `危险度${node.danger}`, node.note]
          .filter(Boolean).join('，');
        if (isTagService(service)) prompt = await genSceneTags(desc);
        if (!prompt) prompt = buildScenePrompt({ worldName: key, regionName: node.kind === 'site' ? regionNameOf(node) : '', name: node.name, kind: node.kind, tags: node.tags, danger: node.danger, note: node.note });
      }
      const raw = await generateImage(service, { prompt, negative: ig.sceneNegative, label: `地点图 · ${node.name}` });
      const url = await shrinkDataUrl(raw, 384, 0.85);
      mapImgSet(mapImageKey(key, node.id), url);
      useMap.getState().setNodeImage(key, node.id, { hasImage: true, imagePrompt: prompt });
      setImgMap((m) => ({ ...m, [node.id]: url }));
      setPromptEditId(null);
      flash(`「${node.name}」地点图已生成`);
    } catch (e: any) {
      setImgErr(e?.message ?? '生成失败');
    } finally { setGenBusyId(null); }
  };

  const delNodeImage = (node: MapNode) => {
    mapImgDel(mapImageKey(key, node.id));
    useMap.getState().setNodeImage(key, node.id, { hasImage: false });
    setImgMap((m) => { const next = { ...m }; delete next[node.id]; return next; });
  };
  const fastOk = (n: MapNode) => n.status === 'visited' && n.danger <= 2 && n.id !== (curSite?.id ?? curRegion?.id);

  const doFastTravel = (n: MapNode) => {
    const from = curSite ?? curRegion;
    const qt = travelQuote(data, from?.id, n.id);
    const newLoc = n.kind === 'region' ? `${key} ${n.name}` : `${key} ${regionNameOf(n)} ${n.name}`.trim();
    usePlayer.getState().setProfile({ location: newLoc });
    useMap.getState().markVisited(key, n.id, turn);
    reportFacilityOutcome({
      source: '地图',
      summary: `主角自「${from?.name ?? '原地'}」动身，抵达「${n.name}」（约耗时 ${qt.minutes} 分钟${qt.via.length ? `，途经${qt.via.join('、')}` : ''}）`,
      guard: '移动已由前端结算：下一段正文请自然呈现这段移动与抵达后的场景，勿重复计时、勿把主角写回原处',
    });
    flash(`已移动至「${n.name}」（约 ${qt.minutes} 分钟）——下一回合正文会自然接上`);
  };

  const doRiskyTravel = (n: MapNode) => {
    useComposer.getState().fill(`前往${n.name}探查`);
    onClose();
  };

  const pickNode = (id: string) => setSel((cur) => (cur === id ? null : id));
  const diveRegion = (id: string) => { setView(id); setSel(null); };

  const legendDot = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-dim/70"><span className={cls} />{label}</span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-5xl max-h-[90dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-2 p-3.5 border-b border-edge shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">🧭</span>
            <h2 className="text-base font-bold text-slate-100 shrink-0">地图</h2>
            <nav className="flex items-center gap-1 text-sm font-mono text-dim min-w-0">
              <button onClick={() => { setView('world'); setSel(null); }}
                className={`px-1.5 rounded hover:text-god transition-colors ${!viewRegion ? 'text-god' : ''}`}>{key}</button>
              {viewRegion && <><span className="text-dim/40">›</span><span className="text-slate-200 truncate">{viewRegion.name}</span></>}
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜地点/标签…"
              className="w-32 max-sm:hidden bg-panel border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god" />
            <button onClick={() => openSettingsPage('map-manager')} title="地图设置（AI 写图 / 注入 / API）"
              className="text-dim hover:text-god text-sm font-mono">⚙</button>
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
          </div>
        </header>

        {!enabled && (
          <div className="px-4 py-2 text-[13px] text-amber-300/80 bg-amber-500/5 border-b border-edge">
            地图功能已停用：不建图、不注入、不演化。可在 <button className="underline hover:text-god" onClick={() => openSettingsPage('map-manager')}>设置 → 变量管理 → 地图演化</button> 重新开启。
          </div>
        )}

        <div className="flex flex-1 min-h-0 max-lg:flex-col">
          {/* ── 画布区 ── */}
          <div className="relative flex-1 min-w-0 min-h-[40dvh]">
            {layerNodes.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8">
                <div className="max-w-sm text-center space-y-2">
                  <div className="text-3xl">🗺</div>
                  <div className="text-sm text-slate-300">这张世界的地图还是空白</div>
                  <div className="text-[13px] text-dim leading-relaxed">
                    每回合会自动把主角的「所处位置」与世界大事的地点记进地图；随着正文推进，
                    亲历之处成「已访」、听闻之地成「传闻」，逐渐拼出整张图——无需任何手动操作。
                  </div>
                </div>
              </div>
            ) : (
              <div ref={pz.scrollRef} {...pz.bind}
                className={`h-full overflow-auto touch-none bg-void ${pz.grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}>
                <MapCanvas
                  nodes={layerNodes} edges={layerEdges} currentId={currentId} selectedId={sel ?? undefined}
                  eventPins={pins} trail={viewRegion ? data.trail : []} siteCount={siteCount} thumbs={imgMap} zoom={pz.zoom}
                  onNodeClick={pickNode}
                  onNodeDblClick={(id) => { if (!viewRegion && data.nodes[id]?.kind === 'region') diveRegion(id); }}
                />
              </div>
            )}
            {/* 缩放 & 定位 */}
            <div className="absolute top-2 right-2 flex flex-col gap-1">
              {(['＋', '－', '⟳'] as const).map((t) => (
                <button key={t} onClick={() => (t === '＋' ? pz.zoomBy(0.25) : t === '－' ? pz.zoomBy(-0.25) : pz.reset())}
                  className="w-7 h-7 rounded bg-panel/90 border border-edge text-dim hover:text-god text-sm font-mono">{t}</button>
              ))}
              <button onClick={() => { setView(curRegion?.id ?? 'world'); setSel(curSite?.id ?? curRegion?.id ?? null); }}
                title="回到当前位置" className="w-7 h-7 rounded bg-panel/90 border border-edge text-dim hover:text-god text-sm">◎</button>
            </div>
            {/* 图例 */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1 rounded-full bg-panel/85 border border-edge whitespace-nowrap">
              {legendDot('w-2.5 h-2.5 rounded-full border border-dashed border-slate-500', '传闻')}
              {legendDot('w-2.5 h-2.5 rounded-full border border-slate-500 bg-panel2', '已探')}
              {legendDot('w-2.5 h-2.5 rounded-full bg-god/30 border border-god', '已访')}
              {legendDot('w-2.5 h-2.5 rounded-full border-2 border-god', '当前')}
              {legendDot('w-2.5 h-2.5 rounded-full border border-blood text-blood', '事件')}
            </div>
            {notice && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-god/10 border border-god/40 text-god text-[13px]">
                {notice}
              </div>
            )}
            {!viewRegion && layerNodes.length > 0 && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[12px] text-dim/50">双击区域进入场景层</div>
            )}
          </div>

          {/* ── 右栏：详情 / 清单 ── */}
          <aside className="w-72 max-lg:w-full shrink-0 border-l max-lg:border-l-0 max-lg:border-t border-edge flex flex-col min-h-0 max-lg:max-h-[38dvh]">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {selNode ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold text-slate-100 break-all">{selNode.pinned ? '★ ' : ''}{selNode.name}</div>
                      <div className="text-[12px] font-mono text-dim/60 mt-0.5">
                        {selNode.kind === 'region' ? '区域' : `${regionNameOf(selNode)} · 场所`}
                      </div>
                    </div>
                    <button onClick={() => setSel(null)} className="text-dim/40 hover:text-slate-200 font-mono">✕</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className={`px-2 py-0.5 rounded-full border ${selNode.status === 'visited' ? 'border-god/50 text-god' : 'border-edge text-dim'}`}>{statusLabel(selNode.status)}</span>
                    {selNode.tags.map((t) => <span key={t} className="px-2 py-0.5 rounded-full border border-edge text-dim">{t}</span>)}
                    <span className={`ml-auto font-mono ${selNode.danger >= 4 ? 'text-blood' : 'text-dim/70'}`}>
                      危险 {'●'.repeat(selNode.danger)}{'○'.repeat(5 - selNode.danger)}
                    </span>
                  </div>
                  {(imgMap[selNode.id] || selNode.hasImage || genBusyId === selNode.id) && (
                    <div
                      onClick={() => imgMap[selNode.id] && setLightbox(imgMap[selNode.id])}
                      title={imgMap[selNode.id] ? '点击查看大图' : ''}
                      className={`w-full aspect-square max-w-[190px] rounded-lg overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center ${imgMap[selNode.id] ? 'cursor-zoom-in hover:border-god/40' : ''}`}>
                      {genBusyId === selNode.id
                        ? <span className="text-[12px] font-mono text-god/70 animate-pulse">生成中…</span>
                        : imgMap[selNode.id]
                          ? <img src={imgMap[selNode.id]} alt={selNode.name} className="w-full h-full object-cover" />
                          : <span className="text-[12px] text-dim/40">图片加载中…</span>}
                    </div>
                  )}
                  {(pins[selNode.id]?.length ?? 0) > 0 && (
                    <div className="text-[13px] text-blood/90 bg-blood/5 border border-blood/30 rounded-lg px-2.5 py-1.5">
                      ⚠ 进行中事件：{pins[selNode.id].join('；')}
                    </div>
                  )}
                  {selNode.note && <p className="text-[13px] text-dim leading-relaxed">{selNode.note}</p>}
                  {selNode.aliases.length > 0 && <div className="text-[12px] text-dim/50">别名：{selNode.aliases.join('、')}</div>}
                  {quote && selNode.id !== (curSite?.id ?? curRegion?.id) && (
                    <div className="text-[12px] font-mono text-dim/60">
                      距此约 {quote.minutes} 分钟{quote.via.length ? ` · 途经 ${quote.via.join('、')}` : quote.hops > 1 ? ' · 无已知通路(估)' : ''}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {selNode.kind === 'region' && !viewRegion && (
                      <button onClick={() => diveRegion(selNode.id)} className="px-2.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] hover:bg-god/10">查看区域</button>
                    )}
                    {selNode.id === (curSite?.id ?? curRegion?.id) ? (
                      <span className="px-2.5 py-1.5 rounded-lg border border-god/30 text-god/70 text-[13px]">◎ 当前所在</span>
                    ) : fastOk(selNode) ? (
                      <button onClick={() => doFastTravel(selNode)} title="安全区速移：前端结算耗时，正文顺承呈现"
                        className="px-2.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] hover:bg-god/10">前往（速移）</button>
                    ) : (
                      <button onClick={() => doRiskyTravel(selNode)} title="传闻/危险地带：作为行动提交，剧情裁决路上遭遇"
                        className="px-2.5 py-1.5 rounded-lg border border-blood/40 text-blood text-[13px] hover:bg-blood/10">冒险前往</button>
                    )}
                    <button onClick={() => useMap.getState().setPin(key, selNode.id, !selNode.pinned)}
                      className="px-2.5 py-1.5 rounded-lg border border-edge text-dim text-[13px] hover:text-gold hover:border-gold/40">{selNode.pinned ? '取消图钉' : '图钉'}</button>
                    <button onClick={() => { if (confirm(`删除「${selNode.name}」${selNode.kind === 'region' ? '及其全部场所' : ''}？（AI 之后仍可能重新发现它）`)) { useMap.getState().removeNode(key, selNode.id); setSel(null); } }}
                      className="px-2.5 py-1.5 rounded-lg border border-edge text-dim/60 text-[13px] hover:text-blood hover:border-blood/40">删除</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => genImage(selNode)} disabled={genBusyId !== null}
                      title="按当前档案生成地点图（NAI/ComfyUI 先由 LLM 翻译英文标签；OpenAI/Gemini 用自然语言模板）"
                      className="px-2.5 py-1.5 rounded-lg border border-god/40 text-god text-[13px] hover:bg-god/10 disabled:opacity-40">
                      {genBusyId === selNode.id ? '生成中…' : selNode.hasImage ? '✨ 重新生图' : '✨ 生成地点图'}
                    </button>
                    <button onClick={() => setPromptEditId(selNode.id)} disabled={genBusyId !== null}
                      title="查看/编辑生图提示词后重新生成"
                      className="px-2.5 py-1.5 rounded-lg border border-god/30 text-god/80 text-[13px] hover:bg-god/10 disabled:opacity-40">✏️ 提示词</button>
                    {selNode.hasImage && (
                      <button onClick={() => delNodeImage(selNode)} disabled={genBusyId !== null}
                        className="px-2.5 py-1.5 rounded-lg border border-edge text-dim/60 text-[13px] hover:text-blood hover:border-blood/40 disabled:opacity-40">删除图片</button>
                    )}
                  </div>
                  {imgErr && <div className="text-[11px] text-blood font-mono leading-snug whitespace-pre-line">{imgErr}</div>}
                  <div>
                    <div className="text-[12px] text-dim/60 mb-1">我的标注（仅自己可见，不喂 AI）</div>
                    <textarea key={selNode.id} defaultValue={selNode.playerNote ?? ''} rows={2} maxLength={120}
                      onBlur={(e) => useMap.getState().setPlayerNote(key, selNode.id, e.target.value)}
                      placeholder="例：回头来这里搬空弹药库"
                      className="w-full bg-panel border border-edge rounded-lg px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-god resize-none" />
                  </div>
                  <div className="text-[11px] font-mono text-dim/40">
                    首见 T{selNode.firstSeenTurn} · 最近 T{selNode.lastSeenTurn}{selNode.lastVisitTurn ? ` · 到访 T${selNode.lastVisitTurn}` : ''}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[12px] font-mono text-dim/50 uppercase tracking-widest">{searched ? `搜索「${q.trim()}」` : viewRegion ? '本区域场所' : '已知区域'}</div>
                  {(searched ?? layerNodes).length === 0 && <div className="text-[13px] text-dim/60">（无匹配地点）</div>}
                  {(searched ?? [...layerNodes].sort((a, b) => (b.id === currentId ? 1 : 0) - (a.id === currentId ? 1 : 0) || b.lastSeenTurn - a.lastSeenTurn)).map((n) => (
                    <button key={n.id}
                      onClick={() => { if (searched && n.kind === 'site') setView(n.parentId); else if (searched && n.kind === 'region') setView('world'); setSel(n.id); }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${n.id === currentId ? 'border-god/40 bg-god/5' : 'border-edge bg-panel/40 hover:border-god/30'}`}>
                      <div className="flex items-center gap-1.5">
                        {imgMap[n.id] && <img src={imgMap[n.id]} alt="" className="w-6 h-6 rounded object-cover border border-edge/60 shrink-0" />}
                        <span className="text-[13px] text-slate-200 truncate">{n.pinned ? '★ ' : ''}{n.name}</span>
                        {(pins[n.id]?.length ?? 0) > 0 && <span className="text-blood text-[12px]">!</span>}
                        <span className="ml-auto text-[11px] font-mono text-dim/50 shrink-0">{statusLabel(n.status)}{n.danger ? `·危${n.danger}` : ''}</span>
                      </div>
                      {searched && <div className="text-[11px] text-dim/40 mt-0.5">{n.kind === 'region' ? '区域' : regionNameOf(n)}</div>}
                    </button>
                  ))}
                  {archived.length > 0 && !searched && (
                    <div className="pt-1">
                      <button onClick={() => setShowArchived((v) => !v)} className="text-[12px] text-dim/50 hover:text-dim font-mono">
                        {showArchived ? '▾' : '▸'} 已归档的传闻 {archived.length} 处（久未提及）
                      </button>
                      {showArchived && archived.map((n) => (
                        <div key={n.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-dim/60">
                          <span className="truncate">{n.name}</span>
                          <button onClick={() => useMap.getState().restoreNode(key, n.id)}
                            className="ml-auto text-[12px] text-dim/50 hover:text-god shrink-0">捞回</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-edge px-3 py-2 text-[12px] font-mono text-dim/50 truncate">
              📍 {location || '（位置未设定）'}
            </div>
          </aside>
        </div>
      </div>

      {/* 🧭 提示词编辑（独立组件，不可内联定义——受控 textarea 每键重挂会断输入法） */}
      {promptEditId && data.nodes[promptEditId] && (
        <ImagePromptEditModal
          title={`${data.nodes[promptEditId].name} · 地点图提示词`}
          initialPrompt={(data.nodes[promptEditId].imagePrompt ?? '').trim() || buildScenePrompt({
            worldName: key,
            regionName: data.nodes[promptEditId].kind === 'site' ? (data.nodes[data.nodes[promptEditId].parentId]?.name ?? '') : '',
            name: data.nodes[promptEditId].name, kind: data.nodes[promptEditId].kind,
            tags: data.nodes[promptEditId].tags, danger: data.nodes[promptEditId].danger, note: data.nodes[promptEditId].note,
          })}
          busy={genBusyId === promptEditId}
          note="NAI/ComfyUI 请用英文 danbooru 标签；OpenAI/Gemini 用自然语言描述。画风/负面词在 设置→生图设置 里统一管。"
          onClose={() => { if (genBusyId !== promptEditId) setPromptEditId(null); }}
          onSubmit={(p) => { const n = data.nodes[promptEditId]; if (n) void genImage(n, p); }}
        />
      )}

      {/* 🧭 地点图灯箱 */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          <img src={lightbox} alt="地点图" className="max-w-full max-h-full rounded-xl border border-edge" />
        </div>
      )}
    </div>
  );
}
