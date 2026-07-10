/* 全局配置导出 / 导入（"全局预设"一键备份迁移）。
 *
 * 目标：把**所有功能的配置**（各演化阶段提示词预设 + 世界书 + 正文预设 + 正则 +
 * API 设置 + 生图模板 + 向量库参数 + 角色创建模板 + 综合设置）打成一个 JSON，
 * 可在另一台设备 / 另一个浏览器导入，整套配置一键还原。
 *
 * 铁则：**只导配置，不导游戏进度**。导出剔除运行时数据（NPC 档案 / 背包 / 剧情 /
 * 主角身份 / 技能天赋 / 任务 / 频道消息 / 领地建筑 / 冒险团成员 等）；导入用 zustand
 * 浅合并 setState 只覆盖配置字段，保留当前存档的运行时数据——导入到任何存档都不污染剧情。
 *
 * 与「存档」(saveManager) 区分：存档=游戏进度快照（reload 恢复）；本文件=配置/预设包（无需 reload）。
 *
 * 字段约定（各演化 store 高度统一，故大多用 evoExtract 通用提取）：
 *   配置字段 = `settings` + 任意 `*Api` + 任意 `*UseSharedApi`
 *   运行时/UI = 其余业务数据 + `*AvailableModels`/`*ModelsLoading`/`*ModelsError` 等瞬时态
 */
import { APP_VERSION } from '../version';
import { useSettings } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { useNpcEvo } from '../store/npcEvoStore';
import { useEntryJudge } from '../store/entryJudgeStore';
import { useFactionEvo } from '../store/factionEvoStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';
import { useCosmos } from '../store/cosmosStore';
import { useMisc } from '../store/miscStore';
import { useChannel } from '../store/channelStore';
import { useMemory } from '../store/memoryStore';
import { useDice } from '../store/diceStore';
import { useEnhance } from '../store/enhanceStore';
import { useCraft } from '../store/craftStore';
import { useJoy } from '../store/joyStore';
import { useImageGen } from '../store/imageGenStore';
import { useNovelVec } from '../store/novelVecStore';
import { useCreationTemplates } from '../store/creationTemplateStore';
import { useCombat } from '../store/combatStore';
import { useSkillTree } from '../store/skillTreeStore';
import { useSubProfTree } from '../store/subProfTreeStore';
import { useVariables } from '../store/variableStore';

export const CONFIG_KIND = 'zhushen-global-config';
export const CONFIG_FORMAT_VERSION = 1;

export interface GlobalConfig {
  kind: typeof CONFIG_KIND;
  formatVersion: number;
  appVersion: string;
  exportedAt: number;
  includeApiKeys: boolean;
  stores: Record<string, any>;   // persist name → 配置对象
}

/* ── 提取器：从 store 当前 state 取出"纯配置"部分 ── */

// 演化 store 通用：settings + 所有 *Api / *UseSharedApi 字段（自动跳过函数与运行时数据）
function evoExtract(s: any): any {
  const out: any = {};
  if (s && typeof s === 'object' && 'settings' in s) out.settings = s.settings;
  for (const k of Object.keys(s ?? {})) {
    if (typeof s[k] === 'function') continue;
    if (/Api$/.test(k) || /UseSharedApi$/.test(k)) out[k] = s[k];
  }
  return out;
}

// 登场判断：只导开关/超时/API（不导 entries——每次启动从内置 entry-judge.json 重载，导出徒增体积）。
function entryJudgeExtract(s: any): any {
  const out: any = {};
  for (const k of Object.keys(s ?? {})) {
    if (typeof s[k] === 'function') continue;
    if (k === 'entries' || k === 'presetName' || k === 'presetVersion') continue;
    out[k] = s[k];
  }
  return out;
}

// 装备强化：复用 evoExtract（settings + *Api），但剔除老板立绘大图（device 本地，存 IndexedDB）；
// pity 垫子计数是账号级进度、不在 settings/*Api 内，evoExtract 天然不导出。
function enhanceExtract(s: any): any {
  const out = evoExtract(s);
  if (out.settings?.bosses) out.settings = { ...out.settings, bosses: out.settings.bosses.map((b: any) => ({ ...b, portrait: undefined })) };
  return out;
}

