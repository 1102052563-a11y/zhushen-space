import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════
   经历（对齐 fanren-remake bio.deeds schema）
   NPC 与主角共用此结构
════════════════════════════════════════════ */
export interface Deed {
  time: string;        // 自由文本：游戏内时间/副本进度，如 "第3日·黄昏"
  location: string;    // 场景，如 "轮回乐园大厅"
  description: string; // 这条经历本身
  addedAt?: number;    // 写入时间戳（前端排序用）
}

/* ════════════════════════════════════════════
   记忆（生平压缩 / deep-summary）
   shortTerm=近期工作记忆；longTerm=沉淀长期记忆
════════════════════════════════════════════ */
export interface MemoryEntry {
  time: string;      // 游戏内时间锚点
  location: string;  // 地点
  content: string;   // 记忆内容
  addedAt?: number;
}
export interface CharMemory {
  shortTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
}

/* ════════════════════════════════════════════
   技能（对齐 fanren-remake addSkill schema）
════════════════════════════════════════════ */
export interface Skill {
  id: string;             // "S_B1_01"
  name: string;           // "火球术"
  level: string;          // "入门·Lv.15"
  cooldown?: string;      // "1回合"
  desc: string;           // 简描（第4列）
  effect: string;         // 当前激活层效果（第6列）
  layers?: string;        // 总层数（第5列）
  layerProgress?: string; // 当前层级进度（第7列）
  cost?: string;          // 消耗档位（第8列）
  layerEffects?: string;  // 各层效果（第9列）
  // ── 固定格式补充字段（名称|等级|类型|品级|消耗|目标|效果|伤害|层级|属性加成|描述|标签）──
  skillType?: string;     // 类型（主动/被动/奥义/光环/领域…）
  rarity?: string;        // 品级（人/玄/地/天 或 D~SSS/颜色品质）
  target?: string;        // 目标（单体/群体/自身/范围…）
  damage?: string;        // 伤害（数值化，如 法术攻击180%/+30固定）
  attrBonus?: string;     // 属性加成（如 力量+5、暴击+10%）
  tags?: string[];        // 标签（火/控制/位移/斩杀…）
  note?: string;          // 备注（寓言/评价风格的点评文字，如「即使是不死者，被斩下头颅也会终结。」）
  numeric?: {
    kind: 'skill';
    grade?: number;                  // 1-4
    rarityTier?: string;             // 'ren'|'xuan'|'di'|'tian'
    element?: string;                // 'fire'|'water'|...
    activeProfile?: string;
    cooldownProfile?: string;
    targetMode?: string;
    targetScope?: string;
    maxTargets?: number;
    mpCostMultiplier?: number;
    [key: string]: unknown;
  };
  addedAt: number;
}

/* ════════════════════════════════════════════
   天赋（轮回乐园天赋系统；沿用 addTrait/addTalent 写入通道）
   评级 D→C→B→A→S→SS→SSS；**数量不设上限**（旧的"最多3个/同类型唯一"限制已解除），
   仍需正文明确觉醒/获得证据才新增，同名只更新不重复。
════════════════════════════════════════════ */
export interface Talent {
  name: string;       // 天赋名（唯一标识），如「剑术天赋」「力量之心」
  desc: string;       // 简描
  source?: string;    // 觉醒/激活方式：宿主初始激活 / 血脉传承 / 极端考验 / 顿悟升华 / 启蒙之石 / 突破卷轴 等
  effect: string;     // 效果描述
  rarity: string;     // 评级/品级：D|C|B|A|S|SS|SSS（也允许「负面」表示诅咒/负面天赋）
  category?: string;  // 天赋类型：技巧类 / 属性类 / 能量类 / 特殊异能类 —— 用于「不可重复类型」约束
  // ── 固定格式补充字段（名称|等级|品级|效果|属性加成|描述）──
  level?: string;     // 等级（天赋成长档，如 觉醒·Lv.1 / 一阶）
  attrBonus?: string; // 属性加成（如 智力+8、法术强度+15%）
  note?: string;      // 备注（寓言/评价风格的点评文字）
  numeric?: {
    kind: 'talent';
    rarity?: string;    // 'd'|'c'|'b'|'a'|'s'|'ss'|'sss'
    profile?: string;
    intensity?: string;
    [key: string]: unknown;
  };
  addedAt: number;
}
/** 向后兼容旧引用：Trait 即天赋 Talent */
export type Trait = Talent;

