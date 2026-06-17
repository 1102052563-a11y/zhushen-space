import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSkillTree, type NodeGrants } from '../store/skillTreeStore';
import { validateTree, autoLayout, defaultCost, attrDeltaText, treeBounds } from '../systems/skillTree';
import { TIERS } from '../systems/derivedStats';
import { ATTR_KEYS, ATTR_LABEL } from '../systems/attrBonus';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { SKILLTREE_GEN_PROMPT } from '../promptRules';
import { SkillEditForm, TraitEditForm } from './CharEditForms';
import ApiRoutePicker from './ApiRoutePicker';
import TreeCanvas from './TreeCanvas';

/* 技能树编辑器（设置→变量管理→技能树）：可视化加点/连线/自定义技能，单棵树可导出分享。 */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50';
const labelCls = 'text-[11px] font-mono text-dim/50';
const btnCls = 'px-2.5 py-1 rounded border border-edge text-[12px] font-mono text-dim hover:text-slate-200 hover:border-god/40 transition-colors';

function download(name: string, data: string) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* 从 AI 回复里抠出 JSON 本体（容忍 markdown 代码块/前后废话）*/
function extractJson(text: string): string {
  let s = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

export default function SkillTreeManager() {
  const trees = useSkillTree((s) => s.trees);
  const st = useSkillTree.getState();
  const treeList = Object.values(trees);

  const [editId, setEditId] = useState<string | undefined>(treeList[0]?.id);
  const tree = editId ? trees[editId] : undefined;
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | undefined>(undefined);
  const [grantForm, setGrantForm] = useState<'skill' | 'trait' | null>(null);
  const [cstFormId, setCstFormId] = useState<string | null>(null);   // 正在编辑奖励的星座 id
  const [msg, setMsg] = useState('');
  const [valid, setValid] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [genProf, setGenProf] = useState('');
  const [genRef, setGenRef] = useState('');
  const [genDesc, setGenDesc] = useState('');   // 主角对该职业的描述（喂给 AI 定调）
  const [genBranches, setGenBranches] = useState(4);   // 流派数量（= 从中心放射的初始线条数；每条 ≥15 节点）
  const [webSearch, setWebSearch] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  // 画布平移/缩放（同玩家面板）：拖空白处平移、滚轮以光标为锚缩放；编辑模式用阈值区分「拖动平移」与「空白点击加节点」
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ cx: number; cy: number; sl: number; st: number; active: boolean } | null>(null);
  const didPanRef = useRef(false);
  const zoomRef = useRef(zoom);   zoomRef.current = zoom;
  const zoomAnchor = useRef<{ sl: number; st: number; cx: number; cy: number; f: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => { if ((!editId || !trees[editId]) && treeList.length) setEditId(treeList[0].id); }, [treeList.length]); // eslint-disable-line

  // 滚轮缩放（光标锚定，非被动监听以 preventDefault；画布随选树挂载，故依赖 tree?.id 重挂）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const nz = Math.min(3, Math.max(0.5, +(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
      if (nz === z) return;
      const rect = el.getBoundingClientRect();
      zoomAnchor.current = { sl: el.scrollLeft, st: el.scrollTop, cx: e.clientX - rect.left, cy: e.clientY - rect.top, f: nz / z };
      zoomRef.current = nz;
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [tree?.id]);

  // 缩放后校正滚动位（DOM 已按新 zoom 重排），保持光标下内容点不动
  useLayoutEffect(() => {
    const el = scrollRef.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.sl + a.cx) * a.f - a.cx;
    el.scrollTop = (a.st + a.cy) * a.f - a.cy;
    zoomAnchor.current = null;
  }, [zoom]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };

  const selNode = tree?.nodes.find((n) => n.id === selId);

  // ── 树级操作 ──
  const newTree = () => {
    const t = autoLayout(validateTree({
      profession: '新职业', title: '新职业·技能树',
      branches: [{ id: 'br_1', name: '流派一' }],
      nodes: [], source: 'manual',
    }).tree);
    st.upsertTree(t); setEditId(t.id); setSelId(undefined); flash('已新建空白树');
  };
  const delTree = () => {
    if (!tree) return;
    if (!window.confirm(`删除技能树「${tree.title || tree.profession}」？`)) return;
    st.removeTree(tree.id);
    const rest = Object.values(useSkillTree.getState().trees);
    setEditId(rest[0]?.id); setSelId(undefined);
  };
  const exportTree = () => {
    if (!tree) return;
    download(`${tree.profession || 'tree'}.tree.json`, JSON.stringify(tree, null, 2));
  };
  const importTree = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const raw = JSON.parse(String(r.result));
        const v = validateTree(raw);
        if (!v.ok) { flash('导入失败：' + v.errors[0]); return; }
        const t = autoLayout(v.tree);
        st.upsertTree(t); setEditId(t.id); setSelId(undefined);
        flash(v.warnings.length ? `已导入（${v.warnings.length} 条提醒）` : '已导入模板');
        setValid({ errors: v.errors, warnings: v.warnings });
      } catch { flash('导入失败：JSON 解析错误'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  const doValidate = () => { if (tree) { const v = validateTree(tree); setValid({ errors: v.errors, warnings: v.warnings }); flash(v.ok ? '校验通过' : `${v.errors.length} 个错误`); } };
  const setActive = () => {
    if (!tree) return;
    const v = validateTree(tree);
    if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('有错误，无法启用：' + v.errors[0]); return; }
    st.setActiveTree('B1', tree.id); flash(`已设为主角当前技能树：${tree.title || tree.profession}`);
  };
  const aiGen = async () => {
    const prof = genProf.trim();
    if (!prof) { flash('先填一个职业名'); return; }
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('skilltree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { flash('未配置 AI 接口（设置→综合设置 / 正文生成）'); return; }
    const ref = genRef.trim();
    const desc = genDesc.trim();
    const nBr = Math.max(2, Math.min(12, Math.round(genBranches) || 4));
    const userMsg = [
      `职业：${prof}`,
      `流派数量：${nBr}（必须设计 ${nBr} 条 branch，从中心原点放射 ${nBr} 条初始线；每条 branch 至少 15 个节点）`,
      ref && `参考来源/风格：${ref}（请贴近此蓝本的技能体系）`,
      desc && `主角对该职业的描述/期望（请据此定调流派、命名、气质与招牌能力）：\n${desc}`,
      webSearch ? '请先用联网搜索查阅该职业及相关游戏/小说的真实技能资料，再据实设计。' : '',
      `请为该职业设计一棵丰富的星图式技能树（${nBr} 条流派、每条 ≥15 节点），每个技能/天赋走完整固定格式，按系统要求只输出 JSON。`,
    ].filter(Boolean).join('\n');
    // 联网搜索：经 extra 注入工具（Gemini/兼容接口的 google_search）；不支持就回退无搜索
    const searchExtra = webSearch ? { tools: [{ google_search: {} }] } : undefined;
    const callOnce = (extra?: Record<string, unknown>) => apiChatFallback(chain, [
      { role: 'system', content: SKILLTREE_GEN_PROMPT },
      { role: 'user', content: userMsg },
    ], { timeoutMs: 150000, extra });

    setGenBusy(true); flash(webSearch ? 'AI 联网生成中…（约 20~60 秒）' : 'AI 生成中…（约 10~40 秒）');
    try {
      let content: string;
      try {
        ({ content } = await callOnce(searchExtra));
      } catch (e1) {
        if (!searchExtra) throw e1;
        flash('该接口不支持联网搜索，已改用普通生成…');   // 搜索工具被拒 → 退回无搜索
        ({ content } = await callOnce(undefined));
      }
      const raw = lenientJsonParse(extractJson(content));
      const v = validateTree({ ...(raw as any), source: 'ai' });
      if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('生成的树有误：' + v.errors[0]); return; }
      const t = autoLayout(v.tree);
      st.upsertTree(t); setEditId(t.id); setSelId(undefined);
      // 校验：节点≥50、流派数对得上、每条 branch ≥15 节点
      const extra: string[] = [];
      if (t.nodes.length < 50) extra.push(`总节点仅 ${t.nodes.length}（< 50 硬性下限）`);
      if (t.branches.length !== nBr) extra.push(`流派数 ${t.branches.length}（要求 ${nBr}）`);
      const thin = t.branches.filter((b) => t.nodes.filter((n) => n.branch === b.id).length < 15).map((b) => b.name);
      if (thin.length) extra.push(`这些流派不足 15 节点：${thin.join('、')}`);
      const warns = [...v.warnings, ...extra];
      setValid({ errors: [], warnings: warns });
      flash(extra.length ? `已生成但未达标（${extra.join('；')}）——可重新生成或手动补足` : (v.warnings.length ? `已生成（${t.nodes.length}节点，${v.warnings.length}条提醒，可手动微调）` : `已生成职业树（${t.nodes.length}节点 / ${t.branches.length}流派），可继续编辑`));
    } catch (e: any) {
      flash('生成失败：' + (e?.message || String(e)));
    } finally { setGenBusy(false); }
  };

  // ── 画布交互 ──
  const addNodeCenter = () => {
    if (!tree) return;
    const { w, h } = treeBounds(tree);
    const j = () => Math.round((Math.random() - 0.5) * 80);
    const id = st.addNode(tree.id, { x: Math.round(w / 2) + j(), y: Math.round(h / 2) + j(), name: '新节点', branch: tree.branches[0]?.id ?? '' });
    if (id) { setSelId(id); setConnectMode(false); setConnectFrom(undefined); }
  };
  const onBlankClick = (x: number, y: number) => {
    if (didPanRef.current) { didPanRef.current = false; return; }   // 刚才是拖动平移，不在空白加节点
    if (!tree) return;
    const id = st.addNode(tree.id, { x, y, name: '新节点', branch: tree.branches[0]?.id ?? '' });
    if (id) setSelId(id);
  };
  // 画布平移：点到节点→交给 TreeCanvas 拖节点；空白处拖动超阈值→平移，未超→当作点击(空白加节点)
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    didPanRef.current = false;
    if ((e.target as Element)?.closest?.('[data-node]')) return;   // 节点交互不平移
    const el = scrollRef.current;
    if (!el) return;
    panRef.current = { cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop, active: false };
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current, el = scrollRef.current;
    if (!p || !el) return;
    const dx = e.clientX - p.cx, dy = e.clientY - p.cy;
    if (!p.active) {
      if (Math.hypot(dx, dy) < 5) return;   // 阈值：<5px 视为点击，留给空白加节点
      p.active = true; didPanRef.current = true; setGrabbing(true);
      try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件忽略 */ }
    }
    el.scrollLeft = p.sl - dx;
    el.scrollTop = p.st - dy;
  };
  const endCanvasPan = (e: React.PointerEvent) => {
    const p = panRef.current; panRef.current = null;
    if (p?.active) { setGrabbing(false); try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ } }
  };
  const onNodeClick = (id: string) => {
    if (!tree) return;
    if (connectMode) {
      if (!connectFrom) { setConnectFrom(id); return; }
      if (id !== connectFrom) {
        const ok = st.addEdge(tree.id, connectFrom, id);
        flash(ok ? '已连线' : '连线失败（会成环或已存在）');
      }
      setConnectFrom(undefined);
      return;
    }
    setSelId(id);
  };

  // ── 节点字段/grants 编辑 ──
  const patchNode = (patch: any) => { if (tree && selId) st.updateNode(tree.id, selId, patch); };
  const setGrant = (g: Partial<NodeGrants>) => { if (selNode) patchNode({ grants: { ...selNode.grants, ...g } }); };
  const setAttr = (k: typeof ATTR_KEYS[number], v: number) => {
    if (!selNode) return;
    const attr = { ...(selNode.ptAttr ?? {}) };
    if (v) (attr as any)[k] = v; else delete (attr as any)[k];
    patchNode({ ptAttr: Object.keys(attr).length ? attr : undefined });
  };

  return (
    <div className="max-w-6xl mx-auto">
      <p className="text-[13px] text-dim/60 mb-3">
        可视化编辑职业技能树：<b className="text-slate-300">➕ 加节点</b>或<b className="text-slate-300">点击空白处</b>建点，<b className="text-slate-300">拖动</b>移动，开「连线模式」<b className="text-slate-300">点两个节点</b>建前置依赖。节点可挂自定义技能/天赋/属性（技能走完整固定格式）。做好的树可导出 <code className="text-dim">.tree.json</code> 分享给别人。
      </p>

      {/* 树级控制 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={editId ?? ''} onChange={(e) => { setEditId(e.target.value); setSelId(undefined); }}
          className="bg-panel2 border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50">
          {!treeList.length && <option value="">（无树，点新建）</option>}
          {treeList.map((t) => <option key={t.id} value={t.id}>{t.title || t.profession}{t.source === 'builtin' ? '（内置）' : ''}</option>)}
        </select>
        <button onClick={newTree} className={btnCls}>＋ 新建</button>
        <button onClick={() => fileRef.current?.click()} className={btnCls}>⭳ 导入</button>
        <button onClick={exportTree} disabled={!tree} className={btnCls}>⭱ 导出</button>
        <button onClick={delTree} disabled={!tree} className={btnCls + ' hover:!text-blood hover:!border-blood/40'}>🗑 删除</button>
        <input ref={fileRef} type="file" accept=".json,.tree.json" className="hidden" onChange={importTree} />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={doValidate} disabled={!tree} className={btnCls}>✓ 校验</button>
          <button onClick={setActive} disabled={!tree} className="px-3 py-1 rounded border border-lime-500/50 text-lime-300 bg-lime-500/10 hover:bg-lime-500/20 text-[12px] font-mono">设为主角当前树</button>
        </div>
      </div>

      {/* AI 生成职业树 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-fuchsia-600/30 bg-fuchsia-900/10">
        <span className="text-[12px] font-mono text-fuchsia-300">✨ AI 生成</span>
        <input value={genProf} onChange={(e) => setGenProf(e.target.value)} placeholder="职业名，如：枪械师 / 元素法师 / 死灵术士"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
        {/* 流派数量：= 从中心放射的初始线条数，每条 branch ≥15 节点 */}
        <label className="flex items-center gap-1 text-[12px] text-dim/70 shrink-0" title="从中心原点放射的流派（初始线）条数；每条流派至少 15 个节点">
          <span className="font-mono text-fuchsia-300/90">流派数</span>
          <input type="number" min={2} max={12} value={genBranches}
            onChange={(e) => setGenBranches(Math.max(2, Math.min(12, parseInt(e.target.value, 10) || 4)))}
            className="w-14 bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
          <span className="text-[10px] text-dim/40">条·每条≥15节点</span>
        </label>
        <input value={genRef} onChange={(e) => setGenRef(e.target.value)} placeholder="参考来源/风格（选填，如：英雄联盟剑圣 / 某小说）"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
        {/* 职业描述：主角自述对该职业的理解 / 期望流派 / 气质 → 喂给 AI 定调 */}
        <textarea value={genDesc} onChange={(e) => setGenDesc(e.target.value)} rows={3}
          placeholder="职业描述（选填，但强烈建议填）：主角对这个职业的理解、想要的流派方向、招牌能力、气质与背景设定……写得越具体，AI 生成的星图越贴你的设想。"
          className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50 resize-y leading-relaxed" />
        <label className="flex items-center gap-1 text-[12px] text-dim/70 cursor-pointer select-none">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} className="accent-fuchsia-500" />
          🌐 联网搜索<span className="text-[10px] text-dim/40">(Google·需接口支持)</span>
        </label>
        <button onClick={aiGen} disabled={genBusy}
          className="px-3 py-1 rounded border border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-[12px] font-mono disabled:opacity-50">
          {genBusy ? '生成中…' : '生成一棵'}
        </button>
        <span className="text-[11px] text-dim/40 w-full sm:w-auto">按【流派数】生成放射星图（每条流派 ≥15 节点·总 ≥50），每个技能走完整固定格式；落为新预设，可手动改 / 导出分享</span>
        {/* AI 生成用的接口路由（留空则回退到正文/综合 API）*/}
        <div className="w-full mt-1">
          <div className="text-[11px] font-mono text-dim/50 mb-1">AI 接口（从「综合设置 → API 接口库」勾选，留空用正文/综合 API）</div>
          <ApiRoutePicker routeKey="skilltree" />
        </div>
      </div>

      {msg && <div className="mb-2 text-[12px] font-mono text-god">{msg}</div>}

      {!tree ? (
        <div className="text-center text-dim/40 text-sm py-16 border border-edge/40 rounded-xl">没有技能树。点「新建」从空白开始，或「导入」一个 .tree.json。</div>
      ) : (
        <div className="flex gap-4 max-lg:flex-col">
          {/* 画布 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button onClick={addNodeCenter}
                className="px-2.5 py-1 rounded border border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 text-[12px] font-mono">
                ➕ 加节点
              </button>
              <button onClick={() => { setConnectMode((v) => !v); setConnectFrom(undefined); }}
                className={`px-2.5 py-1 rounded border text-[12px] font-mono transition-colors ${connectMode ? 'border-sky-500/60 text-sky-300 bg-sky-500/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                {connectMode ? '🔗 连线模式（点两个节点）' : '🔗 连线模式'}
              </button>
              <button onClick={() => st.relayout(tree.id)} className={btnCls}>⊞ 整理布局</button>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">－</button>
                <button onClick={() => setZoom(1)} className="px-2 h-7 rounded border border-edge text-[11px] font-mono text-dim hover:text-slate-200" title="重置缩放">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">＋</button>
                <span className="text-[11px] text-dim/40 ml-2">{tree.nodes.length} 节点</span>
              </div>
            </div>
            <div
              ref={scrollRef}
              className={`border border-edge rounded-xl bg-void/50 overflow-auto p-2 ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{ maxHeight: '72vh' }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={endCanvasPan}
              onPointerLeave={endCanvasPan}
              onPointerCancel={endCanvasPan}
            >
              <TreeCanvas
                tree={tree}
                ranks={EMPTY_RANKS}
                availableIds={EMPTY}
                mode="edit"
                selectedId={selId}
                connectFrom={connectFrom}
                onNodeClick={onNodeClick}
                onNodeMove={(id, x, y) => st.moveNode(tree.id, id, x, y)}
                onBlankClick={onBlankClick}
                zoom={zoom}
                heightVh={66}
              />
            </div>
          </div>

          {/* 侧栏：节点检视 / 树信息 / 流派 */}
          <div className="w-80 max-lg:w-full shrink-0 space-y-4">
            {/* 节点检视 */}
            {selNode ? (
              <div className="border border-edge rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-mono text-god">节点检视</span>
                  <button onClick={() => { if (tree) { st.removeNode(tree.id, selNode.id); setSelId(undefined); } }}
                    className="text-[11px] font-mono text-dim/50 hover:text-blood">🗑 删除节点</button>
                </div>
                <label className="block space-y-0.5"><span className={labelCls}>名称</span>
                  <input className={inputCls} value={selNode.name} onChange={(e) => patchNode({ name: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-0.5"><span className={labelCls}>流派</span>
                    <select className={inputCls} value={selNode.branch} onChange={(e) => patchNode({ branch: e.target.value })}>
                      {tree.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select></label>
                  <label className="block space-y-0.5"><span className={labelCls}>类型</span>
                    <select className={inputCls} value={selNode.kind}
                      onChange={(e) => { const kind = e.target.value as any; patchNode({ kind, cost: defaultCost(kind) }); }}>
                      <option value="minor">普通</option><option value="major">核心</option><option value="capstone">终极</option>
                    </select></label>
                  <label className="block space-y-0.5"><span className={labelCls}>层</span>
                    <input type="number" min={1} className={inputCls} value={selNode.layer} onChange={(e) => patchNode({ layer: Math.max(1, Number(e.target.value) || 1) })} /></label>
                  <label className="block space-y-0.5"><span className={labelCls}>潜能点花费/点</span>
                    <input type="number" min={0} className={inputCls} value={selNode.cost} onChange={(e) => patchNode({ cost: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="block space-y-0.5"><span className={labelCls}>累计点数门槛(spentGate)</span>
                    <input type="number" min={0} className={inputCls} value={selNode.spentGate ?? ''} placeholder="0=无" onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); patchNode({ spentGate: v || undefined }); }} /></label>
                  <label className="block space-y-0.5 col-span-2"><span className={labelCls}>阶位 gate（解锁所需最低阶位）</span>
                    <select className={inputCls} value={selNode.tierGate} onChange={(e) => patchNode({ tierGate: e.target.value })}>
                      <option value="">不限</option>
                      {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select></label>
                </div>
                <label className="block space-y-0.5"><span className={labelCls}>说明</span>
                  <textarea rows={2} className={inputCls + ' resize-y'} value={selNode.desc ?? ''} onChange={(e) => patchNode({ desc: e.target.value })} /></label>

                {/* 前置 */}
                <div className="space-y-1">
                  <span className={labelCls}>前置依赖（连线模式添加）</span>
                  {(selNode.prereqs ?? []).length === 0 && <div className="text-[12px] text-dim/40">无（起点）</div>}
                  {(selNode.prereqs ?? []).map((pid) => (
                    <div key={pid} className="flex items-center justify-between text-[12px] bg-void rounded px-2 py-0.5">
                      <span className="text-slate-300">{tree.nodes.find((n) => n.id === pid)?.name ?? pid}</span>
                      <button onClick={() => st.removeEdge(tree.id, pid, selNode.id)} className="text-dim/40 hover:text-blood">✕</button>
                    </div>
                  ))}
                </div>

                {/* grants */}
                <div className="pt-1 border-t border-edge/50 space-y-2">
                  <span className={labelCls}>解锁获得</span>
                  {/* 技能 */}
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-dim/70">⚡ 技能：</span>
                    <span className="text-slate-300 truncate flex-1">{selNode.grants.skill?.name ?? '（无）'}</span>
                    <button onClick={() => setGrantForm(grantForm === 'skill' ? null : 'skill')} className="text-god hover:underline">{selNode.grants.skill ? '编辑' : '添加'}</button>
                    {selNode.grants.skill && <button onClick={() => setGrant({ skill: undefined })} className="text-dim/40 hover:text-blood">清除</button>}
                  </div>
                  {grantForm === 'skill' && (
                    <SkillEditForm skill={selNode.grants.skill as any} onClose={() => setGrantForm(null)}
                      onSubmit={(f) => setGrant({ skill: f })} />
                  )}
                  {/* 天赋 */}
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-dim/70">✦ 天赋：</span>
                    <span className="text-slate-300 truncate flex-1">{selNode.grants.trait?.name ?? '（无）'}</span>
                    <button onClick={() => setGrantForm(grantForm === 'trait' ? null : 'trait')} className="text-god hover:underline">{selNode.grants.trait ? '编辑' : '添加'}</button>
                    {selNode.grants.trait && <button onClick={() => setGrant({ trait: undefined })} className="text-dim/40 hover:text-blood">清除</button>}
                  </div>
                  {grantForm === 'trait' && (
                    <TraitEditForm trait={selNode.grants.trait as any} onClose={() => setGrantForm(null)}
                      onSubmit={(f) => setGrant({ trait: f })} />
                  )}
                  {/* 每点属性加成（ptAttr，线性等差；普通节点=普通点，sink=真实点） */}
                  <div>
                    <div className="flex items-center gap-2 text-[12px] text-dim/70 mb-1">
                      <span>📊 每点属性 {selNode.ptAttr ? <span className="text-sky-300">{attrDeltaText(selNode.ptAttr)}</span> : ''}</span>
                      <label className="flex items-center gap-1 ml-auto text-[11px]">
                        <input type="checkbox" checked={!!selNode.realAttr} onChange={(e) => patchNode({ realAttr: e.target.checked })} className="accent-sky-500" />真实属性
                      </label>
                      <label className="flex items-center gap-1 text-[11px]">
                        <input type="checkbox" checked={!!selNode.sink} onChange={(e) => patchNode({ sink: e.target.checked, maxRank: e.target.checked ? 999 : undefined })} className="accent-fuchsia-500" />无上限sink
                      </label>
                      <label className="flex items-center gap-1 text-[11px]">
                        <input type="checkbox" checked={!!selNode.socket} onChange={(e) => patchNode({ socket: e.target.checked || undefined })} className="accent-fuchsia-500" />星核位
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {ATTR_KEYS.map((k) => (
                        <label key={k} className="flex items-center gap-1 text-[11px] text-dim/60">
                          <span className="w-6">{ATTR_LABEL[k]}</span>
                          <input type="number" className="w-full bg-void border border-edge rounded px-1 py-0.5 text-[12px] text-slate-200"
                            value={selNode.ptAttr?.[k] ?? ''} onChange={(e) => setAttr(k, Math.trunc(Number(e.target.value) || 0))} />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-edge/50 rounded-xl p-3 text-[12px] text-dim/50">点击画布空白处加节点，或点节点查看/编辑。</div>
            )}

            {/* 树信息 */}
            <div className="border border-edge rounded-xl p-3 space-y-2">
              <span className="text-[12px] font-mono text-god">树信息</span>
              <label className="block space-y-0.5"><span className={labelCls}>职业名（匹配主角职业）</span>
                <input className={inputCls} value={tree.profession} onChange={(e) => st.updateTreeMeta(tree.id, { profession: e.target.value })} /></label>
              <label className="block space-y-0.5"><span className={labelCls}>显示标题</span>
                <input className={inputCls} value={tree.title ?? ''} onChange={(e) => st.updateTreeMeta(tree.id, { title: e.target.value })} /></label>
            </div>

            {/* 流派 */}
            <div className="border border-edge rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-god">流派支</span>
                <button onClick={() => st.addBranch(tree.id, '')} className="text-[11px] text-god hover:underline">＋ 加流派</button>
              </div>
              {tree.branches.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <input type="color" value={b.color} onChange={(e) => st.updateBranch(tree.id, b.id, { color: e.target.value })}
                    className="w-6 h-6 rounded bg-transparent border border-edge cursor-pointer shrink-0" />
                  <input className={inputCls} value={b.name} onChange={(e) => st.updateBranch(tree.id, b.id, { name: e.target.value })} />
                  <button onClick={() => st.removeBranch(tree.id, b.id)} disabled={tree.branches.length <= 1}
                    className="text-dim/40 hover:text-blood disabled:opacity-30 shrink-0">✕</button>
                </div>
              ))}
            </div>

            {/* 星座编辑 */}
            <div className="border border-edge rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-amber-300">✦ 星座（点亮整组→觉醒奖励）</span>
                <button onClick={() => st.addConstellation(tree.id, { id: `cst_${Date.now().toString(36)}`, name: '新星座', nodeIds: [], reward: { trait: { name: '新觉醒', rarity: 'SS', category: '特殊异能类', effect: '', attrBonus: '' } as any } })}
                  className="text-[11px] text-amber-300 hover:underline">＋ 新建</button>
              </div>
              {(tree.constellations ?? []).length === 0 && <div className="text-[11px] text-dim/40">还没有星座。新建后「加入选中节点」组成图案。</div>}
              {(tree.constellations ?? []).map((c) => (
                <div key={c.id} className="border border-edge/50 rounded p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input className={inputCls} value={c.name} onChange={(e) => st.updateConstellation(tree.id, c.id, { name: e.target.value })} />
                    <button onClick={() => st.removeConstellation(tree.id, c.id)} className="text-dim/40 hover:text-blood shrink-0">✕</button>
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    {c.nodeIds.map((id) => (
                      <span key={id} className="text-[10px] bg-void rounded px-1 border border-edge/50 text-slate-300">
                        {tree.nodes.find((n) => n.id === id)?.name ?? id}
                        <button onClick={() => st.updateConstellation(tree.id, c.id, { nodeIds: c.nodeIds.filter((x) => x !== id) })} className="ml-1 text-dim/40 hover:text-blood">×</button>
                      </span>
                    ))}
                    <button disabled={!selId || c.nodeIds.includes(selId)} onClick={() => selId && st.updateConstellation(tree.id, c.id, { nodeIds: [...c.nodeIds, selId] })}
                      className="text-[10px] text-amber-300/80 hover:underline disabled:opacity-30">＋加入选中节点</button>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-dim/60">奖励：{c.reward?.trait?.name || c.reward?.skill?.name || '（无）'}</span>
                    <button onClick={() => setCstFormId(cstFormId === c.id ? null : c.id)} className="text-god hover:underline">编辑天赋奖励</button>
                  </div>
                  {cstFormId === c.id && (
                    <TraitEditForm trait={c.reward?.trait as any} onClose={() => setCstFormId(null)}
                      onSubmit={(f) => st.updateConstellation(tree.id, c.id, { reward: { trait: f } })} />
                  )}
                </div>
              ))}
            </div>

            {/* 校验结果 */}
            {valid && (valid.errors.length > 0 || valid.warnings.length > 0) && (
              <div className="border border-edge rounded-xl p-3 space-y-1">
                {valid.errors.map((e, i) => <div key={'e' + i} className="text-[12px] text-blood">✕ {e}</div>)}
                {valid.warnings.map((w, i) => <div key={'w' + i} className="text-[12px] text-amber-400/80">⚠ {w}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY = new Set<string>();
const EMPTY_RANKS: Record<string, number> = {};
