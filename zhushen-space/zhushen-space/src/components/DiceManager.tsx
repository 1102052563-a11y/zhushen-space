import { useState } from 'react';
import { useDice } from '../store/diceStore';
import { useSettings } from '../store/settingsStore';
import { DIFFICULTIES, DIFFICULTY_BASE } from '../systems/diceEngine';

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
          <Row label="判定方式" hint={settings.judgeMode === 'ai' ? '骰子锚定 + AI 裁判（失败自动回退前端）' : '纯前端确定性计算，零调用'}>
            <Seg value={settings.judgeMode} onChange={(v) => setSettings({ judgeMode: v })}
              options={[{ v: 'frontend', label: '前端确定性' }, { v: 'ai', label: 'AI 裁判' }]} />
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
        </div>
      )}

      {tab === 'api' && (
        <div className="space-y-3">
          <Row label="API 来源" hint="AI 裁判用；前端确定性判定不耗 API">
            <Seg value={diceUseShared ? 'shared' : 'own'} onChange={(v) => setDiceUseShared(v === 'shared')}
              options={[{ v: 'shared', label: '共用主 API' }, { v: 'own', label: '独立配置' }]} />
          </Row>

          {diceUseShared ? (
            <div className="text-[13px] font-mono text-dim/60 border border-edge rounded-lg p-3 bg-panel/40">
              当前共用：{sharedApi.baseUrl || '（未配置主 API）'}　模型 {sharedApi.modelId || '—'}
              <div className="text-dim/40 mt-1">也可在「综合设置 → API 接口库」给 featureKey <span className="text-god/70">dice</span> 配多接口轮流+fallback。</div>
            </div>
          ) : (
            <div className="space-y-2 border border-edge rounded-lg p-3 bg-panel/40">
              <Field label="接口地址 baseUrl">
                <input value={diceApi.baseUrl} onChange={(e) => setDiceApi({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className={inputCls} />
              </Field>
              <Field label="API Key">
                <input value={diceApi.apiKey} onChange={(e) => setDiceApi({ apiKey: e.target.value })} type="password" placeholder="sk-…" className={inputCls} />
              </Field>
              <Field label="模型 modelId">
                <div className="flex gap-2">
                  <input value={diceApi.modelId} onChange={(e) => setDiceApi({ modelId: e.target.value })} placeholder="gpt-4o-mini" className={inputCls} />
                  <button onClick={() => void fetchModels()} disabled={modelsLoading}
                    className="shrink-0 px-3 text-sm border border-god/40 text-god rounded-lg hover:bg-god/10 disabled:opacity-40 transition-colors font-mono">
                    {modelsLoading ? '…' : '拉取'}
                  </button>
                </div>
              </Field>
              {modelsError && <div className="text-[12px] text-blood font-mono">{modelsError}</div>}
              {models.length > 0 && (
                <select onChange={(e) => e.target.value && setDiceApi({ modelId: e.target.value })} value=""
                  className={inputCls}>
                  <option value="">— 从已拉取的 {models.length} 个模型选择 —</option>
                  {models.map((m) => <option key={m} value={m} className="bg-void">{m}</option>)}
                </select>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="温度">
                  <input type="number" step={0.1} value={diceApi.temperature} onChange={(e) => setDiceApi({ temperature: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="最大 tokens">
                  <input type="number" value={diceApi.maxTokens} onChange={(e) => setDiceApi({ maxTokens: Number(e.target.value) })} className={inputCls} />
                </Field>
              </div>
              <p className="text-[12px] font-mono text-dim/50">建议挂便宜快的小模型即可；判定只需短 JSON 输出。</p>
            </div>
          )}
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