/* ════════════════════════════════════════════
   称号（固定格式：名称|获得时间|品级|来源|效果|描述|是否装备）
   主角与 NPC 共用；每角色可有多个，但最多 1 个 equipped=true。
   仅 equipped 的称号会被叙事记忆结构化召回注入正文。
════════════════════════════════════════════ */
export interface Title {
  name: string;          // 称号名（唯一标识）
  obtainedTime?: string; // 获得时间（游戏内时间锚点）
  rarity: string;        // 品级（颜色品质 或 D~SSS）
  source?: string;       // 来源（如何获得）
  effect?: string;       // 效果（数值化加成/特殊效果，可无）
  desc?: string;         // 描述/flavor
  equipped?: boolean;    // 是否佩戴（每角色至多 1 个）
  addedAt: number;
}

/* ════════════════════════════════════════════
   副职业（生活/制造/社交类非战斗手艺）+ 名下配方
   名称自定义；五档总熟练度 gate 配方阶位；纯正文实践驱动。
   固定格式 副职业：名称|档位|总熟练度|大类|配方称谓|效果|简介
   固定格式 配方：名称|类别|档位|熟练度|所需材料|产物|简介
════════════════════════════════════════════ */
export const SUBPROF_TIERS = ['新手', '熟练', '专家', '大师', '宗师'] as const;

export interface Recipe {
  id: string;          // 唯一编号（按 id/name upsert）
  name: string;        // 自定义配方名（自动手枪图纸 / 治疗药剂药方）
  tier?: string;       // 配方档位（生疏/熟练/精通…，可选）
  progress?: number;   // 配方熟练度 0–100
  materials?: string;  // 所需材料
  output?: string;     // 产物（成品名+效果，制作时据此 createItem）
  desc?: string;
  addedAt: number;
}
export interface SubProfession {
  name: string;        // 副职业名（机械师/药剂师）—— 唯一标识，按名 upsert
  tier: string;        // 总档位：新手→熟练→专家→大师→宗师
  progress?: number;   // 总熟练度 0–100（满100晋级总档位）
  category?: string;   // 大类：制造/医疗/生活/社交…
  recipeLabel?: string;// 配方的叫法：图纸/药方/食谱/锻造图（UI 显示）
  desc?: string;
  effect?: string;     // 当前能做什么/加成
  recipes: Recipe[];   // 名下配方
  addedAt: number;
}

/* 满100晋级：返回 {tier, progress} */
// AI 常用别名 → 系统5档（避免它自创"入门/精通"等档名时被当成最低档）
const SUBPROF_TIER_ALIAS: Record<string, string> = {
  生疏: '新手', 初学: '新手', 初级: '新手', 入门: '新手', 学徒: '新手',
  中级: '熟练', 熟手: '熟练',
  高级: '专家', 精通: '专家',
  宗匠: '大师', 巨匠: '大师',
  传说: '宗师', 大宗师: '宗师',
};
function promoteTier(tier: string, progress: number): { tier: string; progress: number } {
  const canon = SUBPROF_TIER_ALIAS[(tier ?? '').trim()] ?? tier;
  let idx = SUBPROF_TIERS.indexOf(canon as typeof SUBPROF_TIERS[number]);
  if (idx < 0) idx = 0;
  let p = progress;
  while (p >= 100 && idx < SUBPROF_TIERS.length - 1) { p -= 100; idx++; }
  if (idx >= SUBPROF_TIERS.length - 1) p = Math.min(p, 100);   // 封顶宗师
  return { tier: SUBPROF_TIERS[idx], progress: Math.max(0, p) };
}

/* ════════════════════════════════════════════
   角色数据容器
════════════════════════════════════════════ */
export interface CharacterData {
  id: string;      // "B1", "B2", "C1" 等
  skills: Skill[];
  traits: Trait[];
  titles?: Title[];     // 称号库（最多1个 equipped）
  subProfessions?: SubProfession[];  // 副职业（含名下配方）
  memory?: CharMemory;  // 生平压缩用的工作记忆（shortTerm/longTerm）
}

interface CharacterState {
  characters: Record<string, CharacterData>;

