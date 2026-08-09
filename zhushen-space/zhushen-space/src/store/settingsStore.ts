import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { debouncedStorage } from '../systems/compressedStorage';   // 合并写盘：settings 块大（正则库/预设/词典），改一个开关也全量 stringify+写盘
import { importEmbeddedAgentAssets } from '../systems/agent/agentAssets';   // TT 预设内嵌 Agent 资产（skill/子代理）导入（仅依赖 agentSkillStore·无环）
import { setUserDict } from '../i18n/userDict';

// position: 0=角色前 1=角色后 2=作者注释上 3=作者注释下 4=主提示前 5=主提示后
export interface WorldBookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;   // 绿灯：关键词触发
  selective: boolean;  // 蓝灯：常驻，始终插入
  enabled: boolean;
  order: number;       // 插入排序权重
  position: number;    // 插入位置
  depth?: number;      // @D 深度注入（position===4 时）：插到对话历史倒数第 N 层
  role?: number;       // @D 注入身份：0=system 1=user 2=assistant
  userEdited?: boolean;   // 玩家改过此条（仅内置书用）：内置更新时不覆盖它；若内置又改了同条→冲突询问
  baseSig?: string;       // 首次改动时捕获的「内置原文签名」：3方合并判断内置是否又更新过此条（避免误报冲突）
  userAdded?: boolean;    // 玩家在内置书里新增的条目：内置更新时始终保留
}

export interface WorldBook {
  id: string;
  name: string;
  entries: WorldBookEntry[];
  enabled: boolean;
  createdAt: number;
  builtin?: boolean;   // 内置默认书：来自 public/presets，每次启动重载、不写入 localStorage（省配额）
  builtinKey?: string; // 内置书的稳定标识（不随改名/转正变化）：供 loadBuiltinDefaults 逐本判重，避免改一本丢其余内置
  removedBuiltinUids?: number[];   // 玩家从内置书删掉的条目 uid：内置更新时不再把它加回来
}

// 内置世界书更新时，「内置改了、玩家也改了同一条」的冲突（策略B：逐条让玩家裁决）。
export interface WorldbookConflict {
  bookId: string; bookName: string; uid: number; comment: string;
  freshEntry: WorldBookEntry;   // 内置最新版
  userEntry: WorldBookEntry;    // 玩家当前版
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

/** 中心 API 接口库条目（综合设置统一维护，各功能可快捷选填）*/
export interface ApiEndpoint extends ApiConfig {
  id: string;
  name: string;
  enabled: boolean;
}
/** 从接口库条目取出纯 ApiConfig 字段 */
export function endpointToConfig(e: ApiEndpoint): ApiConfig {
  return { baseUrl: e.baseUrl, apiKey: e.apiKey, modelId: e.modelId, temperature: e.temperature, maxTokens: e.maxTokens, topP: e.topP };
}
/** 解析某功能的接口调用链（按优先级，上=先调用，失败 fallback）。
 *  路由有启用接口 → 返回该链；否则回退到传入的 legacy 单配置。 */
export function resolveApiChain(key: string, legacy: ApiConfig): ApiConfig[] {
  const s = useSettings.getState();
  const ids = s.apiRoutes?.[key] ?? [];
  const chain = ids
    .map((id) => s.apiLibrary.find((e) => e.id === id))
    .filter((e): e is ApiEndpoint => !!e && e.enabled && !!e.baseUrl && !!e.apiKey)
    .map(endpointToConfig);
  return chain.length ? chain : [legacy];
}

/** Agent 正文模式·预设解析：按 agentNarrative.presetName 找预设（玩家改过的非 builtin 同名版优先，
 *  与 resolveActivePreset 的「玩家副本优先」口径一致）。未配置/找不到 → null（＝跟随当前正文预设）。 */
export function resolveAgentPreset(): TextGenPreset | null {
  const s = useSettings.getState();
  const nm = (s.agentNarrative?.presetName || '').trim();
  if (!nm) return null;
  const list = s.textPresets ?? [];
  return list.find((p) => p.name === nm && !(p as { builtin?: boolean }).builtin)
    ?? list.find((p) => p.name === nm)
    ?? null;
}

// SillyTavern 正则脚本（兼容 ST 导出格式）
export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;       // 正则表达式字符串
  replaceString: string;   // 替换内容，支持 $1 $2 等捕获组
  trimStrings: string[];   // 执行前先 trim 掉这些字符串
  placement: number[];     // 0=用户输入 1=AI输出
  disabled: boolean;
  flags: string;           // 'g' | 'i' | 'gi' | 'm' 等
  // ── ST「视图作用域」：决定这条正则作用在哪一层（照搬 SillyTavern，applyRegex 按 stage 消费）──
  markdownOnly?: boolean;  // 仅格式化显示：只改屏幕渲染，绝不进发给AI/演化的文本（美化框专用）
  promptOnly?: boolean;    // 仅格式化提示词/对AI隐藏：只作用于发给AI的文本，不影响显示（别让它把美化框从屏幕删空）
  // 以下字段本项目暂不消费，仅原样保留以便无损重导出为 ST 预设
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
}

// SillyTavern Prompt Manager 格式的单条 prompt
export interface STPromptEntry {
  identifier: string;
  name: string;
  role: string;        // 'system' | 'user' | 'assistant'
  content: string;
  enabled: boolean;
  system_prompt: boolean;
  marker: boolean;
  injection_position?: number;
  injection_depth?: number;
}

// 导入后的完整预设（兼容 ST prompt_manager 格式）
export interface TextGenPreset {
  id: string;
  name: string;
  entries: STPromptEntry[];
  regexScripts: RegexScript[];
  builtin?: boolean;   // 内置默认预设：每次启动重载、不写入 localStorage
  // 生成参数
  temperature?: number;
  max_tokens?: number;      // 最大回复长度
  context_length?: number;  // 上下文长度
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;            // -1 = 随机
  n?: number;               // 每次生成几个备选
  stream?: boolean;
}

function extractRegexFromPreset(data: any): RegexScript[] {
  // ST 在不同位置可能存放正则脚本，按优先级依次查找
  const raw =
    data.regex_scripts ??                           // 顶层 regex_scripts
    data.extensions?.regex_scripts ??              // extensions.regex_scripts
    data.data?.extensions?.regex_scripts ??        // 角色卡内嵌格式
    data.regexScripts ??                           // 本项目自定义字段
    null;

  if (!Array.isArray(raw) || raw.length === 0) return [];
  return parseRegexArr(raw);
}

function parseSTPreset(data: any, fileName: string, id: string, stOrderFaithful = false): TextGenPreset {
  const name = data.name ?? data.preset_name ?? fileName ?? '未命名预设';
  const regexScripts = extractRegexFromPreset(data);

  // ── ST Prompt Manager 格式：有 prompts 数组 ──
  if (Array.isArray(data.prompts)) {
    // 生效序选份：ST 惯例上 chat-completion 预设的默认序挂在 character_id=100001（dummy 角色）。
    // 带多份 order 的预设（如 Fairy_Tale 2.3.0 的 100000/100001 两份）取 [0] 会选错份 → 优先 100001；
    // 单份 order 的预设行为与旧版完全一致。
    let orderArr: { identifier: string; enabled: boolean }[] = [];
    if (Array.isArray(data.prompt_order)) {
      const withOrder = data.prompt_order.filter((o: any) => o && Array.isArray(o.order));
      const chosen = withOrder.find((o: any) => o.character_id === 100001) ?? withOrder[0];
      if (chosen) orderArr = chosen.order;
      else orderArr = data.prompt_order;   // 裸 [{identifier,enabled}] 数组形态
    }
    const keyOf = (p: any) => String(p.identifier ?? p.id ?? p.name ?? '');
    const toEntry = (p: any, enabled: boolean): STPromptEntry => ({
      identifier:        p.identifier ?? p.id ?? p.name ?? String(Math.random()),
      name:              p.name ?? p.identifier ?? '(无名)',
      role:              p.role ?? 'system',
      content:           p.content ?? '',
      enabled,
      system_prompt:     Boolean(p.system_prompt),
      marker:            Boolean(p.marker),
      injection_position: p.injection_position,
      injection_depth:   p.injection_depth,
    });

    if (stOrderFaithful && orderArr.length) {
      // 忠实 ST 语义（**仅显式指定时**，当前只用于两枚 Agent 内置预设的补种）：条目按 order 序拼装、
      // 启用以 order 为准、不在 order 的库存条目保留但禁用（ST 里它们本就不进 montage）。
      // ⚠ 不能作为默认：本作社区预设生态多年按「库序 + 库存条目缺省启用」的旧行为调教，
      //   默认忠实化会让玩家重导旧预设后条目顺序/启用集突变 → 正文格式崩（2026-08-02 玩家实测回归，已回退默认）。
      const lib = new Map<string, any>();
      for (const p of data.prompts) { const k = keyOf(p); if (k && !lib.has(k)) lib.set(k, p); }
      const entries: STPromptEntry[] = [];
      const seen = new Set<string>();
      for (const o of orderArr) {
        const k = String(o.identifier ?? '');
        const p = lib.get(k);
        if (!p || seen.has(k)) continue;
        seen.add(k);
        entries.push(toEntry(p, o.enabled !== false));
      }
      for (const p of data.prompts) {
        const k = keyOf(p);
        if (!k || seen.has(k)) { if (!k) entries.push(toEntry(p, false)); continue; }
        seen.add(k);
        entries.push(toEntry(p, false));
      }
      return { id, name, entries, regexScripts, ...extractGenParams(data) };
    }
    // 默认（生态兼容·与历史行为一致）：prompts 库序拼装；在 order 里的按 order 启用状态，
    // 不在 order 里的按条目自带 enabled（缺省启用）。
    const enabledMap = new Map(orderArr.map((o) => [String(o.identifier ?? ''), o.enabled !== false]));
    const entries: STPromptEntry[] = data.prompts.map((p: any) => {
      const k = keyOf(p);
      return toEntry(p, enabledMap.has(k) ? enabledMap.get(k)! : (p.enabled !== false));
    });
    return { id, name, entries, regexScripts, ...extractGenParams(data) };
  }

  // ── 本应用自身导出格式：顶层直接是 entries 数组（STPromptEntry[]），原样复用，保证导出→再导入不丢条目 ──
  if (Array.isArray(data.entries)) {
    const entries: STPromptEntry[] = data.entries.map((p: any) => ({
      identifier:         p.identifier ?? p.id ?? p.name ?? String(Math.random()),
      name:               p.name ?? p.identifier ?? '(无名)',
      role:               p.role ?? 'system',
      content:            p.content ?? '',
      enabled:            p.enabled !== false,
      system_prompt:      Boolean(p.system_prompt),
      marker:             Boolean(p.marker),
      injection_position: p.injection_position,
      injection_depth:    p.injection_depth,
    }));
    return { id, name, entries, regexScripts, ...extractGenParams(data) };
  }

  // ── 简单/自定义格式：无 prompts，尝试提取 system_prompt 字段作为单条 ──
  const fallbackContent = data.system_prompt ?? data.main_prompt ?? data.content ?? '';
  return {
    id, name,
    entries: fallbackContent ? [{
      identifier: 'main',
      name: '系统提示词',
      role: 'system',
      content: fallbackContent,
      enabled: true,
      system_prompt: true,
      marker: false,
    }] : [],
    regexScripts,
    ...extractGenParams(data),
  };
}

