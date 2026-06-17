import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   生图设置（image generation）——多服务：NAI / OpenAI / Gemini / ComfyUI / 自定义
   三条生成线：肖像 / 装备 / 正文配图（各自选服务商）
   见 生图功能-集成指导.md
════════════════════════════════════════════ */

export type ImgService = 'nai' | 'openai' | 'gemini' | 'comfy' | 'custom';
export const IMG_SERVICES: { value: ImgService; label: string }[] = [
  { value: 'nai', label: 'NovelAI / NAI' },
  { value: 'openai', label: 'OpenAI 图片' },
  { value: 'gemini', label: 'Gemini 图片' },
  { value: 'comfy', label: 'ComfyUI' },
  { value: 'custom', label: '自定义(OpenAI兼容)' },
];

export interface NaiConfig {
  apiUrl: string;            // https://image.novelai.net（自动补 /ai/generate-image）
  corsProxy: string;         // CORS 代理（NAI 官方端点无 CORS，浏览器必须经代理）。两种写法：①含 {url} 前缀式 如 https://yourproxy/?url={url} ②否则头式：请求发到该地址、把真实 NAI 地址放 X-Upstream 头（兼容 fanren 代理）
  apiToken: string;          // Persistent API Token
  model: string;             // nai-diffusion-4-5-full
  width: number; height: number;
  timeoutSec: number;        // 0=不超时
  queueEnabled: boolean; queueGapSec: number;   // 串行队列 + 间隔
  rpm: number;               // 0=不限
  sampler: string;           // k_dpmpp_2m_sde
  steps: number;
  promptGuidance: number;            // scale 0~10
  promptGuidanceRescale: number;     // cfg_rescale 0~1
  undesiredContentStrength: number;  // uncond_scale 0~1.5
  negativePrompt: string;
  artistTags: string;        // 画师串（冒号权重），追加到正向末尾
  seed: string;              // 留空=随机
}

/* OpenAI 兼容图片（openai / gemini / custom 共用此结构）*/
export interface OpenAIImgConfig {
  baseUrl: string; apiKey: string; model: string;
  size: string; quality: string;     // size "1024x1024"，quality high/medium/low
  corsProxy?: string;                 // CORS 代理（绕过浏览器跨域；中转站转发成功但浏览器拦响应/白扣次数时用）。①含 {url} 前缀式 ②否则 代理/真实地址(去协议)。留空=直连
}

export interface ComfyConfig {
  apiUrl: string;            // ComfyUI 地址
  workflowJson: string;      // API 格式工作流 JSON
  positiveNode: string; positiveInput: string;   // 注入正向的节点id/输入名(默认 text)
  negativeNode: string; negativeInput: string;
  pollIntervalMs: number; timeoutSec: number;
  seed: string;
}

const DEFAULT_ARTIST_TAGS = `15::best quality,ultra-detailed,absurdres, very aesthetic, detailed, masterpiece::,1.2::8k,4k,highres::,
1.3::intricate details, finely detailed features, illustration::,
1.1::detailed eyes, detailed face::,
2.5::highly detailed texture, sharp focus, perfect anatomy::`;

const DEFAULT_PORTRAIT_NEG = `lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page`;

const DEFAULT_EQUIP_NEG = `人物, 人手, 模特, 穿戴者, 多个主体, 第二件装备, 文字, 印章, 水印, logo, 现代元素, 过度华丽, 夸张宝石, 复杂链坠, 尖刺过多, 浮空配件, 巨大光效, 魔法阵, 符文环, 粒子风暴, 强烈发光, 特效遮挡主体, 背景复杂, 构图拥挤, 脏污纸感, 模糊, 材质塑料感, 颜色过饱和`;

