import { useEffect, useRef, useState } from 'react';

/* 命令面板：⌘K / Ctrl+K（或顶栏 🔍）打开，模糊搜索快速跳转右侧导航的各面板。
   纯前端、零依赖；检索表 ALIAS 给中文名补拼音/首字母/英文别名（表里没有的项仍可用中文名子串命中）。 */

export interface CmdItem { icon: string; label: string }

// 拼音/首字母/英文别名（按需补；不影响中文名子串匹配）
const ALIAS: Record<string, string> = {
  '装备': 'zhuangbei zb equip', '储存空间': 'beibao bb 背包 bag backpack chucunkongjian inventory',
  'NPC': 'npc renwu jiaose', '技能': 'jineng jn skill', '副职业': 'fuzhiye fzy job profession',
  '技能树': 'jinengshu jns skilltree tree', '称号': 'chenghao ch title', '成就': 'chengjiu cj achievement',
  '势力': 'shili sl faction', '领地': 'lingdi ld territory base', '冒险团': 'maoxiantuan mxt team',
  '队伍': 'duiwu dw party', '万族': 'wanzu wz cosmos race', '世界百科': 'shijiebaike sjbk codex wiki',
  'ROLL': 'roll dice touzi 骰子 panding', '战斗': 'zhandou zd combat fight', '乐园设施': 'leyuansheshi lyss facility shop casino',
  '深渊': 'shenyuan sy abyss dungeon', '回合洞察': 'huihedongcha hhdc insight', '任务': 'renwu rw quest task',
  '频道': 'pindao pd channel', '私信': 'sixin sx dm message', '好友': 'haoyou hy friend',
  '联机': 'lianji lj multiplayer online coop', '聊天室': 'liaotianshi lts chat chatroom', '交易行': 'jiaoyihang jyh trade market',
  '记忆': 'jiyi jy memory summary', '创意工坊': 'chuangyigongfang cygf workshop', '存档': 'cundang cd save archive load',
  '设置': 'shezhi sz setting config',
};

export default function CommandPalette({ open, items, onClose, onPick, unread }: {
  open: boolean;
  items: CmdItem[];
  onClose: () => void;
  onPick: (label: string) => void;
  unread?: Record<string, number>;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 打开时清空 + 选中第一项 + 聚焦输入框
  useEffect(() => {
    // 手机端(<1024)不自动聚焦——避免一打开就弹输入法；默认已列出全部面板可直接点选，想筛选时点搜索框即可。桌面端照常聚焦便于立即键入。
    if (open) { setQ(''); setSel(0); if (window.innerWidth >= 1024) { const t = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(t); } }
  }, [open]);

  const query = q.trim().toLowerCase();
  const filtered = query
    ? items.filter((it) => it.label.toLowerCase().includes(query) || (ALIAS[it.label] || '').includes(query))
    : items;
  const cur = filtered.length ? Math.min(sel, filtered.length - 1) : 0;

  // 选中项滚动进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-cur="1"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [cur, q]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(filtered.length ? (cur + 1) % filtered.length : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(filtered.length ? (cur - 1 + filtered.length) % filtered.length : 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[cur]) onPick(filtered[cur].label); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh] max-lg:pt-[8vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-god/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* 搜索行 */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge">
          <span className="text-god/60 text-sm shrink-0">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={onKey}
            placeholder="跳转到面板…  试试 背包 / sl / shezhi"
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-dim/40 font-mono"
          />
          <button onClick={onClose} aria-label="关闭命令面板" className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-edge text-dim/70 hover:text-blood hover:border-blood/40 transition-colors text-base">✕</button>
        </div>
        {/* 列表 */}
        <div ref={listRef} className="max-h-[52dvh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-dim/40">没有匹配的面板</div>
          ) : filtered.map((it, i) => {
            const n = unread ? (unread[it.label] ?? 0) : 0;
            return (
              <button
                key={it.label}
                data-cur={i === cur ? '1' : '0'}
                onClick={() => onPick(it.label)}
                onMouseMove={() => { if (i !== cur) setSel(i); }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${i === cur ? 'bg-god/10 text-god' : 'text-dim hover:text-slate-200'}`}
              >
                <span className="w-5 text-center text-xs opacity-80">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {n > 0 && (
                  <span className="min-w-[16px] h-4 px-1 rounded-full bg-blood text-white text-[10px] font-bold flex items-center justify-center leading-none">{n > 99 ? '99+' : n}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* 底部提示 */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-edge text-[11px] font-mono text-dim/40">
          <span>↑↓ 选择 · ↵ 跳转 · Esc 关闭</span>
          <span>{filtered.length}/{items.length}</span>
        </div>
      </div>
    </div>
  );
}
