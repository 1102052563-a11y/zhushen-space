import { useState } from 'react';
import { useDice } from '../store/diceStore';
import { useSettings } from '../store/settingsStore';
import { DIFFICULTIES, DIFFICULTY_BASE, DEFAULT_TUNING } from '../systems/diceEngine';
import ApiRoutePicker from './ApiRoutePicker';

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-3 py-1 rounded-lg border text-sm font-mono transition-colors ${value === o.v ? 'bg-god/10 border-god/50 text-god' : 'border-edge text-dim hover:text-slate-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-edge/40">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="text-[12px] font-mono text-dim/50 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
const numInput = 'w-20 bg-panel border border-edge rounded px-2 py-1 text-sm text-slate-200 font-mono text-center outline-none focus:border-god/50';

function TuneSlider({ label, hint, min, max, step, value, onChange }:
  { label: string; hint: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-edge/40">
      <span className="w-24 shrink-0 text-sm text-slate-300">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-god" />
      <span className="w-28 shrink-0 text-right text-[12px] font-mono text-dim/60">{hint}</span>
    </div>
  );
}

export default function DiceManager() {
  const settings = useDice((s) => s.settings);
  const setSettings = useDice((s) => s.setSettings);
  const setDiffOverride = useDice((s) => s.setDiffOverride);
  const diceApi = useDice((s) => s.diceApi);
  const diceUseShared = useDice((s) => s.diceUseSharedApi);
  const setDiceApi = useDice((s) => s.setDiceApi);
  const setDiceUseShared = useDice((s) => s.setDiceUseSharedApi);
  const models = useDice((s) => s.diceAvailableModels);
  const modelsLoading = useDice((s) => s.diceModelsLoading);
  const modelsError = useDice((s) => s.diceModelsError);
  const fetchModels = useDice((s) => s.fetchDiceModels);
  const sharedApi = useSettings((s) => (s.textUseSharedApi ? s.api : s.textApi));

  const [tab, setTab] = useState<'check' | 'api'>('check');

  return (
    <div className="space-y-4">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">🎲 ROLL 点设置</h2>
        <p className="text-sm text-dim mt-0.5">自定义摇骰检定的规则、数值与判定方式。掷骰纯前端计算；API 仅 AI 裁判用。</p>
      </div>

      <div className="flex gap-1">
        {([['check', '检定设置'], ['api', 'API 设置']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1 rounded text-sm font-mono border transition-colors ${tab === k ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'check' && (
        <div className="space-y-1">
          <Row label="🎯 自动检定（发送即判定）" hint={settings.autoMode ? '发送消息时自动判断是否需要 ROLL：关键词命中才掷骰，结果只喂正文AI（读者不可见）+ 气泡下弹骰子卡；判定方式沿用下方设置' : '关闭：仅在手动打开骰子面板、点摇骰后注入'}>
            <Toggle checked={settings.autoMode} onChange={() => setSettings({ autoMode: !settings.autoMode })} />
          </Row>
          <Row label="判定方式" hint={
            settings.judgeMode === 'ai-full' ? 'AI 全包：数值+成败全交 AI 估算（仿插件·放弃代码确定性·失败回退前端）'
              : settings.judgeMode === 'ai' ? '骰子锚定 + AI 裁判（前端算数值·AI 只裁定·失败回退前端）'
                : '纯前端确定性计算，零调用'}>
            <Seg value={settings.judgeMode} onChange={(v) => setSettings({ judgeMode: v })}
              options={[{ v: 'frontend', label: '前端确定性' }, { v: 'ai', label: 'AI 裁判' }, { v: 'ai-full', label: 'AI 全包' }]} />
          </Row>
          <Row label="骰子模式" hint={settings.mode === 'd20' ? '1d20 + 修正 ≥ DC' : '1d100 ≤ 成功率'}>
            <Seg value={settings.mode} onChange={(v) => setSettings({ mode: v })}
              options={[{ v: 'd20', label: 'DND d20' }, { v: 'd100', label: 'CoC 百分骰' }]} />
          </Row>
          <Row label="幸运修正计入" hint="六维的幸运是否参与检定修正">
            <Toggle checked={settings.includeLuck} onChange={() => setSettings({ includeLuck: !settings.includeLuck })} />
          </Row>
          <Row label="摇骰动画时长" hint="毫秒；常驻无跳过开关">
            <input type="number" min={0} max={3000} step={20} value={settings.animMs}
              onChange={(e) => setSettings({ animMs: Math.max(0, Math.min(3000, Number(e.target.value) || 0)) })} className={numInput} />
          </Row>

          <div className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-200">难度基础值</div>
              <div className="text-[12px] font-mono text-dim/50">百分骰成功率 / d20 目标 DC（留空恢复默认）</div>
            </div>
            <div className="space-y-1.5">
              {DIFFICULTIES.map((d) => {
                const ov = settings.diffOverride[d];
                const eff = ov ?? DIFFICULTY_BASE[d];
                const isOv = !!ov;
                return (
                  <div key={d} className="flex items-center gap-3 text-sm">
                    <span className="w-24 text-slate-300">{d}</span>
                    <label className="flex items-center gap-1 text-[12px] font-mono text-dim/60">
                      率
                      <input type="number" value={eff.rate}
                        onChange={(e) => setDiffOverride(d, { rate: Number(e.target.value) || 0, dc: eff.dc })} className={numInput} />
                    </label>
                    <label className="flex items-center gap-1 text-[12px] font-mono text-dim/60">
                      DC
                      <input type="number" value={eff.dc}
                        onChange={(e) => setDiffOverride(d, { rate: eff.rate, dc: Number(e.target.value) || 0 })} className={numInput} />
                    </label>
                    {isOv && (
                      <button onClick={() => setDiffOverride(d, null)}
                        className="text-[12px] font-mono text-dim hover:text-blood border border-edge rounded px-2 py-0.5 transition-colors">恢复默认</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-200">加成调参 · 防碾压</div>
              <button onClick={() => setSettings({ tuning: { ...DEFAULT_TUNING } })}
                className="text-[12px] font-mono text-dim hover:text-blood border border-edge rounded px-2 py-0.5 transition-colors">恢复默认</button>
            </div>
            <p className="text-[12px] font-mono text-dim/50 mb-2">
              技能/天赋/装备走「递减收益 + 封顶」：最强几项有用、堆数量无效。封顶越低、递减越狠 → 越难被装备池碾压（d20 尺度；百分骰自动 ×4）。
            </p>
            <div className="space-y-1">
              <TuneSlider label="技能封顶" hint={`+${settings.tuning.skillCap}　默认 +${DEFAULT_TUNING.skillCap}`} min={1} max={12} step={1}
                value={settings.tuning.skillCap} onChange={(v) => setSettings({ tuning: { ...settings.tuning, skillCap: v } })} />
              <TuneSlider label="天赋封顶" hint={`+${settings.tuning.talentCap}　默认 +${DEFAULT_TUNING.talentCap}`} min={1} max={12} step={1}
                value={settings.tuning.talentCap} onChange={(v) => setSettings({ tuning: { ...settings.tuning, talentCap: v } })} />
              <TuneSlider label="装备封顶" hint={`+${settings.tuning.equipCap}　默认 +${DEFAULT_TUNING.equipCap}`} min={1} max={10} step={1}
                value={settings.tuning.equipCap} onChange={(v) => setSettings({ tuning: { ...settings.tuning, equipCap: v } })} />
              <TuneSlider label="递减强度" hint={`${settings.tuning.decay.toFixed(2)}　越小越狠`} min={0.3} max={0.9} step={0.05}
                value={settings.tuning.decay} onChange={(v) => setSettings({ tuning: { ...settings.tuning, decay: v } })} />
            </div>
          </div>
        </div>
      )}

      {tab === 'api' && (
        <div className="space-y-3">
          <ApiRoutePicker routeKey="dice" />
          <p className="text-[12px] font-mono text-dim/50">↑ 直接选用「API 接口库」里集中管理的接口（多选·按优先级轮流调用，失败自动切下一条）。留空则回退正文 API。仅 AI 裁判用，前端确定性判定不耗 API。</p>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-god/50';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[12px] font-mono text-dim/60">{label}</span>
      {children}
    </label>
  );
}