const DEFAULT_EQUIP_TEMPLATE = `请生成一张「单件装备设定图 / 概念设计稿」。画面只展示一件装备本体，**不出现人物、手、模特、穿戴者、第二件主体装备**，装备是唯一视觉主体。背景干净浅色底（暖米/奶油/浅灰），可有极淡纹样与柔和投影，留白清爽。整体风格清晰、精致、高级，装饰与特效克制。
装备信息（仅用于指导造型，不要把文字/字段名画进画面）：
物品名称：\${item_name}
装备类别：\${item_category}
品阶：\${item_grade}
适用性别：\${owner_gender}
外观描述：\${item_appearance}
用途/效果参考：\${item_effect}
请把以上信息转化为装备的造型、材质、颜色、纹路、比例、细节与表面处理。**世界风格自适应**：按外观描述判断该装备属于奇幻/科幻/现代/末世等何种世界并采用对应质感（金属/皮革/合金/能量/布料等），不要默认修仙仙气风。造型可信、结构合理、材质精致、工艺感明确；品阶感通过材质精度/比例/线条/工艺/细节层次体现，而非夸张外形或大面积特效。若该装备**来自已知同人/二次创作作品**，按原作设定的造型、配色、标志性细节准确还原。若有超凡/能量属性，只做克制的局部辉光/细小光点，不要巨大光圈或粒子爆炸。光影柔和干净有高级感。`;

/* 自然语言肖像模板（OpenAI/Gemini 等自然语言图像模型用；NAI/ComfyUI 走标签不用它）。
   占位符由角色档案字段填充，仿 fanren 的结构化组装。*/
const DEFAULT_PORTRAIT_TEMPLATE = `请生成一张高质量的单人角色半身肖像（仅一人，胸像/半身构图，面部为视觉中心，五官清晰可辨）。
角色：\${gender}，\${age}，阶位 \${tier}。
基础外貌与辨识点：\${appearance}。外貌细节：\${appearance_details}。
服装与随身外观以此为准：\${attire}。体态/身段：\${figure}。当前姿态参考：\${action}。
环境只作为光影、配色与氛围来源，不绘制复杂具体场景：\${location}。
若有额外画像锚点（最高优先级，自然融入）：\${portrait_prompt}。
姿态自然、构图居中、浅景深、光影柔和、画面干净。\${style_guide}`;

/* 画风(style)：一组可切换的提示词预设。切换时把各字段载入当前生图设置。
   - NAI/ComfyUI(标签型)：主要看 artistTags(画师串) + portraitPositive/Negative。
   - OpenAI/Gemini(自然语言)：用 portraitTemplate/equipTemplate（含 \${style_guide} 画风说明）。*/
export interface PortraitStyle {
  id: string;
  name: string;
  artistTags: string;        // 画师串/质量串（NAI 追加到正向末尾）
  styleGuide: string;        // 画风说明（填入自然语言模板的 ${style_guide}）
  portraitPositive: string;
  portraitNegative: string;
  portraitTemplate: string;  // 自然语言肖像模板
  equipTemplate: string;
  equipNegative: string;
}

