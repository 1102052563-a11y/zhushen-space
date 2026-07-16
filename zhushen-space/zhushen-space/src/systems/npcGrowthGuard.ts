/* NPC 成长闸门：阶位 / 等级 / 生物强度档 / 六维 的「变更」护栏（治 NPC 演化数值乱跳）。
 *
 * 定位：登场生成有 ENTRY_COT+量化表、读取端有 lvFromRealm 矛盾夹回 + attrCapForTier 封顶，
 * 但**演化期的变更**此前三通道裸奔——realm 重写无证据/无步长、bioStrength 裸写（而它恰是六维封顶的锚）、
 * 已建档 NPC 六维可整套绝对赋值重写。本模块把"纪律"下沉成代码（Prompt 不是防线）：
 *   - 升阶/升档：正文该 NPC 名附近须有突破类证据词，且一回合最多 +1（世界结算放宽）；
 *   - 降阶/降档/属性下调：须有跌落/封印/致残类证据，否则视为 AI 抖动丢弃（棘轮）；
 *   - 等级/六维步长限幅：无强事件每回合小步走，防"每回合自我强化"螺旋；
 *   - 已建档六维的 `=` 绝对赋值降级为增量收敛（首次生成照常放行，外层仍有 阶位上限+bs峰值 双护栏）；
 *   - 宠物/召唤物数值冻结，仅"主人投入"证据放行（PET_EVOLUTION_RULE 的代码化）；
 *   - 世界巅峰封顶：任务世界内土著/契约者的**上行变更与首次建档**不得超「巅峰战力」提到的最高阶位。
 *
 * 设计对齐 dispositionGuard（就近关键词判定放行 + 限速）与 driftGuard（±win 字 name 锚）。
 * 全部判定纯函数；narrative 等回合上下文经 withGrowthGuardCtx 注入（同步解析期间有效），
 * 无上下文时 guard* 各函数只做合法化不做证据裁决——测试/数据迁移/手动路径行为不变。
 * 被拒/被夹的每一笔都进 仲裁日志（console + 回合洞察快照），玩家可见、可调参。
 */

import {
  TIERS, TIER_LEVEL_RANGE, normalizeTier, realmFromLevel, lvFromRealm,
} from './derivedStats';
import { clampToTierWindow, nominalTierNum, BIO_TIER_NAMES } from './bioStrength';
import { nearName } from './dispositionGuard';

/* ── 可调参数（实测后按仲裁日志调）── */
export const EVIDENCE_WIN = 60;        // 证据词就近窗口：NPC 名 ±60 字
export const TIER_STEP_MAX = 1;        // 有证据时每回合最多升几阶
export const TIER_STEP_SETTLE = 2;     // 世界结算/时间跳跃时放宽到几阶
export const LV_STEP_MAX = 2;          // 同阶每回合 Lv 净增上限（无强事件）
export const LV_STEP_SETTLE = 10;      // 世界结算时 Lv 净增上限（约一整阶）
export const ATTR_STEP_BASE = 2;       // 六维每回合净变下限步长
export const ATTR_STEP_PCT = 0.05;     // 六维每回合净变 = max(BASE, 现值×PCT)
export const ATTR_STEP_STRONG_BASE = 8;    // 强事件（突破/结算）时放宽
export const ATTR_STEP_STRONG_PCT = 0.20;

