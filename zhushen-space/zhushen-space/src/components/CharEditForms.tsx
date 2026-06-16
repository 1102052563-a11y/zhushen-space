import { useState } from 'react';
import { useCharacters, type Skill, type Trait } from '../store/characterStore';

/* 主角 + NPC 共用的「技能 / 天赋」手动编辑表单（characterStore 按 charId 存，两边通用）。
   技能按 id 定位（改名不漂移），天赋按原名定位。保存即写 store、刷新保留。 */

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] text-slate-200 outline-none focus:border-god/50';
const areaCls = inputCls + ' resize-y leading-relaxed';
const labelCls = 'text-[11px] font-mono text-dim/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-0.5 block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Actions({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={onSave}
        className="px-3 py-1 rounded border border-god/40 text-god bg-god/10 hover:bg-god/20 text-[13px] font-mono transition-colors">✓ 保存</button>
      <button onClick={onClose}
        className="px-3 py-1 rounded border border-edge text-dim hover:text-slate-300 text-[13px] font-mono transition-colors">取消</button>
    </div>
  );
}

export function SkillEditForm({ charId, skill, onClose }: { charId: string; skill: Skill; onClose: () => void }) {
  const [d, setD] = useState({
    name: skill.name ?? '', level: skill.level ?? '', rarity: skill.rarity ?? '', skillType: skill.skillType ?? '',
    cost: skill.cost ?? '', cooldown: skill.cooldown ?? '', target: skill.target ?? '', damage: skill.damage ?? '',
    attrBonus: skill.attrBonus ?? '', layers: skill.layers ?? '', layerProgress: skill.layerProgress ?? '',
    tags: (skill.tags ?? []).join('，'),
    desc: skill.desc ?? '', effect: skill.effect ?? '', layerEffects: skill.layerEffects ?? '', note: skill.note ?? '',
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }));
  const save = () => {
    const tags = d.tags.split(/[，,、\s]+/).map((t) => t.trim()).filter(Boolean);
    useCharacters.getState().updateSkill(charId, skill.id, {
      name: d.name.trim() || skill.name, level: d.level, rarity: d.rarity, skillType: d.skillType,
      cost: d.cost, cooldown: d.cooldown, target: d.target, damage: d.damage, attrBonus: d.attrBonus,
      layers: d.layers, layerProgress: d.layerProgress, tags,
      desc: d.desc, effect: d.effect, layerEffects: d.layerEffects, note: d.note,
    });
    onClose();
  };
  return (
    <div className="mt-1 pt-2 border-t border-god/20 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="名称"><input className={inputCls} value={d.name} onChange={set('name')} /></Field>
        <Field label="等级"><input className={inputCls} value={d.level} onChange={set('level')} /></Field>
        <Field label="品级"><input className={inputCls} value={d.rarity} onChange={set('rarity')} placeholder="普通/精良/史诗…" /></Field>
        <Field label="类型"><input className={inputCls} value={d.skillType} onChange={set('skillType')} placeholder="主动/被动/奥义…" /></Field>
        <Field label="消耗"><input className={inputCls} value={d.cost} onChange={set('cost')} /></Field>
        <Field label="冷却"><input className={inputCls} value={d.cooldown} onChange={set('cooldown')} /></Field>
        <Field label="目标"><input className={inputCls} value={d.target} onChange={set('target')} /></Field>
        <Field label="伤害"><input className={inputCls} value={d.damage} onChange={set('damage')} /></Field>
        <Field label="属性加成"><input className={inputCls} value={d.attrBonus} onChange={set('attrBonus')} /></Field>
        <Field label="层数"><input className={inputCls} value={d.layers} onChange={set('layers')} /></Field>
        <Field label="层级进度"><input className={inputCls} value={d.layerProgress} onChange={set('layerProgress')} /></Field>
        <Field label="标签（逗号分隔）"><input className={inputCls} value={d.tags} onChange={set('tags')} /></Field>
      </div>
      <Field label="简描"><textarea rows={2} className={areaCls} value={d.desc} onChange={set('desc')} /></Field>
      <Field label="效果"><textarea rows={2} className={areaCls} value={d.effect} onChange={set('effect')} /></Field>
      <Field label="各层效果"><textarea rows={2} className={areaCls} value={d.layerEffects} onChange={set('layerEffects')} /></Field>
      <Field label="备注"><textarea rows={2} className={areaCls} value={d.note} onChange={set('note')} /></Field>
      <Actions onSave={save} onClose={onClose} />
    </div>
  );
}

export function TraitEditForm({ charId, trait, onClose }: { charId: string; trait: Trait; onClose: () => void }) {
  const [d, setD] = useState({
    name: trait.name ?? '', rarity: trait.rarity ?? '', category: trait.category ?? '', level: trait.level ?? '',
    source: trait.source ?? '', attrBonus: trait.attrBonus ?? '',
    desc: trait.desc ?? '', effect: trait.effect ?? '', note: trait.note ?? '',
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }));
  const save = () => {
    useCharacters.getState().updateTrait(charId, trait.name, {
      name: d.name.trim() || trait.name, rarity: d.rarity || trait.rarity, category: d.category, level: d.level,
      source: d.source, attrBonus: d.attrBonus, desc: d.desc, effect: d.effect, note: d.note,
    });
    onClose();
  };
  return (
    <div className="mt-1 pt-2 border-t border-current/20 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="名称"><input className={inputCls} value={d.name} onChange={set('name')} /></Field>
        <Field label="评级"><input className={inputCls} value={d.rarity} onChange={set('rarity')} placeholder="D/C/B/A/S/SS/SSS" /></Field>
        <Field label="类型"><input className={inputCls} value={d.category} onChange={set('category')} placeholder="技巧类/属性类/能量类…" /></Field>
        <Field label="等级"><input className={inputCls} value={d.level} onChange={set('level')} /></Field>
        <Field label="觉醒方式"><input className={inputCls} value={d.source} onChange={set('source')} /></Field>
        <Field label="属性加成"><input className={inputCls} value={d.attrBonus} onChange={set('attrBonus')} /></Field>
      </div>
      <Field label="简描"><textarea rows={2} className={areaCls} value={d.desc} onChange={set('desc')} /></Field>
      <Field label="效果"><textarea rows={2} className={areaCls} value={d.effect} onChange={set('effect')} /></Field>
      <Field label="备注"><textarea rows={2} className={areaCls} value={d.note} onChange={set('note')} /></Field>
      <Actions onSave={save} onClose={onClose} />
    </div>
  );
}
