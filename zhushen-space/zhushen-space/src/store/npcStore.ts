import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { lzStorage } from '../systems/compressedStorage';   // lz 压缩：NPC 档案占 localStorage 大头
import { useCharacters, type Deed } from './characterStore';
import type { PlayerAttrs, StatusEffect } from './playerStore';
import { normalizeTier, realmFromLevel, lvFromRealm } from '../systems/derivedStats';
import { growthGuardCtx, guardRealmChange, guardBioStrength, logArbitration } from '../systems/npcGrowthGuard';   // 成长闸门：AI 演化期 realm/bs 变更裁决（无上下文=只合法化，行为不变）
import type { SocketedGem, GemSlotKind } from './itemStore';
import { npcRegister, npcNorm } from '../systems/ledger/npcCore';   // Step 10 事件核心·NPC 影子记账（溯源审计）+ facade 闸门归一名
import { normalizeGradeLabel, markAccountedRemoval } from './itemStore';
import { archiveNpc, type ArchiveReason, type NpcCharData } from '../systems/npcLibrary';   // NPC 图书馆：删除前全量入库（只存不删）

/* 判断「列4状态」是否表示该角色【真的死亡】。
   只认明确的死亡状态，**排除**只是提到"死"字却没死的情况（濒死/濒临死亡/挚友身亡/恐惧死亡/假死/不死之身…），
   避免活着的 NPC 因状态文案里出现"死"字被误标 isDead 而从档案彻底消失。 */
export function looksDead(status?: string): boolean {
  const t = (status ?? '').replace(/\s+/g, '');
  if (!t) return false;
  // 只是"提到死/濒死/怕死"但并未真死 —— 一律不判死亡
  if (/濒死|濒临死亡|濒临身亡|垂死|将死|半死|九死一生|死里逃生|向死而生|视死如归|出生入死|生不如死|不死|永生|假死|诈死|装死|怕死|惧死|畏死|死亡威胁|生死未卜|生死攸关|生死/.test(t)) return false;
  // 显式死亡标记：已X / 确认 / 当场 + 死亡词
  if (/(已|确认|当场|彻底)(死亡|阵亡|身亡|战死|殒命|毙命|气绝|丧命|横死|暴毙)/.test(t)) return true;
  // 状态以死亡词起头（剥掉前导表情/标点/英文后，第一个汉语词即死亡词）→ 视作死亡状态标签
  const head = t.replace(/^[^一-鿿]+/, '');
  return /^(死亡|阵亡|身亡|战死|殒命|毙命|气绝|丧命|横死|暴毙)/.test(head);
}

/* 规范化列2(realm) 的阶位部分：阶位只允许 一阶~无上之境；非法则按 Lv 推导。保留 Lv 与 |身份。 */
function normalizeRealm(val: string): string {
  const idPart = val.includes('|') ? val.slice(val.indexOf('|')) : '';   // 含前导 |
  const hasLv = /Lv\.?\s*\d+/i.test(val);
  const tier = normalizeTier(val) || (hasLv ? realmFromLevel(lvFromRealm(val)) : '');
  if (!tier) return val;                                  // 认不出阶位 → 原样保留，不乱改
  if (hasLv) return `${tier}·Lv.${lvFromRealm(val)}${idPart}`;
  return `${tier}${idPart}`;
}

/* NPC 持有物品（不占玩家背包） */
export interface NpcOwnedItem {
  id: string;       // "I_C22_01"
  name: string;
  category: string;
  gradeDesc: string;
  effect: string;
  quantity: number;
  equipped: boolean;
  equipSlot?: string;
  locked?: boolean;       // 锁定后 AI 不会删除/消耗（手动删除按钮也隐藏）
  appearance?: string;    // 外观描述
  acquisition?: string;   // 获得途径
  notes?: string;         // 备注/原因
  tags?: string[];
  // ── 固定条目模板（与玩家 InventoryItem 对齐）──
  origin?: string;        // 产地
  subType?: string;       // 类型细分
  combatStat?: string;    // 攻击力/防御力数值
  durability?: string;    // 耐久度
  requirement?: string;   // 装备需求
  affix?: string;         // 词缀
  activeEffect?: string;  // 主动效果（需发动/使用才生效·不计入常驻六维）——与 InventoryItem 对齐
  activeDuration?: string; // 主动效果持续时长（如"10回合"/"1小时"）——与 InventoryItem 对齐
  score?: string;         // 评分
  intro?: string;         // 简介
  killCount?: string;     // 杀敌数量（仅武器类）
  enhanceLevel?: number;  // 强化等级 0-16（装备强化系统，仅装备类；0/缺省=未强化）
  // ── 宝石/镶嵌系统（与 InventoryItem 对齐；六维加成已写进 effect 自动传导）──
  sockets?: number;       // 镶嵌孔总数（缺省按品级派生 socketsOf）
  gems?: SocketedGem[];   // 已镶嵌宝石
  gemSlot?: GemSlotKind;  // （宝石物品专属）部位限制
  gemAttr?: string;       // （宝石物品专属）属性类型
  image?: string;         // 装备图（上传/AI 生图 dataURL）
  numeric?: Record<string, unknown>;  // 原始数值结构（rarityTier/grade/statLines…）
  addedAt: number;
}

/** 轨道A 自治状态（离场契约者零API模拟用）：当前相位 + 剩余回合 + 任务世界名 */
export interface NpcAuto {
  phase: 'hub' | 'mission';   // 主神空间相 / 任务世界相
  turns: number;              // 当前相位剩余回合
  world?: string;             // 任务世界名（mission 相期间固定，供归来引用）
}

export interface NpcRecord {
  id: string;
  name: string;
  gender: '男' | '女' | '';
  realm: string;          // 列2：阶位·Lv.X|身份
  personality: string;    // 列3
  status: string;         // 列4，默认 "一切正常"
  callPlayer: string;     // 列7
  background: string;     // 列10
  innerThought: string;   // 列12
  relations: string;      // 列13：B1:关系;C2:关系
  favor: number;          // 列15：-100~100
  appearance5: string;    // 列16：动作|穿着|位置|身段|样貌（每回合即时变化）
  baseAppearance?: string; // 常驻长相基准（身高/发色/瞳色/肤色/体型/标志特征·不随剧情漂移·生图始终含）
  bodyType?: '' | '人形' | '兽形' | '非人形'; // 形态：留空=自动(按外观判断)；非人形(召唤物/野兽/怪物)生图绕开人形框架
  motiveNow: string;      // 列27
  shortGoal: string;      // 列28
  longGoal: string;       // 列29
  inCombat: boolean;      // 列31
  appearanceDetail: string; // 列34
  title: string;          // identity.title
  hp?: number;
  maxHp?: number;
  mp?: number;            // 蓝量 EP
  maxMp?: number;
  hpRatio?: Partial<Record<keyof PlayerAttrs, number>>;  // HP 多属性系数表（玩家在 NPC 面板手动设置；{属性:每点系数}，空=默认 体×20）。四阶起仍自动×5
  epRatio?: Partial<Record<keyof PlayerAttrs, number>>;  // EP 多属性系数表（空=默认 智×15）
  profession?: string;    // 职业
  arenaRank?: string;     // 竞技场排名
  brandLevel?: string;    // 烙印等级
  contractorId?: string;  // 契约者编号（ID）
  affiliatedTeam?: string;// 隶属冒险团（仅契约者标签 NPC：生成时可能隶属某冒险团，存如"暗渊远征队·斥候"或"暗渊远征队（队长）"；主角可在私聊中请求加入）
  attrPoints?: number;    // 属性点（完全按正文更新，正文没出现就不动）
  realAttrPoints?: number;// 真实属性点（完全按正文更新，正文没出现就不动）
  skillPoints?: number;   // 技能点（完全按正文更新，正文没出现就不动）
  statusEffects?: StatusEffect[]; // 限时状态（引擎自动过期）
  bioStrength?: string;   // 生物强度模板（T0杂鱼~T9源初，存如"T3·勇士"；含非人生物，按强度框架）
  unitType?: string;      // 类型标签（封闭枚举：武者战士/平民百姓/凶兽魔兽…→收编 职业排序/形态/凡人，供机械生成六维）
  age?: string;           // 年龄（正文有则照抄，没有则按设定生成；可写"约25岁/青年"等）
  review?: string;        // 诙谐评价（玩家视角的吐槽/锐评，幽默风格）
  selfNarration?: string; // 第一人称自述（NPC演化门控生成一次：作私聊/正文/演化的"自我认知"锚点，防 AI 凭刻板印象脑补人设）
  // ── 性格丰满化 / 反谄媚（治"NPC都围着主角转、无原则、性爱速堕"）──
  sampleLines?: string;   // 范例台词/口癖（2-3句·锁语气治同质化；NPC演化门控生成一次，之后冻结防漂）
  principles?: string;    // 原则底线（独立于主角的立场红线/绝不做的事·反谄媚锚点；建档生成，冻结防漂）
  // 四轴对主角态度(disposition)·各 0-100；每回合增量走 applyDisposition + dispositionGuard 限速，禁跳级
  trust?: number;         // 信任（默认10·可回落）
  respect?: number;       // 尊重（默认10·可回落）
  lust?: number;          // 情欲：对主角的即时性欲火（默认0·即时可回落）
  corruption?: number;    // 沉沦：为主角弃守原则/越界的累计（默认0·棘轮·只增难减）
  npcTag?: string;        // 标签（限定：契约者/土著/随从/宠物/召唤物）
  avatar?: string;        // 人物头像（上传的自定义图片 dataURL / 未来生图地址；在场面板与肖像栏展示）
  avatarTags?: string;    // 生成当前头像所用的 imageTags（用于"外观变化时刷新肖像"判断是否需要重绘）
  avatarPrompt?: string;  // 生成当前头像所用的完整生图提示词（供「编辑提示词→重新生成」回显；缺省则按当前档案字段实时重建）
  imageTags?: string;     // 生图提示词（第19列：英文 NAI/Danbooru tags，NPC演化生成；肖像生图优先用它保证一致）
  attrs?: PlayerAttrs;    // 基础属性（力/敏/体/智/魅/幸）；其中「幸运」由前端独占机械生成(ensureNpcLuck)，AI 的绝对赋值被忽略
  attrsEstablished?: boolean; // 六维已建档（生成过/手动给过）→ AI 的 `=` 绝对赋值降级为增量收敛+步长限幅（npcGrowthGuard），治"每回合整套重写漂移"
  realAttrs?: Partial<PlayerAttrs>;  // 真实属性·直加分配（真实属性点加点 +1 这里，与基础属性独立、不互相影响）；显示真实属性 = floor(基础/80) + 直加值
  luckDelta?: number;     // 幸运·剧情增减累加器（AI 的 attrs.luck += / -= 记这里，叠加在前端基础幸运上，前端重算不丢；见 ensureNpcLuck）
  items: NpcOwnedItem[];  // NPC 持有物品列表
  extra: Record<string, string>; // 其余列兜底
  onScene: boolean;       // true=在场(A区) false=离场(B区)

