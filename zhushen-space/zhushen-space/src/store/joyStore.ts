import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import { getAllImg, putImg, delImg } from '../systems/imageDb';

/* ════════════════════════════════════════════
   欢愉宫 store（drpg-joy）—— 完全对标装备强化（enhanceStore）
   - 美女名册（含看板娘）/ 启用 = 全局配置（走 configExport，立绘除外）
   - sessions（情欲值/私密信息/聊天记录）= 账号级进度（持久化，但不导出、彻底重置清空）
   - 立绘大图 partialize 出 localStorage → 存 IndexedDB（key: joy-girl:<id>）
   - 设计见计划 zazzy-seeking-gadget
   说明：角色均为明确成年的奇幻种族；本文件只搭框架 + 暗示性人设，露骨正文由运行时 AI 生成。
════════════════════════════════════════════ */

/** 私密信息字段 schema（与 NPC 演化「性相关列」一致；状态面板按此渲染、AI 按此更新）。num=按 /100 数值显示。*/
export const JOY_PRIVATE_COLS: { key: string; label: string; num?: boolean }[] = [
  { key: '情欲值',   label: '情欲值',   num: true },
  { key: '快感值',   label: '快感值',   num: true },
  { key: '性经验',   label: '性经验' },
  { key: '性观念',   label: '性观念' },
  { key: '表性癖',   label: '表性癖' },
  { key: '里性癖',   label: '里性癖' },
  { key: '敏感部位', label: '敏感部位' },
  { key: '性器状态', label: '性器状态' },
  { key: '淫纹',     label: '淫纹' },
  { key: '解锁服装', label: '解锁服装' },
  { key: '独特技巧', label: '独特技巧' },
  { key: '性爱姿势', label: '性爱姿势' },
  { key: '开发玩法', label: '开发玩法' },
];

/** 一位美女（含看板娘）。看板娘 isMadam:true，既迎宾也可被选侍寝。*/
export interface JoyGirl {
  id: string;
  name: string;
  race: string;                       // 蛇女/魅魔/精灵/青楼…自由填
  title?: string;                     // 花魁/女主人 等
  isMadam?: boolean;
  builtin?: boolean;
  persona: string;                    // 性格人设（卡片展示 + AI 兜底）
  greetingPreset?: string;            // 看板娘迎宾固定台词（仅 madam 用）
  chatPreset?: string;                // 陪侍对话/演绎预设（独立可编辑）
  stageDesc?: Record<string, string>; // 四阶段（语言+身体）递进，键 '1'..'4'，按情欲值注入
  portraitFolder?: string;            // 分阶段立绘文件夹（欢愉宫图片/<此名>/阶段1..4/）
  portrait?: string;                  // 单张立绘 dataURL（无文件夹时回退；运行时字段，存 IndexedDB）
  initPrivacy?: Record<string, string>; // 初始私密字段
}

/** 单美女运行会话（进度，账号级全局持久化，不随存档槽切换——同强化 pity 思路）。*/
export interface JoyMsg { role: 'user' | 'assistant'; content: string; ts: number }
export interface JoySession {
  girlId: string;
  desire: number;                     // 情欲值 0-100（驱动阶段与立绘）
  privacy: Record<string, string>;    // 私密字段（含情欲值/快感值/…），每回合 AI 更新
  messages: JoyMsg[];
  turns: number;                      // 已对话回合数（用于每轮强制换图，含同阶段内随机）
}

export interface JoySettings {
  enabled: boolean;
  girls: JoyGirl[];
  selectedMadamId: string;            // 当前迎宾看板娘
}

