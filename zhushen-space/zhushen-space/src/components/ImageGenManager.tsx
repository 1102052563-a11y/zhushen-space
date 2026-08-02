import { useEffect, useState } from 'react';
import { useImageGen, IMG_SERVICES, type ImgService, type OpenAIImgConfig, DEFAULT_IMG_CORS_PROXY } from '../store/imageGenStore';
import { useComic, useComicJob } from '../store/comicStore';
import { listFloors, generateComic, cancelComic, retryMissingPages, redrawPage, type FloorInfo } from '../systems/comic';
import { listBatches, pagesOfBatch, deleteBatch, type ComicBatch, type ComicPage as ComicPageRec } from '../systems/comicDb';
import { collectGallery, GALLERY_KINDS, type GalleryGroup, type GalleryKind } from '../systems/gallery';
import { shareImageToChannel } from '../systems/chatImages';
import { isTagService } from '../systems/imageTags';
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
      <Field label="CORS 代理地址（已默认填好·绕过浏览器跨域；改后自动保存、刷新不丢）" hint="留空=直连官方端点；含 {url} 为前缀式，否则 代理/真实地址。公益站/中转站直连常被浏览器跨域拦截（白扣次数）——用默认代理即可。点「↺默认」恢复。本地/内网地址（localhost / 127.x / 192.168.x 等）自动直连、不走代理。">
        <div className="flex gap-1">
          <input value={cfg.corsProxy ?? ''} onChange={(e) => set({ corsProxy: e.target.value })} placeholder="留空=直连" className={inputCls + ' flex-1'} />
          <button type="button" onClick={() => set({ corsProxy: DEFAULT_IMG_CORS_PROXY })} title="恢复默认代理" className="shrink-0 px-2 text-[12px] font-mono text-dim hover:text-god border border-edge rounded transition-colors">↺默认</button>
        </div>
      </Field>
    </div>
  );
}

/* 深度端点连通测试 */
function DepthTestButton() {
  const { depthUrl, depthKey } = useImageGen();
  const [st, setSt] = useState('');
  async function test() {
    if (!depthUrl) { setSt('请先填端点地址'); return; }
    setSt('测试中…');
    try {
      const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const res = await fetch(depthUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(depthKey ? { Authorization: `Bearer ${depthKey}` } : {}) }, body: JSON.stringify({ image: tiny }) });
      setSt(res.ok ? `✓ 连通（HTTP ${res.status}）` : `✗ HTTP ${res.status}`);
    } catch (e: any) { setSt('✗ ' + (e?.message || '连接失败（跨域/地址错？）')); }
  }
  return <div className="flex items-center gap-2"><button type="button" onClick={test} className="px-3 py-1 text-[12px] font-mono border border-god/50 text-god rounded hover:bg-god/10 transition-colors">🔌 测试端点</button>{st && <span className="text-[12px] font-mono text-dim/70">{st}</span>}</div>;
}