function extractGenParams(data: any): Partial<TextGenPreset> {
  const n = (key: string) => typeof data[key] === 'number' ? data[key] : undefined;
  const b = (key: string) => typeof data[key] === 'boolean' ? data[key] : undefined;
  return {
    temperature:        n('temperature'),
    max_tokens:         n('max_tokens') ?? n('openai_max_tokens') ?? n('maxTokens'),
    context_length:     n('context_length') ?? n('openai_max_context') ?? n('max_context'),
    top_p:              n('top_p') ?? n('topP'),
    frequency_penalty:  n('frequency_penalty'),
    presence_penalty:   n('presence_penalty'),
    seed:               n('seed'),
    n:                  n('n'),
    stream:             b('stream'),
  };
}

/* 世界详情注入（世界详情库档案 → 正文；引擎 systems/worldDetailInject.ts，UI 在 变量管理→世界详情注入） */
export interface WorldDetailInjectConfig {
  mode: 'layered' | 'full' | 'off';       // 正文注入模式：layered=分层节选(默认) / full=整份档案(旧行为·档案会摊开含后续剧情) / off=不注入
  budget: 'lean' | 'standard' | 'rich';   // 分层体量档位 → 三层预算成套缩放（见 worldDetailInject.BUDGET_SCALE）
  outlineFull: boolean;                   // 细纲(规划层)是否拿完整档案（含未来阶段+隐藏剧情）；关=细纲也用分层节选
}

export interface NarrativeMemConfig {
  enabled: boolean;                // 启用叙事记忆（关键词召回）
  recentFullTextCount: number;     // 最近正文全文保留条数（0-10）
  distantKeywordThreshold: number; // 远层记忆标题关键词阈值（0-5000；超过此名次只留标题）
  recallTopK: number;              // 关键词召回 Top-K
  recallMinScore: number;          // 召回最低命中分
  requestTimeout: number;          // 单次 LLM 请求超时（秒）
  llmMode: boolean;                // 用 LLM 做发送前查询改写 + 回复后事实抽取
  compileModelId: string;          // 发送前整理模型（空=用 nmApi.modelId）
  ingestModelId: string;           // 回复后写入模型（空=用 nmApi.modelId）
  // ── 结构化档案召回（把主角/在场NPC的完整档案+技能+装备注入正文）──
  structEnabled: boolean;          // 启用结构化档案召回
  structApiSelect: boolean;        // 用 API 判定注入哪些结构化条目(NPC)：开则按"用户输入+最近正文"调一次 API 选 NPC；关则本地排序(在场/好感)兜底
  structMaxNpcs: number;           // 注入的 NPC 数量上限（主角必含、不占此额度）
  structMaxSkills: number;         // 主角注入的技能数量上限
  structMaxItems: number;          // 主角注入的装备数量上限（材料/消耗品全显示、其它不注入）
  structMaxNpcSkills: number;      // 每个 NPC 注入的技能上限（0=全量）——治"NPC 几十个技能满装备撑爆上下文"；超出的仅列名称
  structMaxNpcTalents: number;     // 每个 NPC 注入的天赋上限（0=全量）；超出的仅列名称
  structMaxNpcItems: number;       // 每个 NPC 注入的物品/装备上限（0=全量）；超出的仅列名称
  structMaxSubProfs: number;       // 主角注入的副职业数量上限
  structMaxFactions: number;       // 注入的当前世界势力数量上限
}

/* 向量召回（语义记忆）——与关键词叙事记忆并行的另一套召回引擎，自带 embedding 端点。
   启用后接管召回（优先于关键词叙事记忆）：把长期记忆条目随时 embed → 每回合 embed 当前情境 → cosine topK 注入，无 LLM 调用。 */
export interface VecMemConfig {
  enabled: boolean;            // 启用向量召回（开则接管召回，优先于关键词叙事记忆）
  apiBase: string;             // embedding 接口地址（OpenAI 兼容 /embeddings）
  apiKey: string;
  model: string;               // embedding 模型（如 bge-m3 / text-embedding-3-small）
  topK: number;                // cosine 召回条数（rerank 关时=最终注入条数；开时=精排后取几条）
  threshold: number;           // 最低相似度（0~1）
  recentFullTextCount: number; // 最近正文全文保留条数
  maxItems: number;            // 索引的记忆条目上限（与事实 FIFO 解耦，可放大）
  factsOnly?: boolean;         // 只召回长期事实：小结/大结/世界大事都不进池（默认关=全都进）
  // ── rerank 精排（可选·默认关）：余弦粗召回一批 → 交叉编码器 rerank 精排 → 取 topK，比纯余弦更准 ──
  rerankEnabled?: boolean;     // 启用 rerank 精排（需配下面接口）
  rerankBase?: string;         // rerank 接口地址（Cohere/Jina/SiliconFlow 兼容 /rerank）
  rerankKey?: string;
  rerankModel?: string;        // rerank 模型（如 BAAI/bge-reranker-v2-m3）
  rerankCandidates?: number;   // 精排前的余弦候选宽度（默认 40；喂给精排的料）
  rerankThreshold?: number;    // 精排后最低相关分（0~1，默认 0=不筛）
}

export type NarrativePov = 'off' | 'first' | 'second' | 'third';  // 叙事人称：off=跟随预设（不干预）

// 界面语言（仅影响 UI chrome，AI 正文不变）：zh-Hans=简体(源码原样) / zh-Hant=繁體(OpenCC 运行时转换) / en=英文(人工词库) / vi=越南语(人工本地化词库)
export type UiLang = 'zh-Hans' | 'zh-Hant' | 'en' | 'vi';

