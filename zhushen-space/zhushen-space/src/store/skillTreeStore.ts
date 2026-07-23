import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { debouncedStorage } from '../systems/compressedStorage';   // 合并写盘：trees 含整套内置星图定义，单次写不小
import type { Skill, Trait } from './characterStore';
import { useCharacters } from './characterStore';
import { usePlayer } from './playerStore';
import { useItems } from './itemStore';
import type { AttrDelta } from '../systems/attrBonus';
import {
  canRankUp, nodeRank, validateTree, autoLayout, defaultCost,
  DEFAULT_BRANCH_COLORS, SKILLTREE_TUNING, treeAttrDelta, constellationStatus,
  isBigNode, respecMinorPoints, coinPerPP,
  expressBranchIds, ownedNameSet, nodeCostFor, growthSummary,
} from '../systems/skillTree';
import { registerTreePool } from '../systems/treePool';
import { pushGrowthNotice } from '../systems/allocNotice';   // 星图习得/精进 → 正文入戏交代（治"不知道怎么获得技能·各玩各的"）

/* 主角(或某角色)当前技能树的六维总加成（普通等值；普通节点普通点、sink 真实点 ×80）。
   供 combat/dice/bio/属性面板把它折进有效属性 base，使所有判定生效。 */
export function playerTreeAttrBonus(charId = 'B1'): AttrDelta {
  const s = useSkillTree.getState();
  const p = s.progress[charId];
  const tree = p?.activeTreeId ? s.trees[p.activeTreeId] : undefined;
  return treeAttrDelta(tree, p);
}

/* 主角技能树「成长方向」摘要（喂正文让剧情呼应；需 level/tier 判阶位 gate）。无树/无进度 → ''。 */
export function playerGrowthSummary(charId = 'B1', level = 1, tier?: string): string {
  const s = useSkillTree.getState();
  const prog = s.progress[charId];
  const tree = prog?.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
  if (!tree) return '';
  const ch = useCharacters.getState().characters['B1'];
  const expressBranches = expressBranchIds(tree, ownedNameSet(ch?.skills, ch?.traits));
  return growthSummary(tree, prog, { level, tier, expressBranches, charId });
}

/* ════════════════════════════════════════════════════════════════════════════
   职业技能树 store（drpg-skilltree）
   两半：trees=职业树模板库（配置，可导出/分享）｜progress=每角色进度（随存档重置）
   解锁结算/校验在 systems/skillTree.ts（确定性）；此处只管状态 + 写 characterStore。
   ──────────────────────────────────────────────────────────────────────────── */

export interface TreeBranch { id: string; name: string; color: string; desc?: string }

export interface NodeGrants {
  skill?: Omit<Skill, 'id' | 'addedAt'>;   // 解锁 → characterStore.addSkill('B1',…)
  trait?: Omit<Trait, 'addedAt'>;          // 解锁 → characterStore.addTrait('B1',…)
  attr?: AttrDelta;                         // 解锁 → 合成一条「潜能」被动天赋承载六维加成
  recipe?: { name: string; tier?: string; materials?: string; output?: string; desc?: string };   // 副职业树专用：解锁 → characterStore.addRecipe(tree.profession,…)（进副职业面板，不进技能/天赋栏）
}

export interface TreeNode {
  id: string;
  name: string;
  branch: string;          // 所属流派支 id（软分组：决定列位/配色）
  layer: number;           // 第几层（1 起；纵向排位 + 默认阶位 gate 参考）
  tierGate: string;        // 解锁所需最低阶位（TIERS 之一；空=不限）
  cost: number;            // 每点消耗潜能点（每个节点可点多次，每次 cost）
  prereqs: string[];       // 前置节点 id（前置 rank≥1 才可点；空=起点）
  kind: 'minor' | 'medium' | 'major' | 'capstone';  // 微星(只属性)/中型(衍生子技能)/流派核心/终极
  grants: NodeGrants;      // rank 1 时灌入技能/天赋
  maxRank?: number;        // 可点次数（豆子数），默认 3；sink 节点为大数=无上限
  ptAttr?: AttrDelta;      // 每点六维加成（线性等差）；普通节点=普通属性点；主星可用负值=代价
  realAttr?: boolean;      // ptAttr 是否按「真实属性点」(×80)；仅各线终点后的 sink 节点
  sink?: boolean;          // 无上限点数节点：每线终点后，全树点满才解锁，防后期点数溢出
  spentGate?: number;      // 节奏闸门：累计投入潜能点 ≥ 此值 才解锁（锁外环，逼先建基础）
  socket?: boolean;        // 星核镶嵌位：玩家选背包物品 → AI 生成星核 → 嵌入，半径内已点亮微星受其属性增益
  socketRadius?: number;   // 该 socket 的作用半径（画布像素，缺省用 SKILLTREE_TUNING.socketRadius）
  desc?: string;
  x?: number;              // 画布坐标（编辑器手摆；缺省 autoLayout 补）
  y?: number;
}

/* 星座：一组节点全部点亮(rank≥1)即「成型」，触发一次额外奖励（觉醒技/质变被动）*/
export interface TreeConstellation {
  id: string;
  name: string;
  nodeIds: string[];       // 组成该星座的节点 id（全部 rank≥1 即成型）
  reward: NodeGrants;      // 成型奖励（skill / trait）
  desc?: string;
}

export interface TreeDef {
  id: string;
  profession: string;      // 职业名（对 profile.profession 匹配）；副职业树里 = 副职业名（炼金术/锻造…）
  title?: string;          // 显示标题
  branches: TreeBranch[];
  nodes: TreeNode[];
  constellations?: TreeConstellation[];   // 星座成型奖励
  source: 'builtin' | 'ai' | 'manual';
  version: number;
  recipeLabel?: string;    // 副职业树专用：配方的叫法（图纸/药方/食谱/锻造图…），仅副职业树用，技能树忽略
  category?: string;       // 副职业树专用：副职业大类（制造/医疗/生活…）
  noTierGate?: boolean;    // 生成时选「不加阶位限制」：validateTree 不分配 tierGate（节点 tierGate 留空→gatePass 恒过），任意阶位都可点
  layout?: 'radial' | 'trunk';   // 布局：radial=四周放射(默认)；trunk=主干式(先一条通用主干往上，再从主干顶端分出各流派)
  userEdited?: boolean;    // 玩家改过这棵树（改名/改节点…）→ 内置树版本升级时的 re-seed 不再覆盖它（保住玩家对内置树的编辑，治"改完没保存/被还原"）
}

export interface GrantedRef { kind: 'skill' | 'trait'; name: string }

export interface CharTreeProgress {
  activeTreeId?: string;
  ranks: Record<string, number>;  // 节点 id → 当前点数(0..maxRank)
  upgrades?: Record<string, NodeGrants>;  // 大节点 rank2/3 升级后的技能/天赋（覆盖 node.grants 显示，与技能栏一致）
  constellationsGranted?: string[];  // 已发放成型奖励的星座 id（防重复发放 + 洗点回滚）
  constellationUpgrades?: Record<string, NodeGrants>;  // 星座觉醒奖励的 AI 强化版（覆盖模板 reward 显示）
  sockets?: Record<string, { itemName?: string; name?: string; effect?: string; ptAttr?: AttrDelta; radius?: number; chainNodeIds?: string[]; active?: boolean }>;  // 星核镶嵌位 id → 已嵌入的星核(+生成的链节点 id+是否激活)
  aiBonusPP: number;        // 兑换/任务/奇遇额外潜能点累计
  exchangedPP?: number;     // 累计【乐园币兑换】出的潜能点数（用于"越买越贵"递增定价，单调不减）
  spent: number;            // 已花潜能点（= Σ rank×cost）
  grantedRefs: GrantedRef[];// 本树灌出的技能/天赋名（洗点反向移除用）
}

