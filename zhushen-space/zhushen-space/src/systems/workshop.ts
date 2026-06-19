/* 创意工坊核心逻辑（纯逻辑，无 React）。
 *
 * 设计（呼应 fanren-remake 的「创意工坊」+ remoteLibraryInstall）：
 *   - 「在线读取为主」：fetchWorkshopIndex 拉一个托管的索引 JSON → 浏览 → installWorkshopItem 一键装。
 *   - 安装即在 workshopStore.installs 记 版本/内容哈希 → itemStatus 判 新装/已装/有更新（仿 contentHash + dirty 思路）。
 *   - 「投稿」走 buildSubmission/downloadSubmission 导出文件（无社区后端，作者把文件给维护者合进索引）；
 *     installFromFile 支持把别人给的投稿文件 / 整包配置直接装进来（本地点对点分享）。
 *
 * 内容颗粒度：分类条目 + 整包。各类型用 KIND 注册表登记 listLocal/pack/install，
 * 复用各 store 既有形状（textPreset/worldbook/skillTree/creationTemplate）+ configExport（整包）。
 * 想再加「强化老板包 / 荷官包」等：往 KINDS 加一条即可。
 */
import { useSettings, type TextGenPreset, type WorldBook } from '../store/settingsStore';
import { useSkillTree, type TreeDef } from '../store/skillTreeStore';
import { useCreationTemplates, type CreationTemplateData } from '../store/creationTemplateStore';
import { buildGlobalConfig, importGlobalConfig, type GlobalConfig } from './configExport';
import { useWorkshop } from '../store/workshopStore';

export const INDEX_KIND = 'zhushen-workshop-index';
export const ITEM_KIND = 'zhushen-workshop-item';
export const FORMAT_VERSION = 1;

export type WorkshopKindId = 'textPreset' | 'worldbook' | 'skillTree' | 'creationTemplate' | 'configBundle';

export interface WorkshopMeta {
  id: string;
  type: WorkshopKindId;
  name: string;
  author?: string;
  version?: string;
  summary?: string;
  tags?: string[];
  updatedAt?: string;
  contentHash?: string;
}

// 索引里的一条：meta + 内容（内联 payload 或外链 payloadUrl，二选一）
export interface WorkshopIndexItem extends WorkshopMeta {
  payload?: any;
  payloadUrl?: string;
}

export interface WorkshopIndex {
  kind: typeof INDEX_KIND;
  formatVersion: number;
  name?: string;
  updatedAt?: string;
  items: WorkshopIndexItem[];
}

// 单条分享 / 投稿文件
export interface WorkshopItemFile {
  kind: typeof ITEM_KIND;
  formatVersion: number;
  meta: WorkshopMeta;
  payload: any;
}

/* ── 内容类型注册表 ── */
export interface WorkshopKindDef {
  id: WorkshopKindId;
  label: string;
  emoji: string;
  listLocal: () => { id: string; name: string }[];   // 本地可投稿的条目
  pack: (localId: string) => any;                      // 取一条本地条目 → 可移植 payload
  install: (payload: any) => void;                     // 把 payload 装进对应 store（去重）
}

export const KINDS: Record<WorkshopKindId, WorkshopKindDef> = {
  textPreset: {
    id: 'textPreset', label: '正文预设', emoji: '📖',
    listLocal: () => useSettings.getState().textPresets.map((p) => ({ id: p.id, name: p.name })),
    pack: (id) => useSettings.getState().textPresets.find((p) => p.id === id) ?? null,
    install: (payload) => useSettings.setState((s) => {
      const p = payload as TextGenPreset;
      const incoming: TextGenPreset = { ...p, id: `preset_${Date.now()}`, builtin: false };
      const others = s.textPresets.filter((x) => x.name !== incoming.name);   // 同名覆盖，不堆叠
      return { textPresets: [...others, incoming] };
    }),
  },
  worldbook: {
    id: 'worldbook', label: '世界书', emoji: '📚',
    listLocal: () => useSettings.getState().worldBooks.map((b) => ({ id: b.id, name: b.name })),
    pack: (id) => useSettings.getState().worldBooks.find((b) => b.id === id) ?? null,
    install: (payload) => useSettings.setState((s) => {
      const b = payload as WorldBook;
      const incoming: WorldBook = { ...b, id: `wb_${Date.now()}`, builtin: false, builtinKey: undefined, enabled: b.enabled ?? true, createdAt: Date.now() };
      const others = s.worldBooks.filter((x) => x.name !== incoming.name);
      return { worldBooks: [...others, incoming] };
    }),
  },
  skillTree: {
    id: 'skillTree', label: '技能树模板', emoji: '🌳',
    listLocal: () => Object.values(useSkillTree.getState().trees).map((t) => ({ id: t.id, name: t.title || t.profession })),
    pack: (id) => useSkillTree.getState().trees[id] ?? null,
    install: (payload) => {
      const t = payload as TreeDef;
      useSkillTree.getState().upsertTree({ ...t, source: 'manual' });   // 同 id 覆盖=更新；标记为手动来源
    },
  },
  creationTemplate: {
    id: 'creationTemplate', label: '角色创建模板', emoji: '🎭',
    listLocal: () => useCreationTemplates.getState().templates.map((t) => ({ id: t.id, name: t.name })),
    pack: (id) => {
      const t = useCreationTemplates.getState().templates.find((x) => x.id === id);
      return t ? { name: t.name, data: t.data } : null;
    },
    install: (payload) => {
      const p = payload as { name: string; data: CreationTemplateData };
      useCreationTemplates.getState().addTemplate(p.name, p.data);   // 同名覆盖
    },
  },
  configBundle: {
    id: 'configBundle', label: '整套配置', emoji: '📦',
    listLocal: () => [{ id: '__current__', name: '当前全部配置（整包）' }],
    pack: () => buildGlobalConfig(false),   // 整包默认不含 API 密钥
    install: (payload) => {
      const r = importGlobalConfig(JSON.stringify(payload as GlobalConfig));
      if (!r.ok) throw new Error(r.message);
    },
  },
};

