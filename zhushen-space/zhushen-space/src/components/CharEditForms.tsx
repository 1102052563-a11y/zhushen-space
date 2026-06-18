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

// skill 省略 = 「新增技能」模式：保存时走 addSkill 追加一条（id 留空交给 store 自动分配，技能数量无上限）。
// onSubmit 提供时：不写 characterStore，改把组装好的字段回调给调用方（技能树节点 grants 复用此表单）。
export function SkillEditForm({ charId, skill, onClose, onSubmit }: { charId?: string; skill?: Skill; onClose: () => void; onSubmit?: (fields: Omit<Skill, 'id' | 'addedAt'>) => void }) {
  const [d, setD] = useState({
    name: skill?.name ?? '', level: skill?.level ?? '', rarity: skill?.rarity ?? '', skillType: skill?.skillType ?? '',
    cost: skill?.cost ?? '', cooldown: skill?.cooldown ?? '', target: skill?.target ?? '', damage: skill?.damage ?? '',
    attrBonus: skill?.attrBonus ?? '', layers: skill?.layers ?? '', layerProgress: skill?.layerProgress ?? '',
    tags: Array.isArray(skill?.tags) ? skill!.tags.join('，') : (typeof skill?.tags === 'string' ? skill!.tags : ''),
    desc: skill?.desc ?? '', effect: skill?.effect ?? '', layerEffects: skill?.layerEffects ?? '', note: skill?.note ?? '',
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }));
  const save = () => {
    const name = d.name.trim();
    if (!skill && !name) return;   // 新增模式下必须先填名字
    const tags = d.tags.split(/[，,、\s]+/).map((t) => t.trim()).filter(Boolean);
    const fields = {
      name: name || skill?.name || '未命名技能', level: d.level, rarity: d.rarity, skillType: d.skillType,
      cost: d.cost, cooldown: d.cooldown, target: d.target, damage: d.damage, attrBonus: d.attrBonus,
      layers: d.layers, layerProgress: d.layerProgress, tags,
      desc: d.desc, effect: d.effect, layerEffects: d.layerEffects, note: d.note,
    };
    if (onSubmit) { onSubmit(fields as Omit<Skill, 'id' | 'addedAt'>); onClose(); return; }   // 技能树节点：回调而非写 store
    if (skill?.id) useCharacters.getState().updateSkill(charId!, skill.id, fields);
    else useCharacters.getState().addSkill(charId!, { id: '', ...fields });   // 追加新技能，store 自动去重分配 id
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

// trait 省略 + onSubmit 提供 = 「新建天赋」模式（技能树节点 grants 复用）：回调字段，不写 store。
export function TraitEditForm({ charId, trait, onClose, onSubmit }: { charId?: string; trait?: Trait; onClose: () => void; onSubmit?: (fields: Omit<Trait, 'addedAt'>) => void }) {
  const [d, setD] = useState({
    name: trait?.name ?? '', rarity: trait?.rarity ?? '', category: trait?.category ?? '', level: trait?.level ?? '',
    source: trait?.source ?? '', attrBonus: trait?.attrBonus ?? '',
    desc: trait?.desc ?? '', effect: trait?.effect ?? '', note: trait?.note ?? '',
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }));
  const save = () => {
    const fields = {
      name: d.name.trim() || trait?.name || '未命名天赋', rarity: d.rarity || trait?.rarity || 'C', category: d.category, level: d.level,
      source: d.source, attrBonus: d.attrBonus, desc: d.desc, effect: d.effect, note: d.note,
    };
    if (onSubmit) { onSubmit(fields as Omit<Trait, 'addedAt'>); onClose(); return; }
    if (!trait) { onClose(); return; }
    useCharacters.getState().updateTrait(charId!, trait.name, fields);
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
