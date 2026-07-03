import { useState } from 'react';
import { useTurnInsight, type TurnSnapshot, type TurnStatusEffect } from '../store/turnInsightStore';

const ATTR_LABEL: Record<string, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };

function Tag({ kind }: { kind: 'new' | 'changed' | 'removed' | 'kept' }) {
  const m = { new: ['新增', 'border-emerald-600/50 text-emerald-300'], changed: ['变更', 'border-amber-600/50 text-amber-300'], removed: ['移除', 'border-rose-600/50 text-rose-300'], kept: ['维持', 'border-edge text-dim/50'] }[kind];
  return <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${m[1]}`}>{m[0]}</span>;
}

/* 状态效果 diff */
function seDiff(prev: TurnStatusEffect[] = [], cur: TurnStatusEffect[] = []) {
  const out: { e: TurnStatusEffect; pe?: TurnStatusEffect; kind: 'new' | 'changed' | 'removed' | 'kept' }[] = [];
  const pm = new Map(prev.map((e) => [e.name, e]));
  for (const e of cur) {
    const pe = pm.get(e.name);
    if (!pe) out.push({ e, kind: 'new' });
    else if (pe.effect !== e.effect || pe.durationDesc !== e.durationDesc) out.push({ e, pe, kind: 'changed' });
    else out.push({ e, kind: 'kept' });
  }
  for (const e of prev) if (!cur.find((x) => x.name === e.name)) out.push({ e, kind: 'removed' });
  return out;
}

function SeRow({ d }: { d: ReturnType<typeof seDiff>[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-edge/60 bg-void/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span className="flex-1 text-[13px] text-slate-200">{d.e.name}</span>
        <Tag kind={d.kind} />
      </div>
      {open && (
        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-dim/75 leading-relaxed">
          {d.kind === 'changed' && d.pe && (
            <div className="border-r border-edge/40 pr-2">
              <div className="text-dim/40">前</div>
              {d.pe.effect && <div>{d.pe.effect}</div>}
              {d.pe.durationDesc && <div className="text-dim/50">时效·{d.pe.durationDesc}</div>}
            </div>
          )}
          <div className={d.kind === 'changed' ? '' : 'col-span-2'}>
            {d.kind === 'changed' && <div className="text-dim/40">后</div>}
            {d.e.type && <div className="text-dim/50">类型·{d.e.type}</div>}
            {d.e.effect && <div>{d.e.effect}</div>}
            {d.e.desc && <div className="text-dim/55">{d.e.desc}</div>}
            {d.e.durationDesc && <div className="text-dim/50">时效·{d.e.durationDesc}</div>}
            {d.e.source && <div className="text-dim/50">来源·{d.e.source}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, tag, children }: { title: string; tag?: 'new' | 'changed'; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-3 space-y-1.5">
      <div className="flex items-center gap-2"><span className="flex-1 text-sm font-semibold text-slate-100">{title}</span>{tag && <Tag kind={tag} />}</div>
      {children}
    </div>
  );
}

/* 生命/蓝量「当前/上限 → 当前/上限」，上限有增减时着色并标↑/↓（上限随体质·智力与被动百分比加成变化）*/
function VitalDelta({ label, pCur, pMax, cCur, cMax }: { label: string; pCur?: number; pMax?: number; cCur?: number; cMax?: number }) {
  const capUp = (cMax ?? 0) > (pMax ?? 0);
  const capCh = pMax !== cMax;
  return (
    <span className="text-slate-200">
      <span className="text-dim/60">{label}</span> <span className="text-dim/45">{pCur ?? '?'}/{pMax ?? '?'}</span>
      <span className="text-dim/40"> → </span>
      <span>{cCur ?? '?'}</span><span className="text-dim/40">/</span>
      <span className={capCh ? (capUp ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-200'}>{cMax ?? '?'}</span>
      {capCh && <span className={`text-[11px] ${capUp ? 'text-emerald-300/70' : 'text-rose-300/70'}`}> 上限{capUp ? '↑' : '↓'}</span>}
    </span>
  );
}

/* 资源「前→后 (±净变)」，增绿减红（乐园币 / 魂币）*/
function ResDelta({ label, from, to }: { label: string; from?: number; to?: number }) {
  const up = (to ?? 0) >= (from ?? 0);
  const delta = (to ?? 0) - (from ?? 0);
  return (
    <span className="text-slate-200">
      <span className="text-dim/60">{label}</span> <span className="text-dim/45">{from ?? 0}</span><span className="text-dim/40">→</span><span className={up ? 'text-emerald-300' : 'text-rose-300'}>{to ?? 0}</span>
      <span className={`text-[11px] ${up ? 'text-emerald-300/60' : 'text-rose-300/60'}`}> ({delta >= 0 ? '+' : ''}{delta})</span>
    </span>
  );
}

/* 已装备清单 diff（按名匹配）：新出现=装上 / 消失=卸下 / 强化等级(+N)变化=强化 */
type EquipLite = { name: string; grade?: string; plus?: number };
function diffEquips(prev: EquipLite[] = [], cur: EquipLite[] = []) {
  const pm = new Map(prev.map((e) => [e.name, e]));
  const cm = new Map(cur.map((e) => [e.name, e]));
  const out: { name: string; grade?: string; kind: 'on' | 'off' | 'enhance'; from?: number; to?: number }[] = [];
  for (const e of cur) {
    const p = pm.get(e.name);
    if (!p) out.push({ name: e.name, grade: e.grade, kind: 'on', to: e.plus ?? 0 });
    else if ((p.plus ?? 0) !== (e.plus ?? 0)) out.push({ name: e.name, grade: e.grade, kind: 'enhance', from: p.plus ?? 0, to: e.plus ?? 0 });
  }
  for (const e of prev) if (!cm.has(e.name)) out.push({ name: e.name, grade: e.grade, kind: 'off' });
  return out;
}

export default function TurnInsightPanel({ onClose }: { onClose: () => void }) {
  const snapshots = useTurnInsight((s) => s.snapshots);
  const [offset, setOffset] = useState(0);   // 0=本轮(最新 vs 上一份)，1=上轮
  const n = snapshots.length;
  const cur = snapshots[n - 1 - offset];
  const prev = snapshots[n - 2 - offset];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2"><span className="text-lg">🔍</span><h2 className="text-base font-bold text-slate-100">回合洞察</h2></div>
            <p className="text-[13px] text-dim/60 mt-0.5">按相邻回合整理：{cur ? `第${cur.turn}回合 ← 第${prev?.turn ?? '—'}回合` : '暂无快照'}</p>
          </div>
          <div className="flex items-center gap-2">
            {n > 2 && (
              <div className="flex gap-1">
                <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim disabled:opacity-30 hover:text-god">本轮</button>
                <button onClick={() => setOffset((o) => Math.min(n - 2, o + 1))} disabled={offset >= n - 2} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim disabled:opacity-30 hover:text-god">上轮</button>
              </div>
            )}
            <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg font-mono">✕</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!cur && <div className="text-center text-dim/40 text-sm py-12">暂无回合快照。每回合结束约 20 秒后自动记录，再回来看变化。</div>}
          {cur && !prev && <div className="text-center text-dim/40 text-sm py-12">这是第一份快照，还没有可对比的上一轮。</div>}
          {cur && prev && <InsightBody cur={cur} prev={prev} />}
        </div>
      </div>
    </div>
  );
}

function InsightBody({ cur, prev }: { cur: TurnSnapshot; prev: TurnSnapshot }) {
  // 主角属性
  const attrChanges = (['str', 'agi', 'con', 'int', 'cha', 'luck'] as const)
    .map((k) => ({ k, from: prev.player.attrs?.[k], to: cur.player.attrs?.[k] }))
    .filter((x) => x.from !== x.to && x.to != null);
  const lvCh = prev.player.level !== cur.player.level && cur.player.level != null;
  const pSE = seDiff(prev.player.statusEffects, cur.player.statusEffects).filter((d) => d.kind !== 'kept' || (cur.player.statusEffects?.length ?? 0) <= 4);
  const statusTextCh = (prev.player.status ?? '') !== (cur.player.status ?? '') && (cur.player.status ?? '');
  // 生命/蓝量：当前值或上限变化（上限现会随体质/智力与被动百分比加成而变）
  const hpCh = (prev.player.hp !== cur.player.hp || prev.player.maxHp !== cur.player.maxHp) && cur.player.maxHp != null;
  const epCh = (prev.player.mp !== cur.player.mp || prev.player.maxMp !== cur.player.maxMp) && cur.player.maxMp != null;
  // 技能 学会/失去；佩戴称号变化
  const prevSkills = new Set(prev.player.skills ?? []);
  const curSkills = new Set(cur.player.skills ?? []);
  const skillsLearned = (cur.player.skills ?? []).filter((s) => !prevSkills.has(s));
  const skillsLost = (prev.player.skills ?? []).filter((s) => !curSkills.has(s));
  const titleCh = (prev.player.titlesEquipped ?? '') !== (cur.player.titlesEquipped ?? '');
  // 资源：乐园币 / 魂币
  const parkCh = prev.player.parkCoin !== cur.player.parkCoin && cur.player.parkCoin != null;
  const soulCh = prev.player.soulCoin !== cur.player.soulCoin && cur.player.soulCoin != null;
  const resCh = parkCh || soulCh;
  // 装备：装上/卸下/强化(+N 变化)
  const equipDiff = diffEquips(prev.player.equips, cur.player.equips);
  const playerHasChange = attrChanges.length || lvCh || pSE.some((d) => d.kind !== 'kept') || statusTextCh || hpCh || epCh || skillsLearned.length || skillsLost.length || titleCh || resCh || equipDiff.length;

  // NPC
  const npcIds = Array.from(new Set([...Object.keys(cur.npcs), ...Object.keys(prev.npcs)]));
  const npcRows = npcIds.map((id) => {
    const c = cur.npcs[id]; const p = prev.npcs[id];
    if (!c) return null;
    const isNew = !p;
    const favorCh = p && p.favor !== c.favor;
    const statusCh = p && p.status !== c.status;
    const motiveCh = p && p.motiveNow !== c.motiveNow;
    // 阶位只比 Lv./阶位部分（'|' 前），避免身份文字变动误报；登场/离场单独标
    const realmKey = (s?: string) => (s ?? '').split('|')[0].trim();
    const realmCh = !!p && realmKey(p.realm) !== realmKey(c.realm) && !!realmKey(c.realm);
    const sceneCh = !!p && p.onScene !== c.onScene;
    const se = seDiff(p?.statusEffects, c.statusEffects).filter((d) => d.kind !== 'kept');
    if (!isNew && !favorCh && !statusCh && !motiveCh && !realmCh && !sceneCh && se.length === 0) return null;
    return { id, c, p, isNew, favorCh, statusCh, motiveCh, realmCh, sceneCh, se };
  }).filter(Boolean) as any[];

  // 关系（好感）单列
  const relRows = npcRows.filter((r) => r.isNew || r.favorCh);

  // 势力
  const facIds = Array.from(new Set([...Object.keys(cur.factions), ...Object.keys(prev.factions)]));
  const FAC_FIELDS: [keyof TurnSnapshot['factions'][string], string][] = [['goal', '目标'], ['territory', '地盘'], ['resources', '资源'], ['scale', '规模'], ['powerLevel', '实力'], ['relations', '势力关系'], ['leader', '首领'], ['status', '状态']];
  const facRows = facIds.map((id) => {
    const c = cur.factions[id]; const p = prev.factions[id];
    if (!c) return null;
    const isNew = !p;
    const favorCh = p && p.favorToPlayer !== c.favorToPlayer;
    const worldCh = !!p && p.inCurrentWorld !== c.inCurrentWorld;
    const fieldCh = isNew
      ? FAC_FIELDS.filter(([k]) => c[k]).map(([k, label]) => ({ label, from: undefined as any, to: c[k] }))
      : FAC_FIELDS.filter(([k]) => (p![k] ?? '') !== (c[k] ?? '') && c[k]).map(([k, label]) => ({ label, from: p![k], to: c[k] }));
    if (!isNew && !favorCh && !worldCh && fieldCh.length === 0) return null;
    return { id, c, p, isNew, favorCh, worldCh, fieldCh };
  }).filter(Boolean) as any[];

  const nothing = !playerHasChange && npcRows.length === 0 && facRows.length === 0;
  if (nothing) return <div className="text-center text-dim/40 text-sm py-12">本轮相对上一轮无可识别的结构化变化。</div>;

  return (
    <>
      {playerHasChange && (
        <Section title="主角变化">
          {(attrChanges.length > 0 || lvCh) && (
            <Card title="属性 / 等级">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-mono">
                {lvCh && <span className="text-amber-300">Lv. {prev.player.level} <span className="text-dim/40">→</span> {cur.player.level}</span>}
                {attrChanges.map((x) => <span key={x.k} className="text-slate-200">{ATTR_LABEL[x.k]} <span className="text-dim/50">{x.from}</span><span className="text-dim/40">→</span><span className={x.to! > (x.from ?? 0) ? 'text-emerald-300' : 'text-rose-300'}>{x.to}</span></span>)}
              </div>
            </Card>
          )}
          {(hpCh || epCh) && (
            <Card title="生命 / 蓝量">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] font-mono">
                {hpCh && <VitalDelta label="HP" pCur={prev.player.hp} pMax={prev.player.maxHp} cCur={cur.player.hp} cMax={cur.player.maxHp} />}
                {epCh && <VitalDelta label="EP" pCur={prev.player.mp} pMax={prev.player.maxMp} cCur={cur.player.mp} cMax={cur.player.maxMp} />}
              </div>
            </Card>
          )}
          {(pSE.some((d) => d.kind !== 'kept') || statusTextCh) && (
            <Card title="当前状态">
              {statusTextCh && <div className="text-[12px] text-dim/60 mb-1">自由状态：{cur.player.status}</div>}
              <div className="space-y-1.5">{pSE.map((d, i) => <SeRow key={i} d={d} />)}</div>
            </Card>
          )}
          {(skillsLearned.length > 0 || skillsLost.length > 0 || titleCh) && (
            <Card title="技能 / 称号">
              {skillsLearned.length > 0 && <div className="text-[12px]"><span className="text-emerald-300/80">学会</span> <span className="text-slate-200">{skillsLearned.join('、')}</span></div>}
              {skillsLost.length > 0 && <div className="text-[12px]"><span className="text-rose-300/80">失去</span> <span className="text-dim/70">{skillsLost.join('、')}</span></div>}
              {titleCh && <div className="text-[12px] text-dim/70">称号：{prev.player.titlesEquipped ? <span className="text-dim/50">{prev.player.titlesEquipped} → </span> : ''}<span className="text-amber-300/90">{cur.player.titlesEquipped || '（卸下）'}</span></div>}
            </Card>
          )}
          {resCh && (
            <Card title="资源">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] font-mono">
                {parkCh && <ResDelta label="乐园币" from={prev.player.parkCoin} to={cur.player.parkCoin} />}
                {soulCh && <ResDelta label="魂币" from={prev.player.soulCoin} to={cur.player.soulCoin} />}
              </div>
            </Card>
          )}
          {equipDiff.length > 0 && (
            <Card title="装备变化">
              <div className="space-y-1 text-[12px]">
                {equipDiff.map((e, i) => (
                  <div key={i}>
                    {e.kind === 'on' && <><span className="text-emerald-300/80">装上</span> <span className="text-slate-200">{e.name}</span>{e.grade && <span className="text-dim/45"> · {e.grade}</span>}{e.to ? <span className="font-mono text-emerald-300/80"> +{e.to}</span> : ''}</>}
                    {e.kind === 'off' && <><span className="text-rose-300/80">卸下</span> <span className="text-dim/70">{e.name}</span></>}
                    {e.kind === 'enhance' && <><span className="text-amber-300/80">强化</span> <span className="text-slate-200">{e.name}</span> <span className="font-mono text-dim/50">+{e.from}</span><span className="text-dim/40">→</span><span className={`font-mono ${(e.to ?? 0) >= (e.from ?? 0) ? 'text-emerald-300' : 'text-rose-300'}`}>+{e.to}</span></>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </Section>
      )}

      {relRows.length > 0 && (
        <Section title="关系变化">
          {relRows.map((r) => (
            <Card key={r.id} title={`${r.c.name || r.id} · ${r.id}`} tag={r.isNew ? 'new' : 'changed'}>
              <div className="text-[13px] font-mono">好感 {r.isNew ? '' : <><span className="text-dim/50">{r.p.favor}</span><span className="text-dim/40">→</span></>}<span className={(r.isNew ? r.c.favor : r.c.favor - r.p.favor) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{r.c.favor}</span></div>
            </Card>
          ))}
        </Section>
      )}

      {npcRows.length > 0 && (
        <Section title="NPC 动态">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {npcRows.map((r) => (
              <Card key={r.id} title={r.c.name || r.id} tag={r.isNew ? 'new' : 'changed'}>
                {r.favorCh && <div className="text-[12px] font-mono">好感 <span className="text-dim/50">{r.p.favor}</span>→<span className={r.c.favor >= r.p.favor ? 'text-emerald-300' : 'text-rose-300'}>{r.c.favor}</span></div>}
                {r.realmCh && <div className="text-[12px] font-mono text-amber-300/80">阶位 <span className="text-dim/50">{r.p.realm?.split('|')[0] || '—'}</span>→<span>{r.c.realm?.split('|')[0] || '—'}</span></div>}
                {r.sceneCh && <div className={`text-[12px] ${r.c.onScene ? 'text-emerald-300/70' : 'text-dim/55'}`}>{r.c.onScene ? '↗ 登场' : '↘ 离场'}</div>}
                {r.statusCh && <div className="text-[12px] text-dim/70">状态：{r.c.status}</div>}
                {r.motiveCh && <div className="text-[12px] text-dim/70">动机：{r.c.motiveNow}</div>}
                {r.se.length > 0 && <div className="space-y-1 pt-1">{r.se.map((d: any, i: number) => <SeRow key={i} d={d} />)}</div>}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {facRows.length > 0 && (
        <Section title="势力动态">
          {facRows.map((r) => (
            <Card key={r.id} title={`${r.c.name || r.id} · ${r.id}`} tag={r.isNew ? 'new' : 'changed'}>
              {r.favorCh && <div className="text-[12px] font-mono">对主角 <span className="text-dim/50">{r.p.favorToPlayer}</span>→<span className={r.c.favorToPlayer >= r.p.favorToPlayer ? 'text-emerald-300' : 'text-rose-300'}>{r.c.favorToPlayer}</span></div>}
              {r.isNew && <div className="text-[12px] font-mono text-emerald-300/80">对主角 {r.c.favorToPlayer}</div>}
              {r.worldCh && <div className={`text-[12px] ${r.c.inCurrentWorld ? 'text-emerald-300/70' : 'text-dim/55'}`}>{r.c.inCurrentWorld ? '↗ 进入本世界' : '↘ 离开本世界'}</div>}
              {r.fieldCh.map((f: any) => (
                <div key={f.label} className="text-[12px] text-dim/70 leading-relaxed">{f.label}：{r.isNew ? '' : <span className="text-dim/40">{f.from || '—'} → </span>}<span className="text-slate-300">{f.to}</span></div>
              ))}
            </Card>
          ))}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-mono text-god/70">{title}</div>
      {children}
    </div>
  );
}
