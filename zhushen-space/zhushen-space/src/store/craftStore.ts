import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig, WorldBook, WorldBookEntry } from './settingsStore';
import { useSettings, parseWorldBook } from './settingsStore';
import { CRAFT_MODES, craftMode, rollCraftQuality, craftCost, validateInputs, type CraftQuality } from '../systems/craftEngine';

/* ════════════════════════════════════════════
   合成工坊 store（drpg-craft）
   - config（门类开关 / 手工费系数 / 匠灵名）+ worldBooks（合成图鉴）= 全局配置（走 configExport；内置书不持久化）
   - session = 当前一次合成的会话：投料 / 倾向 / 掷定的品质档 / AI 产物预览（未入库）——不持久化
   - discovered = 已发现配方缓存（进度，随存档、新游戏清空）
   - 设计见记忆 craft-station-feature（仿 enhanceStore + casinoStore）
   - 关键：产物 pending 只是"预览"，确认前不入库；确认才 consumeItem 投料 + addItem 产物 → 天然支持撤销/重新生成
════════════════════════════════════════════ */

/** 暂存在工坊里的一份投料（背包物品快照 + 本次投入数量）*/
export interface CraftSessionInput {
  itemId: string;
  name: string;
  qty: number;        // 本次投入数量
  maxQty: number;     // 背包现有数量（上限）
  gradeDesc?: string;
  category?: string;
  subType?: string;
}

/** AI 产出的一件产物（未入库，确认后由 App 转成 addItem）*/
export interface CraftProduct {
  name: string;
  category: string;
  subType?: string;
  gradeDesc: string;
  combatStat?: string;
  attrBonus?: string;
  score?: string;
  affix?: string;
  effect?: string;
  intro?: string;
  appearance?: string;
  killCount?: string;
  gemSlot?: string;   // 炼晶产物：可镶嵌部位（走 gemEngine 确定性生成时带）
  gemAttr?: string;   // 炼晶产物：宝石属性
}

export type CraftPhase = 'idle' | 'generating' | 'preview' | 'error';

export interface CraftSession {
  modeId: string;
  inputs: CraftSessionInput[];
  tendency: string;
  quality: CraftQuality | null;   // 开合时掷定、锁住（重新生成沿用）
  cost: number;                   // 本次手工费（乐园币）
  pending: CraftProduct[] | null; // AI 产物预览（未入库）
  phase: CraftPhase;
  error?: string;
}

export interface CraftConfig {
  enabled: boolean;
  enabledModes: Record<string, boolean>;   // 各门类开关
  costMul: number;                          // 手工费系数（0 = 免费）
  craftsmanName: string;                    // 匠灵名（风味）
}

const ALL_MODES_ON = (): Record<string, boolean> => Object.fromEntries(CRAFT_MODES.map((m) => [m.id, true]));

const DEFAULT_CONFIG: CraftConfig = {
  enabled: true,
  enabledModes: ALL_MODES_ON(),
  costMul: 1,
  craftsmanName: '工坊匠灵',
};

function freshSession(modeId = CRAFT_MODES[0].id): CraftSession {
  return { modeId, inputs: [], tendency: '', quality: null, cost: 0, pending: null, phase: 'idle' };
}

/* ── 内置「合成图鉴」世界书 ──
   蓝灯(constant)常驻必注入（守恒/格式/失败/命名）；绿灯(selective)按门类关键词命中才注入（各门类工艺）。
   builtin 本不写入 localStorage（partialize 剥离），启动时由 ensureCraftWbDefaults 按 builtinKey 判重重挂；
   用户一旦编辑/开关，forkCraftWb 转为非内置本 → 随配置持久化。 */