// 欢愉宫：复用 evoExtract（settings + *Api），剔除美女立绘大图（存 IndexedDB）；
// sessions（情欲值/私密/聊天）是账号级进度、不在 settings/*Api 内，evoExtract 天然不导出。
function joyExtract(s: any): any {
  const out = evoExtract(s);
  if (out.settings?.girls) out.settings = { ...out.settings, girls: out.settings.girls.map((g: any) => ({ ...g, portrait: undefined })) };
  // 世界书：只导用户导入/改过的（非 builtin）；内置 5 本由 hydrateJoyWorldBooks 重载，不随配置走
  out.worldBooks = (s.worldBooks ?? []).filter((b: any) => !b.builtin);
  return out;
}
// 欢愉宫导入：worldBooks 单独合并——保留当前内置书，叠加配置里的用户书（避免浅合并把内置从 state 抹掉）
function joyApply(cur: any, cfg: any): any {
  const patch = { ...cfg };
  if ('worldBooks' in cfg) {
    const builtin = (cur.worldBooks ?? []).filter((b: any) => b.builtin);
    patch.worldBooks = [...builtin, ...(cfg.worldBooks ?? [])];
  }
  return patch;
}

// 战斗系统：配置在 config（开关+四阶段预设）+ combatApi/combatUseSharedApi；battle 是运行时、不导。
// 路由 apiRoutes['combat'] 已随 settingsExtract 导出，这里无需再带。
function combatExtract(s: any): any {
  return { config: s.config, combatApi: s.combatApi, combatUseSharedApi: s.combatUseSharedApi };
}

// 技能树：只导 trees 模板库（配置/可分享），剔 progress（每角色解锁进度=游戏进度，随存档走）
function skillTreeExtract(s: any): any {
  return { trees: s.trees };
}
// 技能树导入：合并模板库（导入项按 id 覆盖同名，保留本地其它树），不碰当前存档的解锁进度
function skillTreeApply(cur: any, cfg: any): any {
  return { trees: { ...(cur.trees ?? {}), ...(cfg.trees ?? {}) } };
}

// 自定义变量：只导**定义/schema**（key/label/type/min/max/说明/状态栏开关），值重置成初始（防把作者中途的游戏进度带出去，守"只导配置"铁则）。
//   让二创把「预设 + 它依赖的变量定义」打包同发；导入端正文 AI 据定义经 <state> 更新，预设 {{getvar::key}} 即可引用。
function variablesExtract(s: any): any {
  const initial = (v: any) => v.type === 'number' ? (v.min ?? 0) : v.type === 'boolean' ? false : '';
  return { variables: (s.variables ?? []).map((v: any) => ({ ...v, value: initial(v) })) };
}
// 自定义变量导入：按 key 合并——保留当前已有变量，导入项按 key 覆盖/新增（不整体替换、不抹掉本地变量）
function variablesApply(cur: any, cfg: any): any {
  const byKey = new Map<string, any>();
  for (const v of cur.variables ?? []) byKey.set(v.key, v);
  for (const v of cfg.variables ?? []) if (v && v.key) byKey.set(v.key, v);
  return { variables: [...byKey.values()] };
}

// 扁平全配置 store（imageGen / creationTemplate）：取所有非函数字段（这些 store 本身无运行时数据）
function plainExtract(s: any): any {
  const out: any = {};
  for (const k of Object.keys(s ?? {})) {
    if (typeof s[k] === 'function') continue;
    out[k] = s[k];
  }
  return out;
}

