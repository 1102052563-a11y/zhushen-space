/* 创意工坊核心（纯逻辑，无 React）。
 *
 * 社区工坊：无审核直传 + 浏览 + 下载数。后端 = zhushen-multiplayer Worker 的 /api/workshop/*（Cloudflare D1）。
 *   - 浏览：wsList 拉列表(带下载数) → installFromBackend(取 payload→装进对应 store→下载数+1→记账本)。
 *   - 上传：uploadLocal(把本地某条 pack 成 payload → POST 直传，实时可见)。
 *
 * 内容类型（KIND 注册表，每类型 listLocal/pack/install）：
 *   角色：技能 skill / 天赋 talent / 称号 title / 副职业 subProfession（都装到主角 B1）
 *   装备：装备 equipment(武器/防具/饰品/法宝) / 宝石 gem
 *   物品：item(消耗品/材料/工具/…非装备)
 *   NPC ：npc(召唤物/随从/契约者/土著；连同其技能天赋/持有物一起分享)
 *   模板：技能树 skillTree / 角色创建 creationTemplate
 * 加新类型 = 往 KINDS 加一条。
 */
import { useItems, type InventoryItem } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useNpc } from '../store/npcStore';
import { useSkillTree, type TreeDef } from '../store/skillTreeStore';
import { useCreationTemplates, type CreationTemplateData } from '../store/creationTemplateStore';
import { useCreationContent } from '../store/creationContentStore';
import { useWorkshop } from '../store/workshopStore';
import { mpBase, myPlayerId } from './mpConfig';

const PLAYER_ID = 'B1';
const EQUIP_CATS = ['武器', '防具', '饰品'];
const GEM_CAT = '宝石';
const NPC_CATS = ['召唤物', '随从', '契约者', '土著'];
const ITEM_CATS = ['消耗品', '材料', '工具', '重要物品', '特殊物品', '凡物', '其他物品'];

export type WorkshopKindId =
  | 'skill' | 'talent' | 'title' | 'subProfession'
  | 'equipment' | 'gem' | 'item' | 'npc'
  | 'skillTree' | 'creationTemplate'
  | 'paradise' | 'race';   // 角色创建专属（乐园/种族）

// 角色创建模式下走「自定义内容库」的类型（乐园/种族/天赋）
export const CREATION_TYPES: WorkshopKindId[] = ['paradise', 'race', 'talent'];

export interface WorkshopMeta {
  id: string;
  type: WorkshopKindId;
  category?: string;
  name: string;
  author?: string;
  version?: string;
  summary?: string;
  tags?: string[];
  downloads?: number;
  createdAt?: number;
  contentHash?: string;
}
export interface WorkshopItem extends WorkshopMeta { payload: any }

export interface LocalEntry { id: string; name: string; category?: string }
export interface PackResult { payload: any; name: string; category?: string }
export interface WorkshopKindDef {
  id: WorkshopKindId;
  label: string;
  emoji: string;
  group: '角色' | '装备' | '物品' | 'NPC' | '模板' | '创建';
  categories?: string[];
  creationOnly?: boolean;   // 仅在「角色创建」工坊里出现，普通工坊不显示
  listLocal: () => LocalEntry[];
  pack: (localId: string) => PackResult | null;
  install: (payload: any) => void;
}

/* ── 工具 ── */
function stripKeys<T extends object>(o: T, keys: string[]): any {
  const c: any = { ...o };
  for (const k of keys) delete c[k];
  return c;
}
const rid = () => Math.random().toString(36).slice(2, 9);

// 装备/宝石/物品：保留全部具体信息（效果/品级/攻防/耐久/词缀/评分/简介/强化/觉醒/宝石/图片…），
// 只剥掉「库存实例」字段（id/获得时间/装备态/锁定）。别人下载即得完整物品。
function packInvItem(it: InventoryItem): any {
  const c = stripKeys(it, ['id', 'addedAt', 'equipped', 'equipSlot', 'locked']);
  c.quantity = 1;   // 分享一件
  return c;
}
function installInvItem(payload: any) {
  useItems.getState().addItem({ ...payload, equipped: false, quantity: 1 });
}
function listInvByCats(filter: (cat: string) => boolean): LocalEntry[] {
  return useItems.getState().items
    .filter((i) => filter(i.category))
    .map((i) => ({ id: i.id, name: i.name, category: i.category }));
}
function packInvById(id: string): PackResult | null {
  const it = useItems.getState().items.find((x) => x.id === id);
  return it ? { payload: packInvItem(it), name: it.name, category: it.category } : null;
}

const ch = () => useCharacters.getState();
const player = () => ch().characters[PLAYER_ID];