  addSkill:    (charId: string, skill: Omit<Skill, 'addedAt'>) => void;
  removeSkill: (charId: string, idOrName: string) => void;
  updateSkill: (charId: string, skillId: string, patch: Partial<Skill>) => void;
  addTrait:    (charId: string, trait: Omit<Trait, 'addedAt'>) => void;
  removeTrait: (charId: string, traitName: string) => void;
  updateTrait: (charId: string, traitName: string, patch: Partial<Trait>) => void;
  addTitle:    (charId: string, title: Omit<Title, 'addedAt'>) => void;  // upsert by name
  removeTitle: (charId: string, titleName: string) => void;
  equipTitle:  (charId: string, titleName: string) => void;             // 仅佩戴此一个，其余取消
  unequipTitle: (charId: string) => void;                               // 取消全部佩戴
  addSubProfession:    (charId: string, sp: Omit<SubProfession, 'addedAt' | 'recipes'> & { recipes?: Recipe[] }) => void; // upsert by name，保留已有配方
  removeSubProfession: (charId: string, name: string) => void;
  bumpSubProf:         (charId: string, name: string, delta: number) => void;     // 总熟练度 +=，含晋级
  addRecipe:           (charId: string, profName: string, recipe: Omit<Recipe, 'addedAt'>) => void; // upsert by id/name；prof 缺失则自动建
  removeRecipe:        (charId: string, profName: string, recipeName: string) => void;
  bumpRecipe:          (charId: string, profName: string, recipeName: string, delta: number) => void; // 配方熟练度 +=（封顶100）
  appendMemory: (charId: string, entry: MemoryEntry) => void;      // 追加一条 shortTerm 记忆
  setMemory:    (charId: string, memory: CharMemory) => void;      // 压缩后整体重写 short/long
  removeCharacter: (charId: string) => void;       // 删除某角色的全部技能/词条
  purgeNpcCharacters: () => void;                  // 清除所有 NPC(C*/G*) 的技能/词条，保留玩家 B*
  dedupeIds: () => void;                           // 修复历史脏数据：所有角色技能 id 去重
  dedupeRecipes: () => void;                        // 修复历史脏数据：配方名去「配方：」前缀 + 同名合并
}

function ensureChar(chars: Record<string, CharacterData>, id: string): CharacterData {
  return chars[id] ?? { id, skills: [], traits: [] };
}

/* 名称归一化匹配（去空白/标点/大小写后相等）：技能/天赋/称号/副职业/配方 的"同名→更新、按名删除"统一用它，
   容忍 AI 在不同回合给同一条目写出细微差异（多空格、加减标点、全半角）——避免误判为新条目而重复堆叠，或删不掉。
   仅做归一化「相等」(不做子串包含)，不会把"烈焰斩"和"烈焰斩·改"等真实不同的条目误并。 */
function normNm(s?: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
}
function nameEq(a?: string, b?: string): boolean {
  const x = normNm(a), y = normNm(b);
  return !!x && !!y && x === y;
}

/* 配方名归一化：AI 常给配方名加「配方：/图纸：/药方：…」标签前缀，导致同一配方两条（带/不带前缀）。
   存储与匹配前统一剥掉前缀，杜绝重复。 */
const RECIPE_LABEL_RE = /^\s*(配方|图纸|药方|食谱|菜谱|丹方|锻造图|图鉴|图谱|蓝图|设计图|方子|秘方|制法|做法)\s*[:：]\s*/;
function stripRecipeLabel(name?: string): string {
  let s = (name ?? '').trim();
  let prev = '';
  while (s && s !== prev) { prev = s; s = s.replace(RECIPE_LABEL_RE, '').trim(); }   // 可能套多层，循环剥到干净
  return s || (name ?? '').trim();
}

/* 防御性字符串化：AI 偶尔把嵌套对象塞进本该是字符串的字段（如 effect:{name,effect}），
   直接渲染会触发 React "Objects are not valid as a React child" 导致整页崩。写入时强制转成可读字符串。 */