  // ── 场景 / 生命周期 ──
  isDead?: boolean;       // 列4含"已死亡"
  deadTurn?: number;      // 首次被检测为死亡的回合号（死亡自动清除的延迟计时；复活则清空）
  isBond?: boolean;       // 羁绊/开局角色，自带"长期保留"，不进清理名单
  keepForever?: boolean;  // 用户手动标记长期保留
  archived?: boolean;     // 玩家手动「归档」（独立于在场/离场的第三态）：主动收进档案库、不想让叙事关注 →
                          //   彻底封存(不参与轨道A自治/演化/正文召回/自动上场/清理建议)，除非玩家「重新上场」才恢复。
                          //   与「离场」区别：离场是 AI 剧情自动收起、仍被追踪；归档是玩家显式封存。不变量：archived ⟹ !onScene。
  kitDone?: boolean;      // 已发放过初始家当（装备+储物），避免重复发放

  // ── 临时世界队伍（频道组队；世界结束自动解散，与永久冒险团两层分开）──
  partyMember?: boolean;  // 是否当前的临时队友
  partyWorld?: string;    // 为哪个世界(worldName)入队的
  partyRole?: string;     // 队内职责（坦克/治疗/输出/侦察…）

  // ── 助战（其他玩家上传、本玩家「邀请助战」物化进来的真人主角卡；见 systems/assistApply.ts）──
  assistOwnerId?: string; // 来源卡上传者 id（"chat:<uid>"）；非空=这是一张被邀请的助战 NPC（供面板列出 + 遣散 + 去重）
  assistCardId?: string;  // 来源助战卡 id（去重判据）

  // ── 纪念丰碑（玩家把过往主角铭刻入碑后、在新存档里「召唤」物化进来的英灵；见 systems/monument.ts）──
  monumentId?: string;    // 来源丰碑条目 id；非空=这是一名召唤出的纪念英灵（供面板列出 + 遣散 + 去重 + 判定"已召唤"）

  // ── 好友（手动收藏的契约者/随从/宠物；进入好友栏后每回合参与 NPC 演化）──
  isFriend?: boolean;     // 是否在好友栏
  friendedAt?: number;    // 加为好友的时间

  // ── 调度（策略B）──
  freqMode?: 'turn' | 'date';  // 逐目标频率模式；缺省回落全局默认
  freqInterval?: number;       // 间隔 ≥1
  lastEvolvedTurn?: number;    // 上次重点演化的回合号
  lastEvolvedDate?: string;    // 上次重点演化的游戏内日期
  lastSeenTurn?: number;       // 上次在场的回合号（清理提醒用）

  deeds?: string;         // 旧版：纯文本近况（保留兼容，勿删）
  deedLog?: Deed[];       // 新版：结构化经历时间线
  auto?: NpcAuto;         // 轨道A 自治状态（离场零API模拟的相位机；见 systems/npcAutonomy.ts）
  updatedAt: number;
}

/** 四轴对主角态度列名（中/英）→ 字段。建档/校准的绝对赋值走 applyColumns(clamp 0-100)；每回合增量走 applyDisposition + dispositionGuard 限速。*/
export const DISPOSITION_COLS: Record<string, 'trust' | 'respect' | 'lust' | 'corruption'> = {
  trust: 'trust', 信任: 'trust',
  respect: 'respect', 尊重: 'respect',
  lust: 'lust', 情欲: 'lust',
  corruption: 'corruption', 沉沦: 'corruption',
};

/* 列号 → 字段名（null = 需要特殊处理） */
const COL_TO_FIELD: Record<string, keyof NpcRecord | null> = {
  '2':  'realm',
  '3':  'personality',
  '4':  'status',
  '7':  'callPlayer',
  '10': 'background',
  '12': 'innerThought',
  '13': 'relations',
  '16': 'appearance5',
  '19': 'imageTags',
  '27': 'motiveNow',
  '28': 'shortGoal',
  '29': 'longGoal',
  '34': 'appearanceDetail',
  // 命名键（add("C1",{...}) 直接用字段名/中文别名）
  'review': 'review', '评价': 'review',
  'principles': 'principles', '原则底线': 'principles', '原则': 'principles', '底线': 'principles',
  'sampleLines': 'sampleLines', '范例台词': 'sampleLines', '口癖': 'sampleLines', '台词范例': 'sampleLines',
  'npcTag': 'npcTag', '标签': 'npcTag', 'tag': 'npcTag',
  'affiliatedTeam': 'affiliatedTeam', '冒险团': 'affiliatedTeam', '隶属冒险团': 'affiliatedTeam', '所属冒险团': 'affiliatedTeam',
  'age': 'age', '年龄': 'age',
  'imageTags': 'imageTags', '画像提示': 'imageTags', '生图提示词': 'imageTags',
  'baseAppearance': 'baseAppearance', '基底外观': 'baseAppearance', '常驻外观': 'baseAppearance', '常驻长相': 'baseAppearance',
  'bodyType': 'bodyType', '形态': 'bodyType', '体态': 'bodyType',
};

/* 防占位名覆盖真实名：传入名是占位（空 / 等于 id / 形如 C1·G1 等编号）而该 NPC 已有真实名时，保留原真实名；
   否则采用传入名（去掉 "|性别" 后缀、去首尾空格）。修复「登场判断重入(reentry)时把已命名 NPC 的名字
   重置回 C10/G1…」的回归——upsertNpc({name:e.name??id}) 与重入分支 upsertNpc({name:e.name}) 都会经过它。 */
export function resolveNpcName(prevName: string | undefined, id: string, incoming: unknown): string {
  const inc = String(incoming ?? '').split('|')[0].trim();
  const incPlaceholder = !inc || inc === id || /^[CG]\d+$/i.test(inc);
  const hasRealPrev = !!prevName && prevName !== id && !/^[CG]\d+$/i.test(prevName);
  if (incPlaceholder) return hasRealPrev ? (prevName as string) : (inc || id);
  return inc;
}

/* 是否「已正式命名」的真实 NPC：名字存在、不是占位编号(=id 或 C1/G1…)。
   展示层据此过滤掉"无名编号空壳"，保证面板永不出现 C11/C22 这类条目。 */
export function hasRealNpcName(r: { name?: string; id: string }): boolean {
  return !!r.name && r.name !== r.id && !/^[CG]\d+$/i.test(r.name);
}

export function defaultNpcRecord(id: string): NpcRecord {
  return {
    id, name: id, gender: '', realm: '', personality: '', status: '一切正常',
    callPlayer: '', background: '', innerThought: '', relations: '',
    favor: 0, appearance5: '', motiveNow: '', shortGoal: '', longGoal: '',
    trust: 10, respect: 10, lust: 0, corruption: 0,
    inCombat: false, appearanceDetail: '', baseAppearance: '', title: '', items: [], extra: {},
    onScene: true, updatedAt: Date.now(),
  };
}

/** 合法 NPC 编号：C 系（契约者/角色）+ G 系（召唤物/怪物）。AI 自创的 P_xxx / 名字缩写等都不算，
 *  因为全部短指令(character.C\d+ / hp.C\d+ …)只匹配 C\d+/[CG]\d+，非法 ID 的更新会被静默丢弃。 */
export const isNpcId = (id: string): boolean => /^[CG]\d+$/.test(id);

/** 四轴态度增量/绝对赋值补丁。**限速/棘轮由调用方(dispositionGuard)先算好**再传入；本 store 只做 clamp 0-100。*/
export interface DispositionPatch {
  trustDelta?: number; trustSet?: number;
  respectDelta?: number; respectSet?: number;
  lustDelta?: number; lustSet?: number;
  corruptionDelta?: number; corruptionSet?: number;
}

