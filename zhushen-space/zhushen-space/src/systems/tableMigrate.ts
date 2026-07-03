/* 表格数据库 · 迁移 + 1c 投影：把现有游戏 store 的值写进表。
   覆盖**全部 13 张镜像表**：主角信息 / 世界状态 / 货币 / 背包 / 重要角色(NPC) / 技能 / 天赋 / 称号 / 势力 / 领地 / 冒险团 / 任务 / 自定义变量。
   （唯一不覆盖=`纪要表`编年史，那是表原生只追加日志·由 AI `<tableEdit>` 填。）

   两个出口，共享同一批**纯 builder**（读 store → 行对象，不写表，无重复映射）：
   · migrateStoresToTables({overwrite}) —— 手动/开局播种。overwrite=false 只填**当前为空**的表（安全）；true 清空重灌。逐行写（手动低频，OK）。
   · projectStoresToTables() —— **1c 每回合投影**（store=单一真相·表=只读投影）：stateApply 在 store 更新后每回合调，
       多行表走 `replaceRows`（一表一次 set·高性能），单行表走 `updateRow(0)`。
       单一写入方=store，AI 若 `<tableEdit>` 填了镜像表也会被覆盖 → **表↔store 漂移从构造上不可能**。
   映射 best-effort，未知/复杂列（六维NPC/词缀/宝石等）留空。设计文档 §6 / 1c。 */
import { useTables, rowsToContent } from '../store/tableStore';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { useCharacters } from '../store/characterStore';   // 技能/天赋/称号（主角 B1）
import { useFaction } from '../store/factionStore';         // 势力
import { useTerritory } from '../store/territoryStore';     // 领地建筑
import { useTeam } from '../store/adventureTeamStore';      // 冒险团
import { useVariables } from '../store/variableStore';      // 自定义变量
import { useResource } from '../store/resourceStore';       // 自定义能量条

export interface MigrateResult { seeded: string[]; }

type Row = Record<string, string>;
const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ── 纯 builder：读 store → 行对象（列名为键）。单行表返回 Row|null（null=数据不足·保留现状不覆盖）；多行表返回 Row[] ──

/** 「真实六维」单元格（主角/NPC 共用）：仅当有真实属性点直加(realAttrs>0)才显示 基础+直加；无直加→留空（否则与基础六维数值重复）。 */
function realAttrCell(p: any, k: string): string {
  const add = Number(p?.realAttrs?.[k] ?? 0);
  return add > 0 ? String(Number(p?.attrs?.[k] ?? 0) + add) : '';
}

function buildProtagonist(): Row | null {
  const p: any = usePlayer.getState().profile;
  const g: any = useGame.getState().player;
  if (!p || !p.name) return null;   // 还没主角名 → 不覆盖单行
  return {
    姓名: S(p.name), 阶位: S(p.tier), 等级: S(p.level), 职业: S(p.profession), 称号: S(p.title), 身份: S(p.identity),
    种族: S(p.race), 性别: S(p.gender), 所属乐园: S(p.homeParadise), 契约者编号: S(p.contractorId), 烙印等级: S(p.brandLevel), 竞技场排名: S(p.arenaRank),
    位置: S(p.location), 世界之源: S(p.worldSource), 生物强度: S(p.bioStrength),
    力量: S(p.attrs?.str), 敏捷: S(p.attrs?.agi), 体质: S(p.attrs?.con), 智力: S(p.attrs?.int), 魅力: S(p.attrs?.cha), 幸运: S(p.attrs?.luck),
    真实力量: realAttrCell(p, 'str'), 真实敏捷: realAttrCell(p, 'agi'), 真实体质: realAttrCell(p, 'con'),
    真实智力: realAttrCell(p, 'int'), 真实魅力: realAttrCell(p, 'cha'), 真实幸运: realAttrCell(p, 'luck'),
    属性点: S(p.attrPoints), 真实属性点: S(p.realAttrPoints),
    HP: S(g?.hp), HP上限: S(g?.maxHp), EP: S(g?.mp), EP上限: S(g?.maxMp), 理智: S(g?.san), 理智上限: S(g?.maxSan),
    状态: [S(p.status), ...(Array.isArray(p.statusEffects) ? p.statusEffects.map((e: any) => S(e?.name)) : [])].filter(Boolean).join(' ｜ '),
    外貌: S(p.appearance), 性格: S(p.personality),
  };
}

