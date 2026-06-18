import type { ItemCategory, CurrencyWallet } from '../store/itemStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useNpc, defaultNpcRecord, isNpcId } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam, type TeamRank } from '../store/adventureTeamStore';
import { usePlayer } from '../store/playerStore';
import { useSettings } from '../store/settingsStore';
import { resolveEquipSlot } from './equipSlots';

/* ════════════════════════════════════════════
   <state> 块 — 通用 key=value 变量更新
════════════════════════════════════════════ */

export interface StateUpdate {
  key: string;
  op: '=' | '+=' | '-=';
  value: string | number | boolean;
  raw: string;
}

export function extractStateBlocks(text: string): string[] {
  const re = /<state\b[^>]*>([\s\S]*?)<\/state>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

export function stripStateBlocks(text: string): string {
  return text
    .replace(/<state\b[^>]*>[\s\S]*?<\/state>/gi, '')
    .replace(/<state\b[^>]*>[\s\S]*$/i, '')
    .replace(/<upstore\b[^>]*>[\s\S]*?<\/upstore>/gi, '')
    .replace(/<upstore\b[^>]*>[\s\S]*$/i, '')
    .replace(/<battle\b[^>]*\/>/gi, '')
    .replace(/<battle\b[^>]*>[\s\S]*?<\/battle>/gi, '')
    .replace(/<battle\b[^>]*>[\s\S]*$/i, '')
    .trimEnd();
}

function parseLine(line: string): StateUpdate | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null;

  const itemMatch = trimmed.match(/^item\.(add|remove|create|consume|equip|unequip|destroy)\s*=\s*(.+)$/i);
  if (itemMatch) {
    return { key: `item.${itemMatch[1].toLowerCase()}`, op: '=', value: itemMatch[2].trim(), raw: line };
  }

  const match = trimmed.match(/^([\w.]+)\s*([-+]?=)\s*([\s\S]*)$/);
  if (!match) return null;

  const [, key, op, rawVal] = match;
  const value = parseValue(rawVal.trim());
  if (value === undefined) return null;
  return { key, op: op as StateUpdate['op'], value, raw: line };
}

function parseValue(s: string): StateUpdate['value'] | undefined {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '') return undefined;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return s;
}

export function parseStateBlock(blockContent: string): StateUpdate[] {
  return blockContent.split('\n').flatMap((line) => { const u = parseLine(line); return u ? [u] : []; });
}

export function parseAllStateUpdates(text: string): StateUpdate[] {
  return extractStateBlocks(text).flatMap(parseStateBlock);
}

/* ════════════════════════════════════════════
   <upstore> 块 — 物品 helper 函数指令
════════════════════════════════════════════ */

export type ItemCommandType =
  | 'createItem'
  | 'consumeItem'
  | 'destroyItem'
  | 'transferSpiritStones'  // 兼容旧预设
  | 'transferCurrency'      // 新货币指令
  | 'equipItem'
  | 'unequipItem'
  | 'updateItem'
  | 'updateItemQuantity'
  | 'transferItem';

export interface ItemCommand {
  type: ItemCommandType;
  data: any;
  raw: string;
}

export function extractUpstoreBlocks(text: string): string[] {
  const re = /<upstore\b[^>]*>([\s\S]*?)<\/upstore>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

/* 宽松 JSON 解析：容忍 AI 常见的非标准写法——**裸键(无引号)**、单引号字符串、尾随逗号。
   先按标准 JSON 试，失败再逐步放宽（给裸键补引号 / 单引号转双引号 / 去尾逗号）。都失败返回 undefined。
   注：裸键正则只匹配 { 或 , 之后紧跟的 ASCII 标识符，不会误伤中文字符串值里的全角「：，」。 */
export function lenientJsonParse(s: string): any {
  const quoteKeys = (x: string) => x.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*):/g, '$1"$2"$3:');
  const stripTrailingCommas = (x: string) => x.replace(/,(\s*[}\]])/g, '$1');
  const candidates = [
    s,
    quoteKeys(s),
    stripTrailingCommas(quoteKeys(s)),
    stripTrailingCommas(quoteKeys(s.replace(/'/g, '"'))),
  ];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* 试下一种放宽方式 */ }
  }
  return undefined;
}

// 从 upstore 块中提取 helper 函数调用
// 格式: createItem({...}) / consumeItem({...}) 等
function parseUpstoreBlock(block: string): ItemCommand[] {
  const commands: ItemCommand[] = [];
  // 匹配 funcName({...}) 格式，支持嵌套大括号
  const re = /\b(createItem|consumeItem|destroyItem|transferSpiritStones|transferCurrency|equipItem|unequipItem|updateItem|updateItemQuantity|transferItem)\s*\((\{[\s\S]*?\})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const type = m[1] as ItemCommandType;
    const data = lenientJsonParse(m[2]);
    if (data !== undefined) commands.push({ type, data, raw: m[0] });
    else console.warn('[Upstore] 解析失败:', m[0]);
  }
  // 兼容 AI（尤其轻量模型）把 updateItem 写成 XML 标签的情况：
  // <updateItem itemId="" name=""><affix><item>…</item></affix><effect><item>…</item></effect></updateItem>
  const xmlRe = /<updateItem\b([^>]*)>([\s\S]*?)<\/updateItem>/gi;
  let xm: RegExpExecArray | null;
  while ((xm = xmlRe.exec(block)) !== null) {
    const attrs = xm[1], inner = xm[2];
    const attr = (n: string) => new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1];
    const itemId = attr('itemId'); const name = attr('name');
    const patch: Record<string, string> = {};
    // 每个子标签(affix/effect/combatStat…) → 字段；标签内可有多条 <item>，拼成一段文本
    const fieldRe = /<([a-zA-Z]\w*)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(inner)) !== null) {
      const tag = fm[1]; if (tag === 'item') continue;
      const items = [...fm[2].matchAll(/<item>([\s\S]*?)<\/item>/g)].map((x) => x[1].trim()).filter(Boolean);
      const val = (items.length ? items.join(' ') : fm[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (val) patch[tag] = val;
    }
    if ((itemId || name) && Object.keys(patch).length) commands.push({ type: 'updateItem', data: { itemId, name, patch }, raw: xm[0] });
  }
  return commands;
}

export function parseAllItemCommands(text: string): ItemCommand[] {
  return extractUpstoreBlocks(text).flatMap(parseUpstoreBlock);
}

/* ════════════════════════════════════════════
   将 ItemCommand 应用到 itemStore
════════════════════════════════════════════ */

/* ── NPC 物品 owner 解析器 ──
   物品管理阶段经常给 NPC 物品编一个"幻觉ID"（如 C22），与登场判断分配的真实ID（如 C1）对不上，
   导致同一 NPC 分裂成"基础信息"和"装备"两张卡。这里把未知/空壳 owner 重定向到真实在场 NPC。
   由 App 在挂载时注入。 */
let npcOwnerResolver: ((owner: string) => string) | null = null;
export function setNpcOwnerResolver(fn: ((owner: string) => string) | null): void {
  npcOwnerResolver = fn;
}
function resolveOwner(owner: string): string {
  if (owner === 'B1' || !npcOwnerResolver) return owner;
  try { return npcOwnerResolver(owner) || owner; } catch { return owner; }
}

/** 把 AI 给的货币种类字符串（grade/type，含旧灵石别名）归一化到 CurrencyWallet 键 */
function normalizeCurrencyType(raw: unknown): keyof CurrencyWallet {
  const s = String(raw ?? '').trim();
  if (s.includes('黄金') && s.includes('技能')) return '黄金技能点';
  if (s.includes('技能点') || s === '技能点') return '技能点';
  if (s.includes('魂') || s.includes('灵魂') || s.includes('上品') || s.includes('极品')) return '灵魂钱币';
  return '乐园币'; // 缺省 / 乐园币 / 下品 / 中品
}