/* 证据词。升阶/升档/属性大涨：角色自身的突破类事件。 */
export const BREAKTHROUGH_KW = /突破|晋阶|晋升|晋级|进阶|升阶|破境|蜕变|觉醒|进化|飞升|升格|迈入|踏入|跨入/;
/* 降阶/降档/属性永久下调：明确的跌落/封印/致残类事件（临时伤病走 status，不动基础值）。 */
export const DOWNGRADE_KW = /跌落|跌境|降阶|降级|掉阶|修为(?:倒退|尽失|被废|被削|被夺)|被废|自废|废去|封印|吞噬|抽取|抽走|剥夺|诅咒|退化|衰退|致残|残废|断臂|断腿|失明|永久(?:损伤|削弱|失去)/;
/* 宠物/召唤物解冻：仅"主人投入"类事件（喂养/丹药/灌注/契约升级/血脉进化/带练突破）。 */
export const PET_INVEST_KW = /喂养|投喂|喂下|服下|服食|吞服|丹药|灵物|灵果|秘药|灌注|注入|升级契约|契约升级|血脉|觉醒|进化|晋阶|突破|培育|培养|淬炼|洗礼|洗髓/;

/* ── 回合上下文（同步解析期间有效；zustand store 不感知 narrative，靠这里传） ── */
export interface GrowthGuardCtx {
  narrative: string;        // 本回合正文（证据判定的唯一来源）
  settlement?: boolean;     // 本轮带 <世界结算>/时间跳跃 → 步长放宽
  worldPeakTier?: string;   // 当前任务世界「巅峰战力」文本里的最高阶位名（''=不封顶）
}
let _ctx: GrowthGuardCtx | null = null;
export function growthGuardCtx(): GrowthGuardCtx | null { return _ctx; }
/** 在 fn 的同步执行期间挂上回合上下文（解析 AI 回复前套上，解析完自动摘除；可嵌套，内层优先）。 */
export function withGrowthGuardCtx<T>(ctx: GrowthGuardCtx, fn: () => T): T {
  const prev = _ctx;
  _ctx = ctx;
  try { return fn(); } finally { _ctx = prev; }
}

/* ── 仲裁日志：被拒/被夹的每一笔（console 即时 + 攒进缓冲，回合快照时 drain 进回合洞察） ── */
const _arbLog: string[] = [];
const ARB_LOG_MAX = 60;
export function logArbitration(who: string, note: string): void {
  const line = `${who}：${note}`;
  _arbLog.push(line);
  if (_arbLog.length > ARB_LOG_MAX) _arbLog.splice(0, _arbLog.length - ARB_LOG_MAX);
  console.log(`[GrowthGuard] ${line}`);
}
export function drainArbitration(): string[] { return _arbLog.splice(0, _arbLog.length); }

/* ── 工具 ── */
/** 阶位名 → TIERS 序号；认不出 -1。 */
export function tierIdxOf(tier?: string): number {
  const t = normalizeTier(tier);
  return t ? TIERS.indexOf(t as (typeof TIERS)[number]) : -1;
}
/** 文本里提到的最高阶位名（扫 14 阶名取最高；巅峰战力是自由文本，提不出则 '' 不封顶）。 */
export function highestTierIn(text?: string): string {
  const s = text ?? '';
  let hi = -1;
  for (let i = 0; i < TIERS.length; i++) { if (s.includes(TIERS[i])) hi = i; }
  return hi >= 0 ? TIERS[hi] : '';
}

interface RealmParts { tierIdx: number; lv: number | null; id: string }
/** 拆 realm 串 "阶位·Lv.X|身份"：阶位段只认 '|' 前头部；阶位认不出但有 Lv → 按 Lv 推；Lv 与阶位矛盾 → 夹回本阶区间。 */
export function parseRealmParts(s: string): RealmParts {
  const raw = s ?? '';
  const head = raw.split('|')[0];
  const id = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1) : '';
  const mLv = /Lv\.?\s*(\d+)/i.exec(head);
  let lv: number | null = mLv ? Math.max(1, Math.round(Number(mLv[1]))) : null;
  let tierIdx = tierIdxOf(head);
  if (tierIdx < 0 && lv != null) tierIdx = tierIdxOf(realmFromLevel(lv));
  if (tierIdx >= 0 && lv != null) {
    const r = TIER_LEVEL_RANGE[TIERS[tierIdx]];
    if (r) lv = Math.max(r[0], Math.min(r[1], lv));   // 同串矛盾=幻觉，以阶位为准（同 lvFromRealm 口径）
  }
  return { tierIdx, lv, id };
}
function buildRealm(tierIdx: number, lv: number | null, id: string): string {
  const head = lv != null ? `${TIERS[tierIdx]}·Lv.${lv}` : TIERS[tierIdx];
  const idp = (id ?? '').trim();
  return idp ? `${head}|${idp}` : head;
}
function clampLvInto(tierIdx: number, lv: number | null): number | null {
  if (lv == null) return null;
  const r = TIER_LEVEL_RANGE[TIERS[tierIdx]];
  return r ? Math.max(r[0], Math.min(r[1], lv)) : lv;
}

