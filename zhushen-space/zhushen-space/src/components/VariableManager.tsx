/* 变量管理页 → 演化系统 · 功能中心
   原本是自定义变量编辑器（基本不用）+ 顶部一排挤在右上角的功能入口；
   现改为「居中、放大、分组」的模块卡片启动台。各模块仍是独立子面板（预设/API/调度）。 */

type Cb = (() => void) | undefined;

/* 颜色映射用整段字面量类名，Tailwind 才不会被 purge 掉 */
const COLOR: Record<string, { ring: string; text: string }> = {
  sky:     { ring: 'border-sky-600/40 hover:border-sky-400/70 hover:bg-sky-500/10',         text: 'text-sky-300' },
  violet:  { ring: 'border-violet-600/40 hover:border-violet-400/70 hover:bg-violet-500/10', text: 'text-violet-300' },
  amber:   { ring: 'border-amber-600/40 hover:border-amber-400/70 hover:bg-amber-500/10',     text: 'text-amber-300' },
  teal:    { ring: 'border-teal-600/40 hover:border-teal-400/70 hover:bg-teal-500/10',        text: 'text-teal-300' },
  orange:  { ring: 'border-orange-600/40 hover:border-orange-400/70 hover:bg-orange-500/10',  text: 'text-orange-300' },
  emerald: { ring: 'border-emerald-600/40 hover:border-emerald-400/70 hover:bg-emerald-500/10', text: 'text-emerald-300' },
  cyan:    { ring: 'border-cyan-600/40 hover:border-cyan-400/70 hover:bg-cyan-500/10',        text: 'text-cyan-300' },
  fuchsia: { ring: 'border-fuchsia-600/40 hover:border-fuchsia-400/70 hover:bg-fuchsia-500/10', text: 'text-fuchsia-300' },
  rose:    { ring: 'border-rose-600/40 hover:border-rose-400/70 hover:bg-rose-500/10',        text: 'text-rose-300' },
  indigo:  { ring: 'border-indigo-600/40 hover:border-indigo-400/70 hover:bg-indigo-500/10',  text: 'text-indigo-300' },
  lime:    { ring: 'border-lime-600/40 hover:border-lime-400/70 hover:bg-lime-500/10',        text: 'text-lime-300' },
};

interface ModuleItem { icon: string; label: string; desc: string; color: keyof typeof COLOR; cb: Cb; }

function ModuleCard({ it }: { it: ModuleItem }) {
  const c = COLOR[it.color];
  return (
    <button
      onClick={it.cb}
      className={`group relative flex flex-col items-center text-center gap-2 rounded-2xl border bg-panel/50 px-3 py-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${c.ring}`}
    >
      <span className="text-[34px] leading-none transition-transform duration-200 group-hover:scale-110">{it.icon}</span>
      <span className={`text-[15px] font-bold font-mono tracking-wide ${c.text}`}>{it.label}</span>
      <span className="text-[12px] text-dim/55 leading-snug px-1">{it.desc}</span>
    </button>
  );
}

export default function VariableManager({
  onOpenItemManager,
  onOpenPlayerManager,
  onOpenNpcManager,
  onOpenFactionManager,
  onOpenTerritoryManager,
  onOpenTeamManager,
  onOpenCosmosManager,
  onOpenMemoryManager,
  onOpenMiscManager,
  onOpenDiceManager,
  onOpenChannelManager,
  onOpenNovelVecManager,
}: {
  onOpenItemManager?: () => void;
  onOpenPlayerManager?: () => void;
  onOpenNpcManager?: () => void;
  onOpenFactionManager?: () => void;
  onOpenTerritoryManager?: () => void;
  onOpenTeamManager?: () => void;
  onOpenCosmosManager?: () => void;
  onOpenMemoryManager?: () => void;
  onOpenMiscManager?: () => void;
  onOpenDiceManager?: () => void;
  onOpenChannelManager?: () => void;
  onOpenNovelVecManager?: () => void;
}) {
  const GROUPS: { title: string; items: ModuleItem[] }[] = [
    {
      title: '演化系统',
      items: [
        { icon: '🧬', label: '主角演化',   desc: '六维 · 技能 · 天赋 · 身份',  color: 'sky',     cb: onOpenPlayerManager },
        { icon: '🧑‍🤝‍🧑', label: 'NPC 演化', desc: '角色档案 · 登场调度',        color: 'violet',  cb: onOpenNpcManager },
        { icon: '⚔',  label: '物品管理',   desc: '背包 · 装备 · 定价',         color: 'amber',   cb: onOpenItemManager },
        { icon: '🧩', label: '杂项演化',   desc: '任务 · 大事 · 时间天气',      color: 'teal',    cb: onOpenMiscManager },
        { icon: '🏛', label: '势力演化',   desc: '组织 · 帮派 · 阵营',         color: 'orange',  cb: onOpenFactionManager },
        { icon: '🏯', label: '领地演化',   desc: '主神空间个人基地',           color: 'emerald', cb: onOpenTerritoryManager },
        { icon: '🛡', label: '冒险团演化', desc: '主角自有团队',               color: 'cyan',    cb: onOpenTeamManager },
        { icon: '🌌', label: '万族演化',   desc: '宇宙背景层',                 color: 'fuchsia', cb: onOpenCosmosManager },
      ],
    },
    {
      title: '记忆 · 资料',
      items: [
        { icon: '📜', label: '生平压缩',   desc: '角色记忆整理',               color: 'rose',    cb: onOpenMemoryManager },
        { icon: '📚', label: '向量资料库', desc: '原著 + 世界书语义检索',       color: 'fuchsia', cb: onOpenNovelVecManager },
      ],
    },
    {
      title: '社交 · 玩法',
      items: [
        { icon: '📡', label: '公共频道',   desc: '契约者公共广场',             color: 'indigo',  cb: onOpenChannelManager },
        { icon: '🎲', label: 'ROLL 点设置', desc: '骰子判定系统',              color: 'lime',    cb: onOpenDiceManager },
      ],
    },
  ];

  return (
    <div className="min-h-[72vh] flex flex-col items-center justify-center py-8">
      <div className="w-full max-w-5xl">
        {/* 标题 */}
        <div className="text-center mb-9">
          <h2 className="text-xl font-bold text-slate-100 tracking-wide">演化系统 · 功能中心</h2>
          <p className="text-sm text-dim/70 mt-1.5">各模块独立运行，分别配置预设 / API / 调度。点击进入。</p>
        </div>

        {/* 分组网格 */}
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => i.cb);
            if (items.length === 0) return null;
            return (
              <div key={g.title}>
                <div className="flex items-center gap-3 mb-3.5">
                  <span className="text-[12px] font-mono uppercase tracking-[0.25em] text-dim/45">{g.title}</span>
                  <div className="h-px flex-1 bg-edge/50" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
                  {items.map((it) => <ModuleCard key={it.label} it={it} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
