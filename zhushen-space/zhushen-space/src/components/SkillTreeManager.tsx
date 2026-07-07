import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSkillTree, type NodeGrants } from '../store/skillTreeStore';
import { validateTree, autoLayout, defaultCost, attrDeltaText, treeBounds } from '../systems/skillTree';
import { TIERS } from '../systems/derivedStats';
import { ATTR_KEYS, ATTR_LABEL } from '../systems/attrBonus';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { SKILLTREE_STRUCT_PROMPT, SKILLTREE_SKILLS_PROMPT, SKILLTREE_NODES_PROMPT } from '../promptRules';
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

/* 从 AI 回复里抠出 JSON 本体（容忍 markdown 代码块/前后废话/思考模型的整段思维链）。
   思维链里常有零碎 {…}，故优先取代码块、再用「从末尾配平括号」抓最后一个完整 JSON 对象，最后才退首{到末}。 */
function extractJson(text: string): string {
  let s = String(text ?? '');
  // 1) 优先取最后一个 ```json … ``` / ``` … ``` 代码块（模型常把最终答案放代码块）
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let k = fences.length - 1; k >= 0; k--) { const blk = fences[k][1].trim(); if (blk.includes('{')) { s = blk; break; } }
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  // 2) 从最后一个 } 往回配平括号，取最后一个完整 JSON 对象（绕开思维链里的零碎 {}）
  const end = s.lastIndexOf('}');
  if (end >= 0) {
    let depth = 0;
    for (let k = end; k >= 0; k--) {
      const c = s[k];
      if (c === '}') depth++;
      else if (c === '{') { depth--; if (depth === 0) return s.slice(k, end + 1); }
    }
  }
  // 3) 兜底：首 { 到末 }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  return (i >= 0 && j > i) ? s.slice(i, j + 1) : s;
}