/* ── 子页1：生图API配置 ── */
function ApiConfigPage() {
  const s = useImageGen();
  const [svc, setSvc] = useState<ImgService>('nai');
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border border-edge bg-panel p-3 space-y-2">
        <div className="text-sm text-god font-mono">全息卡 · 2.5D 深度视差</div>
        <Row title="启用 2.5D 深度视差" desc="放大检视时显示「2.5D 化」按钮，手动把立绘/物品/装备按深度做视差旋转（人物·装备通用）。关=纯平面全息卡。" checked={s.holoParallax} onChange={() => s.setSettings({ holoParallax: !s.holoParallax })} />
        {s.holoParallax && (
          <>
            <Field label="深度图来源" hint="本地=浏览器内 Depth Anything（零部署，首次约 30MB 模型自动下载并缓存，WebGPU/WASM）；网关=你自建的深度端点。">
              <select value={s.depthProvider} onChange={(e) => s.setSettings({ depthProvider: e.target.value as 'local' | 'gateway' })} className={inputCls}>
                <option value="local">本地模型（浏览器内 · 零部署 · 推荐）</option>
                <option value="gateway">网关端点（自建服务）</option>
              </select>
            </Field>
            {s.depthProvider === 'local' && (
              <>
                <Field label="模型下载镜像（可空）" hint="国内访问 HuggingFace 慢/失败时填镜像；填好后重开检视弹层再点「2.5D 化」重试。空=官方 huggingface.co。">
                  <div className="flex gap-1">
                    <input value={s.depthHfMirror} onChange={(e) => s.setSettings({ depthHfMirror: e.target.value })} placeholder="留空=huggingface.co" className={inputCls + ' flex-1'} />
                    <button type="button" onClick={() => s.setSettings({ depthHfMirror: 'https://hf-mirror.com' })} title="填入 hf-mirror.com" className="shrink-0 px-2 text-[12px] font-mono text-dim hover:text-god border border-edge rounded transition-colors">hf-mirror</button>
                  </div>
                </Field>
                <div className="text-[12px] text-dim/50 leading-relaxed">生图 API 只负责出图。到 NPC / 物品详情点头像或图片放大，检视弹层里点「✨ 2.5D 化」，即在浏览器本地生成深度图（一图一次·自动缓存）。首次需联网下载 ~30MB 模型。</div>
              </>
            )}
            {s.depthProvider === 'gateway' && (
              <>
                <Field label="深度图端点（图入 → 深度图出）" hint="POST {image: base64}，返回深度图（image/* 或 JSON 的 depth/image/url 字段）。">
                  <input value={s.depthUrl} onChange={(e) => s.setSettings({ depthUrl: e.target.value })} placeholder="https://你的深度服务/depth" className={inputCls} />
                </Field>
                <Field label="端点密钥（可空 · Bearer）"><input type="password" value={s.depthKey} onChange={(e) => s.setSettings({ depthKey: e.target.value })} placeholder="留空=无鉴权" className={inputCls} /></Field>
                <DepthTestButton />
              </>
            )}
          </>
        )}
      </div>
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
            <Field label="CORS 代理地址（默认已填同源代理·开箱即用·无需配置；改后自动保存）" hint="默认 https://zhushen-space.pages.dev/proxy 是与本站同源的内置代理（头式 X-Upstream），玩家零配置直接用。也可换自己的：含 {url} 为前缀式；否则头式。留空=直连=Failed to fetch。">
              <div className="flex gap-1">
                <input value={s.nai.corsProxy ?? ''} onChange={(e) => s.setNai({ corsProxy: e.target.value })} placeholder="留空=直连" className={inputCls + ' flex-1'} />
                <button type="button" onClick={() => s.setNai({ corsProxy: DEFAULT_IMG_CORS_PROXY })} title="恢复默认同源代理" className="shrink-0 px-2 text-[12px] font-mono text-dim hover:text-god border border-edge rounded transition-colors">↺默认</button>
              </div>
            </Field>
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
        {svc === 'chatimg' && (
          <div className="space-y-2">
            <div className="text-[12px] text-dim/50 leading-relaxed">多模态 Chat 出图：走 <span className="font-mono">chat/completions</span>，请求里可带参考图、从回复里提图——nano-banana 系（gemini-2.5-flash-image 等）中转/OpenRouter 都是这种用法。漫画工坊推荐用这条线（能发角色立绘当参考图锁长相）。</div>
            <OpenAIImgFields cfg={s.chatimg} set={s.setChatImg} />
          </div>
        )}
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
      <Row title="边写边出图（流式逐段）" desc="正文还在写时，每写完一段就给那段配 1 张图，更快看到图。代价：每段各调一次提取 LLM（调用次数≈段落数）。需先开「自动正文生图」。" checked={s.storyProgressive} onChange={() => s.setSettings({ storyProgressive: !s.storyProgressive })} />
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-dim/60">正文生图·标签模板（NAI/ComfyUI 用·内置预设失败时回退）</span>
        <button onClick={s.resetStoryTemplate} className="text-[12px] font-mono text-dim/50 hover:text-god">恢复默认</button>
      </div>
      <textarea rows={10} value={s.storyTemplate} onChange={(e) => s.setSettings({ storyTemplate: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[12px] font-mono text-dim/60">正文生图·GPT 自然语言模板（gpt-image-2/OpenAI/Gemini/自定义 自动改用·输出中文自然语言而非标签）</span>
        <button onClick={s.resetGptStoryTemplate} className="text-[12px] font-mono text-dim/50 hover:text-god">恢复默认</button>
      </div>
      <textarea rows={10} value={s.gptStoryTemplate} onChange={(e) => s.setSettings({ gptStoryTemplate: e.target.value })} className={inputCls + ' resize-y leading-relaxed'} />
      <div className="text-[12px] text-dim/50">注：正文生图按【生图服务】自动选模板——NAI/ComfyUI(标签)走内置「生图预设」(NSFW破限)，失败回退上面"标签模板"；gpt-image-2/OpenAI/Gemini/自定义(自然语言)走"GPT 模板"(中文自然语言·SFW)。</div>
    </div>
  );
}

/* ── 子页5：漫画工坊（楼层剧情 → 分镜 JSON → 并发绘画 → 漫画库/阅读器）── */
function ComicTabPage() {
  const cs = useComic();
  const job = useComicJob();
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [batches, setBatches] = useState<ComicBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState('');
  const [pages, setPages] = useState<ComicPageRec[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void listFloors().then((fs) => {
      setFloors(fs);
      if (fs.length) { setSelEnd(fs[fs.length - 1].no); setSelStart(fs[Math.max(0, fs.length - 3)].no); }
    });
  }, []);
  useEffect(() => { void listBatches().then(setBatches); }, [job.doneAt]);
  useEffect(() => { if (job.batchId && !job.running) setActiveBatch(job.batchId); }, [job.batchId, job.running]);
  function loadPages(batchId: string) {
    if (!batchId) { setPages([]); return; }
    void pagesOfBatch(batchId).then((ps) => { setPages(ps); setPageIdx((i) => Math.min(i, Math.max(0, ps.length - 1))); });
  }
  useEffect(() => { loadPages(activeBatch); setPageIdx(0); setShowPrompt(false); }, [activeBatch, job.doneAt]);

  const chosen = floors.filter((f) => f.no >= selStart && f.no <= selEnd).map((f) => f.no);
  const curBatch = batches.find((b) => b.id === activeBatch);
  const cur = pages[pageIdx];
  const missing = curBatch ? Math.max(0, curBatch.pageTotal - pages.length) : 0;
  const statusCls: Record<string, string> = { pending: 'text-dim/50 border-edge', drawing: 'text-amber-300 border-amber-400/40', ok: 'text-emerald-300 border-emerald-400/40', fail: 'text-red-300 border-red-400/40' };
  const statusTxt: Record<string, string> = { pending: '排队', drawing: '绘制中', ok: '✓', fail: '✗' };

  async function onRedraw() {
    if (!cur || busy) return;
    setBusy(`重绘第 ${cur.page} 页中…`);
    try { await redrawPage(activeBatch, cur.page); loadPages(activeBatch); }
    catch (e: any) { setBusy(''); window.alert('重绘失败：' + (e?.message || String(e))); return; }
    setBusy('');
  }
  async function onDeleteBatch() {
    if (!curBatch) return;
    if (!window.confirm(`删除漫画《${curBatch.title}》全部 ${pages.length} 页？此操作不可恢复。`)) return;
    await deleteBatch(curBatch.id);
    setActiveBatch('');
    void listBatches().then(setBatches);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 制作 */}
      <div className="rounded-lg border border-edge bg-panel p-3 space-y-3">
        <div className="text-sm text-god font-mono">📖 制作漫画</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="起始楼层">
            <select value={selStart} onChange={(e) => setSelStart(parseInt(e.target.value) || 0)} className={inputCls}>
              {floors.map((f) => <option key={f.no} value={f.no}>楼{f.no} · {f.preview}…</option>)}
            </select>
          </Field>
          <Field label="结束楼层">
            <select value={selEnd} onChange={(e) => setSelEnd(parseInt(e.target.value) || 0)} className={inputCls}>
              {floors.map((f) => <option key={f.no} value={f.no}>楼{f.no} · {f.preview}…</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="漫画服务"><ServiceSelect value={cs.service} onChange={(v) => cs.set({ service: v })} /></Field>
          <Field label="页数(1~4)"><input type="number" min={1} max={4} value={cs.pageCount} onChange={(e) => cs.set({ pageCount: Math.min(4, Math.max(1, parseInt(e.target.value) || 2)) })} className={inputCls} /></Field>
          <Field label="页面尺寸"><input value={cs.size} onChange={(e) => cs.set({ size: e.target.value })} placeholder="832x1216" className={inputCls} /></Field>
          <Field label="文字语言"><input value={cs.language} onChange={(e) => cs.set({ language: e.target.value })} placeholder="zh-CN" className={inputCls} /></Field>
        </div>
        {isTagService(cs.service) && (
          <div className="text-[12px] text-amber-300/70 leading-relaxed">NAI / ComfyUI 是英文标签模型，画不了「多格分镜＋对白气泡」——此线每页产出一张<b>关键画面插画</b>（分镜自动为每页生成 danbooru 标签，并入角色画像锚点锁长相；无分格、无对白文字）。想要真正的分格漫画页请选「多模态Chat出图」或 Gemini。NAI 自动套用画风的画师串并按队列限速；尺寸留空则用 NAI 配置里的宽高。</div>
        )}
        <Row title="角色立绘当参考图" desc="把出场角色的立绘/头像发给绘画模型锁长相（仅「多模态Chat出图」服务生效，上限4张）" checked={cs.sendCharRefs} onChange={() => cs.set({ sendCharRefs: !cs.sendCharRefs })} />
        <Row title="送审软化" desc="直白亲密/血腥转含蓄画面语言，防分镜与绘画模型拒答（只软化画面表达，不改剧情事实）" checked={cs.soften} onChange={() => cs.set({ soften: !cs.soften })} />
        <div>
          <div className="text-[12px] font-mono text-dim/60 mb-1">分镜 LLM 路由（剧情 → 分镜 JSON；推荐配一个强文本模型，留空回退正文 API）</div>
          <ApiRoutePicker routeKey="comic_storyboard_llm" />
        </div>
        <Field label="负面提示词（NAI/ComfyUI 线用；多模态Chat线忽略）"><textarea rows={2} value={cs.negative} onChange={(e) => cs.set({ negative: e.target.value })} className={inputCls + ' resize-y'} /></Field>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void generateComic(chosen).catch(() => undefined); }}
            disabled={job.running || !chosen.length}
            className="px-4 py-1.5 text-sm font-mono border border-god/50 text-god rounded hover:bg-god/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >✨ 生成漫画（{chosen.length} 楼 → {cs.pageCount} 页）</button>
          {job.running && <button onClick={cancelComic} className="px-3 py-1.5 text-sm font-mono border border-red-400/50 text-red-300 rounded hover:bg-red-400/10 transition-colors">取消</button>}
        </div>
        {(job.running || job.phase) && (
          <div className="rounded border border-edge bg-void p-2 space-y-1.5">
            <div className="text-[12px] font-mono text-slate-300">{job.running ? '⏳ ' : ''}{job.phase}</div>
            {job.pages.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {job.pages.map((p) => (
                  <span key={p.page} title={p.error || ''} className={`px-1.5 py-0.5 text-[11px] font-mono border rounded ${statusCls[p.status]}`}>P{p.page} {statusTxt[p.status]}</span>
                ))}
              </div>
            )}
            {job.pages.some((p) => p.status === 'fail') && (
              <div className="text-[11px] text-red-300/80">{job.pages.filter((p) => p.status === 'fail').map((p) => `第${p.page}页：${(p.error || '').slice(0, 80)}`).join('；')}</div>
            )}
          </div>
        )}
        <div className="text-[12px] text-dim/50 leading-relaxed">流程：所选楼层正文（自动剥游戏数据）＋角色档案外观 → 分镜 LLM 出严格 JSON（每页提示词自包含）→ 并发错峰绘画 → 存入下方漫画库。生成在后台进行，关掉本面板不影响。</div>
      </div>

      {/* 漫画库 + 阅读器 */}
      <div className="rounded-lg border border-edge bg-panel p-3 space-y-3">
        <div className="text-sm text-god font-mono">🗂 漫画库（存浏览器本地·不占存档体积·清进度不清漫画）</div>
        {batches.length === 0 && <div className="text-[12px] text-dim/50">还没有漫画。选好楼层点上面「生成漫画」。</div>}
        {batches.length > 0 && (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {batches.map((b) => (
              <button key={b.id} onClick={() => setActiveBatch(b.id === activeBatch ? '' : b.id)}
                className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${b.id === activeBatch ? 'border-god/40 bg-god/5' : 'border-edge hover:border-god/20'}`}>
                <div className="text-[13px] text-slate-200">《{b.title}》 <span className="text-[11px] text-dim/60">{b.pageTotal} 页{b.status === 'partial' ? ' · ⚠ 有缺页' : ''}</span></div>
                <div className="text-[11px] text-dim/50 font-mono">楼{b.sourceFloors[0]}-{b.sourceFloors[b.sourceFloors.length - 1]} · {new Date(b.createdAt).toLocaleString()} · {b.sourceDigest.slice(0, 30)}…</div>
              </button>
            ))}
          </div>
        )}
        {curBatch && (
          <div className="space-y-2 border-t border-edge pt-2">
            {pages.length === 0 && <div className="text-[12px] text-dim/50">本批还没有成图{missing > 0 ? `（缺 ${missing} 页，点下方「补齐缺页」）` : ''}。</div>}
            {cur && (
              <>
                <div className="rounded border border-edge bg-void p-1">
                  <img src={cur.dataUrl} alt={`第${cur.page}页`} className="max-h-[70vh] w-auto max-w-full mx-auto object-contain" />
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx <= 0} className="px-3 py-1 text-sm font-mono border border-edge rounded text-slate-200 hover:border-god/40 disabled:opacity-30">← 上页</button>
                  <span className="text-[12px] font-mono text-dim/70">第 {cur.page} / {curBatch.pageTotal} 页</span>
                  <button onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIdx >= pages.length - 1} className="px-3 py-1 text-sm font-mono border border-edge rounded text-slate-200 hover:border-god/40 disabled:opacity-30">下页 →</button>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap text-[12px] font-mono">
                  <button onClick={() => { void onRedraw(); }} disabled={!!busy} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40 disabled:opacity-40">{busy || '🎨 重绘本页'}</button>
                  <button onClick={() => setShowPrompt((v) => !v)} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40">{showPrompt ? '收起提示词' : '📋 查看提示词'}</button>
                  <a href={cur.dataUrl} download={`${curBatch.title}-P${cur.page}.png`} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40">⬇ 下载本页</a>
                </div>
                {showPrompt && <pre className="text-[11px] text-dim/70 bg-void border border-edge rounded p-2 whitespace-pre-wrap max-h-52 overflow-y-auto">{cur.finalPrompt || cur.pagePrompt}</pre>}
              </>
            )}
            <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
              {missing > 0 && <button onClick={() => { void retryMissingPages(curBatch.id).catch(() => undefined); }} disabled={job.running} className="px-2 py-1 border border-amber-400/40 text-amber-300 rounded hover:bg-amber-400/10 disabled:opacity-40">🩹 补齐缺页（{missing}）</button>}
              <button onClick={() => { void onDeleteBatch(); }} className="px-2 py-1 border border-red-400/40 text-red-300 rounded hover:bg-red-400/10">🗑 删除本批</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 子页6：图片库（聚合已生成图片·按名字分组浏览·漫画自成一类）── */
function GalleryTabPage() {
  const [groups, setGroups] = useState<GalleryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<'all' | GalleryKind>('all');
  const [box, setBox] = useState<{ group: GalleryGroup; idx: number } | null>(null);
  const [boxPrompt, setBoxPrompt] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState('');

  function refresh() {
    setLoading(true);
    void collectGallery().then((g) => { setGroups(g); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { refresh(); }, []);

  const totalImgs = groups.reduce((s, g) => s + g.images.length, 0);
  const kindsPresent = GALLERY_KINDS.filter((k) => groups.some((g) => g.kind === k.key));
  const cur = box ? box.group.images[box.idx] : null;

  function openBox(group: GalleryGroup, idx = 0) { setBox({ group, idx }); setBoxPrompt(false); setShareMsg(''); }
  function moveBox(delta: number) {
    setBox((b) => (b ? { group: b.group, idx: Math.min(b.group.images.length - 1, Math.max(0, b.idx + delta)) } : b));
    setBoxPrompt(false); setShareMsg('');
  }
  async function onShareToChat() {
    if (!box || !cur || shareBusy) return;
    setShareBusy(true); setShareMsg('');
    try {
      await shareImageToChannel(cur.url, `${box.group.name} · ${cur.caption}`);
      setShareMsg('✓ 已分享到交流室「🖼 图片分享」频道');
    } catch (e: any) { setShareMsg('✗ ' + (e?.message || '分享失败')); }
    setShareBusy(false);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setKindFilter('all')} className={`px-2.5 py-1 text-[12px] font-mono rounded border transition-colors ${kindFilter === 'all' ? 'border-god/40 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>全部（{totalImgs}）</button>
          {kindsPresent.map((k) => (
            <button key={k.key} onClick={() => setKindFilter(k.key)} className={`px-2.5 py-1 text-[12px] font-mono rounded border transition-colors ${kindFilter === k.key ? 'border-god/40 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
              {k.label}（{groups.filter((g) => g.kind === k.key).reduce((s, g) => s + g.images.length, 0)}）
            </button>
          ))}
        </div>
        <button onClick={refresh} className="px-2 py-1 text-[12px] font-mono border border-edge rounded text-dim hover:text-god hover:border-god/40 transition-colors">⟳ 刷新</button>
      </div>
      {loading && <div className="text-[12px] text-dim/50">读取图片库…</div>}
      {!loading && totalImgs === 0 && <div className="text-[12px] text-dim/50">还没有图片——立绘/装备图/正文配图/漫画生成后都会出现在这里。</div>}

      {!loading && GALLERY_KINDS.filter((k) => kindFilter === 'all' || kindFilter === k.key).map((k) => {
        const list = groups.filter((g) => g.kind === k.key);
        if (!list.length) return null;
        return (
          <div key={k.key} className="rounded-lg border border-edge bg-panel p-3 space-y-2">
            <div className="text-sm text-god font-mono">{k.label}<span className="text-[11px] text-dim/50 ml-2">{list.length} 组</span></div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {list.map((g) => (
                <button key={g.key} onClick={() => openBox(g)} className="group text-left rounded border border-edge hover:border-god/40 overflow-hidden bg-void transition-colors" title={g.name}>
                  <div className="h-24 overflow-hidden flex items-center justify-center">
                    <img src={g.images[0].url} alt={g.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  </div>
                  <div className="px-1.5 py-1 text-[11px] font-mono text-slate-300 truncate">
                    {g.name}{g.images.length > 1 && <span className="text-dim/50"> ×{g.images.length}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* 灯箱 */}
      {box && cur && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" onClick={() => setBox(null)}>
          <div className="max-w-3xl w-full max-h-full flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <img src={cur.url} alt={box.group.name} className="max-h-[72vh] w-auto max-w-full object-contain rounded" />
            <div className="text-[13px] font-mono text-slate-200">{box.group.name} <span className="text-dim/60">· {cur.caption}（{box.idx + 1}/{box.group.images.length}）</span></div>
            <div className="flex items-center gap-2 flex-wrap justify-center text-[12px] font-mono">
              <button onClick={() => moveBox(-1)} disabled={box.idx <= 0} className="px-3 py-1 border border-edge rounded text-slate-200 hover:border-god/40 disabled:opacity-30">← 上一张</button>
              <button onClick={() => moveBox(1)} disabled={box.idx >= box.group.images.length - 1} className="px-3 py-1 border border-edge rounded text-slate-200 hover:border-god/40 disabled:opacity-30">下一张 →</button>
              {cur.prompt && <button onClick={() => setBoxPrompt((v) => !v)} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40">{boxPrompt ? '收起提示词' : '📋 提示词'}</button>}
              <a href={cur.url} download={`${box.group.name}-${cur.caption}.png`.replace(/[\\/:*?"<>|]/g, '_')} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40">⬇ 下载</a>
              <button onClick={() => { void onShareToChat(); }} disabled={shareBusy} className="px-2 py-1 border border-edge rounded text-dim hover:text-god hover:border-god/40 disabled:opacity-40">{shareBusy ? '⏳ 分享中…' : '📤 分享到交流室'}</button>
              <button onClick={() => setBox(null)} className="px-2 py-1 border border-edge rounded text-dim hover:text-red-300 hover:border-red-400/40">✕ 关闭</button>
            </div>
            {shareMsg && <div className={`text-[12px] font-mono ${shareMsg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>{shareMsg}</div>}
            {boxPrompt && cur.prompt && <pre className="w-full text-[11px] text-dim/70 bg-void border border-edge rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto" onClick={(e) => e.stopPropagation()}>{cur.prompt}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = 'api' | 'portrait' | 'equip' | 'story' | 'comic' | 'gallery';
export default function ImageGenManager() {
  const [tab, setTab] = useState<Tab>('api');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'api', label: '生图API配置' }, { key: 'portrait', label: '肖像生成' },
    { key: 'equip', label: '装备生图' }, { key: 'story', label: '正文生图' },
    { key: 'comic', label: '漫画' }, { key: 'gallery', label: '图片库' },
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
      {tab === 'comic' && <ComicTabPage />}
      {tab === 'gallery' && <GalleryTabPage />}
    </div>
  );
}
