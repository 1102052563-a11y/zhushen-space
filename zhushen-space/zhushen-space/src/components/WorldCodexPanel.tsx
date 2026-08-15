import { useMemo, useState } from 'react';
import { openSettingsPage } from '../systems/navBus';   // P4·空态深链：一键直达设置子页
import { useMisc } from '../store/miscStore';
import { useWorldCodex, resolveCodexEntry } from '../store/worldCodexStore';
import { CODEX_MODULES, type CodexModule } from '../worldCodexModules';
import { genCodexSection } from '../systems/worldCodex';

/* 世界百科面板：为当前同人任务世界生成「原著情报」供玩家阅读。
   标签分页——一次只看一个条目，避免长内容堆叠。纯参考，不注入正文。 */

const isHomeWorld = (name?: string) => /轮回乐园|专属房间|主神空间/.test(name ?? '');

/* tab 上的短标签 */
const SHORT: Record<string, string> = {
  world_summary: '简介',
  key_plot_points: '剧情脉络',
  hidden_arc: '隐藏线',
  unique_assets: '世界至宝',
  canon_characters_bio: '人物志',
};

/* 去掉行首的列表/序号标记 */
const stripMarker = (l: string) => l.replace(/^\s*(?:[-•·*]|【\d+】|\(?\d+\)?[.、]|第?\d+[.、])\s*/, '').trim();
const isListLine = (l: string) => /^\s*(?:[-•·*]\s|【?\d+】?[.、]|\(\d+\))/.test(l);
/* 仅一个 **加粗** 标签、几乎无描述的行（如「**主要势力**：」）→ 子标题 */
const isSubHeader = (raw: string) => /^\*\*[^*]+\*\*\s*[：:]?\s*$/.test(stripMarker(raw));