function txt(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join('、');
  if (typeof v === 'object') {
    if (typeof v.name === 'string' && typeof v.effect === 'string') return `${v.name}（${v.effect}）`;
    return String(v.name ?? v.text ?? v.desc ?? v.effect ?? v.value ?? JSON.stringify(v));
  }
  return String(v);
}
const SANITIZE_KEYS = ['name', 'desc', 'effect', 'source', 'attrBonus', 'level', 'rarity', 'category', 'skillType', 'target', 'damage', 'cooldown', 'cost', 'obtainedTime', 'recipeLabel', 'tier'];
function sanitizeStrings<T extends Record<string, any>>(o: T): T {
  if (!o || typeof o !== 'object') return o;
  const out: any = { ...o };
  for (const k of SANITIZE_KEYS) if (out[k] != null && typeof out[k] !== 'string') out[k] = txt(out[k]);
  return out as T;
}

/* 同名 upsert 合并：incoming 里"空/缺失"的字段保留 prev 旧值，
   避免一次极简的重复 add（如对账纠错只给了名字）把已有的详细 desc/effect/品级等冲掉。 */
function mergeKeepRich<T extends Record<string, any>>(prev: T, incoming: T): T {
  const out: any = { ...prev };
  for (const [k, v] of Object.entries(incoming)) {
    const empty = v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
    if (!empty) out[k] = v;   // 仅用"非空"的新值覆盖；新值为空则保留旧值
  }
  return out;
}

/* 保证一个角色的技能 id 全表唯一：空 id 或与前面重复的 id 重新分配 S_<charId>_NN。
   首次出现的 id 保留，后来的重复者改号——从根上消除"两个技能同 id"。 */
function dedupeSkillIds(charId: string, skills: Skill[]): Skill[] {
  const used = new Set<string>();
  let counter = 0;
  const freshId = (): string => {
    let id: string;
    do { counter++; id = `S_${charId}_${String(counter).padStart(2, '0')}`; } while (used.has(id));
    return id;
  };
  return skills.map((sk) => {
    let id = sk.id;
    if (!id || used.has(id)) id = freshId();
    used.add(id);
    return id === sk.id ? sk : { ...sk, id };
  });
}