interface NpcState {
  npcs: Record<string, NpcRecord>;
  upsertNpc: (id: string, patch: Partial<NpcRecord>) => void;
  applyColumns: (id: string, cols: Record<string, unknown>) => void;
  applyDisposition: (id: string, patch: DispositionPatch) => void;  // 四轴 clamp 0-100（限速已由 dispositionGuard 先算好）
  applySkeleton: (id: string, short: Record<string, unknown>) => void; // 登场骨架 npc.<id>={n,r,p,…}
  setScene: (id: string, onScene: boolean, turn?: number) => void;     // 登场=true / 退场=false
  setSchedule: (id: string, patch: { freqMode?: 'turn' | 'date'; freqInterval?: number }) => void;
  markEvolved: (id: string, turn: number, date?: string) => void;      // 重点演化后
  appendDeed: (id: string, deed: string | Deed) => void;
  removeDeed: (id: string, index: number) => void;
  clearDeeds: (id: string) => void;
  removeNpc: (id: string) => void;        // 软删除（onScene=false 归档）
  createPartyMember: (info: { name: string; tier?: string; job?: string; persona?: string; strength?: string; role?: string; world?: string }) => string;  // 从频道发帖人建临时队友 NPC，返回 C-id
  createArchivedContractor: (info: { name: string; tier?: string; job?: string; persona?: string; strength?: string; tag?: string }) => string;  // 建一个离场契约者档案（私信/交易/好友用），返回 C-id
  createPet: (info: { name: string; species?: string; persona?: string; appearance?: string; ability?: string; tier?: string; level?: number; strength?: string; attrs?: PlayerAttrs }) => string;  // 御兽合成：建一只宠物随从 NPC（在场+入队+好友，unitType=凶兽魔兽，可带六维），返回 C-id
  createCompanion: (info: { name: string; tag?: string; realm?: string; profession?: string; gender?: string; age?: string; personality?: string; background?: string; appearance?: string; strength?: string; selfNarration?: string; attrs?: PlayerAttrs }) => string;  // 开局随行人物：建一个在场+入队+好友+长期保留(isBond)的随从 NPC，返回 C-id
  setFriend: (id: string, on: boolean) => void;   // 加入/移出好友栏
  leaveParty: (id: string) => void;       // 退出临时队伍（partyMember=false，仍在场，等剧情/手动归档）
  disbandPartyForWorld: (currentWorld: string) => string[];  // 世界切换：解散非当前世界的临时队友(离队 + 离场归档)，返回被解散的 id 列表
  hardRemoveNpc: (id: string) => void;    // 物理删除（清理路人）
  pruneGhosts: (settledPrev?: Record<string, NpcRecord>) => number;   // 结构性清除幽灵空壳（isGhostNpc 判定·一并清 characterStore 孤儿）；传 settledPrev 时只删"沉淀幽灵"(prev 也是幽灵·跨过一次状态变动仍无身份)，护建档中新角色不误删。返回删除数
  absorbOrphans: () => number;            // 把"只有物品没有档案"的空壳并入真实NPC
  dedupeByName: () => number;             // 合并同名真实NPC（防一回合/跨回合重复建档），返回合并掉的数量
  dedupeAliasNpcs: () => number;          // 合并"跨语言/泄漏ID前缀(如 C_Frieren)"的重复NPC到同阶位同职业的中文名NPC + 清洗畸形名前缀
  normalizeNpcIds: () => number;          // 把 AI 自创的非法 ID(如 P_Aesc)重命名成空闲 C 编号 + 迁移技能/改写人际关系引用，返回修复数
  clearAll: () => void;
  addNpcItem: (ownerId: string, item: NpcOwnedItem) => void;
  dedupeNpcItems: (ownerId?: string) => void;   // 合并某NPC(或全部)储存空间内同名重复物品（可堆叠累加/装备取大值）
  normalizeItemGrades: () => number;   // 一次性迁移：收敛所有NPC持有物的复合品级为单一档，返回收敛件数
  updateNpcItem: (ownerId: string, itemId: string, patch: Partial<NpcOwnedItem>) => void;
  removeNpcItem: (ownerId: string, itemId: string) => void;
  equipNpcItem: (ownerId: string, itemId: string, slot: string) => void;
  unequipNpcItem: (ownerId: string, itemId: string) => void;
  consumeNpcItem: (ownerId: string, itemId: string, qty: number) => void;
  clearNpcBag: (ownerId: string) => void;   // 清空未装备物品（保留已装备）
  addNpcStatus: (id: string, e: StatusEffect) => void;        // upsert by name
  removeNpcStatus: (id: string, idOrName: string) => void;
  setNpcStatuses: (id: string, list: StatusEffect[]) => void; // 过期清理整体重写
  applyAutonomy: (updates: Array<{ id: string; deed?: Deed; patch?: Partial<NpcRecord> }>) => void;  // 轨道A：批量套用离场自治结果（经历+相位），一次 set 防刷屏重渲染
}

/* NPC 储存空间同名堆叠：装备类（武器/防具/饰品/特殊/法宝）不堆叠，余者同名累加 */
const NPC_NO_STACK_CATS = new Set<string>(['武器', '防具', '饰品', '特殊物品', '法宝']);
const npcStackNorm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').toLowerCase();

/* 幽灵 NPC 判定（占位名 + 零真实身份＝空壳）——**App.pruneGhostNpcs 与 NPC facade 闸门共用同一套谨慎判定**（单一来源）。
   占位名(无名 / name===id / C11-G22 式编号) 且 无任何真实身份信号 → 空壳幽灵。带任一真实身份的占位名 NPC 视作
   "建档中/半成品"予以**保留、绝不删**。自动生成的六维/血条/生图tag/生物强度**不算**真实身份。
   charData 注入(characterStore.characters)以查技能/天赋——避免 store 层对 characterStore 的判定顺序硬依赖；缺省(未加载)按"无"处理。 */
/** 「有名有姓」单一判据：非占位名（占位名＝无名 / name===id / C11-G22 式编号）。
    isGhostNpc 的第一道门 与 NPC 图书馆的入库门 共用同一判据，避免两处口径漂移。 */
export function hasRealName(r: { id: string; name?: string }): boolean {
  return !!r.name && r.name !== r.id && !/^[CG]\d+$/i.test(r.name);
}

/* ── NPC 图书馆入库钩子（"只存不删"的唯一入口）──
   任何会让 NPC 从 npcs 消失的路径，**删之前**都要经过这里拍一份全量快照（档案 + characterStore 的技能/天赋/称号/副职业/记忆）。
   ⚠ 必须在 removeCharacter 之前调用——晚一步快照拍到的就是被清空的空架子。
   ⚠ 只送「有名有姓的真实 NPC」：占位名空壳是 AI 手滑建的噪音，进库只会淹没真人。
   绝不抛错——入库失败不许阻断删除/合并主流程。 */
function archiveBeforeRemove(rec: NpcRecord | undefined, reason: ArchiveReason): void {
  try {
    if (!rec?.id || !hasRealName(rec)) return;
    // ⚠ 铁律「只存不删」：任何有名有姓的 NPC 消失前都必须入库，绝不按"敌对/临时/无关系"提前放行——
    //   否则被删的 NPC 既找不回、又在图书馆里查不到入库记录（连"是被什么删的"都断了线）。
    //   刷屏由 npcLibrary 的内容指纹去重（同版本覆盖）+ 图书馆里的手动删除/删同名/清空来治，不靠这里少存。
    let char: NpcCharData | undefined;
    try {
      const c = useCharacters.getState().characters[rec.id] as unknown as NpcCharData | undefined;
      if (c) char = { skills: c.skills, talents: c.talents, titles: c.titles, subProfessions: c.subProfessions, memory: c.memory };
    } catch { /* characterStore 未就绪 → 至少把档案存下来 */ }
    archiveNpc(rec, char, reason);
  } catch (e) { console.warn('[NPC图书馆] 入库前置失败（忽略）:', e); }
}

/* 把 dup 的资料并进 keeper —— **同名合并(dedupeByName) 与 跨语言别名合并(dedupeAliasNpcs) 共用的单一来源**。
   铁则：**合并只增不减**。任何「删了就找不回」的东西都必须并过来——
     · 持有物 / 经历时间线：并集去重（经历再按 addedAt 重排，否则两份交错并入会乱序）
     · 好感度 / 信任 / 尊重 / 沉沦：取较大值，绝不让玩家攒的关系进度倒退（沉沦本就是棘轮）
       —— 情欲(lust) 是即时可回落的，不取大值，保留 keeper 当前值
     · 人设字段：keeper 缺的用 dup 补（⚠历史上只补 12 个字段，导致 关系/内心/自述/原则/称呼 在合并时蒸发，
       玩家眼里＝「并肩作战谈恋爱的人，召唤回来当我是陌生变态」）
     · 身份/保留标记：任一为真即为真，绝不把「长期保留/羁绊/好友/队友」悄悄降级 */
