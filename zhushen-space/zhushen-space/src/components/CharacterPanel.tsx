import { useState } from 'react';
import {
  useCharacters,
  type Skill, type Trait,
  RARITY_CLS, RARITY_DOT, ELEMENT_CLS,
  SKILL_TIER_CLS, normSkillTier,
} from '../store/characterStore';
import { usePlayer } from '../store/playerStore';
import { asText } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { DeedTimeline, CharMemoryView } from './NpcDetail';
import { SkillEditForm, TraitEditForm } from './CharEditForms';

/* 把长描述按句末标点（。；！？）/换行断成多行，避免挤成一坨；短句原样返回 */
const breakSentences = (s: string) => s.replace(/\r?\n/g, '\n').replace(/([。；！？])(?=[^\s）)」』】])/g, '$1\n');

/* ════════════════════════════════════════════
   技能卡片
════════════════════════════════════════════ */
function SkillCard({ skill, charId, onDelete }: { skill: Skill; charId: string; onDelete: () => void }) {
  const [expand, setExpand] = useState(false);
  const [editing, setEditing] = useState(false);
  const sTier   = normSkillTier(skill.rarity);                       // 7 档品级：普通→极境
  const tierCls = SKILL_TIER_CLS[sTier] ?? 'border-edge text-dim';
  const tierText = tierCls.match(/text-\S+/)?.[0] ?? 'text-dim';     // 提取文字色（值里有对齐空格，不能用 split[1]）
  const element = skill.numeric?.element ?? 'none';
  const elemCls = ELEMENT_CLS[element] ?? 'text-dim';

  return (
    <div className={`rounded-xl border p-3 space-y-1.5 bg-panel cursor-pointer hover:opacity-90 transition-opacity ${tierCls}`}
      onClick={() => setExpand((p) => !p)}>
      {/* 行1：名称 + 等级 + 元素 */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-slate-100">{skill.name}</span>
          {skill.level && (
            <span className="ml-2 text-[12px] font-mono text-dim">{skill.level}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {element !== 'none' && (
            <span className={`text-[12px] font-mono ${elemCls}`}>{element}</span>
          )}
          <span className={`text-[12px] font-mono font-bold ${tierText}`}>{sTier}</span>
        </div>
      </div>

      {/* 行2：简描 */}
      {skill.desc && (
        <p className="text-sm text-dim/80 leading-relaxed whitespace-pre-wrap"><span className="text-god/50 font-mono">技能介绍·</span>{breakSentences(skill.desc)}</p>
      )}

      {/* 展开：当前效果 + 冷却 + 消耗 */}
      {expand && (
        <div className="pt-1 space-y-1 border-t border-edge/40">
          {skill.effect && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap"><span className="text-god/50 font-mono">效果·</span>{breakSentences(skill.effect)}</p>
          )}
          <div className="flex flex-wrap gap-3 text-[12px] font-mono text-dim/60">
            {skill.skillType   && <span>类型: {skill.skillType}</span>}
            {skill.cooldown    && <span>冷却: {skill.cooldown}</span>}
            {skill.cost        && <span>消耗: {skill.cost}</span>}
            {skill.target      && <span>目标: {skill.target}</span>}
            {skill.damage      && <span className="text-blood/70">伤害: {asText(skill.damage)}</span>}
            {skill.layers      && <span>层数: {skill.layers}</span>}
            {skill.layerProgress && <span>进度: {skill.layerProgress}</span>}
            {skill.attrBonus   && <span className="text-emerald-300/70">属性加成: {skill.attrBonus}</span>}
          </div>
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.map((t) => <span key={t} className="text-[11px] font-mono px-1 py-0.5 bg-void border border-edge/50 text-dim/50 rounded">{t}</span>)}
            </div>
          )}
          {skill.layerEffects && (
            <p className="text-[12px] text-dim/50 leading-snug">{skill.layerEffects}</p>
          )}
          {skill.note && (
            <p className="text-[12px] text-amber-200/60 italic leading-snug border-l-2 border-amber-700/40 pl-2">备注·{skill.note}</p>
          )}
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] font-mono text-dim/30">{skill.id}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
                className="text-[12px] font-mono text-god/60 hover:text-god transition-colors"
              >
                {editing ? '取消编辑' : '✎ 编辑'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && <SkillEditForm charId={charId} skill={skill} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ════════════════════════════════════════════
   天赋卡片（评级 D→SSS）
════════════════════════════════════════════ */
function TraitCard({ trait, charId, onDelete }: { trait: Trait; charId: string; onDelete: () => void }) {
  const [expand, setExpand] = useState(false);
  const [editing, setEditing] = useState(false);
  const cls = RARITY_CLS[trait.rarity] ?? RARITY_CLS['C'];
  const dot = RARITY_DOT[trait.rarity] ?? 'bg-slate-400';

  return (
    <div className={`rounded-xl border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity ${cls}`}
      onClick={() => setExpand((p) => !p)}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="flex-1 font-semibold text-sm text-slate-100">{trait.name}</span>
        {trait.category && <span className="text-[12px] font-mono shrink-0 text-dim/60">{trait.category}</span>}
        <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ')[1]}`}>{trait.rarity}级</span>
      </div>
      {trait.desc && (
        <p className="text-sm text-dim/80 leading-relaxed whitespace-pre-wrap"><span className="text-god/50 font-mono">天赋介绍·</span>{breakSentences(trait.desc)}</p>
      )}

      {expand && (
        <div className="pt-1 space-y-1 border-t border-edge/40">
          {trait.effect && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap"><span className="text-god/50 font-mono">效果·</span>{breakSentences(trait.effect)}</p>
          )}
          <div className="flex flex-wrap gap-3 text-[12px] font-mono text-dim/60">
            {trait.level && <span>等级: {trait.level}</span>}
            {trait.source && <span>觉醒: {trait.source}</span>}
            {trait.category && <span>类型: {trait.category}</span>}
            {trait.attrBonus && <span className="text-emerald-300/70">属性加成: {trait.attrBonus}</span>}
            {trait.numeric?.profile && <span>领域: {trait.numeric.profile}</span>}
          </div>
          {trait.note && (
            <p className="text-[12px] text-amber-200/60 italic leading-snug border-l-2 border-amber-700/40 pl-2">备注·{trait.note}</p>
          )}
          <div className="flex justify-end items-center gap-3 mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
              className="text-[12px] font-mono text-god/60 hover:text-god transition-colors"
            >
              {editing ? '取消编辑' : '✎ 编辑'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      )}
      {editing && <TraitEditForm charId={charId} trait={trait} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ════════════════════════════════════════════
   经历 tab（主角 = 可编辑背景；NPC = 只读时间线）
════════════════════════════════════════════ */
function HistoryTabView({ charId }: { charId: string }) {
  const isPlayer = /^B\d+$/.test(charId);
  const profile = usePlayer((s) => s.profile);
  const setBackground = usePlayer((s) => s.setBackground);
  const removePlayerDeed = usePlayer((s) => s.removePlayerDeed);
  const npc = useNpc((s) => s.npcs[charId]);
  const removeDeed = useNpc((s) => s.removeDeed);

  if (isPlayer) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">背景 / 出身</h3>
          <textarea
            value={profile.background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="记录主角的来历、立场、关键设定…"
            className="w-full min-h-[80px] rounded-xl border border-edge bg-panel/60 p-3 text-sm text-slate-200 outline-none focus:border-god leading-relaxed"
          />
        </div>
        <div>
          <h3 className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">经历时间线</h3>
          <DeedTimeline log={profile.deedLog} onRemove={removePlayerDeed} />
        </div>
        <CharMemoryView charId={charId} />
      </div>
    );
  }

  // NPC：只读背景 + 时间线
  return (
    <div className="space-y-5">
      {npc?.background && (
        <div>
          <h3 className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">背景 / 简介</h3>
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap rounded-xl border border-edge bg-panel/60 p-3">{npc.background}</div>
        </div>
      )}
      <div>
        <h3 className="text-sm font-mono text-god/70 uppercase tracking-widest mb-2">经历时间线</h3>
        <DeedTimeline log={npc?.deedLog} legacy={npc?.deeds} onRemove={(i) => removeDeed(charId, i)} />
      </div>
      <CharMemoryView charId={charId} />
    </div>
  );
}

/* ════════════════════════════════════════════
   主面板
════════════════════════════════════════════ */
type PanelTab = 'skills' | 'traits' | 'history';

export default function CharacterPanel({ onClose }: { onClose: () => void }) {
  const characters  = useCharacters((s) => s.characters);
  const removeSkill = useCharacters((s) => s.removeSkill);
  const removeTrait = useCharacters((s) => s.removeTrait);

  // 本面板（右侧「✨ 技能」入口）只展示主角 B 系角色的技能/天赋；NPC(C/G) 的技能天赋走「📇 NPC」页面查看
  const charIds = Array.from(new Set(['B1', ...Object.keys(characters).filter((id) => /^B\d+$/.test(id))]));
  const [activeChar, setActiveChar] = useState(charIds[0] ?? 'B1');
  const [tab, setTab] = useState<PanelTab>('skills');
  const [addingSkill, setAddingSkill] = useState(false);   // 「+ 新增技能」手动添加（不依赖 AI，技能数量无上限）

  const char    = characters[activeChar];
  const skills  = char?.skills  ?? [];
  const traits  = char?.traits  ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        {/* 标题栏 */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">✨</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">技能 · 天赋</div>
            <div className="text-[12px] font-mono text-dim/50">
              由主角演化阶段自动维护
            </div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        {/* 角色选择 + Tab */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-edge bg-panel overflow-x-auto">
          {/* 角色选择器 */}
          {charIds.length > 0 ? (
            charIds.map((id) => (
              <button
                key={id}
                onClick={() => setActiveChar(id)}
                className={`px-3 py-1 rounded-lg text-sm font-mono border transition-colors shrink-0 ${
                  activeChar === id
                    ? 'border-god/50 text-god bg-god/10'
                    : 'border-edge text-dim hover:border-god/30 hover:text-slate-200'
                }`}
              >
                {id}
              </button>
            ))
          ) : (
            <span className="text-sm text-dim/40 font-mono">暂无角色数据</span>
          )}

          <div className="flex-1" />

          {/* Tab */}
          <div className="flex gap-1 shrink-0">
            {(['skills', 'traits', 'history'] as PanelTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setAddingSkill(false); }}
                className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${
                  tab === t
                    ? 'border-god/50 text-god bg-god/10'
                    : 'border-edge text-dim hover:text-slate-200'
                }`}
              >
                {t === 'skills' ? `技能 (${skills.length})` : t === 'traits' ? `天赋 (${traits.length})` : '经历'}
              </button>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'history' ? (
            <HistoryTabView charId={activeChar} />
          ) : charIds.length === 0 || !char ? (
            <div className="h-full flex items-center justify-center text-dim/30 text-sm font-mono">
              <div className="text-center space-y-2">
                <div>暂无数据</div>
                <div className="text-sm">启用主角演化预设后，AI 将自动维护技能与天赋</div>
              </div>
            </div>
          ) : tab === 'skills' ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() => setAddingSkill((v) => !v)}
                  className="px-3 py-1 rounded border border-god/40 text-god bg-god/10 hover:bg-god/20 text-[13px] font-mono transition-colors"
                >
                  {addingSkill ? '✕ 取消新增' : '+ 新增技能'}
                </button>
              </div>
              {addingSkill && (
                <div className="rounded-xl border border-god/30 bg-panel/60 p-3">
                  <div className="text-[12px] font-mono text-god/70 mb-1">新增技能（{activeChar}）· 技能数量无上限</div>
                  <SkillEditForm key={activeChar} charId={activeChar} onClose={() => setAddingSkill(false)} />
                </div>
              )}
              {skills.length === 0 ? (
                <div className="text-center text-dim/30 text-sm font-mono py-10">
                  {activeChar} 暂无技能
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 items-start">
                  {skills.map((sk, i) => (
                    <SkillCard
                      key={`${sk.id}-${i}`}
                      skill={sk}
                      charId={activeChar}
                      onDelete={() => removeSkill(activeChar, sk.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            traits.length === 0 ? (
              <div className="h-full flex items-center justify-center text-dim/30 text-sm font-mono">
                {activeChar} 暂无天赋
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 items-start">
                {traits.map((tr, i) => (
                  <TraitCard
                    key={`${tr.name}-${i}`}
                    trait={tr}
                    charId={activeChar}
                    onDelete={() => removeTrait(activeChar, tr.name)}
                  />
                ))}
              </div>
            )
          )}
        </div>

      </div>
    </div>
  );
}
