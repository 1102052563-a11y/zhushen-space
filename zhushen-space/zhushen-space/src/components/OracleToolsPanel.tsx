import { useState } from 'react';
import ApiRoutePicker from './ApiRoutePicker';
import StoryArcPanel from './StoryArcPanel';
import StateDoctorPanel from './StateDoctorPanel';
import { POLISH_GOALS, loadPolishPrefs, savePolishPrefs, type PolishStrength } from '../systems/polish';

/* 🔮 剧情工具 · 集中设置页（story-oracle 借鉴四件套的专属页面·变量管理「剧情工坊」卡片打开）：
   - 🧭 故事弧线 / 🩺 状态诊断：整个功能面板就在页内（复用组件·默认展开）；
   - ✨ 正文校正：这里管默认偏好（五目标+力度·与弹窗共用 drpg-polish-prefs）+ 接口路由；入口仍在楼层操作行；
   - 🧭 参谋：接口路由 + 入口指路；
   - 四条提示词在「预设中心」可改（页脚指路）。
   零 App 布线：由 VariableManager 本地 state 打开，overlay 渲染在其子树内。 */
export default function OracleToolsPanel({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState(loadPolishPrefs);

  const toggleGoal = (id: string) => setPrefs((p) => {
    const goals = p.goals.includes(id) ? p.goals.filter((g) => g !== id) : [...p.goals, id];
    const next = { ...p, goals };
    savePolishPrefs(next);
    return next;
  });
  const pickStrength = (s: PolishStrength) => setPrefs((p) => { const next = { ...p, strength: s }; savePolishPrefs(next); return next; });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl h-[88dvh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🔮</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100">剧情工具</div>
            <div className="text-[12px] font-mono text-dim/60">故事弧线 · 状态诊断 · 正文校正 · 参谋 —— 集中设置（借鉴 story-oracle）</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {/* 🧭 故事弧线（完整功能面板·默认展开） */}
          <StoryArcPanel defaultOpen />

          {/* 🩺 状态诊断（完整功能面板·默认展开） */}
          <StateDoctorPanel defaultOpen />

          {/* ✨ 正文校正 · 默认偏好 */}
          <div className="mt-6 rounded-xl border border-edge/50 bg-black/20 p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-200">✨ 正文校正 · 默认偏好</span>
              <span className="text-[11px] text-dim/60">入口在楼层操作行「✨ 正文校正」；这里改默认勾选与力度，弹窗里也能临时调（同一份偏好）</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
              {POLISH_GOALS.map((g) => (
                <label key={g.id} className="flex items-center gap-1.5 cursor-pointer select-none" title={g.directive}>
                  <input type="checkbox" checked={prefs.goals.includes(g.id)} onChange={() => toggleGoal(g.id)} className="accent-god" />
                  <span className={prefs.goals.includes(g.id) ? 'text-slate-200' : 'text-dim/60'}>{g.label}</span>
                </label>
              ))}
              <span className="ml-auto flex items-center gap-1 text-[12px] font-mono">
                <button onClick={() => pickStrength('light')}
                  className={`px-2 py-0.5 rounded border transition ${prefs.strength === 'light' ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-300'}`}>轻校</button>
                <button onClick={() => pickStrength('deep')}
                  className={`px-2 py-0.5 rounded border transition ${prefs.strength === 'deep' ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-300'}`}>精校</button>
              </span>
            </div>
            <details>
              <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">⚡ 校正接口路由（可空=用正文 API）</summary>
              <div className="mt-2"><ApiRoutePicker routeKey="polish" /></div>
            </details>
          </div>

          {/* 🧭 参谋 */}
          <div className="mt-6 rounded-xl border border-edge/50 bg-black/20 p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-200">🧭 参谋 · 局外商量</span>
              <span className="text-[11px] text-dim/60">入口在右侧导航「参谋」；能问剧情问答（为什么/现状/怎么办），也出任务/伏笔/历提案卡</span>
            </div>
            <details>
              <summary className="cursor-pointer select-none text-[12px] font-mono text-dim/60 hover:text-dim">⚡ 参谋接口路由（可空=跟随「杂项演化」接口）</summary>
              <div className="mt-2"><ApiRoutePicker routeKey="advisor" /></div>
            </details>
          </div>

          <div className="mt-6 text-[11px] text-dim/50 leading-snug">
            📝 四条提示词（校正规则 / 军医规则 / 分拍规划 / 每拍导演指令）在 设置 → <b className="text-dim/70">预设中心</b> 的「正文前置 / 规划」组可改、可恢复默认，随提示词包导出导入。
          </div>
        </div>
      </div>
    </div>
  );
}
