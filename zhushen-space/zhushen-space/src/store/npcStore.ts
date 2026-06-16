import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCharacters, type Deed } from './characterStore';
import type { PlayerAttrs, StatusEffect } from './playerStore';
import { normalizeTier, realmFromLevel, lvFromRealm } from '../systems/derivedStats';

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
  score?: string;         // 评分
  intro?: string;         // 简介
  killCount?: string;     // 杀敌数量（仅武器类）
  enhanceLevel?: number;  // 强化等级 0-16（装备强化系统，仅装备类；0/缺省=未强化）
  image?: string;         // 装备图（上传/AI 生图 dataURL）
  numeric?: Record<string, unknown>;  // 原始数值结构（rarityTier/grade/statLines…）
  addedAt: number;
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
  appearance5: string;    // 列16：动作|穿着|位置|身段|样貌
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
  profession?: string;    // 职业
  arenaRank?: string;     // 竞技场排名
  brandLevel?: string;    // 烙印等级
  contractorId?: string;  // 契约者编号（ID）
  advancePoints?: number; // 进阶点数（升级消耗，正文获取则增加，初始0）
  attrPoints?: number;    // 属性点（完全按正文更新，正文没出现就不动）
  realAttrPoints?: number;// 真实属性点（完全按正文更新，正文没出现就不动）
  skillPoints?: number;   // 技能点（完全按正文更新，正文没出现就不动）
  statusEffects?: StatusEffect[]; // 限时状态（引擎自动过期）
  bioStrength?: string;   // 生物强度模板（T0杂鱼~T9源初，存如"T3·勇士"；含非人生物，按强度框架）
  age?: string;           // 年龄（正文有则照抄，没有则按设定生成；可写"约25岁/青年"等）
  review?: string;        // 诙谐评价（玩家视角的吐槽/锐评，幽默风格）
  npcTag?: string;        // 标签（限定：契约者/土著/随从/宠物/召唤物）
  avatar?: string;        // 人物头像（上传的自定义图片 dataURL / 未来生图地址；在场面板与肖像栏展示）
  avatarTags?: string;    // 生成当前头像所用的 imageTags（用于"外观变化时刷新肖像"判断是否需要重绘）
  imageTags?: string;     // 生图提示词（第19列：英文 NAI/Danbooru tags，NPC演化生成；肖像生图优先用它保证一致）
  attrs?: PlayerAttrs;    // 基础属性（力/敏/体/智/魅/幸）
  items: NpcOwnedItem[];  // NPC 持有物品列表
  extra: Record<string, string>; // 其余列兜底
  onScene: boolean;       // true=在场(A区) false=离场(B区)

  // ── 场景 / 生命周期 ──
  isDead?: boolean;       // 列4含"已死亡"
  deadTurn?: number;      // 首次被检测为死亡的回合号（死亡自动清除的延迟计时；复活则清空）
  isBond?: boolean;       // 羁绊/开局角色，自带"长期保留"，不进清理名单
  keepForever?: boolean;  // 用户手动标记长期保留
  kitDone?: boolean;      // 已发放过初始家当（装备+储物），避免重复发放

  // ── 临时世界队伍（频道组队；世界结束自动解散，与永久冒险团两层分开）──
  partyMember?: boolean;  // 是否当前的临时队友
  partyWorld?: string;    // 为哪个世界(worldName)入队的
  partyRole?: string;     // 队内职责（坦克/治疗/输出/侦察…）

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
  updatedAt: number;
}

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
  'npcTag': 'npcTag', '标签': 'npcTag', 'tag': 'npcTag',
  'age': 'age', '年龄': 'age',
  'imageTags': 'imageTags', '画像提示': 'imageTags', '生图提示词': 'imageTags',
};

export function defaultNpcRecord(id: string): NpcRecord {
  return {
    id, name: id, gender: '', realm: '', personality: '', status: '一切正常',
    callPlayer: '', background: '', innerThought: '', relations: '',
    favor: 0, appearance5: '', motiveNow: '', shortGoal: '', longGoal: '',
    inCombat: false, appearanceDetail: '', title: '', items: [], extra: {},
    onScene: true, updatedAt: Date.now(),
  };
}

