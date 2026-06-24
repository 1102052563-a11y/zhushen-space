import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSubProfTree } from '../store/subProfTreeStore';
import { validateTree, autoLayout, defaultCost, treeBounds } from '../systems/skillTree';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { SUBPROFTREE_STRUCT_PROMPT, SUBPROFTREE_RECIPE_PROMPT, SUBPROFTREE_NODES_PROMPT } from '../promptRules';
import ApiRoutePicker from './ApiRoutePicker';
import TreeCanvas from './TreeCanvas';

/* 副职业树编辑器（设置→变量管理→副职业设置）：可视化加点/连线/自定义配方 + AI 两阶段生成一棵「配方星图」。
   与技能树编辑器同构，区别：节点解锁的是【配方】(图纸/药方…)、全程无六维属性、独立 API(subproftree)。 */

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

/* 抠 JSON 本体：优先代码块 → 从末尾配平括号取最后一个完整对象(绕开思维链零碎{}) → 兜底首{到末} */
function extractJson(text: string): string {
  let s = String(text ?? '');
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let k = fences.length - 1; k >= 0; k--) { const blk = fences[k][1].trim(); if (blk.includes('{')) { s = blk; break; } }
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  const end = s.lastIndexOf('}');
  if (end >= 0) {
    let depth = 0;
    for (let k = end; k >= 0; k--) {
      const c = s[k];
      if (c === '}') depth++;
      else if (c === '{') { depth--; if (depth === 0) return s.slice(k, end + 1); }
    }
  }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  return (i >= 0 && j > i) ? s.slice(i, j + 1) : s;
}

