/* ── ACU 表格数据库 · 表规格（单一真相）────────────────────────────────────
   以 ACU 星数据库（AlbusKen/shujuku@spv5.5.6）的表结构为模板，套 zhushen 轮回乐园的列。
   一张表 = 一个 AcuSheet：
     · sourceData.ddl   —— SQL 建表语句（英文列名+类型+CHECK 约束+`-- 中文名` 注释），**纯规格/文档**：
                            运行时引擎与 sql.js 镜像都按 content 的中文表头操作（见 tableSqlite Step 6b），ddl 无人在运行时读；
                            改列时 headers 与 ddl 须同步——`acuTableSpec.test.ts` 已把「ddl 列数==headers 列数」下沉为机器守卫，漂移即红。
     · sourceData.note/*Node —— 表说明 + 逐列含义 + 增删改触发规则（喂给「填表AI」）。
     · content          —— 二维数组：content[0]=中文表头(含 row_id)，其后每行是数据行。
     · single           —— 单行表(true)只 UPDATE row_id=1、禁 INSERT；多行表(false)有业务唯一键。
     · exportConfig     —— 这张表怎么渲染成世界书条目注入正文（position/depth/order）。
   设计文档：`指导/ACU星数据库-移植-设计.md`。改表加列改这里，别散到各处。 */

export interface AcuUpdateConfig {
  /** 更新调度参数，-1 = 跟随全局设置。对应 ACU updateConfig。 */
  uiSentinel: number;
  contextDepth: number;
  updateFrequency: number;
  batchSize: number;
  skipFloors: number;
}

export interface AcuEntryPlacement {
  position: string; // 'at_depth_as_system'
  depth: number;
  order: number;
}

export interface AcuExportConfig {
  enabled: boolean;
  splitByRow: boolean;
  entryName: string;
  entryType: 'constant' | 'selective'; // constant=蓝灯常驻 / selective=关键词绿灯
  keywords: string;
  preventRecursion: boolean;
  injectionTemplate: string;
  entryPlacement: AcuEntryPlacement;
}

export interface AcuSourceData {
  note: string;       // 表说明 + 逐列含义
  initNode: string;   // 初始化触发
  insertNode: string; // 新增触发
  updateNode: string; // 更新触发
  deleteNode: string; // 删除触发
  ddl: string;        // SQL 建表语句
}

export interface AcuSheet {
  uid: string;            // 稳定唯一键（= tableData 的 key）
  name: string;           // 中文表名
  single: boolean;        // 单行表？（zhushen 便利字段：ACU 靠 note/insertNode 表达，这里显式化便于引擎强制）
  sourceData: AcuSourceData;
  content: string[][];    // content[0]=表头，其后数据行
  updateConfig: AcuUpdateConfig;
  exportConfig: AcuExportConfig;
  orderNo: number;
}

export type AcuTableData = Record<string, AcuSheet>;

/** updateConfig 默认：全跟随全局。 */
const FOLLOW_GLOBAL: AcuUpdateConfig = {
  uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1,
};

/** 造一份默认 exportConfig（蓝灯常驻，按 depth=2 注入）。 */
function defExport(entryName: string, order: number): AcuExportConfig {
  return {
    enabled: false,
    splitByRow: false,
    entryName,
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '',
    entryPlacement: { position: 'at_depth_as_system', depth: 2, order },
  };
}

interface SheetDef {
  uid: string;
  name: string;
  single: boolean;
  headers: string[];        // 中文列名（不含 row_id，引擎会补）
  ddl: string;
  note: string;
  initNode?: string;
  insertNode?: string;
  updateNode?: string;
  deleteNode?: string;
  orderNo: number;
}

/** 把 SheetDef 展开成完整 AcuSheet（补 row_id 表头、triggers 默认、config 默认）。 */
function makeSheet(d: SheetDef): AcuSheet {
  const single = d.single;
  const header = ['row_id', ...d.headers];
  // 单行表预置 row_id=1 空行，使 updateRow(0,{...}) 立即可用（多行表只留表头）。
  const content: string[][] = single
    ? [header, ['1', ...d.headers.map(() => '')]]
    : [header];
  return {
    uid: d.uid,
    name: d.name,
    single,
    sourceData: {
      note: d.note,
      initNode: d.initNode ?? (single ? '游戏初始化时插入唯一一行。' : '按需插入。'),
      insertNode: d.insertNode ?? (single ? '禁止 INSERT（单行表）。' : '出现新条目时 insertRow。'),
      updateNode: d.updateNode ?? '相关状态变化时 updateRow。',
      deleteNode: d.deleteNode ?? (single ? '禁止删除。' : '条目消失/作废时 deleteRow。'),
      ddl: d.ddl,
    },
    content,
    updateConfig: { ...FOLLOW_GLOBAL },
    exportConfig: defExport(d.name.replace(/表$/, ''), 10000 + d.orderNo * 10),
    orderNo: d.orderNo,
  };
}

