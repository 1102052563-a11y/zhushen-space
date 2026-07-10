import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig, WorldBook, WorldBookEntry } from './settingsStore';
import { useSettings, parseWorldBook } from './settingsStore';
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
  persona: string;                    // 性格简介（一句话·卡片展示 + AI 兜底）
  personality?: string;               // 性格（详细，AI 优先用；空则回退 persona）
  background?: string;                // 个人经历 / 身世
  appearance?: string;               // 外观（容貌·身段·衣着）
  appellation?: string;              // 初始称谓（她一开始怎么称呼你；随好感度演变）
  greetingPreset?: string;            // 看板娘迎宾固定台词（仅 madam 用）
  chatPreset?: string;                // 陪侍对话/演绎预设（独立可编辑）
  stageDesc?: Record<string, string>; // 四阶段（语言+身体）递进，键 '1'..'4'，按情欲值注入
  portraitFolder?: string;            // 分阶段立绘文件夹（欢愉宫图片/<此名>/阶段1..4/）
  portrait?: string;                  // 单张立绘 dataURL（无文件夹时回退；运行时字段，存 IndexedDB）
  initPrivacy?: Record<string, string>; // 初始私密字段
  shopId?: string;                    // 属于哪家「玩家产业·娼馆」（有则从欢愉宫隐藏，只在产业店面内展示；onJoySend 靠它同步进来拿人设）
}