interface SettingsState {
  // 综合设置
  historyLimit: number;   // 0 = 不限制；> 0 = 仅显示/发送最近 N 条消息
  autoSaveEnabled: boolean;   // 自动存档总开关（关 = 每回合不自动存，需手动「新建/覆盖存档」；省内存/防大档撑爆）
  autoSaveEvery: number;      // 每 N 回合自动存一次（1=每回合；调大=减少自动存频率与体积压力）
  branchCapture: boolean;     // 🌿 分支树：⟳重新生成/↩回退 前自动把「被丢弃那条时间线」存成可回收支线（缺省=开；关=弃稿照旧直接丢，省存储）
  setBranchCapture: (v: boolean) => void;
  disableEnterSend: boolean;  // 禁用回车发送（防误触）：开启后输入框回车不再发送，只能点发送按钮
  setDisableEnterSend: (v: boolean) => void;
  showNewlineButton: boolean;  // 是否在正文输入框旁显示「↵ 换行键」（Shift+Enter 始终可换行，不受此开关影响）
  setShowNewlineButton: (v: boolean) => void;
  weatherFx: boolean;  // 顶栏天气/天启特效（动态天空背景+粒子动画）总开关；关闭后顶栏维持原暗色、零开销
  setWeatherFx: (v: boolean) => void;
  audio: { enabled: boolean; volume: number; ambient: boolean; ambientVolume: number; music: boolean; musicVolume: number; musicShuffle: boolean; musicConsent: '' | 'granted'; musicCategory: string; musicPos: { x: number; y: number } | null };   // 游戏音效（…/当前主题/迷你播放器悬浮位置：null=默认左下角，拖动后记忆）
  setAudio: (patch: Partial<{ enabled: boolean; volume: number; ambient: boolean; ambientVolume: number; music: boolean; musicVolume: number; musicShuffle: boolean; musicConsent: '' | 'granted'; musicCategory: string; musicPos: { x: number; y: number } | null }>) => void;
  allowAutoEquip: boolean;  // 是否允许 AI 自动装备主角拾取/生成的装备（关闭=仅能在装备面板手动穿戴）
  setAllowAutoEquip: (v: boolean) => void;
  // ACU 表格数据库·填表调度：enabled=总开关（关则不再每回合注入填表规则+剧情表·AI 不维护表）；everyN=每 N 回合才填一次（1=每回合·默认）；only=只维护这些剧情表(uid: chronicle/progress/foreshadowing/pacts·空=全部)
  tableFill: { enabled: boolean; everyN: number; only: string[] };
  setTableFill: (patch: Partial<{ enabled: boolean; everyN: number; only: string[] }>) => void;
  // ⏩ 推进预设（多条推进语·⏩ 用选中那条·空则回退 PLOT_ADVANCE_DIRECTIVE）+ 循环自动推进（连推 maxLoops 拍·每拍间隔 delayMs·用户手动发送即中断）
  advancePresets: { name: string; text: string }[];
  advanceSelected: number;
  autoAdvance: { maxLoops: number; delayMs: number };
  setAdvancePresets: (v: { name: string; text: string }[]) => void;
  setAdvanceSelected: (i: number) => void;
  setAutoAdvance: (patch: Partial<{ maxLoops: number; delayMs: number }>) => void;
  allowAutoEquipNpc: boolean;  // 是否允许自动给 NPC 穿戴装备（含初始装备与 AI 装备指令；关闭=只入 NPC 储存空间）
  setAllowAutoEquipNpc: (v: boolean) => void;
  customOpening: string;  // 自定义开场白模板（角色创建确认后自动发送；含 ${...} 占位符，空=用内置默认）
  reading: { fontSize: number; letterSpacing: number; lineHeight: number; paraSpacing: number; fontFamily: 'default' | 'kai' | 'song'; dialogueHl: boolean; innerDim: boolean; codexHl: boolean; codexWiki: boolean };  // 正文阅读排版：字号/字间距/行距/段落间距(em)/字体 + 对话高亮(dialogueHl)/心理·旁白弱化(innerDim)/关键词悬浮图鉴(codexHl，缺省=开)/图鉴并入轮回wiki人物(codexWiki，缺省=关·含原著剧透)；默认 17/0/1.8/0.45/default/开/开/开/关
  setReading: (patch: Partial<{ fontSize: number; letterSpacing: number; lineHeight: number; paraSpacing: number; fontFamily: 'default' | 'kai' | 'song'; dialogueHl: boolean; innerDim: boolean; codexHl: boolean; codexWiki: boolean }>) => void;
  storyStrip: { on: boolean; quest: boolean; thread: boolean; time: boolean; almanac: boolean };   // 楼层信息条（components/StoryStrip）：贴在最新正文末尾的扁条，四段=世界时间·天气 / 任务 / 伏笔 / 历(未来七天)，点某段就地展开。纯只读展示：不调 API、不写 store、不注入 AI；全段关掉即整条不出现
  setStoryStrip: (patch: Partial<{ on: boolean; quest: boolean; thread: boolean; time: boolean; almanac: boolean }>) => void;
  uiTheme: string;  // 主题配色（整体界面色+文字色）key，见 systems/uiThemes.ts（default/solarized-light/gruvbox-light/nord/dracula…）
  setUiTheme: (v: string) => void;
  appearance: 'classic' | 'eyecare' | 'warm';  // 外观护眼色调（叠加在主题之上的暖光滤镜）：classic=关 / eyecare=柔光护眼 / warm=夜读暖光；全局固定层，pointer-events:none
  setAppearance: (v: 'classic' | 'eyecare' | 'warm') => void;
  uiVignette: boolean;  // 背景暗角氛围：四周轻微压暗、聚焦中央正文（纯视觉·pointer-events:none）
  setUiVignette: (v: boolean) => void;
  uiUnify: boolean;  // 统一排版规范（界面外观）：圆角三档归一/面板 text-sm 行高 1.6/游离描边归 edge——纯 CSS 令牌层（tailwind 变量路由，见 index.css data-ui-unify），关=逐像素回原样；正文楼层排版仍归 reading 管
  setUiUnify: (v: boolean) => void;
  navGrouped: boolean;  // 右侧导航分组（P4·默认开）：48 项平铺 → 按 角色/伙伴/世界/乐园设施/社交联机/传承/系统 分区显示；关=回原平铺列表（老玩家习惯保留，外观设置可切）
  setNavGrouped: (v: boolean) => void;
  navCollapsed: string[];  // 已折叠的导航分组名（仅分组模式生效）：从不用的整组收起来，跨会话记住。默认 []=全展开（老玩家现状不变）
  toggleNavGroup: (name: string) => void;
  setNavCollapsed: (names: string[]) => void;
  holoCardFx: boolean;  // 全息卡片特效总开关：on=立绘/物品/装备显示全息卡（默认）；off=普通图片（回退原样）
  setHoloCardFx: (v: boolean) => void;
  plotChoices: boolean;   // 剧情选项：每段正文生成后，额外生成 8 个主角行动选项（最后 1 个限制级）
  setPlotChoices: (v: boolean) => void;
  fanficMode: boolean;    // 同人增强：识别已知作品角色→输出/锁定设定→下回合注入正文防 OOC
  setFanficMode: (v: boolean) => void;
  factCheck: boolean;     // 事实增强：核实正文里的现实可查证元素→锁定时代/事实锚点→下回合注入防穿帮
  setFactCheck: (v: boolean) => void;
  miniTheater: boolean;   // 小剧场：每段正文后让 AI 读内置「小剧场世界书」，生成番外彩蛋 HTML 折叠块附在正文末尾
  setMiniTheater: (v: boolean) => void;
  npcAutonomyOn: boolean;   // 离场角色自治（轨道A）：每回合零 API 推进离场 NPC 的「出任务/主神空间」生活并写经历
  setNpcAutonomyOn: (v: boolean) => void;
  npcAutonomyDeath: boolean; // 离场自治·允许任务致死（陨落）；默认关，仅 npcAutonomyOn 开时生效；护好友/羁绊/长留/队友
  setNpcAutonomyDeath: (v: boolean) => void;
  npcAutonomyMax: number;    // 离场自治·每次运行最多演化的 NPC 数（控性能/刷屏；超出的按轮换分批）
  setNpcAutonomyMax: (v: number) => void;
  npcAutonomyEvery: number;  // 离场自治·每 N 回合运行一次（1=每回合）
  setNpcAutonomyEvery: (v: number) => void;
  narrativePov: NarrativePov;   // 叙事人称：off=跟随预设（不注入）；first/second/third=强制注入到正文 system 末尾（权重最高）
  setNarrativePov: (v: NarrativePov) => void;
  language: UiLang;   // 界面语言（运行时翻译层读取；只译界面 chrome，不动 AI 正文/.narrative-content）
  setLanguage: (v: UiLang) => void;
  autoTranslateOnline: boolean;   // 在线内容（交易行/聊天室/助战…跨玩家 UGC）自动机翻成当前语言（缓存）
  setAutoTranslateOnline: (v: boolean) => void;
  autoTranslateEngine: 'ai' | 'free';   // 机翻引擎：ai=玩家自己的LLM(耗额度·最地道) / free=MyMemory免费机翻(不耗额度)
  setAutoTranslateEngine: (v: 'ai' | 'free') => void;
  autoTranslateManual: boolean;   // 机翻手动触发：开=不自动跑机翻(只留词库+繁體转换)、靠悬浮「译」按钮点触；关=自动补全
  setAutoTranslateManual: (v: boolean) => void;
  evolveOutputLang: boolean;   // 演化内容直接用当前语言生成(注入各演化提示词)：越/英界面下让 AI 输出越/英内容·非简体才生效
  setEvolveOutputLang: (v: boolean) => void;
  userGlossary: Partial<Record<UiLang, Record<string, string>>>;   // 用户导入的翻译覆盖表（运行时优先于内置 en.ts/vi.ts）
  glossaryVersion: number;   // 导入后 +1，供 DomI18n 重新套用整页
  setUserGlossary: (lang: UiLang, map: Record<string, string>) => void;
  apiLibrary: ApiEndpoint[];   // 中心 API 接口库（综合设置维护，各功能快捷选填）
  apiRoutes: Record<string, string[]>;  // 各功能的接口路由：featureKey → 有序 endpoint id 列表（上=优先，失败 fallback）
  apiThrottle: { maxConcurrent: number; minGapMs: number };  // 全局请求节流：最大并发 + 最小间隔（缓解 429）
  phaseSched: Record<string, { every: number; read: number }>;  // 各演化阶段：every=每N回合调用一次，read=读取最近N回合正文（默认 1/1）
  addApiEndpoint: () => void;
  addGatewayEndpoints: (workerBase?: string) => void;   // 一键加 AI Studio + Vertex 网关两条接口
  updateApiEndpoint: (id: string, patch: Partial<ApiEndpoint>) => void;
  removeApiEndpoint: (id: string) => void;
  moveApiEndpoint: (id: string, dir: -1 | 1) => void;
  setApiRoute: (key: string, ids: string[]) => void;
  setApiThrottle: (patch: Partial<{ maxConcurrent: number; minGapMs: number }>) => void;
  setPhaseSched: (key: string, patch: Partial<{ every: number; read: number }>) => void;
  narrativeMemory: NarrativeMemConfig;
  worldDetailInject: WorldDetailInjectConfig;   // 世界详情注入（世界详情库 → 正文的分层注入引擎；UI 在 变量管理）
  setWorldDetailInject: (patch: Partial<WorldDetailInjectConfig>) => void;
  vectorMemory: VecMemConfig;       // 向量召回（与关键词叙事记忆并行的另一套引擎）
  setVectorMemory: (patch: Partial<VecMemConfig>) => void;
  nmApi: ApiConfig;
  nmUseSharedApi: boolean;
  nmAvailableModels: string[];
  nmModelsLoading: boolean;
  nmModelsError: string;

  // 世界选择模块
  api: ApiConfig;
  availableModels: string[];
  modelsLoading: boolean;
  modelsError: string;
  systemPrompt: string;
  worldBooks: WorldBook[];

  // 正文生成模块
  textApi: ApiConfig;
  textUseSharedApi: boolean;
  textStream: boolean;
  skipNarrativeThinking: boolean;   // 正文末尾预填充 </think>，让思考模型跳过原生思维链直接出正文（提速·省 token）
  forceNarrativeThinking: boolean;  // 正文末尾预填充 <think>，以 assistant 预填充强制模型从思维链开写（根治「正文思维链时有时无」·与 skip 互斥）
  // ── 酒馆美化适配（渲染层·参考 SillyTavern）──
  thinkDisplay: 'hidden' | 'fold' | 'open';   // 正文思维链显示：hidden=整段隐藏(旧行为) fold=折叠块(ST Reasoning 同构·默认) open=默认展开；仅显示层，提示词/历史照旧剥净
  htmlExternalMedia: boolean;       // 楼内 HTML/美化 CSS 允许加载外链媒体（img src / css url() 指向站外）；关=一律剥掉（ST「Forbid external media」同款）
  customCss: { text: string; scope: 'chat' | 'global'; enabled: boolean };   // 全局自定义 CSS（酒馆美化包入口）：scope=chat 时选择器强制作用域进聊天区，global=原样全局注入
  renderHtmlSandbox: boolean;       // 前端卡：正文里 ```html 代码块/完整 HTML 文档渲染成 sandbox iframe（脚本可跑·与宿主完全隔离）；默认关
  plotGuidance: boolean;            // 剧情指导：正文生成前先跑一次"剧情优化建议"调用 → 像叙事回忆一样注入主正文（仅一次正文生成·受指导）
  planningReview: boolean;          // 正文前审核窗：剧情指导/数据库推进的产出先弹窗给玩家编辑确认，再写正文（细纲本就有弹窗）
  guidancePrompt: string;           // 剧情指导自定义提示词（留空=用内置 PLOT_GUIDANCE_RULE）
  choicesPrompt: string;            // 剧情选项自定义提示词·**完全覆盖**（留空=用内置 PLOT_CHOICES_RULE；填了则整段替换掉内置的选项规则）
  // 细纲：正文生成前先跑一次「细纲师」（信息注入与正文一致·独立API·A2：不带正文预设只发 OUTLINE_GEN_RULE）→ 弹窗给玩家编辑 → 确认后作为「必须遵循」深注入正文。与剧情指导/数据库推进三选一互斥（UI 侧强制）。
  outlineEnabled: boolean;
  outlinePrompt: string;            // 细纲生成自定义提示词·**完全覆盖**（留空=用内置 OUTLINE_GEN_RULE；填了则整段替换掉内置的人设/COT/格式）
  outlineBias: string;              // 细纲「创作偏好/倾向」·**追加**（追加在内置提示词后·只改"写什么/往哪偏/侧重什么"·不动内置格式/层级/字段）
  outlineWordTarget: number;        // 细纲/正文的字数目标（0=不限定，由 AI 按体量把握）
  outlineApi: ApiConfig;            // 细纲独立 API（outlineUseSharedApi=false 时用；否则复用正文/共享 API，或配 'outline' 路由）
  outlineUseSharedApi: boolean;
  preludePrompt: string;            // 玩家常驻「前置提示词」：每回合注入正文最深处(紧贴输入前)，玩家可编辑；留空=不注入
  // Agent 正文模式（仿 TauriTavern·独立于 legacy 的另一种正文生成，见 docs/AGENT_MODE_PLAN.md）：
  //   模型带工具循环产稿（查档案/搜历史/打草稿）→ commit 成楼层 → finish；终态后走既有 <state> 解析/演化。
  //   API 完全独立：默认用 agentApi / 'agent' 路由；useTextApi=true 才复用正文 API。关闭时这里的 API 绝不会被调用。
  agentNarrative: import('../systems/agent/agentTypes').AgentNarrativeSettings;
  agentApi: ApiConfig;              // Agent 模式独立 API（agentNarrative.useTextApi=false 时用；'agent' 路由优先）
  agentProfiles: import('../systems/agent/agentTypes').AgentProfileSnapshot[];   // P2·配置档案（命名快照：cfg+独立API+路由；一键应用）
  // 角色立场简报：给「正文前的规划调用」（细纲 / 数据库推进）额外喂一份**只含人格**的瘦档案（性格/四轴/原则/口癖/关系/动机），
  //   让它按人设排演本回合各角色的反应，再随规划产物一起注入正文（治配角同质化/OOC/谄媚）。
  //   只在细纲或数据库推进开启时生效（两者本就与剧情指导三选一），**不新增任何 API 调用**。见 systems/castBrief.ts
  castBrief: boolean;
  castBriefMax: number;             // 最多喂几位候选角色（默认 6；人多字段少，总开销低于 2 张全量 NPC 卡）
  textAvailableModels: string[];
  textModelsLoading: boolean;
  textModelsError: string;
  textWorldBooks: WorldBook[];
  worldbookConflicts: WorldbookConflict[];   // 内置世界书更新遇到的「双改」冲突，待玩家逐条裁决（策略B）
  textPresets: TextGenPreset[];
  activeTextPresetId: string | null;
  activeTextPresetName?: string;   // 记住激活预设的「名字」，内置预设 id 失配时按名兜底找回
  globalRegexScripts: RegexScript[];