/* 节点「当前生效的技能/天赋」= 升级覆盖优先，否则模板原始 grants（技能栏与技能树一同变动的真相源）*/
export function nodeEffectiveGrant(progress: CharTreeProgress | undefined, node: TreeNode): NodeGrants {
  return progress?.upgrades?.[node.id] ?? node.grants ?? {};
}

const newProgress = (): CharTreeProgress => ({ ranks: {}, upgrades: {}, constellationsGranted: [], constellationUpgrades: {}, sockets: {}, aiBonusPP: 0, exchangedPP: 0, spent: 0, grantedRefs: [] });

/* ── 星图组装器：core 放射 + 每臂(起始星点→中间星点→显赫节点→侧分叉)→终点后「无尽」sink。
   每节点可点 3 次(豆子)，ptAttr 按层递增(越深每点普通属性加成越多)；
   各臂终点后挂一个 sink 节点(realAttr 真实属性点·无上限·全树点满才解锁)，消化后期溢出潜能点。 */
interface StarNotable { name: string; kind: 'major' | 'capstone'; tier: string; skill?: any; trait?: any }
interface StarBranch { id: string; name: string; color: string; a: string; notables: StarNotable[] }
function assembleStar(opts: {
  id: string; profession: string; title: string; version: number;
  core: { name: string; ptAttr?: any; grants?: any; desc?: string };
  branches: StarBranch[];
}): any {
  const { branches } = opts;
  const ptByLayer = (layer: number) => 1 + Math.floor(layer / 2);   // 递增：越深每点加成越多
  const nodes: any[] = [
    { id: 'core', name: opts.core.name, branch: branches[0].id, layer: 0, kind: 'minor', cost: 0, maxRank: 1, prereqs: [], grants: opts.core.grants ?? {}, ptAttr: opts.core.ptAttr, desc: opts.core.desc },
  ];
  let c = 0; const nid = () => `n${++c}`;
  const ATTRLBL: Record<string, string> = { str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运' };
  const constellations: any[] = [];
  for (const b of branches) {
    const A = b.a;
    const s1 = nid(), s2 = nid();
    nodes.push({ id: s1, name: `${b.name}·入径`, branch: b.id, layer: 1, kind: 'minor', cost: 1, prereqs: ['core'], ptAttr: { [A]: ptByLayer(1) }, desc: `踏入${b.name}一脉。` });
    nodes.push({ id: s2, name: `${b.name}·砺`, branch: b.id, layer: 1, kind: 'minor', cost: 1, prereqs: ['core'], ptAttr: { [A]: ptByLayer(1) } });
    // 星核镶嵌位（每臂一个，嵌入星核增益半径内已点亮微星）
    nodes.push({ id: nid(), name: `${b.name}·星核位`, branch: b.id, layer: 2, kind: 'minor', cost: 0, maxRank: 1, prereqs: [s2], socket: true, desc: `${b.name}的星核镶嵌位：选背包物品炼成星核嵌入，作用半径内每颗已点亮的微星额外获得星核属性。` });
    let prev = s1, layer = 2;
    const notableIds: string[] = [];
    b.notables.forEach((nb, i) => {
      if (i > 0) {   // 显赫节点前插中间星点，拉长路径(不要太快拿到大节点)
        const mid = nid();
        nodes.push({ id: mid, name: `${b.name}·径`, branch: b.id, layer, kind: 'minor', cost: 2, prereqs: [prev], ptAttr: { [A]: ptByLayer(layer) } });
        prev = mid; layer++;
      }
      const id = nid();
      const grants = nb.skill ? { skill: nb.skill } : (nb.trait ? { trait: nb.trait } : {});
      nodes.push({ id, name: nb.name, branch: b.id, layer, kind: nb.kind, cost: nb.kind === 'capstone' ? 14 : 6, tierGate: nb.tier, prereqs: [prev], grants, ptAttr: { [A]: ptByLayer(layer) + (nb.kind === 'capstone' ? 2 : 1) }, ...(nb.kind === 'capstone' ? { spentGate: 16 } : {}) });   // 主星加节奏闸门：累计 16 点才开
      notableIds.push(id);
      if (i < b.notables.length - 1) nodes.push({ id: nid(), name: `${b.name}·星`, branch: b.id, layer, kind: 'minor', cost: 2, prereqs: [prev], ptAttr: { [A]: ptByLayer(layer) } });
      prev = id; layer++;
    });
    // 终点后：无上限真实属性 sink（需先点满全树其余节点才解锁）
    nodes.push({ id: nid(), name: `${b.name}·无尽`, branch: b.id, layer, kind: 'capstone', cost: 4, prereqs: [prev], sink: true, realAttr: true, maxRank: 999, ptAttr: { [A]: 1 }, desc: `${b.name}极致之后的无尽之径：每点投入 +1 真实属性，可无限投放潜能点（需先点满全树其余所有节点），用于消化后期溢出的潜能点。` });
    // 星座：点亮该支全部显赫节点 → 流派觉醒奖励
    if (notableIds.length >= 2) {
      constellations.push({
        id: `cst_${b.id}`, name: `${b.name}·星座`, nodeIds: notableIds,
        reward: { trait: { name: `${b.name}·星座觉醒`, level: '星座·觉醒', rarity: 'SS', category: '特殊异能类', source: `技能树·点亮「${b.name}」全线`, effect: `点亮「${b.name}」整条星座，觉醒该流派的星之印记：大幅强化${b.name}一脉全部技能的威力与施放效率。`, attrBonus: `${ATTRLBL[A] ?? '力量'}+12` } },
        desc: `点亮「${b.name}」流派的全部 ${notableIds.length} 颗显赫节点即成型。`,
      });
    }
  }
  return { id: opts.id, profession: opts.profession, title: opts.title, source: 'builtin', version: opts.version, branches: branches.map((b) => ({ id: b.id, name: b.name, color: b.color })), nodes, constellations };
}

/* ── 内置星图①：剑士·四道流派（御剑/铁卫/影杀/灵刃） ── */
function buildJianshiStar() {
  const COL = DEFAULT_BRANCH_COLORS;
  return assembleStar({
    id: 'tree_jianshi_v1', profession: '剑士', title: '剑士·星图', version: 6,
    core: { name: '武者觉醒', ptAttr: { str: 1, con: 1, agi: 1, int: 1 }, desc: '踏入武道，群星之始——免费起手。' },
    branches: [
      { id: 'yujian', name: '御剑', color: COL[0], a: 'str', notables: [
        { name: '剑气斩', kind: 'major', tier: '三阶', skill: { name: '剑气斩', level: '入门·Lv.1', rarity: '精良', skillType: '主动', target: '单体', effect: '凝气于刃，造成 120% 物理伤害', attrBonus: '力量+2' } },
        { name: '御剑飞行', kind: 'major', tier: '五阶', skill: { name: '御剑飞行', level: '小成·Lv.1', rarity: '稀有', skillType: '主动', target: '自身', effect: '身剑合一，突进并附剑气追击', attrBonus: '敏捷+3' } },
        { name: '万剑归宗', kind: 'capstone', tier: '七阶', skill: { name: '万剑归宗', level: '大成·Lv.1', rarity: '传说', skillType: '奥义', target: '群体', effect: '万剑齐发，范围 400% 物理轰击', attrBonus: '力量+6' } },
      ] },
      { id: 'tiewei', name: '铁卫', color: COL[1], a: 'con', notables: [
        { name: '铁壁', kind: 'major', tier: '三阶', trait: { name: '铁壁', rarity: 'B', category: '能量类', source: '技能树·铁卫', effect: '格挡时减伤提升', attrBonus: '体质+3' } },
        { name: '盾墙', kind: 'major', tier: '五阶', skill: { name: '盾墙', level: '小成·Lv.1', rarity: '稀有', skillType: '主动', target: '自身', effect: '架起护盾吸收伤害，持续 2 回合', attrBonus: '体质+3' } },
        { name: '不动金身', kind: 'capstone', tier: '七阶', trait: { name: '不动金身', rarity: 'S', category: '能量类', source: '技能树·铁卫', effect: '大幅提升减伤，受控时间减半', attrBonus: '体质+8' } },
      ] },
      { id: 'yingsha', name: '影杀', color: COL[2], a: 'agi', notables: [
        { name: '匿踪', kind: 'major', tier: '三阶', skill: { name: '匿踪', level: '入门·Lv.1', rarity: '精良', skillType: '主动', target: '自身', effect: '隐入暗影，下一击必暴击', attrBonus: '敏捷+2' } },
        { name: '致命背刺', kind: 'major', tier: '五阶', skill: { name: '致命背刺', level: '小成·Lv.1', rarity: '史诗', skillType: '主动', target: '单体', effect: '对未察觉目标造成 300% 物理伤害', attrBonus: '敏捷+4' } },
        { name: '影杀宗师', kind: 'capstone', tier: '七阶', trait: { name: '影杀宗师', rarity: 'S', category: '技巧类', source: '技能树·影杀', effect: '暴击率与暴击伤害大幅提升', attrBonus: '敏捷+8' } },
      ] },
      { id: 'lingjian', name: '灵刃', color: COL[3], a: 'int', notables: [
        { name: '剑识', kind: 'major', tier: '三阶', skill: { name: '剑识', level: '入门·Lv.1', rarity: '精良', skillType: '被动', target: '自身', effect: '以神识御剑，命中与法术穿透提升', attrBonus: '智力+3' } },
        { name: '剑域', kind: 'major', tier: '五阶', skill: { name: '剑域', level: '小成·Lv.1', rarity: '史诗', skillType: '领域', target: '范围', effect: '展开剑域，域内敌人持续受创、我方剑势增幅', attrBonus: '智力+4' } },
        { name: '剑心通明', kind: 'capstone', tier: '七阶', trait: { name: '剑心通明', rarity: 'S', category: '特殊异能类', source: '技能树·灵刃', effect: '剑心澄澈，免疫心神干扰，技能冷却缩减', attrBonus: '智力+8' } },
      ] },
    ],
  });
}
const BUILTIN_JIANSHI: TreeDef = autoLayout(validateTree(buildJianshiStar()).tree);

/* ── 内置星图②：灭法之影·星图（轮回乐园·苏晓主职业，据百度百科 item/灭法之影 + 原著严格构建）。
   中心「灵影体质」放射五臂：根基·灭法(青钢影/本源系统/灭法天赋) · 断魂影(单挑最强) ·
   破空影(高速穿透空间·魔刃连续斩杀) · 噬魔影(群战无敌·吞噬·魔灵) · 秘传副职。
   三进阶路线可兼修；技能/天赋效果严格照资料、不省略。 ── */
function buildMiefaStar() {
  const COL = DEFAULT_BRANCH_COLORS;
  return assembleStar({
    id: 'tree_miefa_v1', profession: '灭法之影', title: '灭法之影·星图', version: 6,
    core: {
      name: '灵影体质·觉醒', ptAttr: { str: 1, agi: 1, int: 1 },
      grants: { trait: { name: '灵影体质', level: '传承·觉醒', rarity: 'SSS', category: '特殊异能类', source: '主神空间·灭法之影传承', effect: '灭法之影传承的核心被动体质：将脑部储蓄的法力值分散到身体各处(血液、肌肉、骨骼等组织)，与身体融合形成循环，从而大幅提升生命值——生命值提升总量 = 最大法力值的一定比例：初始 30%，突破上限后 45%，最终可达 100%。亦使灭法者得以驾驭魔灵、吞噬本源、修习灭法系技能', attrBonus: '智力+2、敏捷+2' } },
      desc: '继承灭法之影传承(灵影体质)，群星之始——免费起手。',
    },
    branches: [
    { id: 'jiben', name: '根基·灭法', color: COL[1], a: 'int', notables: [
      { name: '青钢影', kind: 'major', tier: '三阶', skill: { name: '青钢影', level: '入门·Lv.1', skillType: '状态·主动', rarity: '稀有', cost: '2点法力/分钟', cooldown: '无', target: '自身', damage: '—', effect: '开启后，这股能量先途经手臂、之后蔓延到手中的【斩龙闪】上，斩龙闪表面骤然包裹一层蓝光，仔细观察还能看到细微的蓝白色电弧在跳动；持续期间每分钟消耗 2 点法力值，为【魔刃】斩杀持续供能', attrBonus: '智力+3', tags: ['增益', '雷', '蓄能'], desc: '灭法系状态技，魔刃斩杀的能量来源。' } },
      { name: '本源容器', kind: 'major', tier: '五阶', skill: { name: '本源容器', level: '小成·Lv.1', skillType: '被动·光环', rarity: '史诗', cost: '—', cooldown: '被动', target: '范围', damage: '—', effect: '灭法者可自行吸收周边 1000 米内飘散的本源能量，存入本源容器；与灭法天赋、唤醒之碑配合：击杀敌人→本源容器吸收本源能量→灭法天赋转化为魂能→魂能满转灭法技能点', attrBonus: '智力+4', tags: ['本源', '吸收'], desc: '灭法者的能量循环：本源能量系统的入口。' } },
      { name: '灭法天赋', kind: 'capstone', tier: '七阶', trait: { name: '灭法天赋', level: '觉醒·Lv.1', rarity: 'S', category: '能量类', source: '灭法之影·独有天赋(一次觉醒)', effect: '灭法之影独有天赋(S 级·一次觉醒)。主动效果：击杀敌人后，吞噬之核将吸收敌人还未消散的本源能量，转化为魂能；当魂能达到 100% 时获得 1 点灭法系技能点，于唤醒之碑处激活灭法技能点以提升灭法技能等级', attrBonus: '智力+6', desc: '灭法之影的成长引擎：本源→魂能→灭法技能点。' } },
    ] },
    { id: 'duanhun', name: '断魂影', color: COL[0], a: 'str', notables: [
      { name: '魔刃', kind: 'major', tier: '三阶', skill: { name: '魔刃', level: '核心·Lv.1', skillType: '核心·主动', rarity: '史诗', cost: '青钢影供能', cooldown: '—', target: '单体', damage: '斩杀(无视抗性/豁免/防御)', effect: '攻击生命值 25% 以下的敌方单位时，可外放出斩龙闪内的【刃之魔灵】，刃之魔灵将借助青钢影能量侵入敌人体内，对敌人造成无视抗性、豁免、防御的斩杀效果', attrBonus: '力量+4', tags: ['斩杀', '魔灵', '核心'], desc: '灭法之影的招牌斩杀，残血即死。' } },
      { name: '魂核', kind: 'major', tier: '五阶', skill: { name: '魂核', level: '小成·Lv.1', skillType: '断魂影专属·被动', rarity: '史诗', cost: '—', cooldown: '被动', target: '自身', damage: '—', effect: '断魂影路线专属的魂核能力，强化魔刃与单体作战，是断魂影「单挑最强」的根源', attrBonus: '力量+4', tags: ['魂核', '斩杀', '单挑'], desc: '断魂影流派专属，单挑最强之源。' } },
      { name: '断魂影', kind: 'capstone', tier: '七阶', skill: { name: '断魂影', level: '大成·Lv.1', skillType: '进阶路线·精通', rarity: '奥义', cost: '—', cooldown: '—', target: '单体', damage: '魔刃·魂核斩杀', effect: '灭法之影三进阶路线之一：拥有最强的魔刃能力与断魂影专属的魂核能力，单挑最强。对应主修属性：力、敏、体、意志、身体能量', attrBonus: '力量+8', tags: ['进阶路线', '斩杀', '单挑'], desc: '断魂影路线·单挑无敌。' } },
    ] },
    { id: 'pokong', name: '破空影', color: COL[2], a: 'agi', notables: [
      { name: '龙影闪', kind: 'major', tier: '三阶', skill: { name: '龙影闪', level: '入门·Lv.1', skillType: '主动·位移', rarity: '稀有', cost: '少量法力', cooldown: '短', target: '自身', damage: '—', effect: '高速穿透空间的瞬移身法，瞬间进行约 5 米的空间移动(由斩龙闪「金色」品质解锁)，可用于突进、闪避或衔接斩击', attrBonus: '敏捷+4', tags: ['位移', '穿透空间', '身法'], desc: '破空影路线的标志身法。' } },
      { name: '至尊锋刃', kind: 'major', tier: '五阶', skill: { name: '至尊锋刃', level: '小成·Lv.1', skillType: '灭法之影技能·武器', rarity: '史诗', cost: '祭献武器', cooldown: '被动', target: '自身', damage: '黑蓝色烟雾刀芒', effect: '灭法之影技能，绑定本命武器【斩龙闪】。通过祭献同品级刀类武器积累锋刃值，达标即晋升品质：白→绿→蓝→紫→暗紫→淡金→金→史诗→圣灵→永恒(评分 9250)。沿途获浴血奋战、血流如注、削铁如泥等被动；金色解锁龙影闪、史诗解锁魔刃。青影-魔刃形态外放黑蓝色烟雾刀芒', attrBonus: '力量+5', tags: ['武器', '成长', '祭献'], desc: '驱动斩龙闪祭献强化体系的灭法之影技能。' } },
      { name: '破空影', kind: 'capstone', tier: '七阶', skill: { name: '破空影', level: '大成·Lv.1', skillType: '进阶路线·精通', rarity: '奥义', cost: '—', cooldown: '—', target: '群体', damage: '连续魔刃斩杀(可叠加至100%)', effect: '灭法之影三进阶路线之一：高速穿透空间、连续斩杀流派——拥有最强的龙影闪能力与魔刃连续斩杀能力，接连多次的魔刃斩杀可叠加至 100%。对应主修属性：力、敏、体、魂、生命值', attrBonus: '敏捷+6、力量+4', tags: ['进阶路线', '连斩', '穿透空间'], desc: '破空影路线·速度最快、连斩收割。' } },
    ] },
    { id: 'shimo', name: '噬魔影', color: COL[3], a: 'int', notables: [
      { name: '吞噬之核', kind: 'major', tier: '三阶', skill: { name: '吞噬之核', level: '入门·Lv.1', skillType: '主动', rarity: '史诗', cost: '—', cooldown: '—', target: '单体', damage: '吞噬转化', effect: '吞噬敌人尚未消散的本源能量，转化为自身魂能(与灭法天赋联动)；是噬魔影路线「最强吞噬之核」的根基，越杀越强', attrBonus: '智力+4', tags: ['吞噬', '本源', '魔灵'], desc: '噬魔影流派核心。' } },
      { name: '血之兽', kind: 'major', tier: '五阶', trait: { name: '血之兽', level: '成长·觉醒', rarity: 'SSS', category: '特殊异能类', source: '苏晓觉醒·SSS级成长天赋', effect: 'SSS 级成长天赋。可生成【血之兽】，造成无视防御的伤害', attrBonus: '智力+5', desc: 'SSS 成长天赋，无视防御。' } },
      { name: '噬灵者', kind: 'major', tier: '六阶', trait: { name: '噬灵者', level: '二次觉醒', rarity: 'SSS', category: '特殊异能类', source: '天赋·二次觉醒为 SSS 级', effect: '天赋(二次觉醒为 SSS 级)。能够剥离敌人的「灵」或「魂」，以提升自身', attrBonus: '智力+5', desc: '二次觉醒 SSS，剥灵夺魂。' } },
      { name: '噬魔影', kind: 'capstone', tier: '七阶', skill: { name: '噬魔影', level: '大成·Lv.1', skillType: '进阶路线·精通', rarity: '奥义', cost: '—', cooldown: '—', target: '群体', damage: '群体魔灵斩杀', effect: '灭法之影三进阶路线之一：拥有最强的吞噬之核与魔灵系能力，所有魔灵系能力都具斩杀特性；群战无敌。对应主修属性：力、敏、体、智、生命值、身体能量', attrBonus: '智力+8', tags: ['进阶路线', '魔灵', '群战'], desc: '噬魔影路线·群战无敌。' } },
    ] },
    { id: 'mizhuan', name: '秘传·副职', color: COL[4], a: 'cha', notables: [
      { name: '炼金师', kind: 'major', tier: '三阶', trait: { name: '炼金师', level: '副职业', rarity: 'A', category: '技巧类', source: '灭法之影·副职业', effect: '灭法之影副职业之一：炼金师。通晓炼金之术', attrBonus: '智力+3', desc: '灭法者三副职之一。' } },
      { name: '封印师', kind: 'major', tier: '五阶', trait: { name: '封印师', level: '副职业', rarity: 'A', category: '特殊异能类', source: '灭法之影·副职业', effect: '灭法之影副职业之一：封印师。掌握封印之术', attrBonus: '智力+3', desc: '灭法者三副职之一。' } },
      { name: '深渊学者', kind: 'capstone', tier: '七阶', trait: { name: '深渊学者', level: '副职业', rarity: 'S', category: '特殊异能类', source: '灭法之影·副职业', effect: '灭法之影副职业之一：深渊学者。研习深渊与法则知识', attrBonus: '智力+6', desc: '灭法者三副职之一。' } },
    ] },
    ],
  });
}
const BUILTIN_MIEFA: TreeDef = autoLayout(validateTree(buildMiefaStar()).tree);

/* 所有内置星图：纳入初始 trees + 老存档 merge 升级 */
const BUILTIN_TREES: TreeDef[] = [BUILTIN_JIANSHI, BUILTIN_MIEFA];

interface SkillTreeState {
  trees: Record<string, TreeDef>;
  progress: Record<string, CharTreeProgress>;

  // 模板管理
  upsertTree: (tree: TreeDef) => void;
  removeTree: (id: string) => void;
  setActiveTree: (charId: string, treeId: string) => void;

  // 编辑器：节点/连线/分支/树信息
  addNode: (treeId: string, node: Partial<TreeNode> & { x: number; y: number }) => string | undefined;
  updateNode: (treeId: string, nodeId: string, patch: Partial<TreeNode>) => void;
  moveNode: (treeId: string, nodeId: string, x: number, y: number) => void;
  removeNode: (treeId: string, nodeId: string) => void;
  addEdge: (treeId: string, srcId: string, dstId: string) => boolean;   // src 为 dst 前置；返回是否成功（拒环）
  removeEdge: (treeId: string, srcId: string, dstId: string) => void;
  addBranch: (treeId: string, name: string) => void;
  updateBranch: (treeId: string, branchId: string, patch: Partial<TreeBranch>) => void;
  removeBranch: (treeId: string, branchId: string) => void;
  updateTreeMeta: (treeId: string, patch: Partial<Pick<TreeDef, 'profession' | 'title'>>) => void;
  relayout: (treeId: string) => void;
  // 编辑器：星座
  addConstellation: (treeId: string, c: TreeConstellation) => void;
  removeConstellation: (treeId: string, cstId: string) => void;
  updateConstellation: (treeId: string, cstId: string, patch: Partial<TreeConstellation>) => void;

  // 进度
  grantBonusPP: (charId: string, n: number) => void;
  rankUpNode: (charId: string, nodeId: string) => boolean;   // 给某节点加一点（rank0→1 灌技能，无 API）
  applyNodeUpgrade: (charId: string, nodeId: string, upd: NodeGrants) => boolean;  // 大节点 rank2/3：用 AI 升级后的技能/天赋 + 加一点（同步技能栏）
  reconcileConstellations: (charId: string) => void;   // 成型的星座发放奖励（rank 变化后调用）
  applyConstellationReward: (charId: string, cstId: string, reward: NodeGrants) => boolean;  // AI 觉醒强化某星座奖励（同步技能栏）
  embedSocket: (charId: string, socketId: string, core: import('../systems/skillTree').SocketCore) => void;  // 嵌入星核
  embedSocketChain: (charId: string, socketId: string, core: import('../systems/skillTree').SocketCore, terminal: NodeGrants) => void;  // 嵌入星核 + 生成「脉络链→终端大节点技能」
  clearSocket: (charId: string, socketId: string) => void;   // 彻底拆下星核（连带清除其生成的链节点）
  detachSocket: (charId: string, socketId: string) => void;   // 拆卸星核（加成关闭，但保留脉络链与点数，可复用）
  reactivateSocket: (charId: string, socketId: string) => void;   // 重新装回同一件物品（复活，无需 API）
  respec: (charId: string) => number;   // 洗点（仅小节点·花乐园币）；返回花掉的乐园币
  respecCoinCost: (charId: string) => number;   // 预算洗点代价（乐园币）
  exchangePP: (charId: string, count: number) => number;     // 乐园币兑换潜能点；返回实际兑换数
}

/* dst 是否能经前置链到达 target（用于拒绝制造环的连线）*/
function reaches(nodes: TreeNode[], from: string, target: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of byId.get(cur)?.prereqs ?? []) stack.push(p);
  }
  return false;
}

