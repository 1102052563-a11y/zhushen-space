/* 🩺 状态诊断（借鉴 story-oracle「诊断模式」思想·代码全自写——上游无 license，只借交互设计）
   玩家手动触发的「状态 ↔ 正文」对账：AI 读最近楼层正文 + 当前状态快照 → 按「补丁:/依据:」行协议输出
   <state> 行格式的保守补丁 → 前端白名单预检（applyOneUpdate 对未知键**静默跳过**，可用性只能这里把关）→
   玩家逐条勾选 → 包成 <state> 块走 applyStateUpdates 正规管道（点数只在世界结算发放等既有护栏全部生效）→
   撤销 = 应用前按 key 记录旧值生成逆补丁，走同一条管道回写。
   ⚠ 范围刻意窄：主角/在场 NPC 的 HP/EP/SAN、自定义资源条、货币、自定义变量——物品/NPC 档案/六维各有
     演化+对账阶段，不归这里（白名单直接拒掉并说明去处）。story-oracle 的 AUTO 常驻刻意不借：
     本作演化流水线已每回合维护状态，常驻自动诊断会双写打架。
   UI：components/StateDoctorPanel.tsx（变量管理页底部）；提示词：promptRules.STATE_DOCTOR_RULE；接口：featureKey 'stateDoctor'。 */
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useResource } from '../store/resourceStore';
import { useVariables } from '../store/variableStore';
import { usePlayer } from '../store/playerStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { STATE_DOCTOR_RULE } from '../promptRules';
import { applyStateUpdates } from './stateApply';

export interface DoctorScopes { player: boolean; npcs: boolean; resources: boolean; currency: boolean; vars: boolean }
export const DOCTOR_SCOPE_DEFS: { id: keyof DoctorScopes; label: string }[] = [
  { id: 'player',    label: '主角 HP/EP/SAN' },
  { id: 'npcs',      label: '在场 NPC 生命' },
  { id: 'resources', label: '自定义资源条' },
  { id: 'currency',  label: '货币' },
  { id: 'vars',      label: '自定义变量' },
];

export interface DoctorKeyInfo { ok: boolean; scope?: string; current?: string; rejectReason?: string }
export interface DoctorPatch {
  line: string; key: string; op: '=' | '+=' | '-='; value: string;
  reason: string; ok: boolean; scope?: string; current?: string; predicted?: string; rejectReason?: string;
}
export interface DoctorReport { patches: DoctorPatch[]; clean: boolean; raw: string }