/* 可堆叠分类：同名消耗类物品应累加数量而非生成重复条目（装备/法宝/特殊物等"唯一物"不堆叠，
   它们各自有独立的攻防/耐久/杀敌数等，不能合并）。修复"不同回合获得的同名消耗品堆成一堆重复条目"。*/
const STACKABLE_CATS = new Set<ItemCategory>(['消耗品', '材料', '凡物', '丹药', '灵药', '符箓']);
function isStackableCat(rawCategory?: string): boolean {
  return STACKABLE_CATS.has(normalizeCategory(String(rawCategory ?? '')));
}
/* 在 list 中找到一件「同名 + 同（归一化）分类 + 未装备」的可堆叠物品，用于累加数量去重 */
function findStackTarget(list: any[], name: string, rawCategory: string): any | null {
  if (!isStackableCat(rawCategory)) return null;
  const cat = normalizeCategory(rawCategory);
  const key = normName(name);
  if (!key) return null;
  return (list ?? []).find(
    (it) => !it.equipped && normName(it.name) === key && normalizeCategory(String(it.category)) === cat,
  ) ?? null;
}

/* 删除原因归类（供「最近删除」展示"为什么删"）：
   - consumeItem 消耗殆尽 → 一律 used（被使用/消耗）
   - destroyItem → 按 AI 给的 reason 关键词分 used / broken，缺省 broken（损坏·丢弃·失去）
   reason 优先用 AI 原话，缺则按类型合成一句。 */
function classifyDeletion(cmd: 'consume' | 'destroy', rawReason?: unknown): { kind: 'used' | 'broken'; reason: string } {
  const r = String(rawReason ?? '').trim();
  if (cmd === 'consume') return { kind: 'used', reason: r || '使用后消耗殆尽' };
  const usedKw = /使用|用掉|用尽|用完|喝|吃|服用|服下|开启|打开|激活|启动|引爆|点燃|消耗|耗尽|释放|投掷|掷出|抛出|扔出/;
  const kind: 'used' | 'broken' = r && usedKw.test(r) ? 'used' : 'broken';
  return { kind, reason: r || (kind === 'used' ? '使用后消失' : '损坏 / 丢弃 / 失去') };
}

export function applyItemCommands(commands: ItemCommand[]): void {
  if (commands.length === 0) return;
  for (const cmd of commands) {
    try {
      // 每条都取最新状态：否则同一批里第2条 createItem 看不到第1条刚加的物品 → 重复生成
      applyOneItemCommand(cmd, useItems.getState());
    } catch (e) {
      console.warn('[Item] 应用指令失败:', cmd, e);
    }
  }
  // 是否重复生成物品交由 AI（物品管理预设的「获得即生成」规则）判断，不再机械合并同名
}

