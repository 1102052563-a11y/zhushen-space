import { useState } from 'react';
import { useMisc } from '../store/miscStore';
import { useWorldCodex } from '../store/worldCodexStore';
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

/* 渲染：每段落块 / 每条目用边框卡片包裹，提升对比与可读性。无 HTML 注入。 */
function CodexBody({ text, type }: { text: string; type: 'text' | 'list' }) {
  if (type === 'list') {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return (
      <div className="space-y-2.5 text-[14.5px] leading-[1.8] text-slate-200">
        {lines.map((l, i) => {
          if (isSubHeader(l)) {
            return <div key={i} className="pt-2 pb-0.5 font-bold text-slate-100 text-[15px]">{renderInline(stripMarker(l).replace(/[：:]\s*$/, ''))}</div>;
          }
          const t = stripMarker(l);
          const parts = /[｜|]/.test(t) ? t.split(/\s*[｜|]\s*/).map((s) => s.trim()).filter(Boolean) : null;
          return (
            <div key={i} className={`${CARD} border-l-[3px] border-l-indigo-500/50 px-3.5 py-2.5`}>
              {parts ? (
                <>
                  <div className="font-semibold text-slate-100 text-[15px] mb-1">{renderInline(parts[0])}</div>
                  <div className="text-slate-300 leading-[1.8]">
                    {parts.slice(1).map((p, j) => <span key={j}>{j > 0 && <span className="text-dim/40">　·　</span>}{renderInline(p)}</span>)}
                  </div>
                </>
              ) : (
                <ItemContent raw={l} />
              )}
            </div>
          );
        })}
      </div>
    );
  }
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

export default function WorldCodexPanel({ onClose }: { onClose: () => void }) {
  const worldName = useMisc((s) => s.worldName);
  const enabled = useWorldCodex((s) => s.enabled);
  const entry = useWorldCodex((s) => s.byWorld[worldName]);
  const setIp = useWorldCodex((s) => s.setIp);
  const setSection = useWorldCodex((s) => s.setSection);

  const home = isHomeWorld(worldName);
  const [ip, setIpDraft] = useState(entry?.ipName || worldName || '');
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [active, setActive] = useState<string>(CODEX_MODULES[0].key);

  const anyLoading = Object.values(loading).some(Boolean);
  const doneCount = CODEX_MODULES.filter((m) => entry?.sections?.[m.key]?.content).length;

  const genOne = async (mod: CodexModule, ipName: string) => {
    setLoading((s) => ({ ...s, [mod.key]: true }));
    setErr('');
    try {
      const content = await genCodexSection(mod, ipName);
      if (content) setSection(worldName, mod.key, content);
      else setErr(`「${mod.title}」未返回内容，可重试`);
    } catch (e: any) {
      setErr(`「${mod.title}」生成失败：${e?.message ?? e}`);
    } finally {
      setLoading((s) => ({ ...s, [mod.key]: false }));
    }
  };

  const genAll = async () => {
    const ipName = (ip || worldName).trim();
    setIp(worldName, ipName);
    await Promise.allSettled(CODEX_MODULES.map((m) => genOne(m, ipName)));
  };

  const regen = (mod: CodexModule) => {
    const ipName = (ip || worldName).trim();
    setIp(worldName, ipName);
    genOne(mod, ipName);
  };

  const activeMod = CODEX_MODULES.find((m) => m.key === active)!;
  const activeSec = entry?.sections?.[active];
  const activeBusy = loading[active];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-indigo-300/80 text-lg">📖</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">世界百科</div>
            <div className="text-[12px] font-mono text-dim/60 truncate">同人世界原著情报 · 剧情先知 · 联网考据</div>
          </div>
          {!home && enabled && <span className="text-[11px] font-mono text-dim/45 shrink-0">{doneCount}/{CODEX_MODULES.length}</span>}
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {home ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-dim/50 text-sm font-mono">
            <div>
              当前身处主神空间 / 轮回乐园，没有「原著」可考。<br />
              进入某个同人任务世界后，再来此处深挖该世界的原著情报。
            </div>
          </div>
        ) : !enabled ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-dim/50 text-sm font-mono">
            <div>
              世界百科已关闭。<br />
              去「设置 → 变量管理 → 📖 世界百科」开启，并可为它单独配置支持联网搜索的接口。
            </div>
          </div>
        ) : (
          <>
            {/* 检索目标 + 深挖按钮 */}
            <div className="shrink-0 px-4 py-2.5 border-b border-edge bg-panel/40">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-mono text-dim/60 shrink-0">作品名</span>
                <input
                  value={ip}
                  onChange={(e) => setIpDraft(e.target.value)}
                  onBlur={() => setIp(worldName, (ip || worldName).trim())}
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

            {/* 标签分页 */}
            <div className="shrink-0 flex gap-1 px-3 py-2 border-b border-edge bg-panel/20 overflow-x-auto">
              {CODEX_MODULES.map((mod) => {
                const sec = entry?.sections?.[mod.key];
                const busy = loading[mod.key];
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
                <button
                  onClick={() => regen(activeMod)}
                  disabled={activeBusy}
                  className="text-[12px] font-mono text-dim/60 hover:text-indigo-200 disabled:opacity-40 transition-colors"
                  title="重新生成此条目"
                >
                  {activeBusy ? '⟳ 生成中…' : '⟳ 重新生成'}
                </button>
              </div>
              <div className="px-5 py-4">
                {activeBusy && !activeSec ? (
                  <div className="text-[13px] font-mono text-dim/45 py-6 text-center">联网考据中，请稍候…</div>
                ) : activeSec?.content ? (
                  <CodexBody text={activeSec.content} type={activeMod.type} />
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