interface NpcState {
  npcs: Record<string, NpcRecord>;
  upsertNpc: (id: string, patch: Partial<NpcRecord>) => void;
  applyColumns: (id: string, cols: Record<string, unknown>) => void;
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
  setFriend: (id: string, on: boolean) => void;   // 加入/移出好友栏
  leaveParty: (id: string) => void;       // 退出临时队伍（partyMember=false，仍在场，等剧情/手动归档）
  disbandPartyForWorld: (currentWorld: string) => string[];  // 世界切换：解散非当前世界的临时队友(离队 + 离场归档)，返回被解散的 id 列表
  hardRemoveNpc: (id: string) => void;    // 物理删除（清理路人）
  absorbOrphans: () => number;            // 把"只有物品没有档案"的空壳并入真实NPC
  dedupeByName: () => number;             // 合并同名真实NPC（防一回合/跨回合重复建档），返回合并掉的数量
  clearAll: () => void;
  addNpcItem: (ownerId: string, item: NpcOwnedItem) => void;
  dedupeNpcItems: (ownerId?: string) => void;   // 合并某NPC(或全部)储存空间内同名重复物品（可堆叠累加/装备取大值）
  updateNpcItem: (ownerId: string, itemId: string, patch: Partial<NpcOwnedItem>) => void;
  removeNpcItem: (ownerId: string, itemId: string) => void;
  equipNpcItem: (ownerId: string, itemId: string, slot: string) => void;
  unequipNpcItem: (ownerId: string, itemId: string) => void;
  consumeNpcItem: (ownerId: string, itemId: string, qty: number) => void;
  clearNpcBag: (ownerId: string) => void;   // 清空未装备物品（保留已装备）
  addNpcStatus: (id: string, e: StatusEffect) => void;        // upsert by name
  removeNpcStatus: (id: string, idOrName: string) => void;
  setNpcStatuses: (id: string, list: StatusEffect[]) => void; // 过期清理整体重写
}

