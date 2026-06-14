import { useSettings, endpointToConfig, type ApiConfig } from '../store/settingsStore';

/* 快捷选择：从「综合设置 → API 接口库」一键填入当前功能的 API 配置。
   放在各功能 ApiSection 顶部，省去每个功能手动重填。 */
export default function ApiQuickPick({ onPick, className = '' }: { onPick: (cfg: ApiConfig) => void; className?: string }) {
  const library = useSettings((s) => s.apiLibrary);
  const enabled = (library ?? []).filter((e) => e.enabled);

  if ((library ?? []).length === 0) {
    return (
      <div className={`text-[12px] font-mono text-dim/40 ${className}`}>
        接口库为空 —— 可在「综合设置 → API 接口库」添加后在此快捷选填。
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[12px] font-mono text-god/60 shrink-0">⚡ 接口库快捷填入</span>
      <select
        value=""
        onChange={(e) => {
          const ep = (library ?? []).find((x) => x.id === e.target.value);
          if (ep) onPick(endpointToConfig(ep));
          e.target.value = '';
        }}
        className="flex-1 min-w-0 bg-void border border-god/30 rounded px-2 py-1 text-[13px] font-mono text-slate-200 outline-none focus:border-god"
      >
        <option value="">选择接口…（填入下方配置）</option>
        {enabled.map((ep) => (
          <option key={ep.id} value={ep.id}>{ep.name} · {ep.modelId || '未设模型'}</option>
        ))}
      </select>
    </div>
  );
}