export default function SkillTreeManager() {
  const trees = useSkillTree((s) => s.trees);
  const activeId = useSkillTree((s) => s.progress['B1']?.activeTreeId);   // 主角当前生效的技能树 id（订阅→切换即刷新徽标）
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
  const [genBranches, setGenBranches] = useState('4');   // 流派数量（字符串态·允许自由输入；用时再 clamp 到 2~12）
  const [genTierGate, setGenTierGate] = useState(true);  // 生成时是否给节点加阶位限制（关=任意阶位都可点·像副职业树）
  const [genTrunk, setGenTrunk] = useState(false);       // 主干式：先一条通用主干往上，再从主干顶端分出各流派（树状）
  const [webSearch, setWebSearch] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [pickIds, setPickIds] = useState<Set<string>>(new Set());   // AI 单独/批量重写：选中的已生成节点 id
  const [nodeReq, setNodeReq] = useState('');                        // 对选中节点的重写要求
  const [nodeBusy, setNodeBusy] = useState(false);
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
    const nBr = Math.max(2, Math.min(12, parseInt(genBranches, 10) || 4));
    const searchExtra = webSearch ? { tools: [{ google_search: {} }] } : undefined;
    // 调一次 AI；统一给足 max_tokens（思考模型要留够 思维链 + 正文输出的空间，否则只思考不出答案）；可选联网搜索(失败回退无搜索)
    const GEN_MAX_TOKENS = 80000;
    const call = async (sys: string, user: string, useSearch: boolean) => {
      const base = { max_tokens: GEN_MAX_TOKENS };
      const withSearch = useSearch ? { ...base, ...searchExtra } : base;
      const once = (extra: Record<string, unknown>) => apiChatFallback(chain, [
        { role: 'system', content: sys }, { role: 'user', content: user },
      ], { timeoutMs: 150000, extra });
      try { return (await once(withSearch)).content; }
      catch (e) { if (!useSearch) throw e; return (await once(base)).content; }   // 搜索被拒→退回无搜索(仍带 max_tokens)
    };

    setGenBusy(true);
    try {
      // ── 第一阶段：结构骨架（短·不会被截断）──
      flash('① 生成结构骨架中…（约 10~30 秒）');
      const structMsg = [
        `职业：${prof}`,
        genTrunk
          ? `【主干式·树状结构】生成「通用主干 + ${nBr} 条专精流派」：\n ① 先从 core 拉一条【通用主干】branch(id="trunk"、name="通用")：一条直线 6~9 个节点、串成单链(每个节点 prereqs 指向前一个)，放该职业【不论走哪条流派都通用的基础技能】(基础攻击/资源运用/位移/感知/通用强化…)，layer 从 0 依次递增。\n ② 主干末端之后再分流：${nBr} 条【专精流派】branch，每条流派最内侧起点的 prereqs **指向主干的末端节点 id**(不是 core)，从主干顶端分出向上生长。\n ③ 每条专精流派至少 5 颗中型(medium 小技能) + 2 颗大节点(major/capstone)，外加微星/1 星核位/1 无尽端点，约 15~22 节点。\n ④ branches 数组 = 1 条 trunk + ${nBr} 条专精(共 ${nBr + 1} 条)，trunk 放第一个。`
          : `流派数量：${nBr}（必须 ${nBr} 条 branch；每条至少 5 颗中型(medium 小技能) + 2 颗大节点(major/capstone)，外加微星/星核位/无尽端点，约 15~22 节点）`,
        ref && `参考来源/风格：${ref}`,
        desc && `主角对该职业的描述/期望：\n${desc}`,
        '只搭结构 + 技能名，不要写技能描述。只输出 JSON。',
      ].filter(Boolean).join('\n');
      const c1 = await call(SKILLTREE_STRUCT_PROMPT, structMsg, !!webSearch);
      const raw1: any = lenientJsonParse(extractJson(c1));
      const rawNodes: any[] = Array.isArray(raw1?.nodes) ? raw1.nodes : [];
      if (!rawNodes.length) { flash('结构生成失败（未返回节点，可重试）'); return; }

      // ── 第二阶段：技能详写（按批，防截断）──
      const skillNodes = rawNodes.filter((n) => ['medium', 'major', 'capstone'].includes(n?.kind));
      const branchName = (id: string) => (raw1?.branches || []).find((b: any) => b?.id === id)?.name || id;
      const skillsById = new Map<string, any>();
      const skillsByName = new Map<string, any>();   // 技能名兜底匹配（AI 常不照抄 id）
      const normName = (x: any) => String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()]/g, '').toLowerCase();
      const BATCH = 14;
      const batches: any[][] = [];
      for (let i = 0; i < skillNodes.length; i += BATCH) batches.push(skillNodes.slice(i, i + BATCH));
      for (let bi = 0; bi < batches.length; bi++) {
        flash(`② 详写技能中… 第 ${bi + 1}/${batches.length} 批（共 ${skillNodes.length} 个技能）`);
        const list = batches[bi].map((n) => ({ id: n.id, name: n.name, kind: n.kind, 流派: branchName(n.branch) }));
        const skillMsg = `职业：${prof}\n请为以下 ${list.length} 个技能节点逐个【详细】撰写(覆盖全部、按 id 一一对应)：\n${JSON.stringify(list)}`;
        try {
          const c2 = await call(SKILLTREE_SKILLS_PROMPT, skillMsg, !!webSearch);   // 详写也走联网搜索(还原真实技能)
          const raw2: any = lenientJsonParse(extractJson(c2));
          // 兼容 {skills:[...]} 或直接 [...] 或 {nodeId:{skill}} 等形态
          const arr = Array.isArray(raw2?.skills) ? raw2.skills : (Array.isArray(raw2) ? raw2 : []);
          for (const s of arr) {
            if (!s || typeof s !== 'object') continue;
            if (s.id) skillsById.set(String(s.id), s);
            const nm = s.skill?.name ?? s.trait?.name ?? s.name;
            if (nm) skillsByName.set(normName(nm), s);
          }
        } catch { /* 单批失败不致命，继续其它批 */ }
      }

      // ── 合并 grants（id 优先、技能名兜底）→ 节点说明取技能简述 → 校验 → 落树 ──
      let mergedCnt = 0;
      const mergedNodes = rawNodes.map((n) => {
        const s = skillsById.get(String(n.id)) || skillsByName.get(normName(n.name));
        if (s && (s.skill || s.trait)) {
          mergedCnt++;
          const grant = s.skill ? { skill: s.skill } : { trait: s.trait };
          const oneLiner = String(s.skill?.desc || s.skill?.effect || s.trait?.desc || s.trait?.effect || '').trim();
          return { ...n, grants: grant, desc: n.desc || (oneLiner ? oneLiner.slice(0, 60) : n.desc) };   // 节点「说明」= 技能简述(若空)
        }
        return n;
      });
      const v = validateTree({ ...raw1, nodes: mergedNodes, source: 'ai', noTierGate: !genTierGate, layout: genTrunk ? 'trunk' : undefined });
      if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('生成的树有误：' + v.errors[0]); return; }
      const t = autoLayout(v.tree);
      st.upsertTree(t); setEditId(t.id); setSelId(undefined); setPickIds(new Set());
      st.setActiveTree('B1', t.id);   // 生成即设为主角当前生效技能树（治「生成完游戏里没变」）
      const filled = t.nodes.filter((n) => n.grants?.skill || n.grants?.trait).length;
      const missing = skillNodes.length - mergedCnt;
      const extra: string[] = [];
      const expectBr = genTrunk ? nBr + 1 : nBr;   // 主干式多 1 条通用主干
      if (t.branches.length !== expectBr) extra.push(`流派数 ${t.branches.length}（要求 ${expectBr}${genTrunk ? '·含通用主干' : ''}）`);
      if (missing > 0) extra.push(`${missing}/${skillNodes.length} 个技能未详写成功（多半是详写阶段被接口截断/报错，可重新生成、或对该节点单独补）`);
      setValid({ errors: [], warnings: [...v.warnings, ...extra] });
      flash(`已生成并设为当前生效树（${t.nodes.length}节点 / ${t.branches.length}流派 / ${filled}个技能）${extra.length ? '·' + extra.join('；') : '，可继续编辑'}`);
    } catch (e: any) {
      flash('生成失败：' + (e?.message || String(e)));
    } finally { setGenBusy(false); }
  };

  // ── AI 单独/批量重写选中节点（与整树生成同 API 路由 skilltree，独立提示词，只改选中节点）──
  const togglePick = (id: string) => setPickIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const callSkilltree = async (sys: string, user: string): Promise<string> => {
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('skilltree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→综合设置 / 正文生成）');
    const base = { max_tokens: 80000 };
    const searchExtra = webSearch ? { tools: [{ google_search: {} }] } : undefined;
    const once = (extra: Record<string, unknown>) => apiChatFallback(chain, [
      { role: 'system', content: sys }, { role: 'user', content: user },
    ], { timeoutMs: 150000, extra });
    try { return (await once(webSearch ? { ...base, ...searchExtra } : base)).content; }
    catch (e) { if (!webSearch) throw e; return (await once(base)).content; }   // 搜索被拒→退回无搜索
  };
  const aiGenNodes = async () => {
    if (!tree) return;
    const ids = [...pickIds].filter((id) => tree.nodes.some((n) => n.id === id));
    if (!ids.length) { flash('先选中要重写的节点（在画布点节点→「节点检视」里点 ＋AI重写）'); return; }
    const req = nodeReq.trim();
    if (!req) { flash('先写一句对这些节点的要求'); return; }
    setNodeBusy(true);
    try {
      flash(`正在重写选中的 ${ids.length} 个节点…`);
      const branchName = (bid: string) => tree.branches.find((b) => b.id === bid)?.name || bid;
      const picked = ids.map((id) => tree.nodes.find((n) => n.id === id)!);
      const payload = picked.map((n) => ({
        id: n.id, name: n.name, kind: n.kind, 流派: branchName(n.branch),
        当前内容: n.grants?.skill ? { skill: n.grants.skill } : (n.grants?.trait ? { trait: n.grants.trait } : (n.ptAttr ? { ptAttr: n.ptAttr } : {})),
        当前说明: n.desc,
      }));
      const ctx = JSON.stringify({ 职业: tree.profession, 标题: tree.title, 流派: tree.branches.map((b) => ({ id: b.id, name: b.name })) });
      const userMsg = `职业上下文：${ctx}\n\n主角的要求：${req}\n\n请【只重写】以下 ${picked.length} 个节点（按 id 一一对应、覆盖全部）：\n${JSON.stringify(payload)}`;
      const c = await callSkilltree(SKILLTREE_NODES_PROMPT, userMsg);
      const raw: any = lenientJsonParse(extractJson(c));
      const arr: any[] = Array.isArray(raw?.nodes) ? raw.nodes : (Array.isArray(raw) ? raw : (Array.isArray(raw?.skills) ? raw.skills : []));
      if (!arr.length) { flash('未返回有效节点，可重试'); return; }
      const norm = (x: any) => String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()]/g, '').toLowerCase();
      const byId = new Map<string, any>(); const byName = new Map<string, any>();
      for (const a of arr) { if (!a || typeof a !== 'object') continue; if (a.id) byId.set(String(a.id), a); const nm = a.name ?? a.skill?.name ?? a.trait?.name; if (nm) byName.set(norm(nm), a); }
      let cnt = 0;
      const updated = tree.nodes.map((n) => {
        if (!pickIds.has(n.id)) return n;
        const a = byId.get(n.id) || byName.get(norm(n.name));
        if (!a || typeof a !== 'object') return n;
        cnt++;
        const newKind = ['minor', 'medium', 'major', 'capstone'].includes(a.kind) ? a.kind : n.kind;
        const grant = a.skill ? { skill: a.skill } : (a.trait ? { trait: a.trait } : (a.grants ?? n.grants));
        return {
          ...n,
          name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : n.name,
          kind: newKind,
          cost: newKind !== n.kind ? defaultCost(newKind) : n.cost,
          grants: grant,
          ptAttr: a.ptAttr ?? n.ptAttr,
          desc: typeof a.desc === 'string' && a.desc.trim() ? a.desc.trim() : n.desc,
        };
      });
      if (!cnt) { flash('返回的节点对不上所选 id/名称，可重试'); return; }
      const v = validateTree({ ...tree, nodes: updated, source: tree.source });   // 复用引擎规则(属性收口/阶位)；不重排版保留布局
      if (!v.ok) { setValid({ errors: v.errors, warnings: v.warnings }); flash('重写结果有误：' + v.errors[0]); return; }
      st.upsertTree(v.tree);
      setValid({ errors: [], warnings: v.warnings });
      flash(`已重写 ${cnt}/${ids.length} 个节点` + (cnt < ids.length ? '（部分未匹配，可重试）' : '，可继续编辑'));
    } catch (e: any) {
      flash('重写失败：' + (e?.message || String(e)));
    } finally { setNodeBusy(false); }
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
        <select value={editId ?? ''} onChange={(e) => { setEditId(e.target.value); setSelId(undefined); setPickIds(new Set()); setNodeReq(''); }}
          className="bg-panel2 border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50">
          {!treeList.length && <option value="">（无树，点新建）</option>}
          {treeList.map((t) => <option key={t.id} value={t.id}>{t.title || t.profession}{t.source === 'builtin' ? '（内置）' : ''}{t.id === activeId ? ' ✓生效中' : ''}</option>)}
        </select>
        {/* 树名（标题）就近可改——不用再翻到底部「树信息」*/}
        {tree && <input value={tree.title ?? ''} onChange={(e) => st.updateTreeMeta(tree.id, { title: e.target.value })} placeholder="技能树名字（标题）"
          className="w-44 bg-panel2 border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50" title="给这棵技能树改名（标题）；下方「树信息」还可改职业名" />}
        <button onClick={newTree} className={btnCls}>＋ 新建</button>
        <button onClick={() => fileRef.current?.click()} className={btnCls}>⭳ 导入</button>
        <button onClick={exportTree} disabled={!tree} className={btnCls}>⭱ 导出</button>
        <button onClick={delTree} disabled={!tree} className={btnCls + ' hover:!text-blood hover:!border-blood/40'}>🗑 删除</button>
        <input ref={fileRef} type="file" accept=".json,.tree.json" className="hidden" onChange={importTree} />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={doValidate} disabled={!tree} className={btnCls}>✓ 校验</button>
          {tree && editId === activeId
            ? <span className="px-3 py-1 rounded border border-lime-500/40 text-lime-300/90 bg-lime-500/10 text-[12px] font-mono">✓ 游戏中生效</span>
            : <button onClick={setActive} disabled={!tree} className="px-3 py-1 rounded border border-amber-400/70 text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 text-[12px] font-mono animate-pulse" title="当前编辑的这棵还没在游戏里生效——点此让主角改用这棵">⚠ 设为当前树（点了才生效）</button>}
        </div>
      </div>

      {/* AI 生成职业树 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-fuchsia-600/30 bg-fuchsia-900/10">
        <span className="text-[12px] font-mono text-fuchsia-300">✨ AI 生成</span>
        <input value={genProf} onChange={(e) => setGenProf(e.target.value)} placeholder="职业名，如：枪械师 / 元素法师 / 死灵术士"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
        {/* 流派数量：= 从中心放射的初始线条数，每条 branch 12~16 节点 */}
        <label className="flex items-center gap-1 text-[12px] text-dim/70 shrink-0" title="从中心原点放射的流派（初始线）条数（2~12）；每条流派 12~16 个节点">
          <span className="font-mono text-fuchsia-300/90">流派数</span>
          <input type="number" min={2} max={12} value={genBranches}
            onChange={(e) => setGenBranches(e.target.value)}
            onBlur={() => setGenBranches(String(Math.max(2, Math.min(12, parseInt(genBranches, 10) || 4))))}
            className="w-14 bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
          <span className="text-[10px] text-dim/40">条(2~12)·每条≥12节点</span>
        </label>
        <input value={genRef} onChange={(e) => setGenRef(e.target.value)} placeholder="参考来源/风格（选填，如：英雄联盟剑圣 / 某小说）"
          onKeyDown={(e) => { if (e.key === 'Enter' && !genBusy) aiGen(); }}
          className="flex-1 min-w-[160px] bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50" />
        {/* 职业描述：主角自述对该职业的理解 / 期望流派 / 气质 → 喂给 AI 定调 */}
        <textarea value={genDesc} onChange={(e) => setGenDesc(e.target.value)} rows={3}
          placeholder="职业描述（选填，但强烈建议填）：主角对这个职业的理解、想要的流派方向、招牌能力、气质与背景设定……写得越具体，AI 生成的星图越贴你的设想。"
          className="w-full bg-void border border-edge rounded px-2 py-1.5 text-[13px] text-slate-200 outline-none focus:border-fuchsia-500/50 resize-y leading-relaxed" />
        <label className="flex items-center gap-1 text-[12px] text-dim/70 cursor-pointer select-none" title="勾选=越往后的节点要求越高阶位才能点（封顶七阶）；取消=任意阶位都能点，无阶位限制（像副职业树）">
          <input type="checkbox" checked={genTierGate} onChange={(e) => setGenTierGate(e.target.checked)} className="accent-fuchsia-500" />
          🔒 阶位限制<span className="text-[10px] text-dim/40">(越后越高·封顶七阶；取消=不限阶位)</span>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-dim/70 cursor-pointer select-none" title="勾选=树状主干式：先一条通用主干往上学基础/通用技能，再从主干顶端分出各专精流派；取消=四周放射式（默认）">
          <input type="checkbox" checked={genTrunk} onChange={(e) => setGenTrunk(e.target.checked)} className="accent-fuchsia-500" />
          🌳 主干式<span className="text-[10px] text-dim/40">(先通用主干再分流派；取消=放射式)</span>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-dim/70 cursor-pointer select-none">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} className="accent-fuchsia-500" />
          🌐 联网搜索<span className="text-[10px] text-dim/40">(Google·需接口支持)</span>
        </label>
        <button onClick={aiGen} disabled={genBusy}
          className="px-3 py-1 rounded border border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-[12px] font-mono disabled:opacity-50">
          {genBusy ? '生成中…' : '生成一棵'}
        </button>
        <span className="text-[11px] text-dim/40 w-full sm:w-auto">两阶段生成：①先搭结构骨架 ②再逐批【详细】详写技能（每条流派 ≥5 小技能 + ≥2 大技能·全详写）。耗时较长(约 1~2 分钟)，落为新预设可手动改 / 导出分享</span>
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
            {/* ✨ AI 单独/批量重写节点 */}
            <div className="border border-fuchsia-500/30 rounded-xl p-3 space-y-2 bg-fuchsia-500/[0.03]">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-fuchsia-300">✨ AI 重写节点 <span className="text-dim/50">（已选 {pickIds.size}）</span></span>
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
              <textarea rows={2} className={inputCls + ' resize-y'} placeholder="对选中节点的要求（如：改成火属性爆发流、提高机制密度、把这两个小技能升成大招、改名为…）"
                value={nodeReq} onChange={(e) => setNodeReq(e.target.value)} />
              <button onClick={aiGenNodes} disabled={nodeBusy || pickIds.size === 0}
                className="w-full px-3 py-1.5 rounded bg-fuchsia-600/80 hover:bg-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-mono text-white transition-colors">
                {nodeBusy ? '重写中…' : `✨ 重写选中的 ${pickIds.size} 个节点`}
              </button>
              <p className="text-[10px] text-dim/35 leading-snug">用与「生成技能树」相同的 API 路由（skilltree），独立提示词，只改这些节点、不动整棵树。</p>
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
                    <button onClick={() => { if (tree) { st.removeNode(tree.id, selNode.id); setSelId(undefined); setPickIds((s) => { const n = new Set(s); n.delete(selNode.id); return n; }); } }}
                      className="text-[11px] font-mono text-dim/50 hover:text-blood">🗑 删除</button>
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
                    <select className={inputCls} value={selNode.kind}
                      onChange={(e) => { const kind = e.target.value as any; patchNode({ kind, cost: defaultCost(kind) }); }}>
                      <option value="minor">微星(只属性)</option><option value="medium">中型(子技能)</option><option value="major">核心</option><option value="capstone">终极</option>
                    </select></label>
                  <label className="block space-y-0.5"><span className={labelCls}>层</span>
                    <input type="number" min={1} className={inputCls} value={selNode.layer} onChange={(e) => patchNode({ layer: Math.max(1, Number(e.target.value) || 1) })} /></label>
                  <label className="block space-y-0.5"><span className={labelCls}>潜能点花费/点</span>
                    <input type="number" min={0} className={inputCls} value={selNode.cost} onChange={(e) => patchNode({ cost: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="block space-y-0.5"><span className={labelCls}>累计点数门槛(spentGate)</span>
                    <input type="number" min={0} className={inputCls} value={selNode.spentGate ?? ''} placeholder="0=无" onChange={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); patchNode({ spentGate: v || undefined }); }} /></label>
                  <label className="block space-y-0.5 col-span-2"><span className={labelCls}>阶位 gate（已停用·阶位限制已移除，不再生效）</span>
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
                  {/* 技能详情内联预览（不必点编辑就能看到 AI 写的完整效果）*/}
                  {selNode.grants.skill && grantForm !== 'skill' && (
                    <div className="text-[11px] bg-void/50 rounded px-2 py-1 space-y-0.5 -mt-1">
                      <div className="flex gap-x-2 gap-y-0.5 flex-wrap text-dim/50">
                        {selNode.grants.skill.skillType && <span>{String(selNode.grants.skill.skillType)}</span>}
                        {selNode.grants.skill.rarity && <span className="text-amber-300/70">{String(selNode.grants.skill.rarity)}</span>}
                        {selNode.grants.skill.cost && <span>消耗:{String(selNode.grants.skill.cost)}</span>}
                        {selNode.grants.skill.cooldown && <span>冷却:{String(selNode.grants.skill.cooldown)}</span>}
                        {selNode.grants.skill.damage && <span>伤害:{String(selNode.grants.skill.damage)}</span>}
                      </div>
                      {selNode.grants.skill.effect && <div className="text-slate-300/75 leading-snug whitespace-pre-wrap">{String(selNode.grants.skill.effect)}</div>}
                      {selNode.grants.skill.desc && <div className="text-dim/45 italic">{String(selNode.grants.skill.desc)}</div>}
                    </div>
                  )}
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
                  {selNode.grants.trait && grantForm !== 'trait' && (selNode.grants.trait.effect || selNode.grants.trait.rarity) && (
                    <div className="text-[11px] bg-void/50 rounded px-2 py-1 space-y-0.5 -mt-1">
                      {selNode.grants.trait.rarity && <span className="text-amber-300/70">{String(selNode.grants.trait.rarity)}级</span>}
                      {selNode.grants.trait.effect && <div className="text-slate-300/75 leading-snug whitespace-pre-wrap">{String(selNode.grants.trait.effect)}</div>}
                    </div>
                  )}
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