function applyOneItemCommand(cmd: ItemCommand, store: any): void {
  const { type, data } = cmd;

  switch (type) {
    case 'createItem': {
      const item = data.item ?? data;
      // 防御：AI 偶把对象塞进本该是字符串的字段（如 effect:{name,effect}），渲染时会触发 React 整页崩。强制字符串化可显示字段。
      for (const k of ['1', '2', '4', 'name', 'gradeDesc', 'quality', 'effect', 'appearance', 'acquisition', 'notes', 'origin', 'subType', 'combatStat', 'attack', 'defense', 'durability', 'requirement', 'affix', 'score', 'intro', 'killCount', 'category']) {
        const v = (item as any)[k];
        if (v != null && typeof v !== 'string' && typeof v !== 'number') {
          (item as any)[k] = typeof v === 'object' ? String((v as any).name ?? (v as any).text ?? (v as any).desc ?? (v as any).value ?? JSON.stringify(v)) : String(v);
        }
      }
      const owner: string = resolveOwner(data.owner ?? item.owner ?? 'B1');

      if (!item['1'] && !item.name) break;
      const name: string = item['1'] ?? item.name ?? '未知物品';

      // 非玩家物品 → 写入 NPC 持有物而非玩家背包
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        // 确保 NPC 记录存在（用于在 NPC 面板显示）
        if (!npcStore.npcs[owner]) {
          npcStore.upsertNpc(owner, defaultNpcRecord(owner));
        }
        const npcQty = parseInt(item['5'] ?? item.quantity ?? '1') || 1;
        const npcRawCat = item['2'] ?? item.category ?? '其他物品';
        // 同名可堆叠消耗品 → 累加数量，避免不同回合重复生成
        const npcStack = findStackTarget(npcStore.npcs[owner]?.items ?? [], name, String(npcRawCat));
        if (npcStack) {
          npcStore.updateNpcItem(owner, npcStack.id, { quantity: (npcStack.quantity || 1) + npcQty });
          console.log(`[Item] NPC ${owner} 堆叠 ${name} +${npcQty} → 共 ${(npcStack.quantity || 1) + npcQty}`);
          break;
        }
        // 是否重复生成交由 AI 判断（同 id 会累加数量；新 id 同名则按 AI 意图新建）
        const npcGivenId: string | undefined = item['0'] ?? item.id;
        npcStore.addNpcItem(owner, {
          id:         npcGivenId ?? `I_${owner}_${Date.now()}`,
          name,
          category:   item['2'] ?? item.category ?? '其他物品',
          gradeDesc:  item['3'] ?? item.grade ?? item.quality ?? '',
          effect:     item['4'] ?? item.effect ?? '',
          quantity:   parseInt(item['5'] ?? item.quantity ?? '1') || 1,
          equipped:   false,
          appearance: item.appearance,
          acquisition: data.acquisition ?? data.reason,
          notes:      data.reason,
          tags:       Array.isArray(item.tags) ? item.tags : undefined,
          origin:      item.origin,
          subType:     item.subType ?? item.subtype,
          combatStat:  item.combatStat ?? item.attack ?? item.defense,
          durability:  item.durability,
          requirement: item.requirement ?? item.require,
          affix:       item.affix,
          score:       item.score != null ? String(item.score) : undefined,
          intro:       item.intro ?? item.desc,
          killCount:   item.killCount != null ? String(item.killCount) : (item.kills != null ? String(item.kills) : undefined),
          numeric:    item.numeric,
          addedAt:    Date.now(),
        });
        console.log(`[Item] NPC ${owner} 物品: ${name} x${item['5'] ?? 1}（已写入NPC档案）`);
        break;
      }

      // owner === 'B1' → 写入玩家背包（原有逻辑）
      const category = normalizeCategory(item['2'] ?? item.category ?? item.type ?? '其他物品');
      const qty = parseInt(item['5'] ?? item.quantity ?? '1') || 1;
      // 同名可堆叠消耗品 → 累加数量，避免不同回合重复生成同名条目（装备/唯一物不堆叠）
      const stackTarget = findStackTarget(store.items, name, category);
      if (stackTarget) {
        store.updateItem(stackTarget.id, {
          quantity: (stackTarget.quantity || 1) + qty,
          effect: stackTarget.effect || (item['4'] ?? item.effect ?? ''),
          appearance: stackTarget.appearance || item.appearance,
        });
        console.log(`[Item] 堆叠 ${name} +${qty} → 共 ${(stackTarget.quantity || 1) + qty}`);
        break;
      }
      // 是否重复生成交由 AI 判断（同 id 走更新累加；新 id 同名则按 AI 意图新建，不再机械复用 id 去重）
      const wantId: string | undefined = item['0'] ?? item.id;
      store.addItem({
        id: wantId,
        name,
        category,
        gradeDesc: item['3'] ?? item.grade ?? item.quality ?? '',
        effect: item['4'] ?? item.effect ?? '',
        quantity: qty,
        equipped: false,
        tags: Array.isArray(item.tags) ? item.tags : [],
        appearance: item.appearance,
        acquisition: data.acquisition ?? data.reason,
        notes: data.reason,
        origin:      item.origin,
        subType:     item.subType ?? item.subtype,
        combatStat:  item.combatStat ?? item.attack ?? item.defense,
        durability:  item.durability,
        requirement: item.requirement ?? item.require,
        affix:       item.affix,
        score:       item.score != null ? String(item.score) : undefined,
        intro:       item.intro ?? item.desc,
        killCount:   item.killCount != null ? String(item.killCount) : (item.kills != null ? String(item.kills) : undefined),
      });
      console.log(`[Item] 创建物品: ${name} x${item['5'] ?? 1}`);
      break;
    }

    case 'consumeItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const qty = data.quantity ?? 1;
      // ★ 优先按物品名定位（AI 常臆造 itemId，名字更可靠）：name → itemId(按id) → itemId(按名)
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = pickTargetItem(bag, data.itemId, givenName);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要消耗的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (nitem.locked) { console.warn(`[Item] 拒绝消耗 NPC ${owner} 已锁定物品「${nitem.name}」（玩家锁定·防误删）`); break; }
        if (nitem.equipped) { console.warn(`[Item] 拒绝消耗 NPC ${owner} 已装备物品「${nitem.name}」（需先卸下，防误删穿戴装备）`); break; }
        npcStore.consumeNpcItem(owner, nitem.id, qty);
        console.log(`[Item] NPC ${owner} 消耗 ${nitem.name} x${qty}`);
        break;
      }
      const item = pickTargetItem(store.items, data.itemId, givenName);
      if (item) {
        if (item.locked) { console.warn(`[Item] 拒绝消耗已锁定物品「${item.name}」（玩家锁定·防误删，需先解锁）`); break; }
        // ★ 已装备物品不应被"消耗"（消耗品不会处于装备态）——多为 AI 幻觉，拒绝以防穿戴装备无故消失
        if (item.equipped) { console.warn(`[Item] 拒绝消耗已装备物品「${item.name}」（需先 uneq 卸下）`); break; }
        if ((item.quantity ?? 1) - qty <= 0) { store.binItem(item, classifyDeletion('consume', data.reason)); console.log(`[Item] 消耗 ${item.name} 用尽 → 移入最近删除（可恢复）`); }
        else { store.consumeItem(item.id, qty); console.log(`[Item] 消耗 ${item.name} x${qty}`); }
      } else { console.warn(`[Item] 未找到要消耗的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    case 'destroyItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = pickTargetItem(bag, data.itemId, givenName);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要销毁的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (nitem.locked) { console.warn(`[Item] 拒绝销毁 NPC ${owner} 已锁定物品「${nitem.name}」（玩家锁定·防误删）`); break; }
        // 销毁=物品从世界消失（丢弃/卖掉/损毁/被夺走）：已装备也直接移除，装备槽随之清空（移除即等于先卸下）
        npcStore.removeNpcItem(owner, nitem.id);
        console.log(`[Item] NPC ${owner} 销毁 ${nitem.name}${nitem.equipped ? '（已自动从装备栏移除）' : ''}`);
        break;
      }
      const item = pickTargetItem(store.items, data.itemId, givenName);
      if (item) {
        if (item.locked) { console.warn(`[Item] 拒绝销毁已锁定物品「${item.name}」（玩家锁定·防误删，需先解锁）`); break; }
        // 销毁：若正穿戴，先自动卸下；不直接抹掉，改移入「最近删除」回收站（可恢复，满 3 回合自动清除），防 AI 误删
        if (item.equipped) { try { store.unequipItem(item.id); } catch { /* */ } console.log(`[Item] 销毁前自动卸下已装备物品「${item.name}」`); }
        store.binItem(item, classifyDeletion('destroy', data.reason));
        console.log(`[Item] 销毁 ${item.name}（→ 最近删除）`);
      } else { console.warn(`[Item] 未找到要销毁的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    // transferSpiritStones 是预设仍在使用的货币指令（旧名），按 transferCurrency 同样处理，
    // 货币种类由 grade/type 字段判定（缺省=乐园币）。曾被忽略导致乐园币/灵魂钱币不更新。
    case 'transferSpiritStones':
    case 'transferCurrency': {
      const amount: number = data.amount ?? 0;
      const type = normalizeCurrencyType(data.type ?? data.grade);
      if (data.to === 'B1' || data.from === null || data.from === undefined) {
        store.adjustCurrency(type, amount);
        console.log(`[Item] 获得 +${amount} ${type}`);
      }
      if (data.from === 'B1' || data.to === null || data.to === undefined) {
        store.adjustCurrency(type, -amount);
        console.log(`[Item] 支出 -${amount} ${type}`);
      }
      break;
    }

    case 'equipItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        // NPC 自动装备开关：关闭时忽略 AI 对 NPC 的 equipItem（物品留在 NPC 储存空间）
        if (!useSettings.getState().allowAutoEquipNpc) { console.log(`[Item] 已关闭 NPC 自动装备，忽略 ${owner} 装备指令`); break; }
        // NPC 装备 → 标记 NPC 持有物的 equipped 字段
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = (givenName ? bag.find((x) => x.name === givenName) : undefined)
          ?? bag.find((x) => x.id === data.itemId) ?? bag.find((x) => x.name === data.itemId);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要装备的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (!isEquippable(nitem.category)) { console.warn(`[Item] 拒绝装备 NPC ${owner}「${nitem.name}」：${nitem.category} 非装备类，不能上装备栏`); break; }
        // 按分类校验槽位：AI 槽位与分类不符（如武器→饰品槽）时自动改到正确槽
        const slot = resolveEquipSlot(nitem as any, bag as any, buildSlotString(data));
        npcStore.equipNpcItem(owner, nitem.id, slot);
        console.log(`[Item] NPC ${owner} 装备 ${nitem.name} → ${slot}`);
        break;
      }
      // 主角自动装备开关：关闭时忽略 AI 对主角的 equipItem（物品留背包，玩家在装备面板手动穿戴）
      if (!useSettings.getState().allowAutoEquip) { console.log('[Item] 已关闭自动装备，主角装备指令忽略（请在装备面板手动穿戴）'); break; }
      const item = (givenName ? findItemByName(store, givenName) : undefined)
        ?? findItemById(store, data.itemId) ?? findItemByName(store, data.itemId);
      if (item) {
        // ★ 只有装备类可上装备栏：拒绝把 重要物品/消耗品/材料 等装上去
        if (!isEquippable(item.category)) { console.warn(`[Item] 拒绝装备「${item.name}」：${item.category} 非装备类，不能上装备栏`); break; }
        // 按分类校验槽位：AI 槽位与分类不符（如武器→饰品槽）时自动改到正确槽
        const slot = resolveEquipSlot(item, store.items, buildSlotString(data));
        store.equipItem(item.id, slot);
        console.log(`[Item] 装备 ${item.name} → ${slot}`);
      } else { console.warn(`[Item] 未找到要装备的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    case 'unequipItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        npcStore.unequipNpcItem(owner, data.itemId);
        console.log(`[Item] NPC ${owner} 卸下 ${data.itemId}`);
        break;
      }
      const item = findItemById(store, data.itemId) ?? findItemByName(store, data.itemId);
      if (item) {
        store.unequipItem(item.id);
        console.log(`[Item] 卸下 ${item.name}`);
      }
      break;
    }

    case 'updateItemQuantity': {
      const item = findItemById(store, data.itemId);
      if (item) store.updateItem(item.id, { quantity: data.newQuantity });
      break;
    }

    case 'updateItem': {
      const item = findItemById(store, data.itemId);
      if (item) {
        // 兼容两种写法：嵌套 updateItem({itemId, patch:{…}}) / 扁平 updateItem({itemId, name, affix:…})
        // 此前只认 data.patch，AI 写成扁平就整条被丢弃（词缀/属性变化不生效的元凶之一）
        const nested = !!(data.patch && typeof data.patch === 'object');
        const p: any = nested ? data.patch : data;
        const patch: any = {};
        // 同时接受列号('1'..'4')与具名字段；name 仅在嵌套 patch 里才当改名（扁平里的 name 是引用名，不可误当改名）
        if (nested && (p['1'] ?? p.name)) patch.name = p['1'] ?? p.name;
        if (p['2'] ?? p.category) patch.category = normalizeCategory(p['2'] ?? p.category);
        if (p['3'] ?? p.gradeDesc ?? p.quality) patch.gradeDesc = p['3'] ?? p.gradeDesc ?? p.quality;
        if (p['4'] ?? p.effect) patch.effect = p['4'] ?? p.effect;
        // ↓ 这些具名字段此前被静默丢弃——装备强化收尾刷「词缀(affix)/效果(effect)」全靠它们
        if (p.affix) patch.affix = p.affix;
        if (p.appearance) patch.appearance = p.appearance;
        if (p.intro) patch.intro = p.intro;
        if (p.score) patch.score = p.score;
        if (p.combatStat) patch.combatStat = p.combatStat;
        if (p.durability) patch.durability = p.durability;
        if (p.requirement) patch.requirement = p.requirement;
        if (p.subType) patch.subType = p.subType;
        if (p.origin) patch.origin = p.origin;
        if (p.notes) patch.notes = p.notes;
        if (p.acquisition) patch.acquisition = p.acquisition;
        if (p.killCount != null) patch.killCount = p.killCount;
        // 强制把所有字段转成字符串：AI 偶把 effect/affix 等写成数字或对象，否则渲染时 (x).trim()/.replace() 会整页崩
        for (const k of Object.keys(patch)) {
          const v = patch[k];
          if (v != null && typeof v !== 'string') patch[k] = typeof v === 'object' ? String((v as any).name ?? (v as any).text ?? (v as any).desc ?? (v as any).value ?? JSON.stringify(v)) : String(v);
        }
        if (Object.keys(patch).length) store.updateItem(item.id, patch);
      }
      break;
    }

    case 'transferItem': {
      // 如果 to 是 B1（玩家），将源角色的物品移入玩家背包
      // 简化处理：目前只处理转入玩家的情况
      if (data.to === 'B1') {
        const item = findItemById(store, data.itemId);
        if (item) {
          const qty = data.quantity ?? 1;
          store.updateItem(item.id, { quantity: Math.min(item.quantity, qty) });
        }
      } else if (data.from === 'B1') {
        // 玩家转出
        const item = findItemById(store, data.itemId);
        if (item) store.consumeItem(item.id, data.quantity ?? 1);
      }
      break;
    }
  }
}

function findItemById(store: any, id?: string): any | null {
  if (!id) return null;
  return store.items.find((it: any) => it.id === id) ?? null;
}

/* 名称模糊相等（归一化去标点后 相等 / 互相包含）：用于校验 itemId 指向的物品名字是否对得上 */
function nameLike(a?: string, b?: string): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
/* 解析销毁/消耗的目标物品：AI 常臆造 itemId。规则——
   ① itemId 命中、且名字与给定 name 相符（或未给 name）→ 用它；
   ② itemId 命中但名字对不上（多为幻觉 id）→ 改按 name 找；
   ③ 给了 name 却找不到 → 返回 null（宁可不删，也不按幻觉 id 删错你的装备/武器）；只有完全没给 name 时才退回 byId。 */
function pickTargetItem(items: any[], itemId?: string, name?: string): any | null {
  const byId = itemId ? (items ?? []).find((x: any) => x.id === itemId) : null;
  if (byId && (!name || nameLike(byId.name, name))) return byId;
  const byName = name ? fuzzyFindItem(items, name) : null;
  if (byName) return byName;
  return name ? null : byId;
}

/* 名称归一化：去空白 + 去常见标点/间隔符，跨回合"荒野行者·战术背心" vs "荒野行者战术背心"也能判为同物去重 */
function normName(s?: string): string {
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜]/g, '').trim().toLowerCase();
}
function findItemByName(store: any, name?: string): any | null {
  if (!name) return null;
  const exact = store.items.find((it: any) => it.name === name);
  if (exact) return exact;
  const key = normName(name);
  if (!key) return null;
  return store.items.find((it: any) => normName(it.name) === key) ?? null;
}

/* 去掉名称里的括注/来源标记：（哥布林掉落）【…】(…)〔…〕[…]，用于消耗/销毁时的宽松匹配 */
function stripAnno(s?: string): string {
  return (s ?? '').replace(/[（(【〔[][^）)】〕\]]*[）)】〕\]]/g, '').trim();
}
/* 更"狠"的核心名：在 normName 基础上再去掉连接性助词（的/之/型/款/版）+ 数量/包装量词，
   用于最后一轮相似度匹配（"劣质的击晕器"→"劣质击晕器"）。不改 normName，避免影响精确去重/堆叠。*/
function coreName(s?: string): string {
  return normName(s).replace(/[的之型款版]/g, '');
}
/* 取字符 bigram 集合（≤1字时退化为单字符集合），用于 Jaccard 相似度 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 1) { if (s) set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
/* 宽松查找（仅用于 consume/destroy 等"找一件已存在物品来移除"的场景，不用于 createItem 去重，避免误并）：
   精确名 → 归一化名 → 去括注后归一化 → 包含匹配（取最长物品名）。
   解决 AI 把"白色宝箱（哥布林掉落）"当物品名、而背包里存的是"白色宝箱"导致找不到的问题。 */
function fuzzyFindItem(items: any[], ...queries: (string | undefined)[]): any | null {
  const list = items ?? [];
  // 第一轮：每个 query 走 精确 / 归一化
  for (const q of queries) {
    if (!q) continue;
    const exact = list.find((it) => it.name === q);
    if (exact) return exact;
    const key = normName(q);
    if (key) { const n = list.find((it) => normName(it.name) === key); if (n) return n; }
  }
  // 第二轮：去括注后精确 / 包含匹配（要求物品名 ≥2 字，取最长名以防误匹配短名）
  for (const q of queries) {
    if (!q) continue;
    const qb = normName(stripAnno(q));
    if (!qb || qb.length < 2) continue;
    const byBase = list.find((it) => normName(stripAnno(it.name)) === qb);
    if (byBase) return byBase;
    const contains = list
      .filter((it) => { const k = normName(it.name); return k.length >= 2 && (qb.includes(k) || normName(q).includes(k)); })
      .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
    if (contains) return contains;
  }
  // 第三轮：反向包含（物品名 含 query，如"止血喷雾"→"次级止血喷雾"；AI 常省略品级/前缀词）。取最短匹配名=最贴近 query 的那件。
  for (const q of queries) {
    if (!q) continue;
    const qb = normName(stripAnno(q));
    if (!qb || qb.length < 2) continue;
    const rev = list
      .filter((it) => { const k = normName(it.name); return k.length >= 2 && k.includes(qb); })
      .sort((a, b) => (a.name?.length ?? 0) - (b.name?.length ?? 0))[0];
    if (rev) return rev;
  }
  // 第四轮：字符 bigram 相似度兜底（容忍助词/语序/轻微改写："劣质的击晕器"→"劣质击晕器"）。
  // 取相似度最高且 ≥0.5 的物品；需与次高分拉开差距（≥0.12）或唯一高分，避免在多件相近物品间误删。
  {
    const qsets = queries.filter(Boolean).map((q) => bigrams(coreName(q!))).filter((s) => s.size);
    if (qsets.length) {
      let best: any = null, bestScore = 0, second = 0;
      for (const it of list) {
        const ib = bigrams(coreName(it.name));
        let sc = 0;
        for (const qs of qsets) sc = Math.max(sc, jaccard(qs, ib));
        if (sc > bestScore) { second = bestScore; bestScore = sc; best = it; }
        else if (sc > second) { second = sc; }
      }
      if (best && bestScore >= 0.5 && (bestScore - second >= 0.12 || second === 0)) return best;
    }
  }
  return null;
}

/* 可装备分类白名单：只有装备类（武器/防具/饰品 + 特殊装备/法宝/功法/技能书）能上装备栏；
   重要物品/消耗品/材料/工具/凡物/丹药/符箓/灵药/阵具/其他物品 等一律不可装备。 */
const EQUIPPABLE_CATS = new Set(['武器', '防具', '饰品', '特殊物品', '法宝', '功法']);
export function isEquippable(category?: string): boolean {
  return EQUIPPABLE_CATS.has(String(category ?? '').trim());
}

function buildSlotString(data: any): string {
  if (data.slot === 'armor' && data.armorPart) return `armor:${data.armorPart}`;
  if (data.slot === 'weapon' && data.weaponHand) return `weapon:${data.weaponHand}`;
  if (data.slot === 'treasure' && data.slotIndex !== undefined) return `treasure:#${data.slotIndex + 1}`;
  if (data.slot === 'accessory' && data.slotIndex !== undefined) return `accessory:#${data.slotIndex + 1}`;
  if (data.slot === 'technique' && data.slotIndex !== undefined) return `technique:${data.slotIndex}`;
  return data.slot ?? '';
}

// 将各种别名归一化为合法分类
const CATEGORY_MAP: Record<string, ItemCategory> = {
  // 装备类
  '武器': '武器',
  '防具': '防具', '护甲': '防具', '护具': '防具', '盔甲': '防具', '法衣': '防具',
    '内甲': '防具', '披风': '防具', '内衣': '防具', '战甲': '防具',
  '饰品': '饰品',
  // 消耗品 — 轮回乐园新分类（也接收旧丹药/符箓别名）
  '消耗品': '消耗品', '药剂': '消耗品', '药水': '消耗品', '炸弹': '消耗品', '道具卡': '消耗品',
    '丹药': '消耗品', '灵兽丹': '消耗品', '药丸': '消耗品', '灵丹': '消耗品',
    '符箓': '消耗品', '灵符': '消耗品', '符纸': '消耗品', '符宝': '消耗品', '卷轴': '消耗品',
  // 材料
  '材料': '材料', '灵药': '材料', '灵草': '材料', '灵植': '材料', '仙草': '材料',
    '药苗': '材料', '灵种': '材料', '矿石': '材料', '兽皮': '材料', '晶石': '材料',
  // 工具
  '工具': '工具', '炼金锅': '工具', '锻造炉': '工具', '医疗器械': '工具',
    '阵具': '工具', '阵盘': '工具', '阵旗': '工具', '阵图': '工具', '禁制盘': '工具',
  // 重要物品
  '重要物品': '重要物品', '任务物品': '重要物品', '令牌': '重要物品', '契约': '重要物品',
    '通行凭证': '重要物品', '地图': '重要物品', '情报': '重要物品',
  // 特殊物品
  '特殊物品': '特殊物品', '技能书': '特殊物品', '知识卷轴': '特殊物品',
    '图纸': '特殊物品', '配方': '特殊物品', '天赋碎片': '特殊物品',
    '功法': '特殊物品',   // 旧版功法归入特殊物品
  // 旧版法宝 — 无上下文时归其他，保持旧存档可读
  '法宝': '法宝', '法器': '法宝', '灵宝': '法宝', '古宝': '法宝',
  // 凡物
  '凡物': '凡物', '凡俗物品': '凡物',
};

function normalizeCategory(raw: string): ItemCategory {
  const trimmed = raw.trim();
  return (CATEGORY_MAP[trimmed] as ItemCategory) ?? '其他物品';
}

/* ════════════════════════════════════════════
   角色指令（addSkill / deSkill / addTrait / deTrait）
   格式：funcName("charId", payload)
   payload 是 JSON 对象 或 带引号的字符串
════════════════════════════════════════════ */

export type CharCommandType = 'addSkill' | 'deSkill' | 'addTrait' | 'deTrait' | 'addTalent' | 'deTalent' | 'addDeed' | 'addMemory' | 'addTitle' | 'deTitle' | 'equipTitle' | 'addAchievement' | 'deAchievement' | 'addSubProfession' | 'deSubProfession' | 'addRecipe' | 'deRecipe' | 'bumpSubProf' | 'bumpRecipe';

export interface CharCommand {
  type: CharCommandType;
  charId: string;
  payload: unknown;  // Skill 对象 | Trait 对象 | id/name 字符串
  raw: string;
}

// 匹配 funcName("charId", {...}) 或 funcName("charId", "string")
const CHAR_CMD_RE = /\b(addSkill|deSkill|addTrait|deTrait|addTalent|deTalent|addDeed|addMemory|addTitle|deTitle|equipTitle|addAchievement|deAchievement|addSubProfession|deSubProfession|addRecipe|deRecipe|bumpSubProf|bumpRecipe)\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\}|"[^"]*")\s*\)/g;