const CRAFT_WB_KEY = 'craft-codex';
function cwbEntry(uid: number, comment: string, content: string, key: string[] = []): WorldBookEntry {
  const green = key.length > 0;
  return {
    uid, comment, content, key, keysecondary: [],
    constant: !green, selective: green,
    enabled: true, order: 100 + uid, position: 1,
  };
}
const DEFAULT_CRAFT_WB: WorldBook = {
  id: 'craftwb_builtin', name: '合成图鉴（内置）',
  builtin: true, builtinKey: CRAFT_WB_KEY, enabled: true, createdAt: 0,
  entries: [
    cwbEntry(1, '守恒律（最高铁则）', '产物的品级与威能由【投入材料】决定：产出品级＝投入最高品级 ±（成功度带来的至多一档），且绝不超过系统在【产出槽】给出的 gradeDesc 上限。投入越稀有、越契合、用料越足 → 产物越好，但一档都不许越。玩家的【倾向提示】只决定产物的**方向**（攻击向/辅助向/某属性/某风格），绝不决定**档次**——写"给我个神器"也顶不破材料定下的上限。忠于原料，不得凭空注水拔高。'),
    cwbEntry(2, '三分格式', '产物"作用"三分、各归其位、绝不重叠：带数字的攻防→combatStat，六维/上限/抗性等数值→attrBonus，带名字的能力机制→affix（每条【名】：触发+作用），说不清数字但确有的定性特质/影响→effect。消耗品（食物/丹药/符箓）的用途与限时增益写进 effect（含效果与持续时间）。'),
    cwbEntry(3, '失败＝黑暗产物（要有趣）', '当【产出槽】给的是白色/废料档（合成失败），产物不是报错、不是空——而是一件"翻车"的正经物品：黑暗料理（难吃但能吃、带滑稽副作用）、炸炉废渣、写坏的乱码符、半融的金属疙瘩……可以无用/滑稽/有微小负面，但仍要按固定格式写全、写得好玩。玩家亏的是材料，收获的是乐子。'),
    cwbEntry(4, '命名与来历', '产物名要呼应投入材料与门类（火矿+利刃→「熔火之刃」，龙血+丹→「龙血回元丹」）。简介(intro)里写明来历——"由 X 与 Y 于工坊中合成"。外观(appearance)逐部件可视化，画得出图。'),
    cwbEntry(5, '锻造工艺', '锻造重在选材与火候：金属需属性相容才能熔铸，杂质多则成品脆；淬火（水/油/血/元素）决定锋利与韧性；铭纹/回火可附额外词条。产物按材料定位——利器给攻击/破甲/元素附魔，重甲给防御/格挡/抗性，饰品给增益/感知。矿石纯度低就只能出低阶货。', ['锻造', '熔炉', '矿石', '金属', '淬火', '铭纹', '兵器', '铸造', '锻锤', '铁']),
    cwbEntry(6, '烹饪·增益时效', '烹饪产物是食物/药膳，食用后获得**限时增益 buff**（写清效果 + 持续，如「30 分钟内力量+15、饱腹」）。搭配讲究：蛋白质回体力、灵植增法力、辛辣提攻速、糖分补精神。同种增益的食材一起做会叠得更强，但一道菜一般只主打一种主效果。乱炖不搭 → 黑暗料理。', ['烹饪', '食材', '火候', '调味', '药膳', '料理', '饱腹', '食物', '菜']),
    cwbEntry(7, '炼金术', '炼金重配比与嬗变：把草药、矿物、精华按相性配伍提纯，转化成药剂/丹药/转化物；相性相冲（水火/生克）会废料甚至析出毒物，提纯火候过猛则出废渣。产物是消耗品（恢复/增益/解毒/淬体等），效果与持续写进 effect。名贵材料才出高阶成品，凡材只能凑普通药剂。', ['炼金', '嬗变', '提纯', '相性', '草药', '矿物', '精华', '药剂', '丹药']),
    cwbEntry(8, '技能卷轴', '把一门技能封进卷轴＝消耗型技能卷轴：使用即施放一次卷内技能，用后即耗。要封的技能与承载媒介（卷轴/符纸/结晶）须匹配，技能越强越吃高阶媒介，撑不住则一触即溃或威力打折。effect 写清「使用后施放【技能名】：效果+数值+范围/持续」，并注明一次性消耗；高阶卷可多次或威力更大。', ['卷轴', '技能卷轴', '符箓', '施放', '技能', '一次性', '消耗', '本源']),
    cwbEntry(9, '魂铸融合·质变', '融合是把两件及以上物品的本源熔于一炉。契合（属性相成、概念呼应）→ 升华或嵌合出更强的新物，甚至质变出全新概念之物；排斥（本源相冲）→ 相互湮灭成废料。融合结果的类别由主导材料决定（武器为主→武器，护符为主→饰品，抽象概念→特殊物品）。这是工坊最能"无中生有"之处，但仍受产出槽品级上限约束。', ['融合', '魂铸', '嵌合', '质变', '本源', '共鸣', '升华', '合成之']),
    cwbEntry(10, '铭刻附魔', '铭刻是在**已有装备**上灌注符文/精华，附加或强化词缀/效果。符文属性要与装备本体契合才稳（火符入火刃相得益彰，冰符入火刃相互抵消）。产物是同一件装备的附魔升级版：保留其本体与既有词条，按符文方向新增/强化词缀，不改其固有稀有度基线。', ['铭刻', '附魔', '符文', '词缀', '重铸', '灌注', '刻印']),
    cwbEntry(11, '主神造物', '主神造物走乐园/主神空间的科技风：合金框架、能源核心供能、芯片/模块定功能，造出装置/傀儡/无人机/义体组件/召唤道具。结构与供能要自洽，功能由部件合理推导（推进模块→机动、护盾发生器→防御、傀儡核心→可召唤的战斗傀儡、侦察无人机→探测）。能源核心不足则出半成品废件。**用科技术语，别掺修仙炼器/法宝味**。', ['主神', '乐园', '造物', '装置', '傀儡', '无人机', '能源核心', '芯片', '纳米', '模块', '召唤', '科技']),
    cwbEntry(12, '宠物·契灵', '把精魂/兽核与契约媒介结契，孕育出一只可随行的**宠物生灵**（不是道具、不是凭证）。精魂强度、血脉纯度、媒介品阶共同决定宠物的种族、形态与天赋；结契不稳则得残缺或狂暴之物。**请把产物当一只活物来写**：name=宠物名、subType=种族、intro=性情性格、appearance=外观、effect/affix=天赋与能力、combatStat=可选的战力概述；gradeDesc 表示这只宠物的品阶。', ['御兽', '契灵', '精魂', '随从', '宠物', '契约', '血脉', '兽核']),
    cwbEntry(13, '分解提炼', '分解是逆向工艺：把一件物品拆解/熔毁，回收其构成材料（数份）。越精良的物品拆出的材料越多、越好，但过程有损耗（回收品级一般不超过原物、且总价值略低于原物）。产出材料的名称/性质要能对应上被拆物（暗金剑→暗金锭+魔钢碎+残余符能）。', ['分解', '提炼', '拆解', '回收', '材料', '熔毁', '精炼']),
    cwbEntry(14, '炼晶', '炼晶把元素/精华凝成可镶嵌的宝石。纯度与元素属性决定宝石的加成方向与强弱：战斗类（攻/防/暴击/元素伤）、功能类（移速/寻宝/冷却）、生活类（采集/庖厨/社交）。杂质多则只能凝出低阶浑浊晶。effect 写其镶嵌加成。', ['炼晶', '宝石', '结晶', '镶嵌', '纯度', '元素', '晶']),
  ],
};
function cloneDefaultCraftWb(): WorldBook { return JSON.parse(JSON.stringify(DEFAULT_CRAFT_WB)); }
function forkCraftWb(b: WorldBook): WorldBook { return b.builtin ? { ...b, builtin: false } : b; }

