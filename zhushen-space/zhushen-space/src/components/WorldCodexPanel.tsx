import { useState } from 'react';
import { useMisc } from '../store/miscStore';
import { useWorldCodex } from '../store/worldCodexStore';
import { CODEX_MODULES, type CodexModule } from '../worldCodexModules';
import { genCodexSection } from '../systems/worldCodex';

/* 世界百科面板：为当前同人任务世界生成「原著情报」供玩家阅读。
   纯参考，不注入正文。仅任务世界可用（乐园本体置灰）。 */

const isHomeWorld = (name?: string) => /轮回乐园|专属房间|主神空间/.test(name ?? '');

/* 极简渲染：按空行分段，「- 」转列表项，行首【…】小标题加重。无 HTML 注入。 */
function CodexBody({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-slate-300/90">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const allList = lines.length > 1 && lines.every((l) => /^[-•·*]\s/.test(l) || /^【?\d+】?[.、]/.test(l));
        if (allList) {
          return (
            <ul key={bi} className="space-y-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="text-god/50 shrink-0">·</span>
                  <span className="flex-1">{l.replace(/^[-•·*]\s+/, '')}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {block.split('\n').map((l, li) => {
              const m = /^(【[^】]+】|#+\s*.+)$/.test(l.trim());
              return (
                <span key={li} className={m ? 'block font-semibold text-slate-100 mt-1' : 'block'}>
                  {l.replace(/^#+\s*/, '')}
                </span>
              );
            })}
          </p>
        );
      })}
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

  const anyLoading = Object.values(loading).some(Boolean);

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
            <div className="shrink-0 px-4 py-3 border-b border-edge bg-panel/40 space-y-2">
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
                  {anyLoading ? '挖掘中…' : entry?.sections && Object.keys(entry.sections).length ? '⟳ 全部刷新' : '🔍 深挖此世界'}
                </button>
              </div>
              <div className="text-[11px] font-mono text-dim/40 leading-snug">
                按原著正史考据，剧透先知给玩家看；不会写进正文。各条目可单独刷新。
              </div>
              {err && <div className="text-[12px] text-rose-400/90 font-mono">{err}</div>}
            </div>

            {/* 情报模块列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {CODEX_MODULES.map((mod) => {
                const sec = entry?.sections?.[mod.key];
                const busy = loading[mod.key];
                return (
                  <div key={mod.key} className="rounded-xl border border-edge bg-panel/30 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-edge/60 bg-panel/40">
                      <span className="text-base">{mod.icon}</span>
                      <span className="text-sm font-bold text-slate-100 flex-1">{mod.title}</span>
                      <button
                        onClick={() => regen(mod)}
                        disabled={busy}
                        className="text-[12px] font-mono text-dim/60 hover:text-indigo-200 disabled:opacity-40 transition-colors"
                        title="重新生成此条目"
                      >
                        {busy ? '⟳…' : '⟳'}
                      </button>
                    </div>
                    <div className="px-3.5 py-3">
                      {busy && !sec ? (
                        <div className="text-[13px] font-mono text-dim/45 py-2">联网考据中，请稍候…</div>
                      ) : sec?.content ? (
                        <CodexBody text={sec.content} />
                      ) : (
                        <div className="text-[13px] font-mono text-dim/35 py-2">尚未生成。点右上「深挖此世界」或本条 ⟳。</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