function buildGlobalState(): Row {
  const m: any = useMisc.getState();
  const p: any = usePlayer.getState().profile;
  return { 当前位置: S(p?.location), 乐园时间: S(m.paradiseTime), 世界时间: S(m.worldTime), 天气: S(m.weather), 回合数: S(m.turnCount) };
}

function buildCurrency(): Row[] {
  const cur: Record<string, number> = (useItems.getState() as any).currency ?? {};
  return Object.entries(cur).filter(([name]) => !!name).map(([name, amt]) => ({ 货币名称: S(name), 数量: S(amt) }));
}

function buildInventory(): Row[] {
  const items: any[] = (useItems.getState() as any).items ?? [];
  return items.filter((it) => it?.name).map((it) => ({
    物品ID: S(it.id), 物品名称: S(it.name), 类别: S(it.category), 类型细分: S(it.subType), 品级: S(it.gradeDesc),
    数量: S(it.quantity ?? 1), 装备槽: S(it.equipSlot), 已装备: it.equipped ? '是' : '否',
    攻击防御: S(it.combatStat), 耐久度: S(it.durability), 强化: it.enhanceLevel ? `+${it.enhanceLevel}` : '', 觉醒: S(it.awakenLv),
    词缀: S(it.affix), 宝石: Array.isArray(it.gems) ? it.gems.map((g: any) => S(g?.name)).filter(Boolean).join('、') : '', 镶嵌孔: S(it.sockets),
    评分: S(it.score), 获得途径: S(it.acquisition), 装备需求: S(it.requirement), 产地: S(it.origin), 杀敌数: S(it.killCount),
    描述: S(it.effect), 简介: S(it.intro), 外观: S(it.appearance), 备注: S(it.notes),
    标签: Array.isArray(it.tags) ? it.tags.join('、') : S(it.tags),
  }));
}

/** 真名 NPC（非无名/编号/死亡）—— 重要角色表 + NPC 明细表共用的筛选。 */
function realNpcs(): any[] {
  return Object.values((useNpc.getState() as any).npcs ?? {}).filter((npc: any) => npc?.name && npc.name !== npc.id && !npc.isDead);
}

function buildImportantChars(): Row[] {
  return realNpcs().map((npc) => ({
    姓名: S(npc.name), 关系: S(npc.relations), 好感度: S(npc.favor), 阶位: S(npc.realm),
    状态: S(npc.status), 所属势力: S(npc.affiliatedTeam),
    力量: S(npc.attrs?.str), 敏捷: S(npc.attrs?.agi), 体质: S(npc.attrs?.con),
    智力: S(npc.attrs?.int), 魅力: S(npc.attrs?.cha), 幸运: S(npc.attrs?.luck),
    描述: S(npc.personality),
    性别: S(npc.gender), 职业: S(npc.profession), 生物强度: S(npc.bioStrength), 年龄: S(npc.age), 标签: S(npc.npcTag),
    契约者编号: S(npc.contractorId), 烙印等级: S(npc.brandLevel), 竞技场排名: S(npc.arenaRank),
    HP: S(npc.hp), HP上限: S(npc.maxHp), EP: S(npc.mp), EP上限: S(npc.maxMp),
    称呼: S(npc.callPlayer), 背景: S(npc.background), 外观: S(npc.appearance5 || npc.appearanceDetail || npc.baseAppearance),
    动机: S(npc.motiveNow), 短期目标: S(npc.shortGoal), 长期目标: S(npc.longGoal), 内心: S(npc.innerThought),
    真实力量: realAttrCell(npc, 'str'), 真实敏捷: realAttrCell(npc, 'agi'), 真实体质: realAttrCell(npc, 'con'),
    真实智力: realAttrCell(npc, 'int'), 真实魅力: realAttrCell(npc, 'cha'), 真实幸运: realAttrCell(npc, 'luck'),
  }));
}

