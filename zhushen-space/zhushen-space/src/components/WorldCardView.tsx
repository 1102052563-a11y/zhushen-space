import { useState } from 'react';
import { type WorldOption } from './WorldSelector';

// 可编辑的正文字段（均为字符串）。顺序即卡片正文展示顺序，与 enterWorld 拼装顺序一致。
type SectionKey =
  | 'desc' | 'peakPower' | 'contractorDist' | 'identity' | 'entryPoint'
  | 'mainMission' | 'sideMission' | 'warning' | 'reward';

const SECTIONS: { key: SectionKey; label: string; accent?: string }[] = [
  { key: 'desc',           label: '世界简介' },
  { key: 'peakPower',      label: '巅峰战力' },
  { key: 'contractorDist', label: '契约者分布' },
  { key: 'identity',       label: '主角身份', accent: 'god' },
  { key: 'entryPoint',     label: '切入点',   accent: 'god' },
  { key: 'mainMission',    label: '主线任务', accent: 'amber' },
  { key: 'sideMission',    label: '支线任务' },
  { key: 'warning',        label: '警告',     accent: 'blood' },
  { key: 'reward',         label: '奖励预览', accent: 'gold' },
];

export default function WorldCardView({ worlds, index, onPrev, onNext, onJump, onSelect, onEdit, onClose, onGenWorldview, genBusy, hasWorldview, onGenProfQuests, profBusy, profQuests, onEnterWithProf, onProfQuestsChange }: {
  worlds: WorldOption[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  onSelect: (name: string, world: WorldOption) => void;
  onEdit: (index: number, patch: Partial<WorldOption>) => void;   // 编辑卡片字段：把改动提升到上层 worlds 状态，"进入此世界"即用改后的内容
  onClose: () => void;
  onGenWorldview?: (index: number, world: WorldOption) => void;   // 🌐 为本卡生成/重生成「世界观骨架」（存进世界记录·进世界后注入正文最深处）
  genBusy?: boolean;        // 当前卡正在生成世界观
  hasWorldview?: boolean;   // 当前卡已有世界观记录（显示「重生成 ✓」）
  onGenProfQuests?: (index: number, world: WorldOption) => void;   // 🎯 为本卡生成「职业专属任务+奖励」（读技能树/副职业树）
  profBusy?: boolean;       // 当前卡正在生成职业任务
  profQuests?: string;      // 当前卡已生成的职业任务内容（展示在卡片下方）
  onEnterWithProf?: (index: number, world: WorldOption) => void;   // 🚪 带入这些职业任务并进入此世界
  onProfQuestsChange?: (index: number, world: WorldOption, text: string) => void;   // ✎ 手动编辑职业任务文本（写回上层 profQuests 状态·带入时即用改后内容）
}) {
  const world = worlds[index];
  const [editing, setEditing] = useState(false);
  const [profEditing, setProfEditing] = useState(false);   // 职业任务区的编辑开关

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-void/90 backdrop-blur-sm px-6 max-lg:px-2 py-3">
      {/* 关闭 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-5 text-dim hover:text-blood text-sm font-mono transition-colors"
      >
        ✕ 关闭
      </button>

      {/* 计数 */}
      <div className="mb-2 text-sm font-mono text-dim tracking-widest">
        {index + 1} / {worlds.length}
        {editing && <span className="ml-3 text-god/70">✎ 编辑中（改完点「进入此世界」即用改后内容）</span>}
      </div>

      {/* 卡片 + 左右箭头 */}
      <div className="flex items-stretch gap-4 max-lg:gap-1.5 w-full max-w-4xl min-h-0 max-h-[calc(100%-2.75rem)]">
        {/* 左箭头 */}
        <button
          onClick={onPrev}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ‹
        </button>

        {/* 卡片 */}
        <div className="flex-1 border border-god/30 rounded-2xl bg-panel shadow-[0_0_50px_rgba(70,227,207,0.08)] overflow-hidden flex flex-col min-h-0">

          {/* ── 头部：编号 + 世界名 + 类型 ── */}
          <div className="px-8 pt-4 pb-3.5 border-b border-edge shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-mono text-god/40 tracking-widest uppercase">
                World · {String(index + 1).padStart(2, '0')}
              </span>
              {editing ? (
                <input
                  value={world.worldType}
                  onChange={(e) => onEdit(index, { worldType: e.target.value })}
                  placeholder="类型"
                  className="text-sm font-mono px-2 py-0.5 w-28 bg-void border border-god/30 text-god/70 rounded outline-none focus:border-god/60 text-center"
                />
              ) : world.worldType ? (
                <span className="text-sm font-mono px-3 py-0.5 border border-god/20 text-god/60 rounded">
                  {world.worldType}
                </span>
              ) : null}
            </div>

            {editing ? (
              <input
                value={world.name}
                onChange={(e) => onEdit(index, { name: e.target.value })}
                placeholder="世界名称"
                className="w-full text-2xl font-bold text-slate-100 leading-snug bg-void border border-god/30 rounded px-2 py-1 mt-0.5 outline-none focus:border-god/60"
              />
            ) : (
              <h2 className="text-2xl font-bold text-slate-100 leading-snug god-glow mt-0.5">{world.name}</h2>
            )}

            {/* 阶位 + 难度 + 区域 */}
            {editing ? (
              <div className="flex items-center gap-2 mt-2 flex-wrap text-sm font-mono">
                <label className="flex items-center gap-1 text-sky-400/70">阶位
                  <input
                    value={world.tier}
                    onChange={(e) => onEdit(index, { tier: e.target.value })}
                    className="w-16 bg-void border border-god/30 rounded px-1.5 py-0.5 text-sky-300 outline-none focus:border-god/60"
                  />
                </label>
                <label className="flex items-center gap-1 text-amber-400/70">难度
                  <input
                    value={world.dangerLevel}
                    onChange={(e) => onEdit(index, { dangerLevel: e.target.value })}
                    className="w-32 bg-void border border-god/30 rounded px-1.5 py-0.5 text-amber-300 outline-none focus:border-god/60"
                  />
                </label>
                <label className="flex items-center gap-1 text-dim">📍
                  <input
                    value={world.region}
                    onChange={(e) => onEdit(index, { region: e.target.value })}
                    placeholder="任务区域"
                    className="w-44 bg-void border border-god/30 rounded px-1.5 py-0.5 text-slate-300 outline-none focus:border-god/60"
                  />
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {world.tier !== '' && (
                  <span className="text-base font-mono text-sky-400/80">
                    {typeof world.tier === 'number' || /^\d+$/.test(world.tier)
                      ? `${world.tier} 阶`
                      : world.tier}
                  </span>
                )}
                {world.dangerLevel && (
                  <span className="text-base font-mono text-amber-400/80">{world.dangerLevel}</span>
                )}
                {world.region && (
                  <span className="text-sm font-mono text-dim truncate max-w-sm">📍 {world.region}</span>
                )}
              </div>
            )}
          </div>

          {/* ── 可滚动正文 ── 编辑模式下展示全部字段（含空字段，便于补写）；浏览模式只显示非空字段 */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-edge/40">
            {SECTIONS.filter((s) => editing || world[s.key]).map((s) => (
              <CardSection
                key={s.key}
                label={s.label}
                accent={s.accent}
                content={String(world[s.key] ?? '')}
                editing={editing}
                onChange={(v) => onEdit(index, { [s.key]: v } as Partial<WorldOption>)}
              />
            ))}
            {profQuests !== undefined && (
              <div className="px-8 py-3 bg-amber-500/[0.05]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex-1 text-sm font-mono text-amber-300/80">🎯 职业专属任务（据你的技能树 / 副职业生成 · 完成后经正文即时发放奖励，不计世界结算）</span>
                  {onProfQuestsChange && (
                    <button
                      onClick={() => setProfEditing((v) => !v)}
                      className={`text-[12px] font-mono px-2 py-0.5 rounded border transition-colors ${profEditing ? 'border-amber-400/60 text-amber-200 bg-amber-500/10' : 'border-edge text-dim hover:border-amber-400/40 hover:text-amber-300'}`}
                    >{profEditing ? '✓ 完成' : '✎ 编辑'}</button>
                  )}
                </div>
                {profEditing && onProfQuestsChange ? (
                  <textarea
                    value={profQuests}
                    onChange={(e) => onProfQuestsChange(index, world, e.target.value)}
                    rows={Math.min(18, Math.max(4, (profQuests || '').split('\n').length + 1))}
                    placeholder="手动填写 / 修改本世界的职业任务与奖励…（每条：任务名 / 目标 / 难度 / 奖励）"
                    className="w-full bg-void border border-amber-400/30 rounded px-2 py-1.5 text-[15px] text-slate-200 leading-relaxed outline-none focus:border-amber-400/60 resize-y placeholder:text-dim/40"
                  />
                ) : (
                  <p className="text-[15px] text-slate-200 leading-relaxed whitespace-pre-wrap">{profQuests || <span className="text-dim/50">（空·点「✎ 编辑」可手动填写，或用上方「🎯 生成职业任务」）</span>}</p>
                )}
                {onEnterWithProf && (profQuests || '').trim() && (
                  <button
                    onClick={() => onEnterWithProf(index, world)}
                    className="mt-3 px-5 py-2 border border-amber-400/50 text-amber-200 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 text-sm font-mono transition-colors"
                  >🚪 带入并进入此世界（把职业任务一起带进去）</button>
                )}
              </div>
            )}
          </div>

          {/* ── 底部按钮 ── */}
          <div className="px-8 max-lg:px-3 py-3 max-lg:py-2.5 border-t border-edge flex flex-wrap items-center justify-center gap-3 max-lg:gap-2 shrink-0">
            <button
              onClick={() => setEditing((v) => !v)}
              className={`px-4 py-2.5 max-lg:px-3 max-lg:py-2 border text-base max-lg:text-[13px] rounded-xl font-mono transition-colors ${
                editing ? 'border-god/60 text-god bg-god/15' : 'border-edge text-dim hover:border-god/40 hover:text-god'
              }`}
            >
              {editing ? '✓ 完成编辑' : '✎ 编辑'}
            </button>
            {onGenWorldview && (
              <button
                onClick={() => !genBusy && onGenWorldview(index, world)}
                disabled={genBusy}
                title="据主角当前阶位/等级 + 本卡信息，生成一份世界观骨架（剧情走向/势力/人物·性格锚点·行为特征）。进入此世界后自动注入正文最深处；可在右侧「世界记录」查看。"
                className={`px-4 py-2.5 max-lg:px-3 max-lg:py-2 border text-base max-lg:text-[13px] rounded-xl font-mono transition-colors ${
                  genBusy ? 'border-violet-400/40 text-violet-300/60 cursor-wait'
                  : hasWorldview ? 'border-violet-400/50 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20'
                  : 'border-violet-500/40 text-violet-300 hover:bg-violet-500/10'
                }`}
              >
                {genBusy ? '◌ 生成中…' : hasWorldview ? '🌐 重生成世界观' : '🌐 生成世界观'}
              </button>
            )}
            {onGenProfQuests && (
              <button
                onClick={() => !profBusy && onGenProfQuests(index, world)}
                disabled={profBusy}
                title="读取主角的职业技能树 + 副职业树，为本世界生成贴合你流派的额外「职业任务 + 奖励」（与世界选择同一条 API）。生成后展示在卡片下方，可「带入并进入」；奖励在完成后经正文 + 演化即时发放，不计入世界结算。"
                className={`px-4 py-2.5 max-lg:px-3 max-lg:py-2 border text-base max-lg:text-[13px] rounded-xl font-mono transition-colors ${
                  profBusy ? 'border-amber-400/40 text-amber-300/60 cursor-wait'
                  : profQuests ? 'border-amber-400/50 text-amber-200 bg-amber-500/10 hover:bg-amber-500/20'
                  : 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                }`}
              >
                {profBusy ? '◌ 生成中…' : profQuests ? '🎯 重生成职业任务' : '🎯 生成职业任务'}
              </button>
            )}
            <button
              onClick={() => onSelect(world.name, world)}
              className="px-12 max-lg:px-6 py-2.5 max-lg:py-2 border border-god/50 text-god text-base max-lg:text-sm rounded-xl hover:bg-god/10 font-mono transition-colors max-lg:w-full max-lg:mt-0.5"
            >
              进入此世界
            </button>
          </div>
        </div>

        {/* 右箭头 */}
        <button
          onClick={onNext}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ›
        </button>
      </div>

      {/* 缩略点导航 */}
      <div className="mt-3 flex gap-2">
        {worlds.map((_, i) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === index ? 'bg-god scale-125' : 'bg-dim/40 hover:bg-dim'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

const accentMap: Record<string, string> = {
  god:   'text-god/60',
  amber: 'text-amber-400/70',
  blood: 'text-blood/70',
  gold:  'text-gold/70',
};

function CardSection({ label, content, accent, editing, onChange }: {
  label: string;
  content: string;
  accent?: string;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  const labelColor = accent ? accentMap[accent] ?? 'text-dim' : 'text-dim';
  return (
    <div className="px-8 py-3">
      <div className={`text-sm font-mono mb-1 ${labelColor}`}>{label}</div>
      {editing ? (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(2, content.split('\n').length + 1))}
          placeholder={`填写${label}…`}
          className="w-full bg-void border border-god/30 rounded px-2 py-1.5 text-[15px] text-slate-300 leading-relaxed outline-none focus:border-god/60 resize-y placeholder:text-dim/40"
        />
      ) : (
        <p className="text-[15px] text-slate-300 leading-relaxed whitespace-pre-wrap">{content}</p>
      )}
    </div>
  );
}