interface CraftState {
  config: CraftConfig;
  session: CraftSession;
  worldBooks: WorldBook[];
  discovered: Record<string, { name: string; at: number }>;   // recipeKey → 最近产物名（配方图鉴/一致性）

  craftApi: ApiConfig;
  craftUseSharedApi: boolean;
  craftAvailableModels: string[];
  craftModelsLoading: boolean;
  craftModelsError: string;

  /* ── 会话（选料 / 倾向 / 掷品质 / 预览）── */
  setMode: (id: string) => void;
  addInput: (input: Omit<CraftSessionInput, 'qty'> & { qty?: number }) => void;
  setInputQty: (itemId: string, qty: number) => void;
  removeInput: (itemId: string) => void;
  clearInputs: () => void;
  setTendency: (t: string) => void;
  /** 校验 + 掷品质 + 记手工费；成功返回 {ok:true}，失败返回原因。随后由 App 调 runCraftPhase。*/
  startCraft: () => { ok: boolean; why?: string };
  setGenerating: () => void;
  setPending: (products: CraftProduct[]) => void;
  setError: (msg: string) => void;
  resetResult: () => void;      // 重新生成前：清 pending（品质保留，供重新生成沿用）
  backToStaging: () => void;    // 撤销：丢弃预览+品质，回到选料台（保留投料/倾向，未消耗任何东西）
  recordDiscovered: (names: string[]) => void;
  endSession: () => void;       // 关面板/确认后：整会话清空