/* 任务/世界事件不是技能：拒绝把「主线任务…/支线任务…/任务（第N环）…」当技能写入（它们应进 miscStore 的 T_ 任务）*/
export function isQuestName(name?: string): boolean {
  const n = (name ?? '').trim();
  return /^(?:主线|支线|日常|隐藏|世界)?任务[\s:：（(]/.test(n) || /(?:主线|支线)任务/.test(n) || /任务[（(]第.*环/.test(n);
}
/* 读档/重载时清理历史误入的「任务技能」 */
function stripQuestSkills(chars: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [id, data] of Object.entries(chars ?? {})) {
    const sk = (data as any)?.skills;
    const filtered = Array.isArray(sk) ? sk.filter((x: any) => !isQuestName(x?.name)) : sk;
    out[id] = Array.isArray(sk) && filtered.length !== sk.length ? { ...(data as any), skills: filtered } : data;
  }
  return out;
}

export const useCharacters = create<CharacterState>()(
  persist(
    (set) => ({
      characters: {},

      addSkill: (charId, skill) =>
        set((s) => {
          skill = sanitizeStrings(skill);
          if (isQuestName(skill.name)) { console.warn('[Char] 拒绝把任务当技能添加（应进任务列表）:', skill.name); return s; }
          if (/^\s*配方\s*[:：]/.test(skill.name ?? '')) { console.warn('[Char] 拒绝把配方当技能添加（应 addRecipe 挂到副职业下）:', skill.name); return s; }
          const char = ensureChar(s.characters, charId);
          let next = [...char.skills];
          // 以「名称」为身份：同名→原地更新（保留原条目 id，避免改名造成 id 漂移/撞号）；
          // 不同名→新技能追加，其 id 交给 dedupe 保证唯一（即使 AI 复用了已存在 id 也会自动改号，两个技能不会再共用一个 id）。
          const byName = next.findIndex((sk) => nameEq(sk.name, skill.name));
          if (byName >= 0) {
            next[byName] = mergeKeepRich(next[byName], { ...skill, id: next[byName].id, addedAt: Date.now() });   // 同名更新：空字段保留旧值，防极简重复 add 冲掉详情
          } else {
            next.push({ ...skill, addedAt: Date.now() });
          }
          next = dedupeSkillIds(charId, next);
          return { characters: { ...s.characters, [charId]: { ...char, skills: next } } };
        }),

      removeSkill: (charId, idOrName) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const next = char.skills.filter(
            (sk) => sk.id !== idOrName && !nameEq(sk.name, idOrName),
          );
          return { characters: { ...s.characters, [charId]: { ...char, skills: next } } };
        }),

      // 手动编辑技能（按 id 定位，patch 可含新名称；id 不变避免漂移）
      updateSkill: (charId, skillId, patch) =>
        set((s) => {
          const char = s.characters[charId]; if (!char) return s;
          const clean = sanitizeStrings(patch as Record<string, any>);
          const next = char.skills.map((sk) => sk.id === skillId ? { ...sk, ...clean } : sk);
          return { characters: { ...s.characters, [charId]: { ...char, skills: next } } };
        }),

      addTrait: (charId, trait) =>
        set((s) => {
          trait = sanitizeStrings(trait);
          const char = ensureChar(s.characters, charId);
          const existing = char.traits.findIndex((t) => nameEq(t.name, trait.name));
          const next = [...char.traits];
          const entry: Trait = { ...trait, addedAt: Date.now() };
          if (existing >= 0) next[existing] = mergeKeepRich(next[existing], entry);   // 同名更新：空字段保留旧值
          else next.push(entry);
          return { characters: { ...s.characters, [charId]: { ...char, traits: next } } };
        }),

      removeTrait: (charId, traitName) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const next = char.traits.filter((t) => !nameEq(t.name, traitName));
          return { characters: { ...s.characters, [charId]: { ...char, traits: next } } };
        }),

      // 手动编辑天赋（按原名定位，patch 可含新名称）
      updateTrait: (charId, traitName, patch) =>
        set((s) => {
          const char = s.characters[charId]; if (!char) return s;
          const clean = sanitizeStrings(patch as Record<string, any>);
          const next = char.traits.map((t) => nameEq(t.name, traitName) ? { ...t, ...clean } : t);
          return { characters: { ...s.characters, [charId]: { ...char, traits: next } } };
        }),

      addTitle: (charId, title) =>
        set((s) => {
          title = sanitizeStrings(title);
          const char = ensureChar(s.characters, charId);
          const list = char.titles ?? [];
          const idx = list.findIndex((t) => nameEq(t.name, title.name));
          let next = [...list];
          const entry: Title = { ...title, addedAt: idx >= 0 ? (list[idx].addedAt ?? Date.now()) : Date.now() };
          if (idx >= 0) next[idx] = entry; else next.push(entry);
          // 维持至多 1 个 equipped：若本次标记 equipped，则其余取消
          if (entry.equipped) next = next.map((t) => nameEq(t.name, entry.name) ? t : { ...t, equipped: false });
          // 防称号无限堆叠（AI 易刷近义称号）：超过上限丢弃最旧的未佩戴称号，保留已佩戴 + 最近若干
          const CAP = 6;
          if (next.length > CAP) {
            const equipped = next.filter((t) => t.equipped);
            const rest = next.filter((t) => !t.equipped).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, Math.max(0, CAP - equipped.length));
            next = [...equipped, ...rest];
          }
          return { characters: { ...s.characters, [charId]: { ...char, titles: next } } };
        }),

      removeTitle: (charId, titleName) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const next = (char.titles ?? []).filter((t) => !nameEq(t.name, titleName));
          return { characters: { ...s.characters, [charId]: { ...char, titles: next } } };
        }),

      equipTitle: (charId, titleName) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const next = (char.titles ?? []).map((t) => ({ ...t, equipped: nameEq(t.name, titleName) }));
          return { characters: { ...s.characters, [charId]: { ...char, titles: next } } };
        }),

      unequipTitle: (charId) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const next = (char.titles ?? []).map((t) => ({ ...t, equipped: false }));
          return { characters: { ...s.characters, [charId]: { ...char, titles: next } } };
        }),

      addSubProfession: (charId, sp) =>
        set((s) => {
          sp = sanitizeStrings(sp);
          const char = ensureChar(s.characters, charId);
          const list = char.subProfessions ?? [];
          const idx = list.findIndex((x) => nameEq(x.name, sp.name));
          const ex = idx >= 0 ? list[idx] : undefined;
          // 部分更新时保留已有字段（不被 undefined 覆盖）
          const prom = promoteTier(sp.tier || ex?.tier || '新手', sp.progress ?? ex?.progress ?? 0);
          const entry: SubProfession = {
            name: sp.name, tier: prom.tier, progress: prom.progress,
            category: sp.category ?? ex?.category,
            recipeLabel: sp.recipeLabel ?? ex?.recipeLabel,
            desc: sp.desc ?? ex?.desc,
            effect: sp.effect ?? ex?.effect,
            recipes: ex?.recipes ?? sp.recipes ?? [],
            addedAt: ex?.addedAt ?? Date.now(),
          };
          const next = [...list];
          if (idx >= 0) next[idx] = entry; else next.push(entry);
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: next } } };
        }),

      removeSubProfession: (charId, name) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: (char.subProfessions ?? []).filter((x) => !nameEq(x.name, name)) } } };
        }),

      bumpSubProf: (charId, name, delta) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const list = char.subProfessions ?? [];
          const idx = list.findIndex((x) => nameEq(x.name, name));
          if (idx < 0) return {};
          const prom = promoteTier(list[idx].tier, (list[idx].progress ?? 0) + delta);
          const next = [...list]; next[idx] = { ...list[idx], tier: prom.tier, progress: prom.progress };
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: next } } };
        }),

      addRecipe: (charId, profName, recipe) =>
        set((s) => {
          recipe = sanitizeStrings(recipe);
          const cleanName = stripRecipeLabel(recipe.name);   // 去「配方：」等前缀，避免带/不带前缀各存一条
          if (cleanName && cleanName !== recipe.name) recipe = { ...recipe, name: cleanName };
          const char = ensureChar(s.characters, charId);
          const list = [...(char.subProfessions ?? [])];
          let pIdx = list.findIndex((x) => nameEq(x.name, profName));
          if (pIdx < 0) { list.push({ name: profName, tier: '新手', progress: 0, recipes: [], addedAt: Date.now() }); pIdx = list.length - 1; }
          const recs = [...(list[pIdx].recipes ?? [])];
          const rIdx = recs.findIndex((r) => (recipe.id && r.id === recipe.id) || nameEq(r.name, recipe.name));
          const entry: Recipe = { ...recipe, progress: Math.min(100, Math.max(0, recipe.progress ?? (rIdx >= 0 ? recs[rIdx].progress ?? 0 : 0))), addedAt: rIdx >= 0 ? recs[rIdx].addedAt : Date.now() };
          if (rIdx >= 0) recs[rIdx] = entry; else recs.push(entry);
          list[pIdx] = { ...list[pIdx], recipes: recs };
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: list } } };
        }),

      removeRecipe: (charId, profName, recipeName) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const target = stripRecipeLabel(recipeName);   // 容忍 deRecipe 带「配方：」前缀
          const list = (char.subProfessions ?? []).map((p) => nameEq(p.name, profName) ? { ...p, recipes: (p.recipes ?? []).filter((r) => !nameEq(r.name, target) && r.id !== recipeName) } : p);
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: list } } };
        }),

      bumpRecipe: (charId, profName, recipeName, delta) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const target = stripRecipeLabel(recipeName);   // 容忍 bumpRecipe 带「配方：」前缀
          const list = (char.subProfessions ?? []).map((p) => {
            if (!nameEq(p.name, profName)) return p;
            const recs = (p.recipes ?? []).map((r) => (nameEq(r.name, target) || r.id === recipeName) ? { ...r, progress: Math.min(100, Math.max(0, (r.progress ?? 0) + delta)) } : r);
            return { ...p, recipes: recs };
          });
          return { characters: { ...s.characters, [charId]: { ...char, subProfessions: list } } };
        }),

      appendMemory: (charId, entry) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          const mem: CharMemory = char.memory ?? { shortTerm: [], longTerm: [] };
          const e: MemoryEntry = { ...entry, addedAt: entry.addedAt ?? Date.now() };
          // 安全上限 60，避免压缩关闭时无限膨胀（压缩会把它收到 ≤5）
          const shortTerm = [...mem.shortTerm, e].slice(-60);
          return { characters: { ...s.characters, [charId]: { ...char, memory: { ...mem, shortTerm } } } };
        }),

      setMemory: (charId, memory) =>
        set((s) => {
          const char = ensureChar(s.characters, charId);
          return { characters: { ...s.characters, [charId]: { ...char, memory } } };
        }),

      removeCharacter: (charId) =>
        set((s) => {
          if (!s.characters[charId]) return s;
          const next = { ...s.characters };
          delete next[charId];
          return { characters: next };
        }),

      purgeNpcCharacters: () =>
        set((s) => {
          const next: Record<string, CharacterData> = {};
          for (const [id, data] of Object.entries(s.characters)) {
            if (!/^[CG]\d+$/.test(id)) next[id] = data;  // 保留玩家 B* 等非 NPC
          }
          return { characters: next };
        }),

      dedupeIds: () =>
        set((s) => {
          let changed = false;
          const next: Record<string, CharacterData> = {};
          for (const [id, data] of Object.entries(s.characters)) {
            const fixed = dedupeSkillIds(id, data.skills ?? []);
            if (fixed.some((sk, i) => sk !== (data.skills ?? [])[i])) changed = true;
            next[id] = { ...data, skills: fixed };
          }
          return changed ? { characters: next } : {};
        }),

      dedupeRecipes: () =>
        set((s) => {
          let anyChange = false;
          const next: Record<string, CharacterData> = {};
          for (const [cid, ch] of Object.entries(s.characters)) {
            const sps = ch.subProfessions;
            if (!sps?.length) { next[cid] = ch; continue; }
            let charChanged = false;
            const newSps = sps.map((sp) => {
              const recs = sp.recipes ?? [];
              const out: Recipe[] = [];
              let spChanged = false;
              for (const r of recs) {
                const cleanName = stripRecipeLabel(r.name) || r.name;
                const ex = out.find((o) => nameEq(o.name, cleanName));
                if (ex) {
                  spChanged = true;   // 去前缀后同名 → 合并：保留更高熟练度，富字段补全
                  ex.progress = Math.max(ex.progress ?? 0, r.progress ?? 0);
                  if (!ex.tier) ex.tier = r.tier;
                  if (!ex.materials) ex.materials = r.materials;
                  if (!ex.output) ex.output = r.output;
                  if (!ex.desc) ex.desc = r.desc;
                } else {
                  if (cleanName !== r.name) spChanged = true;
                  out.push({ ...r, name: cleanName });
                }
              }
              if (spChanged) { charChanged = true; return { ...sp, recipes: out }; }
              return sp;
            });
            next[cid] = charChanged ? { ...ch, subProfessions: newSps } : ch;
            if (charChanged) anyChange = true;
          }
          return anyChange ? { characters: next } : {};
        }),
    }),
    {
      name: 'drpg-characters',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        characters: stripQuestSkills(persisted?.characters ?? {}),
      }),
    },
  ),
);