/** 用户自定义「AI 维护表」：把 表名/列/维护规则(note)/单行 造成一张 AcuSheet。
    · note = 固定「维护规则」——注入给填表AI 看；AI 只用 `<tableEdit>` 改**行**、改不了 note → 规则天然防篡改（正是"固定维护规则 vs 可变值"分离）。
    · content 行 = 可变值，AI 每回合据 note 维护。uid=`custom:<slug>`、orderNo≥100 排在默认表之后。
    · 非镜像表：`tableMigrate` 的 1c 投影只覆盖 MIRROR_TABLES，自定义表不被投影覆盖（与剧情记忆表同待遇）。 */
export function buildCustomSheet(opts: { name: string; headers: string[]; note: string; single?: boolean; uid?: string; orderNo?: number }): AcuSheet {
  const name = (opts.name || '自定义表').trim();
  const cols = (opts.headers ?? []).map((h) => h.trim()).filter(Boolean);
  const headers = cols.length ? cols : ['值'];
  const slug = name.replace(/[^\w一-龥]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  const uid = opts.uid || `custom:${slug}`;
  const ddl = `CREATE TABLE ${uid.replace(/[^\w]/g, '_')} ( -- ${name}（用户自定义·AI 维护）\n  row_id INTEGER PRIMARY KEY,\n${headers.map((h, i) => `  col${i + 1} TEXT -- ${h}`).join(',\n')}\n);`;
  return makeSheet({
    uid, name, single: !!opts.single, headers, ddl,
    note: (opts.note ?? '').trim() || '（用户自定义表·维护规则未填）',
    orderNo: opts.orderNo ?? 100,
  });
}

/** 是否用户自定义表（uid 前缀 `custom:`）。默认表一律 false。 */
export function isCustomSheet(sheet: { uid?: string } | undefined | null): boolean {
  return !!sheet?.uid && sheet.uid.startsWith('custom:');
}

// ── 20 张默认表（ACU 8 表模板 + zhushen 扩表/扩列）──────────────────────────

const SHEET_DEFS: SheetDef[] = [
  {
    uid: 'protagonist_info', name: '主角信息表', single: true, orderNo: 1,
    headers: ['姓名', '阶位', '等级', '职业', '称号', '身份', '种族', '性别', '所属乐园', '契约者编号', '烙印等级', '竞技场排名', '位置', '世界之源', '生物强度',
      '力量', '敏捷', '体质', '智力', '魅力', '幸运',
      '真实力量', '真实敏捷', '真实体质', '真实智力', '真实魅力', '真实幸运', '属性点', '真实属性点',
      'HP', 'HP上限', 'EP', 'EP上限', '理智', '理智上限', '状态', '外貌', '性格', '过往经历'],
    ddl: `CREATE TABLE protagonist_info ( -- 主角信息表（有且仅有一行）
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 姓名
  tier TEXT, -- 阶位
  level INTEGER, -- 等级
  profession TEXT, -- 职业
  title TEXT, -- 当前称号
  identity TEXT, -- 身份
  race TEXT, -- 种族
  gender TEXT, -- 性别
  home_paradise TEXT, -- 所属乐园（开局选定）
  contractor_id TEXT, -- 契约者编号
  brand_level TEXT, -- 烙印等级
  arena_rank TEXT, -- 竞技场排名
  location TEXT, -- 当前位置
  world_source REAL, -- 世界之源（当前任务世界累计·百分比含小数，如 6.3）
  bio_strength TEXT, -- 生物强度档（T0杂鱼~T9源初）
  str INTEGER, -- 力量（基础六维）
  agi INTEGER, -- 敏捷
  con INTEGER, -- 体质
  int INTEGER, -- 智力
  cha INTEGER, -- 魅力
  luck INTEGER, -- 幸运
  real_str INTEGER, -- 真实力量（=基础六维+真实属性点直加；四阶起六维即真实属性）
  real_agi INTEGER, -- 真实敏捷
  real_con INTEGER, -- 真实体质
  real_int INTEGER, -- 真实智力
  real_cha INTEGER, -- 真实魅力
  real_luck INTEGER, -- 真实幸运
  attr_points INTEGER, -- 属性点（加基础六维）
  real_attr_points INTEGER, -- 真实属性点（加真实属性）
  hp INTEGER, -- 当前生命
  max_hp INTEGER, -- 生命上限
  ep INTEGER, -- 当前能量
  max_ep INTEGER, -- 能量上限
  san INTEGER, -- 当前理智
  max_san INTEGER, -- 理智上限
  status_buff TEXT, -- 当前状态/Buff（长期状态 + 限时增益汇总）
  appearance TEXT, -- 外貌特征
  personality TEXT, -- 性格特点
  past_experience TEXT -- 过往经历（增量更新，≤300字，超了压缩）
);`,
    note: '记录主角核心身份与六维/状态。此表有且仅有一行（row_id=1）。基础六维=普通属性(≤99)；真实六维=基础+真实属性点直加(四阶起六维即真实属性)；HP/EP/理智忠于正文末尾状态结算。过往经历随剧情增量更新。此表由引擎从游戏 store 自动派生（1c），AI 勿手填。',
    updateNode: "由引擎每回合从 playerStore/gameStore 自动投影，AI 不手填（改主角状态走正文 <state>/character.B1.* 指令）。",
  },
  {
    uid: 'currency', name: '货币表', single: false, orderNo: 2,
    headers: ['货币名称', '数量'],
    ddl: `CREATE TABLE currency ( -- 货币表
  row_id INTEGER PRIMARY KEY, -- 行号
  currency_name TEXT NOT NULL UNIQUE, -- 货币名称（乐园币/魂币/自定义）
  amount INTEGER NOT NULL DEFAULT 0 CHECK(amount >= 0) -- 数量
);`,
    note: '主角持有的各类货币，一种一行。乐园币、魂币为基础货币，其余按世界自定义。',
  },
  {
    uid: 'inventory', name: '背包物品表', single: false, orderNo: 3,
    // 前 10 列位置固定（列索引契约，勿插队）；新字段一律追加在后。
    headers: ['物品名称', '类别', '品级', '数量', '装备槽', '已装备', '强化', '词缀', '宝石', '描述',
      '物品ID', '类型细分', '攻击防御', '耐久度', '觉醒', '镶嵌孔', '评分', '获得途径', '装备需求', '产地', '杀敌数', '简介', '外观', '备注', '标签'],
    ddl: `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 物品名称
  category TEXT, -- 类别（武器/防具/饰品/法宝/消耗品/材料…）
  grade TEXT, -- 品级（15档自定义阶梯，单一品级）
  quantity INTEGER NOT NULL DEFAULT 1, -- 数量
  slot TEXT, -- 装备槽（未装备留空）
  equipped TEXT NOT NULL DEFAULT '否' CHECK(equipped IN ('是','否')), -- 是否已装备
  enhance TEXT, -- 强化等级（+0~+16）
  affix TEXT, -- 词缀
  gems TEXT, -- 已镶嵌宝石
  description TEXT, -- 描述/效果
  item_id TEXT, -- 物品ID（I_B1_xx）
  sub_type TEXT, -- 类型细分（单手短刀/劈砍武器…）
  combat_stat TEXT, -- 攻击力/防御力数值（装备类）
  durability TEXT, -- 耐久度（如 12/25）
  awaken TEXT, -- 深渊觉醒阶数
  sockets TEXT, -- 镶嵌孔总数
  score TEXT, -- 评分
  acquisition TEXT, -- 获得途径
  requirement TEXT, -- 装备需求
  origin TEXT, -- 产地
  kill_count TEXT, -- 杀敌数量（武器类累计）
  intro TEXT, -- 简介（flavor）
  appearance TEXT, -- 外观（生图依据）
  notes TEXT, -- 备注
  tags TEXT -- 标签
);`,
    note: '主角背包与装备，一件一行（可堆叠的写数量）。品级只写单一档位。已装备的 已装备=是 并填 装备槽。装备类填 攻击防御/耐久度/装备需求；武器填 杀敌数。前 10 列位置固定（列索引契约），新字段追加在后。',
  },
  {
    uid: 'protagonist_skills', name: '技能表', single: false, orderNo: 4,
    headers: ['技能名称', '品级', '等级', '类型', '归属', '冷却', '消耗', '目标', '伤害', '层级', '属性加成', '效果', '描述', '标签', '备注'],
    ddl: `CREATE TABLE protagonist_skills ( -- 技能表
  row_id INTEGER PRIMARY KEY, -- 行号
  skill_name TEXT NOT NULL, -- 技能名称
  grade TEXT, -- 品级（7档：普通→精良→稀有→史诗→传说→奥义→极境）
  skill_level TEXT, -- 等级/阶段（Lv.1→Lv.10→Lv.EX）
  skill_type TEXT, -- 类型（主动/被动/奥义/领域/状态/光环）
  belong TEXT, -- 归属（B1=主角本体 / Cx=分身）
  cooldown TEXT, -- 冷却
  cost TEXT, -- 消耗（档位）
  target TEXT, -- 目标（单体/群体/自身/范围…）
  damage TEXT, -- 伤害（法术攻击180%/+30固定…）
  layers TEXT, -- 层级（总层数/当前层进度）
  attr_bonus TEXT, -- 属性加成（力量+5、暴击+10%…）
  effect TEXT, -- 当前激活层效果
  description TEXT, -- 描述
  tags TEXT, -- 标签（火/控制/位移/斩杀…）
  note TEXT -- 备注（寓言/评价点评）
);`,
    note: '主角掌握的技能，一门一行。品级 7 档单一标签。字段对齐技能演化固定格式（名称|等级|类型|品级|消耗|目标|效果|伤害|层级|属性加成|描述|标签）。物品附带的临时技能不进此表。',
  },
  {
    uid: 'talents', name: '天赋表', single: false, orderNo: 5,
    headers: ['天赋名称', '品级', '等级', '类型', '来源', '效果', '属性加成', '描述', '备注'],
    ddl: `CREATE TABLE talents ( -- 天赋表
  row_id INTEGER PRIMARY KEY, -- 行号
  talent_name TEXT NOT NULL, -- 天赋名称
  grade TEXT, -- 品级（D-SSS，无上限；也可"负面"）
  talent_level TEXT, -- 等级（觉醒·Lv.1 / 一阶…）
  category TEXT, -- 类型（技巧/属性/能量/特殊异能）
  source TEXT, -- 来源（血脉传承/极端考验/顿悟升华…）
  effect TEXT, -- 效果
  attr_bonus TEXT, -- 属性加成（智力+8、法强+15%…）
  description TEXT, -- 描述
  note TEXT -- 备注
);`,
    note: '主角天赋，一项一行。品级 D-SSS 无上限。字段对齐天赋演化固定格式（名称|等级|品级|效果|属性加成|描述）。',
  },
  {
    uid: 'titles', name: '称号表', single: false, orderNo: 6,
    headers: ['称号名称', '品级', '来源', '获得时间', '效果', '额外效果', '描述', '佩戴'],
    ddl: `CREATE TABLE titles ( -- 称号表
  row_id INTEGER PRIMARY KEY, -- 行号
  title_name TEXT NOT NULL, -- 称号名称
  rarity TEXT, -- 品级（颜色品质 或 D~SSS）
  source TEXT, -- 来源（如何获得）
  obtained_time TEXT, -- 获得时间
  effect TEXT, -- 效果（数值化加成/特殊效果）
  bonus_effect TEXT, -- 额外效果（合成专属·全新质变增益）
  description TEXT, -- 描述/flavor
  equipped TEXT NOT NULL DEFAULT '否' CHECK(equipped IN ('是','否')) -- 是否佩戴
);`,
    note: '主角获得的称号，一个一行。当前佩戴的 佩戴=是（一般仅一个）。字段对齐称号演化固定格式（名称|获得时间|品级|来源|效果|描述|是否装备）。',
  },
  {
    uid: 'important_characters', name: '重要角色表', single: false, orderNo: 7,
    // 前 14 列位置固定（列索引契约）；新的 NPC 标量字段追加在后。NPC 的 技能/天赋/物品 见独立明细表。
    headers: ['姓名', '关系', '好感度', '阶位', '位置', '状态', '所属势力', '力量', '敏捷', '体质', '智力', '魅力', '幸运', '描述',
      '性别', '职业', '生物强度', '年龄', '标签', '契约者编号', '烙印等级', '竞技场排名', 'HP', 'HP上限', 'EP', 'EP上限', '称呼', '背景', '外观', '动机', '短期目标', '长期目标', '内心',
      '真实力量', '真实敏捷', '真实体质', '真实智力', '真实魅力', '真实幸运'],
    ddl: `CREATE TABLE important_characters ( -- 重要角色表（NPC）
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL, -- 姓名
  relation TEXT, -- 与主角关系
  favor INTEGER, -- 好感度
  tier TEXT, -- 阶位
  location TEXT, -- 位置
  status TEXT, -- 状态（在场/离场/死亡…）
  faction TEXT, -- 所属势力
  str INTEGER, agi INTEGER, con INTEGER, int INTEGER, cha INTEGER, luck INTEGER, -- 六维
  description TEXT, -- 一句话介绍/备注
  gender TEXT, -- 性别
  profession TEXT, -- 职业
  bio_strength TEXT, -- 生物强度档
  age TEXT, -- 年龄
  npc_tag TEXT, -- 标签（契约者/土著/随从/宠物/召唤物）
  contractor_id TEXT, -- 契约者编号
  brand_level TEXT, -- 烙印等级
  arena_rank TEXT, -- 竞技场排名
  hp TEXT, -- 当前生命
  max_hp TEXT, -- 生命上限
  ep TEXT, -- 当前能量
  max_ep TEXT, -- 能量上限
  call_player TEXT, -- 对主角的称呼
  background TEXT, -- 背景
  appearance TEXT, -- 外观
  motive TEXT, -- 当前动机
  short_goal TEXT, -- 短期目标
  long_goal TEXT, -- 长期目标
  inner_thought TEXT, -- 内心想法
  real_str INTEGER, real_agi INTEGER, real_con INTEGER, real_int INTEGER, real_cha INTEGER, real_luck INTEGER -- 真实六维（基础+真实属性点直加；无直加留空）
);`,
    note: '重要 NPC，一人一行。只登记真正有名有姓的角色，勿建无名编号 NPC。离场/死亡改 状态，别删。六维=基础属性，真实六维=基础+真实属性点直加（无直加留空）。NPC 的 技能/天赋/物品 见 NPC技能表/NPC天赋表/NPC物品表（按 归属NPC 关联）。前 14 列位置固定（列索引契约）。⚠标签为「宠物/召唤物」的角色不进本表，见 宠物/召唤物表。',
  },
  {
    uid: 'pet_summons', name: '宠物/召唤物表', single: false, orderNo: 24,
    // 与「重要角色表」同构（宠物/召唤物也是完整角色·全信息对齐），仅多末列「形态」；标签固定为 宠物/召唤物。前 14 列位置与重要角色表一致。
    headers: ['姓名', '关系', '好感度', '阶位', '位置', '状态', '所属势力', '力量', '敏捷', '体质', '智力', '魅力', '幸运', '描述',
      '性别', '职业', '生物强度', '年龄', '标签', '契约者编号', '烙印等级', '竞技场排名', 'HP', 'HP上限', 'EP', 'EP上限', '称呼', '背景', '外观', '动机', '短期目标', '长期目标', '内心',
      '真实力量', '真实敏捷', '真实体质', '真实智力', '真实魅力', '真实幸运', '形态'],
    ddl: `CREATE TABLE pet_summons ( -- 宠物/召唤物表（主角豢养/召唤的角色·不自行成长）
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL, -- 姓名
  relation TEXT, -- 与主人的关系
  favor INTEGER, -- 好感度/亲密
  tier TEXT, -- 阶位（除非主人投入否则冻结）
  location TEXT, -- 位置
  status TEXT, -- 状态
  faction TEXT, -- 所属（一般随主人）
  str INTEGER, agi INTEGER, con INTEGER, int INTEGER, cha INTEGER, luck INTEGER, -- 六维
  description TEXT, -- 一句话介绍/性情
  gender TEXT, -- 性别
  profession TEXT, -- 种类/职业
  bio_strength TEXT, -- 生物强度档
  age TEXT, -- 年龄
  npc_tag TEXT, -- 标签（宠物/召唤物）
  contractor_id TEXT, -- 契约者编号（一般空）
  brand_level TEXT, -- 烙印等级（一般空）
  arena_rank TEXT, -- 竞技场排名（一般空）
  hp TEXT, -- 当前生命
  max_hp TEXT, -- 生命上限
  ep TEXT, -- 当前能量
  max_ep TEXT, -- 能量上限
  call_player TEXT, -- 对主人的称呼
  background TEXT, -- 背景/来历
  appearance TEXT, -- 外观
  motive TEXT, -- 当前动机
  short_goal TEXT, -- 短期目标
  long_goal TEXT, -- 长期目标
  inner_thought TEXT, -- 内心
  real_str INTEGER, real_agi INTEGER, real_con INTEGER, real_int INTEGER, real_cha INTEGER, real_luck INTEGER, -- 真实六维（基础+真实属性点直加；无直加留空）
  body_type TEXT -- 形态（人形/兽形/非人形；召唤物必为非人形）
);`,
    note: '主角的宠物/召唤物，一只一行（与重要角色表同构·就是标签不同）。⚠不自行成长：阶位/等级/六维默认冻结，仅当正文写明"主人的投入"（喂养/灌注/契约升级/血脉进化/并肩历练）才变。召唤物 形态 必为非人形。技能/天赋/物品 见 NPC技能表/NPC天赋表/NPC物品表（按 归属NPC 关联）。',
  },
  {
    uid: 'factions', name: '势力表', single: false, orderNo: 8,
    headers: ['势力名称', '等级', '规模', '关系', '描述'],
    ddl: `CREATE TABLE factions ( -- 势力表
  row_id INTEGER PRIMARY KEY, -- 行号
  faction_name TEXT NOT NULL UNIQUE, -- 势力名称
  level TEXT, -- 等级
  scale TEXT, -- 规模
  relation TEXT, -- 与主角关系
  description TEXT -- 描述
);`,
    note: '登场势力/组织，一个一行。',
  },
  {
    uid: 'territory', name: '领地表', single: false, orderNo: 9,
    headers: ['建筑名称', '等级', '建设进度', '描述'],
    ddl: `CREATE TABLE territory ( -- 领地表
  row_id INTEGER PRIMARY KEY, -- 行号
  building_name TEXT NOT NULL UNIQUE, -- 建筑名称
  level TEXT, -- 等级
  progress TEXT, -- 建设进度
  description TEXT -- 描述
);`,
    note: '主神空间个人领地的建筑，一栋一行。',
  },
  {
    uid: 'adventure_team', name: '冒险团表', single: false, orderNo: 10,
    headers: ['名称', '角色', '阶位', '经验', '活跃度', '说明'],
    ddl: `CREATE TABLE adventure_team ( -- 冒险团表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL UNIQUE, -- 名称（团名或成员名）
  role TEXT, -- 角色（团/团长/成员）
  tier TEXT, -- 阶位
  exp TEXT, -- 经验
  activity TEXT, -- 活跃度
  note TEXT -- 说明
);`,
    note: '冒险团信息与成员。第一行 role=团 记团本身（阶位/经验/活跃度），其余行 role=成员。',
  },
  {
    uid: 'quests_events', name: '任务与事件表', single: false, orderNo: 11,
    headers: ['任务名称', '类型', '当前进度', '奖励', '状态'],
    ddl: `CREATE TABLE quests_events ( -- 任务与事件表
  row_id INTEGER PRIMARY KEY, -- 行号
  quest_name TEXT NOT NULL UNIQUE, -- 任务名称
  quest_type TEXT CHECK(quest_type IN ('主线任务','支线任务')), -- 类型
  current_progress TEXT, -- 当前进度
  reward TEXT, -- 奖励
  status TEXT -- 状态（进行中/已完成/已失败）
);`,
    note: '当前任务世界的任务与关键事件，一条一行。完成/失败改 status。',
  },
  {
    uid: 'global_state', name: '世界状态表', single: true, orderNo: 12,
    headers: ['当前位置', '乐园时间', '世界时间', '天气', '回合数'],
    ddl: `CREATE TABLE global_state ( -- 世界状态表（有且仅有一行）
  row_id INTEGER PRIMARY KEY, -- 行号
  current_location TEXT, -- 当前位置
  paradise_time TEXT, -- 乐园时间（主神空间）
  world_time TEXT, -- 世界时间（任务世界）
  weather TEXT, -- 天气
  turn_count INTEGER -- 本存档累计回合
);`,
    note: '全局世界状态，有且仅有一行（row_id=1）。每轮更新时间/位置/天气。',
    updateNode: '每轮 updateRow(11, {...}) 刷新当前位置/时间/天气/回合数。',
  },
  {
    uid: 'chronicle', name: '纪要表', single: false, orderNo: 13,
    headers: ['时间', '地点', '事件'],
    ddl: `CREATE TABLE chronicle ( -- 纪要表（编年史·只追加）
  row_id INTEGER PRIMARY KEY, -- 行号
  time_span TEXT, -- 时间/时间跨度
  location TEXT, -- 地点
  chronicle_text TEXT NOT NULL -- 纪要（本段发生了什么）
);`,
    note: '剧情编年史，只追加不改删。每有一段完整剧情就 insertRow 记一条。',
    insertNode: '每段完整剧情后 insertRow(12, {...}) 追加一条纪要。',
    updateNode: '禁止修改历史纪要。',
    deleteNode: '禁止删除历史纪要。',
  },
  {
    uid: 'custom_vars', name: '自定义变量表', single: false, orderNo: 14,
    headers: ['变量名', '值', '类型', '说明'],
    ddl: `CREATE TABLE custom_vars ( -- 自定义变量表（作者/二创自定义）
  row_id INTEGER PRIMARY KEY, -- 行号
  var_name TEXT NOT NULL UNIQUE, -- 变量名
  var_value TEXT, -- 值
  var_type TEXT, -- 类型（number/boolean/string）
  note TEXT -- 说明
);`,
    note: '作者自定义的额外变量（好感度阈值、剧情旗标、二创专用计数等），一项一行。',
  },
  {
    uid: 'resources', name: '自定义能量条表', single: false, orderNo: 17,
    headers: ['名称', '当前值', '上限', '颜色', '说明'],
    ddl: `CREATE TABLE resources ( -- 自定义能量条表（HP/EP 外·仅主角）
  row_id INTEGER PRIMARY KEY, -- 行号
  res_name TEXT NOT NULL UNIQUE, -- 名称（怒气值/堕落值/灵力…）
  cur_value INTEGER, -- 当前值
  max_value TEXT, -- 上限（固定值或"六维公式"）
  color TEXT, -- 进度条颜色
  note TEXT -- 说明（代表什么·何时涨落）
);`,
    note: '主角在血条面板自设的 HP/EP 外资源条（怒气/堕落值/灵力/饱食度…），一条一行。仅主角有。',
  },
  {
    uid: 'subprofessions', name: '副职业表', single: false, orderNo: 15,
    headers: ['名称', '档位', '总熟练度', '大类', '配方称谓', '效果', '简介', '配方'],
    ddl: `CREATE TABLE subprofessions ( -- 副职业表（生活/制造/社交手艺）
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL UNIQUE, -- 副职业名（机械师/药剂师）
  tier TEXT, -- 总档位（新手→熟练→专家→大师→宗师）
  proficiency TEXT, -- 总熟练度（0-100）
  category TEXT, -- 大类（制造/医疗/生活/社交…）
  recipe_label TEXT, -- 配方称谓（图纸/药方/食谱…）
  effect TEXT, -- 当前能做什么/加成
  intro TEXT, -- 简介
  recipes TEXT -- 名下配方（名称汇总）
);`,
    note: '主角掌握的副职业（非战斗手艺）+ 名下配方，一门一行。档位五档：新手/熟练/专家/大师/宗师。',
  },
  {
    uid: 'achievements', name: '成就表', single: false, orderNo: 16,
    headers: ['成就名称', '分类', '类型', '稀有度', '是否隐藏', '解锁条件', '解锁时间'],
    ddl: `CREATE TABLE achievements ( -- 成就表（仅主角）
  row_id INTEGER PRIMARY KEY, -- 行号
  ach_name TEXT NOT NULL UNIQUE, -- 成就名称
  category TEXT, -- 分类（战斗/探索/任务/生存/隐藏…）
  ach_type TEXT, -- 类型（普通/累计/隐藏/阶段/特殊）
  rarity TEXT, -- 稀有度（同装备品级阶梯）
  hidden TEXT, -- 是否隐藏（是/否）
  condition TEXT, -- 解锁条件
  unlock_time TEXT -- 解锁时间
);`,
    note: '主角获得的成就，一个一行。已解锁的记 解锁时间；隐藏成就 是否隐藏=是。',
  },
  {
    uid: 'npc_items', name: 'NPC物品表', single: false, orderNo: 18,
    headers: ['归属NPC', '物品名称', '类别', '品级', '数量', '装备槽', '已装备', '攻击防御', '耐久度', '强化', '词缀', '效果', '简介', '获得途径', '备注'],
    ddl: `CREATE TABLE npc_items ( -- NPC物品表（按 归属NPC 关联到重要角色表）
  row_id INTEGER PRIMARY KEY, -- 行号
  owner_npc TEXT NOT NULL, -- 归属NPC（姓名）
  item_name TEXT NOT NULL, -- 物品名称
  category TEXT, -- 类别
  grade TEXT, -- 品级
  quantity INTEGER DEFAULT 1, -- 数量
  slot TEXT, -- 装备槽
  equipped TEXT, -- 已装备（是/否）
  combat_stat TEXT, -- 攻击防御
  durability TEXT, -- 耐久度
  enhance TEXT, -- 强化
  affix TEXT, -- 词缀
  effect TEXT, -- 效果
  intro TEXT, -- 简介
  acquisition TEXT, -- 获得途径
  notes TEXT -- 备注
);`,
    note: 'NPC 持有的物品，一件一行，按「归属NPC」关联重要角色表。NPC 装备不占主角背包。',
  },
  {
    uid: 'npc_skills', name: 'NPC技能表', single: false, orderNo: 19,
    headers: ['归属NPC', '技能名称', '品级', '等级', '类型', '冷却', '消耗', '目标', '伤害', '层级', '属性加成', '效果', '描述', '标签', '备注'],
    ddl: `CREATE TABLE npc_skills ( -- NPC技能表（按 归属NPC 关联）
  row_id INTEGER PRIMARY KEY, -- 行号
  owner_npc TEXT NOT NULL, -- 归属NPC（姓名）
  skill_name TEXT NOT NULL, -- 技能名称
  grade TEXT, -- 品级
  skill_level TEXT, -- 等级
  skill_type TEXT, -- 类型
  cooldown TEXT, -- 冷却
  cost TEXT, -- 消耗
  target TEXT, -- 目标
  damage TEXT, -- 伤害
  layers TEXT, -- 层级
  attr_bonus TEXT, -- 属性加成
  effect TEXT, -- 效果
  description TEXT, -- 描述
  tags TEXT, -- 标签
  note TEXT -- 备注
);`,
    note: 'NPC 掌握的技能，一门一行，按「归属NPC」关联重要角色表。',
  },
  {
    uid: 'npc_talents', name: 'NPC天赋表', single: false, orderNo: 20,
    headers: ['归属NPC', '天赋名称', '品级', '等级', '类型', '来源', '效果', '属性加成', '描述', '备注'],
    ddl: `CREATE TABLE npc_talents ( -- NPC天赋表（按 归属NPC 关联）
  row_id INTEGER PRIMARY KEY, -- 行号
  owner_npc TEXT NOT NULL, -- 归属NPC（姓名）
  talent_name TEXT NOT NULL, -- 天赋名称
  grade TEXT, -- 品级
  talent_level TEXT, -- 等级
  category TEXT, -- 类型
  source TEXT, -- 来源
  effect TEXT, -- 效果
  attr_bonus TEXT, -- 属性加成
  description TEXT, -- 描述
  note TEXT -- 备注
);`,
    note: 'NPC 的天赋，一项一行，按「归属NPC」关联重要角色表。',
  },
  // ── 剧情记忆表（AI 用 <tableEdit> 维护·非镜像·不被投影覆盖·跨回合记长线剧情）──
  {
    uid: 'progress', name: '进程表', single: false, orderNo: 21,
    headers: ['进程名', '类型', '当前', '目标', '状态', '触发效果', '说明'],
    ddl: `CREATE TABLE progress ( -- 进程表（长线进程·变身/觉醒/收集的进度追踪·可 update）
  row_id INTEGER PRIMARY KEY, -- 行号
  progress_name TEXT NOT NULL, -- 进程名
  progress_type TEXT, -- 类型
  current_val TEXT, -- 当前
  goal TEXT, -- 目标
  status TEXT, -- 状态
  trigger_effect TEXT, -- 触发效果
  note TEXT -- 说明
);`,
    note: '跨多回合推进的长线进程（变身进程/血脉觉醒/功法修炼/收集/堕落值/关系升温等）。新进程 insertRow 建一行；进度推进时对该行 updateRow 改「当前/状态」；当前≥目标即按「触发效果」在正文兑现并把状态改「已达成」。',
    insertNode: '出现新的长线进程时 insertRow 建一行。',
    updateNode: '进度推进时 updateRow 改「当前/状态」，别重复建同名行。',
    deleteNode: '进程彻底作废可 deleteRow；一般改状态保留可追溯。',
  },
  {
    uid: 'foreshadowing', name: '伏笔表', single: false, orderNo: 22,
    headers: ['伏笔', '埋下时间', '涉及对象', '状态', '预期回收', '说明'],
    ddl: `CREATE TABLE foreshadowing ( -- 伏笔表（剧情伏笔/悬念·埋下到回收）
  row_id INTEGER PRIMARY KEY, -- 行号
  hook TEXT NOT NULL, -- 伏笔
  planted_at TEXT, -- 埋下时间
  involved TEXT, -- 涉及对象
  status TEXT, -- 状态
  expected_payoff TEXT, -- 预期回收
  note TEXT -- 说明
);`,
    note: '埋下的伏笔/悬念/线索/隐患。埋下时 insertRow，有进展或回收时 updateRow 改状态（埋下→发展中→已回收/已废弃）。',
    insertNode: '埋下新伏笔时 insertRow。',
    updateNode: '伏笔发展/回收时 updateRow 改状态。',
  },
  {
    uid: 'pacts', name: '约定表', single: false, orderNo: 23,
    headers: ['对象', '约定内容', '立约时间', '状态', '期限', '说明'],
    ddl: `CREATE TABLE pacts ( -- 约定表（与角色的约定/誓言/协议·生效到了结）
  row_id INTEGER PRIMARY KEY, -- 行号
  counterpart TEXT NOT NULL, -- 对象
  content TEXT NOT NULL, -- 约定内容
  made_at TEXT, -- 立约时间
  status TEXT, -- 状态
  deadline TEXT, -- 期限
  note TEXT -- 说明
);`,
    note: '与角色立下的约定/誓言/协议。立约时 insertRow，兑现或破裂时 updateRow 改状态（生效→已兑现/已破裂/已过期）。',
    insertNode: '立下新约定时 insertRow。',
    updateNode: '约定兑现/破裂时 updateRow 改状态。',
  },
];

/** 造一份全新的默认表数据（深拷贝安全，供 store 初始化 / reset / 迁移播种）。 */
export function buildDefaultTables(): AcuTableData {
  const out: AcuTableData = {};
  for (const def of SHEET_DEFS) out[def.uid] = makeSheet(def);
  return out;
}

/** 默认表的 uid 列表（按 orderNo）。 */
export const DEFAULT_SHEET_UIDS: string[] = SHEET_DEFS.map((d) => d.uid);