export const DEFAULT_STYLES: PortraitStyle[] = [
  {
    id: 'nai-anime', name: 'NAI 动漫（默认）',
    artistTags: DEFAULT_ARTIST_TAGS, styleGuide: '画风：高质量日系动漫插画，干净线条，细腻上色。',
    portraitPositive: '', portraitNegative: DEFAULT_PORTRAIT_NEG,
    portraitTemplate: DEFAULT_PORTRAIT_TEMPLATE, equipTemplate: DEFAULT_EQUIP_TEMPLATE, equipNegative: DEFAULT_EQUIP_NEG,
  },
  {
    id: 'realistic', name: '写实电影感',
    artistTags: '2.0::photorealistic, realistic, masterpiece, best quality, ultra detailed::,1.4::cinematic lighting, film grain, depth of field, sharp focus, detailed skin::',
    styleGuide: '画风：真人电影感写实质感，电影布光，真实材质与皮肤质感，浅景深，克制的色彩分级。',
    portraitPositive: 'realistic, photorealistic, cinematic lighting',
    portraitNegative: DEFAULT_PORTRAIT_NEG + ', cartoon, anime, 3d, cel shading, flat color',
    portraitTemplate: DEFAULT_PORTRAIT_TEMPLATE, equipTemplate: DEFAULT_EQUIP_TEMPLATE, equipNegative: DEFAULT_EQUIP_NEG,
  },
  {
    id: 'thick-paint', name: '半写实厚涂',
    artistTags: '1.6::semi-realistic, thick coating, painterly, concept art, intricate details, masterpiece, best quality, dramatic lighting::',
    styleGuide: '画风：电影概念艺术级半写实厚涂，真人骨相比例，厚涂笔触，强戏剧光影，质感厚重。',
    portraitPositive: 'semi-realistic, painterly, concept art, dramatic lighting',
    portraitNegative: DEFAULT_PORTRAIT_NEG,
    portraitTemplate: DEFAULT_PORTRAIT_TEMPLATE, equipTemplate: DEFAULT_EQUIP_TEMPLATE, equipNegative: DEFAULT_EQUIP_NEG,
  },
];

/* 正文生图提示词模板（轮回乐园适配版，输出 N 个 <image>，含 anchor/nsfw_rating/prompt）*/
const DEFAULT_STORY_TEMPLATE = `你是轮回乐园世界的 NovelAI / NAI 正文插图提示词整理 AI。根据本轮正文，挑选 \${image_count} 个最有画面张力的正文瞬间，分别输出可直接投喂 NovelAI 的英文 tags 提示词。
不要生成 grid / storyboard / contact sheet；每个 <image> 对应一张独立图片。不要输出 col19、不要负面提示词、不要 Markdown。画师串由系统自动追加，无需写入。

在场角色完整外观资料：
\${onscreen_characters_full}

场景信息：时间 \${current_time} | 地点 \${current_location} | 新登场角色 \${entry_decision_new_characters}

当前正文：
\${story_text}

任务：生成 \${image_count} 条独立 NAI 正文生图提示词。
- 固定输出 \${image_count} 个 <image>，每个只含 1 个 <anchor>、1 个 <nsfw_rating>、1 个 <prompt>。
- <anchor>：逐字复制正文中连续出现的原文短片段（8~30字，可 Ctrl+F 命中），用于把图插到正文对应位置。
- <nsfw_rating>：只能是 sfw / nsfw_mild / nsfw_moderate / nsfw_explicit 之一，按画面实际呈现判定。
- <prompt>：英文 NAI tags，开头写主体数量与性别（1girl/1boy…），随后角色外貌/发型发色/眼睛/服装/体态/动作表情/场景/光影；NSFW 等级≥mild 时按等级加入对应裸露/行为 tags，忠实正文、不凭空添加。
- 每个角色尽量沿用在场角色外观资料里的画像锚点（第19列 imageTags），保证同角色多图一致。
- **同人/二次创作角色准确性**：若角色是已知动漫/游戏/小说等同人角色，必须输出**准确的 danbooru 角色 tags**——「角色名 tag(下划线式) + 作品/系列 tag + 该角色经典固定外观(发型发色/瞳色/标志性服装)」，不要泛化或张冠李戴；不确定标准 tag 时按其公认经典形象用具体特征 tag 准确还原。原创角色才用纯特征描述。

输出格式（不要其它内容）：
<image><anchor>正文短片段</anchor><nsfw_rating>sfw</nsfw_rating><prompt>1girl, ...</prompt></image>`;

