/* 第3期「统一编辑语言 <edit>」翻译器（A）
 *
 * 把一种**统一、UID 优先**的紧凑编辑语法翻译成既有命令对象（ItemCommand/CharCommand/NpcCommand/FactionCommand），
 * 再由既有闸门(applyItemCommands/applyCharacterCommands/…)落地。**与 <state>/<upstore> 完全等效、可混用、向后兼容**——
 * 做法是让 stateParser 的 parseAll*Commands 同时认 <upstore> 与 <edit>，故所有落地点零改动即生效。
 *
 * 语法（每行一条；空行 / 以 # 或 // 开头的行忽略）：
 *   item.add   {…}                       新建物品（owner 键可选，默认 B1）
 *   item.set   <ref> {…}                 改物品字段（patch）；{qty:N} 会改数量
 *   item.use   <ref> [xN] (原因)         消耗
 *   item.del   <ref> (原因)              销毁/丢弃
 *   item.equip <ref> / item.unequip <ref>
 *   item.move  <ref> ->C1 [xN] (原因)    转给某人；<-C1 = 从某人取来
 *   cur.add 乐园币 300 (原因) / cur.sub 灵魂钱币 50
 *   skill.add  <charId> {…} / skill.del <charId> 技能名
 *   trait.add  <charId> {…} / trait.del <charId> 天赋名
 *   title.add  <charId> {…} / title.del <charId> 称号名 / title.equip <charId> 称号名
 *   npc.set    <id> {…} / npc.leave <id>
 *   fac.set    <id> {…} / fac.leave <id>
 *   <ref> = #uid（稳定 id）| "带空格的名字" | 名字
 *
 * 值仍需带引号（如 {name:"铁剑"}）——沿用 <upstore> 同款宽松 JSON（裸键/单引号/尾逗号容错）。
 */
import type { ItemCommand } from './stateParser';
import type { CharCommand } from './stateParser';
import type { NpcCommand, FactionCommand } from './stateParser';

/* 本地宽松 JSON（与 stateParser.lenientJsonParse 同逻辑·复制以避免循环依赖）：容忍裸键/单引号/尾逗号/中文弯引号。*/
function ljson(s: string): any {
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");   // “”‘’ → 直引号（中文模型常输出弯引号致 JSON.parse 失败）
  const quoteKeys = (x: string) => x.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*):/g, '$1"$2"$3:');
  const stripTrailingCommas = (x: string) => x.replace(/,(\s*[}\]])/g, '$1');
  const cands = [s, quoteKeys(s), stripTrailingCommas(quoteKeys(s)), stripTrailingCommas(quoteKeys(s.replace(/'/g, '"')))];
  for (const c of cands) { try { return JSON.parse(c); } catch { /* 试下一种 */ } }
  return undefined;
}

/* 全角数字 → 半角（数量/金额容错）。*/
const toHalf = (s: string) => s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));

/* 域别名：让 AI 写 currency/faction/talent 也认。*/
const DOMAIN_ALIAS: Record<string, string> = { currency: 'cur', money: 'cur', faction: 'fac', talent: 'trait' };
/* 动词别名（按域）：宽容 AI 用近义词（create/update/remove/consume/give…）。*/
const VERB_ALIAS: Record<string, Record<string, string>> = {
  item:  { create: 'add', new: 'add', update: 'set', modify: 'set', edit: 'set', consume: 'use', remove: 'del', discard: 'del', drop: 'del', destroy: 'del', transfer: 'move', give: 'move', gift: 'move' },
  cur:   { gain: 'add', earn: 'add', plus: 'add', spend: 'sub', pay: 'sub', lose: 'sub', cost: 'sub', deduct: 'sub', minus: 'sub' },
  skill: { remove: 'del', learn: 'add', forget: 'del', delete: 'del' },
  trait: { remove: 'del', learn: 'add', forget: 'del', delete: 'del' },
  title: { remove: 'del', grant: 'add', wear: 'equip', delete: 'del' },
  npc:   { add: 'set', update: 'set', upsert: 'set', remove: 'leave', exit: 'leave', del: 'leave', delete: 'leave' },
  fac:   { add: 'set', update: 'set', upsert: 'set', remove: 'leave', exit: 'leave', del: 'leave', delete: 'leave' },
};

function extractEditBlocks(text: string): string[] {
  const re = /<edit\b[^>]*>([\s\S]*?)<\/edit>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  // 容忍截断流：未闭合的末尾 <edit> 也收
  const open = text.match(/<edit\b[^>]*>([\s\S]*)$/i);
  if (open && !/<\/edit>/i.test(open[1])) blocks.push(open[1]);
  return blocks;
}

interface EditLine { domain: string; verb: string; verbRaw: string; rest: string; json?: any; reason?: string; raw: string; }

function parseLine(raw: string): EditLine | null {
  const line = raw.trim();
  if (!line || line.startsWith('//') || line.startsWith('#')) return null;
  const m = line.match(/^([a-zA-Z]+)\.([a-zA-Z]+)\s*([\s\S]*)$/);
  if (!m) return null;
  let rest = m[3];
  // 原因：末尾 (……) 或 ~……
  let reason: string | undefined;
  const pr = rest.match(/\(([^)]*)\)\s*$/);
  if (pr) { reason = pr[1].trim(); rest = rest.slice(0, pr.index).trim(); }
  else { const tr = rest.match(/~\s*([^~]+)$/); if (tr) { reason = tr[1].trim(); rest = rest.slice(0, tr.index).trim(); } }
  // JSON 体
  let json: any;
  const jm = rest.match(/\{[\s\S]*\}/);
  if (jm) { json = ljson(jm[0]); rest = (rest.slice(0, jm.index) + rest.slice(jm.index! + jm[0].length)).trim(); }
  const d0 = m[1].toLowerCase();
  const domain = DOMAIN_ALIAS[d0] ?? d0;
  const v0 = m[2].toLowerCase();
  const verb = VERB_ALIAS[domain]?.[v0] ?? v0;
  return { domain, verb, verbRaw: m[2], rest: rest.trim(), json, reason, raw: line };
}

