import { useState, type ReactNode } from 'react';
import { ATTR_KEYS, ATTR_LABEL } from '../systems/attrBonus';
import { EntityCard, EntityDetailModal, type EntityKind } from './EntityDetail';

/* 只读「完整 NPC 大面板」：把一份自包含快照（systems/npcCard.ts buildNpcCardSnapshot / 助战卡 / 主角卡）
   渲染成和平时 NpcDetail 接近的完整面板——基本信息 / 属性六维 / 技能 / 天赋 / 称号 / 副职业 / 装备 / 储存 / 经历。
   供「助战大厅卡详情」与「聊天室分享 NPC 详情」共用。data 字段宽松读取（兼容 NPC 快照与主角快照两种形状）。
   可选 meta（名字下方附加信息，如上传者/分类）+ actions（底部操作按钮，如邀请/遣散/删除）。 */

const EQUIP_CATS = new Set(['武器', '防具', '饰品', '法宝', '装备']);
function itemKind(it: any): EntityKind {
  return EQUIP_CATS.has(String(it?.category || it?.slot || it?.equipSlot || '')) ? 'equip' : 'item';
}

function Row({ label, value }: { label: string; value?: any }) {
  const v = value == null || value === '' ? '' : String(value);
  if (!v) return null;
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 items-start">
      <div className="text-[11px] font-mono text-dim/50 pt-0.5 shrink-0">{label}</div>
      <div className="text-[13px] text-slate-200 leading-relaxed break-words whitespace-pre-wrap">{v}</div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-god/70 border-b border-edge/60 pb-1">{title}{count != null ? `（${count}）` : ''}</div>
      {children}
    </div>
  );
}