/* ── 天赋评级颜色映射（D→C→B→A→S→SS→SSS；保留旧词条中文键向后兼容）── */
export const RARITY_CLS: Record<string, string> = {
  // 轮回乐园天赋评级
  D:   'border-slate-600   text-slate-400   bg-slate-900/30',
  C:   'border-green-700   text-green-400   bg-green-900/20',
  B:   'border-sky-600     text-sky-300     bg-sky-900/20',
  A:   'border-purple-600  text-purple-300  bg-purple-900/20',
  S:   'border-amber-500   text-amber-300   bg-amber-900/20',
  SS:  'border-orange-500  text-orange-300  bg-orange-900/20',
  SSS: 'border-fuchsia-500 text-fuchsia-300 bg-fuchsia-900/20',
  负面:'border-red-700     text-red-400     bg-red-900/20',
  // 旧词条稀有度（兼容历史存档）
  平庸:    'border-slate-600   text-slate-400   bg-slate-900/30',
  普通:    'border-green-700   text-green-400   bg-green-900/20',
  稀有:    'border-blue-600    text-blue-300    bg-blue-900/20',
  史诗:    'border-purple-600  text-purple-300  bg-purple-900/20',
  传说:    'border-yellow-500  text-yellow-300  bg-yellow-900/20',
  神话:    'border-orange-500  text-orange-300  bg-orange-900/20',
  负面状态:'border-red-700     text-red-400     bg-red-900/20',
};

