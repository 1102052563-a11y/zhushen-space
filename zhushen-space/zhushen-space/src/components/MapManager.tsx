import { useState } from 'react';
import { useMap } from '../store/mapStore';
import { useMisc } from '../store/miscStore';
import { useSettings } from '../store/settingsStore';
import { useImageGen, IMG_SERVICES, type ImgService } from '../store/imageGenStore';
import { mapWorldKey } from '../systems/mapEngine';
import ApiRoutePicker from './ApiRoutePicker';

/* 地图演化管理页（照 QuestManager 骨架）：
   总开关（mapStore.settings.enabled）+ 独立 API（featureKey='map'）+ AI 写图 / 注入 / 上限 等设置。
   地图数据存 mapStore（byWorld 世界分桶），在右侧导航「🧭 地图」面板查看与交互。 */

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}

function SettingsSection() {
  const settings = useMap((s) => s.settings);
  const setSettings = useMap((s) => s.setSettings);
  const storyStrip = useSettings((s) => s.storyStrip);
  const setStoryStrip = useSettings((s) => s.setStoryStrip);
  const worldName = useMisc((s) => s.worldName);
  const byWorld = useMap((s) => s.byWorld);
  const curKey = mapWorldKey(worldName);
  const curCount = Object.keys(byWorld[curKey]?.nodes ?? {}).length;

  const row = (label: string, desc: string, checked: boolean, onChange: () => void) => (
    <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
      <Toggle checked={checked} onChange={onChange} />
      <div>
        <div className="text-sm text-slate-200">{label}</div>
        <div className="text-sm text-dim mt-0.5">{desc}</div>
      </div>
    </div>
  );

  const numRow = (label: string, hint: string, value: number, min: number, max: number, onChange: (v: number) => void) => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}<span className="text-dim/40 ml-1 text-[12px]">{hint}</span></span>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );

  return (
    <div className="space-y-3 max-w-xl">
      <div className="text-sm text-dim leading-relaxed border border-edge rounded-lg p-3 bg-panel/40">
        地图分三层运转：①<b className="text-slate-300">确定性建图</b>（每回合自动把主角位置与世界大事地点记成节点图，零 API 消耗，总开关开着就一直在跑）；
        ②<b className="text-slate-300">AI 写图</b>（独立演化阶段：把正文里出现/听闻的新地点补进图，频率走 综合设置→演化调度 的「地图演化」行）；
        ③<b className="text-slate-300">注入回喂</b>（把〈当前地图〉作为地理事实喂给正文/细纲，治 AI 地理失忆与同地异名）。
      </div>
      {row('AI 写图（地图演化阶段）', '每 N 回合读正文，产出 discoverNode/setNode/linkNodes 指令补图；关掉则地图只靠确定性建图生长', settings.aiWrite, () => setSettings({ aiWrite: !settings.aiWrite }))}
      {row('注入正文〈当前地图〉', '当前位置 + 本区域已知地点 + 已知区域清单，作为背景地理事实（约几百 token）', settings.injectNarrative, () => setSettings({ injectNarrative: !settings.injectNarrative }))}
      {row('注入细纲（规划层）', '细纲生成时同样能看到地图，规划移动路线不瞎编地名', settings.injectOutline, () => setSettings({ injectOutline: !settings.injectOutline }))}
      {row('楼层信息条「位置」段', '在正文末尾的信息条里加一段当前位置（点开看本区域地点与足迹）', storyStrip.map !== false, () => setStoryStrip({ map: storyStrip.map === false }))}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        {numRow('每轮演化新增地点上限', '（防 AI 一口气铺满全城，建议 3~6）', settings.maxNewPerTurn, 1, 10, (v) => setSettings({ maxNewPerTurn: v }))}
        {numRow('传闻自动归档回合数', '（传闻地点 N 回合未被提及则归档，面板可捞回；图钉豁免）', settings.archiveAfter, 5, 200, (v) => setSettings({ archiveAfter: v }))}
      </div>
      <div className="text-[12px] text-dim/50 leading-relaxed px-1">
        调用频率与读取回合数在 <b className="text-slate-400">综合设置 → 演化调度 → 地图演化</b> 里调（默认 1/1；地图变化不密集的话调成 2/2 更省）。
        迷雾状态只升不降：传闻 → 已探 → 已访；「已访」只由主角实际位置驱动，AI 无权写。
      </div>
      <SceneImageSection />
      <div className="rounded-lg border border-blood/30 bg-blood/5 p-3 space-y-2">
        <div className="text-sm text-blood/90">危险操作</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { if (confirm(`清空当前世界「${curKey}」的地图（${curCount} 个地点）？不可恢复。`)) useMap.getState().clearWorld(curKey); }}
            className="px-3 py-1.5 rounded-lg border border-blood/40 text-blood/90 text-sm hover:bg-blood/10">
            清空当前世界地图{curCount ? `（${curCount} 点）` : ''}
          </button>
          <button
            onClick={() => { if (confirm('清空所有世界的地图数据？不可恢复。')) useMap.getState().clearAll(); }}
            className="px-3 py-1.5 rounded-lg border border-blood/40 text-blood/90 text-sm hover:bg-blood/10">
            清空全部世界
          </button>
        </div>
      </div>
    </div>
  );
}