/* ── 阶位/等级变更闸门 ──
 * prevRaw=现存 realm（''/认不出=首次建档→只做巅峰封顶）；nextRaw=AI 想写的 realm。
 * exemptPeak=随从/宠物/召唤物（主角自己人，不受任务世界巅峰约束）。
 * 返回实际落地 realm + 仲裁记录（空数组=原样通过）。ctx 缺失时只做合法化+自洽，不做证据裁决。 */
export function guardRealmChange(
  prevRaw: string | undefined,
  nextRaw: string,
  name: string,
  ctx: GrowthGuardCtx | null = _ctx,
  opts?: { exemptPeak?: boolean },
): { realm: string; notes: string[] } {
  const notes: string[] = [];
  const p = parseRealmParts(prevRaw ?? '');
  const nx = parseRealmParts(nextRaw ?? '');
  const id = nx.id.trim() ? nx.id : p.id;    // 身份段：新值优先，纯数字裁决不拦身份更新

  // next 认不出阶位也推不出 → 纯身份/垃圾串：有旧数字保旧数字，双方都没有则原样（不乱改）
  if (nx.tierIdx < 0) {
    if (p.tierIdx < 0) return { realm: nextRaw, notes };
    return { realm: buildRealm(p.tierIdx, p.lv, id), notes };
  }

  let outIdx = nx.tierIdx;
  let outLv = nx.lv;
  const narrative = ctx?.narrative ?? '';
  const settle = !!ctx?.settlement;

  if (p.tierIdx >= 0 && ctx) {
    if (nx.tierIdx > p.tierIdx) {
      // ── 升阶：要突破证据，一次最多 +TIER_STEP_MAX（结算放宽） ──
      const evid = settle || nearName(name, narrative, BREAKTHROUGH_KW, EVIDENCE_WIN);
      if (!evid) {
        notes.push(`升阶驳回（正文无突破证据）：${TIERS[p.tierIdx]}→${TIERS[nx.tierIdx]} 不予落地`);
        outIdx = p.tierIdx;
        outLv = guardLvSameTier(p, nx.lv, name, ctx, notes);
      } else {
        const step = settle ? TIER_STEP_SETTLE : TIER_STEP_MAX;
        outIdx = Math.min(nx.tierIdx, p.tierIdx + step);
        if (outIdx < nx.tierIdx) notes.push(`升阶限速（一回合最多+${step}阶）：${TIERS[nx.tierIdx]}→${TIERS[outIdx]}`);
        // 刚突破 → 落新阶初期（阶下限 ~ 下限+LV_STEP_MAX），防"突破顺手满级"
        const r = TIER_LEVEL_RANGE[TIERS[outIdx]];
        if (r) {
          const hi = Math.min(r[1], r[0] + LV_STEP_MAX);
          const want = nx.lv ?? r[0];
          outLv = Math.max(r[0], Math.min(hi, want));
          if (nx.lv != null && outLv !== nx.lv && outIdx === nx.tierIdx) notes.push(`突破后等级落初期：Lv.${nx.lv}→Lv.${outLv}`);
        }
      }
    } else if (nx.tierIdx < p.tierIdx) {
      // ── 降阶：要跌落/封印证据，否则棘轮保位 ──
      const evid = nearName(name, narrative, DOWNGRADE_KW, EVIDENCE_WIN);
      if (!evid) {
        notes.push(`降阶驳回（正文无跌落/封印证据）：保持 ${TIERS[p.tierIdx]}`);
        outIdx = p.tierIdx;
        outLv = p.lv;
      } else {
        outLv = clampLvInto(outIdx, nx.lv);
      }
    } else {
      // ── 同阶：Lv 步长限幅 + 降级棘轮 ──
      outLv = guardLvSameTier(p, nx.lv, name, ctx, notes);
    }
  } else {
    // 首次建档 / 无上下文：合法化 + 自洽（parseRealmParts 已做），不做证据裁决
    outLv = clampLvInto(outIdx, nx.lv);
  }

  // ── 世界巅峰封顶：只管"上行"（首档过高 / 变更后高于原值），不追溯既有存量（那是体检 sweep 的事） ──
  const peakIdx = ctx?.worldPeakTier ? tierIdxOf(ctx.worldPeakTier) : -1;
  if (peakIdx >= 0 && !opts?.exemptPeak && outIdx > peakIdx && outIdx > Math.max(p.tierIdx, -1)) {
    notes.push(`超出本世界巅峰战力（${TIERS[peakIdx]}）：${TIERS[outIdx]} 压回`);
    outIdx = Math.max(peakIdx, p.tierIdx);   // 不低于既有档（防"封顶"变成变相降阶）
    outLv = clampLvInto(outIdx, outLv);
  }

  return { realm: buildRealm(outIdx, outLv, id), notes };
}