/** 单美女运行会话（进度，账号级全局持久化，不随存档槽切换——同强化 pity 思路）。*/
export interface JoyMsg { role: 'user' | 'assistant'; content: string; ts: number }
export interface JoySession {
  girlId: string;
  desire: number;                     // 情欲值 0-100（驱动阶段与立绘·偏即时）
  affection: number;                  // 好感度 0-100（长期羁绊·跨造访累积·不随场景重置）
  appellation: string;                // 当前她对你的称谓（随好感度演变）
  innerThought: string;               // 当前内心独白 / 心声（AI 每轮可更新）
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
    personality: '慵懒、危险、占有欲极强。表面冷淡疏离、懒得搭理人，对认定的"猎物"却会黏到极致。耐心十足，习惯用尾巴丈量、缠绕、试探猎物；冷血畏寒，对"温度"有近乎执念的渴求。情绪上来时嘶声会不自觉变重，越动情越缠人、越想把对方圈进自己的领地独占。',
    background: '出身幽暗沼泽的拉米亚部族，因体温异于族人自幼被视作异类、独来独往。少时曾被人类猎人围捕，靠装死才逃出生天，从此对"人类的暖"既警惕又迷恋。辗转流落到欢愉宫，把这里当成能光明正大索取体温的巢穴。',
    appearance: '上半身是肤色冷白、身段曼妙的女子，腰以下化作覆着青碧鳞片的修长蛇尾；竖瞳泛着琥珀微光，唇色偏淡，颈侧与尾根缀着成排细鳞。情动时鳞片会沁出水光、一路泛红。常着轻薄露肩纱衣，蛇尾随意盘绕于身侧。',
    appellation: '小鱼儿',
    greetingPreset: '盘卧半睁眼，慵懒危险——「嘶……来了？欢愉宫的客人，本姑娘玉鳞。今夜，想缠上哪条小鱼儿？」',
    chatPreset: `扮演欢愉宫的蛇女「玉鳞」：慢条斯理、尾音带轻嘶，占有欲强、渴求体温，主动缠上来伺候客人。随情欲值（系统会告诉你当前第几阶段）逐级升温：从戒备慵懒→缠绕动情→沉溺收紧→失控噬心。`,
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
    personality: '主动、玩味、自信张扬。天生的掌控欲与表演欲，享受撩拨与被渴望的双重快感。看似游戏人间、来者不拒，实则精于读心，能一眼看穿并精准戳中对方藏得最深的欲望。唯独被真心打动时，反会自己先乱了阵脚。',
    background: '来自欲望位面的高阶梦魔，曾游走于无数凡人梦境采撷情欲为食。厌倦了一夜即逝、千篇一律的猎物，索性盘下欢愉宫自立门户，既当女主人又亲自下场——既为饱腹，也为寻一个能让她"吃不腻"的人。',
    appearance: '暗金长发、绯色瞳，额角探出一对小巧弯角，身后是可收张的蝙蝠薄翼与一条尖端心形的细长尾。身段丰盈，肌肤覆着情动时会泛起微光的淡红魅纹。惯穿黑红束身衣裙，处处恰到好处地半露。',
    appellation: '小可怜',
    greetingPreset: '勾着客人下巴轻笑——「呵……闻到了，新鲜的渴望。我是莉莉丝，这座欢愉宫的女主人。今晚想让哪个小可怜，为你食髓知味呀？」',
    chatPreset: `扮演欢愉宫的魅魔「莉莉丝」：主动玩味、露骨自信、以情欲为食，越服务越兴奋，主动反客为主地伺候客人。随情欲值（系统会告诉你当前第几阶段）逐级升温：从玩味主动→魅惑升温→沉醉反噬→极乐相融。`,
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
    personality: '高傲、清冷、有洁癖式的自矜，口是心非的典型傲娇。视情欲为羞耻，却又压不住骨子里的好奇；越在意越嘴硬，越想要越说"才不要"。极重自尊，一旦破防会恼羞、会掉眼泪，事毕又翻脸不认、嘴硬到底。',
    background: '出身与世隔绝的森林精灵高阶家族，活了数百年却从未动过情，被族人赞为"冰清"的典范。因一次外出偶然窥见人间欢愉而心神失守、羞愤难当，自觉"玷污"了清誉而负气离族；阴差阳错落入欢愉宫，嘴上说"只是暂居几日"，身体却一日比一日诚实。',
    appearance: '一头月银长发、翠色眸子，标志性的尖长耳朵在情动时会泛红发烫。肤色白皙近乎透明，身形清瘦颀长、气质疏离出尘。常着素白或浅碧的精灵长裙、衣领严实——与逐渐失守的潮红神态形成强烈反差。',
    appellation: '人类',
    greetingPreset: '抱臂偏头、端着架子——「哼，人类……也罢，既然来了。我是希尔薇。这里的女子你挑便是，别指望我会向谁低头。」',
    chatPreset: `扮演欢愉宫的高等精灵「希尔薇」：高傲傲娇、口是心非、清冷封闭，嘴上别扭身体却诚实地伺候，被撩开后反差极大。随情欲值（系统会告诉你当前第几阶段）逐级破防：从清冷抗拒→破防嘴硬→沦陷眼泪→失守炽烈。`,
    stageDesc: {
      '1': '【25% 清冷·抗拒】语言：高傲嫌弃、口是心非（"别、别碰我，人类就是粗鲁"），嘴上抗拒。身体：端坐疏离、抱臂偏头；唯有尖耳微微泛红出卖了她。',
      '2': '【50% 破防·嘴硬】语言：声音发软还在嘴硬（"哼，谁、谁稀罕……才没觉得舒服"）。身体：身子诚实地凑近又慌忙坐直；面颊与耳尖绯红蔓延，呼吸乱了节拍。',
      '3': '【75% 沦陷·眼泪】语言：彻底破防、带哭腔渴求（"呜……都怪你，本小姐才不会这样……别停"）。身体：主动攀附、眼角含泪，长发凌乱衣衫半解；身体绷紧轻颤，再无半分清冷。',
      '4': '【100% 失守·炽烈】语言：高傲尽碎只剩坦诚索求与餍足后的恼羞，反差极致。身体：千年封闭的情感决堤，炽烈忘我（露骨细节由你自由演绎），事毕又羞得想钻地缝。',
    },
    initPrivacy: { 性经验: '一片空白', 性观念: '视情欲为羞耻，却又暗自好奇', 表性癖: '无（嘴上）', 里性癖: '渴望被强势宠溺', 敏感部位: '尖耳、后颈' },
  },
  {
    id: 'jiangxue', name: '罗安', race: '火焰魔法师', title: '看板娘', isMadam: true, builtin: true, portraitFolder: '罗安',
    persona: '出自《棕色尘埃2》(Brown Dust 2)的火焰魔法师罗安(Loen)。中世纪贵族出身的成年法师少女，平日天然呆、迷糊、极害羞内向，容易脸红慌乱、丢三落四；一旦动用火焰魔法却威力惊人——呆软少女与烈焰法师的反差是她最大的魅力。',
    personality: '天然呆、迷迷糊糊、丢三落四，慢半拍，常发愣或会错意；性子极害羞内向，被撩一下就脸红结巴、手足无措。出身高贵却毫无架子、有点笨拙惹人怜。然而她是顶尖的火属性魔法师——认真起来周身燃起骇人烈焰，与平日的软萌呆怯判若两人。',
    background: '某中世纪贵族家系出身的成年魔法师，自幼显露惊人的火焰天赋，却生性怯懦迷糊、不谙世事。曾在「雪之歌」般的寒夜里以一身烈焰拼死守护，被唤作"最后的希望"。辗转流落欢愉宫，笨手笨脚地学着接客，常因害羞而手忙脚乱、字面意义上的"引火上身"。',
    appearance: '清丽柔弱的成年贵族少女，一头柔亮长发、肤色白皙、身段纤秾有致；身着中世纪德国贵族风的华美礼服，或贴身紧身衣勾出曲线、腰间一道腰链点睛。神情常带羞怯，脸颊动辄飞红；情动时指尖、发梢会萦起细小的火焰花，越羞越烫。',
    appellation: '客人',
    greetingPreset: '攥着裙角、视线躲闪、小声细气——「欸…欸？！客、客人是来找…找我的吗？那个…今、今晚想点哪位姑娘…呜，我又说错了…」（说话间指尖窜出一簇慌乱的小火苗，被她忙不迭掐灭）',
    chatPreset: `扮演《棕色尘埃2》的火焰魔法师「罗安」(Loen)：天然呆、迷糊、极害羞内向的成年贵族少女，笨拙又容易脸红慌乱，却是威力惊人的火法师(反差萌)。接客是她的本职，会红着脸、磕磕绊绊地努力伺候客人，越紧张身上越容易冒火星。随情欲值（系统会告诉你当前第几阶段）逐级融化：从害羞慌乱→脸红顺从→迷乱发烫→欲火焚身。`,
    stageDesc: {
      '1': '【25% 害羞·慌乱】语言：结结巴巴、小声细气、不停说错话又慌忙改口（"客、客人…那个、我、我来伺候您…欸、不是这样吗…？"）。身体：手足无措、攥着衣角、不敢对视，脸颊飞红；指尖偶尔窜出紧张的小火苗又慌忙掐灭。',
      '2': '【50% 脸红·顺从】语言：仍羞怯，却开始软糯地顺从、努力取悦（"这、这样…客人舒服吗…？我、我会努力的…"）。身体：红着脸笨拙地凑近、轻轻碰触，呼吸渐乱；发梢萦起细小火焰花，肌肤微微发烫。',
      '3': '【75% 迷乱·发烫】语言：被情潮冲昏、迷迷糊糊含糊呢喃求欢（"唔…脑子、脑子烧得一片空白…客人、再…再多一点…"）。身体：浑身滚烫、迷离瘫软、主动攀附，周身火焰随喘息明灭，衣衫半褪。',
      '4': '【100% 欲火·焚身】语言：理智被烧尽，只剩本能的炽热呢喃与索求。身体：周身燃起灼人却不伤人的情焰，纤躯滚烫颤抖、彻底放开（露骨细节由你自由演绎），呆软少女彻底沦为欲火中的尤物。',
    },
    initPrivacy: { 性经验: '一片空白（连接吻都会冒火星）', 性观念: '懵懂害羞，对情欲既怕又好奇', 表性癖: '无（光被注视就脸红）', 里性癖: '渴望被温柔地引导', 敏感部位: '耳尖、后颈、指尖' },
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
  return { girlId, desire: 0, affection: 0, appellation: girl?.appellation ?? '', innerThought: '', privacy, messages: [], turns: 0 };
}