// settingsStore 专用：显式白名单（综合设置 + API 库/路由/节流/调度 + 记忆引擎 + 世界书/正文预设/正则）。
// 世界书/正文预设只导用户自己的（非 builtin）——内置项每次启动从 public/presets 重载，导出会徒增体积且导入端重复。
function settingsExtract(s: any): any {
  return {
    historyLimit: s.historyLimit,
    allowAutoEquip: s.allowAutoEquip,
    allowAutoEquipNpc: s.allowAutoEquipNpc,
    customOpening: s.customOpening,
    plotChoices: s.plotChoices,
    fanficMode: s.fanficMode,
    factCheck: s.factCheck,
    npcAutonomyOn: s.npcAutonomyOn,
    npcAutonomyDeath: s.npcAutonomyDeath,
    npcAutonomyMax: s.npcAutonomyMax,
    npcAutonomyEvery: s.npcAutonomyEvery,
    apiLibrary: s.apiLibrary,
    apiRoutes: s.apiRoutes,
    apiThrottle: s.apiThrottle,
    phaseSched: s.phaseSched,
    narrativeMemory: s.narrativeMemory,
    vectorMemory: s.vectorMemory,
    nmApi: s.nmApi,
    nmUseSharedApi: s.nmUseSharedApi,
    api: s.api,
    systemPrompt: s.systemPrompt,
    textApi: s.textApi,
    textUseSharedApi: s.textUseSharedApi,
    textStream: s.textStream,
    skipNarrativeThinking: s.skipNarrativeThinking,
    plotGuidance: s.plotGuidance,
    guidancePrompt: s.guidancePrompt,
    outlineEnabled: s.outlineEnabled,
    outlinePrompt: s.outlinePrompt,
    outlineBias: s.outlineBias,
    outlineWordTarget: s.outlineWordTarget,
    outlineApi: s.outlineApi,
    outlineUseSharedApi: s.outlineUseSharedApi,
    activeTextPresetId: s.activeTextPresetId,
    globalRegexScripts: s.globalRegexScripts,
    worldBooks: (s.worldBooks ?? []).filter((b: any) => !b?.builtin),
    textWorldBooks: (s.textWorldBooks ?? []).filter((b: any) => !b?.builtin),
    textPresets: (s.textPresets ?? []).filter((p: any) => !p?.builtin),
  };
}

/* ── 应用器：把配置合并回 store（默认浅合并，覆盖配置字段，保留运行时数据）── */

// settings：世界书/正文预设要保留当前内置项(builtin)，用导入的用户项替换原用户项（避免挤掉内置、避免重复）
function settingsApply(cur: any, cfg: any): any {
  const keepBuiltin = (arr: any[], imported: any[]) =>
    [...(arr ?? []).filter((x: any) => x?.builtin), ...(imported ?? [])];
  return {
    ...cfg,
    worldBooks: keepBuiltin(cur.worldBooks, cfg.worldBooks),
    textWorldBooks: keepBuiltin(cur.textWorldBooks, cfg.textWorldBooks),
    textPresets: keepBuiltin(cur.textPresets, cfg.textPresets),
  };
}

// imageGen：嵌套服务配置做一层深合并，旧配置缺的新字段用当前默认补全（防受控组件 undefined 警告）
function imageGenApply(cur: any, cfg: any): any {
  const merge = (a: any, b: any) => (b && typeof b === 'object' ? { ...a, ...b } : (b ?? a));
  return {
    ...cfg,
    nai: merge(cur.nai, cfg.nai),
    openai: merge(cur.openai, cfg.openai),
    gemini: merge(cur.gemini, cfg.gemini),
    custom: merge(cur.custom, cfg.custom),
    comfy: merge(cur.comfy, cfg.comfy),
  };
}

interface StoreSpec {
  key: string;                            // persist name（也是 stores 里的键）
  label: string;                          // 中文名（导入摘要用）
  api: { getState: () => any; setState: (partial: any) => void };
  extract: (s: any) => any;
  apply?: (cur: any, cfg: any) => any;    // 默认直接交给 setState 浅合并
}