function parseCharBlock(block: string): CharCommand[] {
  const cmds: CharCommand[] = [];
  CHAR_CMD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAR_CMD_RE.exec(block)) !== null) {
    const type   = m[1] as CharCommandType;
    const charId = m[2];
    const rawPayload = m[3].trim();
    const payload = rawPayload.startsWith('{')
      ? lenientJsonParse(rawPayload)   // 容忍裸键(name: 而非 "name":)/单引号/尾逗号
      : rawPayload.replace(/^"|"$/g, '');
    if (payload === undefined) { console.warn('[Char] 指令解析失败:', m[0]); continue; }
    cmds.push({ type, charId, payload, raw: m[0] });
  }
  return cmds;
}

export function parseAllCharCommands(text: string): CharCommand[] {
  return extractUpstoreBlocks(text).flatMap(parseCharBlock);
}

/* ════════════════════════════════════════════
   将 CharCommand 应用到 characterStore
════════════════════════════════════════════ */

/* ════════════════════════════════════════════
   NPC 指令（add / de）
   add("C1", {"4":"...", "12":"..."})  — 列覆盖式增量更新
   de("C1")                            — 软删除/离场
   注意：用负向断言避免吞掉 addSkill/addTrait/deSkill/deTrait
════════════════════════════════════════════ */

