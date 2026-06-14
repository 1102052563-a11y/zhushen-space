import { useCharacters, RARITY_CLS, type Title } from '../store/characterStore';

/* 称号库（主角 B1）：展示已获得称号，最多佩戴 1 个；
   仅佩戴的称号会被叙事记忆结构化召回注入正文。 */
export default function TitlePanel({ onClose }: { onClose: () => void }) {
  const titles = useCharacters((s) => s.characters['B1']?.titles ?? []);
  const equipTitle = useCharacters((s) => s.equipTitle);
  const unequipTitle = useCharacters((s) => s.unequipTitle);
  const removeTitle = useCharacters((s) => s.removeTitle);

  const equipped = titles.find((t) => t.equipped);
  const sorted = [...titles].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0) || (b.addedAt ?? 0) - (a.addedAt ?? 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🎖</span>
              <h2 className="text-base font-bold text-slate-100">称号库</h2>
              <span className="text-[13px] font-mono text-dim/50">共 {titles.length} 个</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">最多佩戴 1 个；仅<span className="text-god/80">佩戴中</span>的称号会在叙事记忆中注入正文。</p>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
        </header>

        {/* 当前佩戴 */}
        <div className="px-4 py-2.5 border-b border-edge/60 bg-panel2/40 shrink-0 flex items-center gap-2 text-sm">
          <span className="text-dim/50 font-mono">当前佩戴：</span>
          {equipped
            ? <span className="text-god font-semibold">{equipped.name}</span>
            : <span className="text-dim/40">（未佩戴）</span>}
          {equipped && (
            <button onClick={() => unequipTitle('B1')} className="ml-auto text-[12px] font-mono text-dim/50 hover:text-blood transition-colors">卸下</button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {sorted.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无称号。称号会在剧情中获得（由叙事自动写入）。</div>
          )}
          {sorted.map((t) => (
            <TitleCard key={t.name} t={t}
              onEquip={() => equipTitle('B1', t.name)}
              onUnequip={() => unequipTitle('B1')}
              onDelete={() => removeTitle('B1', t.name)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TitleCard({ t, onEquip, onUnequip, onDelete }: { t: Title; onEquip: () => void; onUnequip: () => void; onDelete: () => void }) {
  const cls = RARITY_CLS[t.rarity] ?? 'border-edge text-slate-300';
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 ${t.equipped ? 'bg-god/5 ' + cls : 'bg-panel ' + cls}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{t.name}</span>
        {t.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{t.rarity}</span>}
        {t.equipped
          ? <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/50 text-god bg-god/10 shrink-0">佩戴中</span>
          : <button onClick={onEquip} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:border-god/50 hover:text-god transition-colors shrink-0">佩戴</button>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
        {t.obtainedTime && <span>获得：{t.obtainedTime}</span>}
        {t.source && <span>来源：{t.source}</span>}
      </div>
      {t.effect && <div className="text-[13px] text-emerald-300/85 leading-relaxed"><span className="text-dim/40">效果·</span>{t.effect}</div>}
      {t.desc && <div className="text-[13px] text-dim/60 leading-relaxed italic border-l-2 border-edge/40 pl-2">{t.desc}</div>}
      <div className="flex justify-end gap-3 pt-0.5">
        {t.equipped && <button onClick={onUnequip} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">卸下</button>}
        <button onClick={onDelete} className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors">删除</button>
      </div>
    </div>
  );
}