/* 行内 Markdown：**加粗** → 高亮，其余原样。无 HTML 注入。 */
function renderInline(text: string) {
  const nodes: (string | JSX.Element)[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<strong key={k++} className="font-semibold text-slate-100">{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const CARD = 'rounded-lg border border-edge bg-panel2 shadow-sm';

/* 一条目正文（文字卡片内/段内通用）：名称｜… / 标签：描述 首段加重 */
function ItemContent({ raw }: { raw: string }) {
  const text = stripMarker(raw);
  if (/[｜|]/.test(text)) {
    const parts = text.split(/\s*[｜|]\s*/).map((s) => s.trim()).filter(Boolean);
    return (
      <span>
        <strong className="font-semibold text-slate-100">{renderInline(parts[0])}</strong>
        <span className="text-slate-400">{parts.slice(1).map((p, i) => <span key={i}>　·　{renderInline(p)}</span>)}</span>
      </span>
    );
  }
  const m = !/\*\*/.test(text) && text.match(/^([^：:]{1,18})([：:])([\s\S]+)$/);
  if (m) return <span><strong className="font-semibold text-slate-100">{m[1]}</strong>{m[2]}{renderInline(m[3])}</span>;
  return <span>{renderInline(text)}</span>;
}

/* 文字卡片内部：段落 + 项目符号列表，**加粗** 生效 */
function InnerBlock({ lines }: { lines: string[] }) {
  const out: JSX.Element[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    out.push(
      <ul key={`l${out.length}`} className="space-y-2 my-1.5">
        {buf.map((l, i) =>
          isSubHeader(l) ? (
            <li key={i} className="list-none font-semibold text-slate-100 pt-1">{renderInline(stripMarker(l).replace(/[：:]\s*$/, ''))}</li>
          ) : (
            <li key={i} className="list-none flex gap-2">
              <span className="text-indigo-300/60 shrink-0 mt-[3px] text-[11px]">▪</span>
              <span className="flex-1"><ItemContent raw={l} /></span>
            </li>
          ),
        )}
      </ul>,
    );
    buf = [];
  };
  lines.forEach((l) => {
    if (isListLine(l)) { buf.push(l); return; }
    flush();
    const head = /^(【[^】]+】|#+\s*.+|[A-C]【.+】)$/.test(l.trim());
    out.push(
      <p key={`p${out.length}`} className={`${head ? 'font-semibold text-slate-100' : ''} ${out.length ? 'mt-2' : ''}`}>
        {renderInline(l.replace(/^#+\s*/, ''))}
      </p>,
    );
  });
  flush();
  return <>{out}</>;
}

/* 取标题：# 标题 / **名称** / 【n】名称 / 「1. 大节标题」（短、无 ｜、不以句末标点结尾）。否则 null */
function entryTitle(line: string): string | null {
  const t = line.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^#{1,6}\s+(.+)$/))) return m[1].replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim();
  if ((m = t.match(/^\*\*([^*]+)\*\*\s*[:：]?\s*$/))) return m[1].trim();
  if ((m = t.match(/^【\d+】\s*([^：:｜|]{1,22})\s*[:：]?\s*$/))) return m[1].trim();
  if (/^\d{1,2}[.、]\s*\S/.test(t) && t.length <= 34 && !/[。！？.!?]$/.test(t) && !/[｜|]/.test(t)) return t;
  return null;
}

/* list 型内容按「条目」分组：以标题行为界，标题下的所有内容归入同一条目。
   全文无标题时（如「名称｜字段｜…」单行格式）每行即一条目。 */
function groupEntries(text: string): { title: string | null; body: string[] }[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const hasHeaders = lines.some((l) => entryTitle(l) !== null);
  const entries: { title: string | null; body: string[] }[] = [];
  if (!hasHeaders) {
    for (const l of lines) if (l.trim()) entries.push({ title: null, body: [l.trim()] });
    return entries;
  }
  let cur: { title: string | null; body: string[] } | null = null;
  for (const l of lines) {
    const h = entryTitle(l);
    if (h !== null) { cur = { title: h, body: [] }; entries.push(cur); continue; }
    if (!l.trim()) { if (cur && cur.body.length) cur.body.push(''); continue; }
    if (!cur) { cur = { title: null, body: [] }; entries.push(cur); }
    cur.body.push(l.trim());
  }
  return entries.filter((e) => e.title || e.body.some(Boolean));
}

/* 条目卡片内的正文：短标签行→小标题；标签：描述→加重；项目符号→列表；其余段落 */
function EntryBody({ lines }: { lines: string[] }) {
  const out: JSX.Element[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    out.push(
      <ul key={`l${out.length}`} className="space-y-1.5 my-1">
        {buf.map((l, i) => (
          <li key={i} className="list-none flex gap-2">
            <span className="text-indigo-300/55 shrink-0 mt-[3px] text-[11px]">▪</span>
            <span className="flex-1"><ItemContent raw={l} /></span>
          </li>
        ))}
      </ul>,
    );
    buf = [];
  };
  lines.forEach((l) => {
    if (!l) { flush(); return; }
    if (isListLine(l)) { buf.push(l); return; }
    flush();
    const sub = !/[：:｜|]/.test(l) && !/[。！？.!?]$/.test(l) && l.length <= 16; // 如「原著中做的关键事」
    if (sub) {
      out.push(<div key={`h${out.length}`} className="text-[12.5px] font-semibold text-indigo-200/75 mt-2.5 mb-0.5">{renderInline(l)}</div>);
    } else {
      out.push(<p key={`p${out.length}`} className={out.length ? 'mt-1.5' : ''}><ItemContent raw={l} /></p>);
    }
  });
  flush();
  return <>{out}</>;
}

/* 结构化条目「名称｜类别｜作用｜归属｜影响」：名称作标题、短类别作徽章、其余字段逐行分开（不再挤成一行） */
function StructuredEntry({ parts }: { parts: string[] }) {
  const rest = parts.slice(1);
  const badge = rest.length >= 2 && rest[0].length <= 12 ? rest[0] : null;
  const body = badge ? rest.slice(1) : rest;
  return (
    <>
      <div className="mb-1.5 flex items-baseline flex-wrap gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-100 text-[15px]">{renderInline(parts[0])}</span>
        {badge && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-200/85 bg-indigo-500/10 whitespace-nowrap">{badge}</span>}
      </div>
      <div className="space-y-1 text-slate-300 leading-[1.75]">
        {body.map((p, j) => (
          <div key={j} className="flex gap-2">
            <span className="text-indigo-400/35 shrink-0 mt-[4px] text-[9px]">◆</span>
            <span className="flex-1">{renderInline(p)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* 渲染：有标题→分节/逐条卡片（标题+正文）；text 型无标题→按段落块成卡。无 HTML 注入。 */
function CodexBody({ text, type }: { text: string; type: 'text' | 'list' }) {
  const entries = groupEntries(text);
  const anyTitle = entries.some((e) => e.title);

  // 简介这类无任何标题的纯文字：按空行分块成卡，保留段落感
  if (type === 'text' && !anyTitle) {
    const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    return (
      <div className="space-y-2.5 text-[14.5px] leading-[1.9] text-slate-200">
        {blocks.map((block, bi) => (
          <div key={bi} className={`${CARD} px-4 py-3`}>
            <InnerBlock lines={block.split('\n').map((l) => l.trim()).filter(Boolean)} />
          </div>
        ))}
      </div>
    );
  }

  // 其余：每个分节 / 每条目一张卡（编号大节、### 角色、｜单行 各归其卡）
  return (
    <div className="space-y-2.5 text-[14.5px] leading-[1.8] text-slate-200">
      {entries.map((e, i) => {
        const single = !e.title && e.body.length === 1 ? stripMarker(e.body[0]) : null;
        const parts = single && /[｜|]/.test(single) ? single.split(/\s*[｜|]\s*/).map((s) => s.trim()).filter(Boolean) : null;
        const hasBody = e.body.some(Boolean);
        return (
          <div key={i} className={`${CARD} border-l-[3px] border-l-indigo-500/50 px-3.5 py-2.5`}>
            {e.title ? (
              hasBody ? (
                <>
                  <div className="font-bold text-slate-100 text-[15px] mb-1.5 pb-1.5 border-b border-edge/60">{renderInline(e.title)}</div>
                  <EntryBody lines={e.body} />
                </>
              ) : (
                <div className="font-semibold text-slate-100">{renderInline(e.title)}</div>
              )
            ) : parts && parts.length > 1 ? (
              <StructuredEntry parts={parts} />
            ) : (
              <EntryBody lines={e.body} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── 已存资料页（回看）── 挖过的世界都留在 byWorld 里永不自动丢弃，这里给一个能切回去看的入口 */
type ArchiveItem = { k: string; label: string; done: number; at: number };

function ArchiveList({ items, isCur, onOpen, onDelete }: {
  items: ArchiveItem[];
  isCur: (k: string) => boolean;
  onOpen: (k: string) => void;
  onDelete: (a: ArchiveItem) => void;
}) {
  return (
    <div className="space-y-1">
      {items.map((a) => (
        <div key={a.k} className="flex items-center gap-1">
          <button
            onClick={() => onOpen(a.k)}
            className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
              isCur(a.k)
                ? 'border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/15'
                : 'border-edge bg-panel2 hover:border-indigo-500/30 hover:bg-panel'
            }`}
          >
            <span className="text-sm shrink-0">📖</span>
            <span className="flex-1 min-w-0 truncate text-[13px] text-slate-200">{a.label}</span>
            {isCur(a.k) && (
              <span className="shrink-0 text-[10px] font-mono px-1 py-0.5 rounded border border-emerald-500/40 text-emerald-300/90">当前</span>
            )}
            <span className="shrink-0 text-[11px] font-mono text-dim/45">{a.done}/{CODEX_MODULES.length}</span>
            <span className="shrink-0 text-[11px] font-mono text-dim/35">{new Date(a.at).toLocaleDateString()}</span>
          </button>
          <button
            onClick={() => onDelete(a)}
            className="shrink-0 px-1.5 py-1.5 text-[13px] text-dim/40 hover:text-blood transition-colors"
            title="删除这份资料页"
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  );
}

export default function WorldCodexPanel({ onClose }: { onClose: () => void }) {
  const worldName = useMisc((s) => s.worldName);
  const enabled = useWorldCodex((s) => s.enabled);
  const byWorld = useWorldCodex((s) => s.byWorld);
  const activeKey = useWorldCodex((s) => s.activeKey);
  const setIp = useWorldCodex((s) => s.setIp);
  const setSection = useWorldCodex((s) => s.setSection);
  const clearWorld = useWorldCodex((s) => s.clearWorld);

  // 回看：viewKey 指向 byWorld 里任一「已存资料页」→ 只读浏览；null=跟随当前世界。
  // 存储键可能是空串（当初 worldName 为空时建的），一律判 null 而非 truthy。
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  // 显示：优先当前世界的条目；解析不到（worldName 漂移/为空/换了世界）就粘住「上次生成」那条 → 关掉再打开内容不会消失。
  // 注意 activeKey 可能是空串（当初 worldName 为空时建的），直接用 byWorld[activeKey] 取，别用 truthy 判断丢掉空串键。
  const curEntry = resolveCodexEntry(byWorld, worldName);
  const viewEntry = viewKey !== null ? byWorld[viewKey] : undefined;   // 条目被删则 undefined → 自动落回当前世界
  const readOnly = viewEntry !== undefined;
  const entry = viewEntry ?? curEntry ?? byWorld[activeKey];

  const home = isHomeWorld(worldName);
  const [ip, setIpDraft] = useState(curEntry?.ipName || (worldName || '').trim() || entry?.ipName || '');
  // 写入键：世界名非空就用它（已有→覆盖、没有→建新）；世界名为空时退用玩家输入的作品名，再不行才落到上次生成那条。
  // 覆盖只在深挖/重新生成时发生 —— 这正是「直到下次重新生成才覆盖」。
  const opKey = (worldName || '').trim() || (ip || '').trim() || activeKey;
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [active, setActive] = useState<string>(CODEX_MODULES[0].key);

  const anyLoading = Object.values(loading).some(Boolean);
  const doneCount = CODEX_MODULES.filter((m) => entry?.sections?.[m.key]?.content).length;

  // 已存资料页清单：挖过内容的世界全部保留，按最近生成排序，随时切回去看
  const archives = useMemo<ArchiveItem[]>(
    () =>
      Object.entries(byWorld)
        .map(([k, e]) => ({
          k,
          label: (e.ipName || k).trim() || '（未命名世界）',
          done: CODEX_MODULES.filter((m) => e.sections?.[m.key]?.content).length,
          at: Object.values(e.sections ?? {}).reduce((mx, s) => Math.max(mx, s?.updatedAt || 0), 0),
        }))
        .filter((a) => a.done > 0)
        .sort((a, b) => b.at - a.at),
    [byWorld],
  );
  const isCurArchive = (k: string) => curEntry !== undefined && byWorld[k] === curEntry;
  const viewLabel = viewEntry ? (viewEntry.ipName || viewKey || '').trim() || '（未命名世界）' : '';

  const openArchive = (k: string) => {
    setListOpen(false);
    if (isCurArchive(k)) { setViewKey(null); return; }   // 点到当前世界那条 = 回到跟随模式
    setViewKey(k);
    const first = CODEX_MODULES.find((m) => byWorld[k]?.sections?.[m.key]?.content);
    if (first) setActive(first.key);
  };

  const deleteArchive = (a: ArchiveItem) => {
    if (!confirm(`删除「${a.label}」的已存资料页？（${a.done} 个条目，删后不可恢复）`)) return;
    if (viewKey === a.k) setViewKey(null);
    clearWorld(a.k);   // 传 byWorld 的精确存储键：resolveKey 先精确命中，不会误删别的世界
  };

  const genOne = async (mod: CodexModule, ipName: string) => {
    setLoading((s) => ({ ...s, [mod.key]: true }));
    setErr('');
    try {
      const content = await genCodexSection(mod, ipName);
      if (content) setSection(opKey, mod.key, content);
      else setErr(`「${mod.title}」未返回内容，可重试`);
    } catch (e: any) {
      setErr(`「${mod.title}」生成失败：${e?.message ?? e}`);
    } finally {
      setLoading((s) => ({ ...s, [mod.key]: false }));
    }
  };

  const genAll = async () => {
    const ipName = (ip || worldName).trim();
    setIp(opKey, ipName);
    await Promise.allSettled(CODEX_MODULES.map((m) => genOne(m, ipName)));
  };

  const regen = (mod: CodexModule) => {
    const ipName = (ip || worldName).trim();
    setIp(opKey, ipName);
    genOne(mod, ipName);
  };

  const activeMod = CODEX_MODULES.find((m) => m.key === active)!;
  const activeSec = entry?.sections?.[active];
  const activeBusy = loading[active];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-indigo-300/80 text-lg">📖</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">世界百科</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">同人世界原著情报 · 剧情先知 · 联网考据</div>
          </div>
          {enabled && (!home || readOnly) && <span className="text-[11px] font-mono text-dim/45 shrink-0">{doneCount}/{CODEX_MODULES.length}</span>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {!enabled ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-dim/50 text-sm font-mono">
            <div>
              世界百科已关闭。<br />
              去<button onClick={() => openSettingsPage('codex-manager')} className="text-god/80 underline underline-offset-2 hover:text-god mx-0.5">「设置 → 变量管理 → 📖 世界百科」</button>开启，并可为它单独配置支持联网搜索的接口。
            </div>
          </div>
        ) : home && !readOnly ? (
          archives.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-dim/50 text-sm font-mono">
              <div>
                当前身处主神空间 / 轮回乐园，没有「原著」可考。<br />
                进入某个同人任务世界后，再来此处深挖该世界的原著情报。
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="text-center text-dim/50 text-sm font-mono mb-6">
                当前身处主神空间 / 轮回乐园，没有「原著」可考。<br />
                下面是历次任务世界已存的资料页，随时可以回看。
              </div>
              <div className="max-w-md mx-auto">
                <div className="text-[12px] font-mono text-dim/55 mb-2">🗂 已存资料页 · 点开回看</div>
                <ArchiveList items={archives} isCur={isCurArchive} onOpen={openArchive} onDelete={deleteArchive} />
              </div>
            </div>
          )
        ) : (
          <>
            {/* 回看模式：只读横幅；正常模式：检索目标 + 深挖按钮 */}
            {readOnly ? (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-indigo-500/[0.07]">
                <span className="text-sm shrink-0">🗂</span>
                <span className="flex-1 min-w-0 truncate text-[13px] font-mono text-indigo-200/90" title={viewLabel}>{viewLabel}</span>
                <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/50">只读</span>
                <button
                  onClick={() => setViewKey(null)}
                  className="shrink-0 px-2.5 py-1.5 rounded text-[12px] font-mono border border-indigo-500/50 text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors"
                >
                  ↩ 返回当前
                </button>
              </div>
            ) : (
              <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel/40">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-mono text-dim/60 shrink-0">作品名</span>
                  <input
                    value={ip}
                    onChange={(e) => setIpDraft(e.target.value)}
                    onBlur={() => setIp(opKey, (ip || worldName).trim())}
                    placeholder={worldName || '如：火影忍者 / 进击的巨人'}
                    className="flex-1 min-w-0 bg-void border border-edge rounded px-2.5 py-1.5 text-sm text-slate-200 focus:border-god/50 outline-none"
                  />
                  <button
                    onClick={genAll}
                    disabled={anyLoading}
                    className="shrink-0 px-3 py-1.5 rounded text-sm font-mono border border-indigo-500/50 text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors"
                  >
                    {anyLoading ? '挖掘中…' : doneCount ? '⟳ 全部刷新' : '🔍 深挖此世界'}
                  </button>
                </div>
                {err && <div className="text-[12px] text-rose-400/90 font-mono mt-1.5">{err}</div>}
              </div>
            )}

            {/* 已存资料页（回看入口）：挖过的世界永久保留，点开只读浏览 */}
            {!readOnly && archives.length > 0 && (
              <div className="shrink-0 border-b border-edge bg-panel/20">
                <button
                  onClick={() => setListOpen((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 text-[12px] font-mono text-dim/55 hover:text-slate-200 transition-colors"
                >
                  <span>🗂 已存资料页</span>
                  <span className="text-dim/40">{archives.length}</span>
                  <span className="ml-auto">{listOpen ? '▾ 收起' : '▸ 展开回看'}</span>
                </button>
                {listOpen && (
                  <div className="px-3 pb-2.5 max-h-48 overflow-y-auto">
                    <ArchiveList items={archives} isCur={isCurArchive} onOpen={openArchive} onDelete={deleteArchive} />
                  </div>
                )}
              </div>
            )}

            {/* 标签分页 */}
            <div className="shrink-0 flex gap-1 px-3 py-2 border-b border-edge bg-panel/20 overflow-x-auto">
              {CODEX_MODULES.map((mod) => {
                const sec = entry?.sections?.[mod.key];
                const busy = !readOnly && !!loading[mod.key];   // 回看别的世界时不显示当前世界的生成脉冲
                const on = active === mod.key;
                return (
                  <button
                    key={mod.key}
                    onClick={() => setActive(mod.key)}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] border transition-colors ${
                      on ? 'border-indigo-500/50 text-indigo-100 bg-indigo-500/15' : 'border-edge text-dim hover:text-slate-200 hover:bg-panel2'
                    }`}
                  >
                    <span className="text-sm">{mod.icon}</span>
                    <span className="whitespace-nowrap">{SHORT[mod.key] ?? mod.title}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      busy ? 'bg-amber-400 animate-pulse' : sec?.content ? 'bg-emerald-400/80' : 'bg-dim/25'
                    }`} />
                  </button>
                );
              })}
            </div>

            {/* 当前条目内容 */}
            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 border-b border-edge/60 bg-void/95 backdrop-blur">
                <span className="text-base">{activeMod.icon}</span>
                <span className="text-sm font-bold text-slate-100 flex-1">{activeMod.title}</span>
                {readOnly ? (
                  activeSec ? (
                    <span className="text-[11px] font-mono text-dim/40">已存 · {new Date(activeSec.updatedAt).toLocaleDateString()}</span>
                  ) : null
                ) : (
                  <button
                    onClick={() => regen(activeMod)}
                    disabled={activeBusy}
                    className="text-[12px] font-mono text-dim/60 hover:text-indigo-200 disabled:opacity-40 transition-colors"
                    title="重新生成此条目"
                  >
                    {activeBusy ? '⟳ 生成中…' : '⟳ 重新生成'}
                  </button>
                )}
              </div>
              <div className="px-5 py-4">
                {!readOnly && activeBusy && !activeSec ? (
                  <div className="text-[13px] font-mono text-dim/45 py-6 text-center">联网考据中，请稍候…</div>
                ) : activeSec?.content ? (
                  <CodexBody text={activeSec.content} type={activeMod.type} />
                ) : readOnly ? (
                  <div className="text-[13px] font-mono text-dim/35 py-6 text-center">这份资料页没有该条目。</div>
                ) : (
                  <div className="text-[13px] font-mono text-dim/35 py-6 text-center">
                    尚未生成。点上方「🔍 深挖此世界」一次挖全，或本条「⟳ 重新生成」。
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
