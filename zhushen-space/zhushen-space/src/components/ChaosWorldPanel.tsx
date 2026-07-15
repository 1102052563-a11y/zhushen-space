import { useState, useEffect, useCallback } from 'react';
import {
  chaosListWorlds, chaosListRecords, chaosGetRecord, chaosDelete,
  type ChaosWorldStat, type ChaosRecordMeta, type ChaosRecordFull,
} from '../systems/chaosWorld';
import { useChaosWorld } from '../store/chaosWorldStore';

type Tab = 'browse' | 'generate' | 'mine' | 'settings';

function bandColor(offset: number): string {
  if (offset >= 80) return 'text-blood';
  if (offset >= 60) return 'text-amber-400';
  if (offset >= 40) return 'text-gold';
  if (offset >= 20) return 'text-sky-400';
  return 'text-god';
}
function fmtTime(ts: number): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString(); } catch { return ''; }
}

// 混沌世界面板：按世界分组浏览各契约者上传的影响记录；勾选多个世界 → 生成「被前人影响过」的混沌世界卡。
export default function ChaosWorldPanel({ onClose, onGenerate, generating }: {
  onClose: () => void;
  onGenerate: (worlds: string[], prompt: string) => void;   // 勾选世界 + 额外提示词 → 生成混沌世界卡（App 落地到 WorldCardView）
  generating: boolean;
}) {
  const [tab, setTab] = useState<Tab>('browse');
  const [worlds, setWorlds] = useState<ChaosWorldStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [viewWorld, setViewWorld] = useState<string | null>(null);   // 浏览：正在看某世界的记录列表
  const [records, setRecords] = useState<ChaosRecordMeta[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [detail, setDetail] = useState<ChaosRecordFull | null>(null);   // 单条全文弹窗

  const [selected, setSelected] = useState<Set<string>>(new Set());   // 生成：勾选的世界
  const [prompt, setPrompt] = useState('');

  const cfg = useChaosWorld();

  const loadWorlds = useCallback(async () => {
    setLoading(true); setErr('');
    try { setWorlds(await chaosListWorlds()); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadWorlds(); }, [loadWorlds]);

  async function openWorld(world: string) {
    setViewWorld(world); setRecLoading(true); setRecords([]);
    try { setRecords(await chaosListRecords(world)); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setRecLoading(false); }
  }
  async function openDetail(id: string) {
    try { setDetail(await chaosGetRecord(id)); }
    catch (e: any) { alert('读取失败：' + (e?.message ?? String(e))); }
  }
  function toggleSelect(world: string) {
    setSelected((s) => { const n = new Set(s); n.has(world) ? n.delete(world) : n.add(world); return n; });
  }

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 text-sm font-mono rounded-lg border transition-colors ${
        tab === id ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'
      }`}
    >{label}</button>
  );

  const myUploads = Object.values(cfg.myUploads).sort((a, b) => b.uploadedAt - a.uploadedAt);

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-void/95 backdrop-blur-sm">
      {/* 头 */}
      <div className="px-6 py-3 border-b border-edge flex items-center gap-3 shrink-0">
        <h2 className="text-lg font-bold text-slate-100 mr-2">☄️ 混沌世界</h2>
        <TabBtn id="browse" label="浏览" />
        <TabBtn id="generate" label={`生成世界卡${selected.size ? `（${selected.size}）` : ''}`} />
        <TabBtn id="mine" label="我的上传" />
        <TabBtn id="settings" label="设置" />
        <div className="flex-1" />
        {(tab === 'browse' || tab === 'generate') && (
          <button onClick={loadWorlds} className="text-sm font-mono text-dim hover:text-god">⟳ 刷新</button>
        )}
        <button onClick={onClose} className="text-sm font-mono text-dim hover:text-blood ml-2">✕ 关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {err && <div className="mx-6 mt-4 text-sm text-blood">加载失败：{err}（后端可能未部署或未配置）</div>}

        {/* ── 浏览 / 生成：世界分组看板 ── */}
        {(tab === 'browse' || tab === 'generate') && !viewWorld && (
          <div className="p-6">
            {loading ? (
              <div className="text-dim font-mono text-sm">◌ 加载中…</div>
            ) : worlds.length === 0 ? (
              <div className="text-dim/60 font-mono text-sm">还没有任何混沌记录。去闯几个世界、离世时生成并上传吧。</div>
            ) : (
              <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-3">
                {worlds.map((w) => {
                  const sel = selected.has(w.world);
                  return (
                    <div
                      key={w.world}
                      onClick={() => tab === 'generate' ? toggleSelect(w.world) : openWorld(w.world)}
                      className={`cursor-pointer border rounded-xl px-4 py-3 transition-colors ${
                        sel ? 'border-god/70 bg-god/10' : 'border-edge hover:border-god/40 bg-panel'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-bold text-slate-100 truncate">{w.world}</span>
                        {tab === 'generate' && (
                          <span className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center text-[12px] ${sel ? 'border-god bg-god/20 text-god' : 'border-dim/40 text-transparent'}`}>✓</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-sm font-mono flex-wrap">
                        <span className="text-dim">{w.uploaders} 人上传</span>
                        <span className="text-dim/60">·</span>
                        <span className="text-dim">{w.n} 条</span>
                        <span className="text-dim/60">·</span>
                        <span className={bandColor(w.avgOffset)}>平均偏移 {w.avgOffset}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 浏览：某世界的记录列表 ── */}
        {tab === 'browse' && viewWorld && (
          <div className="p-6">
            <button onClick={() => { setViewWorld(null); setRecords([]); }} className="text-sm font-mono text-dim hover:text-god mb-3">‹ 返回世界列表</button>
            <h3 className="text-lg font-bold text-slate-100 mb-3">{viewWorld}</h3>
            {recLoading ? (
              <div className="text-dim font-mono text-sm">◌ 加载中…</div>
            ) : records.length === 0 ? (
              <div className="text-dim/60 font-mono text-sm">该世界暂无记录。</div>
            ) : (
              <div className="space-y-2">
                {records.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => openDetail(r.id)}
                    className="cursor-pointer border border-edge hover:border-god/40 bg-panel rounded-lg px-4 py-2.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] text-slate-200 truncate">{r.title || '（无标题）'}</span>
                      <span className={`shrink-0 text-sm font-mono ${bandColor(r.offset)}`}>偏移 {r.offset} · {r.band}</span>
                    </div>
                    <div className="text-[12px] font-mono text-dim mt-1">{r.uploaderName}{r.tier ? ` · ${r.tier}` : ''} · {fmtTime(r.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 生成世界卡：勾选提示 + 额外提示词 + 生成 ── */}
        {tab === 'generate' && (
          <div className="px-6 pb-6">
            <div className="border-t border-edge pt-4 mt-2">
              <p className="text-sm text-dim mb-2">
                已勾选 <span className="text-god">{selected.size}</span> 个世界。生成的世界卡会受这些世界前任契约者的影响：剧情 / 任务线偏移、遇到前人留下的遗产与后果。生成后可编辑、点「进入此世界」注入正文。
              </p>
              {selected.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {[...selected].map((w) => (
                    <span key={w} className="text-[12px] font-mono px-2 py-0.5 rounded bg-god/10 border border-god/30 text-god">
                      {w} <button onClick={() => toggleSelect(w)} className="ml-1 text-dim hover:text-blood">✕</button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="额外要求（可选）：想要的世界基调、主角切入方式、想遇到的前人遗产类型、目标阶位倾向…"
                className="w-full bg-void border border-god/25 rounded px-3 py-2 text-sm text-slate-200 leading-relaxed outline-none focus:border-god/60 resize-y placeholder:text-dim/40"
              />
              <button
                onClick={() => onGenerate([...selected], prompt)}
                disabled={selected.size === 0 || generating}
                className="mt-3 px-6 py-2.5 border border-god/50 text-god bg-god/10 rounded-xl hover:bg-god/20 text-sm font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? '◌ 编织世界中…' : '☄️ 生成混沌世界卡'}
              </button>
            </div>
          </div>
        )}

        {/* ── 我的上传 ── */}
        {tab === 'mine' && (
          <div className="p-6">
            {myUploads.length === 0 ? (
              <div className="text-dim/60 font-mono text-sm">还没有上传过混沌记录。</div>
            ) : (
              <div className="space-y-2">
                {myUploads.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 border border-edge bg-panel rounded-lg px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] text-slate-200 truncate">{u.world}{u.title ? ` — ${u.title}` : ''}</div>
                      <div className="text-[12px] font-mono text-dim mt-0.5">偏移 {u.offset} · {fmtTime(u.uploadedAt)}</div>
                    </div>
                    <button
                      onClick={async () => { if (confirm('删除这条上传？（云端也会删除）')) { try { await chaosDelete(u.id); } catch (e: any) { alert('删除失败：' + (e?.message ?? String(e))); } } }}
                      className="shrink-0 text-sm font-mono text-dim hover:text-blood"
                    >删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 设置 ── */}
        {tab === 'settings' && (
          <div className="p-6 max-w-xl space-y-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => cfg.setEnabled(e.target.checked)} className="mt-1 accent-god" />
              <span>
                <span className="text-slate-200">离世时自动生成混沌记录</span>
                <span className="block text-[12px] text-dim mt-0.5">每次生成离世总结后，额外调用一次 AI 生成「对世界的影响 + 剧情偏移度」，弹窗询问是否上传（关掉则不再自动生成，省 token）。</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={cfg.webSearch} onChange={(e) => cfg.setWebSearch(e.target.checked)} className="mt-1 accent-god" />
              <span>
                <span className="text-slate-200">生成时联网检索原著剧情（Google Search）</span>
                <span className="block text-[12px] text-dim mt-0.5">用联网检索核对原著 / 同人的既定剧情，判断偏移更准。仅部分接口 / 路由支持；不支持时会自动退回不检索。</span>
              </span>
            </label>
            <div>
              <div className="text-slate-200 mb-1">后端地址覆盖</div>
              <input
                value={cfg.apiBase}
                onChange={(e) => cfg.setApiBase(e.target.value)}
                placeholder="留空 = 用默认联机后端"
                className="w-full bg-void border border-god/25 rounded px-3 py-1.5 text-sm text-slate-200 font-mono outline-none focus:border-god/60 placeholder:text-dim/40"
              />
              <div className="text-[12px] text-dim mt-1">与联机 / 工坊共用后端（/api/chaos/*）。需 worker 已部署本功能。</div>
            </div>
          </div>
        )}
      </div>

      {/* 单条全文弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-void/80 px-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-panel border border-god/30 rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-3 border-b border-edge flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <div className="text-base font-bold text-slate-100 truncate">{detail.world}{detail.title ? ` — ${detail.title}` : ''}</div>
                <div className="text-[12px] font-mono text-dim mt-0.5">{detail.uploaderName} · <span className={bandColor(detail.offset)}>偏移 {detail.offset} · {detail.band}</span> · {fmtTime(detail.createdAt)}</div>
              </div>
              <button onClick={() => setDetail(null)} className="text-dim hover:text-blood text-sm font-mono ml-3">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
              <p className="text-[15px] text-slate-300 leading-relaxed whitespace-pre-wrap">{detail.body}</p>
              {detail.meta?.nodes && detail.meta.nodes.length > 0 && (
                <div>
                  <div className="text-[12px] font-mono text-dim mb-1">剧情偏移点</div>
                  <div className="space-y-1.5">
                    {detail.meta.nodes.map((nd, i) => (
                      <div key={i} className="text-[13px] text-slate-300 bg-void/60 border border-edge/60 rounded px-2 py-1.5">
                        <span className={`font-mono mr-2 ${nd.严重度 >= 3 ? 'text-blood' : nd.严重度 >= 2 ? 'text-amber-400' : 'text-dim'}`}>[严重度{nd.严重度}]</span>
                        <span className="text-dim">{nd.原著节点}</span><span className="mx-1 text-god/60">→</span><span>{nd.主角改动}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.meta?.hooks && detail.meta.hooks.length > 0 && (
                <div>
                  <div className="text-[12px] font-mono text-dim mb-1">留给后人的钩子</div>
                  <ul className="text-[13px] text-slate-300 list-disc pl-5 space-y-0.5">
                    {detail.meta.hooks.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