export const useSkillTree = create<SkillTreeState>()(
  persist(
    (set, get) => ({
      trees: Object.fromEntries(BUILTIN_TREES.map((t) => [t.id, t])),
      progress: {},

      upsertTree: (tree) => set((s) => ({ trees: { ...s.trees, [tree.id]: tree } })),

      removeTree: (id) => set((s) => {
        const trees = { ...s.trees }; delete trees[id];
        // 谁在用这棵树就解绑
        const progress = { ...s.progress };
        for (const [cid, p] of Object.entries(progress)) {
          if (p.activeTreeId === id) progress[cid] = { ...p, activeTreeId: undefined };
        }
        return { trees, progress };
      }),

      setActiveTree: (charId, treeId) => {
        set((s) => {
          const p = s.progress[charId] ?? newProgress();
          return { progress: { ...s.progress, [charId]: { ...p, activeTreeId: treeId } } };
        });
        // 以技能树的职业为准：把生效树的职业名同步到主角状态面板的职业（仅 B1·树有职业名时）
        if (charId === 'B1') {
          const prof = get().trees[treeId]?.profession?.trim();
          if (prof) usePlayer.getState().setProfile({ profession: prof });
        }
      },

      addNode: (treeId, node) => {
        const id = `N_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
        let added = false;
        set((s) => {
          const t = s.trees[treeId]; if (!t) return s;
          const kind = node.kind ?? 'minor';
          const nn: TreeNode = {
            id, name: node.name ?? '新节点', branch: node.branch ?? (t.branches[0]?.id ?? ''),
            layer: node.layer ?? 1, tierGate: node.tierGate ?? '', cost: node.cost ?? defaultCost(kind),
            prereqs: node.prereqs ?? [], kind, grants: node.grants ?? {}, desc: node.desc, x: node.x, y: node.y,
          };
          added = true;
          return { trees: { ...s.trees, [treeId]: { ...t, nodes: [...t.nodes, nn], userEdited: true } } };
        });
        return added ? id : undefined;
      },

      updateNode: (treeId, nodeId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === nodeId ? { ...n, ...patch, id: n.id } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes, userEdited: true } } };
      }),

      moveNode: (treeId, nodeId, x, y) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === nodeId ? { ...n, x, y } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes, userEdited: true } } };
      }),

      removeNode: (treeId, nodeId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.filter((n) => n.id !== nodeId)
          .map((n) => n.prereqs.includes(nodeId) ? { ...n, prereqs: n.prereqs.filter((p) => p !== nodeId) } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes, userEdited: true } } };
      }),

      addEdge: (treeId, srcId, dstId) => {
        let ok = false;
        set((s) => {
          const t = s.trees[treeId]; if (!t || srcId === dstId) return s;
          const dst = t.nodes.find((n) => n.id === dstId); if (!dst) return s;
          if (dst.prereqs.includes(srcId)) return s;            // 已存在
          if (reaches(t.nodes, srcId, dstId)) return s;          // src 已依赖 dst → 连线会成环，拒绝
          const nodes = t.nodes.map((n) => n.id === dstId ? { ...n, prereqs: [...n.prereqs, srcId] } : n);
          ok = true;
          return { trees: { ...s.trees, [treeId]: { ...t, nodes, userEdited: true } } };
        });
        return ok;
      },

      removeEdge: (treeId, srcId, dstId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const nodes = t.nodes.map((n) => n.id === dstId ? { ...n, prereqs: n.prereqs.filter((p) => p !== srcId) } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, nodes, userEdited: true } } };
      }),

      addBranch: (treeId, name) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const id = `br_${Date.now().toString(36)}`;
        const color = DEFAULT_BRANCH_COLORS[t.branches.length % DEFAULT_BRANCH_COLORS.length];
        return { trees: { ...s.trees, [treeId]: { ...t, branches: [...t.branches, { id, name: name || `流派${t.branches.length + 1}`, color }], userEdited: true } } };
      }),

      updateBranch: (treeId, branchId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const branches = t.branches.map((b) => b.id === branchId ? { ...b, ...patch, id: b.id } : b);
        return { trees: { ...s.trees, [treeId]: { ...t, branches, userEdited: true } } };
      }),

      removeBranch: (treeId, branchId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const branches = t.branches.filter((b) => b.id !== branchId);
        const fallback = branches[0]?.id ?? '';
        const nodes = t.nodes.map((n) => n.branch === branchId ? { ...n, branch: fallback } : n);
        return { trees: { ...s.trees, [treeId]: { ...t, branches, nodes, userEdited: true } } };
      }),

      updateTreeMeta: (treeId, patch) => {
        set((s) => {
          const t = s.trees[treeId]; if (!t) return s;
          return { trees: { ...s.trees, [treeId]: { ...t, ...patch, userEdited: true } } };
        });
        // 改的是主角当前生效树的职业名 → 同步到主角状态面板职业（以技能树为准）
        if (patch.profession != null && get().progress['B1']?.activeTreeId === treeId) {
          const prof = String(patch.profession).trim();
          if (prof) usePlayer.getState().setProfile({ profession: prof });
        }
      },

      relayout: (treeId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        // 清掉坐标再 autoLayout，强制重排
        const cleared = { ...t, nodes: t.nodes.map((n) => ({ ...n, x: undefined, y: undefined })) };
        return { trees: { ...s.trees, [treeId]: { ...autoLayout(cleared), userEdited: true } } };
      }),

      addConstellation: (treeId, c) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        return { trees: { ...s.trees, [treeId]: { ...t, constellations: [...(t.constellations ?? []), c], userEdited: true } } };
      }),
      removeConstellation: (treeId, cstId) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        return { trees: { ...s.trees, [treeId]: { ...t, constellations: (t.constellations ?? []).filter((c) => c.id !== cstId), userEdited: true } } };
      }),
      updateConstellation: (treeId, cstId, patch) => set((s) => {
        const t = s.trees[treeId]; if (!t) return s;
        const constellations = (t.constellations ?? []).map((c) => c.id === cstId ? { ...c, ...patch, id: c.id } : c);
        return { trees: { ...s.trees, [treeId]: { ...t, constellations, userEdited: true } } };
      }),

      grantBonusPP: (charId, n) => set((s) => {
        const p = s.progress[charId] ?? newProgress();
        return { progress: { ...s.progress, [charId]: { ...p, aiBonusPP: Math.max(0, (p.aiBonusPP ?? 0) + n) } } };
      }),

      rankUpNode: (charId, nodeId) => {
        const s = get();
        const prog = s.progress[charId] ?? newProgress();
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
        if (!tree) return false;
        const profile = usePlayer.getState().profile;
        const ch = useCharacters.getState().characters['B1'];
        const expressBranches = expressBranchIds(tree, ownedNameSet(ch?.skills, ch?.traits));   // 传承提前解锁的路线
        const ctx = { level: profile.level, tier: profile.tier, expressBranches, charId };   // charId → availablePP 走共享池（与副职业树共用潜能）
        if (!canRankUp(tree, nodeId, prog, ctx).ok) return false;
        const node = tree.nodes.find((n) => n.id === nodeId)!;
        const wasRank = nodeRank(prog, nodeId);
        const paid = nodeCostFor(node, ctx);   // express 路线全程 1 点

        // 仅 rank 0→1 时灌一次 grants（技能/天赋）；属性走 treeAttrDelta，不再合成天赋
        const refs: GrantedRef[] = [...prog.grantedRefs];
        if (wasRank === 0) {
          const treeNm = tree.title || tree.profession;
          if (node.grants?.skill) {
            const name = node.grants.skill.name || node.name;
            const sk: any = node.grants.skill;
            useCharacters.getState().addSkill('B1', { id: '', ...(node.grants.skill as any), name });
            refs.push({ kind: 'skill', name });
            pushGrowthNotice(`主角在职业星图「${treeNm}」上点亮「${node.name}」，习得技能「${name}」${sk.rarity ? `（${sk.rarity}）` : ''}${sk.skillType ? `·${sk.skillType}` : ''}。`);
          }
          if (node.grants?.trait) {
            const name = node.grants.trait.name || node.name;
            const tr: any = node.grants.trait;
            useCharacters.getState().addTrait('B1', { ...(node.grants.trait as any), name });
            refs.push({ kind: 'trait', name });
            pushGrowthNotice(`主角在职业星图「${treeNm}」上点亮「${node.name}」，觉醒天赋「${name}」${tr.rarity ? `（${tr.rarity}）` : ''}。`);
          }
        }

        set((st) => {
          const cur = st.progress[charId] ?? newProgress();
          return {
            progress: {
              ...st.progress,
              [charId]: {
                ...cur,
                activeTreeId: prog.activeTreeId,
                ranks: { ...cur.ranks, [nodeId]: nodeRank(cur, nodeId) + 1 },
                spent: (cur.spent ?? 0) + paid,
                grantedRefs: refs,
              },
            },
          };
        });
        get().reconcileConstellations(charId);   // 可能因这一点而成型 → 发奖
        return true;
      },

      // 大节点 rank2/3：把 AI 升级后的技能/天赋写回（技能栏 upsert by name + 节点 upgrades 覆盖）+ 加一点
      applyNodeUpgrade: (charId, nodeId, upd) => {
        const s = get();
        const prog = s.progress[charId] ?? newProgress();
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
        if (!tree) return false;
        const profile = usePlayer.getState().profile;
        if (!canRankUp(tree, nodeId, prog, { level: profile.level, tier: profile.tier, charId }).ok) return false;
        const node = tree.nodes.find((n) => n.id === nodeId); if (!node) return false;
        const refs: GrantedRef[] = [...prog.grantedRefs];
        if (upd.skill?.name) {
          useCharacters.getState().addSkill('B1', { id: '', ...(upd.skill as any) });   // 同名 upsert→更新技能栏
          if (!refs.some((r) => r.kind === 'skill' && r.name === upd.skill!.name)) refs.push({ kind: 'skill', name: upd.skill.name });
          pushGrowthNotice(`主角精进了技能「${upd.skill.name}」——在职业星图上钻研更深，威力更强的版本。`);
        }
        if (upd.trait?.name) {
          useCharacters.getState().addTrait('B1', { ...(upd.trait as any) });
          if (!refs.some((r) => r.kind === 'trait' && r.name === upd.trait!.name)) refs.push({ kind: 'trait', name: upd.trait.name });
          pushGrowthNotice(`主角精进了天赋「${upd.trait.name}」——星图钻研更深，觉醒更强的版本。`);
        }
        set((st) => {
          const cur = st.progress[charId] ?? newProgress();
          return {
            progress: {
              ...st.progress,
              [charId]: {
                ...cur,
                activeTreeId: prog.activeTreeId,
                ranks: { ...cur.ranks, [nodeId]: nodeRank(cur, nodeId) + 1 },
                upgrades: { ...(cur.upgrades ?? {}), [nodeId]: upd },
                spent: (cur.spent ?? 0) + (node.cost ?? 0),
                grantedRefs: refs,
              },
            },
          };
        });
        get().reconcileConstellations(charId);
        return true;
      },

      // 成型星座发奖：所有 nodeIds rank≥1 且未发过 → 灌入 reward 技能/天赋（同名 upsert）+ 标记 + 记 ref（洗点回滚）
      reconcileConstellations: (charId) => {
        const s = get();
        const prog = s.progress[charId]; if (!prog) return;
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined; if (!tree) return;
        const granted = new Set(prog.constellationsGranted ?? []);
        const newlyDone = constellationStatus(tree, prog).filter((c) => c.complete && !granted.has(c.id));
        if (!newlyDone.length) return;
        const refs: GrantedRef[] = [...prog.grantedRefs];
        for (const c of newlyDone) {
          const rw = c.reward ?? {};
          if (rw.skill?.name) { useCharacters.getState().addSkill('B1', { id: '', ...(rw.skill as any) }); if (!refs.some((r) => r.kind === 'skill' && r.name === rw.skill.name)) refs.push({ kind: 'skill', name: rw.skill.name }); }
          if (rw.trait?.name) { useCharacters.getState().addTrait('B1', { ...(rw.trait as any) }); if (!refs.some((r) => r.kind === 'trait' && r.name === rw.trait.name)) refs.push({ kind: 'trait', name: rw.trait.name }); }
          granted.add(c.id);
        }
        set((st) => {
          const cur = st.progress[charId] ?? newProgress();
          return { progress: { ...st.progress, [charId]: { ...cur, constellationsGranted: [...granted], grantedRefs: refs } } };
        });
      },

      // AI 觉醒：把某星座的奖励强化版写回（技能栏同名 upsert + 星座 reward 覆盖）。不改 rank/点数。
      applyConstellationReward: (charId, cstId, reward) => {
        const s = get();
        const prog = s.progress[charId]; if (!prog) return false;
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined; if (!tree) return false;
        const cst = (tree.constellations ?? []).find((c) => c.id === cstId); if (!cst) return false;
        if (!constellationStatus(tree, prog).find((c) => c.id === cstId)?.complete) return false;   // 仅成型星座可觉醒
        const refs: GrantedRef[] = [...prog.grantedRefs];
        if (reward.skill?.name) { useCharacters.getState().addSkill('B1', { id: '', ...(reward.skill as any) }); if (!refs.some((r) => r.kind === 'skill' && r.name === reward.skill!.name)) refs.push({ kind: 'skill', name: reward.skill.name }); }
        if (reward.trait?.name) { useCharacters.getState().addTrait('B1', { ...(reward.trait as any) }); if (!refs.some((r) => r.kind === 'trait' && r.name === reward.trait!.name)) refs.push({ kind: 'trait', name: reward.trait.name }); }
        set((st) => { const cur = st.progress[charId] ?? newProgress(); return { progress: { ...st.progress, [charId]: { ...cur, constellationUpgrades: { ...(cur.constellationUpgrades ?? {}), [cstId]: reward }, grantedRefs: refs } } }; });
        return true;
      },

      // 星核镶嵌：嵌入（core 由 AI 据背包物品生成）；六维加成经 treeAttrDelta 自动入所有判定
      embedSocket: (charId, socketId, core) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        return { progress: { ...st.progress, [charId]: { ...cur, sockets: { ...(cur.sockets ?? {}), [socketId]: { ...core, active: true } } } } };
      }),

      // 嵌入星核 + 据物品生成的【终端大节点技能/天赋】，从星核往外排出一条「脉络链」(2 微星 → 1 大节点技能)。
      // 重新炼核会替换旧链；节点直接落进当前激活树(模板)，刷新仍在(merge 不动同版本树)。
      embedSocketChain: (charId, socketId, core, terminal) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        const treeId = cur.activeTreeId; const tree = treeId ? st.trees[treeId] : undefined;
        if (!tree || !treeId) return st;
        const socket = tree.nodes.find((n) => n.id === socketId); if (!socket) return st;
        const prevSocket = cur.sockets?.[socketId];
        // 同一件物品重新安装 → 保留原脉络链(连同已点点数)，仅刷新核 + 重新激活，不重生成（省 API、不丢进度）
        if (prevSocket?.itemName && core?.itemName && prevSocket.itemName === core.itemName && prevSocket.chainNodeIds?.length) {
          const merged = { ...prevSocket, ...core, chainNodeIds: prevSocket.chainNodeIds, active: true };
          return { progress: { ...st.progress, [charId]: { ...cur, sockets: { ...(cur.sockets ?? {}), [socketId]: merged } } } };
        }
        // 否则（新物品 / 无旧链）：清掉旧链（老链消失）再生成新链
        const oldChain = prevSocket?.chainNodeIds ?? [];
        let nodes = tree.nodes.filter((n) => !oldChain.includes(n.id))
          .map((n) => (n.prereqs ?? []).some((p) => oldChain.includes(p)) ? { ...n, prereqs: (n.prereqs ?? []).filter((p) => !oldChain.includes(p)) } : n);
        const ranks = { ...cur.ranks }; for (const id of oldChain) delete ranks[id];
        // 位置：从星图中心朝星核方向往外排
        const xs = nodes.map((n) => n.x ?? 0), ys = nodes.map((n) => n.y ?? 0);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        let dx = (socket.x ?? 0) - cx, dy = (socket.y ?? 0) - cy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const STEP = 130, baseLayer = socket.layer ?? 2, bid = socket.branch || tree.branches[0]?.id || '';
        const ATTR = ['str', 'agi', 'con', 'int', 'cha', 'luck'] as const;
        const kk = ATTR.reduce((a, k) => Math.abs(Number((core?.ptAttr as any)?.[k] ?? 0)) > Math.abs(Number((core?.ptAttr as any)?.[a] ?? 0)) ? k : a, 'str' as typeof ATTR[number]);
        const mAttr = { [kk]: 2 } as any, bAttr = { [kk]: 3 } as any;
        const uid = () => `SC_${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
        const id1 = uid(), id2 = uid(), id3 = uid();
        const at = (k: number) => ({ x: Math.round((socket.x ?? 0) + dx * STEP * k), y: Math.round((socket.y ?? 0) + dy * STEP * k) });
        const coreName = core?.name || '星核';
        const termName = terminal?.skill?.name || terminal?.trait?.name || `${coreName}·觉醒`;
        const chain: TreeNode[] = [
          { id: id1, name: `${coreName}·脉一`, branch: bid, layer: baseLayer + 1, tierGate: '', cost: 1, prereqs: [socketId], kind: 'minor', grants: {}, ptAttr: mAttr, ...at(1), desc: '星核引出的能量脉络。' },
          { id: id2, name: `${coreName}·脉二`, branch: bid, layer: baseLayer + 2, tierGate: '', cost: 1, prereqs: [id1], kind: 'minor', grants: {}, ptAttr: mAttr, ...at(2), desc: '星核能量沿脉络汇聚。' },
          { id: id3, name: termName, branch: bid, layer: baseLayer + 3, tierGate: '', cost: 6, prereqs: [id2], kind: 'major', grants: terminal || {}, ptAttr: bAttr, ...at(3), desc: '星核脉络的终端·大节点技能，解锁即入技能/天赋栏。' },
        ];
        nodes = [...nodes, ...chain];
        const newCore = { ...core, chainNodeIds: [id1, id2, id3], active: true };
        return {
          trees: { ...st.trees, [treeId]: { ...tree, nodes } },
          progress: { ...st.progress, [charId]: { ...cur, ranks, sockets: { ...(cur.sockets ?? {}), [socketId]: newCore } } },
        };
      }),

      clearSocket: (charId, socketId) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        const chain = cur.sockets?.[socketId]?.chainNodeIds ?? [];
        const sockets = { ...(cur.sockets ?? {}) }; delete sockets[socketId];
        const treeId = cur.activeTreeId;
        if (chain.length && treeId && st.trees[treeId]) {
          const t = st.trees[treeId];
          const nodes = t.nodes.filter((n) => !chain.includes(n.id))
            .map((n) => (n.prereqs ?? []).some((p) => chain.includes(p)) ? { ...n, prereqs: (n.prereqs ?? []).filter((p) => !chain.includes(p)) } : n);
          const ranks = { ...cur.ranks }; for (const id of chain) delete ranks[id];
          return { trees: { ...st.trees, [treeId]: { ...t, nodes } }, progress: { ...st.progress, [charId]: { ...cur, ranks, sockets } } };
        }
        return { progress: { ...st.progress, [charId]: { ...cur, sockets } } };
      }),

      // 拆卸星核：关掉其加成(active=false)，但**保留脉络链与已点点数**——同一件物品重新装回即复用，新物品才替换。
      detachSocket: (charId, socketId) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        const core = cur.sockets?.[socketId]; if (!core) return st;
        return { progress: { ...st.progress, [charId]: { ...cur, sockets: { ...(cur.sockets ?? {}), [socketId]: { ...core, active: false } } } } };
      }),
      // 重新装回同一件物品：直接复活(无 API、保留原链)。
      reactivateSocket: (charId, socketId) => set((st) => {
        const cur = st.progress[charId] ?? newProgress();
        const core = cur.sockets?.[socketId]; if (!core) return st;
        return { progress: { ...st.progress, [charId]: { ...cur, sockets: { ...(cur.sockets ?? {}), [socketId]: { ...core, active: true } } } } };
      }),

      // 洗点：仅退还「小节点」(非大节点)的点数，花乐园币为代价；大节点/技能/天赋/升级/星座奖励全保留。返回花掉的乐园币。
      respecCoinCost: (charId) => {
        const s = get();
        const prog = s.progress[charId]; if (!prog) return 0;
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined;
        return respecMinorPoints(tree, prog) * SKILLTREE_TUNING.respecCoinPerPoint;
      },
      respec: (charId) => {
        const s = get();
        const prog = s.progress[charId]; if (!prog) return 0;
        const tree = prog.activeTreeId ? s.trees[prog.activeTreeId] : undefined; if (!tree) return 0;
        const cost = respecMinorPoints(tree, prog) * SKILLTREE_TUNING.respecCoinPerPoint;
        const have = useItems.getState().currency['乐园币'] || 0;
        if (cost > have) return -1;   // 乐园币不足（UI 也会拦）
        if (cost > 0) useItems.getState().adjustCurrency('乐园币', -cost, '技能树·洗点');
        // 只清非大节点的 rank；大节点保留
        const newRanks: Record<string, number> = {};
        let bigSpent = 0;
        for (const [id, r] of Object.entries(prog.ranks)) {
          const n = tree.nodes.find((x) => x.id === id);
          if (isBigNode(n)) { newRanks[id] = r; bigSpent += r * (n?.cost ?? 0); }
        }
        set((st) => { const cur = st.progress[charId] ?? newProgress(); return { progress: { ...st.progress, [charId]: { ...cur, ranks: newRanks, spent: bigSpent } } }; });
        return cost;
      },

      // 乐园币兑换潜能点：单价 = 阶位基础价(coinPerPP) × ppCoinStep^已兑换数（越买越贵，逐点递增）；返回实际兑换数
      exchangePP: (charId, count) => {
        const want = Math.max(0, Math.floor(count));
        if (!want) return 0;
        const prof = usePlayer.getState().profile;
        const base = coinPerPP(prof.tier, prof.level);
        const bought = get().progress[charId]?.exchangedPP ?? 0;
        const have = useItems.getState().currency['乐园币'] || 0;
        let got = 0, cost = 0;
        for (let i = 0; i < want; i++) {
          const price = Math.max(1, Math.round(base * Math.pow(SKILLTREE_TUNING.ppCoinStep, bought + got)));
          if (have - cost < price) break;   // 钱不够，停在能买到的数量
          cost += price; got++;
        }
        if (got <= 0) return 0;
        useItems.getState().adjustCurrency('乐园币', -cost, `技能树·兑换潜能点 ×${got}`);
        set((st) => {
          const p = st.progress[charId] ?? newProgress();
          return { progress: { ...st.progress, [charId]: { ...p, aiBonusPP: (p.aiBonusPP ?? 0) + got, exchangedPP: (p.exchangedPP ?? 0) + got } } };
        });
        return got;
      },
    }),
    {
      name: 'drpg-skilltree',
      storage: debouncedStorage(),   // 合并写盘（300ms）：底层仍是裸 JSON 同一格式，切换零迁移
      partialize: (s) => ({ trees: s.trees, progress: s.progress }),
      // 内置树版本升级：把老存档里的旧内置树替换为最新星图（保留用户自建树与解锁进度）
      // 用 TreeDef.version 自判，不动 persist 顶层 version（避免无 migrate 时的迁移告警）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<SkillTreeState, 'trees' | 'progress'>>;
        const trees: Record<string, TreeDef> = { ...(p.trees ?? {}) };
        for (const bt of BUILTIN_TREES) {   // 缺失则补入、旧版本则升级（保留用户自建树与解锁进度）
          const old = trees[bt.id];
          if (!old || (!old.userEdited && (old.version ?? 0) < bt.version)) trees[bt.id] = bt;   // 玩家改过的内置树(userEdited)不被版本升级覆盖 → 保住编辑
        }
        // 进度迁移：旧档 progress.* 用 unlockedNodeIds[]，新模型用 ranks{}；把旧解锁记为 rank 1
        const progress: Record<string, CharTreeProgress> = {};
        for (const [cid, raw] of Object.entries((p.progress ?? {}) as Record<string, any>)) {
          if (raw && !raw.ranks && Array.isArray(raw.unlockedNodeIds)) {
            const ranks: Record<string, number> = {};
            for (const id of raw.unlockedNodeIds) ranks[id] = 1;
            progress[cid] = { activeTreeId: raw.activeTreeId, ranks, upgrades: {}, constellationsGranted: [], aiBonusPP: raw.aiBonusPP ?? 0, spent: raw.spent ?? 0, grantedRefs: raw.grantedRefs ?? [] };
          } else {
            progress[cid] = { activeTreeId: raw?.activeTreeId, ranks: raw?.ranks ?? {}, upgrades: raw?.upgrades ?? {}, constellationsGranted: raw?.constellationsGranted ?? [], constellationUpgrades: raw?.constellationUpgrades ?? {}, sockets: raw?.sockets ?? {}, aiBonusPP: raw?.aiBonusPP ?? 0, spent: raw?.spent ?? 0, grantedRefs: raw?.grantedRefs ?? [] };
          }
        }
        return { ...current, trees, progress };
      },
    },
  ),
);

// 共享潜能池：把「技能树已花/额外潜能点」登记进 treePool，与副职业树合并计算可用潜能（任一棵点点，另一棵同步减少）
registerTreePool((charId) => {
  const p = useSkillTree.getState().progress[charId];
  return { spent: p?.spent ?? 0, bonus: p?.aiBonusPP ?? 0 };
});