/* 🧭 地点生图：地图面板里点「✨ 生成地点图」用哪个服务（NAI/ComfyUI 走英文标签由 LLM 翻译；OpenAI/Gemini 用中文模板）。
   API 密钥/画风/负面词等大配置仍在 设置→生图设置 统一管，这里只选服务。 */
function SceneImageSection() {
  const sceneUsePortrait = useImageGen((s) => s.sceneUsePortrait);
  const sceneService = useImageGen((s) => s.sceneService);
  const portraitService = useImageGen((s) => s.portraitService);
  const setIg = useImageGen((s) => s.setSettings);
  const label = (v: ImgService) => IMG_SERVICES.find((x) => x.value === v)?.label ?? v;
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2.5">
      <div className="text-sm text-slate-200">地点生图</div>
      <div className="text-[12px] text-dim/60 leading-relaxed">
        在地图面板选中地点后点「✨ 生成地点图」手动出图（不自动、不耗回合）。NAI/ComfyUI 先由生图标签 LLM 把地点档案翻成英文标签；
        OpenAI/Gemini/自定义走中文自然语言模板。生成的小图嵌进节点圆内，点详情图可看大图。
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={sceneUsePortrait} onChange={(e) => setIg({ sceneUsePortrait: e.target.checked })} className="accent-god w-4 h-4" />
        <span className="text-sm text-slate-300">沿用肖像服务</span>
        <span className="text-[12px] text-dim/50">（当前：{label(portraitService)}）</span>
      </label>
      {!sceneUsePortrait && (
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>地点图服务</span>
          <select value={sceneService} onChange={(e) => setIg({ sceneService: e.target.value as ImgService })}
            className="px-2 py-1 bg-void border border-edge rounded text-slate-200 focus:border-god focus:outline-none">
            {IMG_SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      )}
      <div className="text-[12px] text-dim/45 leading-relaxed">
        各服务的 API 密钥 / 模型 / 画风 / 负面词在 <b className="text-slate-400">设置 → 生图设置</b> 配置；
        标签翻译 LLM 走「生图标签 LLM 路由」（image_story_llm），未配置回退正文 API。
      </div>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="space-y-3 max-w-xl">
      <ApiRoutePicker routeKey="map" />
      <div className="text-[12px] text-dim/50 leading-relaxed px-1">
        未配置路由时回退「正文生成」的 API。地图指令很短，用便宜/快的模型即可胜任。
      </div>
    </div>
  );
}

type MapTab = 'settings' | 'api';

export default function MapManager() {
  const enabled = useMap((s) => s.settings.enabled);
  const setSettings = useMap((s) => s.setSettings);
  const [tab, setTab] = useState<MapTab>('settings');
  const tabs: { key: MapTab; label: string; icon: string }[] = [
    { key: 'settings', label: '功能设置', icon: '🧭' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">地图演化</h2>
          <p className="text-sm text-dim mt-0.5">独立阶段：把正文里的地点整理成可交互节点图（区域⇄场所·迷雾·足迹）——调用独立 API，与正文/杂项互不占用</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">{enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={enabled} onChange={() => setSettings({ enabled: !enabled })} />
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-mono transition-colors ${tab === t.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsSection />}
      {tab === 'api' && <ApiSection />}
    </div>
  );
}