export type NpcCommandType = 'add' | 'de';

export interface NpcCommand {
  type: NpcCommandType;
  id: string;
  payload?: Record<string, unknown>;
  raw: string;
}

// add(?!…) 确保不匹配 addSkill/addTrait/addTalent/addTitle/addAchievement/addSubProfession/addRecipe
const NPC_ADD_RE = /\badd(?!Skill|Trait|Talent|Title|Achievement|SubProfession|Recipe)\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
// de(?![A-Za-z]) 确保不匹配 deSkill/deTrait（后面必须紧跟非字母）
const NPC_DE_RE  = /\bde(?![A-Za-z])\s*\(\s*"([^"]+)"\s*\)/g;

function parseNpcBlock(block: string): NpcCommand[] {
  const cmds: NpcCommand[] = [];

  NPC_ADD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NPC_ADD_RE.exec(block)) !== null) {
    const id = m[1];
    const payload = lenientJsonParse(m[2]);   // 容忍裸键/单引号/尾逗号
    if (payload !== undefined) cmds.push({ type: 'add', id, payload, raw: m[0] });
    else console.warn('[NPC] add 指令 JSON 解析失败:', m[0]);
  }

  NPC_DE_RE.lastIndex = 0;
  while ((m = NPC_DE_RE.exec(block)) !== null) {
    cmds.push({ type: 'de', id: m[1], raw: m[0] });
  }

  return cmds;
}

