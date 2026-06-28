import { useState } from 'react';
import { useLocks, lkNpcAttr, lkNpcField, lkPlayerAttr, lkPlayerField, lkItemField, lkCharSkill } from '../store/lockStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';

/* 字段级锁定 / Pin 管理台（数据库引入①）：勾选要钉死的字段 → 演化时 AI 改不动（被无条件退回锁定值）。 */

const DIMS: [string, string][] = [['str', '力量'], ['agi', '敏捷'], ['con', '体质'], ['int', '智力'], ['cha', '魅力']];
const PLAYER_FIELDS: [string, string][] = [['baseAppearance', '外貌基底'], ['profession', '职业']];
const NPC_FIELDS: [string, string][] = [['appearanceDetail', '外貌'], ['gender', '性别'], ['personality', '性格'], ['profession', '职业']];
const ITEM_FIELDS: [string, string][] = [['combatStat', '数值'], ['effect', '效果'], ['affix', '词缀'], ['gradeDesc', '品级']];
const SKILL_FIELDS: [string, string][] = [['effect', '效果'], ['grade', '品级'], ['level', '等级']];

const DIM_CN: Record<string, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };
const FIELD_CN: Record<string, string> = { appearanceDetail: '外貌', baseAppearance: '外貌基底', gender: '性别', personality: '性格', profession: '职业', combatStat: '数值', effect: '效果', affix: '词缀', gradeDesc: '品级', grade: '品级', level: '等级', intro: '简介', score: '评分', appearance: '外观', type: '类型', scale: '规模', powerLevel: '实力', leader: '首领' };

function prettyLockKey(k: string, npcs: any, items: any[]): string {
  const p = k.split(':');
  if (p[0] === 'player') return `主角·${(p[1] === 'attr' ? DIM_CN : FIELD_CN)[p[2]] || p[2]}`;
  if (p[0] === 'npc') { const nm = npcs[p[1]]?.name || p[1]; return `${nm}·${(p[2] === 'attr' ? DIM_CN : FIELD_CN)[p[3]] || p[3]}`; }
  if (p[0] === 'item') { const nm = items.find((x) => x.id === p[1])?.name || p[1]; return `${nm}·${FIELD_CN[p[3]] || p[3]}`; }
  if (p[0] === 'char') return `${p[2] === 'trait' ? '天赋' : '技能'}「${p[3]}」·${FIELD_CN[p[4]] || p[4]}`;
  if (p[0] === 'faction') return `势力·${FIELD_CN[p[3]] || p[3]}`;
  return k;
}

function Chip({ lk, label }: { lk: string; label: string }) {
  const locked = useLocks((s) => !!s.locks[lk]);
  const toggle = useLocks((s) => s.toggle);
  return (
    <button
      onClick={() => toggle(lk)}
      className={`px-2 py-0.5 rounded text-xs border transition ${locked ? 'bg-amber-500/20 border-amber-400/60 text-amber-200' : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:border-teal-400/50'}`}
    >
      {locked ? '🔒' : '🔓'} {label}
    </button>
  );
}

export default function LockManager() {
  const npcs = useNpc((s) => s.npcs);
  const items = useItems((s) => s.items);
  const chars = useCharacters((s) => s.characters);
  const locks = useLocks((s) => s.locks);
  const clearLocks = useLocks((s) => s.clearLocks);
  const unlock = useLocks((s) => s.unlock);
  const [npcId, setNpcId] = useState('');
  const aliveNpcs = Object.values(npcs).filter((n: any) => !n.isDead && n.name && n.name !== n.id) as any[];
  const b1Skills = (chars['B1']?.skills ?? []) as any[];
  const lockKeys = Object.keys(locks);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-400 leading-relaxed">🔒 锁定的字段，演化时 AI 改不动——会被<b className="text-amber-200/90">无条件钉回锁定值</b>（无视有无剧情理由）。专治"精心调好的数值，推几层楼就被改完了"。锁=当前值，想改先解锁。</p>

      {/* 主角 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="text-teal-300 text-xs font-semibold">主角 · 六维</div>
        <div className="flex flex-wrap gap-1.5">{DIMS.map(([k, l]) => <Chip key={k} lk={lkPlayerAttr(k)} label={l} />)}</div>
        <div className="text-teal-300 text-xs font-semibold pt-1">主角 · 档案</div>
        <div className="flex flex-wrap gap-1.5">{PLAYER_FIELDS.map(([k, l]) => <Chip key={k} lk={lkPlayerField(k)} label={l} />)}</div>
      </section>

      {/* 主角装备 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="text-teal-300 text-xs font-semibold">主角装备（锁 数值/效果/词缀/品级）</div>
        {items.length === 0 ? <div className="text-slate-500 text-xs">（背包暂无物品）</div> : (
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {items.map((it: any) => (
              <div key={it.id} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-300 text-xs min-w-[5rem] max-w-[8rem] truncate" title={it.name}>{it.name}</span>
                {ITEM_FIELDS.map(([k, l]) => <Chip key={k} lk={lkItemField(it.id, k)} label={l} />)}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 主角技能 */}
      {b1Skills.length > 0 && (
        <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
          <div className="text-teal-300 text-xs font-semibold">主角技能（锁 效果/品级/等级）</div>
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {b1Skills.map((sk: any) => (
              <div key={sk.id || sk.name} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-300 text-xs min-w-[5rem] max-w-[8rem] truncate" title={sk.name}>{sk.name}</span>
                {SKILL_FIELDS.map(([k, l]) => <Chip key={k} lk={lkCharSkill('B1', sk.name, k)} label={l} />)}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* NPC / 队友 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="text-teal-300 text-xs font-semibold">NPC / 队友（先选一个，治"肉盾队友体质被改成脆皮"）</div>
        <select value={npcId} onChange={(e) => setNpcId(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs w-full text-slate-200">
          <option value="">— 选择 NPC —</option>
          {aliveNpcs.map((n) => <option key={n.id} value={n.id}>{n.name}（{n.realm || '?'}）</option>)}
        </select>
        {npcId && (
          <>
            <div className="text-slate-400 text-xs pt-1">六维</div>
            <div className="flex flex-wrap gap-1.5">{DIMS.map(([k, l]) => <Chip key={k} lk={lkNpcAttr(npcId, k)} label={l} />)}</div>
            <div className="text-slate-400 text-xs pt-1">档案</div>
            <div className="flex flex-wrap gap-1.5">{NPC_FIELDS.map(([k, l]) => <Chip key={k} lk={lkNpcField(npcId, k)} label={l} />)}</div>
          </>
        )}
      </section>

      {/* 已锁清单 */}
      <section className="border border-slate-700/50 rounded p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-teal-300 text-xs font-semibold">已锁字段（{lockKeys.length}）</div>
          {lockKeys.length > 0 && <button onClick={clearLocks} className="text-xs text-rose-300 hover:text-rose-200">全部解锁</button>}
        </div>
        {lockKeys.length === 0 ? <div className="text-slate-500 text-xs">（暂无锁定）</div> : (
          <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
            {lockKeys.map((k) => (
              <div key={k} className="flex items-center justify-between text-xs gap-2">
                <span className="text-amber-200/80 truncate" title={k}>🔒 {prettyLockKey(k, npcs, items)}</span>
                <button onClick={() => unlock(k)} className="text-slate-400 hover:text-rose-300 shrink-0">✕</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