export interface ImageGenSettings {
  portraitService: ImgService;
  storyService: ImgService;
  equipUsePortrait: boolean;        // 装备沿用肖像服务
  equipService: ImgService;         // 关闭沿用时用
  // 肖像
  portraitPromptFormat: 'nai' | 'danbooru' | 'natural';
  topAvatarCount: number;
  autoPortrait: boolean;
  refreshOnLook: boolean;
  portraitPositive: string;         // 肖像额外正向（追加）
  portraitNegative: string;
  portraitTemplate: string;         // 自然语言肖像模板（OpenAI/Gemini 用）
  styleGuide: string;               // 当前画风说明（填入模板 ${style_guide}）
  // 装备
  autoEquipPlayer: boolean; autoEquipNpc: boolean;
  equipTemplate: string; equipNegative: string;
  // 画风预设
  activeStyleId: string;
  // 正文配图
  autoStory: boolean; storyImageCount: number; storySize: string;
  storyTemplate: string;
  storyLlmRoutes: string[];         // 复用 apiLibrary endpoint id
}

interface ImageGenState extends ImageGenSettings {
  nai: NaiConfig;
  openai: OpenAIImgConfig;
  gemini: OpenAIImgConfig;
  custom: OpenAIImgConfig;
  comfy: ComfyConfig;
  styles: PortraitStyle[];          // 画风预设库
  // 各服务的 OpenAI 图片路由（主备 fallback，复用 apiLibrary）——MVP 先放单 config，路由可后续接 apiRoutes
  setService: (key: 'portraitService' | 'storyService' | 'equipService', v: ImgService) => void;
  setSettings: (patch: Partial<ImageGenSettings>) => void;
  setNai: (patch: Partial<NaiConfig>) => void;
  setOpenai: (patch: Partial<OpenAIImgConfig>) => void;
  setGemini: (patch: Partial<OpenAIImgConfig>) => void;
  setCustom: (patch: Partial<OpenAIImgConfig>) => void;
  setComfy: (patch: Partial<ComfyConfig>) => void;
  resetEquipTemplate: () => void;
  resetStoryTemplate: () => void;
  applyStyle: (id: string) => void;          // 切换画风：把该画风字段载入当前设置
  saveCurrentAsStyle: (name: string) => void; // 把当前设置存成新画风
  removeStyle: (id: string) => void;
  resetStyles: () => void;
}

/* OpenAI/Gemini/自定义 图片接口默认 CORS 代理（Cloudflare Pages 同源 /proxy/<upstream>）。默认填好，玩家可改/清空，改后持久化、刷新不丢。*/
export const DEFAULT_IMG_CORS_PROXY = 'https://zhushen-space.pages.dev/proxy';
const DEFAULT_OPENAI_IMG: OpenAIImgConfig = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-image-1', size: '1024x1024', quality: 'high', corsProxy: DEFAULT_IMG_CORS_PROXY };