export const RARITY_DOT: Record<string, string> = {
  D: 'bg-slate-400', C: 'bg-green-400', B: 'bg-sky-400',
  A: 'bg-purple-400', S: 'bg-amber-400', SS: 'bg-orange-400', SSS: 'bg-fuchsia-400',
  负面: 'bg-red-500',
  平庸: 'bg-slate-400', 普通: 'bg-green-400', 稀有: 'bg-blue-400',
  史诗: 'bg-purple-400', 传说: 'bg-yellow-400', 神话: 'bg-orange-400',
  负面状态: 'bg-red-500',
};

/* ── 元素颜色映射 ── */
export const ELEMENT_CLS: Record<string, string> = {
  fire:      'text-orange-400',
  water:     'text-cyan-400',
  earth:     'text-yellow-600',
  metal:     'text-slate-300',
  wood:      'text-green-400',
  lightning: 'text-yellow-300',
  ice:       'text-blue-200',
  wind:      'text-teal-300',
  poison:    'text-purple-400',
  spirit:    'text-indigo-300',
  sword:     'text-slate-200',
  blood:     'text-red-400',
  shadow:    'text-gray-400',
  light:     'text-white',
  none:      'text-dim',
};

/* ── rarityTier → 层数显示 ── */
export const RARITY_TIER_LABEL: Record<string, string> = {
  ren: '一层', xuan: '二层', di: '三层', tian: '四层',
};

