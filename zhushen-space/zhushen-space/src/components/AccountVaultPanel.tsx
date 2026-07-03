import { useEffect, useMemo, useState } from 'react';
import { useAccountVault, type VaultEntry } from '../store/accountVaultStore';
import { useItems, type InventoryItem } from '../store/itemStore';
import { usePlayer } from '../store/playerStore';
import { useVaultCloud, pullVaultCloud, syncVaultCloud, initVaultCloudSync } from '../systems/accountVaultCloud';
import { discordLoggedIn, discordLogin, fetchChatIdentity, chatReady, chatName, chatDisplayUid } from '../systems/chatIdentity';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';

/* 账户仓库：跨存档保险箱。把当前存档的物品**连同完整信息（词缀/强化/宝石…）**存进账号级仓库，
   任何后续存档都能取回；Discord 登录后云端备份、跨设备同步。本地即可用，登录仅为云备份。 */

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '宝石', '法宝', '装备']);
function itemKind(it: any): EntityKind { return EQUIP_CATS.has(String(it?.category || it?.slot || '')) ? 'equip' : 'item'; }

export default function AccountVaultPanel({ onClose }: { onClose: () => void }) {
  const entries     = useAccountVault((s) => s.entries);
  const deposit     = useAccountVault((s) => s.deposit);
  const removeEntry = useAccountVault((s) => s.removeEntry);
  const clearAll    = useAccountVault((s) => s.clearAll);
  const items       = useItems((s) => s.items);
  const addItem     = useItems((s) => s.addItem);
  const removeItem  = useItems((s) => s.removeItem);
  const playerName  = usePlayer((s) => s.profile.name);

  const [view, setView] = useState<'vault' | 'deposit'>('vault');
  const [sub, setSub] = useState<{ kind: EntityKind; data: any } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [flash, setFlash] = useState('');
  const [selDep, setSelDep] = useState<Set<string>>(new Set());   // 从背包批量存入·多选

  // 云同步（与聊天室/丰碑共用 Discord 身份；登录后自动拉取并入 + 变更自动上传）
  const cloud = useVaultCloud();
  const [loggedIn, setLoggedIn] = useState(() => discordLoggedIn());
  const [cloudBusy, setCloudBusy] = useState(false);
  useEffect(() => {
    (async () => {
      if (!discordLoggedIn()) return;
      try {
        if (!chatReady()) await fetchChatIdentity();
        initVaultCloudSync();
        await pullVaultCloud();
      } catch { /* 失败留在未登录态，可手动重试 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCloudLogin = async () => {
    setCloudBusy(true);
    try {
      await discordLogin();
      setLoggedIn(true);
      await fetchChatIdentity();
      initVaultCloudSync();
      await pullVaultCloud();
    } catch (e: any) { setFlash(e?.message || '登录失败'); }
    setCloudBusy(false);
  };
  const doCloudSync = async () => { setCloudBusy(true); await syncVaultCloud(); setCloudBusy(false); };

  const list = useMemo(() => Object.values(entries).sort((a, b) => b.storedAt - a.storedAt), [entries]);
  // 可存入=未装备的一切（含**锁定物**：仓库是安全存放不是删除，锁定的贵重道具/特殊物品正该存进来）。已装备的需先卸下。
  const depositable = useMemo(() => items.filter((it) => !it.equipped), [items]);

  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash((c) => (c === m ? '' : c)), 2200); };

  // 取出：完整快照原样还原全字段（词缀/强化/宝石…），只换新 id、用仓库现存数量；然后从仓库移除
  const withdraw = (e: VaultEntry) => {
    const { id: _i, addedAt: _a, ...rest } = e.item;
    addItem({ ...rest, quantity: e.quantity, equipped: false } as any);
    removeEntry(e.id);
    toast(`已取出「${e.item.name}」到背包`);
  };
  // 存入：把背包物品连同完整快照存进账户仓库，再从背包移除
  const depositItem = (it: InventoryItem) => {
    deposit(it, it.quantity, playerName || undefined);
    removeItem(it.id);
    toast(`已存入「${it.name}」`);
  };
  // 多选批量存入
  const selDepCount = depositable.filter((it) => selDep.has(it.id)).length;
  const toggleDep = (id: string) => setSelDep((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearDepSel = () => setSelDep(new Set());
  const selectAllDep = () => setSelDep(new Set(depositable.map((it) => it.id)));
  const batchDeposit = () => {
    const chosen = depositable.filter((it) => selDep.has(it.id));
    if (chosen.length === 0) return;
    for (const it of chosen) { deposit(it, it.quantity, playerName || undefined); removeItem(it.id); }
    clearDepSel();
    toast(`已批量存入 ${chosen.length} 件`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[85dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* 顶栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-amber-300/80 text-lg">🏦</span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100">账户仓库</div>
            <div className="text-[11px] font-mono text-dim/60">跨存档保险箱 · 存进去下个存档能取出（含词缀等全部信息）</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 云同步条（与聊天室/丰碑共用 Discord 身份；登录后自动拉取并入 + 变更自动上传）*/}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel/20 text-[12px]">
          <span className="text-amber-300/70">☁</span>
          {!loggedIn ? (
            <>
              <span className="text-dim/60">云备份 · 跨设备取用（用 Discord 绑定身份；不登录也能本地跨存档）</span>
              <button onClick={doCloudLogin} disabled={cloudBusy} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-amber-400/15 border border-amber-400/40 text-amber-300 hover:bg-amber-400/25 disabled:opacity-40 transition-colors">{cloudBusy ? '登录中…' : '用 Discord 绑定'}</button>
            </>
          ) : (
            <>
              <span className="text-dim/55 font-mono shrink-0">{chatName() || '道友'}<span className="text-amber-300/45"> #{chatDisplayUid()}</span></span>
              <span className={`truncate ${cloud.status === 'error' ? 'text-amber-400/80' : cloud.status === 'syncing' ? 'text-amber-300/70' : 'text-dim/45'}`}>{cloud.status === 'syncing' ? '同步中…' : (cloud.msg || (cloud.lastSync ? `已同步 ${new Date(cloud.lastSync).toLocaleTimeString()}` : '已绑定'))}</span>
              <button onClick={doCloudSync} disabled={cloudBusy} className="ml-auto shrink-0 px-3 py-1 rounded-lg text-[12px] font-semibold bg-amber-400/12 border border-amber-400/40 text-amber-300 hover:bg-amber-400/22 disabled:opacity-40 transition-colors">{cloudBusy ? '同步中…' : '☁ 同步'}</button>
            </>
          )}
        </div>

        {flash && <div className="shrink-0 px-4 pt-2 text-[12px] font-mono text-amber-300/80">{flash}</div>}

        {/* 分块：仓库 / 从背包存入 */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-edge bg-panel/40 text-[13px]">
          {([['vault', `🏦 仓库${list.length ? ' · ' + list.length : ''}`], ['deposit', `📥 从背包存入${depositable.length ? ' · ' + depositable.length : ''}`]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg transition-colors ${view === v ? 'bg-amber-400/15 border border-amber-400/40 text-amber-300 font-semibold' : 'border border-transparent text-dim/70 hover:text-amber-300'}`}>{label}</button>
          ))}
          {view === 'vault' && list.length > 0 && (
            confirmClear ? (
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => { clearAll(); setConfirmClear(false); }} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-blood/20 border border-blood/40 text-blood">确认清空</button>
                <button onClick={() => setConfirmClear(false)} className="px-2 py-1 rounded-lg text-[11px] border border-edge text-dim/60">取消</button>
              </span>
            ) : (
              <button onClick={() => setConfirmClear(true)} className="ml-auto px-2 py-1 rounded-lg text-[12px] border border-edge text-dim/50 hover:text-blood hover:border-blood/40 transition-colors">🗑 清空</button>
            )
          )}
        </div>

        {view === 'vault' ? (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {list.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 仓库空空 · 去「从背包存入」把物品存进来 —<br /><span className="text-dim/30">存进来的物品跨存档常驻，开新档也能取回</span></div>}
            {list.map((e) => (
              <div key={e.id} className="rounded-xl border border-edge bg-panel/30 p-2.5 space-y-1.5">
                <EntityCard kind={itemKind(e.item)} data={e.item} onOpen={() => setSub({ kind: itemKind(e.item), data: e.item })} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-dim/40 truncate">
                    {e.quantity > 1 ? `×${e.quantity} · ` : ''}{e.fromSave ? `来自 ${e.fromSave}` : '账户仓库'} · {new Date(e.storedAt).toLocaleDateString()}
                  </span>
                  <button onClick={() => withdraw(e)} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-amber-400/15 border border-amber-400/40 text-amber-300 hover:bg-amber-400/25 transition-colors">📤 取出到背包</button>
                  {confirmDel === e.id ? (
                    <span className="flex items-center gap-1">
                      <button onClick={() => { removeEntry(e.id); setConfirmDel(null); }} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-blood/20 border border-blood/40 text-blood">删</button>
                      <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded-lg text-[11px] border border-edge text-dim/60">取消</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDel(e.id)} className="px-2 py-1 rounded-lg text-[12px] border border-edge text-dim/50 hover:text-blood hover:border-blood/40 transition-colors" title="从仓库删除（不退回背包）">🗑</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 px-1 pb-1">
              <span className="text-[11px] font-mono text-dim/40 shrink-0">背包未装备未锁定可存入（{depositable.length} 件）</span>
              {depositable.length > 0 && (
                <>
                  <button onClick={selDepCount === depositable.length ? clearDepSel : selectAllDep} className="text-[11px] font-mono text-dim/60 hover:text-amber-300 transition-colors shrink-0">{selDepCount === depositable.length ? '取消全选' : '全选'}</button>
                  <span className="flex-1" />
                  <button onClick={batchDeposit} disabled={selDepCount === 0} className="px-3 py-1 rounded-lg text-[12px] font-semibold bg-amber-400/15 border border-amber-400/40 text-amber-300 hover:bg-amber-400/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0">🏦 批量存入{selDepCount ? ` (${selDepCount})` : ''}</button>
                </>
              )}
            </div>
            {depositable.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-12">— 背包里没有可存入的物品 —</div>}
            {depositable.map((it) => {
              const sel = selDep.has(it.id);
              return (
                <div key={it.id} className={`rounded-xl border p-2.5 space-y-1.5 transition-colors ${sel ? 'border-amber-400/50 bg-amber-400/10' : 'border-edge bg-panel/30'}`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => toggleDep(it.id)} title={sel ? '取消选择' : '选择'}
                      className={`mt-1 w-5 h-5 shrink-0 rounded border flex items-center justify-center text-[11px] font-mono transition-colors ${sel ? 'border-amber-400/70 bg-amber-400/20 text-amber-300' : 'border-edge text-transparent hover:border-amber-400/40'}`}>✓</button>
                    <div className="flex-1 min-w-0">
                      <EntityCard kind={itemKind(it)} data={it} onOpen={() => setSub({ kind: itemKind(it), data: it })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {it.locked && <span className="text-[11px] font-mono text-blue-400/80 shrink-0" title="已锁定物品——仓库是安全存放，可正常存入并原样取回">🔒 锁定·可存</span>}
                    <button onClick={() => depositItem(it)} className="ml-auto px-3 py-1 rounded-lg text-[12px] font-semibold bg-amber-400/15 border border-amber-400/40 text-amber-300 hover:bg-amber-400/25 transition-colors">🏦 存入</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sub && <EntityDetailModal kind={sub.kind} data={sub.data} onClose={() => setSub(null)} />}
    </div>
  );
}