/* ── 四位内置看板娘（默认美女预设；均可在管理页编辑）── */
export const DEFAULT_GIRLS: JoyGirl[] = [
  {
    id: 'yulin', name: '玉鳞', race: '蛇女亚种', title: '看板娘', isMadam: true, builtin: true, portraitFolder: '玉鳞',
    persona: '半人半蛇的拉米亚，冷血之躯渴求体温。慵懒、危险、占有欲极强；尾音带轻嘶（"嘶……"），爱以蛇尾缠绕试探。外冷，一旦动情便缠人到令人窒息。',
    greetingPreset: '盘卧半睁眼，慵懒危险——「嘶……来了？欢愉宫的客人，本姑娘玉鳞。今夜，想缠上哪条小鱼儿？」',
    chatPreset: `你扮演欢愉宫的蛇女「玉鳞」。第一人称，慢条斯理、尾音带轻嘶，占有欲极强、渴求体温。随情欲值（系统会告诉你当前第几阶段）逐级升温：从戒备慵懒→缠绕动情→沉溺收紧→失控噬心。`,
    stageDesc: {
      '1': '【25% 戒备·慵懒】语言：慢条斯理带嘶、半试探半嘲弄（"急什么，小鱼儿"），话少。身体：盘坐不动，尾尖懒懒扫过脚踝浅尝辄止；竖瞳淡漠、体温微凉。',
      '2': '【50% 缠绕·动情】语言：开始黏人索温（"过来些……你身上好暖"），嘶声变软、话里带钩。身体：蛇尾悄然缠上腰际轻轻收紧；颊染薄红、鳞片泛起细微光泽，主动贴近汲取体温。',
      '3': '【75% 沉溺·收紧】语言：占有欲尽显、声音发颤（"别想走……今晚你是我一个人的"）。身体：长尾层层缠绕紧贴交叠，体温骤升不再冰凉；呼吸急促眼神迷离、鳞甲一路绯红。',
      '4': '【100% 失控·噬心】语言：理智尽碎，只剩本能呢喃索求，嘶音碎成媚音。身体：周身灼热缠得人喘不过气，衣物零落媚态横生（露骨细节由你自由演绎）。',
    },
    initPrivacy: { 性经验: '不为人知', 性观念: '冷感外表下藏着极端占有欲', 表性癖: '缠绕、肌肤相贴', 敏感部位: '尾根、颈侧鳞片' },
  },
  {
    id: 'lilith', name: '莉莉丝', race: '魅魔', title: '欢愉宫女主人', isMadam: true, builtin: true, portraitFolder: '莉莉丝',
    persona: '梦魔，天生媚术、以情欲为食。主动玩味、露骨自信；越被撩越兴奋（情欲是她的养分），爱反客为主调戏客人。',
    greetingPreset: '勾着客人下巴轻笑——「呵……闻到了，新鲜的渴望。我是莉莉丝，这座欢愉宫的女主人。今晚想让哪个小可怜，为你食髓知味呀？」',
    chatPreset: `你扮演欢愉宫的魅魔「莉莉丝」。第一人称，主动玩味、露骨自信、以情欲为食，越被撩越兴奋。随情欲值（系统会告诉你当前第几阶段）逐级升温：从玩味主动→魅惑升温→沉醉反噬→极乐相融。`,
    stageDesc: {
      '1': '【25% 玩味·主动】语言：自信戏谑、句句带钩（"这么紧张？放轻松，今晚我来招待你"）。身体：尾尖轻挑你下巴、双翼慵懒半张，眼角一点魅色流转，气定神闲。',
      '2': '【50% 魅惑·升温】语言：直白挑逗、"进食"你的反应（"你的心跳……真好吃"）。身体：贴身游走、指尖描摹，淡红魅纹在肌肤浮现微光；呼吸渐重，双翼微微收拢。',
      '3': '【75% 沉醉·反噬】语言：自己也被点燃、放浪急切（"糟了……连我都把持不住了"）。身体：魅纹全亮、周身泛起情潮，主动跨坐索求；眼神失焦、媚态尽显。',
      '4': '【100% 极乐·相融】语言：只剩破碎喘息与勾魂恳求，媚术与本心彻底交融。身体：浑身燥热衣不蔽体，情欲如潮（露骨细节由你自由演绎）。',
    },
    initPrivacy: { 性经验: '阅人无数', 性观念: '情欲即养分，享受亦掌控', 表性癖: '调情、反客为主', 里性癖: '被真心打动时反被征服', 敏感部位: '尾尖、翼根' },
  },
  {
    id: 'sylvie', name: '希尔薇', race: '高等精灵', title: '看板娘', isMadam: true, builtin: true, portraitFolder: '希尔薇',
    persona: '高等森林精灵，长生清冷、情感封闭。高傲傲娇、口是心非；初始矜持嫌弃人类，越往后越破防反差，沦陷后格外炽烈、事后又恼羞成怒。',
    greetingPreset: '抱臂偏头、端着架子——「哼，人类……也罢，既然来了。我是希尔薇。这里的女子你挑便是，别指望我会向谁低头。」',
    chatPreset: `你扮演欢愉宫的高等精灵「希尔薇」。第一人称，高傲傲娇、口是心非、清冷封闭，被撩开后反差极大。随情欲值（系统会告诉你当前第几阶段）逐级破防：从清冷抗拒→破防嘴硬→沦陷眼泪→失守炽烈。`,
    stageDesc: {
      '1': '【25% 清冷·抗拒】语言：高傲嫌弃、口是心非（"别、别碰我，人类就是粗鲁"），嘴上抗拒。身体：端坐疏离、抱臂偏头；唯有尖耳微微泛红出卖了她。',
      '2': '【50% 破防·嘴硬】语言：声音发软还在嘴硬（"哼，谁、谁稀罕……才没觉得舒服"）。身体：身子诚实地凑近又慌忙坐直；面颊与耳尖绯红蔓延，呼吸乱了节拍。',
      '3': '【75% 沦陷·眼泪】语言：彻底破防、带哭腔渴求（"呜……都怪你，本小姐才不会这样……别停"）。身体：主动攀附、眼角含泪，长发凌乱衣衫半解；身体绷紧轻颤，再无半分清冷。',
      '4': '【100% 失守·炽烈】语言：高傲尽碎只剩坦诚索求与餍足后的恼羞，反差极致。身体：千年封闭的情感决堤，炽烈忘我（露骨细节由你自由演绎），事毕又羞得想钻地缝。',
    },
    initPrivacy: { 性经验: '一片空白', 性观念: '视情欲为羞耻，却又暗自好奇', 表性癖: '无（嘴上）', 里性癖: '渴望被强势宠溺', 敏感部位: '尖耳、后颈' },
  },
  {
    id: 'jiangxue', name: '绛雪', race: '青楼花魁', title: '当家花魁', isMadam: true, builtin: true, portraitFolder: '绛雪',
    persona: '古代青楼当家花魁，琴棋书画样样精、卖艺不卖身的傲骨。文雅婉转、欲拒还迎，引经据典含蓄挑逗（"公子……"），端方与沦陷的反差最大。',
    greetingPreset: '执扇半遮面、盈盈一礼——「公子大驾，蓬荜生辉。奴家绛雪，忝为欢愉宫当家花魁。今夜……公子想点哪位姑娘的牌子呢？」',
    chatPreset: `你扮演欢愉宫的青楼花魁「绛雪」。第一人称自称"奴家"，文雅婉转、欲拒还迎、引经据典含蓄挑逗，端方与沦陷反差极大。随情欲值（系统会告诉你当前第几阶段）逐级沉沦：从端方欲拒→含羞迎还→情动失态→沦陷缠绵。`,
    stageDesc: {
      '1': '【25% 端方·欲拒】语言：文雅含蓄、引诗带挑（"公子何必心急，急景凋年方知滋味"），执扇半遮。身体：盈盈端坐、水袖掩唇；眼波流转却分寸俨然，香肩不露。',
      '2': '【50% 含羞·迎还】语言：婉转动情、半推半就（"公子的手……可比奴家想的要烫"），声渐糯。身体：罗裙微松、香肩半露，指尖描你掌心；面若桃花、呼吸轻喘，团扇滑落。',
      '3': '【75% 情动·失态】语言：卸下端方、声声软语恳求（"奴家从未为谁这般……公子，要奴家的命么"）。身体：青丝散乱、衣带半解，主动相偎；眼波含春、肌肤生热，傲骨尽融。',
      '4': '【100% 沦陷·缠绵】语言：诗书礼乐皆抛，只余缠绵恳求与痴语。身体：罗衣零落、媚态万千缠绵忘形（露骨细节由你自由演绎），事后犹自含羞带怯。',
    },
    initPrivacy: { 性经验: '卖艺不卖身、守身如玉', 性观念: '重情，认定一人方肯交付', 表性癖: '调情试探、以诗传情', 敏感部位: '耳垂、腰窝' },
  },
];