/* ── 白名单预检：与 stateApply.applyOneUpdate 的真实路由一一对应 ── */
export function describeDoctorKey(key: string): DoctorKeyInfo {
  // 主角 HP/EP/SAN（裸键 或 .B1 后缀）
  let m = key.match(/^(hp|mp|san)(?:\.B1)?$/);
  if (m) {
    const cur = (useGame.getState().player as any)[m[1]];   // 动态键读数值字段（仓库惯用防御性摊平）
    return { ok: true, scope: '主角', current: cur == null ? undefined : String(cur) };
  }
  if (/^(maxHp|maxMp)(?:\.B1)?$/.test(key)) return { ok: false, rejectReason: 'HP/EP 上限由六维系数表自动换算，改当前值即可' };
  if (/^(maxSan|atk|def|points)(?:\.B1)?$/.test(key)) return { ok: false, rejectReason: '衍生/结算类数值不归诊断（ATK/DEF 由六维+装备衍生，点数只在世界结算发放）' };
  // NPC HP/EP（hp.C*/mp.C*，applyOneUpdate 只建模这两个）
  m = key.match(/^(hp|mp)\.([CG]\w*)$/);
  if (m) {
    const rec = useNpc.getState().npcs[m[2]];
    if (!rec) return { ok: false, rejectReason: `没有 id 为 ${m[2]} 的 NPC 档案` };
    const cur = (rec as any)[m[1]];
    return { ok: true, scope: `NPC·${String(rec.name || m[2]).split('|')[0]}`, current: cur == null ? undefined : String(cur) };
  }
  if (/^(san|maxHp|maxMp|maxSan)\.[CG]\w*$/.test(key)) return { ok: false, rejectReason: 'NPC 只支持 hp/mp 当前值（上限自动换算，SAN 未建模）' };
  // 自定义资源条（只认玩家已定义的）
  m = key.match(/^res\.(?:B1\.)?([A-Za-z][\w-]*)$/);
  if (m) {
    const rid = m[1];
    const def = useResource.getState().resources.find((r) => r.id === rid || r.name === rid);
    if (!def) return { ok: false, rejectReason: `没有 id 为 ${rid} 的自定义资源条` };
    return { ok: true, scope: `资源条·${def.name || def.id}`, current: String(def.cur ?? 0) };
  }
  // 货币（乐园币/灵魂钱币走 scanCjk 补扫；点数类只在世界结算发放 → 拒）
  m = key.match(/^(?:currency\.)?(乐园币|灵魂钱币|魂币)$/);
  if (m) {
    const name = (m[1] === '魂币' ? '灵魂钱币' : m[1]) as '乐园币' | '灵魂钱币';
    return { ok: true, scope: '货币', current: String(useItems.getState().currency[name] ?? 0) };
  }
  if (/^(?:currency\.)?(技能点|黄金技能点)$/.test(key)) return { ok: false, rejectReason: '点数类只在世界结算发放，不归诊断' };
  if (/^(当地货币|本地货币)$/.test(key)) {
    const M = useMisc.getState();
    return { ok: true, scope: `货币·${M.localCurrencyName || '当地货币'}`, current: String(M.localCurrency ?? 0) };
  }
  // 档案/物品类 → 指路去正确的工具
  if (/^(character|characters|npc|faction|cr|pr|loc|tm)\./.test(key)) return { ok: false, rejectReason: 'NPC/角色档案类不归诊断（用 ♻ 重算变量 → 主角/NPC）' };
  if (/^(eq|uneq|item|ca|rc|outfit|穿搭)\./.test(key)) return { ok: false, rejectReason: '物品/装备/穿搭不归诊断（走物品对账或手动操作）' };
  // 自定义变量（精确键）
  const def = useVariables.getState().variables.find((v) => v.key === key);
  if (def) return { ok: true, scope: '变量', current: String(def.value ?? '') };
  return { ok: false, rejectReason: '不在诊断白名单（未定义的变量键）' };
}

/* ── 行协议解析 ── */
const PATCH_LINE_RE = /^([\w.一-龥]+)\s*([+\-]?=)\s*(.+)$/;
export function parsePatchLine(line: string): { key: string; op: '=' | '+=' | '-='; value: string } | null {
  const m = String(line ?? '').trim().match(PATCH_LINE_RE);
  if (!m) return null;
  return { key: m[1], op: m[2] as '=' | '+=' | '-=', value: m[3].trim() };
}

export function buildPatch(lineRaw: string, reason: string): DoctorPatch {
  const line = String(lineRaw ?? '').trim();
  const p = parsePatchLine(line);
  if (!p) return { line, key: '', op: '=', value: '', reason, ok: false, rejectReason: '不是合法的 key = value 指令行' };
  const info = describeDoctorKey(p.key);
  let predicted: string | undefined;
  const num = Number(p.value);
  if (info.ok && info.current != null && Number.isFinite(num) && Number.isFinite(Number(info.current))) {
    const cur = Number(info.current);
    predicted = String(p.op === '+=' ? cur + num : p.op === '-=' ? cur - num : num);
  }
  return { line, key: p.key, op: p.op, value: p.value, reason, ok: info.ok, scope: info.scope, current: info.current, predicted, rejectReason: info.rejectReason };
}

/** 解析军医回包：「补丁:/依据:」成对行；同键去重（留第一条）；上限 12 条；「无需修复」=clean。 */
export function parseDoctorReply(text: string): DoctorReport {
  const raw = String(text ?? '');
  const patches: DoctorPatch[] = [];
  let pendingLine: string | null = null;
  const flush = (reason: string) => { if (pendingLine != null) { patches.push(buildPatch(pendingLine, reason)); pendingLine = null; } };
  for (const l of raw.split('\n')) {
    const line = l.trim().replace(/^[>*\-•]+\s*/, '');
    let m = /^补丁\s*[:：]\s*(.+)$/.exec(line);
    if (m) { flush(''); pendingLine = m[1].trim(); continue; }
    m = /^依据\s*[:：]\s*(.+)$/.exec(line);
    if (m) { flush(m[1].trim()); continue; }
  }
  flush('');
  const seen = new Set<string>();
  const dedup = patches.filter((p) => { if (!p.key) return true; if (seen.has(p.key)) return false; seen.add(p.key); return true; }).slice(0, 12);
  const clean = dedup.length === 0 && /无需修复/.test(raw);
  return { patches: dedup, clean, raw };
}