/* ── 角色创建·自定义内容库（乐园/种族/天赋）：listLocal/pack/install 走 creationContentStore ── */
const cc = () => useCreationContent.getState();
export function ccListLocal(type: WorkshopKindId): LocalEntry[] {
  if (type === 'paradise') return cc().paradises.map((p) => ({ id: p.id, name: p.name }));
  if (type === 'race') return cc().races.map((r) => ({ id: r.id, name: r.name }));
  if (type === 'talent') return cc().talents.map((t) => ({ id: t.id, name: t.name }));
  return [];
}
export function ccPack(type: WorkshopKindId, id: string): PackResult | null {
  if (type === 'paradise') { const p = cc().paradises.find((x) => x.id === id); return p ? { payload: { name: p.name, desc: p.desc }, name: p.name } : null; }
  if (type === 'race') { const r = cc().races.find((x) => x.id === id); return r ? { payload: { name: r.name, detail: r.detail }, name: r.name } : null; }
  if (type === 'talent') { const t = cc().talents.find((x) => x.id === id); return t ? { payload: { name: t.name, effect: t.effect }, name: t.name } : null; }
  return null;
}
export function ccInstall(type: WorkshopKindId, payload: any): void {
  if (type === 'paradise') cc().addParadise({ name: payload.name, desc: payload.desc });
  else if (type === 'race') cc().addRace({ name: payload.name, detail: payload.detail ?? payload.raceDetail });
  else if (type === 'talent') cc().addTalent({ name: payload.name, effect: payload.effect ?? payload.desc });
}

export const KINDS: Record<WorkshopKindId, WorkshopKindDef> = {
  skill: {
    id: 'skill', label: '技能', emoji: '✨', group: '角色',
    listLocal: () => (player()?.skills ?? []).map((s) => ({ id: s.id, name: s.name })),
    pack: (id) => { const s = (player()?.skills ?? []).find((x) => x.id === id); return s ? { payload: stripKeys(s, ['addedAt']), name: s.name } : null; },
    install: (payload) => ch().addSkill(PLAYER_ID, { ...payload, id: `S_${PLAYER_ID}_${rid()}` }),
  },
  talent: {
    id: 'talent', label: '天赋', emoji: '🧬', group: '角色',
    listLocal: () => (player()?.traits ?? []).map((t) => ({ id: t.name, name: t.name })),
    pack: (id) => { const t = (player()?.traits ?? []).find((x) => x.name === id); return t ? { payload: stripKeys(t, ['addedAt']), name: t.name } : null; },
    install: (payload) => ch().addTrait(PLAYER_ID, payload),
  },
  title: {
    id: 'title', label: '称号', emoji: '🎖', group: '角色',
    listLocal: () => (player()?.titles ?? []).map((t) => ({ id: t.name, name: t.name })),
    pack: (id) => { const t = (player()?.titles ?? []).find((x) => x.name === id); return t ? { payload: stripKeys(t, ['addedAt']), name: t.name } : null; },
    install: (payload) => ch().addTitle(PLAYER_ID, { ...payload, equipped: false }),
  },
  subProfession: {
    id: 'subProfession', label: '副职业', emoji: '🛠', group: '角色',
    listLocal: () => (player()?.subProfessions ?? []).map((sp) => ({ id: sp.name, name: sp.name })),
    pack: (id) => { const sp = (player()?.subProfessions ?? []).find((x) => x.name === id); return sp ? { payload: stripKeys(sp, ['addedAt']), name: sp.name } : null; },
    install: (payload) => ch().addSubProfession(PLAYER_ID, payload),
  },
  equipment: {
    id: 'equipment', label: '装备', emoji: '⚔', group: '装备', categories: EQUIP_CATS,
    listLocal: () => listInvByCats((c) => EQUIP_CATS.includes(c)),
    pack: packInvById,
    install: installInvItem,
  },
  gem: {
    id: 'gem', label: '宝石', emoji: '💎', group: '装备',
    listLocal: () => listInvByCats((c) => c === GEM_CAT),
    pack: packInvById,
    install: installInvItem,
  },
  item: {
    id: 'item', label: '物品', emoji: '🎒', group: '物品', categories: ITEM_CATS,
    listLocal: () => listInvByCats((c) => !EQUIP_CATS.includes(c) && c !== GEM_CAT),
    pack: packInvById,
    install: installInvItem,
  },
  npc: {
    id: 'npc', label: 'NPC', emoji: '📇', group: 'NPC', categories: NPC_CATS,
    listLocal: () => Object.values(useNpc.getState().npcs)
      .filter((r) => NPC_CATS.includes(r.npcTag ?? '') && (r.name || '').trim())
      .map((r) => ({ id: r.id, name: r.name || r.id, category: r.npcTag })),
    pack: (id) => {
      const r = useNpc.getState().npcs[id];
      if (!r) return null;
      const rec = stripKeys(r, ['id', 'avatar', 'avatarTags', 'onScene', 'isDead', 'deadTurn',
        'isFriend', 'friendedAt', 'partyMember', 'partyWorld', 'partyRole', 'lastEvolvedTurn', 'keepForever', 'kitDone', 'arenaRank']);
      if (Array.isArray(rec.items)) rec.items = rec.items.map((x: any) => stripKeys(x, ['image']));
      const cd = useCharacters.getState().characters[id];
      const character = cd ? { skills: cd.skills ?? [], traits: cd.traits ?? [], titles: cd.titles ?? [], subProfessions: cd.subProfessions ?? [] } : undefined;
      return { payload: { record: rec, character }, name: r.name || r.id, category: r.npcTag };
    },
    install: (payload) => {
      const data = payload as { record: any; character?: { skills?: any[]; traits?: any[]; titles?: any[]; subProfessions?: any[] } };
      const id = `Cw${Date.now().toString(36)}${rid().slice(0, 3)}`;
      useNpc.getState().upsertNpc(id, { ...data.record, onScene: false, isDead: false, isFriend: false });
      const c = useCharacters.getState();
      (data.character?.skills ?? []).forEach((s) => c.addSkill(id, { ...s, id: `S_${id}_${rid()}` }));
      (data.character?.traits ?? []).forEach((t) => c.addTrait(id, t));
      (data.character?.titles ?? []).forEach((t) => c.addTitle(id, t));
      (data.character?.subProfessions ?? []).forEach((sp) => c.addSubProfession(id, sp));
    },
  },
  skillTree: {
    id: 'skillTree', label: '技能树模板', emoji: '🌳', group: '模板',
    listLocal: () => Object.values(useSkillTree.getState().trees).map((t) => ({ id: t.id, name: t.title || t.profession })),
    pack: (id) => { const t = useSkillTree.getState().trees[id]; return t ? { payload: t, name: t.title || t.profession } : null; },
    install: (payload) => useSkillTree.getState().upsertTree({ ...(payload as TreeDef), source: 'manual' }),
  },
  creationTemplate: {
    id: 'creationTemplate', label: '角色创建模板', emoji: '🎭', group: '模板',
    listLocal: () => useCreationTemplates.getState().templates.map((t) => ({ id: t.id, name: t.name })),
    pack: (id) => { const t = useCreationTemplates.getState().templates.find((x) => x.id === id); return t ? { payload: { name: t.name, data: t.data }, name: t.name } : null; },
    install: (payload) => { const p = payload as { name: string; data: CreationTemplateData }; useCreationTemplates.getState().addTemplate(p.name, p.data); },
  },
  paradise: {
    id: 'paradise', label: '乐园', emoji: '🏝', group: '创建', creationOnly: true,
    listLocal: () => ccListLocal('paradise'),
    pack: (id) => ccPack('paradise', id),
    install: (payload) => ccInstall('paradise', payload),
  },
  race: {
    id: 'race', label: '种族', emoji: '🧝', group: '创建', creationOnly: true,
    listLocal: () => ccListLocal('race'),
    pack: (id) => ccPack('race', id),
    install: (payload) => ccInstall('race', payload),
  },
};

