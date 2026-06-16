/* 变量管理页 → 演化系统 · 功能中心
   原本是自定义变量编辑器（基本不用）+ 顶部一排挤在右上角的功能入口；
   现改为「居中、放大、分组」的模块卡片启动台。各模块仍是独立子面板（预设/API/调度）。 */
import { useState, useRef } from 'react';
import { downloadGlobalConfig, importGlobalConfig } from '../systems/configExport';

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
  pink:    { ring: 'border-pink-600/40 hover:border-pink-400/70 hover:bg-pink-500/10',        text: 'text-pink-300' },
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

/* 配置备份 / 迁移：把所有功能的预设·世界书·正文预设·正则·API·生图·向量库·角色模板一键导出成一个 JSON，
   可在别的设备/浏览器导入整套配置。只含配置、不含游戏进度（NPC/背包/剧情等），导入也不会覆盖当前存档进度。 */
function ConfigBackupBar() {
  const [includeKeys, setIncludeKeys] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';   // 允许重复选同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      if (!window.confirm(
        '导入将覆盖当前所有功能的「预设 / 世界书 / 正文预设 / 正则 / API 设置」。\n' +
        '不会影响 NPC、背包、剧情、主角属性等游戏进度。\n\n' +
        '建议先点「导出」备份当前配置。确定继续导入？',
      )) return;
      const r = importGlobalConfig(raw);
      setErr(!r.ok);
      setMsg(r.message + (r.ok && r.skipped && r.skipped.length ? `（文件未含：${r.skipped.join('、')}）` : ''));
    };
    reader.onerror = () => { setErr(true); setMsg('读取文件失败'); };
    reader.readAsText(file);
  }

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3 mb-3.5">
        <span className="text-[12px] font-mono uppercase tracking-[0.25em] text-dim/45">配置备份 · 迁移</span>
        <div className="h-px flex-1 bg-edge/50" />
      </div>
      <div className="rounded-2xl border border-edge bg-panel/50 p-5 space-y-4">
        <p className="text-[13px] text-dim/70 leading-relaxed">
          一键导出 / 导入<span className="text-god">全部功能的预设、世界书、正文预设、正则、API 设置、生图模板、向量库参数、角色创建模板</span>。
          <br />
          只打包<span className="text-dim/90">配置</span>，<span className="text-dim/90">不含</span>游戏进度（NPC 档案 / 背包 / 剧情 / 主角属性等）；导入也<span className="text-dim/90">不会覆盖</span>当前存档进度。换设备、换浏览器或分享整套配置时用。
        </p>

        <label className="flex items-center gap-2 text-[13px] text-dim/80 cursor-pointer select-none w-fit">
          <input type="checkbox" checked={includeKeys} onChange={(e) => setIncludeKeys(e.target.checked)} className="accent-god" />
          导出时包含 API 密钥
          <span className="text-dim/45">{includeKeys ? '（方便自用迁移，请勿公开分享此文件）' : '（适合分享，导入方需重填各接口 Key）'}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => downloadGlobalConfig(includeKeys)}
            className="px-4 py-2 rounded-lg border border-god/40 text-god text-sm font-mono hover:bg-god/10 transition-colors"
          >
            ⬇ 导出全局配置
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg border border-edge text-dim text-sm font-mono hover:border-god/40 hover:text-god transition-colors"
          >
            ⬆ 导入 (.json)
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onPickFile} className="hidden" />
          {msg && <span className={`text-[12px] ${err ? 'text-rose-400' : 'text-emerald-400'}`}>{msg}</span>}
        </div>
      </div>
    </div>
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
  onOpenCombatManager,
  onOpenArenaManager,
  onOpenEnhanceManager,
  onOpenJoyManager,
  onOpenChannelManager,
  onOpenNovelVecManager,
  onOpenWorldCodexManager,
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
  onOpenCombatManager?: () => void;
  onOpenArenaManager?: () => void;
  onOpenEnhanceManager?: () => void;
  onOpenJoyManager?: () => void;
  onOpenChannelManager?: () => void;
  onOpenNovelVecManager?: () => void;
  onOpenWorldCodexManager?: () => void;
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
        { icon: '📖', label: '世界百科',   desc: '同人世界原著情报 · 先知',      color: 'indigo',  cb: onOpenWorldCodexManager },
      ],
    },
    {
      title: '社交 · 玩法',
      items: [
        { icon: '📡', label: '公共频道',   desc: '契约者公共广场',             color: 'indigo',  cb: onOpenChannelManager },
        { icon: '🎲', label: 'ROLL 点设置', desc: '骰子判定系统',              color: 'lime',    cb: onOpenDiceManager },
        { icon: '⚔️', label: '战斗系统',   desc: '回合制战斗 · 结算 · 预设',    color: 'rose',    cb: onOpenCombatManager },
        { icon: '🏟', label: '竞技场',     desc: '阶位榜单 · 挑战 · 奖励',      color: 'amber',   cb: onOpenArenaManager },
        { icon: '⚒', label: '装备强化',   desc: '强化等级 · 看板娘 · 保底',    color: 'amber',   cb: onOpenEnhanceManager },
        { icon: '💗', label: '欢愉宫',     desc: '看板娘 · 情欲值 · 四阶段',    color: 'pink',    cb: onOpenJoyManager },
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

        <ConfigBackupBar />
      </div>
    </div>
  );
}