/* 从 rest 拆出修饰符：xN（数量）、->owner（转给）、<-owner（取自），剩余为 ref。*/
function pullMods(rest: string): { ref: string; qty?: number; to?: string; from?: string } {
  let r = rest;
  let qty: number | undefined, to: string | undefined, from: string | undefined;
  const xm = r.match(/(?:^|\s)[x×*]\s*([0-9０-９]+)/i); if (xm) { qty = parseInt(toHalf(xm[1]), 10); r = (r.slice(0, xm.index) + r.slice(xm.index! + xm[0].length)).trim(); }
  const tm = r.match(/(?:->|→|—>|=>)\s*(\S+)/); if (tm) { to = tm[1]; r = (r.slice(0, tm.index) + r.slice(tm.index! + tm[0].length)).trim(); }
  const fm = r.match(/(?:<-|←|<=)\s*(\S+)/); if (fm) { from = fm[1]; r = (r.slice(0, fm.index) + r.slice(fm.index! + fm[0].length)).trim(); }
  return { ref: r.trim(), qty, to, from };
}

/* ref → {itemId} 或 {name}：以 # 开头取稳定 id，否则当名字（去引号）。*/
function refToTarget(ref: string): { itemId?: string; name?: string } {
  const s = ref.replace(/^["']|["']$/g, '').trim();
  if (!s) return {};
  if (s.startsWith('#')) return { itemId: s.slice(1) };
  return { name: s };
}

/* 拆出第一个 token（charId/npcId）与其余（名字）。*/
function splitFirst(rest: string): [string, string] {
  const t = rest.trim();
  const i = t.search(/\s/);
  if (i < 0) return [t, ''];
  return [t.slice(0, i), t.slice(i + 1).trim()];
}

/** 归一物品 json 的简写键：cat→category（其余键名与既有 createItem/updateItem 一致）。*/
function normItemData(j: any): any {
  if (!j || typeof j !== 'object') return j ?? {};
  const d = { ...j };
  if (d.cat != null && d.category == null) { d.category = d.cat; delete d.cat; }
  return d;
}

function toItemCommands(e: EditLine): ItemCommand[] {
  const out: ItemCommand[] = [];
  const push = (type: any, data: any) => out.push({ type, data, raw: e.raw });

  if (e.domain === 'cur') {
    const [type, amtTok] = splitFirst(e.rest);
    const amount = parseInt(toHalf(String(amtTok ?? e.json?.amount ?? '0')).replace(/[^\d]/g, ''), 10) || 0;
    if (!type || amount <= 0) return out;
    if (e.verb === 'add') push('transferCurrency', { type, amount, to: 'B1', reason: e.reason });
    else if (e.verb === 'sub') push('transferCurrency', { type, amount, from: 'B1', reason: e.reason });
    return out;
  }

  if (e.domain !== 'item') return out;
  const mods = pullMods(e.rest);
  const tgt = refToTarget(mods.ref);
  switch (e.verb) {
    case 'add':
      push('createItem', normItemData(e.json ?? {}));
      break;
    case 'set': {
      const data = normItemData(e.json ?? {});
      if (data.qty != null || data.quantity != null) {
        const nq = Number(data.qty ?? data.quantity);
        if (Number.isFinite(nq)) push('updateItemQuantity', { ...tgt, newQuantity: nq });
        delete data.qty; delete data.quantity;
      }
      if (Object.keys(data).length) push('updateItem', { ...tgt, patch: data });
      break;
    }
    case 'use':
      push('consumeItem', { ...tgt, quantity: mods.qty ?? 1, reason: e.reason });
      break;
    case 'del':
      push('destroyItem', { ...tgt, reason: e.reason });
      break;
    case 'equip':
      push('equipItem', { ...tgt, slot: e.json?.slot });
      break;
    case 'unequip':
      push('unequipItem', { ...tgt });
      break;
    case 'move':
    case 'give':
      if (mods.from) push('transferItem', { ...tgt, from: mods.from, to: 'B1', quantity: mods.qty ?? 1, reason: e.reason });
      else push('transferItem', { ...tgt, from: 'B1', to: mods.to ?? null, quantity: mods.qty ?? 1, reason: e.reason });
      break;
  }
  return out;
}

const CHAR_DOMAIN_VERB: Record<string, Record<string, string>> = {
  skill: { add: 'addSkill', del: 'deSkill' },
  trait: { add: 'addTrait', del: 'deTrait' },
  title: { add: 'addTitle', del: 'deTitle', equip: 'equipTitle' },
};

function toCharCommands(e: EditLine): CharCommand[] {
  const map = CHAR_DOMAIN_VERB[e.domain];
  if (!map) return [];
  const type = map[e.verb];
  if (!type) return [];
  const [charId, nameRest] = splitFirst(e.rest);
  if (!charId) return [];
  const payload = e.verb === 'add' ? (e.json ?? {}) : nameRest.replace(/^["']|["']$/g, '').trim();
  if (e.verb !== 'add' && !payload) return [];
  return [{ type: type as any, charId, payload, raw: e.raw }];
}

function toNpcCommands(e: EditLine): NpcCommand[] {
  if (e.domain !== 'npc') return [];
  const [id] = splitFirst(e.rest);
  if (!id) return [];
  if (e.verb === 'set') return [{ type: 'add', id, payload: e.json ?? {}, raw: e.raw }];
  if (e.verb === 'leave' || e.verb === 'del') return [{ type: 'de', id, raw: e.raw }];
  return [];
}

function toFactionCommands(e: EditLine): FactionCommand[] {
  if (e.domain !== 'fac' && e.domain !== 'faction') return [];
  const [id] = splitFirst(e.rest);
  if (!id) return [];
  if (e.verb === 'set') return [{ type: 'add', id, payload: e.json ?? {}, raw: e.raw }];
  if (e.verb === 'leave' || e.verb === 'del') return [{ type: 'de', id, raw: e.raw }];
  return [];
}

function eachLine(text: string): EditLine[] {
  const out: EditLine[] = [];
  for (const block of extractEditBlocks(text)) {
    for (const raw of block.split('\n')) { const e = parseLine(raw); if (e) out.push(e); }
  }
  return out;
}

export function parseEditItems(text: string): ItemCommand[] {
  if (!/<edit\b/i.test(text)) return [];
  return eachLine(text).flatMap(toItemCommands);
}
export function parseEditChars(text: string): CharCommand[] {
  if (!/<edit\b/i.test(text)) return [];
  return eachLine(text).flatMap(toCharCommands);
}
export function parseEditNpcs(text: string): NpcCommand[] {
  if (!/<edit\b/i.test(text)) return [];
  return eachLine(text).flatMap(toNpcCommands);
}
export function parseEditFactions(text: string): FactionCommand[] {
  if (!/<edit\b/i.test(text)) return [];
  return eachLine(text).flatMap(toFactionCommands);
}

/* ── 领地 / 冒险团：透传到既有 <upstore> 函数调用 ──
 * 这两域的应用器(applyTerritoryCommands/applyTeamCommands)是"扫 <upstore> 里 funcName(...) "的文本式聚合器，
 * 没有命令对象可翻译。故把 `territory.<函数名> [ref] {json}` / `team.<函数名> …` 透传成 `函数名(ref, {json})`，
 * 拼成一个合成 <upstore> 块，调用方把它接到 reply 后面一起喂给原应用器即可（原应用器零改动）。
 * verbRaw 保留原大小写——领地/团函数名是 camelCase(addBuilding/upsertMember…)，不能被小写化。 */
function passthroughCall(e: EditLine): string {
  const parts: string[] = [];
  const ref = e.rest.replace(/^#/, '').replace(/^["']|["']$/g, '').trim();
  if (ref) parts.push(JSON.stringify(ref));
  if (e.json !== undefined) parts.push(JSON.stringify(e.json));
  return `${e.verbRaw}(${parts.join(', ')})`;
}
function editPassthroughText(text: string, domain: string): string {
  if (!/<edit\b/i.test(text)) return '';
  const calls = eachLine(text).filter((e) => e.domain === domain && e.verbRaw).map(passthroughCall);
  return calls.length ? `<upstore>\n${calls.join('\n')}\n</upstore>` : '';
}
export function editToTerritoryText(text: string): string { return editPassthroughText(text, 'territory'); }
export function editToTeamText(text: string): string { return editPassthroughText(text, 'team'); }