export const KIND_LIST: WorkshopKindDef[] = Object.values(KINDS);
export function kindOf(type: string): WorkshopKindDef | undefined { return (KINDS as Record<string, WorkshopKindDef>)[type]; }

/* ── 内容哈希（稳定 stringify + FNV-1a，仿 fanren contentHash）── */
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

/* ── 安装状态：新装 / 已装 / 有更新 ── */
export type ItemStatus = 'new' | 'installed' | 'update';
export function itemStatus(item: Pick<WorkshopMeta, 'id' | 'version' | 'contentHash'>): ItemStatus {
  const rec = useWorkshop.getState().installs[item.id];
  if (!rec) return 'new';
  if (item.version && rec.version && item.version !== rec.version) return 'update';
  if (item.contentHash && rec.contentHash && item.contentHash !== rec.contentHash) return 'update';
  return 'installed';
}

/* ── 远程索引 ── */
function absUrl(url: string): string {
  try { return new URL(url, window.location.href).toString(); } catch { return url; }
}

export async function fetchWorkshopIndex(url: string): Promise<WorkshopIndex> {
  const res = await fetch(absUrl(url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`拉取失败 HTTP ${res.status}`);
  let data: any;
  try { data = await res.json(); } catch { throw new Error('索引不是合法 JSON'); }
  if (!data || data.kind !== INDEX_KIND || !Array.isArray(data.items)) {
    throw new Error('不是有效的工坊索引（kind 应为 zhushen-workshop-index）');
  }
  return data as WorkshopIndex;
}

async function resolvePayload(item: WorkshopIndexItem, sourceUrl: string): Promise<any> {
  if (item.payload != null) return item.payload;
  if (item.payloadUrl) {
    const u = new URL(item.payloadUrl, absUrl(sourceUrl)).toString();
    const res = await fetch(u, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`拉取内容失败 HTTP ${res.status}`);
    const data = await res.json();
    return (data && data.kind === ITEM_KIND && 'payload' in data) ? data.payload : data;
  }
  throw new Error('该条目缺少内容（payload / payloadUrl 均为空）');
}

export async function installWorkshopItem(item: WorkshopIndexItem, sourceUrl: string, sourceId?: string): Promise<void> {
  const kind = kindOf(item.type);
  if (!kind) throw new Error(`未知内容类型「${item.type}」`);
  const payload = await resolvePayload(item, sourceUrl);
  kind.install(payload);
  useWorkshop.getState().recordInstall({
    id: item.id, type: item.type, name: item.name,
    version: item.version, contentHash: item.contentHash ?? hashPayload(payload),
    sourceId, installedAt: Date.now(),
  });
}

/* ── 投稿：导出文件 ── */
export interface SubmissionMeta { name: string; author?: string; version?: string; summary?: string; tags?: string[] }

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'item';
}

export function buildSubmission(type: WorkshopKindId, localId: string, meta: SubmissionMeta): WorkshopItemFile {
  const kind = kindOf(type);
  if (!kind) throw new Error(`未知类型 ${type}`);
  const payload = kind.pack(localId);
  if (payload == null) throw new Error('没有可打包的内容');
  return {
    kind: ITEM_KIND, formatVersion: FORMAT_VERSION,
    meta: {
      id: `${type}-${slug(meta.name)}-${Date.now().toString(36)}`,
      type,
      name: meta.name.trim() || '未命名',
      author: meta.author?.trim() || undefined,
      version: meta.version?.trim() || '1.0.0',
      summary: meta.summary?.trim() || undefined,
      tags: (meta.tags ?? []).filter(Boolean),
      updatedAt: new Date().toISOString().slice(0, 10),
      contentHash: hashPayload(payload),
    },
    payload,
  };
}

export function downloadSubmission(file: WorkshopItemFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工坊-${file.meta.name}-${file.meta.version ?? ''}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── 从文件安装（点对点分享）：支持工坊投稿文件 / 整包全局配置 ── */
export function installFromFile(raw: string): { ok: boolean; message: string } {
  let data: any;
  try { data = JSON.parse(raw); } catch { return { ok: false, message: '文件不是合法 JSON' }; }

  // 兼容直接喂整包全局配置文件
  if (data && data.kind === 'zhushen-global-config') {
    const r = importGlobalConfig(raw);
    if (r.ok) {
      useWorkshop.getState().recordInstall({
        id: `bundle-${hashPayload(data)}`, type: 'configBundle', name: '导入的整包配置',
        version: data.appVersion, contentHash: hashPayload(data), installedAt: Date.now(),
      });
    }
    return { ok: r.ok, message: r.message };
  }

  if (!data || data.kind !== ITEM_KIND || !data.meta || data.payload == null) {
    return { ok: false, message: '不是有效的工坊投稿文件（kind 应为 zhushen-workshop-item）' };
  }
  const meta = data.meta as WorkshopMeta;
  const kind = kindOf(meta.type);
  if (!kind) return { ok: false, message: `未知内容类型「${meta.type}」` };
  try {
    kind.install(data.payload);
    useWorkshop.getState().recordInstall({
      id: meta.id, type: meta.type, name: meta.name,
      version: meta.version, contentHash: meta.contentHash ?? hashPayload(data.payload), installedAt: Date.now(),
    });
    return { ok: true, message: `已安装「${meta.name}」` };
  } catch (e: any) {
    return { ok: false, message: `安装失败：${e?.message ?? e}` };
  }
}