export function parseAllNpcCommands(text: string): NpcCommand[] {
  return extractUpstoreBlocks(text).flatMap(parseNpcBlock);
}

export function applyNpcCommands(cmds: NpcCommand[]): void {
  if (cmds.length === 0) return;
  for (const c of cmds) {
    try {
      const store = useNpc.getState();   // 每条都取最新，能看到同批前面的新建，避免批内重复
      if (c.type === 'add') {
        let id = c.id;
        // 防重复：当本条是"新建"（目标 id 尚不存在）且 payload 里的姓名与某个既有真实角色相同时，
        // 重定向到既有角色（视为重新登场/更新），而不是另建一个同名 NPC。
        const rawName = String((c.payload as any)?.['1'] ?? (c.payload as any)?.['name'] ?? '');
        const nm = rawName.split('|')[0].trim();
        if (nm && !store.npcs[id]) {
          const exist = Object.values(store.npcs).find(
            (r) => !r.isDead && r.name && r.name !== r.id && r.name.trim() === nm && (r.realm || r.personality || r.background),
          );
          if (exist && exist.id !== id) {
            console.warn(`[NPC] add("${id}") 与既有同名角色「${nm}」(${exist.id}) 重复，重定向到 ${exist.id}（防重复建档）`);
            id = exist.id;
          }
        }
        // 规范化：AI 自创的非法 ID（如 P_Aesc）若是全新角色，改用下一个空闲 C 编号——
        // 否则后续所有短指令(character.C\d+ / hp.C\d+ …)都匹配不到它，更新会被静默丢弃。
        if (!isNpcId(id) && !store.npcs[id]) {
          const used = new Set(Object.keys(store.npcs));
          let k = 1; while (used.has(`C${k}`)) k++;
          console.warn(`[NPC] add("${id}") 使用非法ID，改用空闲编号 C${k}`);
          id = `C${k}`;
        }
        store.applyColumns(id, c.payload ?? {});
        console.log(`[NPC] add ${id}:`, c.payload);
      } else {
        store.removeNpc(c.id);
        console.log(`[NPC] de ${c.id} → 离场(B区)`);
      }
    } catch (e) {
      console.warn('[NPC] 指令应用失败:', c, e);
    }
  }
}

/* ════════════════════════════════════════════
   势力指令：addFaction("F1",{...命名键...}) / deFaction("F1")
════════════════════════════════════════════ */
export interface FactionCommand { type: 'add' | 'de'; id: string; payload?: Record<string, unknown>; raw: string; }
const FAC_ADD_RE = /\baddFaction\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
const FAC_DE_RE  = /\bdeFaction\s*\(\s*"([^"]+)"\s*\)/g;
function parseFactionBlock(block: string): FactionCommand[] {
  const cmds: FactionCommand[] = []; let m: RegExpExecArray | null;
  FAC_ADD_RE.lastIndex = 0;
  while ((m = FAC_ADD_RE.exec(block)) !== null) {
    const payload = lenientJsonParse(m[2]);
    if (payload !== undefined) cmds.push({ type: 'add', id: m[1], payload, raw: m[0] });
    else console.warn('[Faction] add JSON 解析失败:', m[0]);
  }
  FAC_DE_RE.lastIndex = 0;
  while ((m = FAC_DE_RE.exec(block)) !== null) cmds.push({ type: 'de', id: m[1], raw: m[0] });
  return cmds;
}
export function parseAllFactionCommands(text: string): FactionCommand[] {
  return extractUpstoreBlocks(text).flatMap(parseFactionBlock);
}
export function applyFactionCommands(cmds: FactionCommand[]): void {
  if (cmds.length === 0) return;
  const store = useFaction.getState();
  for (const c of cmds) {
    try {
      if (c.type === 'add') { store.applyColumns(c.id, c.payload ?? {}); console.log(`[Faction] add ${c.id}`); }
      else { store.removeFaction(c.id); console.log(`[Faction] de ${c.id} → 移出当前世界`); }
    } catch (e) { console.warn('[Faction] 指令应用失败:', c, e); }
  }
}

/* ════════════════════════════════════════════
   领地指令（单一基地）：
   <upstore> unlockTerritory / setTerritory / addBuilding / upgradeBuilding /
            deBuilding / addTerritoryEffect / deTerritoryEffect /
            addMember / removeMember / storeItem / takeItem
   <state>   territory.progress|level|appearance|name|passiveOutput
   applyTerritoryCommands(text) 一站式解析+应用，返回应用条数
════════════════════════════════════════════ */
function parseJsonArg(raw: string): any | null {
  const v = lenientJsonParse(raw);   // 容忍裸键/单引号/尾逗号
  return v === undefined ? null : v;
}

export function applyTerritoryCommands(text: string): number {
  const store = useTerritory.getState();
  let n = 0;
  const blocks = extractUpstoreBlocks(text).join('\n');
  let m: RegExpExecArray | null;

  const objCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };
  const idObjCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(\\{[\\s\\S]*?\\}))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };
  const idArgCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(-?\\d+))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };

  try {
    // 开辟 / 概况
    for (const mm of objCall('unlockTerritory')) {
      const d = parseJsonArg(mm[1]); if (!d) continue;
      store.unlock({ name: d.name, appearance: d.appearance }); n++;
    }
    for (const mm of objCall('setTerritory')) {
      const d = parseJsonArg(mm[1]); if (!d) continue;
      store.setTerritory({ name: d.name, appearance: d.appearance, level: d.level, passiveOutput: d.passiveOutput });
      n++;
    }
    // 建筑
    for (const mm of objCall('addBuilding')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.upsertBuilding({ name: String(d.name), level: d.level, effect: d.effect, appearance: d.appearance, description: d.description ?? d.desc });
      n++;
    }
    for (const mm of objCall('upgradeBuilding')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name || d.level == null) continue;
      store.setBuildingLevel(String(d.name), Number(d.level)); n++;
    }
    for (const mm of idArgCall('deBuilding')) { store.removeBuilding(mm[1]); n++; }
    for (const mm of idArgCall('removeBuilding')) { store.removeBuilding(mm[1]); n++; }
    // 领地效果
    for (const mm of objCall('addTerritoryEffect')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.upsertEffect({ name: String(d.name), desc: d.desc ?? d.effect ?? '', source: d.source }); n++;
    }
    for (const mm of idArgCall('deTerritoryEffect')) { store.removeEffect(mm[1]); n++; }
    // 成员（关联 NPC C-id）
    for (const mm of idObjCall('addMember')) {
      const d = mm[2] ? parseJsonArg(mm[2]) : {};
      store.addMember(mm[1], { role: d?.role, note: d?.note ?? d?.desc }); n++;
    }
    for (const mm of idArgCall('removeMember')) { store.removeMember(mm[1]); n++; }
    // 仓库
    for (const mm of objCall('storeItem')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.storeItem({
        name: String(d.name), quantity: d.quantity ?? d.qty, category: d.category,
        gradeDesc: d.gradeDesc ?? d.quality, effect: d.effect, desc: d.desc ?? d.description, appearance: d.appearance,
      });
      n++;
    }
    for (const mm of idArgCall('takeItem')) { store.takeItem(mm[1], mm[2] != null ? Number(mm[2]) : undefined); n++; }
  } catch (e) { console.warn('[Territory] upstore 指令应用失败:', e); }

  // ── <state> 短指令 ──
  const stateText = extractStateBlocks(text).join('\n') || text;
  const progRe = /\bterritory\.progress\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = progRe.exec(stateText))) {
    const v = Number(m[2]);
    if (m[1] === '=') store.setProgress(v);
    else store.addProgress(m[1] === '+=' ? v : -v);
    n++;
  }
  const lvRe = /\bterritory\.level\s*(=|\+=|-=)\s*(\d+)/g;
  while ((m = lvRe.exec(stateText))) {
    const cur = useTerritory.getState().level;
    const v = Number(m[2]);
    store.setLevel(m[1] === '=' ? v : m[1] === '+=' ? cur + v : cur - v);
    n++;
  }
  const apRe = /\bterritory\.appearance\s*=\s*"([^"]*)"/g;
  while ((m = apRe.exec(stateText))) { store.setTerritory({ appearance: m[1] }); n++; }
  const nmRe = /\bterritory\.name\s*=\s*"([^"]*)"/g;
  while ((m = nmRe.exec(stateText))) { store.setTerritory({ name: m[1] }); n++; }
  const poRe = /\bterritory\.passiveOutput\s*=\s*"([^"]*)"/g;
  while ((m = poRe.exec(stateText))) { store.setTerritory({ passiveOutput: m[1] }); n++; }

  return n;
}

