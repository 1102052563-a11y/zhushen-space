import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

export interface WorldBook {
  id: string;
  name: string;
  entries: WorldBookEntry[];
  enabled: boolean;
  createdAt: number;
  builtin?: boolean;   // 内置默认书：来自 public/presets，每次启动重载、不写入 localStorage（省配额）
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

function parseSTPreset(data: any, fileName: string, id: string): TextGenPreset {
  const name = data.name ?? data.preset_name ?? fileName ?? '未命名预设';
  const regexScripts = extractRegexFromPreset(data);

  // ── ST Prompt Manager 格式：有 prompts 数组 ──
  if (Array.isArray(data.prompts)) {
    let orderArr: { identifier: string; enabled: boolean }[] = [];
    if (Array.isArray(data.prompt_order)) {
      const first = data.prompt_order[0];
      if (first && Array.isArray(first.order)) orderArr = first.order;
      else orderArr = data.prompt_order;
    }
    const enabledMap = new Map(orderArr.map((o) => [o.identifier, o.enabled !== false]));

    const entries: STPromptEntry[] = data.prompts.map((p: any) => {
      const id_ = p.identifier ?? p.id ?? p.name ?? String(Math.random());
      return {
        identifier:        id_,
        name:              p.name ?? p.identifier ?? '(无名)',
        role:              p.role ?? 'system',
        content:           p.content ?? '',
        enabled:           enabledMap.has(id_) ? enabledMap.get(id_)! : (p.enabled !== false),
        system_prompt:     Boolean(p.system_prompt),
        marker:            Boolean(p.marker),
        injection_position: p.injection_position,
        injection_depth:   p.injection_depth,
      };
    });

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
  structMaxNpcs: number;           // 注入的 NPC 数量上限（主角必含、不占此额度）
  structMaxSkills: number;         // 每个角色注入的技能数量上限
  structMaxItems: number;          // 每个角色注入的装备/物品数量上限
  structMaxSubProfs: number;       // 主角注入的副职业数量上限
  structMaxFactions: number;       // 注入的当前世界势力数量上限
}

interface SettingsState {
  // 综合设置
  historyLimit: number;   // 0 = 不限制；> 0 = 仅显示/发送最近 N 条消息
  allowAutoEquip: boolean;  // 是否允许 AI 自动装备主角拾取/生成的装备（关闭=仅能在装备面板手动穿戴）
  setAllowAutoEquip: (v: boolean) => void;
  allowAutoEquipNpc: boolean;  // 是否允许自动给 NPC 穿戴装备（含初始装备与 AI 装备指令；关闭=只入 NPC 储存空间）
  setAllowAutoEquipNpc: (v: boolean) => void;
  customOpening: string;  // 自定义开场白模板（角色创建确认后自动发送；含 ${...} 占位符，空=用内置默认）
  apiLibrary: ApiEndpoint[];   // 中心 API 接口库（综合设置维护，各功能快捷选填）
  apiRoutes: Record<string, string[]>;  // 各功能的接口路由：featureKey → 有序 endpoint id 列表（上=优先，失败 fallback）
  apiThrottle: { maxConcurrent: number; minGapMs: number };  // 全局请求节流：最大并发 + 最小间隔（缓解 429）
  phaseSched: Record<string, { every: number; read: number }>;  // 各演化阶段：every=每N回合调用一次，read=读取最近N回合正文（默认 1/1）
  addApiEndpoint: () => void;
  updateApiEndpoint: (id: string, patch: Partial<ApiEndpoint>) => void;
  removeApiEndpoint: (id: string) => void;
  moveApiEndpoint: (id: string, dir: -1 | 1) => void;
  setApiRoute: (key: string, ids: string[]) => void;
  setApiThrottle: (patch: Partial<{ maxConcurrent: number; minGapMs: number }>) => void;
  setPhaseSched: (key: string, patch: Partial<{ every: number; read: number }>) => void;
  narrativeMemory: NarrativeMemConfig;
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
  textAvailableModels: string[];
  textModelsLoading: boolean;
  textModelsError: string;
  textWorldBooks: WorldBook[];
  textPresets: TextGenPreset[];
  activeTextPresetId: string | null;
  globalRegexScripts: RegexScript[];

  // 世界选择操作
  setApi: (patch: Partial<ApiConfig>) => void;
  fetchModels: () => Promise<void>;
  setSystemPrompt: (prompt: string) => void;
  importWorldBook: (raw: string, fileName?: string) => { ok: boolean; message: string };
  toggleWorldBook: (id: string) => void;
  removeWorldBook: (id: string) => void;
  renameWorldBook: (id: string, name: string) => void;
  toggleWorldBookEntry: (bookId: string, uid: number) => void;
  updateWorldBookEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addWorldBookEntry: (bookId: string) => void;
  removeWorldBookEntry: (bookId: string, uid: number) => void;

  // 正文生成操作
  setTextApi: (patch: Partial<ApiConfig>) => void;
  setTextUseSharedApi: (v: boolean) => void;
  setTextStream: (v: boolean) => void;
  fetchTextModels: () => Promise<void>;
  importTextWorldBook: (raw: string, fileName?: string) => { ok: boolean; message: string };
  toggleTextWorldBook: (id: string) => void;
  removeTextWorldBook: (id: string) => void;
  renameTextWorldBook: (id: string, name: string) => void;
  toggleTextWorldBookEntry: (bookId: string, uid: number) => void;
  updateTextWorldBookEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addTextWorldBookEntry: (bookId: string) => void;
  removeTextWorldBookEntry: (bookId: string, uid: number) => void;
  importTextPreset: (raw: string, fileName?: string) => { ok: boolean; message: string };
  removeTextPreset: (id: string) => void;
  renameTextPreset: (id: string, name: string) => void;
  updateTextPreset: (id: string, patch: Partial<TextGenPreset>) => void;
  toggleTextPresetEntry: (presetId: string, identifier: string) => void;
  updateTextPresetEntry: (presetId: string, identifier: string, patch: Partial<STPromptEntry>) => void;
  addTextPresetEntry: (presetId: string) => void;
  removeTextPresetEntry: (presetId: string, identifier: string) => void;
  moveTextPresetEntry: (presetId: string, identifier: string, dir: 1 | -1) => void;
  setActiveTextPreset: (id: string | null) => void;

  // 综合设置操作
  setHistoryLimit: (n: number) => void;
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

function parseWorldBook(raw: string, fileName = ''): { entries: WorldBookEntry[]; name: string } {
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

// ── 正则脚本解析（兼容 ST 导出）──
function parseRegexArr(data: any): RegexScript[] {
  const arr: any[] = extractRawRegexArr(data);
  return arr.map((r: any) => {
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
    };
  });
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

type SetFn = (partial: Partial<SettingsState> | ((s: SettingsState) => Partial<SettingsState>)) => void;

function buildRegexOps(set: SetFn) {
  // ── 全局正则 ──
  function updateGlobal(updater: (arr: RegexScript[]) => RegexScript[]) {
    set((s) => ({ globalRegexScripts: updater(s.globalRegexScripts) }));
  }

  // ── 预设正则 ──
  function updatePreset(presetId: string, updater: (arr: RegexScript[]) => RegexScript[]) {
    set((s) => ({
      textPresets: s.textPresets.map((p) =>
        p.id !== presetId ? p : { ...p, regexScripts: updater(p.regexScripts ?? []) }
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
    importGlobalRegex: (raw: string, fileName = '') => {
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
    (set, get) => ({
      // 综合设置
      historyLimit: 0,
      allowAutoEquip: true,
      allowAutoEquipNpc: true,
      customOpening: '',
      apiLibrary: [],
      apiRoutes: {},
      apiThrottle: { maxConcurrent: 3, minGapMs: 250 },
      phaseSched: {},
      narrativeMemory: { enabled: false, recentFullTextCount: 5, distantKeywordThreshold: 200, recallTopK: 6, recallMinScore: 1, requestTimeout: 90, llmMode: false, compileModelId: '', ingestModelId: '', structEnabled: true, structMaxNpcs: 2, structMaxSkills: 3, structMaxItems: 2, structMaxSubProfs: 4, structMaxFactions: 4 },
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
      textAvailableModels: [],
      textModelsLoading: false,
      textModelsError: '',
      textWorldBooks: [],
      textPresets: [],
      activeTextPresetId: null,
      globalRegexScripts: [],

      // ── 综合设置操作 ──
      setHistoryLimit: (n) => set({ historyLimit: Math.max(0, n) }),
      setAllowAutoEquip: (v) => set({ allowAutoEquip: v }),
      setAllowAutoEquipNpc: (v) => set({ allowAutoEquipNpc: v }),
      setCustomOpening: (s) => set({ customOpening: s }),

      addApiEndpoint: () => set((s) => ({
        apiLibrary: [...s.apiLibrary, {
          id: `EP_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: '新接口', enabled: true,
          baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o', temperature: 0.6, maxTokens: 4096, topP: 1,
        }],
      })),
      updateApiEndpoint: (id, patch) => set((s) => ({ apiLibrary: s.apiLibrary.map((e) => e.id === id ? { ...e, ...patch } : e) })),
      removeApiEndpoint: (id) => set((s) => ({ apiLibrary: s.apiLibrary.filter((e) => e.id !== id) })),
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
      setPhaseSched: (key, patch) => set((s) => ({ phaseSched: { ...s.phaseSched, [key]: { every: 1, read: 1, ...(s.phaseSched?.[key] ?? {}), ...patch } } })),
      setNarrativeMemory: (patch) => set((s) => ({ narrativeMemory: { ...s.narrativeMemory, ...patch } })),
      setNmApi: (patch) => set((s) => ({ nmApi: { ...s.nmApi, ...patch } })),
      setNmUseSharedApi: (v) => set({ nmUseSharedApi: v }),
      fetchNmModels: async () => {
        const s = get();
        const api = s.nmUseSharedApi ? (s.textUseSharedApi ? s.api : s.textApi) : s.nmApi;
        if (!api.baseUrl || !api.apiKey) { set({ nmModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ nmModelsLoading: true, nmModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ nmAvailableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), nmModelsLoading: false });
        } catch (e: any) { set({ nmModelsError: e.message ?? '请求失败', nmModelsLoading: false }); }
      },

      // ── 世界选择操作 ──
      setApi: (patch) => set((s) => ({ api: { ...s.api, ...patch } })),

      fetchModels: async () => {
        const { api } = get();
        if (!api.baseUrl || !api.apiKey) { set({ modelsError: '请先填写 API 地址和 Key' }); return; }
        set({ modelsLoading: true, modelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ availableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), modelsLoading: false });
        } catch (e: any) { set({ modelsError: e.message ?? '请求失败', modelsLoading: false }); }
      },

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

      importWorldBook: (raw, fileName = '', builtin = false) => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          set((s) => ({ worldBooks: [...s.worldBooks, { id: `wb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now(), builtin }] }));
          return { ok: true, message: `已导入「${name}」，共 ${entries.length} 条条目` };
        } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
      },

      toggleWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id === id ? { ...b, enabled: !b.enabled } : b) })),
      removeWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.filter((b) => b.id !== id) })),
      renameWorldBook: (id, name) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id === id ? { ...b, name } : b) })),
      toggleWorldBookEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, enabled: !e.enabled } : e) }) })),
      updateWorldBookEntry: (bookId, uid, patch) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, ...patch } : e) }) })),
      addWorldBookEntry: (bookId) => set((s) => {
        const book = s.worldBooks.find((b) => b.id === bookId); if (!book) return s;
        const maxUid = book.entries.reduce((m, e) => Math.max(m, e.uid), -1);
        const maxOrder = book.entries.reduce((m, e) => Math.max(m, e.order), 99);
        return { worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: false, enabled: true, order: maxOrder + 1, position: 0 }] }) };
      }),
      removeWorldBookEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.filter((e) => e.uid !== uid) }) })),

      // ── 正文生成操作 ──
      setTextApi: (patch) => set((s) => ({ textApi: { ...s.textApi, ...patch } })),
      setTextUseSharedApi: (v) => set({ textUseSharedApi: v }),
      setTextStream: (v) => set({ textStream: v }),

      fetchTextModels: async () => {
        const s = get();
        const api = s.textUseSharedApi ? s.api : s.textApi;
        if (!api.baseUrl || !api.apiKey) { set({ textModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ textModelsLoading: true, textModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          set({ textAvailableModels: (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort(), textModelsLoading: false });
        } catch (e: any) { set({ textModelsError: e.message ?? '请求失败', textModelsLoading: false }); }
      },

      importTextWorldBook: (raw, fileName = '', builtin = false) => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          set((s) => ({ textWorldBooks: [...s.textWorldBooks, { id: `twb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now(), builtin }] }));
          return { ok: true, message: `已导入「${name}」，共 ${entries.length} 条条目` };
        } catch (e: any) { return { ok: false, message: `导入失败：${e.message}` }; }
      },

      toggleTextWorldBook: (id) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id === id ? { ...b, enabled: !b.enabled } : b) })),
      removeTextWorldBook: (id) => set((s) => ({ textWorldBooks: s.textWorldBooks.filter((b) => b.id !== id) })),
      renameTextWorldBook: (id, name) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id === id ? { ...b, name } : b) })),
      toggleTextWorldBookEntry: (bookId, uid) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, enabled: !e.enabled } : e) }) })),
      updateTextWorldBookEntry: (bookId, uid, patch) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, ...patch } : e) }) })),
      addTextWorldBookEntry: (bookId) => set((s) => {
        const book = s.textWorldBooks.find((b) => b.id === bookId); if (!book) return s;
        const maxUid = book.entries.reduce((m, e) => Math.max(m, e.uid), -1);
        const maxOrder = book.entries.reduce((m, e) => Math.max(m, e.order), 99);
        return { textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: false, enabled: true, order: maxOrder + 1, position: 0 }] }) };
      }),
      removeTextWorldBookEntry: (bookId, uid) => set((s) => ({ textWorldBooks: s.textWorldBooks.map((b) => b.id !== bookId ? b : { ...b, entries: b.entries.filter((e) => e.uid !== uid) }) })),

      importTextPreset: (raw, fileName = '', builtin = false) => {
        try {
          const data = JSON.parse(raw);
          const id = `preset_${Date.now()}`;
          const preset = parseSTPreset(data, fileName, id);
          set((s) => ({ textPresets: [...s.textPresets, { ...preset, builtin }], activeTextPresetId: preset.id }));
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
        textPresets: s.textPresets.map((p) => p.id === id ? { ...p, ...patch } : p),
      })),
      renameTextPreset: (id, name) => set((s) => ({
        textPresets: s.textPresets.map((p) => p.id === id ? { ...p, name } : p),
      })),
      toggleTextPresetEntry: (presetId, identifier) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : {
            ...p,
            entries: (p.entries ?? []).map((e) =>
              e.identifier === identifier ? { ...e, enabled: !e.enabled } : e
            ),
          }
        ),
      })),
      updateTextPresetEntry: (presetId, identifier, patch) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : {
            ...p,
            entries: (p.entries ?? []).map((e) =>
              e.identifier === identifier ? { ...e, ...patch } : e
            ),
          }
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
            p.id !== presetId ? p : { ...p, entries: [...(p.entries ?? []), newEntry] }
          ),
        };
      }),
      removeTextPresetEntry: (presetId, identifier) => set((s) => ({
        textPresets: s.textPresets.map((p) =>
          p.id !== presetId ? p : { ...p, entries: (p.entries ?? []).filter((e) => e.identifier !== identifier) }
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
          return { ...p, entries: arr };
        }),
      })),
      setActiveTextPreset: (id) => set({ activeTextPresetId: id }),

      // ── 正则通用工具 ──
      ...buildRegexOps(set),
    }),
    {
      name: 'drpg-settings',
      // 世界书 / 正文世界书 / 文本预设 改存 IndexedDB（见 systems/wbDb），localStorage 不再保存它们——
      // 既容纳大世界书（IndexedDB 容量大），又避免撑爆 localStorage 5MB 配额。
      partialize: (s) => ({
        ...s,
        worldBooks: [],
        textWorldBooks: [],
        textPresets: [],
      }),
    }
  )
);