export const KIND_LIST: WorkshopKindDef[] = Object.values(KINDS);
export function kindOf(type: string): WorkshopKindDef | undefined { return (KINDS as Record<string, WorkshopKindDef>)[type]; }

/* ── 内容哈希（稳定 stringify + FNV-1a）── */
function stable(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function hashPayload(v: any): string {
  const t = stable(v);
  let h = 2166136261;
  for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ── 安装状态 ── */
export type ItemStatus = 'new' | 'installed' | 'update';
export function statusFor(installs: Record<string, { version?: string; contentHash?: string }>, meta: Pick<WorkshopMeta, 'id' | 'version' | 'contentHash'>): ItemStatus {
  const rec = installs[meta.id];
  if (!rec) return 'new';
  if (meta.version && rec.version && meta.version !== rec.version) return 'update';
  if (meta.contentHash && rec.contentHash && meta.contentHash !== rec.contentHash) return 'update';
  return 'installed';
}

/* ── 后端 API 客户端 ── */
export function apiBase(): string {
  const o = useWorkshop.getState().apiBase;
  return (o || mpBase()).replace(/\/+$/, '');
}
async function errMsg(res: Response): Promise<string> {
  try { const d = await res.json(); return d.error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}

export interface ListParams { type?: string; category?: string; q?: string; sort?: 'recent' | 'downloads' }
export async function wsList(params: ListParams = {}): Promise<WorkshopMeta[]> {
  const u = new URL(apiBase() + '/api/workshop/items');
  if (params.type) u.searchParams.set('type', params.type);
  if (params.category) u.searchParams.set('category', params.category);
  if (params.q) u.searchParams.set('q', params.q);
  if (params.sort) u.searchParams.set('sort', params.sort);
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  const data = await res.json();
  return (data.items ?? []) as WorkshopMeta[];
}
export async function wsGet(id: string): Promise<WorkshopItem> {
  const res = await fetch(`${apiBase()}/api/workshop/items/${encodeURIComponent(id)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return (await res.json()).item as WorkshopItem;
}
async function wsBumpDownload(id: string): Promise<number> {
  try {
    const res = await fetch(`${apiBase()}/api/workshop/items/${encodeURIComponent(id)}/download`, { method: 'POST' });
    return (await res.json()).downloads ?? 0;
  } catch { return 0; }
}

/* ── 高层操作 ── */
// 安装：取 payload → 装进 store → 下载数+1 → 记账本。返回最新下载数。
export async function installFromBackend(meta: WorkshopMeta, creation = false): Promise<number> {
  const kind = kindOf(meta.type);
  if (!kind) throw new Error(`未知内容类型「${meta.type}」`);
  const full = await wsGet(meta.id);
  if (creation && CREATION_TYPES.includes(meta.type)) ccInstall(meta.type, full.payload);   // 角色创建：导入到自定义内容库
  else kind.install(full.payload);
  const downloads = await wsBumpDownload(meta.id);
  useWorkshop.getState().recordInstall({
    id: meta.id, type: meta.type, name: meta.name,
    version: meta.version, contentHash: meta.contentHash ?? full.contentHash, installedAt: Date.now(),
  });
  return downloads;
}

export interface UploadMeta { name: string; author?: string; version?: string; summary?: string; tags?: string[] }

// 工坊昵称（上传署名）
export function uploaderName(): string { return (useWorkshop.getState().nickname || '').trim(); }

// 改名：把我已上传的所有条目署名批量改成新昵称（后端按 owner 更新）
export async function wsRename(newName: string): Promise<number> {
  const res = await fetch(`${apiBase()}/api/workshop/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: myPlayerId(), author: newName.trim() }),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  return (await res.json()).updated ?? 0;
}
// 上传：把本地某条 pack 成 payload → POST。返回新 id。
export async function uploadLocal(type: WorkshopKindId, localId: string, meta: UploadMeta, creation = false): Promise<string> {
  const kind = kindOf(type);
  if (!kind) throw new Error(`未知类型 ${type}`);
  const packed = (creation && CREATION_TYPES.includes(type)) ? ccPack(type, localId) : kind.pack(localId);
  if (!packed) throw new Error('没有可上传的内容');
  const author = uploaderName();
  if (!author) throw new Error('请先在「设置」里起一个工坊昵称');
  const finalName = meta.name.trim() || packed.name;
  const finalVersion = meta.version?.trim() || '1.0.0';
  const body = {
    type,
    category: packed.category,
    name: finalName,
    author,   // 署名=工坊昵称（改名会传播到已上传）
    version: finalVersion,
    summary: meta.summary?.trim() || undefined,
    tags: (meta.tags ?? []).filter(Boolean),
    contentHash: hashPayload(packed.payload),
    owner: myPlayerId(),   // 归属（删除鉴权 + 「已上传」过滤）
    payload: packed.payload,
  };
  const res = await fetch(`${apiBase()}/api/workshop/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  const id = (await res.json()).id as string;
  useWorkshop.getState().recordUpload({ id, type, name: finalName, version: finalVersion, uploadedAt: Date.now() });
  return id;
}

// 「已上传」：按 owner 查我上传的条目（含下载数）
export async function wsListMine(): Promise<WorkshopMeta[]> {
  const u = new URL(apiBase() + '/api/workshop/items');
  u.searchParams.set('owner', myPlayerId());
  const res = await fetch(u.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(await errMsg(res));
  return ((await res.json()).items ?? []) as WorkshopMeta[];
}

// 删除条目（同时从工坊下架）。本人删=带 owner；管理员删任意=带 X-Admin-Key。
export async function wsDelete(id: string): Promise<void> {
  const u = new URL(`${apiBase()}/api/workshop/items/${encodeURIComponent(id)}`);
  u.searchParams.set('owner', myPlayerId());
  const adminKey = useWorkshop.getState().adminKey;
  const res = await fetch(u.toString(), { method: 'DELETE', headers: adminKey ? { 'X-Admin-Key': adminKey } : {} });
  if (!res.ok) throw new Error(await errMsg(res));
  useWorkshop.getState().forgetUpload(id);
}

// 校验管理员密钥（与 worker env.WS_ADMIN_KEY 比对）
export async function wsVerifyAdmin(key: string): Promise<boolean> {
  const res = await fetch(`${apiBase()}/api/workshop/admin/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(await errMsg(res));
  return !!(await res.json()).ok;
}
