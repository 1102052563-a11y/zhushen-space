import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSkillTree, nodeEffectiveGrant, type NodeGrants } from '../store/skillTreeStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { SKILL_TIER_CLS, RARITY_CLS, normSkillTier, useCharacters } from '../store/characterStore';
import {
  canRankUp, availablePP, potentialBudget, attrDeltaText, treeProgressStats, effectiveTierName,
  nodeRank, nodeMaxRank, treeAttrDelta, SKILLTREE_TUNING, constellationStatus, coinPerPP,
  expressBranchIds, ownedNameSet,
} from '../systems/skillTree';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { SKILL_UPGRADE_PROMPT, STARCORE_GEN_PROMPT, CONSTELLATION_AWAKEN_PROMPT } from '../promptRules';
import TreeCanvas from './TreeCanvas';

/* 通用：调技能树路由的 AI，输入 system+user，回 JSON（联网搜索失败自动回退）*/
async function aiJson(systemPrompt: string, userMsg: string): Promise<any> {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('skilltree', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→综合设置/正文生成）');
  const once = (extra: Record<string, unknown>) => apiChatFallback(chain, [
    { role: 'system', content: systemPrompt }, { role: 'user', content: userMsg },
  ], { timeoutMs: 150000, extra });
  const base = { max_tokens: 80000 };   // 思考模型留够 思维链+正文 空间
  let content: string;
  try { ({ content } = await once({ ...base, tools: [{ google_search: {} }] })); }
  catch { ({ content } = await once(base)); }
  return lenientJsonParse(extractJson(content));
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

/* 玩家技能树面板（主角 B1）：选职业树 → 花潜能点逐点点节点(3豆子) → 灌进技能/天赋 + 六维加成。 */

export default function SkillTreePanel({ onClose }: { onClose: () => void }) {
  const trees = useSkillTree((s) => s.trees);
  const prog = useSkillTree((s) => s.progress['B1']);
  const setActiveTree = useSkillTree((s) => s.setActiveTree);
  const profile = usePlayer((s) => s.profile);
  const parkCoin = useItems((s) => s.currency['乐园币'] ?? 0);
  const [selId, setSelId] = useState<string | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [, force] = useState(0);   // 兑换后强制刷新
  const [upgradingId, setUpgradingId] = useState<string | undefined>(undefined);
  const [upMsg, setUpMsg] = useState('');
  const [confirmUpId, setConfirmUpId] = useState<string | undefined>(undefined);   // 升级二次确认（防误点烧 token）
  const [hlConst, setHlConst] = useState<string | undefined>(undefined);   // 高亮中的星座 id
  const [awakeningId, setAwakeningId] = useState<string | undefined>(undefined);   // 觉醒中的星座
  const [embeddingId, setEmbeddingId] = useState<string | undefined>(undefined);   // 炼核中的 socket
  const [socketPick, setSocketPick] = useState(false);   // 星核镶嵌的背包选物弹层

  // 画布平移/缩放：拖动空白处平移（滚动容器），滚轮以光标为锚缩放
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ cx: number; cy: number; sl: number; st: number } | null>(null);
  const zoomRef = useRef(zoom);   zoomRef.current = zoom;
  const zoomAnchor = useRef<{ sl: number; st: number; cx: number; cy: number; f: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const treeList = Object.values(trees);
  const activeId = prog?.activeTreeId;
  const tree = activeId ? trees[activeId] : undefined;

  // 首次进入且未选树：自动挑一棵（职业匹配优先，否则第一棵）
  useEffect(() => {
    if (activeId && trees[activeId]) return;
    if (!treeList.length) return;
    const match = treeList.find((t) => t.profession && profile.profession && t.profession === profile.profession);
    setActiveTree('B1', (match ?? treeList[0]).id);
  }, [activeId, treeList.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 滚轮缩放（以光标为锚，非被动监听以便 preventDefault 阻止页面滚动）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const nz = Math.min(3, Math.max(0.5, +(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
      if (nz === z) return;
      const rect = el.getBoundingClientRect();
      // 记录缩放前的滚动+光标位，待 DOM 重排后在 layout effect 里校正滚动，保持光标下内容点不动
      zoomAnchor.current = { sl: el.scrollLeft, st: el.scrollTop, cx: e.clientX - rect.left, cy: e.clientY - rect.top, f: nz / z };
      zoomRef.current = nz;
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 缩放后校正滚动位（DOM 已按新 zoom 重排）
  useLayoutEffect(() => {
    const el = scrollRef.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = (a.sl + a.cx) * a.f - a.cx;
    el.scrollTop = (a.st + a.cy) * a.f - a.cy;
    zoomAnchor.current = null;
  }, [zoom]);

  // 拖动空白处平移（点到节点则交给节点选中，不平移）
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element)?.closest?.('[data-node]')) return;
    const el = scrollRef.current;
    if (!el) return;
    panRef.current = { cx: e.clientX, cy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setGrabbing(true);
    try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件忽略 */ }
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current, el = scrollRef.current;
    if (!p || !el) return;
    el.scrollLeft = p.sl - (e.clientX - p.cx);
    el.scrollTop = p.st - (e.clientY - p.cy);
  };
  const endPan = (e: React.PointerEvent) => {
    if (!panRef.current) return;
    panRef.current = null;
    setGrabbing(false);
    try { scrollRef.current?.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
  };

  // 传承·提前解锁：主角已通过其它途径拥有某路终极技能/天赋 → 该路提前解锁、每节点 1 潜能点
  const b1 = useCharacters((s) => s.characters['B1']);
  const expressBranches = expressBranchIds(tree, ownedNameSet(b1?.skills, b1?.traits));
  const ctx = { level: profile.level, tier: profile.tier, expressBranches };
  const ranks = prog?.ranks ?? {};
  const availableIds = new Set(
    (tree?.nodes ?? []).filter((n) => canRankUp(tree, n.id, prog, ctx).ok).map((n) => n.id),
  );
  const avail = availablePP(prog, ctx);
  const budget = potentialBudget(profile.level, profile.tier);
  const stats = treeProgressStats(tree, prog);
  const effTier = effectiveTierName(profile.tier, profile.level);
  const treeDelta = treeAttrDelta(tree, prog);   // 当前技能树六维总加成（普通等值）
  const constStats = constellationStatus(tree, prog);   // 星座成型进度

  // 乐园币兑换潜能点：阶位基础价 × 1.25^已兑换数（越买越贵，防囤点）
  const exBase = coinPerPP(profile.tier, profile.level);
  const exBought = prog?.exchangedPP ?? 0;
  const exPrice = Math.max(1, Math.round(exBase * Math.pow(SKILLTREE_TUNING.ppCoinStep, exBought)));   // 下一点价格
  let exAffordable = 0, _exAcc = 0;   // 按递增价能买几点
  while (exAffordable < 999) {
    const p = Math.max(1, Math.round(exBase * Math.pow(SKILLTREE_TUNING.ppCoinStep, exBought + exAffordable)));
    if (_exAcc + p > parkCoin) break;
    _exAcc += p; exAffordable++;
  }

  const selNode = tree?.nodes.find((n) => n.id === selId);
  const selChk = selNode && tree ? canRankUp(tree, selNode.id, prog, ctx) : undefined;
  const selExpress = !!(selNode?.branch && expressBranches.has(selNode.branch));   // 传承提前解锁的路线 → 花费 1
  const selCost = selExpress ? 1 : (selNode?.cost ?? 0);
  const selRank = selNode ? nodeRank(prog, selNode.id) : 0;
  const selMaxR = selNode ? nodeMaxRank(selNode) : 0;
  const selGrant = selNode ? nodeEffectiveGrant(prog, selNode) : {};   // 生效中的技能/天赋（升级后覆盖）
  const selIsBig = !!(selGrant.skill || selGrant.trait);
  const selIsUpgrade = selIsBig && selRank >= 1;   // 大节点 rank≥1 再点=AI 升级
  const items = useItems((s) => s.items);
  const socketCore = selNode?.socket ? prog?.sockets?.[selNode.id] : undefined;
  const socketActive = selNode?.socket ? (selNode.prereqs ?? []).every((p) => nodeRank(prog, p) >= 1) : false;

  // AI 升级当前技能/天赋（rank2/3）：输入当前信息 → 大幅强化版（联网搜索+特性，失败回退无搜索）
  const aiUpgrade = async (grant: NodeGrants): Promise<NodeGrants | null> => {
    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('skilltree', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→综合设置/正文生成）');
    const isSkill = !!grant.skill;
    const cur: any = grant.skill ?? grant.trait;
    const userMsg = `当前${isSkill ? '技能' : '天赋'}（升级前·完整信息）：\n${JSON.stringify(cur)}\n\n请把它大幅升级一档（数值大幅提升 + 新增 1~2 个新效果），按系统要求只输出升级后的 JSON。`;
    const once = (extra?: Record<string, unknown>) => apiChatFallback(chain, [
      { role: 'system', content: SKILL_UPGRADE_PROMPT }, { role: 'user', content: userMsg },
    ], { timeoutMs: 150000, extra });
    let content: string;
    try { ({ content } = await once({ tools: [{ google_search: {} }] })); }
    catch { ({ content } = await once(undefined)); }   // 接口不支持搜索→回退普通
    const raw: any = lenientJsonParse(extractJson(content));
    if (!raw || typeof raw !== 'object' || !(raw.name || cur.name)) return null;
    raw.name = cur.name;   // 同名=同一技能的升级（防 AI 改名导致技能栏另建）
    return isSkill ? { skill: raw } : { trait: raw };
  };

  const doRankUp = async () => {
    if (!selNode || upgradingId) return;
    setConfirmUpId(undefined);
    if (!canRankUp(tree, selNode.id, prog, ctx).ok) return;
    if (selIsUpgrade) {
      setUpgradingId(selNode.id); setUpMsg('技能正在升级中…');
      try {
        const upd = await aiUpgrade(selGrant);
        if (upd && useSkillTree.getState().applyNodeUpgrade('B1', selNode.id, upd)) setUpMsg('✓ 升级完成！技能栏已同步');
        else setUpMsg('升级失败（未返回有效内容）');
      } catch (e: any) { setUpMsg('升级失败：' + (e?.message || String(e))); }
      finally { setUpgradingId(undefined); setTimeout(() => setUpMsg(''), 3000); }
    } else {
      useSkillTree.getState().rankUpNode('B1', selNode.id);   // 普通节点 / 大节点 rank0→1（灌技能，无 API）
    }
    setSelId(selNode.id);
  };
  const doExchange = (count: number) => {
    const got = useSkillTree.getState().exchangePP('B1', count);
    if (got > 0) force((x) => x + 1);
  };
  const doRespec = () => {
    const cost = useSkillTree.getState().respecCoinCost('B1');
    if (cost <= 0) { setUpMsg('没有可洗的小节点（大节点不可洗）'); setTimeout(() => setUpMsg(''), 2500); return; }
    const have = useItems.getState().currency['乐园币'] || 0;
    if (have < cost) { window.alert(`洗点需 ${cost.toLocaleString()} 乐园币，当前只有 ${have.toLocaleString()}。`); return; }
    if (!window.confirm(`洗点：仅退还「小节点(星点)」的点数，「大节点(技能/天赋)」不可洗、予以保留。代价 ${cost.toLocaleString()} 乐园币。确定？`)) return;
    useSkillTree.getState().respec('B1');
    setSelId(undefined); force((x) => x + 1);
  };

  // 星座觉醒：AI 据星座炼成质变奖励（计费·二次确认）
  const doAwaken = async (cst: any) => {
    if (awakeningId) return;
    if (!window.confirm(`觉醒「${cst.name}」？将调用 AI（计费）炼成质变奖励，同步技能/天赋栏。`)) return;
    setAwakeningId(cst.id); setUpMsg(`「${cst.name}」觉醒中…`);
    try {
      const members = (cst.nodeIds || []).map((id: string) => tree!.nodes.find((n) => n.id === id)).filter(Boolean)
        .map((n: any) => { const g = nodeEffectiveGrant(prog, n); return `${n.name}${g.skill ? `(技能:${g.skill.name})` : g.trait ? `(天赋:${g.trait.name})` : ''}`; }).join('、');
      const raw = await aiJson(CONSTELLATION_AWAKEN_PROMPT, `星座：${cst.name}\n组成节点：${members}\n当前模板奖励：${JSON.stringify(cst.reward ?? {})}\n请炼成更强的觉醒奖励 JSON。`);
      if (raw && typeof raw === 'object' && raw.name) {
        const reward = (raw.skillType || raw.damage || raw.cooldown || raw.target) ? { skill: raw } : { trait: raw };
        setUpMsg(useSkillTree.getState().applyConstellationReward('B1', cst.id, reward) ? '✓ 觉醒完成！已入技能/天赋栏' : '觉醒失败');
      } else setUpMsg('觉醒失败（未返回有效内容）');
    } catch (e: any) { setUpMsg('觉醒失败：' + (e?.message || String(e))); }
    finally { setAwakeningId(undefined); setTimeout(() => setUpMsg(''), 3500); }
  };

  // 星核镶嵌：选背包物品 → AI 据物品炼成星核 + 终端大节点技能 → 嵌入并生成「脉络链」（计费）
  const doEmbed = async (item: any) => {
    if (!selNode?.socket || embeddingId) return;
    // 同一件物品重新装回 → 复用原脉络链、免 API、不丢已点点数
    const prev = prog?.sockets?.[selNode.id];
    if (prev?.itemName && prev.itemName === item.name && prev.chainNodeIds?.length) {
      useSkillTree.getState().reactivateSocket('B1', selNode.id);
      setSocketPick(false); force((x) => x + 1);
      setUpMsg(`✓ 已重新装回「${item.name}」（保留原脉络链）`); setTimeout(() => setUpMsg(''), 3000);
      return;
    }
    setEmbeddingId(selNode.id); setSocketPick(false); setUpMsg('星核炼成 + 脉络生成中…');
    try {
      const raw = await aiJson(STARCORE_GEN_PROMPT, `物品信息（品级越高，星核与终端技能越强；越低则越弱）：\n${JSON.stringify({ name: item.name, category: item.category, grade: item.gradeDesc, effect: item.effect, affix: item.affix, combatStat: item.combatStat, intro: item.intro })}\n请据此炼成星核 + 终端大节点技能 JSON（效果强度随该物品品级递增）。`);
      const c = (raw && typeof raw === 'object') ? (raw.core ?? raw) : null;   // 新格式 raw.core / 兼容旧顶层
      const terminal: NodeGrants = {};
      if (raw?.skill && typeof raw.skill === 'object') terminal.skill = raw.skill;
      if (raw?.trait && typeof raw.trait === 'object') terminal.trait = raw.trait;
      if (c && (c.ptAttr || c.name)) {
        const core = { itemName: item.name, name: c.name || item.name, effect: c.effect || '', ptAttr: c.ptAttr, radius: selNode.socketRadius };
        if (terminal.skill || terminal.trait) {
          useSkillTree.getState().embedSocketChain('B1', selNode.id, core, terminal);   // 嵌核 + 生成脉络链终端大节点
          setUpMsg('✓ 星核已嵌入，已生成脉络链（终端含大节点技能，可逐点解锁）');
        } else {
          useSkillTree.getState().embedSocket('B1', selNode.id, core);   // 兜底：仅嵌核（AI 没给技能）
          setUpMsg('✓ 星核已嵌入（未生成终端技能，可重试）');
        }
      } else setUpMsg('炼成失败（未返回有效内容）');
    } catch (e: any) { setUpMsg('炼成失败：' + (e?.message || String(e))); }
    finally { setEmbeddingId(undefined); setTimeout(() => setUpMsg(''), 4000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-[95vw] max-h-[94vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg">🌳</span>
              <h2 className="text-base font-bold text-slate-100">技能树</h2>
              {tree && <span className="text-[13px] font-mono text-dim/50">已点 {stats.unlocked}/{stats.total} 节点 · {stats.ranksOwned}/{stats.ranksMax} 点</span>}
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">每个节点可点 <span className="text-slate-300">3</span> 次(豆子)，每点花<span className="text-lime-300">潜能点</span>给属性加成；升一级得 4 潜能点。有效阶位 <span className="text-slate-300">{effTier}</span>。</p>
            {attrDeltaText(treeDelta) && <p className="text-[12px] text-sky-300/80 mt-0.5">本树六维加成：{attrDeltaText(treeDelta)}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-[11px] text-dim/50 font-mono">可用潜能</div>
              <div className="text-lg font-bold text-lime-300 leading-none">{avail}</div>
              <div className="text-[10px] text-dim/40 font-mono">升级{budget}·额外{prog?.aiBonusPP ?? 0}·已用{prog?.spent ?? 0}</div>
            </div>
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono ml-1">✕</button>
          </div>
        </header>

        {/* 职业树选择 + 洗点 */}
        <div className="flex flex-wrap items-center gap-2 max-lg:gap-y-2 px-4 py-2 border-b border-edge/60 shrink-0">
          <span className="text-[12px] text-dim/60 font-mono">职业树</span>
          <select
            value={activeId ?? ''}
            onChange={(e) => { setActiveTree('B1', e.target.value); setSelId(undefined); }}
            className="bg-panel2 border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50"
          >
            {!treeList.length && <option value="">（暂无职业树，去设置→技能树创建）</option>}
            {treeList.map((t) => <option key={t.id} value={t.id}>{t.title || t.profession}</option>)}
          </select>
          {tree && (
            <div className="ml-auto flex flex-wrap items-center gap-3 max-lg:ml-0 max-lg:w-full max-lg:justify-end">
              <div className="hidden sm:flex items-center gap-2">
                {tree.branches.map((b) => (
                  <span key={b.id} className="flex items-center gap-1 text-[11px] text-dim/60">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />{b.name}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">－</button>
                <button onClick={() => setZoom(1)} className="px-2 h-7 rounded border border-edge text-[11px] font-mono text-dim hover:text-slate-200" title="重置缩放">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} className="w-7 h-7 rounded border border-edge text-dim hover:text-slate-200 font-mono">＋</button>
              </div>
              <button onClick={() => doExchange(1)} disabled={exAffordable < 1}
                title={`兑换下一点 = ${exPrice.toLocaleString()} 乐园币（越买越贵：阶位基础价 ×1.25^已兑${exBought}）`}
                className="text-[12px] font-mono text-amber-300/90 hover:text-amber-200 border border-amber-600/40 rounded px-2 py-1 disabled:opacity-40">
                ⇄ 兑换潜能点<span className="text-[10px] text-dim/50 ml-1">可兑{exAffordable}</span>
              </button>
              <button onClick={doRespec} className="text-[12px] font-mono text-dim/50 hover:text-amber-300 border border-edge rounded px-2 py-1">↺ 洗点</button>
            </div>
          )}
        </div>

        {/* 星座成型奖励：点亮一组节点合拢图案 → 觉醒奖励；点击高亮其节点；成型可 AI 觉醒强化 */}
        {constStats.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-edge/40 shrink-0 overflow-x-auto">
            <span className="text-[11px] font-mono text-amber-300/80 shrink-0">✦ 星座</span>
            {constStats.map((c) => (
              <span key={c.id} className="shrink-0 flex items-center gap-1">
                <button
                  onMouseEnter={() => setHlConst(c.id)} onMouseLeave={() => setHlConst(undefined)}
                  onClick={() => setHlConst((x) => x === c.id ? undefined : c.id)}
                  title={`${c.reward?.skill?.name || c.reward?.trait?.name || '奖励'}：${c.reward?.skill?.effect || c.reward?.trait?.effect || ''}`}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${c.complete
                    ? 'border-amber-400/60 text-amber-200 bg-amber-500/15'
                    : (hlConst === c.id ? 'border-amber-400/50 text-amber-200' : 'border-edge text-dim/70 hover:text-slate-200')}`}>
                  {c.complete ? '★' : '☆'} {c.name} {c.lit}/{c.total}
                </button>
                {c.complete && (
                  <button onClick={() => doAwaken(c)} disabled={!!awakeningId}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-fuchsia-500/50 text-fuchsia-200 hover:bg-fuchsia-500/15 disabled:opacity-40">
                    {awakeningId === c.id ? '觉醒中…' : '✨觉醒'}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div
          ref={scrollRef}
          className={`flex-1 overflow-auto p-3 ${tree ? (grabbing ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          onPointerDown={tree ? onCanvasPointerDown : undefined}
          onPointerMove={tree ? onCanvasPointerMove : undefined}
          onPointerUp={endPan}
          onPointerLeave={endPan}
          onPointerCancel={endPan}
        >
          {!tree && <div className="text-center text-dim/40 text-sm py-16">还没有职业树。到「设置 → 变量管理 → 技能树」里创建或导入一套职业模板。</div>}
          {tree && (
            <TreeCanvas
              tree={tree}
              ranks={ranks}
              availableIds={availableIds}
              mode="play"
              selectedId={selId}
              onNodeClick={setSelId}
              zoom={zoom}
              heightVh={78}
              highlightConstId={hlConst}
              expressBranches={expressBranches}
            />
          )}
        </div>

        {/* 选中节点详情 + 解锁 */}
        {selNode && (
          <div className="border-t border-edge p-4 shrink-0 max-h-[38vh] overflow-y-auto bg-panel2/30">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-100">{asText(selNode.name)}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-dim/70">
                    {selNode.socket ? '星核镶嵌位' : selNode.sink ? '无尽' : selNode.kind === 'capstone' ? '终极' : selNode.kind === 'major' ? '核心' : selNode.kind === 'medium' ? '中型' : '普通'}
                  </span>
                  {!selNode.socket && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-sky-600/50 text-sky-300 font-mono">
                    点数 {selRank}{selNode.sink ? '/∞' : `/${selMaxR}`}
                  </span>)}
                  {!!selNode.spentGate && !selExpress && <span className="text-[11px] px-1.5 py-0.5 rounded border border-edge text-amber-300/80 font-mono">需累计 {selNode.spentGate} 点</span>}
                  {selExpress && <span className="text-[11px] px-1.5 py-0.5 rounded border border-amber-400/60 text-amber-200 bg-amber-500/15 font-mono">传承·提前解锁（每点 1）</span>}
                  {selNode.ptAttr && <span className="text-[11px] text-dim/70">每点 {attrDeltaText(selNode.ptAttr)}{selNode.realAttr ? '（真实属性）' : ''}</span>}
                </div>
                {selNode.desc && <p className="text-[13px] text-dim/70 mt-1 leading-relaxed">{asText(selNode.desc)}</p>}
              </div>
              {!selNode.socket && (
              <button
                onClick={() => { if (selIsUpgrade) setConfirmUpId(selNode.id); else doRankUp(); }}
                disabled={!selChk?.ok || !!upgradingId}
                className={`shrink-0 px-4 py-1.5 rounded text-[13px] font-mono transition-colors ${(selChk?.ok && !upgradingId)
                  ? (selIsUpgrade ? 'border border-fuchsia-500/50 text-fuchsia-200 bg-fuchsia-500/10 hover:bg-fuchsia-500/20' : 'border border-lime-500/50 text-lime-300 bg-lime-500/10 hover:bg-lime-500/20')
                  : 'border border-edge text-dim/40 cursor-not-allowed'}`}
              >{upgradingId === selNode.id ? '升级中…' : selRank === 0 ? '解锁' : selIsUpgrade ? '⬆ 升级技能' : '＋点一次'} <span className="text-[11px] opacity-70">潜能 {selCost}{selExpress ? '·传承' : ''}</span></button>)}
            </div>
            {/* 星核镶嵌位 */}
            {selNode.socket && (
              <div className="mt-2 space-y-1.5">
                {!socketActive && <p className="text-[12px] text-amber-400/80">⚠ 需先点亮前置节点，星核位才可用。</p>}
                {socketCore ? (socketCore.active === false ? (
                  // 已拆卸：保留脉络链，可装回同物品(免 API)或换新物品(替换链)
                  <div className="rounded border border-edge bg-void/40 px-2.5 py-1.5">
                    <div className="text-[13px] text-dim/70">💤 已拆卸：「{socketCore.name}」<span className="text-[11px] text-dim/50 ml-2">脉络链已保留</span></div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <button onClick={() => { useSkillTree.getState().reactivateSocket('B1', selNode.id); force((x) => x + 1); }}
                        className="text-[11px] font-mono text-fuchsia-200 border border-fuchsia-500/50 rounded px-2 py-0.5 hover:bg-fuchsia-500/15">↺ 装回「{socketCore.itemName}」</button>
                      <button onClick={() => setSocketPick(true)} disabled={!socketActive || !!embeddingId}
                        className="text-[11px] font-mono text-dim/70 border border-edge rounded px-2 py-0.5 hover:text-fuchsia-200 disabled:opacity-40">💠 换新物品</button>
                      <button onClick={() => { if (window.confirm('彻底移除星核 + 脉络链？(物品不返还、已点点数清空)')) { useSkillTree.getState().clearSocket('B1', selNode.id); force((x) => x + 1); } }}
                        className="text-[11px] font-mono text-dim/40 hover:text-blood ml-auto">彻底移除</button>
                    </div>
                  </div>
                ) : (
                  // 已嵌入·激活
                  <div className="rounded border border-fuchsia-600/40 bg-fuchsia-900/10 px-2.5 py-1.5">
                    <div className="text-[13px] text-fuchsia-200 font-semibold">💠 {socketCore.name}<span className="text-[11px] text-dim/60 ml-2">炼自「{socketCore.itemName}」</span></div>
                    {socketCore.effect && <div className="text-[12px] text-dim/80 mt-0.5">{socketCore.effect}</div>}
                    {socketCore.ptAttr && <div className="text-[11px] text-sky-300 mt-0.5">半径内每颗已点亮微星 +{attrDeltaText(socketCore.ptAttr)}</div>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <button onClick={() => { useSkillTree.getState().detachSocket('B1', selNode.id); force((x) => x + 1); }}
                        className="text-[11px] font-mono text-dim/60 hover:text-amber-300 border border-edge rounded px-2 py-0.5">拆卸（保留脉络链）</button>
                      <button onClick={() => setSocketPick(true)} disabled={!!embeddingId}
                        className="text-[11px] font-mono text-dim/60 hover:text-fuchsia-200 border border-edge rounded px-2 py-0.5">💠 换物品</button>
                    </div>
                  </div>
                )) : (
                  <button onClick={() => setSocketPick(true)} disabled={!socketActive || !!embeddingId}
                    className="text-[12px] font-mono px-3 py-1 rounded border border-fuchsia-500/50 text-fuchsia-200 hover:bg-fuchsia-500/15 disabled:opacity-40">
                    {embeddingId === selNode.id ? '星核炼成中…' : '💠 镶嵌星核（选背包物品·AI 炼成）'}
                  </button>
                )}
                {/* 背包选物弹层 */}
                {socketPick && (
                  <div className="mt-1 max-h-40 overflow-y-auto border border-edge rounded bg-void/60 divide-y divide-edge/40">
                    {items.length === 0 && <div className="text-[12px] text-dim/40 p-2">背包没有物品。</div>}
                    {items.map((it) => (
                      <button key={it.id} onClick={() => { if (window.confirm(`把「${it.name}」炼成星核嵌入？将调用 AI（计费）。`)) doEmbed(it); }}
                        className="w-full text-left px-2 py-1 text-[12px] text-slate-200 hover:bg-fuchsia-500/10">
                        {it.name} <span className="text-[10px] text-dim/50">{it.gradeDesc || it.category}</span>
                      </button>
                    ))}
                    <button onClick={() => setSocketPick(false)} className="w-full text-[11px] text-dim/50 py-1 hover:text-slate-300">取消</button>
                  </div>
                )}
              </div>
            )}
            {/* 升级二次确认：将调用 AI（计费）*/}
            {confirmUpId === selNode.id && selIsUpgrade && upgradingId !== selNode.id && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[12px] text-fuchsia-300">确认升级此{selGrant.skill ? '技能' : '天赋'}？将调用 AI（计费）大幅强化。</span>
                <button onClick={doRankUp} className="px-3 py-1 rounded border border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-[12px] font-mono">确认升级（调用 AI）</button>
                <button onClick={() => setConfirmUpId(undefined)} className="px-2 py-1 rounded border border-edge text-dim text-[12px] font-mono">取消</button>
              </div>
            )}
            {selIsUpgrade && upgradingId !== selNode.id && confirmUpId !== selNode.id && !upMsg && (
              <p className="text-[12px] text-fuchsia-300/70 mt-1.5">↑ 再投一点将调用 AI 大幅升级此{selGrant.skill ? '技能' : '天赋'}（数值跃升 + 新增效果），技能栏同步更新。</p>
            )}
            {upgradingId === selNode.id && <p className="text-[12px] text-fuchsia-300 mt-1.5 animate-pulse">⚙ 技能正在升级中…（联网检索 + 据特性强化，约 10~40 秒）</p>}
            {upMsg && upgradingId !== selNode.id && <p className="text-[12px] text-fuchsia-300 mt-1.5">{upMsg}</p>}
            {!selChk?.ok && selChk?.reason && (
              <p className="text-[12px] text-amber-400/80 mt-1.5">⚠ {selChk.reason}</p>
            )}
            {/* 当前生效的技能/天赋（升级后同步显示）*/}
            <GrantPreview grant={selGrant} />
          </div>
        )}
      </div>
    </div>
  );
}

/* 把 AI 生成的任意字段安全转成可渲染文本（防对象/数组直接当 React child 导致整页崩溃）*/
function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('、');
  if (typeof v === 'object') { const ad = attrDeltaText(v); return ad || Object.entries(v).map(([k, val]) => `${k}:${asText(val)}`).join('、'); }
  return String(v);
}
/* tags 容错：数组→规整；字符串→按分隔符拆；其它→空 */
function asTags(v: any): string[] {
  if (Array.isArray(v)) return v.map(asText).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，、/|]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function GrantPreview({ grant }: { grant: NodeGrants }) {
  const g = grant ?? {};
  if (!g.skill && !g.trait && !g.attr) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-[11px] font-mono text-dim/50">当前技能/天赋（解锁即入技能栏；rank2/3 升级同步更新）</div>
      {g.skill && (
        <div className={`rounded border px-2.5 py-1.5 ${SKILL_TIER_CLS[normSkillTier(asText(g.skill.rarity))] ?? 'border-edge text-slate-300'}`}>
          <div className="flex items-center gap-2 text-[13px] flex-wrap">
            <span className="font-semibold">⚡ {asText(g.skill.name)}</span>
            {g.skill.level && <span className="text-[11px] opacity-70">{asText(g.skill.level)}</span>}
            {g.skill.skillType && <span className="text-[11px] opacity-70">{asText(g.skill.skillType)}</span>}
            {g.skill.rarity && <span className="text-[11px] opacity-80">{asText(g.skill.rarity)}</span>}
          </div>
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] opacity-70 mt-0.5">
            {g.skill.cost && <span>消耗:{asText(g.skill.cost)}</span>}
            {g.skill.cooldown && <span>冷却:{asText(g.skill.cooldown)}</span>}
            {g.skill.target && <span>目标:{asText(g.skill.target)}</span>}
            {g.skill.damage && <span>伤害:{asText(g.skill.damage)}</span>}
          </div>
          {g.skill.effect && <div className="text-[12px] opacity-80 mt-0.5">{asText(g.skill.effect)}</div>}
          {g.skill.attrBonus && <div className="text-[11px] opacity-70 mt-0.5">加成：{asText(g.skill.attrBonus)}</div>}
          {asTags(g.skill.tags).length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {asTags(g.skill.tags).map((t, i) => <span key={i} className="text-[10px] px-1 rounded bg-black/30 border border-current/20 opacity-70">{t}</span>)}
            </div>
          )}
        </div>
      )}
      {g.trait && (
        <div className={`rounded border px-2.5 py-1.5 ${RARITY_CLS[asText(g.trait.rarity)] ?? 'border-edge text-slate-300'}`}>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold">✦ {asText(g.trait.name)}</span>
            {g.trait.category && <span className="text-[11px] opacity-70">{asText(g.trait.category)}</span>}
            {g.trait.rarity && <span className="text-[11px] opacity-80">{asText(g.trait.rarity)}级</span>}
          </div>
          {g.trait.effect && <div className="text-[12px] opacity-80 mt-0.5">{asText(g.trait.effect)}</div>}
          {g.trait.attrBonus && <div className="text-[11px] opacity-70 mt-0.5">加成：{asText(g.trait.attrBonus)}</div>}
        </div>
      )}
      {g.attr && Object.keys(g.attr).length > 0 && (
        <div className="rounded border border-sky-700/40 text-sky-300 px-2.5 py-1.5 text-[13px]">
          📊 属性加成：{attrDeltaText(g.attr)}
        </div>
      )}
    </div>
  );
}