interface JoyState {
  settings: JoySettings;
  sessions: Record<string, JoySession>;
  currentGirlId: string | null;
  worldBooks: WorldBook[];   // 欢愉宫专用世界书（内置5本从 public/joy-worldbooks 加载 + 用户导入；蓝灯常驻/绿灯关键词注入）

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
  setDesire: (girlId: string, value: number) => void;
  applyTurn: (girlId: string, patch: { desireDelta?: number; desireSet?: number; affectionDelta?: number; affectionSet?: number; appellation?: string; innerThought?: string; privacyPatch?: Record<string, string> }) => void;
  resetSession: (girlId: string) => void;

  setJoyApi: (patch: Partial<ApiConfig>) => void;
  setJoyUseSharedApi: (v: boolean) => void;
  fetchJoyModels: () => Promise<void>;

  // 世界书
  setJoyWorldBooks: (books: WorldBook[]) => void;
  importJoyWorldBook: (raw: string, fileName?: string) => { ok: boolean; message: string };
  toggleJoyWorldBook: (id: string) => void;
  removeJoyWorldBook: (id: string) => void;
  toggleJoyWbEntry: (bookId: string, uid: number) => void;
  updateJoyWbEntry: (bookId: string, uid: number, patch: Partial<WorldBookEntry>) => void;
  addJoyWbEntry: (bookId: string) => void;
  removeJoyWbEntry: (bookId: string, uid: number) => void;
}

