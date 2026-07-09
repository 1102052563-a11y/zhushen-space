import { useEffect, useRef, useState } from 'react';
import { useEnhance, hydrateEnhancePortraits } from '../store/enhanceStore';
import { shrinkDataUrl } from '../systems/imageGen';
import { MAX_ENHANCE, DEFAULT_BOSSES, type BossDef } from '../systems/enhanceEngine';
import ApiRoutePicker from './ApiRoutePicker';
import { useSettings, resolveApiChain } from '../store/settingsStore';

/* 装备强化系统配置：老板名册（立绘/性格/加成）+ 率表/费用 + 独立 API。
   挂在 设置→变量管理→装备强化。属全局配置（走 configExport，立绘存 IndexedDB）。 */

const inputCls = 'bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-god/40';

function NumField({ label, value, onChange, step = 1, min, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-mono text-dim/50">{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" value={value} step={step} min={min}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${inputCls} w-full font-mono`} />
        {suffix && <span className="text-[11px] font-mono text-dim/40 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

function BossCard({ boss, onEditPreset }: { boss: BossDef; onEditPreset: () => void }) {
  const upsertBoss = useEnhance((s) => s.upsertBoss);
  const removeBoss = useEnhance((s) => s.removeBoss);
  const setBossPortrait = useEnhance((s) => s.setBossPortrait);
  const bossCount = useEnhance((s) => s.settings.bosses.length);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<BossDef>) => upsertBoss({ ...boss, ...p });

  const onFile = async (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const shrunk = await shrinkDataUrl(String(reader.result), 768, 0.85);
        setBossPortrait(boss.id, shrunk);
      } catch { setBossPortrait(boss.id, String(reader.result)); }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-3 flex max-lg:flex-col gap-3">
      {/* 立绘 */}
      <div className="shrink-0 w-24 flex flex-col gap-1.5">
        <div className="w-24 h-32 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center">
          {boss.portrait
            ? <img src={boss.portrait} alt={boss.name} className="w-full h-full object-cover" />
            : <span className="text-4xl text-dim/30">{boss.gender === '女' ? '🙎‍♀️' : '🧔'}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <button onClick={() => fileRef.current?.click()} className="text-[11px] font-mono py-1 rounded border border-edge text-dim hover:text-slate-100 hover:border-god/40">上传立绘</button>
        {boss.portrait && <button onClick={() => setBossPortrait(boss.id, undefined)} className="text-[11px] font-mono py-0.5 rounded text-blood/60 hover:text-blood">清除</button>}
      </div>

      {/* 字段 */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={boss.name} onChange={(e) => patch({ name: e.target.value })} placeholder="老板名" className={`${inputCls} flex-1 font-semibold`} />
          <select value={boss.gender} onChange={(e) => patch({ gender: e.target.value as BossDef['gender'] })} className={inputCls}>
            <option value="女">♀ 女</option>
            <option value="男">♂ 男</option>
            <option value="">其他</option>
          </select>
          {bossCount > 1 && <button onClick={() => removeBoss(boss.id)} className="text-blood/60 hover:text-blood text-sm px-1" title="删除该老板">✕</button>}
        </div>
        <textarea value={boss.persona} onChange={(e) => patch({ persona: e.target.value })} rows={2}
          placeholder="性格短描述（卡片展示 + 吐槽兜底）"
          className={`${inputCls} w-full resize-none leading-snug`} />
        <button onClick={onEditPreset}
          className="w-full text-left text-[12px] font-mono px-2 py-1.5 rounded-lg border border-god/30 text-god/90 bg-god/5 hover:bg-god/10 transition-colors">
          ✎ 对话预设 {boss.banterPreset?.trim() ? '（已自定义 · 点击编辑）' : '（默认 / 未设 · 点击编辑）'}
        </button>
        <input value={boss.portraitFolder ?? ''} onChange={(e) => patch({ portraitFolder: e.target.value.trim() || undefined })}
          placeholder="分阶段立绘文件夹名（仓库根 图片/<此名>/阶段1..4/）— 留空则用上方上传的单张立绘"
          className={`${inputCls} w-full font-mono text-[12px]`} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <NumField label="花费倍率" value={boss.costMul} step={0.05} min={0} onChange={(v) => patch({ costMul: v })} suffix="×" />
          <NumField label="实际率加成" value={Math.round(boss.rateAdd * 100)} step={1} onChange={(v) => patch({ rateAdd: v / 100 })} suffix="%" />
          <NumField label="明面虚标" value={Math.round(boss.displayLie * 100)} step={1} onChange={(v) => patch({ displayLie: v / 100 })} suffix="%" />
          <NumField label="暴击跳级" value={Math.round(boss.critJump * 100)} step={1} min={0} onChange={(v) => patch({ critJump: v / 100 })} suffix="%" />
        </div>
        <div className="text-[10px] font-mono text-dim/35 leading-tight">
          明面虚标&gt;0 = 显示率高于实际（凯莉型）；暴击跳级=成功时额外再 +1 的概率。失败分区（降级 / 归零 / 分解）为全局设置，见下方「费用与概率」。
        </div>
      </div>
    </div>
  );
}

/* 老板对话预设·模态编辑器（不占卡片空间，点击弹出独立编辑界面）*/
function BanterPresetModal({ boss, onClose }: { boss: BossDef; onClose: () => void }) {
  const upsertBoss = useEnhance((s) => s.upsertBoss);
  const [text, setText] = useState(boss.banterPreset ?? '');
  const dflt = DEFAULT_BOSSES.find((d) => d.id === boss.id)?.banterPreset ?? '';
  const save = () => { upsertBoss({ ...boss, banterPreset: text.trim() || undefined }); onClose(); };
  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[88dvh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-edge bg-panel">
          <span className="text-base">✎</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{boss.name} · 对话预设</div>
            <div className="text-[11px] font-mono text-dim/50">设计该强化师「点立绘吐槽」时的说话风格</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          <p className="text-[12px] text-dim/60 leading-relaxed">
            写这个老板的说话风格 / 人设 / 语气。可写<strong>分阶段</strong>（强化 +0~3=阶段1 / +4~6=2 / +7~9=3 / +10+=4，系统每次会告诉它当前第几阶段）。
            留空则回退「性格描述 + 内置默认阶段语气」。系统已自动注入当前强化实况（连败 / 成功 / 花费 / 垫子计数 / 装备），不必在预设里重复。
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
            placeholder={'例：\n你是XX本人——（性格/口吻）。随强化进度：\n· 阶段1：…\n· 阶段2：…\n· 阶段3：…\n· 阶段4：…'}
            className="w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 leading-relaxed resize-y focus:outline-none focus:border-god/40 font-mono" />
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-edge bg-panel">
          {dflt && <button onClick={() => setText(dflt)} className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">取消</button>
          <button onClick={save} className="text-[13px] font-mono py-1.5 px-4 rounded-lg border border-god/50 text-god bg-god/10 hover:bg-god/20">保存</button>
        </footer>
      </div>
    </div>
  );
}

export default function EnhanceManager() {
  const settings   = useEnhance((s) => s.settings);
  const setSettings = useEnhance((s) => s.setSettings);
  const upsertBoss = useEnhance((s) => s.upsertBoss);
  const resetBosses = useEnhance((s) => s.resetBosses);
  const tables     = useEnhance((s) => s.settings.tables);
  const setTables  = useEnhance((s) => s.setTables);
  const resetTables = useEnhance((s) => s.resetTables);
  const pity       = useEnhance((s) => s.pity);
  const setPity    = useEnhance((s) => s.setPity);

  const enhanceApi = useEnhance((s) => s.enhanceApi);
  const useShared  = useEnhance((s) => s.enhanceUseSharedApi);

  // 读数：吐槽/收尾**实际**会调用的接口（与 App 里收尾/吐槽 resolveApiChain('enhance', …) 完全一致）。
  // 订阅 apiRoutes/apiLibrary，路由选择器一改就刷新——让你不用翻后台就能看到真正生效的模型。
  const _routes = useSettings((s) => s.apiRoutes);
  const _lib = useSettings((s) => s.apiLibrary);
  const _textApi = useSettings((s) => s.textApi);
  const _mainApi = useSettings((s) => s.api);
  const _textShared = useSettings((s) => s.textUseSharedApi);
  void _routes; void _lib;
  const effChain = resolveApiChain('enhance', useShared ? (_textShared ? _mainApi : _textApi) : enhanceApi);
  const effModel = effChain[0]?.modelId || '（未配置）';
  const effHost = (() => { const u = effChain[0]?.baseUrl; if (!u) return ''; try { return new URL(u).host; } catch { return u; } })();

  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { hydrateEnhancePortraits(); }, []);

  const addBoss = () => {
    const id = `boss_${Date.now()}`;
    upsertBoss({ id, name: '新强化师', gender: '女', persona: '', costMul: 1, rateAdd: 0, displayLie: 0, critJump: 0 });
  };

  const setBaseAt = (i: number, v: number) => {
    const base = [...tables.base];
    base[i] = Math.max(0, Math.min(1, v / 100));
    setTables({ base });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100">装备强化系统</h3>
        <p className="text-[13px] text-dim/60 mt-1 leading-relaxed">
          仅乐园内（轮回乐园/专属房间）可用。强化等级 +0~+{MAX_ENHANCE}，越高成功率越低；+0~+6 失败概率降级，+7 起失败损毁装备。
          垫子计数仅在<strong>爆装</strong>后累加，满 10 下次必成。在此配置强化师（看板娘）与费用率表。
          <br />立绘可<strong>分阶段</strong>：把图放进仓库根 <code className="text-amber-300/80">图片/&lt;老板名&gt;/阶段1~4/</code>，强化 +1~3 用阶段1、+4~6 阶段2、+7~9 阶段3、+10 及以上阶段4，每次强化随机换一张（build/启动时自动同步，空阶段就近回退）。
        </p>
      </div>

      {/* 启用 + 垫子计数 */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用装备强化</div>
          <div className="text-[12px] text-dim/55 mt-0.5">关闭后强化所只能查看、不能强化</div>
        </div>
        <button onClick={() => setSettings({ enabled: !settings.enabled })}
          className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${settings.enabled ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: settings.enabled ? 'translateX(16px)' : 'none' }} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">当前垫子计数（账号级）</div>
          <div className="text-[12px] text-dim/55 mt-0.5">爆装攒满 10 触发保底；可手动校准</div>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={0} value={pity} onChange={(e) => setPity(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={`${inputCls} w-16 font-mono text-center`} />
          <button onClick={() => setPity(0)} className="text-[12px] font-mono py-1 px-2 rounded border border-edge text-dim hover:text-slate-100">清零</button>
        </div>
      </div>

      {/* 老板名册 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">强化师 / 看板娘（{settings.bosses.length}）</span>
          <div className="flex items-center gap-2">
            <button onClick={addBoss} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-god/40 text-god hover:bg-god/10">+ 新增</button>
            <button onClick={resetBosses} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>
          </div>
        </div>
        {settings.bosses.map((b) => <BossCard key={b.id} boss={b} onEditPreset={() => setEditId(b.id)} />)}
      </div>

      {/* 率表 / 费用 */}
      <div className="space-y-3 rounded-xl border border-edge bg-panel p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">费用与概率</span>
          <button onClick={resetTables} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认率表</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <NumField label="降级下限" value={tables.downgradeFloor} step={1} min={1} onChange={(v) => setTables({ downgradeFloor: Math.max(1, Math.round(v)) })} suffix="+起降级" />
          <NumField label="归零下限" value={tables.resetFloor} step={1} min={1} onChange={(v) => setTables({ resetFloor: Math.max(1, Math.round(v)) })} suffix="+起归零" />
          <NumField label="分解下限" value={tables.destroyFloor} step={1} min={1} onChange={(v) => setTables({ destroyFloor: Math.max(1, Math.round(v)) })} suffix="+起爆" />
          <NumField label="强化费基数" value={tables.costBase} step={50} min={0} onChange={(v) => setTables({ costBase: v })} suffix="🪙" />
          <NumField label="强化费指数" value={tables.costPow} step={0.1} min={1} onChange={(v) => setTables({ costPow: v })} />
          <NumField label="保护石基数" value={tables.protectBase} step={100} min={0} onChange={(v) => setTables({ protectBase: v })} suffix="🪙" />
          <NumField label="保护石指数" value={tables.protectPow} step={0.1} min={1} onChange={(v) => setTables({ protectPow: v })} />
          <NumField label="强化符基数" value={tables.amuletBase} step={100} min={0} onChange={(v) => setTables({ amuletBase: v })} suffix="🪙" />
          <NumField label="强化符指数" value={tables.amuletPow} step={0.1} min={1} onChange={(v) => setTables({ amuletPow: v })} />
          <NumField label="强化符加率" value={Math.round(tables.amuletRateAdd * 100)} step={1} min={0} onChange={(v) => setTables({ amuletRateAdd: Math.max(0, Math.min(1, v / 100)) })} suffix="%" />
        </div>
        <details>
          <summary className="text-[12px] font-mono text-dim/50 cursor-pointer hover:text-slate-200">各等级基础成功率（高级，+L → +L+1，%）</summary>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mt-2">
            {tables.base.map((r, i) => (
              <label key={i} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-mono text-dim/40">+{i}→{i + 1}</span>
                <input type="number" min={0} max={100} value={Math.round(r * 100)} onChange={(e) => setBaseAt(i, Number(e.target.value))}
                  className={`${inputCls} w-full text-center font-mono px-1 ${i >= tables.destroyFloor ? 'text-rose-400/90' : i >= tables.resetFloor ? 'text-orange-300/90' : i >= tables.downgradeFloor ? 'text-amber-300/80' : 'text-emerald-300/70'}`} />
              </label>
            ))}
          </div>
          <div className="text-[10px] font-mono text-dim/35 mt-1">绿=必成 · 琥珀=失败降级 · 橙=失败归零 · 红=失败分解(爆)。</div>
        </details>
      </div>

      {/* API */}
      <div className="space-y-2.5 rounded-xl border border-edge bg-panel p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">吐槽 / 收尾 API</span>
        </div>
        <ApiRoutePicker routeKey="enhance" />
        <p className="text-[11px] font-mono text-dim/50">↑ 选用「API 接口库」里集中管理的接口（多选·按优先级轮流调用·失败自动切下一条）。留空则用下方兜底配置。</p>
        <div className="text-[11.5px] font-mono rounded-lg border border-god/25 bg-god/5 px-2.5 py-1.5 leading-snug">
          <span className="text-dim/50">✦ 吐槽 / 收尾实际调用：</span>
          <span className="text-god/90 font-bold">{effModel}</span>
          {effHost && <span className="text-dim/40"> @ {effHost}</span>}
          {effChain.length > 1 && <span className="text-dim/40"> (+{effChain.length - 1} 条备用)</span>}
          <span className="block text-dim/35 mt-0.5">优先级：接口库路由 ＞ 正文 API 兜底（路由选了就以路由为准）</span>
        </div>
        <div className="text-[11px] font-mono text-dim/40 leading-snug">
          用于「点立绘吐槽」和「停止强化后刷新装备词缀」。
        </div>
      </div>

      {editId && (() => {
        const b = settings.bosses.find((x) => x.id === editId);
        return b ? <BanterPresetModal boss={b} onClose={() => setEditId(null)} /> : null;
      })()}
    </div>
  );
}