  /* ── 配置 ── */
  setConfig: (patch: Partial<CraftConfig>) => void;
  toggleMode: (id: string) => void;

  /* ── 合成图鉴世界书 ── */
  importCraftWorldBook: (raw: string, fileName?: string) => { ok: boolean; message: string };
  toggleCraftWorldBook: (id: string) => void;
  removeCraftWorldBook: (id: string) => void;
  toggleCraftWbEntry: (bookId: string, uid: number) => void;
  updateCraftWbEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addCraftWbEntry: (bookId: string) => void;
  removeCraftWbEntry: (bookId: string, uid: number) => void;
  resetCraftWorldBooks: () => void;

  /* ── API ── */
  setCraftApi: (patch: Partial<ApiConfig>) => void;
  setCraftUseSharedApi: (v: boolean) => void;
  fetchCraftModels: () => Promise<void>;

  clearCraft: () => void;
}

export const useCraft = create<CraftState>()(
  persist(
    (set, get): CraftState => ({
      config: { ...DEFAULT_CONFIG },
      session: freshSession(),
      worldBooks: [],
      discovered: {},

      craftApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o-mini',
        temperature: 0.9, maxTokens: 2048, topP: 1,
      },
      craftUseSharedApi: true,
      craftAvailableModels: [],
      craftModelsLoading: false,
      craftModelsError: '',

      setMode: (id) => set({ session: freshSession(id) }),

      addInput: (input) =>
        set((s) => {
          if (s.session.inputs.some((x) => x.itemId === input.itemId)) return s;   // 已在料格
          const qty = Math.max(1, Math.min(input.qty ?? 1, input.maxQty));
          return { session: { ...s.session, inputs: [...s.session.inputs, { ...input, qty }], quality: null, pending: null, phase: 'idle' } };
        }),

      setInputQty: (itemId, qty) =>
        set((s) => ({
          session: {
            ...s.session,
            inputs: s.session.inputs.map((x) => (x.itemId === itemId ? { ...x, qty: Math.max(1, Math.min(Math.floor(qty) || 1, x.maxQty)) } : x)),
            quality: null, pending: null, phase: 'idle',
          },
        })),

      removeInput: (itemId) =>
        set((s) => ({ session: { ...s.session, inputs: s.session.inputs.filter((x) => x.itemId !== itemId), quality: null, pending: null, phase: 'idle' } })),

      clearInputs: () => set((s) => ({ session: { ...s.session, inputs: [], quality: null, pending: null, phase: 'idle' } })),

      setTendency: (t) => set((s) => ({ session: { ...s.session, tendency: t } })),

      startCraft: () => {
        const s = get();
        const mode = craftMode(s.session.modeId);
        const v = validateInputs(mode, s.session.inputs);
        if (!v.ok) return v;
        const quality = rollCraftQuality(s.session.inputs, mode);
        const cost = craftCost(s.session.inputs, s.config.costMul);
        set({ session: { ...s.session, quality, cost, pending: null, phase: 'generating', error: undefined } });
        return { ok: true };
      },

      setGenerating: () => set((s) => ({ session: { ...s.session, phase: 'generating', error: undefined } })),
      setPending: (products) => set((s) => ({ session: { ...s.session, pending: products, phase: 'preview', error: undefined } })),
      setError: (msg) => set((s) => ({ session: { ...s.session, phase: 'error', error: msg } })),
      resetResult: () => set((s) => ({ session: { ...s.session, pending: null, phase: 'generating', error: undefined } })),
      backToStaging: () => set((s) => ({ session: { ...s.session, pending: null, quality: null, cost: 0, phase: 'idle', error: undefined } })),

      recordDiscovered: (names) =>
        set((s) => {
          const mode = s.session.modeId;
          const key = mode + '|' + s.session.inputs.map((x) => x.name).sort().join('+');
          return { discovered: { ...s.discovered, [key]: { name: names.join('、'), at: Date.now() } } };
        }),

      endSession: () => set((s) => ({ session: freshSession(s.session.modeId) })),

      setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
      toggleMode: (id) => set((s) => ({ config: { ...s.config, enabledModes: { ...s.config.enabledModes, [id]: !(s.config.enabledModes[id] ?? true) } } })),

      importCraftWorldBook: (raw, fileName) => {
        try {
          const { entries, name } = parseWorldBook(raw, fileName);
          if (!entries.length) return { ok: false, message: '未解析到任何世界书条目' };
          set((s) => ({ worldBooks: [...s.worldBooks, { id: `craftwb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now() }] }));
          return { ok: true, message: `已导入「${name}」（${entries.length} 条）` };
        } catch (e: any) {
          return { ok: false, message: `导入失败：${e?.message ?? '格式错误'}` };
        }
      },
      toggleCraftWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.map((b) => (b.id === id ? forkCraftWb({ ...b, enabled: !b.enabled }) : b)) })),
      removeCraftWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.filter((b) => b.id !== id) })),
      toggleCraftWbEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => (b.id !== bookId ? b : forkCraftWb({ ...b, entries: b.entries.map((e) => (e.uid === uid ? { ...e, enabled: !e.enabled } : e)) }))) })),
      updateCraftWbEntry: (bookId, uid, patch) => set((s) => ({ worldBooks: s.worldBooks.map((b) => (b.id !== bookId ? b : forkCraftWb({ ...b, entries: b.entries.map((e) => (e.uid === uid ? { ...e, ...patch } : e)) }))) })),
      addCraftWbEntry: (bookId) => set((s) => ({ worldBooks: s.worldBooks.map((b) => {
        if (b.id !== bookId) return b;
        const uid = Math.max(0, ...b.entries.map((e) => e.uid)) + 1;
        return forkCraftWb({ ...b, entries: [...b.entries, cwbEntry(uid, '新条目', '')] });
      }) })),
      removeCraftWbEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => (b.id !== bookId ? b : forkCraftWb({ ...b, entries: b.entries.filter((e) => e.uid !== uid) }))) })),
      resetCraftWorldBooks: () => set((s) => ({ worldBooks: [cloneDefaultCraftWb(), ...s.worldBooks.filter((b) => b.builtinKey !== CRAFT_WB_KEY)] })),

      setCraftApi: (patch) => set((s) => ({ craftApi: { ...s.craftApi, ...patch } })),
      setCraftUseSharedApi: (v) => set({ craftUseSharedApi: v }),
      fetchCraftModels: async () => {
        const s = get();
        const api = s.craftUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.craftApi;
        if (!api.baseUrl || !api.apiKey) { set({ craftModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ craftModelsLoading: true, craftModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ craftAvailableModels: models, craftModelsLoading: false });
        } catch (e: any) {
          set({ craftModelsError: e.message ?? '请求失败', craftModelsLoading: false });
        }
      },

      clearCraft: () => set(() => ({ session: freshSession(), discovered: {} })),   // 新游戏：清会话+已发现配方，保留配置/世界书/API
    }),
    {
      name: 'drpg-craft',
      // 持久化：配置 + 已发现配方 + 非内置世界书 + API；session/瞬时模型态不存；内置书由 ensureCraftWbDefaults 重挂
      partialize: (s: any) => ({
        config: s.config,
        discovered: s.discovered,
        worldBooks: (s.worldBooks ?? []).filter((b: WorldBook) => !b.builtin),
        craftApi: s.craftApi,
        craftUseSharedApi: s.craftUseSharedApi,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        config: { ...DEFAULT_CONFIG, ...(persisted?.config ?? {}), enabledModes: { ...ALL_MODES_ON(), ...(persisted?.config?.enabledModes ?? {}) } },
        discovered: persisted?.discovered ?? {},
        worldBooks: Array.isArray(persisted?.worldBooks) ? persisted.worldBooks : [],
        session: freshSession(),
        craftApi: { ...current.craftApi, ...(persisted?.craftApi ?? {}) },
        craftUseSharedApi: persisted?.craftUseSharedApi ?? current.craftUseSharedApi,
        craftAvailableModels: [],
        craftModelsLoading: false,
        craftModelsError: '',
      }),
    },
  ),
);

/** 确保内置「合成图鉴」世界书存在（builtin 不持久化，启动按 builtinKey 判重重挂）。 */
export function ensureCraftWbDefaults() {
  const have = useCraft.getState().worldBooks.some((b) => b.builtinKey === CRAFT_WB_KEY);
  if (!have) useCraft.setState((s) => ({ worldBooks: [cloneDefaultCraftWb(), ...s.worldBooks] }));
}
ensureCraftWbDefaults();