/* ════════════ 技能品级（轮回乐园·7 档：普通→极境）+ 配色/特效 ════════════ */
export const SKILL_TIER_ORDER = ['普通', '精良', '稀有', '史诗', '传说', '奥义', '极境'] as const;
/* 边框 + 文字 + 底色（极境给渐变特效，最高层次最醒目）*/
export const SKILL_TIER_CLS: Record<string, string> = {
  普通: 'border-slate-600   text-slate-300   bg-slate-900/30',
  精良: 'border-green-600   text-green-300   bg-green-900/20',
  稀有: 'border-sky-500     text-sky-300     bg-sky-900/20',
  史诗: 'border-purple-500  text-purple-300  bg-purple-900/20',
  传说: 'border-amber-500   text-amber-300   bg-amber-900/20',
  奥义: 'border-rose-500    text-rose-300    bg-rose-900/25',
  极境: 'border-fuchsia-400 text-fuchsia-200 bg-gradient-to-br from-fuchsia-900/40 via-violet-900/20 to-cyan-900/20 shadow-[0_0_12px_rgba(217,70,239,0.25)]',
};
export const SKILL_TIER_DOT: Record<string, string> = {
  普通: 'bg-slate-400', 精良: 'bg-green-400', 稀有: 'bg-sky-400', 史诗: 'bg-purple-400',
  传说: 'bg-amber-400', 奥义: 'bg-rose-400', 极境: 'bg-fuchsia-300',
};
/* 把 AI 可能写的各种别名/旧值归一化到 7 档之一 */
const SKILL_TIER_ALIAS: Record<string, string> = {
  普通: '普通', 平庸: '普通', 凡品: '普通', 凡: '普通', 白: '普通', 白色: '普通', common: '普通',
  精良: '精良', 优良: '精良', 优秀: '精良', 精: '精良', 绿: '精良', 绿色: '精良', fine: '精良', uncommon: '精良',
  稀有: '稀有', 珍稀: '稀有', 蓝: '稀有', 蓝色: '稀有', rare: '稀有',
  史诗: '史诗', 紫: '史诗', 紫色: '史诗', epic: '史诗',
  传说: '传说', 传奇: '传说', 金: '传说', 金色: '传说', 橙: '传说', legend: '传说', legendary: '传说',
  奥义: '奥义', 秘奥: '奥义', 奥秘: '奥义', 红: '奥义', arcane: '奥义',
  极境: '极境', 极道: '极境', 究极: '极境', 极: '极境', apex: '极境',
  // 旧 D~SSS / 人玄地天 近似兼容
  D: '普通', C: '精良', B: '稀有', A: '史诗', S: '传说', SS: '奥义', SSS: '极境',
};
export function normSkillTier(r?: string): string {
  const s = (r ?? '').trim();
  if (!s) return '普通';
  return SKILL_TIER_ALIAS[s] ?? (SKILL_TIER_CLS[s] ? s : '普通');
}
