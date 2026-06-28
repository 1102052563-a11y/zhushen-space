/* 演化账本 · 第1期「NPC + 角色」闸门的纯逻辑件
 *
 * 对应第0期 itemLedger，扩到 NPC(add/de) 与 角色(addSkill/deSkill/addTrait/addTitle/…) 两域。
 * 与 item 不同处：NPC/角色的"身份"本就由 AI 直接给（charId="B1"/"C1"、npcId="C1"），
 * 且 store 层已有 nameEq/mergeKeepRich/同名重定向去重——故这里**不做模糊解析**，只做：
 *   ① 同批次精确去重（同一条逻辑指令被解析/复读两次，按 type+id+payload 全等判定）
 *   ② 账本审计（每条裁决记 entity/op/ref/outcome）
 *   ③ 结构化结果（供调用方按需回喂自纠）
 * "目标不存在"(de* no-op)的检测放在 stateParser 的包装器里（用 store 增删前后计数判定，零侵入内层逻辑）。
 */
import { useLedger, type LedgerEntity, type LedgerOutcome } from './ledgerStore';

export interface EvoCtx {
  source: string;
  turn: number;
}

export interface EvoResult {
  ok: boolean;
  entity: LedgerEntity;
  op: string;
  ref: string;
  skipped?: boolean;
  reason?: 'dup' | 'not_found' | 'error';
  detail?: string;
}

const norm = (x: unknown) =>
  String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();

/** payload 全等指纹：只有**完全相同**的指令才判同批次重复（不同列/不同字段→不去重，交给 store 合并/覆盖）。*/
const payloadHash = (p: unknown): string => {
  if (typeof p === 'string') return norm(p);
  try { return norm(JSON.stringify(p)); } catch { return norm(String(p)); }
};

/** 角色指令的 payload 取名（技能/天赋/称号对象用 name/['1']/['0']；de* 的 payload 是字符串名）。*/
export function evoPayloadName(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  const d: any = payload ?? {};
  return String(d.name ?? d['1'] ?? d['0'] ?? d.id ?? '').trim();
}

export function charRef(charId: string, payload: unknown): string {
  const nm = evoPayloadName(payload);
  return nm ? `${charId}:${nm}` : charId;
}
export function npcRef(id: string, payload: any): string {
  const nm = String(payload?.['1'] ?? payload?.name ?? '').split('|')[0].trim();
  return nm ? `${id}:${nm}` : id;
}

export function charDigest(type: string, charId: string, payload: unknown): string {
  return `${type}|${charId}|${payloadHash(payload)}`;
}
export function npcDigest(type: string, id: string, payload: unknown): string {
  return `${type}|${id}|${payloadHash(payload)}`;
}

/** 写一条演化账本事件（任何失败都吞掉，账本绝不阻断主流程）。*/
export function recordEvo(
  entity: LedgerEntity,
  ctx: EvoCtx,
  op: string,
  ref: string,
  outcome: LedgerOutcome,
  detail?: string,
): void {
  try {
    useLedger.getState().append({ turn: ctx.turn, source: ctx.source, entity, op, ref, outcome, detail });
  } catch {
    /* 账本写入失败可忽略 */
  }
}

/** 把未生效的 NPC/角色编辑汇成一段反馈（供后续接回喂自纠；当前阶段未接，留作扩展）。*/
export function buildEvoFeedback(results: EvoResult[], label: string): string {
  const fails = results.filter((r) => !r.ok);
  if (fails.length === 0) return '';
  const lines = fails.map(
    (r) => `- ${r.op}「${r.ref}」未生效：${r.reason === 'not_found' ? '目标不存在（名称不符或早已移除）' : (r.detail ?? '校验未通过')}。`,
  );
  return `# 上一轮有 ${fails.length} 条${label}指令未生效，请只重发修正后的指令（用与现有清单**完全一致**的名称；若目标确已不存在则不要再操作）：\n${lines.join('\n')}`;
}