/* ════════════════════════════════════════════
   冒险团指令（仅主角单一冒险团）：
   <upstore> establishTeam / addTeamMember / removeTeamMember / addTeamPerk /
            deTeamPerk / startAssessment / resolveAssessment / addTeamDeed / setTeam
   <state>   team.exp / team.activity / team.rank / team.name
   applyTeamCommands(text) 一站式解析+应用，返回应用条数
════════════════════════════════════════════ */
const TEAM_RANK_SET = new Set(['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']);
export function applyTeamCommands(text: string): number {
  const store = useTeam.getState();
  let n = 0;
  const blocks = extractUpstoreBlocks(text).join('\n');
  let m: RegExpExecArray | null;
  const objCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const idObjCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(\\{[\\s\\S]*?\\}))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const idArgCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const pj = (raw: string): any | null => { const v = lenientJsonParse(raw); return v === undefined ? null : v; };

  try {
    for (const mm of objCall('establishTeam')) { const d = pj(mm[1]); store.establish({ name: d?.name }); n++; }
    for (const mm of objCall('setTeam')) { const d = pj(mm[1]); if (d) { store.setTeam({ name: d.name, disbanded: d.disbanded }); n++; } }
    for (const mm of idObjCall('addTeamMember')) { const d = mm[2] ? pj(mm[2]) : {}; store.upsertMember(mm[1], { role: d?.role, note: d?.note }); n++; }
    for (const mm of idArgCall('removeTeamMember')) { store.removeMember(mm[1]); n++; }
    for (const mm of objCall('addTeamPerk')) { const d = pj(mm[1]); if (d?.name) { store.upsertPerk({ name: String(d.name), desc: d.desc ?? d.effect ?? '', source: d.source }); n++; } }
    for (const mm of idArgCall('deTeamPerk')) { store.removePerk(mm[1]); n++; }
    for (const mm of objCall('startAssessment')) { const d = pj(mm[1]); const tr = String(d?.targetRank ?? '').toUpperCase(); if (TEAM_RANK_SET.has(tr)) { store.startAssessment(tr as TeamRank, !!d?.isEstablish); n++; } }
    for (const mm of objCall('resolveAssessment')) { const d = pj(mm[1]); const r = String(d?.result ?? '').toLowerCase(); if (r === 'pass' || r === 'fail' || r === 'disband') { store.resolveAssessment(r); n++; } }
    for (const mm of objCall('addTeamDeed')) {
      const d = pj(mm[1]); if (!d) continue;
      const desc = d.description ?? d.desc ?? (typeof d === 'string' ? d : '');
      if (desc) { store.appendDeed({ time: d.time ?? '', location: d.location ?? '', description: desc }); n++; }
    }
  } catch (e) { console.warn('[Team] upstore 指令应用失败:', e); }

  // ── <state> 短指令 ──
  const stateText = extractStateBlocks(text).join('\n') || text;
  const expRe = /\bteam\.exp\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = expRe.exec(stateText))) { const v = Number(m[2]); if (m[1] === '=') store.setExp(v); else store.addExp(m[1] === '+=' ? v : -v); n++; }
  const actRe = /\bteam\.activity\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = actRe.exec(stateText))) { const v = Number(m[2]); store.addActivity(m[1] === '=' ? (v - useTeam.getState().activity) : m[1] === '+=' ? v : -v); n++; }
  const rankRe = /\bteam\.rank\s*=\s*"?(SSS|SS|S|A|B|C|D|E)"?/g;
  while ((m = rankRe.exec(stateText))) { store.setRank(m[1] as TeamRank); n++; }
  const nmRe = /\bteam\.name\s*=\s*"([^"]*)"/g;
  while ((m = nmRe.exec(stateText))) { store.setTeam({ name: m[1] }); n++; }
  const asRe = /\bteam\.assessment\s*=\s*"?(pass|passed|fail|failed|disband)"?/g;
  while ((m = asRe.exec(stateText))) { const r = m[1].startsWith('pass') ? 'pass' : m[1] === 'disband' ? 'disband' : 'fail'; store.resolveAssessment(r as any); n++; }

  return n;
}