export default function NpcCardDetail({ data, onClose, meta, actions }: {
  data: any; onClose: () => void; meta?: ReactNode; actions?: ReactNode;
}) {
  const [sub, setSub] = useState<{ kind: EntityKind; data: any } | null>(null);
  const d = data || {};
  const a: any = d.attrs || {};
  const ra: any = d.realAttrs || {};
  const tier = d.tier || (d.realm ? String(d.realm).split('|')[0] : '');
  const identity = d.identity || (d.realm && String(d.realm).includes('|') ? String(d.realm).split('|').slice(1).join('|').trim() : '');
  const appearance = d.appearance || d.appearanceDetail || '';
  const personaDetail = d.personalityDetail || d.innerThought || '';
  const head = [tier, d.profession].filter(Boolean).join(' · ');
  const skills: any[] = d.skills || [];
  const traits: any[] = d.traits || [];
  const titles: any[] = d.titles || [];
  const subs: any[] = d.subProfessions || [];
  const equipment: any[] = d.equipment || [];
  const items: any[] = d.items || [];
  const deeds: any[] = d.deeds || d.deedLog || [];
  const hasAttrs = a && Object.keys(a).length > 0;
  const hasReal = ra && Object.keys(ra).length > 0;
  const nm = (x: any) => x?.name || x?.title || '';

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl h-[86vh] flex flex-col rounded-2xl border border-god/30 bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* 头部 */}
        <header className="shrink-0 flex items-start gap-3 px-5 py-3.5 border-b border-edge bg-panel">
          {d.avatar
            ? <img src={d.avatar} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
            : <span className="w-14 h-14 rounded-lg bg-panel2 grid place-items-center shrink-0 text-2xl">📇</span>}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-slate-100 truncate">{d.name || '（无名）'}</span>
              {d.title ? <span className="text-[11px] text-god/75">「{d.title}」</span> : null}
              {d.npcTag ? <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-god/15 border border-god/30 text-god/90">{d.npcTag}</span> : null}
            </div>
            <div className="text-[11px] font-mono text-dim/55 mt-0.5 truncate">{head}{d.line && !head ? d.line : ''}</div>
            {meta ? <div className="mt-1">{meta}</div> : null}
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors shrink-0">✕</button>
        </header>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 基本信息 */}
          <Section title="基本信息">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="性别" value={d.gender} />
              <Row label="阶位" value={tier} />
              <Row label="身份" value={identity} />
              <Row label="职业" value={d.profession} />
              <Row label="生物强度" value={d.bioStrength} />
              <Row label="年龄" value={d.age} />
              <Row label="契约者ID" value={d.contractorId} />
              <Row label="隶属" value={d.affiliatedTeam} />
              <Row label="当前状态" value={d.status} />
              <Row label="种族" value={d.race} />
            </div>
          </Section>

          {/* 属性 */}
          {(hasAttrs || d.maxHp != null || d.maxEp != null) && (
            <Section title="属性">
              {hasAttrs && (
                <div className="flex flex-wrap gap-1.5">
                  {ATTR_KEYS.map((k) => (
                    <span key={k} className="px-2.5 py-1 rounded-md text-[12px] font-mono bg-panel2/70 border border-edge text-slate-100">
                      {ATTR_LABEL[k]} <b className="text-god/90">{a[k] ?? '?'}</b>
                      {hasReal && ra[k] ? <span className="text-amber-300/80"> (+{ra[k]})</span> : null}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {d.maxHp != null && <span className="px-2.5 py-1 rounded-md text-[12px] font-mono bg-blood/10 border border-blood/30 text-blood/85">生命 {d.maxHp}</span>}
                {d.maxEp != null && <span className="px-2.5 py-1 rounded-md text-[12px] font-mono bg-god/10 border border-god/30 text-god/85">能量 {d.maxEp}</span>}
              </div>
            </Section>
          )}

          {/* 性格 / 外观 / 背景 / 评价 */}
          {(d.personality || personaDetail || appearance || d.background || d.review) && (
            <Section title="档案">
              <div className="space-y-2">
                {(d.personality || personaDetail) && <Row label="性格" value={[d.personality, personaDetail].filter(Boolean).join('\n')} />}
                {appearance && <Row label="外观" value={appearance} />}
                {d.background && <Row label="背景" value={d.background} />}
                {d.review && <Row label="评价" value={d.review} />}
              </div>
            </Section>
          )}

          {/* 技能 */}
          {skills.length > 0 && (
            <Section title="技能" count={skills.length}>
              <div className="space-y-1.5">{skills.map((s, i) => <EntityCard key={i} kind="skill" data={s} onOpen={() => setSub({ kind: 'skill', data: s })} />)}</div>
            </Section>
          )}
          {/* 天赋 */}
          {traits.length > 0 && (
            <Section title="天赋" count={traits.length}>
              <div className="space-y-1.5">{traits.map((t, i) => <EntityCard key={i} kind="talent" data={t} onOpen={() => setSub({ kind: 'talent', data: t })} />)}</div>
            </Section>
          )}
          {/* 称号 / 副职业 */}
          {titles.length > 0 && (
            <Section title="称号" count={titles.length}>
              <div className="flex flex-wrap gap-1.5">{titles.map((t, i) => <span key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-panel2/70 border border-edge text-slate-200">{nm(t)}{t?.equipped ? ' ✓' : ''}</span>)}</div>
            </Section>
          )}
          {subs.length > 0 && (
            <Section title="副职业" count={subs.length}>
              <div className="flex flex-wrap gap-1.5">{subs.map((s, i) => <span key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-panel2/70 border border-edge text-slate-200">{nm(s)}{s?.level ? `·${s.level}` : ''}</span>)}</div>
            </Section>
          )}
          {/* 装备 */}
          {equipment.length > 0 && (
            <Section title="装备" count={equipment.length}>
              <div className="space-y-1.5">{equipment.map((it, i) => <EntityCard key={i} kind="equip" data={it} onOpen={() => setSub({ kind: 'equip', data: it })} />)}</div>
            </Section>
          )}
          {/* 储存空间 */}
          {items.length > 0 && (
            <Section title="储存空间" count={items.length}>
              <div className="space-y-1.5">{items.slice(0, 60).map((it, i) => <EntityCard key={i} kind={itemKind(it)} data={it} onOpen={() => setSub({ kind: itemKind(it), data: it })} />)}</div>
            </Section>
          )}
          {/* 经历 */}
          {deeds.length > 0 && (
            <Section title="经历" count={deeds.length}>
              <div className="space-y-1">
                {deeds.slice(-40).map((dd: any, i: number) => {
                  const t = [dd?.time, dd?.location].filter(Boolean).join('·');
                  const txt = dd?.content || dd?.text || dd?.description || dd?.summary || '';
                  return txt ? <div key={i} className="text-[12px] text-dim/65 leading-snug">{t ? <span className="text-dim/40 font-mono">[{t}] </span> : null}{txt}</div> : null;
                })}
              </div>
            </Section>
          )}
        </div>

        {/* 底部操作 */}
        {actions ? <footer className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-edge bg-panel">{actions}</footer> : null}
      </div>

      {sub && <EntityDetailModal kind={sub.kind} data={sub.data} onClose={() => setSub(null)} />}
    </div>
  );
}