/* ── 撤销：应用前记录旧值 → 逆补丁走同一条 <state> 管道 ── */
export function fmtVarValue(type: string | undefined, value: unknown): string {
  if (type === 'number') return String(Number(value) || 0);
  if (type === 'boolean') return value ? 'true' : 'false';
  return `"${String(value ?? '').replace(/"/g, '\'').slice(0, 200)}"`;
}

/** 生成某 key 的「回到当前值」逆补丁行（应用前调用=记录旧值）。取不到旧值返回 null（该条不可撤销）。 */
export function inverseLine(key: string): string | null {
  let m = key.match(/^(hp|mp|san)(?:\.B1)?$/);
  if (m) { const cur = (useGame.getState().player as any)[m[1]]; return cur == null ? null : `${m[1]}.B1 = ${cur}`; }
  m = key.match(/^(hp|mp)\.([CG]\w*)$/);
  if (m) { const rec = useNpc.getState().npcs[m[2]]; const cur = rec ? (rec as any)[m[1]] : null; return cur == null ? null : `${key} = ${cur}`; }
  m = key.match(/^res\.(?:B1\.)?([A-Za-z][\w-]*)$/);
  if (m) { const rid = m[1]; const def = useResource.getState().resources.find((r) => r.id === rid || r.name === rid); return def ? `res.${def.id} = ${def.cur ?? 0}` : null; }
  m = key.match(/^(?:currency\.)?(乐园币|灵魂钱币|魂币)$/);
  if (m) { const name = (m[1] === '魂币' ? '灵魂钱币' : m[1]) as '乐园币' | '灵魂钱币'; return `${name} = ${useItems.getState().currency[name] ?? 0}`; }
  if (/^(当地货币|本地货币)$/.test(key)) return `当地货币 = ${useMisc.getState().localCurrency ?? 0}`;
  const def = useVariables.getState().variables.find((v) => v.key === key);
  if (def) return `${key} = ${fmtVarValue(def.type, def.value)}`;
  return null;
}

export interface DoctorApplyResult { applied: number; failed: string[]; undoLines: string[] }

/** 应用勾选补丁：先记逆补丁，再包 <state> 走 applyStateUpdates 正规管道（既有护栏全生效）。 */
export function applyDoctorPatches(patches: DoctorPatch[]): DoctorApplyResult {
  const ok = patches.filter((p) => p.ok);
  if (!ok.length) return { applied: 0, failed: [], undoLines: [] };
  const undoLines: string[] = [];
  const seen = new Set<string>();
  for (const p of ok) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const inv = inverseLine(p.key);
    if (inv) undoLines.push(inv);
  }
  const res = applyStateUpdates(`<state>\n${ok.map((p) => p.line).join('\n')}\n</state>`);
  return { applied: res.applied, failed: res.failed, undoLines };
}

export function undoDoctorPatches(undoLines: string[]): { applied: number; failed: string[] } {
  if (!undoLines?.length) return { applied: 0, failed: [] };
  return applyStateUpdates(`<state>\n${undoLines.join('\n')}\n</state>`);
}

