import type { ReactNode } from 'react';
import { useNpc } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { gradeNameClass, asText } from '../store/itemStore';
import type { LadderEntry } from '../systems/arena';

/* 竞技场对手详情（点击榜单对手 → 先建档再展示其面板：六维/装备/技能/天赋）。
   建好的对手 NPC 由 ArenaPanel 决定挑战(复用)或关闭(丢弃)。 */

const ATTR_LABELS: [string, string][] = [['str', '力'], ['agi', '敏'], ['con', '体'], ['int', '智'], ['cha', '魅'], ['luck', '幸']];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div><div className="text-xs text-cyan-300/80 mb-1">{title}</div><div className="space-y-1">{children}</div></div>;
}
function Row({ name, grade, right, sub }: { name: string; grade?: string; right?: string; sub?: string }) {
  return (
    <div className="rounded border border-slate-700/40 bg-slate-800/30 px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[12px] ${gradeNameClass(grade)}`}>{name}</span>
        {right && <span className="text-[10px] text-slate-500 shrink-0">{right}</span>}
      </div>
      {sub && <div className="text-[10px] text-slate-400 leading-snug">{sub}</div>}
    </div>
  );
}

export default function ArenaOpponentDetail({ entry, cid, building, onChallenge, onClose }: {
  entry: LadderEntry; cid: string | null; building: boolean;
  onChallenge: () => void; onClose: () => void;
}) {
  const npc = useNpc((s) => (cid ? s.npcs[cid] : undefined));
  const char = useCharacters((s) => (cid ? s.characters[cid] : undefined));
  const attrs = npc?.attrs as Record<string, number> | undefined;
  const items = npc?.items ?? [];
  const equipped = items.filter((i) => i.equipped);
  const bag = items.filter((i) => !i.equipped);
  const skills = char?.skills ?? [];
  const traits = char?.traits ?? [];
  const ready = !building && !!cid;

  return (
    <div className="fixed inset-0 z-[66] bg-black/70 flex items-center justify-center p-3" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-xl border border-rose-500/30 bg-slate-900 shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60 bg-slate-950/60">
          <span className="text-sm font-semibold text-slate-100">
            <span className="text-amber-300">#{entry.rank}</span> {entry.name}
            {entry.badge && <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-700/40 text-emerald-200 ml-1.5 align-middle">{entry.badge}</span>}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {!ready ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16">
            <div className="w-7 h-7 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-xs text-rose-200">正在生成对手面板…</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-slate-300">
            <div className="text-[11px] text-slate-400">
              {npc?.realm || entry.tier}{entry.job ? ` · ${entry.job}` : ''}{entry.strength ? ` · ${entry.strength}` : ''}{entry.persona ? ` · ${entry.persona}` : ''}
            </div>
            {npc?.appearance5 && <div className="text-[11px] text-slate-400/90 leading-snug">{npc.appearance5}</div>}

            {attrs && (
              <div>
                <div className="text-xs text-cyan-300/80 mb-1">六维</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center">
                  {ATTR_LABELS.map(([k, lbl]) => (
                    <div key={k} className="rounded bg-slate-800/50 border border-slate-700/50 py-1">
                      <div className="text-[9px] text-slate-500">{lbl}</div>
                      <div className="text-sm text-slate-100 font-mono">{attrs[k] ?? '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Section title={`装备（${equipped.length}）`}>
              {equipped.length === 0 && <div className="text-[10px] text-slate-500">（无）</div>}
              {equipped.map((it) => <Row key={it.id} name={it.name} grade={it.gradeDesc} right={asText(it.combatStat)} sub={it.effect} />)}
              {bag.length > 0 && <div className="text-[10px] text-slate-500 mt-1">储存空间：{bag.map((b) => b.name).join('、')}</div>}
            </Section>

            <Section title={`技能（${skills.length}）`}>
              {skills.length === 0 && <div className="text-[10px] text-slate-500">（无）</div>}
              {skills.map((s) => <Row key={s.id} name={s.name} grade={s.rarity} right={s.level} sub={s.effect} />)}
            </Section>

            <Section title={`天赋（${traits.length}）`}>
              {traits.length === 0 && <div className="text-[10px] text-slate-500">（无）</div>}
              {traits.map((t, i) => <Row key={i} name={t.name} grade={t.rarity} right={t.rarity} sub={t.effect} />)}
            </Section>
          </div>
        )}

        {/* 底部：挑战 */}
        <div className="border-t border-slate-700/60 bg-slate-950/60 p-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-400">
            胜则名次取代为 <b className="text-cyan-300">#{entry.rank}</b>{entry.rank <= 100 ? '，发放排名奖励' : '（>100名无物质奖励）'}
          </div>
          <button disabled={!ready} onClick={onChallenge}
            className="px-5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium shrink-0">⚔ 挑战</button>
        </div>
      </div>
    </div>
  );
}