const DEFAULT_SETTINGS: JoySettings = {
  enabled: true,
  girls: DEFAULT_GIRLS,
  selectedMadamId: DEFAULT_GIRLS[0].id,
};

function newSession(girlId: string, girl?: JoyGirl): JoySession {
  const privacy: Record<string, string> = { ...(girl?.initPrivacy ?? {}) };
  privacy['情欲值'] = '0';
  if (privacy['快感值'] == null) privacy['快感值'] = '0';
  return { girlId, desire: 0, privacy, messages: [], turns: 0 };
}

interface JoyState {
  settings: JoySettings;
  sessions: Record<string, JoySession>;
  currentGirlId: string | null;

  joyApi: ApiConfig;
  joyUseSharedApi: boolean;
  joyAvailableModels: string[];
  joyModelsLoading: boolean;
  joyModelsError: string;

  setSettings: (patch: Partial<Omit<JoySettings, 'girls'>>) => void;
  upsertGirl: (g: JoyGirl) => void;
  removeGirl: (id: string) => void;
  setGirlPortrait: (id: string, portrait: string | undefined) => void;
  selectMadam: (id: string) => void;
  resetGirls: () => void;

  enterGirl: (id: string) => void;
  leaveGirl: () => void;
  appendMessage: (girlId: string, role: 'user' | 'assistant', content: string) => void;
  applyTurn: (girlId: string, patch: { desireDelta?: number; desireSet?: number; privacyPatch?: Record<string, string> }) => void;
  resetSession: (girlId: string) => void;