/* NPC 储存空间同名堆叠：装备类（武器/防具/饰品/特殊/法宝）不堆叠，余者同名累加 */
const NPC_NO_STACK_CATS = new Set<string>(['武器', '防具', '饰品', '特殊物品', '法宝']);
const npcStackNorm = (x?: string) => (x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').toLowerCase();

export const useNpc = create<NpcState>()(
  persist(
    (set) => ({
      npcs: {},

      upsertNpc: (id, patch) =>
        set((s) => {
          const existing = s.npcs[id] ?? defaultNpcRecord(id);
          return { npcs: { ...s.npcs, [id]: { ...existing, ...patch, updatedAt: Date.now() } } };
        }),

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
            // 列31：inCombat（bool）
            if (col === '31') {
              rec.inCombat = rawVal === true || rawVal === 'true' || rawVal === 1;
              continue;
            }
            // 列2：阶位·Lv|身份——规范化阶位部分（只允许 一阶~无上之境）
            if (col === '2') {
              rec.realm = normalizeRealm(val);
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
      setFriend: (id, on) =>
        set((s) => (s.npcs[id] ? { npcs: { ...s.npcs, [id]: { ...s.npcs[id], isFriend: on, friendedAt: on ? Date.now() : s.npcs[id].friendedAt, updatedAt: Date.now() } } } : s)),
      leaveParty: (id) =>
        set((s) => (s.npcs[id] ? { npcs: { ...s.npcs, [id]: { ...s.npcs[id], partyMember: false, updatedAt: Date.now() } } } : s)),
      disbandPartyForWorld: (currentWorld) => {
        const cw = (currentWorld || '').trim();
        const out: string[] = [];
        set((s) => {
          const npcs = { ...s.npcs };
          for (const [id, r] of Object.entries(s.npcs)) {
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
        // 同步清除该 NPC 在 characterStore 的技能/词条，避免孤儿数据
        try { useCharacters.getState().removeCharacter(id); } catch { /* ignore */ }
        set((s) => {
          if (!s.npcs[id]) return s;
          const next = { ...s.npcs };
          delete next[id];
          return { npcs: next };
        });
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
            if (nm?.trim()) rec.name = nm.trim();
            if (gd === '男' || gd === '女') rec.gender = gd;
          }
          if (g('r')) rec.realm = g('r');            // 境界(进度%)|身份 → 列2
          if (g('p')) rec.personality = g('p');      // 列3
          if (g('t')) rec.title = g('t');            // 称号
          if (g('lg')) rec.extra = { ...rec.extra, '5': g('lg') }; // 灵根/天赋 → 列5
          if (g('bg')) rec.background = g('bg');      // 列10
          if (g('act')) rec.appearance5 = g('act');   // 列16
          if (short['extraSy'] != null) rec.extra = { ...rec.extra, 额外寿元: g('extraSy') };
          if (short['apAge'] != null)   rec.extra = { ...rec.extra, 外貌年龄: g('apAge') };
          if (g('yrr')) rec.extra = { ...rec.extra, 驻颜理由: g('yrr') };
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

      absorbOrphans: () => {
        let merged = 0;
        set((s) => {
          const all = Object.values(s.npcs);
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
          for (const r of Object.values(s.npcs)) {
            if (r.isDead) continue;
            const key = (r.name || '').trim();
            if (!key || key === r.id) continue;
            const arr = groups.get(key);
            if (arr) arr.push(r); else groups.set(key, [r]);
          }
          const next = { ...s.npcs };
          // 信息完整度评分：留下最全的那个，其余并入它
          const score = (r: NpcRecord) =>
            (r.realm ? 2 : 0) + (r.personality ? 1 : 0) + (r.background ? 1 : 0) +
            (r.appearanceDetail ? 1 : 0) + (r.items?.length ?? 0) + (r.deedLog?.length ?? 0) +
            (r.onScene ? 1 : 0) + (r.avatar ? 1 : 0);
          const purge: string[] = [];
          for (const group of groups.values()) {
            if (group.length < 2) continue;
            const keeper = group.slice().sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
            const merged = { ...next[keeper.id] };
            for (const dup of group) {
              if (dup.id === keeper.id) continue;
              // 合并持有物品（按 id 去重）
              const items = [...(merged.items ?? [])];
              for (const it of dup.items ?? []) if (!items.some((x) => x.id === it.id)) items.push(it);
              merged.items = items;
              if (dup.onScene) merged.onScene = true;
              // keeper 缺失的字段用 dup 补全
              for (const f of ['realm', 'personality', 'background', 'appearanceDetail', 'title', 'profession', 'contractorId', 'gender', 'attrs', 'avatar', 'imageTags'] as (keyof NpcRecord)[]) {
                if ((merged[f] == null || merged[f] === '') && dup[f] != null && dup[f] !== '') (merged as any)[f] = dup[f];
              }
              delete next[dup.id];
              purge.push(dup.id);
              removed++;
              console.warn(`[NPC] 合并同名重复角色「${keeper.name}」：${dup.id} → ${keeper.id}`);
            }
            next[keeper.id] = { ...merged, updatedAt: Date.now() };
          }
          if (removed) {
            // 同步清除被合并角色在 characterStore 的技能/词条，避免孤儿数据
            try { for (const id of purge) useCharacters.getState().removeCharacter(id); } catch { /* ignore */ }
            return { npcs: next };
          }
          return s;
        });
        return removed;
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
              const key = npcStackNorm(it.name);
              const at = key ? idxByKey.get(key) : undefined;
              // 两件同名且都已装备在不同槽 → 合法多件，不合并
              if (!key || at === undefined || (out[at!].equipped && it.equipped && out[at!].equipSlot !== it.equipSlot)) {
                if (key && at === undefined) idxByKey.set(key, out.length);
                out.push(it); continue;
              }
              const a = out[at];
              const primary = (a.equipped || a.equipSlot) ? a : ((it.equipped || it.equipSlot) ? it : a);
              const secondary = primary === a ? it : a;
              // 可堆叠类累加数量，装备类取较大值（防误增）
              const qty = stackable(a.category) ? (a.quantity || 1) + (it.quantity || 1) : Math.max(a.quantity || 1, it.quantity || 1);
              out[at] = { ...secondary, ...primary, quantity: qty };
            }
            return out.length === (rec.items?.length ?? 0) ? rec : { ...rec, items: out, updatedAt: Date.now() };
          };
          if (ownerId) { const rec = s.npcs[ownerId]; return rec ? { npcs: { ...s.npcs, [ownerId]: dedupeOne(rec) } } : s; }
          const npcs = { ...s.npcs };
          let changed = false;
          for (const id of Object.keys(npcs)) { const d = dedupeOne(npcs[id]); if (d !== npcs[id]) { npcs[id] = d; changed = true; } }
          return changed ? { npcs } : s;
        }),

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
          const items = rec.items
            .map((it) => it.id === itemId ? { ...it, quantity: it.quantity - qty } : it)
            .filter((it) => it.quantity > 0);
          return { npcs: { ...s.npcs, [ownerId]: { ...rec, items, updatedAt: Date.now() } } };
        }),

      clearNpcBag: (ownerId) =>
        set((s) => {
          const rec = s.npcs[ownerId];
          if (!rec) return s;
          const items = rec.items.filter((it) => it.equipped); // 只保留已装备
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