function mergeNpcRecords(keeper: NpcRecord, dup: NpcRecord): NpcRecord {
  const merged: NpcRecord = { ...keeper };
  // 持有物（按 id 去重）
  const items = [...(merged.items ?? [])];
  for (const it of dup.items ?? []) if (!items.some((x) => x.id === it.id)) items.push(it);
  merged.items = items;
  // 经历时间线（按 时间|地点|描述 去重，再按 addedAt 重排）
  const deedKey = (d: { time?: string; location?: string; description?: string }) =>
    `${(d?.time ?? '').trim()}|${(d?.location ?? '').trim()}|${(d?.description ?? '').trim().replace(/\s+/g, ' ')}`;
  const deeds = [...(merged.deedLog ?? [])];
  const seenDeeds = new Set(deeds.map(deedKey));
  for (const d of dup.deedLog ?? []) { const k = deedKey(d); if (!seenDeeds.has(k)) { deeds.push(d); seenDeeds.add(k); } }
  if (deeds.length) merged.deedLog = deeds.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  if (dup.onScene) { merged.onScene = true; merged.archived = false; }   // 有在场副本→视为活跃，解除归档（保不变量 archived⟹!onScene）
  for (const f of ['favor', 'trust', 'respect', 'corruption'] as const) {
    const a = merged[f], b = dup[f];
    if (typeof b === 'number' && (typeof a !== 'number' || b > a)) (merged as any)[f] = b;
  }
  for (const f of ['realm', 'personality', 'background', 'appearanceDetail', 'baseAppearance', 'title', 'profession',
    'contractorId', 'affiliatedTeam', 'gender', 'attrs', 'realAttrs', 'avatar', 'avatarTags', 'avatarPrompt', 'imageTags',
    'relations', 'innerThought', 'motiveNow', 'shortGoal', 'longGoal', 'appearance5', 'callPlayer',
    'selfNarration', 'sampleLines', 'principles', 'npcTag', 'bioStrength', 'unitType', 'age', 'review', 'deeds',
    'hpRatio', 'epRatio'] as (keyof NpcRecord)[]) {
    if ((merged[f] == null || merged[f] === '') && dup[f] != null && dup[f] !== '') (merged as any)[f] = dup[f];
  }
  for (const f of ['isBond', 'keepForever', 'isFriend', 'partyMember'] as const) if (dup[f]) (merged as any)[f] = true;
  return merged;
}

export function isGhostNpc(r: NpcRecord, charData?: Record<string, { skills?: unknown[]; traits?: unknown[] }>): boolean {
  const placeholder = !hasRealName(r);
  if (!placeholder) return false;
  // 阶位带「身份」段(如 一阶|警员) 算身份
  const realmId = (r.realm ?? '').includes('|') && (r.realm as string).split('|').slice(1).join('|').replace(/[·\s]/g, '').length > 0;
  if (realmId) return false;
  if (r.background || r.personality || r.title || r.profession || r.innerThought || r.relations ||
      r.motiveNow || r.shortGoal || r.longGoal || r.appearance5 || r.appearanceDetail || r.avatar) return false;
  if ((r.favor ?? 0) !== 0) return false;
  if ((r.items?.length ?? 0) > 0) return false;
  if (r.partyMember || r.isFriend || r.isBond || r.keepForever || r.contractorId || r.affiliatedTeam || r.isDead) return false;
  if (r.status && r.status !== '一切正常') return false;
  const cd = charData?.[r.id];
  if ((cd?.skills?.length ?? 0) > 0 || (cd?.traits?.length ?? 0) > 0) return false;
  return true;   // 占位名 + 零真实身份（哪怕带自动生成的六维/血条）→ 空壳幽灵
}