/* 同阶内 Lv 变更：涨=步长限幅（结算放宽），跌=要证据棘轮。 */
function guardLvSameTier(p: RealmParts, wantLv: number | null, name: string, ctx: GrowthGuardCtx, notes: string[]): number | null {
  if (wantLv == null) return p.lv;                    // 没写 Lv → 保旧
  const want = clampLvInto(p.tierIdx, wantLv)!;
  const cur = p.lv ?? (TIER_LEVEL_RANGE[TIERS[p.tierIdx]]?.[0] ?? 1);
  const delta = want - cur;
  if (delta > 0) {
    const cap = ctx.settlement ? LV_STEP_SETTLE : LV_STEP_MAX;
    if (delta > cap) { notes.push(`升级限速（每回合≤+${cap}）：Lv.${cur}→Lv.${cur + cap}（AI 想给 Lv.${want}）`); return cur + cap; }
    return want;
  }
  if (delta < 0) {
    const evid = nearName(name, ctx.narrative, DOWNGRADE_KW, EVIDENCE_WIN);
    if (!evid) { notes.push(`等级下调驳回（无跌落证据）：保持 Lv.${cur}`); return cur; }
    return want;
  }
  return want;
}

/* ── 生物强度档变更闸门 ──
 * bioStrength 是六维 bs 峰值封顶的锚，绝不能任由 AI 裸写：
 * ① 永远夹进本阶位窗口；② 已有档升档要突破证据且一次一档，降档要证据（棘轮）；
 * ③ 认不出 T 数字的写入：有旧值 → 拒绝覆盖，无旧值 → 原样收（粗段位标签留给机械生成解析）。 */
