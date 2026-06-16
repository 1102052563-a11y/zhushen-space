import { useState } from 'react';
import { useImageGen, IMG_SERVICES, type ImgService, type OpenAIImgConfig } from '../store/imageGenStore';
import ApiRoutePicker from './ApiRoutePicker';

const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono text-slate-200 outline-none focus:border-god';
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="space-y-1 block"><span className="text-[12px] font-mono text-dim/60">{label}</span>{children}{hint && <span className="block text-[11px] text-dim/40">{hint}</span>}</label>;
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}><div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} /></button>;
}
function Row({ title, desc, checked, onChange }: { title: string; desc?: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2">
      <div><div className="text-sm text-slate-200">{title}</div>{desc && <div className="text-[12px] text-dim/60 mt-0.5">{desc}</div>}</div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
function ServiceSelect({ value, onChange }: { value: ImgService; onChange: (v: ImgService) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ImgService)} className={inputCls}>
      {IMG_SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
}

/* OpenAI 兼容图片配置（openai/gemini/custom 共用）*/
function OpenAIImgFields({ cfg, set }: { cfg: OpenAIImgConfig; set: (p: Partial<OpenAIImgConfig>) => void }) {
  return (
    <div className="space-y-2">
      <Field label="接口地址"><input value={cfg.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className={inputCls} /></Field>
      <Field label="API Key"><input type="password" value={cfg.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-..." className={inputCls} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="模型"><input value={cfg.model} onChange={(e) => set({ model: e.target.value })} placeholder="gpt-image-1" className={inputCls} /></Field>
        <Field label="尺寸"><input value={cfg.size} onChange={(e) => set({ size: e.target.value })} placeholder="1024x1024" className={inputCls} /></Field>
        <Field label="质量"><input value={cfg.quality} onChange={(e) => set({ quality: e.target.value })} placeholder="high" className={inputCls} /></Field>
      </div>
    </div>
  );
}

/* ── 子页1：生图API配置 ── */
function ApiConfigPage() {
  const s = useImageGen();
  const [svc, setSvc] = useState<ImgService>('nai');
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-edge bg-panel p-3 space-y-2">
        <div className="text-sm text-god font-mono">用途 → 服务商</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="肖像生成"><ServiceSelect value={s.portraitService} onChange={(v) => s.setService('portraitService', v)} /></Field>
          <Field label="正文生图"><ServiceSelect value={s.storyService} onChange={(v) => s.setService('storyService', v)} /></Field>
          <Field label="装备生图">{s.equipUsePortrait ? <div className="text-[12px] text-dim/50 py-1.5">沿用肖像</div> : <ServiceSelect value={s.equipService} onChange={(v) => s.setService('equipService', v)} />}</Field>
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-panel p-3 space-y-3">
        <Field label="正在配置的服务"><ServiceSelect value={svc} onChange={setSvc} /></Field>

        {svc === 'nai' && (
          <div className="space-y-2">
            <Field label="API URL" hint="默认填 NovelAI 域名，程序自动补 /ai/generate-image"><input value={s.nai.apiUrl} onChange={(e) => s.setNai({ apiUrl: e.target.value })} className={inputCls} /></Field>
            <Field label="CORS 代理地址（必填·NAI 浏览器直连会被跨域拦截）" hint="含 {url} 为前缀式(如 https://代理/?url={url})；否则头式：请求发到该地址、真实 NAI 地址放 X-Upstream 头（兼容 fanren）。留空=直连=Failed to fetch。部署见下方说明。"><input value={s.nai.corsProxy ?? ''} onChange={(e) => s.setNai({ corsProxy: e.target.value })} placeholder="https://your-worker.workers.dev  或  https://代理/?url={url}" className={inputCls} /></Field>
            <Field label="Persistent API Token"><input type="password" value={s.nai.apiToken} onChange={(e) => s.setNai({ apiToken: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="模型"><input value={s.nai.model} onChange={(e) => s.setNai({ model: e.target.value })} className={inputCls} /></Field>
              <Field label="尺寸"><div className="flex gap-1 items-center"><input type="number" value={s.nai.width} onChange={(e) => s.setNai({ width: parseInt(e.target.value) || 1024 })} className={inputCls} /><span className="text-dim/40">×</span><input type="number" value={s.nai.height} onChange={(e) => s.setNai({ height: parseInt(e.target.value) || 1024 })} className={inputCls} /></div></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label="Sampler"><input value={s.nai.sampler} onChange={(e) => s.setNai({ sampler: e.target.value })} className={inputCls} /></Field>
              <Field label="Steps"><input type="number" value={s.nai.steps} onChange={(e) => s.setNai({ steps: parseInt(e.target.value) || 28 })} className={inputCls} /></Field>
              <Field label="Guidance"><input type="number" step={0.5} value={s.nai.promptGuidance} onChange={(e) => s.setNai({ promptGuidance: parseFloat(e.target.value) || 5 })} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label="Rescale"><input type="number" step={0.05} value={s.nai.promptGuidanceRescale} onChange={(e) => s.setNai({ promptGuidanceRescale: parseFloat(e.target.value) || 0 })} className={inputCls} /></Field>
              <Field label="负面强度"><input type="number" step={0.05} value={s.nai.undesiredContentStrength} onChange={(e) => s.setNai({ undesiredContentStrength: parseFloat(e.target.value) || 1 })} className={inputCls} /></Field>
              <Field label="超时(秒)"><input type="number" value={s.nai.timeoutSec} onChange={(e) => s.setNai({ timeoutSec: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
            </div>
            <Row title="NAI 请求队列（串行）" desc={`相邻请求至少间隔 ${s.nai.queueGapSec}s，避免并发打到 NovelAI`} checked={s.nai.queueEnabled} onChange={() => s.setNai({ queueEnabled: !s.nai.queueEnabled })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="发送间隔(秒)"><input type="number" value={s.nai.queueGapSec} onChange={(e) => s.setNai({ queueGapSec: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
              <Field label="RPM 上限" hint="0=不限"><input type="number" value={s.nai.rpm} onChange={(e) => s.setNai({ rpm: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
            </div>
            <div className="text-[12px] text-dim/45">「画师串」已移到「肖像生成 → 🎨 画风」统一管理（画风的核心）。</div>
            <Field label="NAI 全局负面（兜底：肖像/装备未单独设负面时、及正文配图用）"><textarea rows={3} value={s.nai.negativePrompt} onChange={(e) => s.setNai({ negativePrompt: e.target.value })} className={inputCls + ' resize-y'} /></Field>
          </div>
        )}
        {svc === 'openai' && <OpenAIImgFields cfg={s.openai} set={s.setOpenai} />}
        {svc === 'gemini' && <OpenAIImgFields cfg={s.gemini} set={s.setGemini} />}
        {svc === 'custom' && <OpenAIImgFields cfg={s.custom} set={s.setCustom} />}
        {svc === 'comfy' && (
          <div className="space-y-2">
            <Field label="ComfyUI 地址"><input value={s.comfy.apiUrl} onChange={(e) => s.setComfy({ apiUrl: e.target.value })} placeholder="http://127.0.0.1:8188" className={inputCls} /></Field>
            <Field label="工作流 JSON（ComfyUI「保存(API格式)」导出）"><textarea rows={6} value={s.comfy.workflowJson} onChange={(e) => s.setComfy({ workflowJson: e.target.value })} className={inputCls + ' resize-y'} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="正向节点 id"><input value={s.comfy.positiveNode} onChange={(e) => s.setComfy({ positiveNode: e.target.value })} className={inputCls} /></Field>
              <Field label="正向输入名"><input value={s.comfy.positiveInput} onChange={(e) => s.setComfy({ positiveInput: e.target.value })} className={inputCls} /></Field>
              <Field label="负向节点 id"><input value={s.comfy.negativeNode} onChange={(e) => s.setComfy({ negativeNode: e.target.value })} className={inputCls} /></Field>
              <Field label="负向输入名"><input value={s.comfy.negativeInput} onChange={(e) => s.setComfy({ negativeInput: e.target.value })} className={inputCls} /></Field>
              <Field label="轮询间隔(ms)"><input type="number" value={s.comfy.pollIntervalMs} onChange={(e) => s.setComfy({ pollIntervalMs: parseInt(e.target.value) || 1200 })} className={inputCls} /></Field>
              <Field label="超时(秒)"><input type="number" value={s.comfy.timeoutSec} onChange={(e) => s.setComfy({ timeoutSec: parseInt(e.target.value) || 600 })} className={inputCls} /></Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 子页2：肖像生成 ── */
function PortraitPage() {
  const s = useImageGen();
  return (
    <div className="space-y-3 max-w-2xl">
      <Field label="肖像生成服务"><ServiceSelect value={s.portraitService} onChange={(v) => s.setService('portraitService', v)} /></Field>

      {/* 画风预设 */}
      <div className="rounded-lg border border-god/30 bg-god/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-mono text-god/80 shrink-0">🎨 画风</span>
          <select value={s.activeStyleId} onChange={(e) => s.applyStyle(e.target.value)} className={inputCls}>
            {s.styles.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
          <button onClick={() => { const n = window.prompt('把当前的画师串/正负向/模板存成新画风，命名：'); if (n) s.saveCurrentAsStyle(n); }}
            className="shrink-0 text-[12px] font-mono px-2 py-1.5 rounded border border-edge text-dim hover:text-god transition-colors">存为新画风</button>
          {!['nai-anime','realistic','thick-paint'].includes(s.activeStyleId) && (
            <button onClick={() => { s.removeStyle(s.activeStyleId); s.applyStyle('nai-anime'); }}
              className="shrink-0 text-[12px] font-mono px-2 py-1.5 rounded border border-edge text-dim/50 hover:text-blood transition-colors">删除</button>
          )}
        </div>
        <div className="text-[11px] text-dim/50 leading-relaxed">切换画风=载入对应的画师串/正负向/模板。<b>NAI/ComfyUI</b> 主要看「画师串」；<b>OpenAI/Gemini</b> 用下方「自然语言肖像模板」。改完想保留就「存为新画风」。</div>
      </div>

      <Field label="画师串（NAI 冒号权重，追加到正向末尾；画风的核心）"><textarea rows={4} value={s.nai.artistTags} onChange={(e) => s.setNai({ artistTags: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} /></Field>
      <Field label="画风说明（填入自然语言模板的 ${'{style_guide}'}）"><input value={s.styleGuide} onChange={(e) => s.setSettings({ styleGuide: e.target.value })} className={inputCls} /></Field>

      <Field label="提示词格式">
        <select value={s.portraitPromptFormat} onChange={(e) => s.setSettings({ portraitPromptFormat: e.target.value as any })} className={inputCls}>
          <option value="nai">NAI（Danbooru tags + 冒号权重）</option>
          <option value="danbooru">Danbooru tags</option>
          <option value="natural">自然语言</option>
        </select>
      </Field>
      <Field label="聊天顶部在场头像数量" hint="0=不显示"><input type="number" value={s.topAvatarCount} onChange={(e) => s.setSettings({ topAvatarCount: parseInt(e.target.value) || 0 })} className={inputCls} /></Field>
      <Field label="肖像额外正向（追加）"><textarea rows={2} value={s.portraitPositive} onChange={(e) => s.setSettings({ portraitPositive: e.target.value })} className={inputCls + ' resize-y'} /></Field>
      <Field label="肖像负面提示词"><textarea rows={3} value={s.portraitNegative} onChange={(e) => s.setSettings({ portraitNegative: e.target.value })} className={inputCls + ' resize-y'} /></Field>
      <Field label="自然语言肖像模板（仅 OpenAI/Gemini 用，变量 ${'{gender}'}/${'{appearance}'}/${'{attire}'}/${'{action}'}/${'{portrait_prompt}'} 等）"><textarea rows={6} value={s.portraitTemplate} onChange={(e) => s.setSettings({ portraitTemplate: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} /></Field>
      <Row title="自动生成肖像" desc="每回合约6秒后自动为无立绘的在场NPC+主角补肖像（每回合最多6张，余下下回合继续）" checked={s.autoPortrait} onChange={() => s.setSettings({ autoPortrait: !s.autoPortrait })} />
      <Row title="外观变化时刷新肖像" desc="主角外观文字或生图标签(列19)变化后，自动按新形象重绘已有立绘（需开自动生成；默认开）" checked={s.refreshOnLook} onChange={() => s.setSettings({ refreshOnLook: !s.refreshOnLook })} />
      <div className="text-[12px] text-dim/50">也可在 NPC 详情「肖像绘卷」/ 主角侧栏点「✨ AI 生成」手动出图。自动生成需先在「生图API配置」配好服务与 Key。</div>
    </div>
  );
}

/* ── 子页3：装备生图 ── */
function EquipPage() {
  const s = useImageGen();
  return (
    <div className="space-y-3 max-w-2xl">
      <Row title="沿用肖像生图服务" desc="关闭后装备生图用独立服务" checked={s.equipUsePortrait} onChange={() => s.setSettings({ equipUsePortrait: !s.equipUsePortrait })} />
      {!s.equipUsePortrait && <Field label="装备生图服务"><ServiceSelect value={s.equipService} onChange={(v) => s.setService('equipService', v)} /></Field>}
      <Row title="自动生成玩家装备图" desc="无图的武器/防具/饰品/特殊/法宝自动补图（已穿戴优先，每回合最多6件，不再要求先有外观描述）" checked={s.autoEquipPlayer} onChange={() => s.setSettings({ autoEquipPlayer: !s.autoEquipPlayer })} />
      <Row title="自动生成 NPC 装备图" desc="同上，为在场 NPC 的装备类持有物补图" checked={s.autoEquipNpc} onChange={() => s.setSettings({ autoEquipNpc: !s.autoEquipNpc })} />
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-dim/60">装备生图提示词模板（变量 ${'{item_name}'} 等）</span>
        <button onClick={s.resetEquipTemplate} className="text-[12px] font-mono text-dim/50 hover:text-god">恢复默认</button>
      </div>
      <textarea rows={8} value={s.equipTemplate} onChange={(e) => s.setSettings({ equipTemplate: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} />
      <Field label="装备负面提示词"><textarea rows={3} value={s.equipNegative} onChange={(e) => s.setSettings({ equipNegative: e.target.value })} className={inputCls + ' resize-y'} /></Field>
    </div>
  );
}

/* ── 子页4：正文生图 ── */
function StoryPage() {
  const s = useImageGen();
  return (
    <div className="space-y-3 max-w-2xl">
      <Field label="正文生图服务"><ServiceSelect value={s.storyService} onChange={(v) => s.setService('storyService', v)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="生图数量(1~9)"><input type="number" min={1} max={9} value={s.storyImageCount} onChange={(e) => s.setSettings({ storyImageCount: Math.min(9, Math.max(1, parseInt(e.target.value) || 4)) })} className={inputCls} /></Field>
        <Field label="正文图尺寸" hint="inherit=沿用接口默认"><input value={s.storySize} onChange={(e) => s.setSettings({ storySize: e.target.value })} className={inputCls} /></Field>
      </div>
      <div>
        <div className="text-[12px] font-mono text-dim/60 mb-1">生图标签 LLM 路由（① 正文配图抽锚点 ② 主角/NPC/装备 的中文外观→英文 danbooru 标签翻译）</div>
        <div className="text-[11px] text-dim/45 mb-1">留空则自动回退用「正文生成 API」。NAI 等标签模型靠它把中文描述翻成准确英文标签，**强烈建议配一个**（推荐 Gemini Flash 等快模型）。</div>
        <ApiRoutePicker routeKey="image_story_llm" />
      </div>
      <Row title="自动正文生图" desc="每回合抽 N 个锚点逐张生成并插入正文" checked={s.autoStory} onChange={() => s.setSettings({ autoStory: !s.autoStory })} />
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-dim/60">正文生图提示词模板（输出 N 个 image/anchor/nsfw/prompt）</span>
        <button onClick={s.resetStoryTemplate} className="text-[12px] font-mono text-dim/50 hover:text-god">恢复默认</button>
      </div>
      <textarea rows={10} value={s.storyTemplate} onChange={(e) => s.setSettings({ storyTemplate: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} />
      <div className="text-[12px] text-dim/50">注：正文配图的「逐回合自动抽锚点+插图」流程为后续阶段（见集成指导）。本页配置先就位。</div>
    </div>
  );
}

type Tab = 'api' | 'portrait' | 'equip' | 'story';
export default function ImageGenManager() {
  const [tab, setTab] = useState<Tab>('api');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'api', label: '生图API配置' }, { key: 'portrait', label: '肖像生成' },
    { key: 'equip', label: '装备生图' }, { key: 'story', label: '正文生图' },
  ];
  return (
    <div className="space-y-4">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">生图设置</h2>
        <p className="text-sm text-dim mt-0.5">多服务生图：NAI / OpenAI / Gemini / ComfyUI / 自定义 × 肖像 / 装备 / 正文配图</p>
      </div>
      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 py-1.5 rounded text-sm font-mono transition-colors ${tab === t.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'api' && <ApiConfigPage />}
      {tab === 'portrait' && <PortraitPage />}
      {tab === 'equip' && <EquipPage />}
      {tab === 'story' && <StoryPage />}
    </div>
  );
}