/** NPC 明细：物品（npcStore.npcs[id].items）/ 技能·天赋（characterStore.characters[id]），按 归属NPC=姓名 关联。 */
function buildNpcItems(): Row[] {
  const rows: Row[] = [];
  for (const npc of realNpcs()) {
    for (const it of (npc.items ?? [])) {
      if (!it?.name) continue;
      rows.push({
        归属NPC: S(npc.name), 物品名称: S(it.name), 类别: S(it.category), 品级: S(it.gradeDesc), 数量: S(it.quantity ?? 1),
        装备槽: S(it.equipSlot), 已装备: it.equipped ? '是' : '否', 攻击防御: S(it.combatStat), 耐久度: S(it.durability),
        强化: it.enhanceLevel ? `+${it.enhanceLevel}` : '', 词缀: S(it.affix), 效果: S(it.effect), 简介: S(it.intro),
        获得途径: S(it.acquisition), 备注: S(it.notes),
      });
    }
  }
  return rows;
}

function buildNpcSkills(): Row[] {
  const rows: Row[] = [];
  const chars: any = (useCharacters.getState() as any).characters ?? {};
  for (const npc of realNpcs()) {
    for (const sk of (chars[npc.id]?.skills ?? [])) {
      if (!sk?.name) continue;
      rows.push({
        归属NPC: S(npc.name), 技能名称: S(sk.name), 品级: S(sk.rarity), 等级: S(sk.level), 类型: S(sk.skillType),
        冷却: S(sk.cooldown), 消耗: S(sk.cost), 目标: S(sk.target), 伤害: S(sk.damage),
        层级: [S(sk.layers), S(sk.layerProgress)].filter(Boolean).join(' · '), 属性加成: S(sk.attrBonus),
        效果: S(sk.effect || sk.desc), 描述: S(sk.desc), 标签: Array.isArray(sk.tags) ? sk.tags.join('、') : S(sk.tags), 备注: S(sk.note),
      });
    }
  }
  return rows;
}

function buildNpcTalents(): Row[] {
  const rows: Row[] = [];
  const chars: any = (useCharacters.getState() as any).characters ?? {};
  for (const npc of realNpcs()) {
    for (const tr of (chars[npc.id]?.traits ?? [])) {
      if (!tr?.name) continue;
      rows.push({
        归属NPC: S(npc.name), 天赋名称: S(tr.name), 品级: S(tr.rarity), 等级: S(tr.level), 类型: S(tr.category),
        来源: S(tr.source), 效果: S(tr.effect), 属性加成: S(tr.attrBonus), 描述: S(tr.desc), 备注: S(tr.note),
      });
    }
  }
  return rows;
}

/** 主角本体 B1 的角色数据（技能/天赋/称号来源）。 */
function b1(): any { return (useCharacters.getState() as any).characters?.['B1']; }

function buildSkills(): Row[] {
  return (b1()?.skills ?? []).filter((sk: any) => sk?.name).map((sk: any) => ({
    技能名称: S(sk.name), 品级: S(sk.rarity), 等级: S(sk.level), 类型: S(sk.skillType), 归属: 'B1',
    冷却: S(sk.cooldown), 消耗: S(sk.cost), 目标: S(sk.target), 伤害: S(sk.damage),
    层级: [S(sk.layers), S(sk.layerProgress)].filter(Boolean).join(' · '), 属性加成: S(sk.attrBonus),
    效果: S(sk.effect || sk.desc), 描述: S(sk.desc), 标签: Array.isArray(sk.tags) ? sk.tags.join('、') : S(sk.tags), 备注: S(sk.note),
  }));
}

function buildTalents(): Row[] {
  return (b1()?.traits ?? []).filter((tr: any) => tr?.name).map((tr: any) => ({
    天赋名称: S(tr.name), 品级: S(tr.rarity), 等级: S(tr.level), 类型: S(tr.category), 来源: S(tr.source),
    效果: S(tr.effect), 属性加成: S(tr.attrBonus), 描述: S(tr.desc), 备注: S(tr.note),
  }));
}