export const useImageGen = create<ImageGenState>()(
  persist(
    (set) => ({
      portraitService: 'nai', storyService: 'nai', equipUsePortrait: true, equipService: 'nai',
      portraitPromptFormat: 'nai', topAvatarCount: 0, autoPortrait: false, refreshOnLook: true,
      portraitPositive: '', portraitNegative: DEFAULT_PORTRAIT_NEG,
      portraitTemplate: DEFAULT_PORTRAIT_TEMPLATE, styleGuide: DEFAULT_STYLES[0].styleGuide,
      autoEquipPlayer: false, autoEquipNpc: false, equipTemplate: DEFAULT_EQUIP_TEMPLATE, equipNegative: DEFAULT_EQUIP_NEG,
      activeStyleId: 'nai-anime',
      autoStory: false, storyImageCount: 4, storySize: 'inherit', storyTemplate: DEFAULT_STORY_TEMPLATE, storyLlmRoutes: [],
      styles: DEFAULT_STYLES.map((s) => ({ ...s })),

      nai: {
        apiUrl: 'https://image.novelai.net', corsProxy: '', apiToken: '', model: 'nai-diffusion-4-5-full',
        width: 1024, height: 1024, timeoutSec: 600, queueEnabled: true, queueGapSec: 10, rpm: 0,
        sampler: 'k_dpmpp_2m_sde', steps: 28, promptGuidance: 5, promptGuidanceRescale: 0, undesiredContentStrength: 1,
        negativePrompt: DEFAULT_PORTRAIT_NEG, artistTags: DEFAULT_ARTIST_TAGS, seed: '',
      },
      openai: { ...DEFAULT_OPENAI_IMG },
      gemini: { ...DEFAULT_OPENAI_IMG, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'imagen-3.0-generate-002' },
      custom: { ...DEFAULT_OPENAI_IMG, baseUrl: '' },
      comfy: { apiUrl: '', workflowJson: '', positiveNode: '', positiveInput: 'text', negativeNode: '', negativeInput: 'text', pollIntervalMs: 1200, timeoutSec: 600, seed: '' },

      setService: (key, v) => set({ [key]: v } as any),
      setSettings: (patch) => set((s) => ({ ...s, ...patch })),
      setNai: (patch) => set((s) => ({ nai: { ...s.nai, ...patch } })),
      setOpenai: (patch) => set((s) => ({ openai: { ...s.openai, ...patch } })),
      setGemini: (patch) => set((s) => ({ gemini: { ...s.gemini, ...patch } })),
      setCustom: (patch) => set((s) => ({ custom: { ...s.custom, ...patch } })),
      setComfy: (patch) => set((s) => ({ comfy: { ...s.comfy, ...patch } })),
      resetEquipTemplate: () => set({ equipTemplate: DEFAULT_EQUIP_TEMPLATE, equipNegative: DEFAULT_EQUIP_NEG }),
      resetStoryTemplate: () => set({ storyTemplate: DEFAULT_STORY_TEMPLATE }),
      applyStyle: (id) => set((s) => {
        const st = s.styles.find((x) => x.id === id);
        if (!st) return {} as any;
        return {
          activeStyleId: id,
          portraitPositive: st.portraitPositive, portraitNegative: st.portraitNegative,
          portraitTemplate: st.portraitTemplate, styleGuide: st.styleGuide,
          equipTemplate: st.equipTemplate, equipNegative: st.equipNegative,
          nai: { ...s.nai, artistTags: st.artistTags },
        } as any;
      }),
      saveCurrentAsStyle: (name) => set((s) => {
        const id = 'style_' + Date.now();
        const st: PortraitStyle = {
          id, name: name.trim() || `画风 ${s.styles.length + 1}`,
          artistTags: s.nai.artistTags, styleGuide: s.styleGuide,
          portraitPositive: s.portraitPositive, portraitNegative: s.portraitNegative,
          portraitTemplate: s.portraitTemplate, equipTemplate: s.equipTemplate, equipNegative: s.equipNegative,
        };
        return { styles: [...s.styles, st], activeStyleId: id } as any;
      }),
      removeStyle: (id) => set((s) => ({ styles: s.styles.filter((x) => x.id !== id) } as any)),
      resetStyles: () => set({ styles: DEFAULT_STYLES.map((s) => ({ ...s })) } as any),
    }),
    {
      name: 'drpg-image-gen',
      // 深合并嵌套配置：旧存档缺的新字段（如 nai.corsProxy）用默认值补全，
      // 避免输入框 value 从 undefined→有值 触发"受控/非受控切换"警告。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as any;
        return {
          ...current,
          ...p,
          nai: { ...current.nai, ...(p.nai ?? {}) },
          openai: { ...current.openai, ...(p.openai ?? {}) },
          gemini: { ...current.gemini, ...(p.gemini ?? {}) },
          custom: { ...current.custom, ...(p.custom ?? {}) },
          comfy: { ...current.comfy, ...(p.comfy ?? {}) },
        };
      },
    },
  ),
);

/* 取某用途实际使用的服务 */
export function effectiveEquipService(s: ImageGenState): ImgService {
  return s.equipUsePortrait ? s.portraitService : s.equipService;
}