export default function SubProfTreeManager() {
  const trees = useSubProfTree((s) => s.trees);
  const st = useSubProfTree.getState();
  const treeList = Object.values(trees);

  const [editId, setEditId] = useState<string | undefined>(treeList[0]?.id);
  const tree = editId ? trees[editId] : undefined;
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState('');
  const [valid, setValid] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [genProf, setGenProf] = useState('');
  const [genRef, setGenRef] = useState('');
  const [genDesc, setGenDesc] = useState('');
  const [genBranches, setGenBranches] = useState('3');
  const [webSearch, setWebSearch] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [pickIds, setPickIds] = useState<Set<string>>(new Set());   // AI 单独/批量重写：选中的已生成配方节点 id
  const [nodeReq, setNodeReq] = useState('');                        // 对选中配方节点的重写要求
  const [nodeBusy, setNodeBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setPickIds(new Set()); setNodeReq(''); }, [editId]);   // 切换/新建/导入/整树重生成 → 清空 AI 重写选择(防 id 失效)

  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ cx: number; cy: number; sl: number; st: number; active: boolean } | null>(null);
  const didPanRef = useRef(false);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const zoomAnchor = useRef<{ sl: number; st: number; cx: number; cy: number; f: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => { if ((!editId || !trees[editId]) && treeList.length) setEditId(treeList[0].id); }, [treeList.length]); // eslint-disable-line

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const nz = Math.min(3, Math.max(0.5, +(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
      if (nz === z) return;
      const rect = el.getBoundingClientRect();
      zoomAnchor.current = { sl: el.scrollLeft, st: el.scrollTop, cx: e.clientX - rect.left, cy: e.clientY - rect.top, f: nz / z };
      zoomRef.current = nz; setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [tree?.id]);
  useLayoutEffect(() => {
    const el = scrollRef.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.sl + a.cx) * a.f - a.cx;
    el.scrollTop = (a.st + a.cy) * a.f - a.cy;
    zoomAnchor.current = null;
  }, [zoom]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500); };
  const selNode = tree?.nodes.find((n) => n.id === selId);

  const newTree = () => {
    const t = autoLayout(validateTree({ profession: '新副职业', title: '新副职业·配方星图', recipeLabel: '配方', category: '制造', branches: [{ id: 'br_1', name: '流派一' }], nodes: [], source: 'manual' }).tree);
    st.upsertTree(t); setEditId(t.id); setSelId(undefined); flash('已新建空白副职业树');
  };
  const delTree = () => {
    if (!tree) return;
    if (!window.confirm(`删除副职业树「${tree.title || tree.profession}」？`)) return;
    st.removeTree(tree.id);
    const rest = Object.values(useSubProfTree.getState().trees);
    setEditId(rest[0]?.id); setSelId(undefined);
  };
  const exportTree = () => { if (tree) download(`${tree.profession || 'subtree'}.subtree.json`, JSON.stringify(tree, null, 2)); };
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
    r.readAsText(f); e.target.value = '';
  };
  const doValidate = () => { if (tree) { const v = validateTree(tree); setValid({ errors: v.errors, warnings: v.warnings }); flash(v.ok ? '校验通过' : `${v.errors.length} 个错误`); } };

  const aiGen = async () => {
    const prof = genProf.trim();
    if (!prof) { flash('先填一个副职业名'); return; }
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('subproftree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { flash('未配置 AI 接口（下方接口路由 / 综合设置 / 正文生成）'); return; }
    const ref = genRef.trim(); const desc = genDesc.trim();
    const nBr = Math.max(2, Math.min(10, parseInt(genBranches, 10) || 3));
    const searchExtra = webSearch ? { tools: [{ google_search: {} }] } : undefined;
    const GEN_MAX_TOKENS = 80000;
    const call = async (sys: string, user: string, useSearch: boolean) => {
      const base = { max_tokens: GEN_MAX_TOKENS };
      const withSearch = useSearch ? { ...base, ...searchExtra } : base;
      const once = (extra: Record<string, unknown>) => apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeoutMs: 150000, extra });
      try { return (await once(withSearch)).content; }
      catch (e) { if (!useSearch) throw e; return (await once(base)).content; }
    };
    const normName = (x: any) => String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()]/g, '').toLowerCase();

    setGenBusy(true);
    try {
      flash('① 推演副职业发展合理性 + 生成结构骨架中…（约 15~40 秒）');
      const structMsg = [
        `副职业：${prof}`,
        `流派/专精方向数量：${nBr}（必须 ${nBr} 条 branch；每条至少 4 张配方：≥2 medium + ≥1 major + 1 capstone，外加微星基本功，约 8~14 节点）`,
        ref && `参考来源/风格：${ref}`,
        desc && `主角对该副职业的描述/期望：\n${desc}`,
        '先做完整的「副职业发展是否合理」思维链，再只搭结构 + 配方名，不要写配方内容。',
      ].filter(Boolean).join('\n');
      const c1 = await call(SUBPROFTREE_STRUCT_PROMPT, structMsg, !!webSearch);
      const raw1: any = lenientJsonParse(extractJson(c1));
      const rawNodes: any[] = Array.isArray(raw1?.nodes) ? raw1.nodes : [];
      if (!rawNodes.length) { flash('结构生成失败（未返回节点，可重试）'); return; }

      const recipeNodes = rawNodes.filter((n) => ['medium', 'major', 'capstone'].includes(n?.kind));
      const branchName = (id: string) => (raw1?.branches || []).find((b: any) => b?.id === id)?.name || id;
      const byId = new Map<string, any>(); const byName = new Map<string, any>();
      const BATCH = 12;
      const batches: any[][] = [];
      for (let i = 0; i < recipeNodes.length; i += BATCH) batches.push(recipeNodes.slice(i, i + BATCH));
      for (let bi = 0; bi < batches.length; bi++) {
        flash(`② 详写配方中… 第 ${bi + 1}/${batches.length} 批（共 ${recipeNodes.length} 张配方）`);
        const list = batches[bi].map((n) => ({ id: n.id, name: n.name, kind: n.kind, 流派: branchName(n.branch) }));
        const recipeMsg = `副职业：${prof}（配方叫法：${raw1?.recipeLabel || '配方'}）\n请为以下 ${list.length} 个配方节点逐张【详细】撰写(覆盖全部、按 id 一一对应)：\n${JSON.stringify(list)}`;
        try {
          const c2 = await call(SUBPROFTREE_RECIPE_PROMPT, recipeMsg, !!webSearch);
          const raw2: any = lenientJsonParse(extractJson(c2));
          const arr = Array.isArray(raw2?.recipes) ? raw2.recipes : (Array.isArray(raw2) ? raw2 : []);
          for (const s of arr) {
            if (!s || typeof s !== 'object') continue;
            if (s.id) byId.set(String(s.id), s);
            const nm = s.recipe?.name ?? s.name;
            if (nm) byName.set(normName(nm), s);
          }
        } catch { /* 单批失败不致命 */ }
      }

      let mergedCnt = 0;
      const mergedNodes = rawNodes.map((n) => {
        const s = byId.get(String(n.id)) || byName.get(normName(n.name));
        const rec = s?.recipe ?? (s && (s.materials || s.output) ? s : undefined);
        if (rec && (rec.materials || rec.output || rec.name)) {
          mergedCnt++;
          const oneLiner = String(rec.output || rec.desc || '').trim();
          return { ...n, grants: { recipe: { name: rec.name || n.name, tier: rec.tier, materials: rec.materials, output: rec.output, desc: rec.desc } }, desc: n.desc || (oneLiner ? oneLiner.slice(0, 60) : n.desc) };
        }
        return n;
      });
      const v = validateTree({ ...raw1, nodes: mergedNodes, source: 'ai' });
      if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('生成的树有误：' + v.errors[0]); return; }
      const t = autoLayout(v.tree);
      st.upsertTree(t); setEditId(t.id); setSelId(undefined);
      const filled = t.nodes.filter((n) => n.grants?.recipe).length;
      const missing = recipeNodes.length - mergedCnt;
      const extra: string[] = [];
      if (t.branches.length !== nBr) extra.push(`流派数 ${t.branches.length}（要求 ${nBr}）`);
      if (missing > 0) extra.push(`${missing}/${recipeNodes.length} 张配方未详写成功（可重新生成、或对该节点单独补）`);
      setValid({ errors: [], warnings: [...v.warnings, ...extra] });
      flash(`已生成（${t.nodes.length}节点 / ${t.branches.length}流派 / ${filled}张配方）${extra.length ? '·' + extra.join('；') : '，可继续编辑'}`);
    } catch (e: any) {
      flash('生成失败：' + (e?.message || String(e)));
    } finally { setGenBusy(false); }
  };

  // ── AI 单独/批量重写选中配方节点（与整树生成同 API 路由 subproftree，独立提示词，只改选中节点）──
  const togglePick = (id: string) => setPickIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const callSubproftree = async (sys: string, user: string): Promise<string> => {
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('subproftree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（下方接口路由 / 综合设置 / 正文生成）');
    const base = { max_tokens: 80000 };
    const searchExtra = webSearch ? { tools: [{ google_search: {} }] } : undefined;
    const once = (extra: Record<string, unknown>) => apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }], { timeoutMs: 150000, extra });
    try { return (await once(webSearch ? { ...base, ...searchExtra } : base)).content; }
    catch (e) { if (!webSearch) throw e; return (await once(base)).content; }
  };
  const aiGenNodes = async () => {
    if (!tree) return;
    const ids = [...pickIds].filter((id) => tree.nodes.some((n) => n.id === id));
    if (!ids.length) { flash('先选中要重写的节点（在画布点节点→「节点检视」里点 ＋AI重写）'); return; }
    const req = nodeReq.trim();
    if (!req) { flash('先写一句对这些配方的要求'); return; }
    setNodeBusy(true);
    try {
      flash(`正在重写选中的 ${ids.length} 个配方节点…`);
      const branchName = (bid: string) => tree.branches.find((b) => b.id === bid)?.name || bid;
      const picked = ids.map((id) => tree.nodes.find((n) => n.id === id)!);
      const payload = picked.map((n) => ({
        id: n.id, name: n.name, kind: n.kind, 流派: branchName(n.branch),
        当前配方: n.grants?.recipe ? n.grants.recipe : undefined,
        当前说明: n.desc,
      }));
      const ctx = JSON.stringify({ 副职业: tree.profession, 配方叫法: tree.recipeLabel || '配方', 流派: tree.branches.map((b) => ({ id: b.id, name: b.name })) });
      const userMsg = `副职业上下文：${ctx}\n\n主角的要求：${req}\n\n请【只重写】以下 ${picked.length} 个配方节点（按 id 一一对应、覆盖全部）：\n${JSON.stringify(payload)}`;
      const c = await callSubproftree(SUBPROFTREE_NODES_PROMPT, userMsg);
      const raw: any = lenientJsonParse(extractJson(c));
      const arr: any[] = Array.isArray(raw?.nodes) ? raw.nodes : (Array.isArray(raw) ? raw : (Array.isArray(raw?.recipes) ? raw.recipes : []));
      if (!arr.length) { flash('未返回有效节点，可重试'); return; }
      const norm = (x: any) => String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()]/g, '').toLowerCase();
      const byId = new Map<string, any>(); const byName = new Map<string, any>();
      for (const a of arr) { if (!a || typeof a !== 'object') continue; if (a.id) byId.set(String(a.id), a); const nm = a.name ?? a.recipe?.name; if (nm) byName.set(norm(nm), a); }
      let cnt = 0;
      const updated = tree.nodes.map((n) => {
        if (!pickIds.has(n.id)) return n;
        const a = byId.get(n.id) || byName.get(norm(n.name));
        if (!a || typeof a !== 'object') return n;
        cnt++;
        const newKind = ['minor', 'medium', 'major', 'capstone'].includes(a.kind) ? a.kind : n.kind;
        const rec = a.recipe ?? ((a.materials || a.output) ? a : undefined);
        const grants = rec && (rec.materials || rec.output || rec.name)
          ? { recipe: { name: rec.name || n.name, tier: rec.tier, materials: rec.materials, output: rec.output, desc: rec.desc } }
          : n.grants;
        return {
          ...n,
          name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : n.name,
          kind: newKind,
          cost: newKind !== n.kind ? defaultCost(newKind) : n.cost,
          grants,
          desc: typeof a.desc === 'string' && a.desc.trim() ? a.desc.trim() : n.desc,
        };
      });
      if (!cnt) { flash('返回的节点对不上所选 id/名称，可重试'); return; }
      const v = validateTree({ ...tree, nodes: updated, source: tree.source });   // 复用引擎规则；不重排版保留布局
      if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('重写结果有误：' + v.errors[0]); return; }
      st.upsertTree(v.tree);
      setValid({ errors: [], warnings: v.warnings });
      flash(`已重写 ${cnt}/${ids.length} 个配方节点` + (cnt < ids.length ? '（部分未匹配，可重试）' : '，可继续编辑'));
    } catch (e: any) {
      flash('重写失败：' + (e?.message || String(e)));
    } finally { setNodeBusy(false); }
  };

  const addNodeCenter = () => {
    if (!tree) return;
    const { w, h } = treeBounds(tree);
    const j = () => Math.round((Math.random() - 0.5) * 80);
    const id = st.addNode(tree.id, { x: Math.round(w / 2) + j(), y: Math.round(h / 2) + j(), name: '新节点', branch: tree.branches[0]?.id ?? '' });
    if (id) { setSelId(id); setConnectMode(false); setConnectFrom(undefined); }
  };
  const onBlankClick = (x: number, y: number) => {
    if (didPanRef.current) { didPanRef.current = false; return; }
    if (!tree) return;
    const id = st.addNode(tree.id, { x, y, name: '新节点', branch: tree.branches[0]?.id ?? '' });
    if (id) setSelId(id);
  };
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    didPanRef.current = false;
    if ((e.target as Element)?.closest?.('[data-node]')) return;
    const el = scrollRef.current; if (!el) return;
    panRef.current = { cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop, active: false };
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current, el = scrollRef.current;
    if (!p || !el) return;
    const dx = e.clientX - p.cx, dy = e.clientY - p.cy;
    if (!p.active) {
      if (Math.hypot(dx, dy) < 5) return;
      p.active = true; didPanRef.current = true; setGrabbing(true);
      try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件忽略 */ }
    }
    el.scrollLeft = p.sl - dx; el.scrollTop = p.st - dy;
  };
  const endCanvasPan = (e: React.PointerEvent) => {
    const p = panRef.current; panRef.current = null;
    if (p?.active) { setGrabbing(false); try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ } }
  };
  const onNodeClick = (id: string) => {
    if (!tree) return;
    if (connectMode) {
      if (!connectFrom) { setConnectFrom(id); return; }
      if (id !== connectFrom) { const ok = st.addEdge(tree.id, connectFrom, id); flash(ok ? '已连线' : '连线失败（会成环或已存在）'); }
      setConnectFrom(undefined); return;
    }
    setSelId(id);
  };

  const patchNode = (patch: any) => { if (tree && selId) st.updateNode(tree.id, selId, patch); };
  const setRecipe = (patch: any) => {
    if (!selNode) return;
    const cur = selNode.grants?.recipe ?? { name: selNode.name };
    patchNode({ grants: { recipe: { ...cur, ...patch } } });
  };
  const clearRecipe = () => patchNode({ grants: {} });

  return (
    <div className="max-w-6xl mx-auto">
      <p className="text-[13px] text-dim/60 mb-3">
        可视化编辑<b className="text-slate-300">副职业·配方星图</b>：节点解锁的是<b className="text-emerald-300">配方</b>（图纸/药方…），学到的配方只进副职业面板、<b className="text-slate-300">不进技能/天赋栏</b>；全程<b className="text-slate-300">不给六维属性</b>。点击空白建点、拖动移动、开「连线模式」点两个节点建前置。✨ AI 生成会先做「副职业发展是否合理」的详细思维链。做好的树可导出 <code className="text-dim">.subtree.json</code> 分享。
      </p>

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
        <input ref={fileRef} type="file" accept=".json,.subtree.json" className="hidden" onChange={importTree} />
        <div className="ml-auto"><button onClick={doValidate} disabled={!tree} className={btnCls}>✓ 校验</button></div>
      </div>

      {/* AI 生成副职业树 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-emerald-600/30 bg-emerald-900/10">
        <span className="text-[12px] font-mono text-emerald-300">✨ AI 生成（含「副职业发展是否合理」思维链）</span>
        <input value={genProf} onChange={(e) => setGenProf(e.target.value)} placeholder="副职业名，如：炼金术 / 锻造 / 制符 / 驯兽 / 烹饪"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-emerald-500/50" />
        <label className="flex items-center gap-1 text-[12px] text-dim/70 shrink-0" title="专精方向（流派）条数 2~10，每条 8~14 节点">
          <span className="font-mono text-emerald-300/90">流派数</span>
          <input type="number" min={2} max={10} value={genBranches} onChange={(e) => setGenBranches(e.target.value)}
            onBlur={() => setGenBranches(String(Math.max(2, Math.min(10, parseInt(genBranches, 10) || 3))))}
            className="w-14 bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-emerald-500/50" />
          <span className="text-[10px] text-dim/40">条·每条≥4配方</span>
        </label>
        <input value={genRef} onChange={(e) => setGenRef(e.target.value)} placeholder="参考来源/风格（选填，如：怪物猎人炼金 / 某小说）"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-emerald-500/50" />
        <textarea value={genDesc} onChange={(e) => setGenDesc(e.target.value)} rows={3}
          placeholder="副职业描述（选填，强烈建议填）：这门手艺的专精方向、招牌产物、材料体系、走向与气质……写得越具体，生成的配方星图越贴你的设想。"
          className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-emerald-500/50 resize-y leading-relaxed" />
        <label className="flex items-center gap-1 text-[12px] text-dim/70 cursor-pointer select-none">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} className="accent-emerald-500" />
          🌐 联网搜索<span className="text-[10px] text-dim/40">(Google·需接口支持)</span>
        </label>
        <button onClick={aiGen} disabled={genBusy}
          className="px-3 py-1 rounded border border-emerald-500/50 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 text-[12px] font-mono disabled:opacity-50">
          {genBusy ? '生成中…' : '生成一棵'}
        </button>
        <span className="text-[11px] text-dim/40 w-full sm:w-auto">两阶段：①推演合理性+搭结构 ②逐批详写配方（材料/产物/说明完整）。落为新模板可手动改 / 导出分享</span>
        <div className="w-full mt-1">
          <div className="text-[11px] font-mono text-dim/50 mb-1">AI 接口（独立路由：从「综合设置 → API 接口库」勾选，留空用正文/综合 API）</div>
          <ApiRoutePicker routeKey="subproftree" />
        </div>
      </div>

      {msg && <div className="mb-2 text-[12px] font-mono text-god">{msg}</div>}

      {!tree ? (
        <div className="text-center text-dim/40 text-sm py-16 border border-edge/40 rounded-xl">没有副职业树。点「新建」从空白开始，或「导入」一个 .subtree.json，或用上方 ✨ AI 生成。</div>
      ) : (
        <div className="flex gap-4 max-lg:flex-col">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button onClick={addNodeCenter} className="px-2.5 py-1 rounded border border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 text-[12px] font-mono">➕ 加节点</button>
              <button onClick={() => { setConnectMode((v) => !v); setConnectFrom(undefined); }}
                className={`px-2.5 py-1 rounded border text-[12px] font-mono transition-colors ${connectMode ? 'border-sky-500/60 text-sky-300 bg-sky-500/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                {connectMode ? '🔗 连线模式（点两个节点）' : '🔗 连线模式'}
              </button>
              <button onClick={() => st.relayout(tree.id)} className={btnCls}>⊞ 整理布局</button>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">－</button>
                <button onClick={() => setZoom(1)} className="px-2 h-7 rounded border border-edge text-[11px] font-mono text-dim hover:text-slate-200">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">＋</button>
                <span className="text-[11px] text-dim/40 ml-2">{tree.nodes.length} 节点</span>
              </div>
            </div>
            <div ref={scrollRef}
              className={`border border-edge rounded-xl bg-void/50 overflow-auto p-2 ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{ maxHeight: '72vh' }}
              onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove}
              onPointerUp={endCanvasPan} onPointerLeave={endCanvasPan} onPointerCancel={endCanvasPan}>
              <TreeCanvas tree={tree} ranks={EMPTY_RANKS} availableIds={EMPTY} mode="edit" selectedId={selId} connectFrom={connectFrom}
                onNodeClick={onNodeClick} onNodeMove={(id, x, y) => st.moveNode(tree.id, id, x, y)} onBlankClick={onBlankClick} zoom={zoom} heightVh={66} />
            </div>
          </div>

          <div className="w-80 max-lg:w-full shrink-0 space-y-4">
            {/* ✨ AI 单独/批量重写配方节点 */}
            <div className="border border-fuchsia-500/30 rounded-xl p-3 space-y-2 bg-fuchsia-500/[0.03]">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-fuchsia-300">✨ AI 重写配方节点 <span className="text-dim/50">（已选 {pickIds.size}）</span></span>
                {pickIds.size > 0 && <button onClick={() => setPickIds(new Set())} className="text-[11px] font-mono text-dim/50 hover:text-blood">清空</button>}
              </div>
              {pickIds.size === 0 ? (
                <p className="text-[11px] text-dim/45 leading-snug">在画布点已生成的节点，再到下方「节点检视」点 <b className="text-fuchsia-300/80">＋AI重写</b> 把它加进来（可多选）；然后写要求、一次生成。</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {[...pickIds].map((id) => {
                    const nd = tree?.nodes.find((n) => n.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-void border border-edge text-[11px] text-slate-300">
                        {nd?.name ?? id}
                        <button onClick={() => togglePick(id)} className="text-dim/40 hover:text-blood">✕</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <textarea rows={2} className={inputCls + ' resize-y'} placeholder="对选中配方的要求（如：把这张药剂改成群体回血、提高产物品质、换成毒系、改名为…）"
                value={nodeReq} onChange={(e) => setNodeReq(e.target.value)} />
              <button onClick={aiGenNodes} disabled={nodeBusy || pickIds.size === 0}
                className="w-full px-3 py-1.5 rounded bg-fuchsia-600/80 hover:bg-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-mono text-white transition-colors">
                {nodeBusy ? '重写中…' : `✨ 重写选中的 ${pickIds.size} 个配方节点`}
              </button>
              <p className="text-[10px] text-dim/35 leading-snug">用与「生成配方树」相同的 API 路由（subproftree），独立提示词，只改这些节点、不动整棵树。</p>
            </div>
            {/* 节点检视 */}
            {selNode ? (
              <div className="border border-edge rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-mono text-god">节点检视</span>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => togglePick(selNode.id)}
                      className={`text-[11px] font-mono transition-colors ${pickIds.has(selNode.id) ? 'text-fuchsia-300' : 'text-dim/50 hover:text-fuchsia-300'}`}>
                      {pickIds.has(selNode.id) ? '✓ 已加入重写' : '＋AI重写'}</button>
                    <button onClick={() => { if (tree) { st.removeNode(tree.id, selNode.id); setSelId(undefined); setPickIds((s) => { const n = new Set(s); n.delete(selNode.id); return n; }); } }} className="text-[11px] font-mono text-dim/50 hover:text-blood">🗑 删除</button>
                  </div>
                </div>
                <label className="block space-y-0.5"><span className={labelCls}>名称</span>
                  <input className={inputCls} value={selNode.name} onChange={(e) => patchNode({ name: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-0.5"><span className={labelCls}>流派</span>
                    <select className={inputCls} value={selNode.branch} onChange={(e) => patchNode({ branch: e.target.value })}>
                      {tree.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select></label>
                  <label className="block space-y-0.5"><span className={labelCls}>类型</span>
                    <select className={inputCls} value={selNode.kind} onChange={(e) => { const kind = e.target.value as any; patchNode({ kind, cost: defaultCost(kind) }); }}>
                      <option value="minor">微星(基本功)</option><option value="medium">配方·基础</option><option value="major">配方·招牌</option><option value="capstone">配方·宗师级</option>
                    </select></label>
                  <label className="block space-y-0.5"><span className={labelCls}>层</span>
                    <input type="number" min={1} className={inputCls} value={selNode.layer} onChange={(e) => patchNode({ layer: Math.max(1, Number(e.target.value) || 1) })} /></label>
                  <label className="block space-y-0.5"><span className={labelCls}>潜能点花费/点</span>
                    <input type="number" min={0} className={inputCls} value={selNode.cost} onChange={(e) => patchNode({ cost: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="block space-y-0.5 col-span-2"><span className={labelCls}>累计点数门槛(spentGate·0=无)</span>
                    <input type="number" min={0} className={inputCls} value={selNode.spentGate ?? ''} placeholder="0=无" onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); patchNode({ spentGate: v || undefined }); }} /></label>
                  {/* 副职业树已取消阶位限制：不再有「阶位 gate」字段（任何阶位都可学配方） */}
                </div>
                <label className="block space-y-0.5"><span className={labelCls}>说明</span>
                  <textarea rows={2} className={inputCls + ' resize-y'} value={selNode.desc ?? ''} onChange={(e) => patchNode({ desc: e.target.value })} /></label>

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

                {/* 配方编辑（medium/major/capstone 节点解锁的配方）*/}
                <div className="pt-1 border-t border-edge/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={labelCls}>📜 解锁配方（微星可留空）</span>
                    {selNode.grants?.recipe && <button onClick={clearRecipe} className="text-[11px] text-dim/40 hover:text-blood">清除</button>}
                  </div>
                  <input className={inputCls} placeholder="配方名" value={selNode.grants?.recipe?.name ?? ''} onChange={(e) => setRecipe({ name: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className={inputCls} placeholder="档位(新手/熟练/专家/大师/宗师)" value={selNode.grants?.recipe?.tier ?? ''} onChange={(e) => setRecipe({ tier: e.target.value })} />
                    <input className={inputCls} placeholder="材料" value={selNode.grants?.recipe?.materials ?? ''} onChange={(e) => setRecipe({ materials: e.target.value })} />
                  </div>
                  <textarea rows={2} className={inputCls + ' resize-y'} placeholder="产物：成品名 + 效果" value={selNode.grants?.recipe?.output ?? ''} onChange={(e) => setRecipe({ output: e.target.value })} />
                  <input className={inputCls} placeholder="点评/背景（选填）" value={selNode.grants?.recipe?.desc ?? ''} onChange={(e) => setRecipe({ desc: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="border border-edge/50 rounded-xl p-3 text-[12px] text-dim/50">点击画布空白处加节点，或点节点查看/编辑。</div>
            )}

            {/* 树信息 */}
            <div className="border border-edge rounded-xl p-3 space-y-2">
              <span className="text-[12px] font-mono text-god">树信息</span>
              <label className="block space-y-0.5"><span className={labelCls}>副职业名（= 配方挂靠的副职业）</span>
                <input className={inputCls} value={tree.profession} onChange={(e) => st.updateTreeMeta(tree.id, { profession: e.target.value })} /></label>
              <label className="block space-y-0.5"><span className={labelCls}>显示标题</span>
                <input className={inputCls} value={tree.title ?? ''} onChange={(e) => st.updateTreeMeta(tree.id, { title: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-0.5"><span className={labelCls}>配方叫法</span>
                  <input className={inputCls} placeholder="图纸/药方/锻造图…" value={tree.recipeLabel ?? ''} onChange={(e) => st.updateTreeMeta(tree.id, { recipeLabel: e.target.value })} /></label>
                <label className="block space-y-0.5"><span className={labelCls}>大类</span>
                  <input className={inputCls} placeholder="制造/医疗/生活…" value={tree.category ?? ''} onChange={(e) => st.updateTreeMeta(tree.id, { category: e.target.value })} /></label>
              </div>
            </div>

            {/* 流派 */}
            <div className="border border-edge rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-god">流派支</span>
                <button onClick={() => st.addBranch(tree.id, '')} className="text-[11px] text-god hover:underline">＋ 加流派</button>
              </div>
              {tree.branches.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <input type="color" value={b.color} onChange={(e) => st.updateBranch(tree.id, b.id, { color: e.target.value })} className="w-6 h-6 rounded bg-transparent border border-edge cursor-pointer shrink-0" />
                  <input className={inputCls} value={b.name} onChange={(e) => st.updateBranch(tree.id, b.id, { name: e.target.value })} />
                  <button onClick={() => st.removeBranch(tree.id, b.id)} disabled={tree.branches.length <= 1} className="text-dim/40 hover:text-blood disabled:opacity-30 shrink-0">✕</button>
                </div>
              ))}
            </div>

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