function buildTitles(): Row[] {
  return (b1()?.titles ?? []).filter((ti: any) => ti?.name).map((ti: any) => ({
    称号名称: S(ti.name), 品级: S(ti.rarity), 来源: S(ti.source), 获得时间: S(ti.obtainedTime),
    效果: S(ti.effect), 额外效果: S(ti.bonusEffect), 描述: S(ti.desc), 佩戴: ti.equipped ? '是' : '否',
  }));
}

function buildFactions(): Row[] {
  const fs: any[] = Object.values((useFaction.getState() as any).factions ?? {});
  return fs.filter((f) => f?.name && !f.isDestroyed).map((f) => ({
    势力名称: S(f.name), 等级: S(f.powerLevel), 规模: S(f.scale),
    关系: S(f.relations || f.favorToPlayer), 描述: S(f.goal || f.background),
  }));
}

function buildTerritory(): Row[] {
  const bs: any[] = (useTerritory.getState() as any).buildings ?? [];
  return bs.filter((b) => b?.name).map((b) => ({
    建筑名称: S(b.name), 等级: S(b.level), 建设进度: '', 描述: S(b.effect || b.description),
  }));
}

function buildTeam(): Row[] {
  const team: any = useTeam.getState();
  if (!team?.established || !team.name) return [];
  const rows: Row[] = [{
    名称: S(team.name), 角色: '团', 阶位: S(team.rank), 经验: S(team.teamExp), 活跃度: S(team.activity),
    说明: team.leaderName ? `团长：${S(team.leaderName)}` : '',
  }];
  for (const m of (team.members ?? [])) {
    if (!m?.name && !m?.id) continue;
    rows.push({ 名称: S(m.name || m.id), 角色: S(m.role || '成员'), 阶位: S(m.tier), 说明: S(m.note) });
  }
  return rows;
}

function buildQuests(): Row[] {
  const tasks: any[] = (useMisc.getState() as any).tasks ?? [];
  return tasks.filter((q) => q?.name).map((q) => ({
    任务名称: S(q.name), 类型: q.kind === '主线' ? '主线任务' : '支线任务',
    当前进度: S(q.progress || q.status), 奖励: S(q.reward), 状态: S(q.status),
  }));
}

function buildCustomVars(): Row[] {
  const vars: any[] = (useVariables.getState() as any).variables ?? [];
  return vars.filter((v) => v?.key).map((v) => ({
    变量名: S(v.label || v.key), 值: S(v.value), 类型: S(v.type), 说明: S(v.desc),
  }));
}

function buildSubprofessions(): Row[] {
  return (b1()?.subProfessions ?? []).filter((sp: any) => sp?.name).map((sp: any) => ({
    名称: S(sp.name), 档位: S(sp.tier), 总熟练度: S(sp.progress), 大类: S(sp.category),
    配方称谓: S(sp.recipeLabel), 效果: S(sp.effect), 简介: S(sp.desc),
    配方: Array.isArray(sp.recipes) ? sp.recipes.map((r: any) => S(r?.name)).filter(Boolean).join('、') : '',
  }));
}

function buildAchievements(): Row[] {
  const list: any[] = (usePlayer.getState().profile as any)?.achievements ?? [];
  return list.filter((a) => a?.name).map((a) => ({
    成就名称: S(a.name), 分类: S(a.category), 类型: S(a.type), 稀有度: S(a.rarity),
    是否隐藏: a.hidden ? '是' : '否', 解锁条件: S(a.condition), 解锁时间: S(a.unlockTime),
  }));
}

function buildResources(): Row[] {
  const list: any[] = (useResource.getState() as any).resources ?? [];
  return list.filter((r) => r?.name).map((r) => ({
    名称: S(r.name), 当前值: S(r.cur),
    上限: r.maxFormula ? '六维公式' : S(r.max ?? 100), 颜色: S(r.color), 说明: S(r.desc),
  }));
}