  // 世界选择操作
  setApi: (patch: Partial<ApiConfig>) => void;
  fetchModels: () => Promise<void>;
  setSystemPrompt: (prompt: string) => void;
  importWorldBook: (raw: string, fileName?: string, builtin?: boolean, builtinKey?: string) => { ok: boolean; message: string };
  toggleWorldBook: (id: string) => void;
  removeWorldBook: (id: string) => void;
  dedupeWorldBooks: () => number;
  renameWorldBook: (id: string, name: string) => void;
  toggleWorldBookEntry: (bookId: string, uid: number) => void;
  updateWorldBookEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addWorldBookEntry: (bookId: string) => void;
  removeWorldBookEntry: (bookId: string, uid: number) => void;

  // 正文生成操作
  setTextApi: (patch: Partial<ApiConfig>) => void;
  setTextUseSharedApi: (v: boolean) => void;
  setTextStream: (v: boolean) => void;
  setSkipNarrativeThinking: (v: boolean) => void;
  setForceNarrativeThinking: (v: boolean) => void;
  setThinkDisplay: (v: 'hidden' | 'fold' | 'open') => void;
  setHtmlExternalMedia: (v: boolean) => void;
  setCustomCss: (patch: Partial<{ text: string; scope: 'chat' | 'global'; enabled: boolean }>) => void;
  setRenderHtmlSandbox: (v: boolean) => void;
  setPlotGuidance: (v: boolean) => void;
  setPlanningReview: (v: boolean) => void;
  setGuidancePrompt: (v: string) => void;
  setChoicesPrompt: (v: string) => void;
  setOutlineEnabled: (v: boolean) => void;
  setOutlinePrompt: (v: string) => void;
  setOutlineBias: (v: string) => void;
  setOutlineWordTarget: (v: number) => void;
  setOutlineApi: (patch: Partial<ApiConfig>) => void;
  setOutlineUseSharedApi: (v: boolean) => void;
  setAgentNarrative: (patch: Partial<import('../systems/agent/agentTypes').AgentNarrativeSettings>) => void;
  setAgentApi: (patch: Partial<ApiConfig>) => void;
  saveAgentProfile: (name: string, id?: string) => string;   // 抓当前 agentNarrative(去 enabled)+agentApi+agent/agentReview 路由 → 存/覆盖档案，返回 id
  applyAgentProfile: (id: string) => void;                   // 应用档案（不改 enabled 开关）
  deleteAgentProfile: (id: string) => void;
  setPreludePrompt: (v: string) => void;
  setCastBrief: (v: boolean) => void;
  setCastBriefMax: (v: number) => void;
  fetchTextModels: () => Promise<void>;
  importTextWorldBook: (raw: string, fileName?: string, builtin?: boolean, builtinKey?: string) => { ok: boolean; message: string };
  toggleTextWorldBook: (id: string) => void;
  removeTextWorldBook: (id: string) => void;
  dedupeTextWorldBooks: () => number;
  renameTextWorldBook: (id: string, name: string) => void;
  toggleTextWorldBookEntry: (bookId: string, uid: number) => void;
  updateTextWorldBookEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addTextWorldBookEntry: (bookId: string) => void;
  removeTextWorldBookEntry: (bookId: string, uid: number) => void;
  reconcileBuiltinTextWorldBook: (raw: string, name: string, key: string) => WorldbookConflict[];   // 内置更新·3方合并·返回冲突
  setWorldbookConflicts: (list: WorldbookConflict[]) => void;
  resolveWorldbookConflict: (bookId: string, uid: number, choice: 'fresh' | 'mine') => void;
  importTextPreset: (raw: string, fileName?: string, builtin?: boolean, activate?: boolean, stOrderFaithful?: boolean) => { ok: boolean; message: string };
  removeTextPreset: (id: string) => void;
  renameTextPreset: (id: string, name: string) => void;
  updateTextPreset: (id: string, patch: Partial<TextGenPreset>) => void;
  toggleTextPresetEntry: (presetId: string, identifier: string) => void;
  updateTextPresetEntry: (presetId: string, identifier: string, patch: Partial<STPromptEntry>) => void;
  addTextPresetEntry: (presetId: string) => void;
  removeTextPresetEntry: (presetId: string, identifier: string) => void;
  moveTextPresetEntry: (presetId: string, identifier: string, dir: 1 | -1) => void;
  reorderTextPresetEntry: (presetId: string, fromId: string, toIdx: number) => void;
  setActiveTextPreset: (id: string | null) => void;

  // 综合设置操作
  setHistoryLimit: (n: number) => void;
  setAutoSaveEnabled: (v: boolean) => void;
  setAutoSaveEvery: (n: number) => void;
  setCustomOpening: (s: string) => void;
  setNarrativeMemory: (patch: Partial<NarrativeMemConfig>) => void;
  setNmApi: (patch: Partial<ApiConfig>) => void;
  setNmUseSharedApi: (v: boolean) => void;
  fetchNmModels: () => Promise<void>;

  // 全局正则操作
  importGlobalRegex: (raw: string, fileName?: string) => { ok: boolean; message: string };
  addGlobalRegexScript: () => void;
  updateGlobalRegexScript: (id: string, patch: Partial<RegexScript>) => void;
  removeGlobalRegexScript: (id: string) => void;
  toggleGlobalRegexScript: (id: string) => void;
  moveGlobalRegexScript: (id: string, dir: 1 | -1) => void;

  // 预设正则操作
  importPresetRegex: (presetId: string, raw: string, fileName?: string) => { ok: boolean; message: string };
  addPresetRegexScript: (presetId: string) => void;
  updatePresetRegexScript: (presetId: string, id: string, patch: Partial<RegexScript>) => void;
  removePresetRegexScript: (presetId: string, id: string) => void;
  togglePresetRegexScript: (presetId: string, id: string) => void;
  movePresetRegexScript: (presetId: string, id: string, dir: 1 | -1) => void;
}

const DEFAULT_API: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelId: 'gpt-4o',
  temperature: 0.8,
  maxTokens: 60000,   // 正文生成默认上限（按用户要求；对齐双人成行预设）
  topP: 1,
};

function toStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v && typeof v === 'string') return [v];
  return [];
}

// 内置条目「内容签名」：任一实质字段变化即签名变化。用于 3 方合并判断某内置条目是否被更新过。
export function sigOfEntry(e: WorldBookEntry): string {
  return [e.content, (e.key || []).join(''), (e.keysecondary || []).join(''), e.comment, e.constant, e.selective, e.enabled, e.order, e.position, e.depth ?? '', e.role ?? ''].join('');
}

function parseEntry(e: any, i: number): WorldBookEntry {
  return {
    uid: e.uid ?? e.id ?? i,
    key: toStringArray(e.key ?? e.keys ?? e.primary_keywords),
    keysecondary: toStringArray(e.keysecondary ?? e.secondary_keys ?? e.secondary_keywords),
    comment: e.comment ?? e.displayName ?? e.title ?? e.name ?? `条目${i}`,
    content: e.content ?? e.text ?? '',
    constant: Boolean(e.constant ?? e.alwaysActive ?? false),
    selective: Boolean(e.selective ?? e.use_regex ?? false),
    // enabled: SillyTavern 用 disable=true 表示禁用，也有直接用 enabled
    enabled: e.enabled !== false && e.disable !== true,
    order: typeof e.order === 'number' ? e.order
         : typeof e.insertion_order === 'number' ? e.insertion_order
         : 100,
    position: typeof e.position === 'number' ? e.position : 0,
  };
}

function parseName(data: any, fileName: string): string {
  // SillyTavern 有时把名字放在 name / originalName / worldName 字段
  return data.name || data.originalName || data.worldName || fileName || '未命名世界书';
}

export function parseWorldBook(raw: string, fileName = ''): { entries: WorldBookEntry[]; name: string } {
  const data = JSON.parse(raw);
  const name = parseName(data, fileName);

  // SillyTavern 主格式：entries 是以数字字符串为 key 的对象
  if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
    const entries = Object.values(data.entries).map((e: any, i) => parseEntry(e, i));
    return { name, entries };
  }

  // entries 是数组
  if (data.entries && Array.isArray(data.entries)) {
    return { name, entries: data.entries.map(parseEntry) };
  }

  // 顶层直接是数组
  if (Array.isArray(data)) {
    return { name: fileName || '导入世界书', entries: data.map(parseEntry) };
  }

  throw new Error('无法识别的世界书格式');
}

// ST placement 编号 → 我们的编号
// ST: 0=MD显示 1=用户输入 2=AI输出 3=斜杠命令 4=世界书
// 我们: 0=用户输入  1=AI输出
function normalizePlacement(raw: number[]): number[] {
  return raw.flatMap((p) => {
    if (p === 1) return [0]; // ST 用户输入 → 0
    if (p === 2) return [1]; // ST AI输出   → 1
    return [];               // 其余（MD显示/斜杠/世界书）忽略
  }).filter((v, i, a) => a.indexOf(v) === i); // 去重
}

// 从任意格式的 JSON 数据中提取正则脚本数组
function extractRawRegexArr(data: any): any[] {
  // 1. 顶层直接是数组
  if (Array.isArray(data)) return data;

  // 2. 常见包装字段（按优先级）
  const keys = ['regex_scripts', 'scripts', 'regexScripts',
                 'extensions.regex_scripts', 'data.extensions.regex_scripts'];
  for (const key of keys) {
    const val = key.split('.').reduce((o, k) => o?.[k], data as any);
    if (Array.isArray(val) && val.length > 0) return val;
  }

  // 3. 预设 JSON（包含 prompts）：提取其中内嵌的正则字段
  if (data?.prompts) {
    const embedded = data.regex_scripts ?? data.extensions?.regex_scripts
      ?? data.data?.extensions?.regex_scripts ?? null;
    if (Array.isArray(embedded) && embedded.length > 0) return embedded;
  }

  // 4. 单个正则对象（不是数组）
  if (data && typeof data === 'object' && (data.findRegex ?? data.find ?? data.scriptName)) {
    return [data];
  }

  return [];
}

/* 自动推断正则「视图作用域」（照 SillyTavern 惯例，用户无需逐条手动调开关）：
   ① replaceString 产出 HTML（<div>/<span>/style=…）的 = 美化框 → markdownOnly（只作用显示，别把 HTML 壳喂给AI/演化）
   ② replaceString 删空、且 findRegex 针对的标签又被某条美化正则包成 HTML 的 = 配套「对AI隐藏」→ promptOnly（只在发给AI时删，别把框从屏幕删空）
   仅在该条 markdownOnly/promptOnly 都未显式给定时才推断，绝不覆盖预设/用户的显式设定。 */
