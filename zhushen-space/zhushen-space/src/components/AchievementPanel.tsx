import { useState } from 'react';
import { usePlayer, type Achievement } from '../store/playerStore';
import { RARITY_CLS } from '../store/characterStore';

const CATEGORIES = ['全部', '战斗', '探索', '任务', '生存', '隐藏', '其他'];

/* 成就系统（仅主角 B1）：展示已解锁成就，固定格式
   id|名称|说明|分类|类型|稀有度|是否隐藏|解锁条件|解锁时间。成就不计入叙事记忆注入。 */
export default function AchievementPanel({ onClose }: { onClose: () => void }) {
  const achievements = usePlayer((s) => s.achievements);
  const removeAchievement = usePlayer((s) => s.removeAchievement);
  const [cat, setCat] = useState('全部');

  const filtered = (cat === '全部' ? achievements : achievements.filter((a) => a.category === cat))
    .slice().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🏆</span>
              <h2 className="text-base font-bold text-slate-100">成就系统</h2>
              <span className="text-[13px] font-mono text-dim/50">已解锁 {achievements.length}</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">主角达成的成就；成就不计入叙事记忆注入。</p>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        {/* 分类筛选 */}
        <div className="px-4 py-2 border-b border-edge/60 shrink-0 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`text-[13px] font-mono px-2 py-0.5 rounded border transition-colors ${
                cat === c ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'
              }`}>
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filtered.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无成就。成就会在剧情达成条件时由叙事自动解锁。</div>
          )}
          {filtered.map((a) => <AchievementCard key={a.id} a={a} onDelete={() => removeAchievement(a.id)} />)}
        </div>
      </div>
    </div>
  );
}

function AchievementCard({ a, onDelete }: { a: Achievement; onDelete: () => void }) {
  const cls = RARITY_CLS[a.rarity] ?? 'border-edge text-slate-300';
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 bg-panel ${cls}`}>
      <div className="flex items-center gap-2">
        <span className="text-base">🏅</span>
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{a.name}</span>
        {a.hidden && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-300/80 shrink-0">🔒隐藏</span>}
        {a.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{a.rarity}</span>}
      </div>
      {a.desc && <div className="text-[13px] text-dim/75 leading-relaxed">{a.desc}</div>}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
        {a.category && <span className="text-sky-300/70">分类:{a.category}</span>}
        {a.type && <span className="text-amber-300/70">类型:{a.type}</span>}
        {a.unlockTime && <span>解锁:{a.unlockTime}</span>}
        <span className="text-dim/30">{a.id}</span>
      </div>
      {a.condition && <div className="text-[12px] text-dim/50 leading-relaxed">达成条件·{a.condition}</div>}
      <div className="flex justify-end">
        <button onClick={onDelete} className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors">删除</button>
      </div>
    </div>
  );
}