/* ── 快照上下文（只列可写键，AI 键名照抄）── */
export function buildDoctorContext(scopes: DoctorScopes): string {
  const L: string[] = ['【当前状态快照·只允许对下列「可写键」出补丁】'];
  if (scopes.player) {
    const P = useGame.getState().player;
    const name = usePlayer.getState().profile.name || '主角';
    L.push(`■ 主角 ${name}（B1）：HP ${P.hp}/${P.maxHp}｜EP ${P.mp}/${P.maxMp}｜SAN ${P.san}/${P.maxSan}\n  可写键：hp.B1｜mp.B1｜san.B1（mp=能量EP；上限自动换算、不可写）`);
  }
  if (scopes.npcs) {
    const npcs = Object.entries(useNpc.getState().npcs)
      .filter(([, n]) => n.onScene && !n.isDead && !n.archived)
      .slice(0, 12);
    if (npcs.length) {
      L.push('■ 在场 NPC：\n' + npcs.map(([id, n]) => `  ${id}·${String(n.name || id).split('|')[0]}：HP ${n.hp ?? '?'}/${n.maxHp ?? '?'}｜EP ${n.mp ?? '?'}/${n.maxMp ?? '?'} → 可写 hp.${id}｜mp.${id}`).join('\n'));
    }
  }
  if (scopes.resources) {
    const rs = useResource.getState().resources.slice(0, 12);
    if (rs.length) L.push('■ 自定义资源条：\n' + rs.map((r) => `  res.${r.id}（${r.name || r.id}）＝ ${r.cur ?? 0}`).join('\n'));
  }
  if (scopes.currency) {
    const C = useItems.getState().currency;
    const M = useMisc.getState();
    const local = M.localCurrencyName ? `｜${M.localCurrencyName}(当地货币) ${M.localCurrency ?? 0}` : '';
    L.push(`■ 货币：乐园币 ${C['乐园币'] ?? 0}｜灵魂钱币 ${C['灵魂钱币'] ?? 0}${local}\n  可写键：乐园币｜灵魂钱币${M.localCurrencyName ? '｜当地货币' : ''}（技能点等点数类不可写）`);
  }
  if (scopes.vars) {
    const vs = useVariables.getState().variables.slice(0, 40);
    if (vs.length) L.push('■ 自定义变量（键名照抄）：\n' + vs.map((v) => `  ${v.key} = ${String(v.value ?? '').slice(0, 40)}（${v.type}）`).join('\n'));
  }
  if (L.length === 1) L.push('（未勾选任何范围）');
  return L.join('\n');
}

/** 最近正文（对账依据）：读 chatDb 增量库（动态 import——单测/无 IDB 环境不因模块导入就摸 IndexedDB）。 */
async function loadRecentNarrative(): Promise<string> {
  const { loadAll } = await import('./chatDb');
  const all = await loadAll();
  const tail = all.filter((m) => m.role === 'user' || (m.role === 'assistant' && !String(m.content || '').startsWith('🎬'))).slice(-8);
  const parts: string[] = [];
  let total = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    const t = `【${tail[i].role === 'user' ? '主角行动' : '正文'}】\n${String(tail[i].content || '').trim()}`;
    total += t.length;
    parts.unshift(t);
    if (total > 7000) break;
  }
  return parts.join('\n\n');
}

/** 跑一次诊断（一次调用·旁路·不进正文上下文）。抛错=人话错误信息。 */
export async function runStateDoctor(scopes: DoctorScopes, extra?: string): Promise<DoctorReport> {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('stateDoctor', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（回退正文 API 也未配置）——先到 设置→综合设置 配正文接口，或在下方「接口路由」单独指定');
  const ctx = buildDoctorContext(scopes);
  const narrative = await loadRecentNarrative();
  if (!narrative.trim()) throw new Error('没有可对账的正文（先玩几个回合再来）');
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('STATE_DOCTOR_RULE', STATE_DOCTOR_RULE) },
    { role: 'user', content: `${ctx}\n\n【最近正文（对账依据）】\n${narrative}\n${extra?.trim() ? `\n【玩家附加要求】${extra.trim().slice(0, 300)}\n` : ''}\n请对照快照与正文，输出诊断补丁（或「无需修复」）：` },
  ], { label: '状态诊断', timeoutMs: 180000, rawLang: true });
  const rep = parseDoctorReply(String(content ?? ''));
  // 模型没按协议输出补丁行时：若通篇是「一致/没有问题」的意思，也当 clean 处理（原文透传给面板展示）
  if (!rep.patches.length && !rep.clean && /没有|不需要|一致|无误/.test(rep.raw)) return { ...rep, clean: true };
  return rep;
}