function regexTagName(findRegex: string): string | null {
  const m = findRegex.match(/<\/?\s*([a-zA-Z][\w-]*)/);
  return m ? m[1].toLowerCase() : null;
}
function replaceLooksHtml(replaceString: string): boolean {
  return /<[a-zA-Z][\w-]*[\s/>]/.test(replaceString) || /\b(?:style|class)\s*=/.test(replaceString);
}
export function inferViewScopes(scripts: RegexScript[]): RegexScript[] {
  const renderedTags = new Set<string>();
  for (const s of scripts) {
    if (replaceLooksHtml(s.replaceString)) { const t = regexTagName(s.findRegex); if (t) renderedTags.add(t); }
  }
  return scripts.map((s) => {
    if (s.markdownOnly !== undefined || s.promptOnly !== undefined) return s;    // 有显式设定：原样保留，绝不覆盖
    if (replaceLooksHtml(s.replaceString)) return { ...s, markdownOnly: true };   // 美化框 → 仅显示
    if (!s.replaceString.trim()) { const t = regexTagName(s.findRegex); if (t && renderedTags.has(t)) return { ...s, promptOnly: true }; }  // 配套删框 → 仅AI
    return s;
  });
}

// ── 正则脚本解析（兼容 ST 导出）──
function parseRegexArr(data: any): RegexScript[] {
  const arr: any[] = extractRawRegexArr(data);
  return inferViewScopes(arr.map((r: any) => {
    const rawPlacement: number[] = Array.isArray(r.placement) ? r.placement : [2]; // 默认 ST AI输出
    // 判断是否为 ST 格式：包含 ST 专有值（≥2）则视为 ST placement 编号体系
    const isSTFormat = rawPlacement.some((p) => p >= 2);
    const placement = isSTFormat ? normalizePlacement(rawPlacement) : rawPlacement;
    // 处理 ST 可能存成 /pattern/flags 格式的 findRegex
    let rawFind: string = r.findRegex ?? r.find ?? '';
    let rawFlags: string = r.flags ?? '';
    if (rawFind.startsWith('/')) {
      const last = rawFind.lastIndexOf('/');
      if (last > 0) {
        rawFlags = rawFind.slice(last + 1) + rawFlags; // 合并：斜线内的 flags 优先
        rawFind  = rawFind.slice(1, last);
      }
    }
    // 去重 + 只保留合法 flags 字符
    const safeFlags = [...new Set(rawFlags)].filter((c) => /[gimsuy]/.test(c)).join('') || 'g';

    return {
      id:            r.id ?? `rx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      scriptName:    r.scriptName ?? r.name ?? '未命名',
      findRegex:     rawFind,
      replaceString: r.replaceString ?? r.replace ?? '',
      trimStrings:   Array.isArray(r.trimStrings) ? r.trimStrings : [],
      placement:     placement.length > 0 ? placement : [1],
      disabled:      Boolean(r.disabled),
      flags:         safeFlags,
      // ST 视图作用域：只在明确布尔时保留，缺省留 undefined（= alter chat，两视图都跑，行为同旧版）
      ...(typeof r.markdownOnly === 'boolean' ? { markdownOnly: r.markdownOnly } : {}),
      ...(typeof r.promptOnly   === 'boolean' ? { promptOnly:   r.promptOnly   } : {}),
      // 以下仅原样保留以便无损重导出，本项目暂不消费
      ...(typeof r.runOnEdit === 'boolean' ? { runOnEdit: r.runOnEdit } : {}),
      ...(typeof r.substituteRegex === 'number' ? { substituteRegex: r.substituteRegex } : {}),
      ...(r.minDepth === null || typeof r.minDepth === 'number' ? { minDepth: r.minDepth } : {}),
      ...(r.maxDepth === null || typeof r.maxDepth === 'number' ? { maxDepth: r.maxDepth } : {}),
    };
  }));
}

function newRegexScript(): RegexScript {
  return {
    id: `rx_${Date.now()}`,
    scriptName: '新正则',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [1],
    disabled: false,
    flags: 'g',
  };
}

/* 内置全局正则「反极其」（参考 正文预设/regex-反极其.json）：删除 AI 正文里被滥用/复读的口头禅「极其」。
   仅作用 AI 输出（本项目原生 placement [1]）。与 App.collapseRunaway 互补——
   collapseRunaway 在【流式期】先把「极其」×成千的失控串折叠成 1 个、防前端渲染卡死；本脚本再在 applyRegex 里把残留的「极其」一并删除。
   新用户默认启用；可在「设置→正则」禁用或改写（编辑/删除后即成用户脚本，迁移不再覆盖）。id 固定以便迁移判重。 */
const BUILTIN_FANJIQI_ID = 'rx-builtin-fanjiqi';
function builtinFanjiqi(): RegexScript {
  return {
    id: BUILTIN_FANJIQI_ID,
    scriptName: '反极其',
    findRegex: '极其',
    replaceString: '',
    trimStrings: [],
    placement: [1],   // 本项目原生：1=AI输出（ST 的 2 经 normalizePlacement 也归一到此）
    disabled: false,
    flags: 'g',
  };
}

type SetFn = (partial: Partial<SettingsState> | ((s: SettingsState) => Partial<SettingsState>)) => void;

/* 编辑内置正文预设/世界书即「转为用户副本」：清掉 builtin 标记（保留 builtinKey 以便逐本判重）。
   内置项每次启动从 public/presets 重载且不写入 IndexedDB（见 App.loadBuiltinDefaults / wbDb 镜像的 !builtin 过滤），
   若不转正，用户的任何改动刷新后都会被默认覆盖丢失。改完即非 builtin → 纳入 IndexedDB 持久化、刷新保留。 */
function forkIfBuiltin<T extends { builtin?: boolean }>(x: T): T {
  return x.builtin ? { ...x, builtin: false } : x;
}

function buildRegexOps(set: SetFn) {
  // ── 全局正则 ──
  function updateGlobal(updater: (arr: RegexScript[]) => RegexScript[]) {
    set((s) => ({ globalRegexScripts: updater(s.globalRegexScripts) }));
  }

  // ── 预设正则 ──
  function updatePreset(presetId: string, updater: (arr: RegexScript[]) => RegexScript[]) {
    set((s) => ({
      textPresets: s.textPresets.map((p) =>
        p.id !== presetId ? p : forkIfBuiltin({ ...p, regexScripts: updater(p.regexScripts ?? []) })
      ),
    }));
  }

  function moveArr(arr: RegexScript[], id: string, dir: 1 | -1): RegexScript[] {
    const a = [...arr];
    const i = a.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]];
    return a;
  }

  return {
    importGlobalRegex: (raw: string, _fileName = '') => {
      try {
        const scripts = parseRegexArr(JSON.parse(raw));
        if (!scripts.length) return { ok: false, message: '未找到正则脚本' };
        updateGlobal((arr) => [...arr, ...scripts]);
        return { ok: true, message: `已导入 ${scripts.length} 条全局正则` };
      } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
    },
    addGlobalRegexScript: () => updateGlobal((arr) => [...arr, newRegexScript()]),
    updateGlobalRegexScript: (id: string, patch: Partial<RegexScript>) =>
      updateGlobal((arr) => arr.map((r) => r.id === id ? { ...r, ...patch } : r)),
    removeGlobalRegexScript: (id: string) =>
      updateGlobal((arr) => arr.filter((r) => r.id !== id)),
    toggleGlobalRegexScript: (id: string) =>
      updateGlobal((arr) => arr.map((r) => r.id === id ? { ...r, disabled: !r.disabled } : r)),
    moveGlobalRegexScript: (id: string, dir: 1 | -1) =>
      updateGlobal((arr) => moveArr(arr, id, dir)),

    importPresetRegex: (presetId: string, raw: string, _fileName = '') => {
      try {
        const scripts = parseRegexArr(JSON.parse(raw));
        if (!scripts.length) return { ok: false, message: '未找到正则脚本' };
        updatePreset(presetId, (arr) => [...arr, ...scripts]);
        return { ok: true, message: `已导入 ${scripts.length} 条预设正则` };
      } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
    },
    addPresetRegexScript: (presetId: string) =>
      updatePreset(presetId, (arr) => [...arr, newRegexScript()]),
    updatePresetRegexScript: (presetId: string, id: string, patch: Partial<RegexScript>) =>
      updatePreset(presetId, (arr) => arr.map((r) => r.id === id ? { ...r, ...patch } : r)),
    removePresetRegexScript: (presetId: string, id: string) =>
      updatePreset(presetId, (arr) => arr.filter((r) => r.id !== id)),
    togglePresetRegexScript: (presetId: string, id: string) =>
      updatePreset(presetId, (arr) => arr.map((r) => r.id === id ? { ...r, disabled: !r.disabled } : r)),
    movePresetRegexScript: (presetId: string, id: string, dir: 1 | -1) =>
      updatePreset(presetId, (arr) => moveArr(arr, id, dir)),
  };
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get): SettingsState => ({
      // 综合设置
      historyLimit: 3,   // 默认仅显示/发送最近 3 条楼层（0=不限制）
      autoSaveEnabled: true,
      branchCapture: true,
      autoSaveEvery: 1,
      disableEnterSend: false,
      showNewlineButton: true,
      weatherFx: true,
      audio: { enabled: true, volume: 0.7, ambient: true, ambientVolume: 0.4, music: true, musicVolume: 0.5, musicShuffle: false, musicConsent: '', musicCategory: '', musicPos: null },
      tableFill: { enabled: true, everyN: 1, only: [] },   // 默认：每回合填全部剧情表（＝原行为·不破老档）
      advancePresets: [],   // 空=⏩ 回退内置 PLOT_ADVANCE_DIRECTIVE；可在设置里加「激进/缝合怪」等
      advanceSelected: 0,
      autoAdvance: { maxLoops: 3, delayMs: 1500 },
      allowAutoEquip: true,
      allowAutoEquipNpc: true,
      customOpening: '',
      reading: { fontSize: 17, letterSpacing: 0, lineHeight: 1.8, paraSpacing: 0.45, fontFamily: 'default', dialogueHl: true, innerDim: true, codexHl: true, codexWiki: false },
      storyStrip: { on: true, quest: true, thread: true, time: true, almanac: true },
      uiTheme: 'default',
      appearance: 'classic',
      uiVignette: false,
      uiUnify: true,
      navGrouped: true,
      navCollapsed: [],
      holoCardFx: true,
      plotChoices: false,
      fanficMode: false,
      factCheck: false,
      miniTheater: false,
      npcAutonomyOn: false,
      npcAutonomyDeath: false,
      npcAutonomyMax: 16,
      npcAutonomyEvery: 1,
      narrativePov: 'off',
      language: 'zh-Hans',   // 默认简体（源码原样，零开销）；切繁體/英文才启用运行时翻译层
      autoTranslateOnline: true,   // 默认开：非简体语言下，跨玩家在线内容自动机翻（简体用户 needsAutoTranslate 基本不触发）
      autoTranslateEngine: 'ai',   // 默认 AI（最地道）；可切「免费机翻」不耗额度
      autoTranslateManual: true,   // 默认手动点击触发（避免自动机翻持续耗额度）
      evolveOutputLang: true,      // 默认开：越/英界面下演化内容直接用该语言生成（用户明确要求；有名称与中文正文对不齐的取舍，可关）
      userGlossary: {},
      glossaryVersion: 0,
      apiLibrary: [],
      apiRoutes: {},
      apiThrottle: { maxConcurrent: 3, minGapMs: 250 },
      phaseSched: {},
      narrativeMemory: { enabled: false, recentFullTextCount: 5, distantKeywordThreshold: 200, recallTopK: 6, recallMinScore: 1, requestTimeout: 90, llmMode: false, compileModelId: '', ingestModelId: '', structEnabled: true, structApiSelect: false, structMaxNpcs: 2, structMaxSkills: 3, structMaxItems: 2, structMaxNpcSkills: 8, structMaxNpcTalents: 8, structMaxNpcItems: 8, structMaxSubProfs: 4, structMaxFactions: 4 },
      worldDetailInject: { mode: 'layered', budget: 'standard', outlineFull: true },
      vectorMemory: { enabled: false, apiBase: 'https://api.siliconflow.cn/v1', apiKey: '', model: 'Pro/BAAI/bge-m3', topK: 6, threshold: 0.3, recentFullTextCount: 5, maxItems: 1000, factsOnly: false, rerankEnabled: false, rerankBase: 'https://api.siliconflow.cn/v1', rerankKey: '', rerankModel: 'BAAI/bge-reranker-v2-m3', rerankCandidates: 40, rerankThreshold: 0 },
      nmApi: { ...DEFAULT_API },
      nmUseSharedApi: true,
      nmAvailableModels: [],
      nmModelsLoading: false,
      nmModelsError: '',

      // 世界选择
      api: DEFAULT_API,
      availableModels: [],
      modelsLoading: false,
      modelsError: '',
      systemPrompt: '',
      worldBooks: [],

      // 正文生成
      textApi: { ...DEFAULT_API },
      textUseSharedApi: true,
      textStream: true,
      skipNarrativeThinking: false,
      forceNarrativeThinking: true,   // 默认开：预填 <think> 强制每回合出思维链（流式期间自动隐藏思考、只显示正文）；端点若拒绝 assistant 结尾可在设置关掉
      thinkDisplay: 'fold',           // 默认折叠块展示（对齐酒馆 Reasoning 体验）；旧档无此字段=同默认
      htmlExternalMedia: true,
      customCss: { text: '', scope: 'chat', enabled: true },
      renderHtmlSandbox: false,
      plotGuidance: false,
      planningReview: false,
      guidancePrompt: '',
      choicesPrompt: '',
      outlineEnabled: false,
      outlinePrompt: '',
      outlineBias: '',
      outlineWordTarget: 0,
      outlineApi: { ...DEFAULT_API },
      outlineUseSharedApi: true,
      preludePrompt: '',
      agentNarrative: { enabled: false, protocol: 'auto', maxRounds: 16, maxToolCalls: 40, toolToggles: { dice_roll: false }, useTextApi: false, reviewerEnabled: false, reviewerPasses: 1, initialHistoryMsgs: -1 },
      agentApi: { ...DEFAULT_API },
      agentProfiles: [],
      castBrief: true,      // 默认开：只在细纲/推进已开时才生效，且不新增 API 调用，纯提升配角人格保真度
      castBriefMax: 6,
      textAvailableModels: [],
      textModelsLoading: false,
      textModelsError: '',
      textWorldBooks: [],
      worldbookConflicts: [],
      textPresets: [],
      activeTextPresetId: null,
      activeTextPresetName: undefined,
      globalRegexScripts: [builtinFanjiqi()],   // 内置「反极其」默认启用（删 AI 正文里的口头禅「极其」）

      // ── 综合设置操作 ──
      setHistoryLimit: (n) => set({ historyLimit: Math.max(0, n) }),
      setAutoSaveEnabled: (v) => set({ autoSaveEnabled: v }),
      setBranchCapture: (v) => set({ branchCapture: v }),
      setAutoSaveEvery: (n) => set({ autoSaveEvery: Math.max(1, Math.floor(n) || 1) }),
      setDisableEnterSend: (v) => set({ disableEnterSend: v }),
      setShowNewlineButton: (v) => set({ showNewlineButton: v }),
      setWeatherFx: (v) => set({ weatherFx: v }),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setTableFill: (patch) => set((s) => ({ tableFill: { ...(s.tableFill ?? { enabled: true, everyN: 1, only: [] }), ...patch } })),
      setAdvancePresets: (v) => set({ advancePresets: v }),
      setAdvanceSelected: (i) => set({ advanceSelected: i }),
      setAutoAdvance: (patch) => set((s) => ({ autoAdvance: { ...(s.autoAdvance ?? { maxLoops: 3, delayMs: 1500 }), ...patch } })),
      setAllowAutoEquip: (v) => set({ allowAutoEquip: v }),
      setAllowAutoEquipNpc: (v) => set({ allowAutoEquipNpc: v }),
      setCustomOpening: (s) => set({ customOpening: s }),
      setReading: (patch) => set((s) => ({ reading: { ...s.reading, ...patch } })),
      setStoryStrip: (patch) => set((s) => ({ storyStrip: { ...s.storyStrip, ...patch } })),
      setUiTheme: (v) => set({ uiTheme: v }),
      setAppearance: (v) => set({ appearance: v }),
      setUiVignette: (v) => set({ uiVignette: v }),
      setUiUnify: (v) => set({ uiUnify: v }),
      setNavGrouped: (v) => set({ navGrouped: v }),
      toggleNavGroup: (name) => set((s) => {
        const cur = Array.isArray(s.navCollapsed) ? s.navCollapsed : [];   // 老存档无此字段 → 视为全展开
        return { navCollapsed: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
      }),
      setNavCollapsed: (names) => set({ navCollapsed: Array.isArray(names) ? names : [] }),
      setHoloCardFx: (v) => set({ holoCardFx: v }),
      setPlotChoices: (v) => set({ plotChoices: v }),
      setNpcAutonomyOn: (v) => set({ npcAutonomyOn: v }),
      setNpcAutonomyDeath: (v) => set({ npcAutonomyDeath: v }),
      setNpcAutonomyMax: (v) => set({ npcAutonomyMax: Math.min(60, Math.max(1, Math.floor(v) || 1)) }),
      setNpcAutonomyEvery: (v) => set({ npcAutonomyEvery: Math.min(30, Math.max(1, Math.floor(v) || 1)) }),
      setFanficMode: (v) => set({ fanficMode: v }),
      setFactCheck: (v) => set({ factCheck: v }),
      setMiniTheater: (v) => set({ miniTheater: v }),
      setNarrativePov: (v) => set({ narrativePov: v }),
      setLanguage: (v) => set({ language: v }),
      setAutoTranslateOnline: (v) => set({ autoTranslateOnline: v }),
      setAutoTranslateEngine: (v) => set({ autoTranslateEngine: v }),
      setAutoTranslateManual: (v) => set({ autoTranslateManual: v }),
      setEvolveOutputLang: (v) => set({ evolveOutputLang: v }),
      setUserGlossary: (lang, map) => set((s) => {
        const ug = { ...s.userGlossary, [lang]: map };
        setUserDict(ug as Record<string, Record<string, string>>);   // 同步进运行时镜像，translate 立即生效
        return { userGlossary: ug, glossaryVersion: s.glossaryVersion + 1 };
      }),

      addApiEndpoint: () => set((s) => ({
        apiLibrary: [...s.apiLibrary, {
          id: `EP_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: '新接口', enabled: true,
          baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.6, maxTokens: 4096, topP: 1,
        }],
      })),
      // 一键加两条网关接口：AI Studio→线上 worker（多租户，自带 key）；Vertex→本地 worker（仅本人，跑 wrangler dev）
      addGatewayEndpoints: (workerBase) => set((s) => {
        const root = (workerBase || 'https://zhushen-multiplayer.1102052563.workers.dev').replace(/\/+$/, '');
        const mk = (base: string, suffix: string, name: string, modelId: string): ApiEndpoint => ({
          id: `EP_gw_${suffix}_${Date.now()}`,
          name, enabled: true,
          baseUrl: `${base}/api/gw/${suffix}`, apiKey: '', modelId,
          temperature: 0.6, maxTokens: 8192, topP: 1,
        });
        return { apiLibrary: [
          ...s.apiLibrary,
          mk(root, 'aistudio', 'AI Studio (网关)', 'gemini-2.5-flash'),
          mk(root, 'vertex', 'Vertex (网关)', 'gemini-2.5-flash'),
        ] };
      }),
      updateApiEndpoint: (id, patch) => set((s) => ({ apiLibrary: s.apiLibrary.map((e) => e.id === id ? { ...e, ...patch } : e) })),
      removeApiEndpoint: (id) => set((s) => ({
        apiLibrary: s.apiLibrary.filter((e) => e.id !== id),
        // 同步把该接口从所有功能路由里摘掉，避免留下指向已删除接口的 stale id（会让路由顺序调整错位）
        apiRoutes: Object.fromEntries(Object.entries(s.apiRoutes ?? {}).map(([k, ids]) => [k, ids.filter((x) => x !== id)])),
      })),
      moveApiEndpoint: (id, dir) => set((s) => {
        const i = s.apiLibrary.findIndex((e) => e.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.apiLibrary.length) return s;
        const next = [...s.apiLibrary];
        [next[i], next[j]] = [next[j], next[i]];
        return { apiLibrary: next };
      }),
      setApiRoute: (key, ids) => set((s) => ({ apiRoutes: { ...s.apiRoutes, [key]: ids } })),
      setApiThrottle: (patch) => set((s) => ({ apiThrottle: { ...s.apiThrottle, ...patch } })),
      setPhaseSched: (key, patch) => set((s) => ({ phaseSched: { ...s.phaseSched, [key]: { ...(s.phaseSched?.[key] ?? { every: 1, read: 1 }), ...patch } } })),
      setNarrativeMemory: (patch) => set((s) => ({ narrativeMemory: { ...s.narrativeMemory, ...patch } })),
      setWorldDetailInject: (patch) => set((s) => ({ worldDetailInject: { ...s.worldDetailInject, ...patch } })),
      setVectorMemory: (patch) => set((s) => ({ vectorMemory: { ...s.vectorMemory, ...patch } })),
      setNmApi: (patch) => set((s) => ({ nmApi: { ...s.nmApi, ...patch } })),
      setNmUseSharedApi: (v) => set({ nmUseSharedApi: v }),
      fetchNmModels: async () => {
        const s = get();
        const api = s.nmUseSharedApi ? (s.textUseSharedApi ? s.api : s.textApi) : s.nmApi;
        if (!api.baseUrl || !api.apiKey) { set({ nmModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ nmModelsLoading: true, nmModelsError: '' });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` }, signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ nmAvailableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), nmModelsLoading: false });
        } catch (e: any) {
          set({ nmModelsError: e?.name === 'AbortError' ? '请求超时（15s）：API 地址 / 网关可能不可用，可手动填模型名直接用' : (e.message ?? '请求失败'), nmModelsLoading: false });
        } finally { clearTimeout(timer); }
      },

      // ── 世界选择操作 ──
      setApi: (patch) => set((s) => ({ api: { ...s.api, ...patch } })),

      fetchModels: async () => {
        const { api } = get();
        if (!api.baseUrl || !api.apiKey) { set({ modelsError: '请先填写 API 地址和 Key' }); return; }
        set({ modelsLoading: true, modelsError: '' });
        // 超时兜底：部分反代网关 /models 会接受连接却永不响应，无 timeout 时 await 永久挂起，
        // modelsLoading 永远停在 true → 按钮卡死「获取中…」。15s 后中止，转入 catch 复位。
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` }, signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ availableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), modelsLoading: false });
        } catch (e: any) {
          set({ modelsError: e?.name === 'AbortError' ? '请求超时（15s）：API 地址 / 网关可能不可用，可手动填模型名直接用' : (e.message ?? '请求失败'), modelsLoading: false });
        } finally { clearTimeout(timer); }
      },

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

      importWorldBook: (raw, fileName = '', builtin = false, builtinKey?: string) => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          let replaced = false;
          set((s) => {
            const idx = s.worldBooks.findIndex((b) => b.name === name);
            if (idx >= 0) {   // 同名已存在 → 原地覆盖条目（保留 id/启用/内置标记），不再新增，避免重复堆叠
              replaced = true;
              const next = s.worldBooks.slice();
              next[idx] = { ...next[idx], name, entries };
              return { worldBooks: next };
            }
            return { worldBooks: [...s.worldBooks, { id: `wb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now(), builtin, builtinKey }] };
          });
          return { ok: true, message: replaced ? `已更新「${name}」（同名覆盖），共 ${entries.length} 条条目` : `已导入「${name}」，共 ${entries.length} 条条目` };
        } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
      },

      toggleWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id === id ? forkIfBuiltin({ ...b, enabled: !b.enabled }) : b) })),
      removeWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.filter((b) => b.id !== id) })),
      dedupeWorldBooks: () => {
        const arr = get().worldBooks;
        const chosen = new Map();   // name → 保留一本（同名优先保留内置/带 builtinKey 的，否则刷新后内置会重新挂载又生重复）
        for (const b of arr) {
          const cur = chosen.get(b.name);
          if (!cur) chosen.set(b.name, b);
          else if (!(cur.builtin || cur.builtinKey) && (b.builtin || b.builtinKey)) chosen.set(b.name, b);
        }
        const keep = new Set(Array.from(chosen.values()).map((b: any) => b.id));
        const removed = arr.length - keep.size;
        if (removed > 0) set({ worldBooks: arr.filter((b) => keep.has(b.id)) });
        return removed;
      },
      renameWorldBook: (id, name) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id === id ? forkIfBuiltin({ ...b, name }) : b) })),
      toggleWorldBookEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, enabled: !e.enabled } : e) })) })),
      updateWorldBookEntry: (bookId, uid, patch) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, ...patch } : e) })) })),
      addWorldBookEntry: (bookId) => set((s) => {
        const book = s.worldBooks.find((b) => b.id === bookId); if (!book) return s;
        const maxUid = book.entries.reduce((m, e) => Math.max(m, e.uid), -1);
        const maxOrder = book.entries.reduce((m, e) => Math.max(m, e.order), 99);
        return { worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: false, enabled: true, order: maxOrder + 1, position: 0 }] })) };
      }),
      removeWorldBookEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.filter((e) => e.uid !== uid) })) })),

      // ── 正文生成操作 ──
      setTextApi: (patch) => set((s) => ({ textApi: { ...s.textApi, ...patch } })),
      setTextUseSharedApi: (v) => set({ textUseSharedApi: v }),
      setTextStream: (v) => set({ textStream: v }),
      // skip 与 force 互斥：开一个自动关另一个（两者都在正文末尾预填充 assistant，语义相反）
      setSkipNarrativeThinking: (v) => set(v ? { skipNarrativeThinking: true, forceNarrativeThinking: false } : { skipNarrativeThinking: false }),
      setForceNarrativeThinking: (v) => set(v ? { forceNarrativeThinking: true, skipNarrativeThinking: false } : { forceNarrativeThinking: false }),
      setThinkDisplay: (v) => set({ thinkDisplay: v }),
      setHtmlExternalMedia: (v) => set({ htmlExternalMedia: v }),
      setCustomCss: (patch) => set((s) => ({ customCss: { ...s.customCss, ...patch } })),
      setRenderHtmlSandbox: (v) => set({ renderHtmlSandbox: v }),
      setPlotGuidance: (v) => set({ plotGuidance: v }),
      setPlanningReview: (v) => set({ planningReview: v }),
      setGuidancePrompt: (v) => set({ guidancePrompt: v }),
      setChoicesPrompt: (v) => set({ choicesPrompt: v }),
      setOutlineEnabled: (v) => set({ outlineEnabled: v }),
      setOutlinePrompt: (v) => set({ outlinePrompt: v }),
      setOutlineBias: (v) => set({ outlineBias: v }),
      setOutlineWordTarget: (v) => set({ outlineWordTarget: Math.max(0, Math.round(v || 0)) }),
      setOutlineApi: (patch) => set((s) => ({ outlineApi: { ...s.outlineApi, ...patch } })),
      setOutlineUseSharedApi: (v) => set({ outlineUseSharedApi: v }),
      setAgentNarrative: (patch) => set((s) => ({ agentNarrative: { ...s.agentNarrative, ...patch } })),
      setAgentApi: (patch) => set((s) => ({ agentApi: { ...s.agentApi, ...patch } })),
      saveAgentProfile: (name, id) => {
        const pid = id || `agp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
        set((s) => {
          const { enabled: _e, ...cfg } = s.agentNarrative;
          const snap = { id: pid, name: (name || '').trim() || '未命名档案', cfg, api: { ...s.agentApi }, routeIds: [...(s.apiRoutes?.agent ?? [])], reviewRouteIds: [...(s.apiRoutes?.agentReview ?? [])] };
          return { agentProfiles: [...(s.agentProfiles ?? []).filter((p) => p.id !== pid), snap] };
        });
        return pid;
      },
      applyAgentProfile: (pid) => set((s) => {
        const p = (s.agentProfiles ?? []).find((x) => x.id === pid);
        if (!p) return {};
        return {
          agentNarrative: { ...s.agentNarrative, ...p.cfg, enabled: s.agentNarrative.enabled },   // 应用档案不改变开关
          ...(p.api ? { agentApi: { ...s.agentApi, ...p.api } } : {}),
          apiRoutes: { ...s.apiRoutes, ...(p.routeIds ? { agent: p.routeIds } : {}), ...(p.reviewRouteIds ? { agentReview: p.reviewRouteIds } : {}) },
        };
      }),
      deleteAgentProfile: (pid) => set((s) => ({ agentProfiles: (s.agentProfiles ?? []).filter((x) => x.id !== pid) })),
      setPreludePrompt: (v) => set({ preludePrompt: v }),
      setCastBrief: (v) => set({ castBrief: v }),
      setCastBriefMax: (v) => set({ castBriefMax: Math.min(12, Math.max(1, Math.round(v || 6))) }),

      fetchTextModels: async () => {
        const s = get();
        const api = s.textUseSharedApi ? s.api : s.textApi;
        if (!api.baseUrl || !api.apiKey) { set({ textModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ textModelsLoading: true, textModelsError: '' });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` }, signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ textAvailableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), textModelsLoading: false });
        } catch (e: any) {
          set({ textModelsError: e?.name === 'AbortError' ? '请求超时（15s）：API 地址 / 网关可能不可用，可手动填模型名直接用' : (e.message ?? '请求失败'), textModelsLoading: false });
        } finally { clearTimeout(timer); }
      },

      importTextWorldBook: (raw, fileName = '', builtin = false, builtinKey?: string) => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          let replaced = false;
          set((s) => {
            const idx = s.textWorldBooks.findIndex((b) => b.name === name);
            if (idx >= 0) {   // 同名已存在 → 原地覆盖条目（保留 id/启用/内置标记），不再新增，避免重复堆叠
              replaced = true;
              const next = s.textWorldBooks.slice();
              next[idx] = { ...next[idx], name, entries };
              return { textWorldBooks: next };
            }
            return { textWorldBooks: [...s.textWorldBooks, { id: `twb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now(), builtin, builtinKey }] };
          });
          return { ok: true, message: replaced ? `已更新「${name}」（同名覆盖），共 ${entries.length} 条条目` : `已导入「${name}」，共 ${entries.length} 条条目` };
        } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
      },

      toggleTextWorldBook: (id) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id === id ? forkIfBuiltin({ ...b, enabled: !b.enabled }) : b) })),
      removeTextWorldBook: (id) => set((s) => ({ textWorldBooks: s.textWorldBooks.filter((b) => b.id !== id) })),
      dedupeTextWorldBooks: () => {
        const arr = get().textWorldBooks;
        const chosen = new Map();   // name → 保留一本（同名优先保留内置/带 builtinKey 的，否则刷新后内置会重新挂载又生重复）
        for (const b of arr) {
          const cur = chosen.get(b.name);
          if (!cur) chosen.set(b.name, b);
          else if (!(cur.builtin || cur.builtinKey) && (b.builtin || b.builtinKey)) chosen.set(b.name, b);
        }
        const keep = new Set(Array.from(chosen.values()).map((b: any) => b.id));
        const removed = arr.length - keep.size;
        if (removed > 0) set({ textWorldBooks: arr.filter((b) => keep.has(b.id)) });
        return removed;
      },
      renameTextWorldBook: (id, name) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id === id ? forkIfBuiltin({ ...b, name }) : b) })),
      toggleTextWorldBookEntry: (bookId, uid) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.map((e) => e.uid !== uid ? e : (b.builtinKey ? { ...e, enabled: !e.enabled, userEdited: true, baseSig: e.userEdited ? e.baseSig : sigOfEntry(e) } : { ...e, enabled: !e.enabled })) })) })),
      updateTextWorldBookEntry: (bookId, uid, patch) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.map((e) => e.uid !== uid ? e : (b.builtinKey ? { ...e, ...patch, userEdited: true, baseSig: e.userEdited ? e.baseSig : sigOfEntry(e) } : { ...e, ...patch })) })) })),
      addTextWorldBookEntry: (bookId) => set((s) => {
        const book = s.textWorldBooks.find((b) => b.id === bookId); if (!book) return s;
        const maxUid = book.entries.reduce((m, e) => Math.max(m, e.uid), -1);
        const maxOrder = book.entries.reduce((m, e) => Math.max(m, e.order), 99);
        return { textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: false, enabled: true, order: maxOrder + 1, position: 0, userAdded: true }] })) };
      }),
      removeTextWorldBookEntry: (bookId, uid) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : forkIfBuiltin({ ...b, entries: b.entries.filter((e) => e.uid !== uid), removedBuiltinUids: b.builtinKey ? [...new Set([...(b.removedBuiltinUids || []), uid])] : b.removedBuiltinUids })) })),

      // 内置世界书更新时的「3方合并」（替代整本删+重导）：更新玩家没改过的条目、保留玩家改过的、送达新内置条目、
      //   尊重玩家删除；「内置改了 + 玩家也改了同一条」→ 收集为冲突返回（由 UI 逐条裁决·策略B）。
      reconcileBuiltinTextWorldBook: (raw, name, key) => {
        const conflicts: WorldbookConflict[] = [];
        try {
          const { entries: fresh } = parseWorldBook(raw, name);
          set((s) => {
            const existing = s.textWorldBooks.find((b) => b.builtinKey === key);
            if (!existing) {   // 全新内置：直接整本导入
              const book: WorldBook = { id: `twb_${Date.now()}`, name, entries: fresh.map((e) => ({ ...e })), enabled: true, createdAt: Date.now(), builtin: true, builtinKey: key };
              return { textWorldBooks: [...s.textWorldBooks.filter((b) => b.builtinKey !== key), book] };
            }
            const userByUid = new Map(existing.entries.map((e) => [e.uid, e]));
            const removed = new Set(existing.removedBuiltinUids || []);
            const merged: WorldBookEntry[] = [];
            for (const f of fresh) {
              if (removed.has(f.uid)) continue;                       // 玩家删过这条内置 → 不加回
              const u = userByUid.get(f.uid);
              if (!u) { merged.push({ ...f }); continue; }             // 新内置条目 → 送达
              if (!u.userEdited) { merged.push({ ...f }); continue; }   // 玩家没改过 → 用最新内置
              if (u.baseSig && sigOfEntry(f) === u.baseSig) { merged.push(u); continue; }   // 内置没更新过它 → 静默保留玩家版
              merged.push(u);                                         // 冲突：先保留玩家版，收集待裁决
              conflicts.push({ bookId: existing.id, bookName: existing.name, uid: f.uid, comment: f.comment || `#${f.uid}`, freshEntry: { ...f }, userEntry: { ...u } });
            }
            const freshUids = new Set(fresh.map((f) => f.uid));
            for (const u of existing.entries) {                       // 玩家新增的条目（uid 不在内置里）→ 保留
              if (!freshUids.has(u.uid) && !merged.some((m) => m.uid === u.uid)) merged.push(u);
            }
            const nextBook: WorldBook = { ...existing, entries: merged };   // 保留 existing 的 name/id/启用/builtin(Key)/removedBuiltinUids
            return { textWorldBooks: s.textWorldBooks.map((b) => b.builtinKey === key ? nextBook : b) };
          });
        } catch { /* parse 失败 → 保留现状 */ }
        return conflicts;
      },
      setWorldbookConflicts: (list) => set({ worldbookConflicts: list }),
      resolveWorldbookConflict: (bookId, uid, choice) => set((s) => {
        const c = s.worldbookConflicts.find((x) => x.bookId === bookId && x.uid === uid);
        if (!c) return s;
        const books = s.textWorldBooks.map((b) => b.id !== bookId ? b : {
          ...b,
          entries: b.entries.map((e) => {
            if (e.uid !== uid) return e;
            if (choice === 'fresh') return { ...c.freshEntry, userEdited: false, baseSig: undefined, userAdded: e.userAdded };   // 用新版：恢复跟随内置更新
            return { ...e, baseSig: sigOfEntry(c.freshEntry) };   // 保留我的：把 base 推进到新内置签名 → 同一更新不再重复问
          }),
        });
        return { textWorldBooks: books, worldbookConflicts: s.worldbookConflicts.filter((x) => !(x.bookId === bookId && x.uid === uid)) };
      }),

      importTextPreset: (raw, fileName = '', builtin = false, activate = true, stOrderFaithful = false) => {
        try {
          const data = JSON.parse(raw);
          const id = `preset_${Date.now()}`;
          const parsed = parseSTPreset(data, fileName, id, stOrderFaithful);
          // 内置预设用「稳定 id」(builtin:<名>)：每次启动补种都得到同一 id，用户激活后 activeTextPresetId
          // 跨刷新不再失配（旧版用 Date.now() 每次都换 id → 激活态对不上 → 预设静默不注入，722 词符裸奔）。
          const finalId = builtin ? `builtin:${parsed.name}` : parsed.id;
          const preset = { ...parsed, id: finalId };
          set((s) => ({ textPresets: [...s.textPresets, { ...preset, builtin }], activeTextPresetId: activate ? preset.id : s.activeTextPresetId }));
          // TauriTavern 预设内嵌 Agent 资产（extensions.tauritavern：skill 包/子代理档案/作者指令）→ 异步导入资产库（失败不影响预设本身）
          try { void importEmbeddedAgentAssets(data, preset.name, builtin).then((r) => { if (r.skills || r.subagents || r.writerNotes) console.log(`[AgentAssets] 「${preset.name}」内嵌资产：skill×${r.skills} 子代理×${r.subagents}${r.writerNotes ? ' +作者指令' : ''}`); }); } catch { /* */ }
          const rxCount = preset.regexScripts.length;
          return { ok: true, message: `已导入「${preset.name}」，共 ${preset.entries.length} 条 prompt${rxCount ? `，含 ${rxCount} 条正则` : ''}` };
        } catch (e: any) {
          return { ok: false, message: `导入失败：${e.message}` };
        }
      },
      removeTextPreset: (id) => set((s) => {
        const remaining = s.textPresets.filter((p) => p.id !== id);
        return {
          textPresets: remaining,
          activeTextPresetId: s.activeTextPresetId === id
            ? (remaining[0]?.id ?? null)
            : s.activeTextPresetId,
        };
      }),
      updateTextPreset: (id, patch) => set((s) => ({
        textPresets: s.textPresets.map((p) => p.id === id ? forkIfBuiltin({ ...p, ...patch }) : p),
      })),
      renameTextPreset: (id, name) => set((s) => ({
        textPresets: s.textPresets.map((p) => p.id === id ? forkIfBuiltin({ ...p, name }) : p),
      })),
      toggleTextPresetEntry: (presetId, identifier) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : forkIfBuiltin({
            ...p,
            entries: (p.entries ?? []).map((e) =>
              e.identifier === identifier ? { ...e, enabled: !e.enabled } : e
            ),
          })
        ),
      })),
      updateTextPresetEntry: (presetId, identifier, patch) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : forkIfBuiltin({
            ...p,
            entries: (p.entries ?? []).map((e) =>
              e.identifier === identifier ? { ...e, ...patch } : e
            ),
          })
        ),
      })),
      addTextPresetEntry: (presetId) => set((s) => {
        const uid = `entry_${Date.now()}`;
        const newEntry: STPromptEntry = {
          identifier: uid, name: '新 Prompt', role: 'system',
          content: '', enabled: true, system_prompt: false, marker: false,
        };
        return {
          textPresets: s.textPresets.map((p) =>
            p.id !== presetId ? p : forkIfBuiltin({ ...p, entries: [...(p.entries ?? []), newEntry] })
          ),
        };
      }),
      removeTextPresetEntry: (presetId, identifier) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : forkIfBuiltin({ ...p, entries: (p.entries ?? []).filter((e) => e.identifier !== identifier) })
        ),
      })),
      moveTextPresetEntry: (presetId, identifier, dir) => set((s) => ({
        textPresets: s.textPresets.map((p) => {
          if (p.id !== presetId) return p;
          const arr = [...(p.entries ?? [])];
          const idx = arr.findIndex((e) => e.identifier === identifier);
          const next = idx + dir;
          if (next < 0 || next >= arr.length) return p;
          [arr[idx], arr[next]] = [arr[next], arr[idx]];
          return forkIfBuiltin({ ...p, entries: arr });
        }),
      })),
      reorderTextPresetEntry: (presetId, fromId, toIdx) => set((s) => ({
        textPresets: s.textPresets.map((p) => {
          if (p.id !== presetId) return p;
          const arr = [...(p.entries ?? [])];
          const from = arr.findIndex((e) => e.identifier === fromId);
          if (from < 0) return p;
          const [moved] = arr.splice(from, 1);
          const dest = Math.max(0, Math.min(arr.length, toIdx > from ? toIdx - 1 : toIdx));
          arr.splice(dest, 0, moved);
          return forkIfBuiltin({ ...p, entries: arr });
        }),
      })),
      setActiveTextPreset: (id) => set((s) => {
        const target = s.textPresets.find((x) => x.id === id);
        return {
          activeTextPresetId: id,
          // 同时记住「激活预设名」：万一内置预设 id 仍失配，App 端可按名兜底找回用户的选择。
          activeTextPresetName: target?.name ?? s.activeTextPresetName,
          // 激活即固化：把被启用的内置预设转成用户副本(builtin=false)，纳入 IndexedDB 持久化、id 稳定，
          // 此后启动时的内置补种因「同名已存在」不再覆盖它（除非用户删除该预设，删后下次启动才补回最新内置版）。
          textPresets: s.textPresets.map((x) => x.id === id ? forkIfBuiltin(x) : x),
        };
      }),

      // ── 正则通用工具 ──
      ...buildRegexOps(set),
    }),
    {
      name: 'drpg-settings',
      storage: debouncedStorage(),   // 合并写盘（300ms）：底层仍是裸 JSON 同一格式，切换零迁移
      // v1：为存量用户注入内置全局正则「反极其」（仅一次，按固定 id 判重；用户删/改后版本已升级，不再覆盖）。
      //     新用户走初始 state 已含该脚本，不经 migrate。
      // v2：为存量全局正则自动补「视图作用域」默认（美化框=仅显示 / 配套删框=仅AI），免用户重导入或逐条手动调开关。
      //     只在该条 markdownOnly/promptOnly 都未显式给定时才补（inferViewScopes 内部判重），不覆盖已有设定。
      version: 2,
      migrate: (persisted: any, _fromVersion: number) => {
        if (persisted && typeof persisted === 'object') {
          const arr: any[] = Array.isArray(persisted.globalRegexScripts) ? persisted.globalRegexScripts : [];
          const withFanjiqi = arr.some((r) => r?.id === BUILTIN_FANJIQI_ID) ? arr : [builtinFanjiqi(), ...arr];
          persisted.globalRegexScripts = inferViewScopes(withFanjiqi as RegexScript[]);
        }
        return persisted;
      },
      // 世界书 / 正文世界书 / 文本预设 改存 IndexedDB（见 systems/wbDb），localStorage 不再保存它们——
      // 既容纳大世界书（IndexedDB 容量大），又避免撑爆 localStorage 5MB 配额。
      partialize: (s) => ({
        ...s,
        worldBooks: [],
        textWorldBooks: [],
        worldbookConflicts: [],
        textPresets: [],
        // 瞬时 UI 态绝不入库：中途刷新/中断会把 modelsLoading:true 写进 localStorage，
        // 下次加载按钮永久卡在「获取中…」(disabled) 无法重试。
        modelsLoading: false,
        modelsError: '',
        textModelsLoading: false,
        textModelsError: '',
        nmModelsLoading: false,
        nmModelsError: '',
      }),
      // rehydrate 不经 partialize：存量用户 localStorage 里若已存了 modelsLoading:true，
      // 必须在 merge 阶段每次加载强制复位，否则「刷新模型」按钮启动即卡死。
      merge: (persisted: any, current: SettingsState): SettingsState => ({
        ...current,
        ...(persisted && typeof persisted === 'object' ? persisted : {}),
        // 子对象浅合并回填：老存档的 audio 若缺新字段（music/musicVolume/…），从默认补齐，否则整体覆盖丢默认
        audio: { ...current.audio, ...(persisted && typeof persisted.audio === 'object' ? persisted.audio : {}) },
        worldDetailInject: { ...current.worldDetailInject, ...(persisted && typeof persisted.worldDetailInject === 'object' ? persisted.worldDetailInject : {}) },
        storyStrip: { ...current.storyStrip, ...(persisted && typeof persisted.storyStrip === 'object' ? persisted.storyStrip : {}) },
        modelsLoading: false,
        modelsError: '',
        textModelsLoading: false,
        textModelsError: '',
        nmModelsLoading: false,
        nmModelsError: '',
      }),
    }
  )
);

// 启动即把持久化的用户翻译覆盖表灌进运行时镜像（i18n/userDict）——translate.ts 读取，优先于内置词库。
setUserDict((useSettings.getState().userGlossary || {}) as Record<string, Record<string, string>>);
