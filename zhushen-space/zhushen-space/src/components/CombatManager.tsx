import { useState } from 'react';
import { useCombat } from '../store/combatStore';
import { buildCombatant, assembleBattle } from '../systems/combatEngine';
import ApiRoutePicker from './ApiRoutePicker';

/* 战斗系统设置页（变量管理 → ⚔️战斗系统）：开关 + 四阶段提示词预设 + 独立 API + 🧪测试战斗 */

// 战斗系统重置后：战斗中 0 次 API（敌人本地 AI 决策、标签 VM 结算），只在战斗结束据 BATTLE_RECORD 战报润色一次。
const PHASE_FIELDS: { key: 'summaryPrompt'; label: string; hint: string }[] = [
  { key: 'summaryPrompt', label: '战斗叙事润色', hint: '战斗结束后据 BATTLE_RECORD 战报一次性润色成正文（留空=内置默认）' },
];

export default function CombatManager() {
  const config = useCombat((s) => s.config);
  const setConfig = useCombat((s) => s.setConfig);
  const getActivePreset = useCombat((s) => s.getActivePreset);
  const setActivePreset = useCombat((s) => s.setActivePreset);
  const addPreset = useCombat((s) => s.addPreset);
  const updatePreset = useCombat((s) => s.updatePreset);
  const deletePreset = useCombat((s) => s.deletePreset);
  const setBattle = useCombat((s) => s.setBattle);
  const battleActive = useCombat((s) => s.battle.active);

  const preset = getActivePreset();
  const [testMsg, setTestMsg] = useState('');

  function startTest() {
    if (battleActive) { setTestMsg('已有战斗进行中'); return; }
    const b1 = buildCombatant('B1', 'player');
    const enemy = buildCombatant('combat_test_dummy', 'enemy', {
      isTransient: true, name: '试炼傀儡', tier: '二阶', bioStrength: 'T2·二阶',
      attrs: { str: 40, agi: 35, con: 50, int: 10, cha: 5, luck: 3 },
    });
    const battle = assembleBattle(
      { B1: b1, combat_test_dummy: enemy },
      { reason: '试炼场切磋', location: '轮回乐园·试炼场', endConditions: ['击败试炼傀儡'] },
      config.manualAllyControl,
    );
    battle.log = [{ id: `clog_open_${Date.now()}`, round: 0, type: 'opening', text: '', narration: '试炼傀儡缓缓抬起手臂，战斗开始。', timestamp: Date.now() }];
    setBattle(battle);
    setTestMsg('已开始测试战斗（看屏幕中央的战斗面板）');
  }

  const card = 'rounded-lg border border-edge bg-panel/60 p-4';

  return (
    <div className="space-y-4 max-w-2xl mx-auto text-slate-300">
      {/* 说明 + 测试 */}
      <div className={card}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-300">从右侧导航「⚔️战斗」按钮选当前在场 NPC 发起战斗；打完后战斗结果会写进输入框，由你确认/编辑后点发送续写正文。</span>
          <button onClick={startTest} className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm shrink-0">🧪 测试战斗</button>
        </div>
        {testMsg && <div className="text-xs text-amber-300 mt-2">{testMsg}</div>}
      </div>

      {/* 规则开关 */}
      <div className={card}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.manualAllyControl} onChange={(e) => setConfig({ manualAllyControl: e.target.checked })} />
          <span>手动控制队友（默认 AI 托管）</span>
        </label>
      </div>

      {/* 四阶段提示词预设 */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium text-slate-200">提示词预设</span>
          <select value={config.activePresetId} onChange={(e) => setActivePreset(e.target.value)}
            className="bg-void border border-edge rounded px-2 py-1 text-sm">
            {config.savedPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addPreset} className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600">+ 复制为自定义</button>
          {!preset.isBuiltIn && (
            <button onClick={() => deletePreset(preset.id)} className="px-2 py-1 text-xs rounded bg-rose-900/60 hover:bg-rose-800">删除</button>
          )}
        </div>
        {preset.isBuiltIn && <div className="text-[11px] text-amber-300/80 mb-2">内置预设只读；点「+ 复制为自定义」后可编辑各阶段提示词。</div>}
        <div className="space-y-3">
          {PHASE_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs text-slate-300">{f.label}</span>
              <span className="block text-[10px] text-dim mb-1">{f.hint}</span>
              <textarea
                value={preset[f.key]} readOnly={preset.isBuiltIn}
                onChange={(e) => updatePreset(preset.id, { [f.key]: e.target.value })}
                placeholder="（留空 = 使用内置默认规则）"
                rows={3}
                className="w-full bg-void border border-edge rounded px-2 py-1 text-xs font-mono resize-y disabled:opacity-50" />
            </label>
          ))}
        </div>
      </div>

      {/* API */}
      <div className={card}>
        <ApiRoutePicker routeKey="combat" />
        <div className="mt-2 text-[11px] text-dim">从「综合设置 → API 接口库」勾选接口走集成路由（多选按优先级轮流、失败自动 fallback）。留空则回退正文 API。</div>
      </div>
    </div>
  );
}