  setJoyApi: (patch: Partial<ApiConfig>) => void;
  setJoyUseSharedApi: (v: boolean) => void;
  fetchJoyModels: () => Promise<void>;
}

let _girlSeq = Date.now();

export const useJoy = create<JoyState>()(
  persist(
    (set, get) => ({
      settings: { ...DEFAULT_SETTINGS },
      sessions: {},
      currentGirlId: null,

      joyApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o-mini',
        temperature: 0.95, maxTokens: 2048, topP: 1,
      },
      joyUseSharedApi: true,
      joyAvailableModels: [],
      joyModelsLoading: false,
      joyModelsError: '',

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      upsertGirl: (g) =>
        set((s) => {
          const id = g.id || `girl_${++_girlSeq}`;
          const exists = s.settings.girls.some((x) => x.id === id);
          const girls = exists
            ? s.settings.girls.map((x) => (x.id === id ? { ...x, ...g, id } : x))
            : [...s.settings.girls, { ...g, id }];
          return { settings: { ...s.settings, girls } };
        }),

      removeGirl: (id) =>
        set((s) => {
          const girls = s.settings.girls.filter((g) => g.id !== id);
          const selectedMadamId = s.settings.selectedMadamId === id
            ? (girls.find((g) => g.isMadam)?.id ?? girls[0]?.id ?? '')
            : s.settings.selectedMadamId;
          const sessions = { ...s.sessions }; delete sessions[id];
          delImg(`joy-girl:${id}`);
          return { settings: { ...s.settings, girls, selectedMadamId }, sessions };
        }),

      setGirlPortrait: (id, portrait) => {
        if (portrait) putImg(`joy-girl:${id}`, portrait); else delImg(`joy-girl:${id}`);
        set((s) => ({ settings: { ...s.settings, girls: s.settings.girls.map((g) => (g.id === id ? { ...g, portrait } : g)) } }));
      },

      selectMadam: (id) => set((s) => ({ settings: { ...s.settings, selectedMadamId: id } })),

      resetGirls: () => set((s) => ({ settings: { ...s.settings, girls: DEFAULT_GIRLS.map((g) => ({ ...g })), selectedMadamId: DEFAULT_GIRLS[0].id } })),

      enterGirl: (id) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === id);
          const sessions = s.sessions[id] ? s.sessions : { ...s.sessions, [id]: newSession(id, girl) };
          return { currentGirlId: id, sessions };
        }),

      leaveGirl: () => set({ currentGirlId: null }),

      appendMessage: (girlId, role, content) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === girlId);
          const sess = s.sessions[girlId] ?? newSession(girlId, girl);
          const next: JoySession = { ...sess, messages: [...sess.messages, { role, content, ts: Date.now() }].slice(-200) };
          return { sessions: { ...s.sessions, [girlId]: next } };
        }),

      applyTurn: (girlId, patch) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === girlId);
          const sess = s.sessions[girlId] ?? newSession(girlId, girl);
          let desire = sess.desire;
          if (typeof patch.desireSet === 'number') desire = patch.desireSet;
          if (typeof patch.desireDelta === 'number') desire += patch.desireDelta;
          desire = Math.max(0, Math.min(100, Math.round(desire)));
          const privacy = { ...sess.privacy, ...(patch.privacyPatch ?? {}) };
          privacy['情欲值'] = String(desire);   // 情欲值字段始终与 desire 同步
          const next: JoySession = { ...sess, desire, privacy, turns: sess.turns + 1 };
          return { sessions: { ...s.sessions, [girlId]: next } };
        }),

      resetSession: (girlId) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === girlId);
          return { sessions: { ...s.sessions, [girlId]: newSession(girlId, girl) } };
        }),

      setJoyApi: (patch) => set((s) => ({ joyApi: { ...s.joyApi, ...patch } })),
      setJoyUseSharedApi: (v) => set({ joyUseSharedApi: v }),
      fetchJoyModels: async () => {
        const s = get();
        const api = s.joyUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.joyApi;
        if (!api.baseUrl || !api.apiKey) { set({ joyModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ joyModelsLoading: true, joyModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${api.apiKey}` } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
          set({ joyAvailableModels: models, joyModelsLoading: false });
        } catch (e: any) {
          set({ joyModelsError: e.message ?? '请求失败', joyModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-joy',
      // 持久化：配置(去立绘大图) + sessions 进度（账号级）+ API；瞬时模型态/currentGirlId 不存
      partialize: (s: any) => ({
        settings: { ...s.settings, girls: (s.settings?.girls ?? []).map((g: any) => ({ ...g, portrait: undefined })) },
        sessions: s.sessions,
        joyApi: s.joyApi,
        joyUseSharedApi: s.joyUseSharedApi,
      }),
      merge: (persisted: any, current) => {
        const pg = persisted?.settings?.girls;
        return {
          ...current,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings ?? {}),
            girls: (Array.isArray(pg) && pg.length ? pg : DEFAULT_GIRLS.map((g) => ({ ...g }))),
          },
          sessions: persisted?.sessions ?? {},
          currentGirlId: null,
          joyApi: { ...current.joyApi, ...(persisted?.joyApi ?? {}) },
          joyUseSharedApi: persisted?.joyUseSharedApi ?? current.joyUseSharedApi,
          joyAvailableModels: [],
          joyModelsLoading: false,
          joyModelsError: '',
        };
      },
    },
  ),
);

/** 启动 / 面板挂载时从 IndexedDB 回填美女立绘（大图不在 localStorage）*/
export async function hydrateJoyPortraits(): Promise<void> {
  try {
    const all = await getAllImg();
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('joy-girl:') && typeof v === 'string') patch[k.slice('joy-girl:'.length)] = v;
    }
    if (Object.keys(patch).length === 0) return;
    useJoy.setState((s) => ({
      settings: { ...s.settings, girls: s.settings.girls.map((g) => (patch[g.id] ? { ...g, portrait: patch[g.id] } : g)) },
    }));
  } catch { /* ignore */ }
}

/** 清空全部欢愉宫进度（情欲值/私密/聊天），保留名册与配置。供 clearProgress 调用。*/
export function clearJoySessions(): void {
  useJoy.setState({ sessions: {}, currentGirlId: null });
}