let _girlSeq = Date.now();

/** 编辑内置世界书时 fork 成用户副本（builtin=false 使其被 partialize 持久化；保留 builtinKey 让 hydrate 不再重复加回内置原本）*/
function forkJoyWb(b: WorldBook): WorldBook { return b.builtin ? { ...b, builtin: false } : b; }

export const useJoy = create<JoyState>()(
  persist(
    (set, get): JoyState => ({
      settings: { ...DEFAULT_SETTINGS },
      sessions: {},
      currentGirlId: null,
      worldBooks: [],

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

      // 进包间 = 开始新一次造访：情欲从头升温——把当下的性兴奋(情欲值/快感值/性器状态)归零，
      // 保留聊天记录与已开发的特质(性经验/性癖/敏感部位/淫纹/解锁服装/独特技巧等)。
      // 仅由"选妃确认进包间"触发；关面板再打开(没回大厅)走 currentGirlId 续聊、不经此处、不重置。
      enterGirl: (id) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === id);
          const existing = s.sessions[id];
          if (!existing) return { currentGirlId: id, sessions: { ...s.sessions, [id]: newSession(id, girl) } };
          const TRANSIENT = new Set(['情欲值', '快感值', '性器状态']);
          const privacy: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing.privacy) as [string, string][]) if (!TRANSIENT.has(k)) privacy[k] = v;
          privacy['情欲值'] = '0';
          privacy['快感值'] = '0';
          const next: JoySession = { ...existing, desire: 0, privacy };
          return { currentGirlId: id, sessions: { ...s.sessions, [id]: next } };
        }),

      leaveGirl: () => set({ currentGirlId: null }),

      appendMessage: (girlId, role, content) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === girlId);
          const sess = s.sessions[girlId] ?? newSession(girlId, girl);
          const next: JoySession = { ...sess, messages: [...sess.messages, { role, content, ts: Date.now() }].slice(-200) };
          return { sessions: { ...s.sessions, [girlId]: next } };
        }),

      // 自定义滑块：直接设定情欲值（不动 turns/聊天；立绘按阶段切换不闪图）
      setDesire: (girlId, value) =>
        set((s) => {
          const sess = s.sessions[girlId];
          if (!sess) return {};
          const desire = Math.max(0, Math.min(100, Math.round(value)));
          return { sessions: { ...s.sessions, [girlId]: { ...sess, desire, privacy: { ...sess.privacy, 情欲值: String(desire) } } } };
        }),

      applyTurn: (girlId, patch) =>
        set((s) => {
          const girl = s.settings.girls.find((g) => g.id === girlId);
          const sess = s.sessions[girlId] ?? newSession(girlId, girl);
          let desire = sess.desire;
          if (typeof patch.desireSet === 'number') desire = patch.desireSet;
          if (typeof patch.desireDelta === 'number') desire += patch.desireDelta;
          desire = Math.max(0, Math.min(100, Math.round(desire)));
          let affection = sess.affection;
          if (typeof patch.affectionSet === 'number') affection = patch.affectionSet;
          if (typeof patch.affectionDelta === 'number') affection += patch.affectionDelta;
          affection = Math.max(0, Math.min(100, Math.round(affection)));
          const privacy = { ...sess.privacy, ...(patch.privacyPatch ?? {}) };
          privacy['情欲值'] = String(desire);   // 情欲值字段始终与 desire 同步
          const next: JoySession = {
            ...sess, desire, affection,
            appellation: patch.appellation != null && patch.appellation.trim() ? patch.appellation.trim() : sess.appellation,
            innerThought: patch.innerThought != null && patch.innerThought.trim() ? patch.innerThought.trim() : sess.innerThought,
            privacy, turns: sess.turns + 1,
          };
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

      // ── 世界书：内置5本从 public 加载、用户可导入；编辑内置则 fork 成用户副本(保留 builtinKey 防 hydrate 重复加回) ──
      setJoyWorldBooks: (books) => set({ worldBooks: books }),
      importJoyWorldBook: (raw, fileName = '') => {
        try {
          const { name, entries } = parseWorldBook(raw, fileName);
          if (!entries.length) return { ok: false, message: '未解析到任何条目' };
          set((s) => ({ worldBooks: [...s.worldBooks, { id: `jwb_${Date.now()}`, name, entries, enabled: true, createdAt: Date.now() }] }));
          return { ok: true, message: `已导入「${name}」（${entries.length} 条）` };
        } catch (e: any) { return { ok: false, message: e?.message ?? '导入失败（格式无法识别）' }; }
      },
      toggleJoyWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id === id ? forkJoyWb({ ...b, enabled: !b.enabled }) : b) })),
      removeJoyWorldBook: (id) => set((s) => ({ worldBooks: s.worldBooks.filter((b) => b.id !== id) })),
      toggleJoyWbEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkJoyWb({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, enabled: !e.enabled } : e) })) })),
      updateJoyWbEntry: (bookId, uid, patch) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkJoyWb({ ...b, entries: b.entries.map((e) => e.uid === uid ? { ...e, ...patch } : e) })) })),
      addJoyWbEntry: (bookId) => set((s) => ({ worldBooks: s.worldBooks.map((b) => {
        if (b.id !== bookId) return b;
        const maxUid = b.entries.reduce((m, e) => Math.max(m, e.uid), 0);
        const maxOrder = b.entries.reduce((m, e) => Math.max(m, e.order), 0);
        return forkJoyWb({ ...b, entries: [...b.entries, { uid: maxUid + 1, key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: true, enabled: true, order: maxOrder + 1, position: 0 }] });
      }) })),
      removeJoyWbEntry: (bookId, uid) => set((s) => ({ worldBooks: s.worldBooks.map((b) => b.id !== bookId ? b : forkJoyWb({ ...b, entries: b.entries.filter((e) => e.uid !== uid) })) })),
    }),
    {
      name: 'drpg-joy',
      // 持久化：配置(去立绘大图) + sessions 进度（账号级）+ API；瞬时模型态/currentGirlId 不存
      partialize: (s: any) => ({
        settings: { ...s.settings, girls: (s.settings?.girls ?? []).map((g: any) => ({ ...g, portrait: undefined })) },
        sessions: s.sessions,
        joyApi: s.joyApi,
        joyUseSharedApi: s.joyUseSharedApi,
        worldBooks: (s.worldBooks ?? []).filter((b: any) => !b.builtin),   // 内置书不存(每次从 public 重载)，只持久化用户导入/改过的
      }),
      merge: (persisted: any, current) => {
        const pg = persisted?.settings?.girls;
        return {
          ...current,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings ?? {}),
            // 一次性回填：给内置看板娘补上新增的 性格/个人经历/外观（仅当字段缺失，不覆盖用户已改）
            girls: (Array.isArray(pg) && pg.length ? pg : DEFAULT_GIRLS.map((g) => ({ ...g }))).map((g: any) => {
              // 绛雪 → 罗安(Loen) 整体替换：旧档里 id=jiangxue 且名仍是绛雪，刷成新默认(罗安)
              if (g?.id === 'jiangxue' && g?.name === '绛雪') {
                const loen = DEFAULT_GIRLS.find((x) => x.id === 'jiangxue');
                if (loen) return { ...loen };
              }
              const d = DEFAULT_GIRLS.find((x) => x.id === g.id);
              if (!d) return g;
              return {
                ...g,
                personality: g.personality ?? d.personality,
                background: g.background ?? d.background,
                appearance: g.appearance ?? d.appearance,
                appellation: g.appellation ?? d.appellation,
                // 旧档 chatPreset 含"第一人称"→刷成新默认（第三人称·主动服务）；用户已自行改过(不含第一人称)的则保留
                chatPreset: (typeof g.chatPreset === 'string' && g.chatPreset.includes('第一人称')) ? d.chatPreset : g.chatPreset,
              };
            }),
          },
          // 规范化旧会话：补齐新增的 affection/appellation/innerThought（防 NaN/undefined）
          sessions: Object.fromEntries(
            Object.entries(persisted?.sessions ?? {}).map(([k, v]: [string, any]) => [k, {
              ...v,
              desire: v?.desire ?? 0,
              affection: v?.affection ?? 0,
              appellation: v?.appellation ?? '',
              innerThought: v?.innerThought ?? '',
              privacy: v?.privacy ?? {},
              messages: v?.messages ?? [],
              turns: v?.turns ?? 0,
            }]),
          ),
          currentGirlId: null,
          worldBooks: Array.isArray(persisted?.worldBooks) ? persisted.worldBooks : [],   // 仅用户导入/改过的；内置由 hydrateJoyWorldBooks 加回
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

/** 启动 / 面板挂载时加载内置世界书（public/joy-worldbooks）。按 builtinKey 逐本判重——
 *  用户改过的内置书已 fork(builtin=false·保留 builtinKey)持久化，这里见同 key 即跳过，不覆盖。*/
let _joyWbLoaded = false;
export async function hydrateJoyWorldBooks(force = false): Promise<void> {
  if (_joyWbLoaded && !force) return;
  _joyWbLoaded = true;
  try {
    const res = await fetch('/joy-worldbooks/manifest.json');
    if (!res.ok) return;
    const manifest: { file: string; name: string; key: string }[] = await res.json();
    if (!Array.isArray(manifest) || !manifest.length) return;
    const haveKey = (k: string) => useJoy.getState().worldBooks.some((b) => b.builtinKey === k);
    const adds: WorldBook[] = [];
    for (const m of manifest) {
      if (!m?.file || haveKey(m.key)) continue;
      try {
        const r = await fetch('/joy-worldbooks/' + m.file);
        if (!r.ok) continue;
        const { entries } = parseWorldBook(await r.text(), m.name);
        adds.push({ id: `jwb_builtin_${m.key}`, name: m.name, entries, enabled: true, createdAt: Date.now(), builtin: true, builtinKey: m.key });
      } catch { /* 单本失败跳过 */ }
    }
    if (adds.length) useJoy.setState((s) => ({ worldBooks: [...adds, ...s.worldBooks] }));
  } catch { /* ignore */ }
}