// ── 镜像表登记（顺序=orderNo；纪要表=编年史故意不在此→投影/迁移都不碰）──
type SingleSpec = { uid: string; name: string; single: true; build: () => Row | null };
type MultiSpec = { uid: string; name: string; single: false; build: () => Row[] };
const MIRROR_TABLES: (SingleSpec | MultiSpec)[] = [
  { uid: 'protagonist_info', name: '主角信息表', single: true, build: buildProtagonist },
  { uid: 'global_state', name: '世界状态表', single: true, build: buildGlobalState },
  { uid: 'currency', name: '货币表', single: false, build: buildCurrency },
  { uid: 'inventory', name: '背包物品表', single: false, build: buildInventory },
  { uid: 'important_characters', name: '重要角色表', single: false, build: buildImportantChars },
  { uid: 'protagonist_skills', name: '技能表', single: false, build: buildSkills },
  { uid: 'talents', name: '天赋表', single: false, build: buildTalents },
  { uid: 'titles', name: '称号表', single: false, build: buildTitles },
  { uid: 'factions', name: '势力表', single: false, build: buildFactions },
  { uid: 'territory', name: '领地表', single: false, build: buildTerritory },
  { uid: 'adventure_team', name: '冒险团表', single: false, build: buildTeam },
  { uid: 'quests_events', name: '任务与事件表', single: false, build: buildQuests },
  { uid: 'custom_vars', name: '自定义变量表', single: false, build: buildCustomVars },
  { uid: 'subprofessions', name: '副职业表', single: false, build: buildSubprofessions },
  { uid: 'achievements', name: '成就表', single: false, build: buildAchievements },
  { uid: 'resources', name: '自定义能量条表', single: false, build: buildResources },
  { uid: 'npc_items', name: 'NPC物品表', single: false, build: buildNpcItems },
  { uid: 'npc_skills', name: 'NPC技能表', single: false, build: buildNpcSkills },
  { uid: 'npc_talents', name: 'NPC天赋表', single: false, build: buildNpcTalents },
];

/** 某镜像表当前是否为空（单行=数据行全空白；多行=无数据行）。 */
function rowsEmpty(uid: string): boolean {
  const s = useTables.getState().getSheet(uid);
  if (!s) return true;
  const data = s.content.slice(1);
  if (s.single) return data.every((r) => r.slice(1).every((c) => !S(c).trim()));
  return data.length === 0;
}

/** 把现有游戏 store 的值播种进表（手动/开局）。返回被播种的表名。 */
export function migrateStoresToTables(opts: { overwrite?: boolean } = {}): MigrateResult {
  const overwrite = !!opts.overwrite;
  const t = useTables.getState();
  const seeded: string[] = [];
  for (const spec of MIRROR_TABLES) {
    try {
      if (!(overwrite || rowsEmpty(spec.uid))) continue;   // 非 overwrite 只填空表（不盖已有）
      if (spec.single) {
        const row = spec.build();
        if (row) { t.updateRow(spec.uid, 0, row); seeded.push(spec.name); }
      } else {
        const rows = spec.build();
        if (rows.length) { t.replaceRows(spec.uid, rows); seeded.push(spec.name); }
        else if (overwrite) t.replaceRows(spec.uid, []);   // overwrite + store 空 → 清空表
      }
    } catch { /* 单表失败不阻断整体 */ }
  }
  return { seeded };
}

/** 1c 每回合投影：镜像表全量从 store 派生。**一次性构建全部 content + 单次 setState**（一次 persist·避免逐表多次全量序列化拖慢大存档）。返回被投影的表名。 */
export function projectStoresToTables(): string[] {
  const cur = useTables.getState().tables;
  const next = { ...cur };
  const projected: string[] = [];
  for (const spec of MIRROR_TABLES) {
    try {
      const sheet = cur[spec.uid];
      if (!sheet) continue;
      const header = sheet.content[0] ?? ['row_id'];
      if (spec.single) {
        const row = spec.build();
        if (!row) continue;   // 数据不足→保留现状（不覆盖单行）
        next[spec.uid] = { ...sheet, content: rowsToContent(header, [row]) };
      } else {
        next[spec.uid] = { ...sheet, content: rowsToContent(header, spec.build()) };   // 含空数组=清空
      }
      projected.push(spec.name);
    } catch { /* 单表失败不阻断整体投影 */ }
  }
  useTables.setState({ tables: next });   // 一次 set·一次 persist·全部镜像表
  return projected;
}