export function applyCharacterCommands(commands: CharCommand[]): void {
  if (commands.length === 0) return;
  const store = useCharacters.getState();

  for (const cmd of commands) {
    try {
      const { type, charId, payload } = cmd;

      if (type === 'addSkill') {
        const d: any = payload;
        // NPC 技能是否新增/更新交由 AI（演化预设）判断，不再机械拦截
        store.addSkill(charId, {
          id:            d['0'] ?? d.id ?? `S_${charId}_${Date.now()}`,
          name:          d['1'] ?? d.name ?? '未知技能',
          level:         d['2'] ?? d.level ?? '',
          cooldown:      d['3'] ?? d.cooldown,
          desc:          d['4'] ?? d.desc ?? d.description ?? '',
          layers:        d['5'] ?? d.layers,
          effect:        d['6'] ?? d.effect ?? '',
          layerProgress: d['7'] ?? d.layerProgress,
          cost:          d['8'] ?? d.cost,
          layerEffects:  d['9'] ?? d.layerEffects,
          // 固定格式补充字段（命名键）
          skillType:     d.skillType ?? d.type,
          rarity:        d.rarity ?? d.tier,
          target:        d.target,
          damage:        d.damage,
          attrBonus:     d.attrBonus ?? d.attr,
          tags:          Array.isArray(d.tags) ? d.tags : undefined,
          note:          d.note ?? d.remark ?? d['备注'],
          numeric:       d.numeric,
        });
        console.log(`[Char] addSkill ${charId}: ${d['1'] ?? d.name}`);
      }

      else if (type === 'deSkill') {
        store.removeSkill(charId, payload as string);
        console.log(`[Char] deSkill ${charId}: ${payload}`);
      }

      // addTalent 为天赋首选指令；addTrait 为向后兼容别名，二者同通道
      else if (type === 'addTrait' || type === 'addTalent') {
        const d: any = payload;
        // NPC 天赋是否新增/更新交由 AI（演化预设）判断，不再机械拦截
        store.addTrait(charId, {
          name:     d.name ?? d['0'] ?? '未知天赋',
          desc:     d.desc ?? d.description ?? d['1'] ?? '',
          source:   d.source,
          effect:   d.effect ?? d['2'] ?? '',
          rarity:   d.rarity ?? d.tier ?? d.grade ?? 'C',
          category: d.category ?? d.type,
          level:    d.level,
          attrBonus: d.attrBonus ?? d.attr,
          note:     d.note ?? d.remark ?? d['备注'],
          numeric:  d.numeric,
        });
        console.log(`[Char] ${type} ${charId}: ${d.name}`);
      }

      else if (type === 'deTrait' || type === 'deTalent') {
        store.removeTrait(charId, payload as string);
        console.log(`[Char] ${type} ${charId}: ${payload}`);
      }

      else if (type === 'addTitle') {
        const d: any = payload;
        const name = d.name ?? d['0'];
        if (!name) { console.warn('[Char] addTitle 缺少名称，跳过'); continue; }
        store.addTitle(charId, {
          name,
          obtainedTime: d.obtainedTime ?? d.time,
          rarity:       d.rarity ?? d.tier ?? 'C',
          source:       d.source,
          effect:       d.effect,
          desc:         d.desc ?? d.description,
          equipped:     d.equipped === true || d.equipped === 'true',
        });
        console.log(`[Char] addTitle ${charId}: ${name}`);
      }

      else if (type === 'deTitle') {
        store.removeTitle(charId, payload as string);
        console.log(`[Char] deTitle ${charId}: ${payload}`);
      }

      else if (type === 'equipTitle') {
        store.equipTitle(charId, payload as string);
        console.log(`[Char] equipTitle ${charId}: ${payload}`);
      }

      // 成就（仅主角 B*；NPC 不建模成就）
      else if (type === 'addAchievement') {
        if (!/^B\d+$/.test(charId)) { continue; }
        const d: any = payload;
        const id = d.id ?? d['0'] ?? d.name;
        if (!id) { console.warn('[Char] addAchievement 缺少 id/name，跳过'); continue; }
        usePlayer.getState().addAchievement({
          id:        String(id),
          name:      d.name ?? '未命名成就',
          desc:      d.desc ?? d.description ?? '',
          category:  d.category ?? '其他',
          type:      d.type ?? '普通',
          rarity:    d.rarity ?? d.tier ?? '白色',
          hidden:    d.hidden === true || d.hidden === 'true',
          condition: d.condition ?? d.unlock ?? '',
          unlockTime: d.unlockTime ?? d.time,
        });
        console.log(`[Char] addAchievement ${charId}: ${id}`);
      }

      else if (type === 'deAchievement') {
        if (/^B\d+$/.test(charId)) usePlayer.getState().removeAchievement(payload as string);
      }

      else if (type === 'addSubProfession') {
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角，NPC 不建模
        const d: any = payload;
        if (!d.name) { console.warn('[Char] addSubProfession 缺少 name'); continue; }
        store.addSubProfession(charId, {
          name: d.name, tier: d.tier ?? '新手', progress: d.progress,
          category: d.category, recipeLabel: d.recipeLabel ?? d.recipeKind, desc: d.desc, effect: d.effect,
        });
        console.log(`[Char] addSubProfession ${charId}: ${d.name}`);
      }
      else if (type === 'deSubProfession') {
        if (/^B\d+$/.test(charId)) store.removeSubProfession(charId, payload as string);
      }
      else if (type === 'addRecipe') {
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        const prof = d.prof ?? d.subProfession ?? d.profession;
        if (!prof || !d.name) { console.warn('[Char] addRecipe 缺少 prof/name'); continue; }
        store.addRecipe(charId, prof, {
          id: d.id ?? `R_${charId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: d.name, tier: d.tier, progress: d.progress,
          materials: d.materials, output: d.output, desc: d.desc,
        });
        console.log(`[Char] addRecipe ${charId}/${prof}: ${d.name}`);
      }
      else if (type === 'deRecipe') {
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        if (typeof d === 'string') { const [p, nm] = d.split('::'); if (p && nm) store.removeRecipe(charId, p, nm); }
        else if (d.prof && d.name) store.removeRecipe(charId, d.prof, d.name);
      }
      else if (type === 'bumpRecipe') {
        // 练习/制作某配方：配方熟练度 += delta，且副职业总熟练度随之同步提升（半速，至少 1）
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        const prof = d.prof ?? d.subProfession ?? d.profession;
        const name = d.name ?? d.recipe;
        const delta = Number(d.delta ?? d.progress ?? d.amount);
        if (prof && name && Number.isFinite(delta) && delta !== 0) {
          store.bumpRecipe(charId, prof, name, delta);
          store.bumpSubProf(charId, prof, Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 2)));
          console.log(`[Char] bumpRecipe ${charId}/${prof}/${name}: ${delta > 0 ? '+' : ''}${delta}（总熟练同步）`);
        } else { console.warn('[Char] bumpRecipe 缺少 prof/name/delta', d); }
      }
      else if (type === 'bumpSubProf') {
        // 副职业整体精进（无具体配方）：仅加总熟练度
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        const name = typeof d === 'string' ? d : (d.name ?? d.subProfession ?? d.profession);
        const delta = Number(typeof d === 'object' ? (d.delta ?? d.progress ?? d.amount) : NaN);
        if (name && Number.isFinite(delta) && delta !== 0) {
          store.bumpSubProf(charId, name, delta);
          console.log(`[Char] bumpSubProf ${charId}/${name}: ${delta > 0 ? '+' : ''}${delta}`);
        } else { console.warn('[Char] bumpSubProf 缺少 name/delta', d); }
      }

      else if (type === 'addDeed') {
        const d: any = payload;
        const deed = {
          time:        (typeof d === 'object' ? d.time ?? d['0'] : '') ?? '',
          location:    (typeof d === 'object' ? d.location ?? d['1'] : '') ?? '',
          description: typeof d === 'string' ? d : (d.description ?? d['2'] ?? ''),
        };
        if (!deed.description) { console.warn('[Char] addDeed 缺少描述，跳过:', cmd.raw); continue; }
        if (/^[CG]\d+$/.test(charId)) {
          useNpc.getState().appendDeed(charId, deed);          // NPC → npcStore
        } else if (/^F\d+$/.test(charId)) {
          useFaction.getState().appendDeed(charId, deed);       // 势力 → factionStore
        } else {
          usePlayer.getState().appendPlayerDeed(deed);          // 主角(B*) → playerStore
        }
        console.log(`[Char] addDeed ${charId}: ${deed.description}`);
      }

      else if (type === 'addMemory') {
        const d: any = payload;
        const entry = {
          time:     (typeof d === 'object' ? d.time ?? d['0'] : '') ?? '',
          location: (typeof d === 'object' ? d.location ?? d['1'] : '') ?? '',
          content:  typeof d === 'string' ? d : (d.content ?? d.description ?? d['2'] ?? ''),
        };
        if (!entry.content) { console.warn('[Char] addMemory 缺少内容，跳过:', cmd.raw); continue; }
        store.appendMemory(charId, entry);                      // → characterStore.shortTerm
        console.log(`[Char] addMemory ${charId}: ${entry.content}`);
      }

    } catch (e) {
      console.warn('[Char] 指令应用失败:', cmd, e);
    }
  }
}