export const useNpc = create<NpcState>()(
  persist(
    (set): NpcState => ({
      npcs: {},

      upsertNpc: (id, patch) => {
        set((s) => {
          const prev = s.npcs[id];
          // 档案不存在 + 本次又没带真实姓名 → 不凭空建壳。散落的 hp.C22 / favor / status 等短指令命中一个
          // 不存在的ID时，原先会用 defaultNpcRecord 建出一个"只有血条的无名编号空壳"（如 8/100·好感0），此处拦掉。
          if (!prev) {
            const inc = 'name' in patch ? String((patch as { name?: unknown }).name ?? '').split('|')[0].trim() : '';
            const realName = !!inc && inc !== id && !/^[CG]\d+$/i.test(inc);
            if (!realName) return s;
          }
          const existing = prev ?? defaultNpcRecord(id);
          const merged = { ...existing, ...patch, updatedAt: Date.now() };
          if ('name' in patch) merged.name = resolveNpcName(existing.name, id, patch.name);   // 防占位名冲掉真实名（reentry）
          return { npcs: { ...s.npcs, [id]: merged } };
        });
        try { const n = useNpc.getState().npcs[id]; if (n?.name && n.name !== id) npcRegister(n.name, id, 'upsert'); } catch { /* NPC 影子记账失败绝不阻断 */ }
      },

      applyColumns: (id, cols) =>
        set((s) => {
          const rec = { ...(s.npcs[id] ?? defaultNpcRecord(id)) };

          for (const [col, rawVal] of Object.entries(cols)) {
            const val = String(rawVal ?? '');

            // 列1：name|gender
            if (col === '1') {
              const [n, g] = val.split('|');
              const newName = n?.trim();
              // 已有真实姓名时，不允许后续阶段（重点演化）把名字改成别的，
              // 避免"登场判断 + 重点演化"两次取名不一致；仅在尚无真名时填入。
              const hasRealName = !!rec.name && rec.name !== rec.id;
              if (newName && !hasRealName) rec.name = newName;
              if (g === '男' || g === '女') rec.gender = g;
              continue;
            }
            // 列15：favor（数字）
            if (col === '15') {
              const n = Number(rawVal);
              if (Number.isFinite(n)) rec.favor = n;
              continue;
            }
            // 四轴 disposition（信任/尊重/情欲/沉沦）：建档/校准的绝对赋值(clamp 0-100)；
            // 每回合增量另走 applyDisposition + dispositionGuard 限速，不经此处。
            const dispField = DISPOSITION_COLS[col];
            if (dispField) {
              const n = Number(rawVal);
              if (Number.isFinite(n)) (rec as any)[dispField] = Math.max(0, Math.min(100, Math.round(n)));
              continue;
            }
            // 列31：inCombat（bool）
            if (col === '31') {
              rec.inCombat = rawVal === true || rawVal === 'true' || rawVal === 1;
              continue;
            }
            // 列2：阶位·Lv|身份——规范化阶位部分（只允许 一阶~无上之境）。
            // AI 演化期（growthGuardCtx 在挂）另过成长闸门：升阶要正文突破证据+一回合一阶、Lv 步长限幅、
            // 降阶要跌落证据（棘轮）、任务世界受巅峰战力封顶；无上下文（迁移/测试/手动）＝只规范化，行为不变。
            if (col === '2') {
              const gctx = growthGuardCtx();
              if (gctx) {
                const exemptPeak = /随从|宠物|召唤物/.test(rec.npcTag ?? '');
                const g = guardRealmChange(rec.realm, val, rec.name || id, gctx, { exemptPeak });
                for (const nt of g.notes) logArbitration(rec.name || id, nt);
                rec.realm = g.realm;
              } else {
                rec.realm = normalizeRealm(val);
              }
              continue;
            }
            // 列4：状态——仅当状态表示"真的死亡"时才标记 isDead（精确判定，避免"濒临死亡/挚友身亡"误杀）
            if (col === '4') {
              rec.status = val;
              if (looksDead(val)) rec.isDead = true;
              continue;
            }

            const field = COL_TO_FIELD[col];
            if (field) {
              (rec as any)[field] = val;
            } else {
              rec.extra = { ...rec.extra, [col]: val };
            }
          }

          rec.updatedAt = Date.now();
          // 幽灵结构性根除（#1）：新建 且 处理完这批列后仍无真名（name===id/空）→ 不建壳。
          //   同 upsertNpc 的"无名不建壳"守卫——堵住 favor.C22 / realm.C22 等短指令对**未建档** NPC 凭空冒编号空壳（幽灵）的源头。
          //   已存在的真名 NPC 用任意列更新照常（prev 存在→放行）；带真名列(1)的登场/建档照常（rec.name 已成真名→放行）。
          if (!s.npcs[id] && (!rec.name || rec.name === id)) return s;
          return { npcs: { ...s.npcs, [id]: rec } };
        }),

      // 四轴对主角态度增量/绝对赋值（clamp 0-100）。限速/棘轮由 dispositionGuard 先算好最终 delta 再调本 action。
      applyDisposition: (id, patch) =>
        set((s) => {
          const prev = s.npcs[id];
          const rec = { ...(prev ?? defaultNpcRecord(id)) };
          const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
          const step = (cur: number, delta?: number, setv?: number) => {
            let v = cur;
            if (typeof setv === 'number') v = setv;
            if (typeof delta === 'number') v += delta;
            return clamp(v);
          };
          rec.trust = step(rec.trust ?? 10, patch.trustDelta, patch.trustSet);
          rec.respect = step(rec.respect ?? 10, patch.respectDelta, patch.respectSet);
          rec.lust = step(rec.lust ?? 0, patch.lustDelta, patch.lustSet);
          rec.corruption = step(rec.corruption ?? 0, patch.corruptionDelta, patch.corruptionSet);
          rec.updatedAt = Date.now();
          // 无名不建壳守卫（同 applyColumns）：对未建档 NPC 的态度指令不凭空冒空壳
          if (!prev && (!rec.name || rec.name === id)) return s;
          return { npcs: { ...s.npcs, [id]: rec } };
        }),

      removeNpc: (id) =>
        set((s) => {
          if (!s.npcs[id]) return s;
          return { npcs: { ...s.npcs, [id]: { ...s.npcs[id], onScene: false, updatedAt: Date.now() } } };
        }),

      createPartyMember: (info) => {
        let newId = '';
        set((s) => {
          const used = new Set(Object.keys(s.npcs));
          let n = 1; while (used.has(`C${n}`)) n++;
          newId = `C${n}`;
          const rec: NpcRecord = {
            ...defaultNpcRecord(newId),
            name: ((info.name || '契约者').trim().slice(0, 24)) || '契约者',
            realm: info.tier ? `${info.tier}|${info.role || '临时队友'}` : '',
            profession: info.job || '',
            personality: info.persona || '',
            bioStrength: info.strength || '',
            npcTag: '契约者',
            onScene: true,
            partyMember: true,
            partyWorld: info.world || '',
            partyRole: info.role || '',
            updatedAt: Date.now(),
          };
          return { npcs: { ...s.npcs, [newId]: rec } };
        });
        return newId;
      },
      createArchivedContractor: (info) => {
        let newId = '';
        set((s) => {
          const used = new Set(Object.keys(s.npcs));
          let n = 1; while (used.has(`C${n}`)) n++;
          newId = `C${n}`;
          const rec: NpcRecord = {
            ...defaultNpcRecord(newId),
            name: ((info.name || '契约者').trim().slice(0, 24)) || '契约者',
            realm: info.tier ? `${info.tier}|` : '',
            profession: info.job || '',
            personality: info.persona || '',
            bioStrength: info.strength || '',
            npcTag: info.tag || '契约者',
            onScene: false,
            updatedAt: Date.now(),
          };
          return { npcs: { ...s.npcs, [newId]: rec } };
        });
        return newId;
      },
      createCompanion: (info) => {
        let newId = '';
        set((s) => {
          const used = new Set(Object.keys(s.npcs));
          let n = 1; while (used.has(`C${n}`)) n++;
          newId = `C${n}`;
          const app = (info.appearance || '').trim();
          const rec: NpcRecord = {
            ...defaultNpcRecord(newId),
            name: ((info.name || '随从').trim().slice(0, 24)) || '随从',
            gender: info.gender === '男' ? '男' : info.gender === '女' ? '女' : '',
            title: '',
            realm: info.realm || '',
            profession: info.profession || '',
            age: info.age || '',
            personality: info.personality || '',
            background: info.background || '',
            appearance5: app, baseAppearance: app,
            bioStrength: info.strength || '',
            selfNarration: info.selfNarration || '',
            npcTag: info.tag || '随从',
            attrs: info.attrs,
            onScene: true, partyMember: true, keepForever: true, isBond: true, isFriend: true,   // 开局随行：在场+入队+好友(参与演化)+长期保留(不进清理名单)
            updatedAt: Date.now(),
          };
          return { npcs: { ...s.npcs, [newId]: rec } };
        });
        return newId;
      },
      createPet: (info) => {
        let newId = '';
        set((s) => {
          const used = new Set(Object.keys(s.npcs));
          let n = 1; while (used.has(`C${n}`)) n++;
          newId = `C${n}`;
          const desc = [info.persona, info.ability && `天赋能力：${info.ability}`, info.appearance && `外观：${info.appearance}`].filter(Boolean).join('\n');
          // realm 必须带 ·Lv.N：等级藏在 realm 里(lvFromRealm)，缺了就被全链路当 Lv.1 → 一阶 → 单属性上限 50 把六维夹平
          const petRealm = info.tier
            ? normalizeRealm(`${info.tier}${info.level != null ? `·Lv.${info.level}` : ''}|宠物`)
            : '';
          const rec: NpcRecord = {
            ...defaultNpcRecord(newId),
            name: ((info.name || '契灵').trim().slice(0, 24)) || '契灵',
            realm: petRealm,
            profession: info.species || '契灵',
            personality: desc,
            bioStrength: info.strength || '',
            ...(info.attrs ? { attrs: info.attrs } : {}),
            unitType: '凶兽魔兽',
            npcTag: '宠物',
            onScene: true,
            partyMember: true,
            partyRole: '宠物',
            isFriend: true,
            friendedAt: Date.now(),
            updatedAt: Date.now(),
          };
          return { npcs: { ...s.npcs, [newId]: rec } };
        });
        return newId;
      },
      setFriend: (id, on) =>
        set((s) => (s.npcs[id] ? { npcs: { ...s.npcs, [id]: { ...s.npcs[id], isFriend: on, friendedAt: on ? Date.now() : s.npcs[id].friendedAt, updatedAt: Date.now() } } } : s)),
      leaveParty: (id) =>
        set((s) => (s.npcs[id] ? { npcs: { ...s.npcs, [id]: { ...s.npcs[id], partyMember: false, updatedAt: Date.now() } } } : s)),
      disbandPartyForWorld: (currentWorld) => {
        const cw = (currentWorld || '').trim();
        const out: string[] = [];
        set((s) => {
          const npcs = { ...s.npcs };
          for (const [id, r] of Object.entries(s.npcs) as [string, NpcRecord][]) {
            if (r.partyMember && (r.partyWorld || '') !== cw) {
              out.push(id);
              npcs[id] = { ...r, partyMember: false, onScene: false, updatedAt: Date.now() };   // 离队 + 离场归档（软删除，保留档案）
            }
          }
          return out.length ? { npcs } : s;
        });
        return out;
      },

      hardRemoveNpc: (id) => {
        // 图书馆：⚠必须在 removeCharacter 之前入库，否则快照拍到的是被清空技能/记忆的空架子
        archiveBeforeRemove(useNpc.getState().npcs[id], 'hardRemove');
        // 同步清除该 NPC 在 characterStore 的技能/词条，避免孤儿数据
        try { useCharacters.getState().removeCharacter(id); } catch { /* ignore */ }
        set((s) => {
          if (!s.npcs[id]) return s;
          const next = { ...s.npcs };
          delete next[id];
          return { npcs: next };
        });
      },

      /* 幽灵结构性根除（#1）：一次删掉所有幽灵空壳（isGhostNpc 判定·并清 characterStore 孤儿）。
         settledPrev 传入(facade 用) → 只删"沉淀幽灵"(prev 里也是幽灵·已跨过一次状态变动仍无身份)，
         新建/刚变幽灵宽限一次——绝不误伤本回合正在建档的新角色。不传(启动/读档用) → 删当前全部幽灵。 */
      pruneGhosts: (settledPrev) => {
        const charData = (() => { try { return useCharacters.getState().characters as Record<string, { skills?: unknown[]; traits?: unknown[] }>; } catch { return {}; } })();
        let removed: string[] = [];
        let removedRecs: NpcRecord[] = [];
        set((s) => {
          const ghosts = Object.entries(s.npcs).filter(([id, r]) => {
            if (!isGhostNpc(r, charData)) return false;
            if (settledPrev) { const p = settledPrev[id]; if (!p || !isGhostNpc(p, charData)) return false; }   // 新建/刚变幽灵→宽限一次状态变动，护建档中
            return true;
          }).map(([id]) => id);
          if (ghosts.length === 0) return s;
          removed = ghosts;
          removedRecs = ghosts.map((id) => s.npcs[id]);
          const next = { ...s.npcs };
          for (const id of ghosts) delete next[id];
          return { npcs: next };
        });
        // 图书馆：安全网。幽灵按定义就是占位名，archiveBeforeRemove 的"有名有姓"门会全部挡下 → 实际不入库；
        // 挂在这里是为了「没有任何一条删除路径不经过图书馆」这条不变量——将来若放宽幽灵判定，真人也不会漏。
        // ⚠ 在 removeCharacter 之前。
        for (const r of removedRecs) archiveBeforeRemove(r, 'ghostPrune');
        for (const id of removed) { try { useCharacters.getState().removeCharacter(id); } catch { /* 清 characterStore 孤儿·失败忽略 */ } }
        return removed.length;
      },

      applySkeleton: (id, short) =>
        set((s) => {
          const rec = { ...(s.npcs[id] ?? defaultNpcRecord(id)) };
          const g = (k: string) => {
            const v = short[k];
            return v == null ? '' : String(v);
          };
          // n: "姓名|性别"
          const n = g('n');
          if (n) {
            const [nm, gd] = n.split('|');
            if (nm?.trim()) rec.name = resolveNpcName(rec.name, id, nm);   // 防占位名冲掉真实名
            if (gd === '男' || gd === '女') rec.gender = gd;
          }
          if (g('r')) {                              // 境界(进度%)|身份 → 列2。原裸写，现同列2口径过成长闸门：
            const gr = guardRealmChange(rec.realm, g('r'), rec.name || id, growthGuardCtx(), { exemptPeak: /随从|宠物|召唤物/.test(rec.npcTag ?? '') });
            for (const nt of gr.notes) logArbitration(rec.name || id, nt);   // 首档=合法化+巅峰封顶；重新登场改档=证据裁决
            rec.realm = gr.realm;
          }
          if (g('p')) rec.personality = g('p');      // 列3
          if (g('t')) rec.title = g('t');            // 称号
          if (g('lg')) rec.extra = { ...rec.extra, '5': g('lg') }; // 灵根/天赋 → 列5
          if (g('bg')) rec.background = g('bg');      // 列10
          if (g('act')) rec.appearance5 = g('act');   // 列16
          if (g('bs')) {                               // AI 登场判断据正文给的生物强度档/定位(T0~T9 或 杂鱼/首领…)→ 供 autoGen 生成贴合六维
            const gb = guardBioStrength(rec.bioStrength, g('bs'), rec.realm, rec.name || id, growthGuardCtx());   // bs 是六维封顶的锚：夹进本阶窗口+改档裁决，不许裸写
            for (const nt of gb.notes) logArbitration(rec.name || id, nt);
            rec.bioStrength = gb.bs;
          }
          if (g('ty')) rec.unitType = g('ty');         // AI 登场判断据正文选的类型标签(封闭枚举)→ 供 autoGen 按类型生成主属性方向/形态/凡人
          if (short['extraSy'] != null) rec.extra = { ...rec.extra, 额外寿元: g('extraSy') };
          if (short['apAge'] != null)   rec.extra = { ...rec.extra, 外貌年龄: g('apAge') };
          if (g('yrr')) rec.extra = { ...rec.extra, 驻颜理由: g('yrr') };
          // 兜底：AI 塞进**未知缩写键**（如乱写的"裤"里塞了 HP/基底外观）的内容不静默丢弃——存进 extra，
          //   至少在「表格数据库/NPC详情」可见、NPC 演化阶段也能据此补正（治"登场给的字段被整段丢了"）。
          const KNOWN_SKEL = new Set(['n', 'r', 'p', 't', 'lg', 'bg', 'act', 'bs', 'ty', 'extraSy', 'apAge', 'yrr']);
          for (const k of Object.keys(short)) { if (!KNOWN_SKEL.has(k)) { const v = g(k); if (v) rec.extra = { ...rec.extra, [k]: v }; } }
          rec.onScene = true;
          rec.updatedAt = Date.now();
          return { npcs: { ...s.npcs, [id]: rec } };
        }),

      setScene: (id, onScene, turn) =>
        set((s) => {
          const rec = s.npcs[id] ?? defaultNpcRecord(id);
          return {
            npcs: {
              ...s.npcs,
              [id]: {
                ...rec,
                onScene,
                ...(onScene ? { archived: false } : {}),   // 不变量 archived⟹!onScene：一旦重新上场即解除归档
                ...(onScene && turn != null ? { lastSeenTurn: turn } : {}),
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setSchedule: (id, patch) =>
        set((s) => {
          const rec = s.npcs[id];
          if (!rec) return s;
          return { npcs: { ...s.npcs, [id]: { ...rec, ...patch, updatedAt: Date.now() } } };
        }),

      markEvolved: (id, turn, date) =>
        set((s) => {
          const rec = s.npcs[id];
          if (!rec) return s;
          return {
            npcs: {
              ...s.npcs,
              [id]: { ...rec, lastEvolvedTurn: turn, ...(date ? { lastEvolvedDate: date } : {}), updatedAt: Date.now() },
            },
          };
        }),

      appendDeed: (id, deed) =>
        set((s) => {
          const rec = s.npcs[id] ?? defaultNpcRecord(id);
          // 兼容：字符串 → 归一成 Deed（时间/地点留空，描述放原文）
          const entry: Deed = typeof deed === 'string'
            ? { time: '', location: '', description: deed, addedAt: Date.now() }
            : { ...deed, addedAt: deed.addedAt ?? Date.now() };
          const log = [...(rec.deedLog ?? []), entry].slice(-12); // 保留最近 12 条
          // 同步维护旧字符串字段，旧 UI/导出仍可用
          const legacy = log
            .map((d) => (d.time || d.location ? `[${d.time}@${d.location}] ` : '') + d.description)
            .slice(-6).join('\n');
          return { npcs: { ...s.npcs, [id]: { ...rec, deedLog: log, deeds: legacy, updatedAt: Date.now() } } };
        }),

      removeDeed: (id, index) =>
        set((s) => {
          const rec = s.npcs[id];
          if (!rec?.deedLog) return s;
          const log = rec.deedLog.filter((_, i) => i !== index);
          return { npcs: { ...s.npcs, [id]: { ...rec, deedLog: log, updatedAt: Date.now() } } };
        }),

      clearDeeds: (id) =>
        set((s) => {
          const rec = s.npcs[id];
          if (!rec) return s;
          return { npcs: { ...s.npcs, [id]: { ...rec, deedLog: [], deeds: '', updatedAt: Date.now() } } };
        }),

      applyAutonomy: (updates) =>
        set((s) => {
          if (!updates.length) return s;
          const npcs = { ...s.npcs };
          const now = Date.now();
          for (const u of updates) {
            const rec = npcs[u.id];
            if (!rec) continue;
            let next: NpcRecord = { ...rec, ...(u.patch ?? {}), updatedAt: now };
            if (u.deed) {
              const log = [...(rec.deedLog ?? []), u.deed].slice(-12);
              const legacy = log
                .map((d) => (d.time || d.location ? `[${d.time}@${d.location}] ` : '') + d.description)
                .slice(-6).join('\n');
              next = { ...next, deedLog: log, deeds: legacy };
            }
            npcs[u.id] = next;
          }
          return { npcs };
        }),

      absorbOrphans: () => {
        let merged = 0;
        set((s) => {
          const all = Object.values(s.npcs) as NpcRecord[];
          const isReal = (r: NpcRecord) =>
            !!(r.name && r.name !== r.id && (r.realm || r.personality || r.background));
          const orphans = all.filter((r) => (r.items?.length ?? 0) > 0 && !isReal(r));
          if (orphans.length === 0) return s;
          // 最佳合并目标：在场优先，其次最近更新
          const targets = all
            .filter(isReal)
            .sort((a, b) => (b.onScene ? 1 : 0) - (a.onScene ? 1 : 0) || b.updatedAt - a.updatedAt);
          if (targets.length === 0) return s;

          const next = { ...s.npcs };
          const tgtId = targets[0].id;
          const tgt = { ...next[tgtId] };
          const items = [...(tgt.items ?? [])];
          for (const o of orphans) {
            for (const it of o.items) {
              if (!items.some((x) => x.id === it.id)) items.push(it);
            }
            delete next[o.id];
            merged++;
          }
          tgt.items = items;
          tgt.updatedAt = Date.now();
          next[tgtId] = tgt;
          return { npcs: next };
        });
        return merged;
      },

      dedupeByName: () => {
        let removed = 0;
        set((s) => {
          // 按"去空白姓名"分组真实、未死亡的 NPC（占位名 = id 的不参与）
          const groups = new Map<string, NpcRecord[]>();
          for (const r of Object.values(s.npcs) as NpcRecord[]) {
            if (r.isDead) continue;
            // 玩家显式「归档」= 独立第三态的封存档案：自动去重一律不碰（归档≠删除）。
            // 否则 AI 重新提及该角色时新建的同名档案会与封存档撞名 → 合并 → 封存档被删/被解除归档（玩家眼里＝"归档区空了、召唤回来不是同一个人"）。
            if (r.archived) continue;
            const key = (r.name || '').trim();
            if (!key || key === r.id) continue;
            const arr = groups.get(key);
            if (arr) arr.push(r); else groups.set(key, [r]);
          }
          const next = { ...s.npcs };
          // 信息完整度评分：留下最全的那个，其余并入它。
          // ⚠「在场」绝不计入数据分——否则 AI 新建的同名空壳只靠 onScene 那 1 分就能吃掉玩家的老档案（连 deedLog/装备/头像一起没）。
          //   持有物/经历是"删了找不回"的历史 → 权重×2；avatar 被 partialize 剥离(存 IndexedDB)、刷新后为空，只作弱信号。
          const score = (r: NpcRecord) =>
            (r.realm ? 2 : 0) + (r.personality ? 1 : 0) + (r.background ? 1 : 0) +
            (r.appearanceDetail ? 1 : 0) + (r.title ? 1 : 0) + (r.profession ? 1 : 0) +
            (r.items?.length ?? 0) * 2 + (r.deedLog?.length ?? 0) * 2 +
            (r.avatar ? 1 : 0) + ((r.favor ?? 0) !== 0 ? 1 : 0);
          const purge: string[] = [];
          const purgeRecs: NpcRecord[] = [];   // 图书馆：被合并掉的原始档案（入库留底用）
          for (const group of groups.values()) {
            if (group.length < 2) continue;
            // 数据分决定留谁；仅在数据分完全持平时才用「在场」当决胜项，最后按 id 稳定排序
            const keeper = group.slice().sort((a, b) =>
              score(b) - score(a) ||
              Number(!!b.onScene) - Number(!!a.onScene) ||
              a.id.localeCompare(b.id))[0];
            let merged = { ...next[keeper.id] };
            for (const dup of group) {
              if (dup.id === keeper.id) continue;
              merged = mergeNpcRecords(merged, dup);
              delete next[dup.id];
              purge.push(dup.id);
              purgeRecs.push(dup);
              removed++;
              console.warn(`[NPC] 合并同名重复角色「${keeper.name}」：${dup.id} → ${keeper.id}`);
            }
            next[keeper.id] = { ...merged, updatedAt: Date.now() };
          }
          if (removed) {
            // 图书馆：被合并掉的那份先全量入库（⚠必须在 removeCharacter 之前）。
            // 合并虽已把字段并进 keeper，但"只存不删"要求任何档案消失前都留底——万一合并判断失误，还能原样找回。
            for (const r of purgeRecs) archiveBeforeRemove(r, 'dedupeMerge');
            // 同步清除被合并角色在 characterStore 的技能/词条，避免孤儿数据
            try { for (const id of purge) useCharacters.getState().removeCharacter(id); } catch { /* ignore */ }
            return { npcs: next };
          }
          return s;
        });
        return removed;
      },

      /* 跨语言/畸形名重复合并：AI 常把已建档角色用英文/罗马音名 + 泄漏的 C_ 前缀（如「C_Frieren」=芙莉莲、「C_Fern」）
         再建一遍 → 中文名去重(dedupeByName)匹配不到 → 重复档。这里把"畸形名"(C_/G_ 前缀 或 纯非中文)NPC，
         合并进**同阶位 + 同职业**的中文名 NPC（强信号=同一人）；找不到对应中文档的，至少把泄漏的 C_/G_ 前缀从名字里剥掉。 */
      dedupeAliasNpcs: () => {
        let merged = 0;
        set((s) => {
          const all = Object.values(s.npcs) as NpcRecord[];
          const hasCJK = (x?: string) => /[一-鿿]/.test(x || '');
          const tierOf = (r: NpcRecord) => normalizeTier(r.realm || '') || (r.realm || '').split(/[|·\s]/)[0] || '';
          const stripIdPrefix = (n: string) => n.replace(/^[CG]_+/i, '').trim();
          const isSusp = (x?: string) => { const n = (x || '').trim(); return !!n && (/^[CG]_/i.test(n) || !hasCJK(n)); };
          const alive = (r: NpcRecord) => !r.isDead && !!r.name && r.name !== r.id;
          const suspects = all.filter((r) => alive(r) && isSusp(r.name));
          if (suspects.length === 0) return s;
          const next = { ...s.npcs };
          const purge: string[] = [];
          const purgeRecs: NpcRecord[] = [];   // 图书馆：被合并掉的原始档案（入库留底用）
          for (const sus of suspects) {
            if (purge.includes(sus.id)) continue;
            const tier = tierOf(sus); const prof = (sus.profession || '').trim();
            // 同阶位 + 同职业 + 中文名 + 活着 + 非自身 = 同一人
            let canon = tier && prof ? all.find((r) =>
              r.id !== sus.id && !purge.includes(r.id) && alive(r) && hasCJK(r.name) && !isSusp(r.name)
              && tierOf(r) === tier && (r.profession || '').trim() === prof) : undefined;
            // 兜底（治「全新 Lv.1 空壳罗马音档」如「Akaza」之于已建档的「猗窝座」——新登场角色被生成两次）：
            //   嫌疑档身份基本为空(无阶位/无职业/无头衔·就是刚 type:new 出来的空壳) 且没能按 阶位+职业 匹配到正档时，
            //   若当前**在场的中文名正档恰好唯一**(不含自身)，判为它的错名重复、合并进去；在场中文正档有多个(歧义)则保守不动。
            if (!canon && !tier && !prof && !(sus.title || '').trim()) {
              const cjkOnScene = all.filter((r) =>
                r.id !== sus.id && !purge.includes(r.id) && alive(r) && hasCJK(r.name) && !isSusp(r.name) && r.onScene);
              if (cjkOnScene.length === 1) canon = cjkOnScene[0];
            }
            if (canon) {
              const keeper: any = { ...next[canon.id] };
              // 与同名合并共用 mergeNpcRecords：经历/持有物并集、关系数值取大值、人设字段补齐、身份标记不降级
              //（旧代码这里是另一份只补 12 个字段的窄名单 → 别名合并同样会蒸发 关系/经历/感情线）
              const keeperMerged = mergeNpcRecords(keeper as NpcRecord, sus as NpcRecord);
              next[canon.id] = { ...keeperMerged, updatedAt: Date.now() };
              delete next[sus.id];
              purge.push(sus.id);
              purgeRecs.push(sus as NpcRecord);
              merged++;
              console.warn(`[NPC] 跨语言/畸形名重复合并：${sus.id}「${sus.name}」→ ${canon.id}「${canon.name}」(同${tier}·${prof})`);
            } else {
              // 没对应中文档：至少剥掉泄漏的 C_/G_ 前缀（"C_Frieren"→"Frieren"），让后续提示词改成中文名
              const cleaned = stripIdPrefix(sus.name!);
              if (cleaned && cleaned !== sus.name) { next[sus.id] = { ...next[sus.id], name: cleaned, updatedAt: Date.now() }; }
            }
          }
          if (!merged && !purge.length) {
            // 仅做了前缀清洗也要落盘
            return next === s.npcs ? s : { npcs: next };
          }
          // 图书馆：被别名合并掉的那份先全量入库（⚠必须在 removeCharacter 之前）
          for (const r of purgeRecs) archiveBeforeRemove(r, 'aliasMerge');
          try { for (const id of purge) useCharacters.getState().removeCharacter(id); } catch { /* ignore */ }
          return { npcs: next };
        });
        return merged;
      },

      normalizeNpcIds: () => {
        let fixed = 0;
        const remap = new Map<string, string>();   // 旧非法ID → 新 C 编号
        set((s) => {
          const bad = Object.keys(s.npcs).filter((id) => !isNpcId(id));
          if (bad.length === 0) return s;
          const used = new Set(Object.keys(s.npcs));
          const nextC = () => { let n = 1; while (used.has(`C${n}`)) n++; const id = `C${n}`; used.add(id); return id; };
          const next = { ...s.npcs };
          for (const oldId of bad) {
            const newId = nextC();
            remap.set(oldId, newId);
            next[newId] = { ...next[oldId], id: newId, updatedAt: Date.now() };
            delete next[oldId];
            fixed++;
            console.warn(`[NPC] 非法ID规范化：${oldId} → ${newId}（${next[newId].name || '?'}）`);
          }
          // 改写所有 NPC 对旧 ID 的引用：人际关系(列13 "id:关系" 的左侧) + 契约者ID
          for (const [id, r] of Object.entries(next) as [string, NpcRecord][]) {
            let patch: Partial<NpcRecord> | null = null;
            if (typeof r.relations === 'string' && r.relations) {
              // 只替换每段 "左侧ID:" 的左侧（遇到第一个冒号为界），不碰关系描述文本
              const rel2 = r.relations.replace(/([^;；\n:：]+)([:：])/g, (m, left: string, sep: string) => {
                const mapped = remap.get(left.trim());
                return mapped ? mapped + sep : m;
              });
              if (rel2 !== r.relations) patch = { relations: rel2 };
            }
            if (r.contractorId && remap.has(r.contractorId)) patch = { ...(patch ?? {}), contractorId: remap.get(r.contractorId)! };
            if (patch) next[id] = { ...next[id], ...patch };
          }
          return { npcs: next };
        });
        if (fixed) {
          // 同步把技能/天赋/称号/记忆迁到新 ID（characterStore 也按 ID 索引）
          try { for (const [o, n] of remap) useCharacters.getState().renameCharacter(o, n); } catch { /* ignore */ }
        }
        return fixed;
      },

      clearAll: () => {
        // 同步清除所有 NPC 的技能/词条（保留玩家 B*）
        try { useCharacters.getState().purgeNpcCharacters(); } catch { /* ignore */ }
        set({ npcs: {} });
      },

      addNpcItem: (ownerId, item) =>
        set((s) => {
          const rec = s.npcs[ownerId] ?? defaultNpcRecord(ownerId);
          const items = [...(rec.items ?? [])];
          const idx = items.findIndex((it) => it.id === item.id);
          if (idx >= 0) {
            items[idx] = { ...items[idx], quantity: items[idx].quantity + item.quantity };
            return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
          }
          // 同名堆叠：可堆叠类（非武器/防具/饰品/特殊/法宝）、未装备 → 累加到已有同名同品质条目，不新建行
          const stackable = (c?: string) => !NPC_NO_STACK_CATS.has(c ?? '');
          if (!item.equipped && stackable(item.category)) {
            const sIdx = items.findIndex((it) => !it.equipped && stackable(it.category) && npcStackNorm(it.name) === npcStackNorm(item.name) && npcStackNorm(it.gradeDesc) === npcStackNorm(item.gradeDesc));
            if (sIdx >= 0) {
              items[sIdx] = { ...items[sIdx], quantity: (items[sIdx].quantity || 1) + (item.quantity || 1) };
              return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
            }
          }
          items.push(item);
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      dedupeNpcItems: (ownerId) =>
        set((s) => {
          const stackable = (c?: string) => !NPC_NO_STACK_CATS.has(c ?? '');
          const dedupeOne = (rec: NpcRecord): NpcRecord => {
            const idxByKey = new Map<string, number>();
            const out: NpcOwnedItem[] = [];
            for (const it of rec.items ?? []) {
              // 同主角侧 dedupeByName：装备/唯一物是独立实例，同名也可能是两件不同的 → 绝不按名合并（防悄悄吞掉 NPC 装备）。
              // 只合并「可堆叠 + 未装备 + 未锁定」且**同名同品质**的真重复，累加数量。
              const mergeable = stackable(it.category) && !it.equipped && !it.equipSlot && !(it as any).locked;
              const key = mergeable ? npcStackNorm(it.name) + '|' + npcStackNorm(it.gradeDesc) : '';
              const at = key ? idxByKey.get(key) : undefined;
              if (!key || at === undefined) {
                if (key) idxByKey.set(key, out.length);
                out.push(it); continue;
              }
              const a = out[at];
              out[at] = { ...a, quantity: (a.quantity || 1) + (it.quantity || 1) };   // 同一种可堆叠物 → 累加
            }
            return out.length === (rec.items?.length ?? 0) ? rec : { ...rec, items: out, updatedAt: Date.now() };
          };
          if (ownerId) { const rec = s.npcs[ownerId]; return rec ? { npcs: { ...s.npcs, [ownerId]: dedupeOne(rec) } } : s; }
          const npcs = { ...s.npcs };
          let changed = false;
          for (const id of Object.keys(npcs)) { const d = dedupeOne(npcs[id]); if (d !== npcs[id]) { npcs[id] = d; changed = true; } }
          return changed ? { npcs } : s;
        }),

      normalizeItemGrades: () => {
        let n = 0;
        set((s) => {
          const npcs = { ...s.npcs };
          let changedAny = false;
          for (const id of Object.keys(npcs)) {
            const rec = npcs[id];
            let recChanged = false;
            const items = (rec.items ?? []).map((it) => {
              if (!it.gradeDesc) return it;
              const ng = normalizeGradeLabel(it.gradeDesc, { score: (it as any).score, grade: (it as any).numeric?.grade });
              if (ng.changed) { n++; recChanged = true; return { ...it, gradeDesc: ng.grade }; }
              return it;
            });
            if (recChanged) { npcs[id] = { ...rec, items, updatedAt: Date.now() }; changedAny = true; }
          }
          return changedAny ? { npcs } : s;
        });
        return n;
      },

      updateNpcItem: (ownerId, itemId, patch) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const items = (rec.items ?? []).map((it) => (it.id === itemId ? { ...it, ...patch } : it));
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      removeNpcItem: (ownerId, itemId) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          markAccountedRemoval(itemId);   // 经官方方法移除（转给玩家/赠予等）→ 登记，看门狗不误捞
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items: rec.items.filter((it) => it.id !== itemId), updatedAt: Date.now() } } };
        }),

      equipNpcItem: (ownerId, itemId, slot) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const items = rec.items.map((it) => {
            if (it.id === itemId) return { ...it, equipped: true, equipSlot: slot };
            // 同槽位旧装备先卸回储存空间，避免被覆盖后看不见
            if (slot && it.equipped && it.equipSlot === slot) return { ...it, equipped: false, equipSlot: undefined };
            return it;
          });
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      unequipNpcItem: (ownerId, itemId) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const items = rec.items.map((it) =>
            it.id === itemId ? { ...it, equipped: false, equipSlot: undefined } : it
          );
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      consumeNpcItem: (ownerId, itemId, qty) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const target = rec.items.find((it) => it.id === itemId);
          if (target && (target.quantity - qty) <= 0) markAccountedRemoval(itemId);   // 整件用尽 → 登记移除，看门狗不误捞
          const items = rec.items
            .map((it) => it.id === itemId ? { ...it, quantity: it.quantity - qty } : it)
            .filter((it) => it.quantity > 0);
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      clearNpcBag: (ownerId) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const items = rec.items.filter((it) => it.equipped || it.locked); // 只保留已装备 / 已锁定
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      addNpcStatus: (id, e) =>
        set((s) => {
          const rec = s.npcs[id]; if (!rec) return s;
          const list = rec.statusEffects ?? [];
          const idx = list.findIndex((x) => x.name === e.name);
          const next = [...list];
          if (idx >= 0) next[idx] = e; else next.push(e);
          return { npcs: { ...s.npcs, [id]: { ...rec, statusEffects: next, updatedAt: Date.now() } } };
        }),

      removeNpcStatus: (id, idOrName) =>
        set((s) => {
          const rec = s.npcs[id]; if (!rec) return s;
          const next = (rec.statusEffects ?? []).filter((x) => x.id !== idOrName && x.name !== idOrName);
          return { npcs: { ...s.npcs, [id]: { ...rec, statusEffects: next, updatedAt: Date.now() } } };
        }),

      setNpcStatuses: (id, list) =>
        set((s) => {
          const rec = s.npcs[id]; if (!rec) return s;
          return { npcs: { ...s.npcs, [id]: { ...rec, statusEffects: list, updatedAt: Date.now() } } };
        }),
    }),
    {
      name: 'drpg-npc',
      storage: lzStorage(),   // lz 压缩：数十 NPC 档案 400KB+
      // NPC 头像(avatar)与持有物图(items[].image)体积大，不写 localStorage（改存 IndexedDB）
      partialize: (s: any) => ({
        ...s,
        npcs: Object.fromEntries(Object.entries(s.npcs ?? {}).map(([id, r]: [string, any]) => [id, {
          ...r, avatar: undefined,
          items: Array.isArray(r.items) ? r.items.map((it: any) => ({ ...it, image: undefined })) : r.items,
        }])),
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        // 一次性纠偏：历史上因"状态文案含死字"被误标 isDead 的活人，若当前状态并非真死亡则复活（让其重回档案）。
        // 真正死亡（状态写"已死亡/阵亡…"）的仍保持 isDead，不会被误复活。
        npcs: Object.fromEntries(Object.entries(persisted?.npcs ?? {}).map(([id, r]: [string, any]) =>
          [id, (r && r.isDead && !looksDead(r.status)) ? { ...r, isDead: false } : r],
        )),
      }),
    },
  ),
);

/* ── NPC facade 闸门（Step 10·"重复建档"+"幽灵"双结构性根除）──────────────────────
   NPC 不像物品能按 id 键天然去重（npcStore 到处用 C-id 引用·没法改按名键），故闸门做法＝subscribe 每次状态变动即校正：
   ① 同真名"重复建档"：检测到"两个 id 同一真名" → 立即调**现成 careful `dedupeByName`** 合并（复用已验证的谨慎逻辑·装备/唯一物不误吞）。
   ② 幽灵空壳(占位名+零真实身份)：调 `pruneGhosts(prev.npcs)` 删**沉淀幽灵**（prev 里也是幽灵·已跨过一次状态变动仍无身份）。
      **只删沉淀幽灵、给新建幽灵宽限一次**——本回合正在建档的新角色(先建壳后补名/技能)绝不误删；配合建档时"无名不建壳"守卫
      (upsertNpc/applyColumns 原子带名建档)，幽灵**无从跨状态存活**。不再单靠 App.pruneGhostNpcs 那条 once-per-turn 时序清理
      （它保留为回合末兜底，判定共用 isGhostNpc）。循环护栏 `_npcCanonicalizing` + try 兜底·绝不阻断主流程。 */
let _npcCanonicalizing = false;
useNpc.subscribe((state, prev) => {
  if (_npcCanonicalizing || state.npcs === prev.npcs) return;
  try {
    // ① 同真名重复建档检测（只读）
    const seen = new Set<string>();
    let dup = false;
    for (const [id, n] of Object.entries(state.npcs ?? {})) {
      const rec = n as { name?: string; isDead?: boolean; archived?: boolean } | null;
      // 归档档案不参与重名检测（与 dedupeByName 的跳过规则单一来源）：玩家封存的档案绝不因 AI 新建同名角色被卷进合并
      if (!rec || !rec.name || rec.name === id || rec.isDead || rec.archived) continue;
      const k = npcNorm(rec.name);
      if (seen.has(k)) { dup = true; break; }
      seen.add(k);
    }
    _npcCanonicalizing = true;
    const merged = dup ? useNpc.getState().dedupeByName() : 0;
    const pruned = useNpc.getState().pruneGhosts(prev.npcs);   // ② 沉淀幽灵结构性清除（护建档中新角色）
    _npcCanonicalizing = false;
    if (merged > 0) console.warn(`[NPC facade] 同真名重复建档 → 已合并 ${merged}（重复建档无法跨状态变动存活）`);
    if (pruned > 0) console.warn(`[NPC facade] 幽灵空壳结构性清除 ${pruned}（沉淀幽灵·无从跨状态存活）`);
  } catch (e) { _npcCanonicalizing = false; console.warn('[NPC facade] 规范化失败（忽略）:', e); }
});
// 注册后立即校正一次：rehydrate（读档/刷新）已落地的重复真名 / 幽灵空壳（老存档），subscribe 尚未挂时不会捕获——补一刀
// （对齐物品 facade 的初始规范化；无法在 merge 里调 action 因 store 未建好，故放此处）。初始态无"建档中"，幽灵全删。
try {
  const m0 = useNpc.getState().dedupeByName();
  const g0 = useNpc.getState().pruneGhosts();   // 不传 settledPrev＝删当前全部幽灵（读档时的老空壳）
  if (m0 > 0) console.warn(`[NPC facade] 初始去重合并 ${m0}（读档已有的重复建档）`);
  if (g0 > 0) console.warn(`[NPC facade] 初始幽灵清除 ${g0}（读档已有的无名空壳）`);
} catch { /* */ }