export function guardBioStrength(
  prevRaw: string | undefined,
  nextRaw: string,
  realm: string | undefined,
  name: string,
  ctx: GrowthGuardCtx | null = _ctx,
): { bs: string; notes: string[] } {
  const notes: string[] = [];
  const nm = /T\s*(\d+)/i.exec(nextRaw ?? '');
  const pm = /T\s*(\d+)/i.exec(prevRaw ?? '');
  if (!nm) {
    if ((prevRaw ?? '').trim() && (nextRaw ?? '').trim() && nextRaw !== prevRaw) {
      notes.push(`bs档改写驳回（新值认不出 T 档）：「${nextRaw}」不落地，保持「${prevRaw}」`);
      return { bs: prevRaw!, notes };
    }
    return { bs: nextRaw, notes };
  }
  const tn = nominalTierNum(realm, lvFromRealm(realm));
  let want = Math.max(0, Math.round(Number(nm[1])));
  const winClamped = clampToTierWindow(want, tn);
  if (winClamped !== want) { notes.push(`bs档夹回本阶窗口：T${want}→T${winClamped}`); want = winClamped; }
  if (pm && ctx) {
    const prev = clampToTierWindow(Math.max(0, Math.round(Number(pm[1]))), tn);
    if (want > prev) {
      const evid = ctx.settlement || nearName(name, ctx.narrative, BREAKTHROUGH_KW, EVIDENCE_WIN);
      if (!evid) { notes.push(`bs升档驳回（正文无突破证据）：T${prev}→T${want} 不予落地`); want = prev; }
      else if (want > prev + 1) { notes.push(`bs升档限速（一回合一档）：T${want}→T${prev + 1}`); want = prev + 1; }
    } else if (want < prev) {
      const evid = nearName(name, ctx.narrative, DOWNGRADE_KW, EVIDENCE_WIN);
      if (!evid) { notes.push(`bs降档驳回（正文无跌落证据）：保持 T${prev}`); want = prev; }
    }
  }
  const label = BIO_TIER_NAMES[want] ?? '';
  return { bs: label ? `T${want}·${label}` : `T${want}`, notes };
}

/* ── 六维变更闸门 ──
 * established=该 NPC 六维已建档（生成过/手动给过）。未建档的 `=` 是生成路径 → 放行（外层仍有 阶位上限+bs峰值 双护栏）；
 * 已建档后一切变更（含 `=`，先折算成与现值的差）走：宠物冻结 → 下调要证据 → 步长限幅（强事件放宽）。
 * 返回实际落地值；note 空=原样通过。 */
export function guardAttrValue(inp: {
  cur: number;
  desired: number;                 // = 的目标值 / +=、-= 的增减量
  op: '=' | '+=' | '-=';
  established: boolean;
  isPet: boolean;
  name: string;
  ctx?: GrowthGuardCtx | null;
}): { value: number; note?: string } {
  const { cur, desired, op, established, isPet, name } = inp;
  const ctx = inp.ctx === undefined ? _ctx : inp.ctx;
  const target = op === '=' ? desired : op === '+=' ? cur + desired : cur - desired;
  if (!established && op === '=') return { value: target };            // 首次生成放行
  if (!ctx) return { value: target };                                  // 无上下文（测试/迁移）不裁决
  const delta = target - cur;
  if (delta === 0) return { value: cur };
  const asked = `${op}${desired}（${cur}→${target}）`;

  if (isPet) {
    const evid = nearName(name, ctx.narrative, PET_INVEST_KW, EVIDENCE_WIN);
    if (!evid) return { value: cur, note: `宠物/召唤物数值冻结（无主人投入证据）：${asked} 驳回` };
  }
  if (delta < 0) {
    const evid = nearName(name, ctx.narrative, DOWNGRADE_KW, EVIDENCE_WIN);
    if (!evid) return { value: cur, note: `属性下调驳回（无致残/削弱证据，临时伤病应走 status）：${asked}` };
  }
  const strong = !!ctx.settlement || nearName(name, ctx.narrative, BREAKTHROUGH_KW, EVIDENCE_WIN);
  const step = strong
    ? Math.max(ATTR_STEP_STRONG_BASE, Math.round(cur * ATTR_STEP_STRONG_PCT))
    : Math.max(ATTR_STEP_BASE, Math.round(cur * ATTR_STEP_PCT));
  if (Math.abs(delta) > step) {
    const value = cur + Math.sign(delta) * step;
    return { value, note: `六维步长限幅（每回合≤${step}${strong ? '·强事件已放宽' : ''}）：${asked} 实落 ${value}` };
  }
  return { value: target };
}