const SPECS: StoreSpec[] = [
  { key: 'drpg-settings',           label: '综合设置 / API / 世界书 / 正文预设 / 正则', api: useSettings as any,           extract: settingsExtract, apply: settingsApply },
  { key: 'drpg-player-evo',         label: '主角演化',     api: usePlayer as any,            extract: evoExtract },
  { key: 'drpg-items',              label: '物品管理',     api: useItems as any,             extract: evoExtract },
  { key: 'drpg-npc-evo',            label: 'NPC 演化',     api: useNpcEvo as any,            extract: evoExtract },
  { key: 'drpg-entry-judge',        label: '登场判断',     api: useEntryJudge as any,        extract: entryJudgeExtract },
  { key: 'drpg-faction-evo',        label: '势力演化',     api: useFactionEvo as any,        extract: evoExtract },
  { key: 'drpg-territory',          label: '领地演化',     api: useTerritory as any,         extract: evoExtract },
  { key: 'drpg-team',               label: '冒险团演化',   api: useTeam as any,              extract: evoExtract },
  { key: 'drpg-cosmos',             label: '万族演化',     api: useCosmos as any,            extract: evoExtract },
  { key: 'drpg-misc',               label: '杂项演化',     api: useMisc as any,              extract: evoExtract },
  { key: 'drpg-channel',            label: '公共频道',     api: useChannel as any,           extract: evoExtract },
  { key: 'drpg-memory',             label: '生平压缩',     api: useMemory as any,            extract: evoExtract },
  { key: 'drpg-dice',               label: 'ROLL 点设置',  api: useDice as any,              extract: evoExtract },
  { key: 'drpg-combat',             label: '战斗系统',     api: useCombat as any,            extract: combatExtract },
  { key: 'drpg-enhance',            label: '装备强化',     api: useEnhance as any,           extract: enhanceExtract },
  { key: 'drpg-craft',              label: '合成工坊',     api: useCraft as any,             extract: craftExtract },
  { key: 'drpg-joy',                label: '欢愉宫',       api: useJoy as any,               extract: joyExtract, apply: joyApply },
  { key: 'drpg-image-gen',          label: '生图设置',     api: useImageGen as any,          extract: plainExtract, apply: imageGenApply },
  { key: 'drpg-novelvec',           label: '向量资料库',   api: useNovelVec as any,          extract: evoExtract },
  { key: 'drpg-creation-templates', label: '角色创建模板', api: useCreationTemplates as any, extract: plainExtract },
  { key: 'drpg-skilltree',          label: '技能树模板',   api: useSkillTree as any,         extract: skillTreeExtract, apply: skillTreeApply },
  { key: 'drpg-subproftree',        label: '副职业树模板', api: useSubProfTree as any,       extract: skillTreeExtract, apply: skillTreeApply },
  { key: 'drpg-variables',          label: '自定义变量定义', api: useVariables as any,         extract: variablesExtract, apply: variablesApply },
];

// 合成工坊：导出配置 + 合成图鉴(非内置) + API（不含 session/已发现配方那些进度数据）
function craftExtract(s: any): any {
  return {
    config: s.config,
    worldBooks: (s.worldBooks ?? []).filter((b: any) => !b.builtin),
    craftApi: s.craftApi,
    craftUseSharedApi: s.craftUseSharedApi,
  };
}

// 递归清空 API 密钥（apiKey / apiToken），用于"不含密钥"导出（可安全分享）
function stripKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripKeys);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = /^(apiKey|apiToken)$/i.test(k) ? '' : stripKeys(v);
    }
    return out;
  }
  return obj;
}

/* ── 导出 ── */
export function buildGlobalConfig(includeApiKeys: boolean): GlobalConfig {
  const stores: Record<string, any> = {};
  for (const spec of SPECS) {
    let cfg: any;
    try { cfg = spec.extract(spec.api.getState()); } catch { continue; }
    stores[spec.key] = includeApiKeys ? cfg : stripKeys(cfg);
  }
  return {
    kind: CONFIG_KIND,
    formatVersion: CONFIG_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    includeApiKeys,
    stores,
  };
}

export function downloadGlobalConfig(includeApiKeys: boolean): void {
  const data = buildGlobalConfig(includeApiKeys);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `诛神空间-全局配置-${date}${includeApiKeys ? '' : '-无密钥'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── 导入 ── */
export interface ImportResult { ok: boolean; message: string; applied?: string[]; skipped?: string[] }

export function importGlobalConfig(raw: string): ImportResult {
  let data: any;
  try { data = JSON.parse(raw); } catch { return { ok: false, message: '文件不是合法的 JSON' }; }
  if (!data || data.kind !== CONFIG_KIND || !data.stores || typeof data.stores !== 'object') {
    return { ok: false, message: '这不是诛神空间的全局配置文件' };
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const spec of SPECS) {
    const cfg = data.stores[spec.key];
    if (cfg == null) { skipped.push(spec.label); continue; }
    try {
      const cur = spec.api.getState();
      const patch = spec.apply ? spec.apply(cur, cfg) : cfg;
      spec.api.setState(patch);   // zustand 浅合并：只覆盖 patch 顶层键，保留运行时字段；persist 自动落盘
      applied.push(spec.label);
    } catch {
      skipped.push(spec.label);
    }
  }
  if (applied.length === 0) return { ok: false, message: '配置文件为空或无法识别任何配置项' };
  return {
    ok: true,
    applied,
    skipped,
    message: `已导入 ${applied.length} 项配置${data.includeApiKeys === false ? '（不含密钥，请重填各接口 Key）' : ''}`,
  };
}
