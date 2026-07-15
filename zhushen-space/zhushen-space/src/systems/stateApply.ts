import { useGame } from '../store/gameStore';
import { useVariables } from '../store/variableStore';
import { useNpc } from '../store/npcStore';
import { useItems, isResourcePseudoItem } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import { useSkillTree } from '../store/skillTreeStore';
import { playerMaxHp, playerMaxEp, playerResourceMax } from './playerVitals';
import { useResource } from '../store/resourceStore';
import { useMisc } from '../store/miscStore';   // 当地货币（世界级·世界限定·离世归零）
import { effectiveResource, fullMaxHp, fullMaxEp, ratioOf, npcBaseAttrs } from './derivedStats';
import { parseAllStateUpdates, parseAllItemCommands, applyItemCommands, stripPreviewRewardCurrency, isEquippable, setNpcOwnerResolver, type StateUpdate, type ItemEditResult, type LedgerCtx } from './stateParser';
import { applyTableEdits } from './tableEditParser';   // ACU 表格数据库：<tableEdit> → tableStore
import { projectStoresToTables } from './tableMigrate';   // 1c：镜像表每回合从 store 投影（漂移从构造上消除）
import { seedWalletIfEmpty } from './ledger/walletCore';   // Step 10 货币事件核心
import { seedItemsIfEmpty } from './ledger/itemCore';   // Step 10 物品事件核心
import { seedNpcsIfEmpty } from './ledger/npcCore';   // Step 10 NPC 事件核心
import { watchdogViolations } from './ledger/watchdog';   // Step 10 状态对账看门狗（货币/物品/NPC）
import { resolveEquipSlot } from './equipSlots';
import { SKILLTREE_TUNING } from './skillTree';
/* NPC 物品 owner 解析器：把物品阶段的"幻觉ID"重定向到真实 NPC（修复 C1/C66 分裂）*/
export const isRealNpc = (r?: { name: string; id: string; isDead?: boolean }) =>
  !!(r && r.name && r.name !== r.id && !r.isDead);

/* 新角色姓名清洗（ENTRY_NAME_CN_RULE 轻量护栏）：剥离中文名后缀/括号里的罗马音注释
   （「艾莉丝(Alice)」→「艾莉丝」、「卡尔·Karl」→「卡尔」），仅当剥离后仍含中文时才剥；
   纯英文/罗马音名无法机翻 → 原样返回（由调用方告警，不强行删角色）。确定性、无 API。 */
export function sanitizeEntryName(raw?: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return s;
  const stripped = s
    .replace(/[（(][A-Za-z0-9·\s.'-]+[)）]/g, '')          // 括号里的纯罗马音注释
    .replace(/[·•\s]+[A-Za-z][A-Za-z0-9·•\s.'-]*$/g, '')   // 中文名尾部的「·英文 / 空格英文」
    .trim();
  return stripped && /[一-鿿]/.test(stripped) ? stripped : s;
}

/* 剥掉「泄漏进正文」的思维链块：部分中转/代理会把思考模型的 <think> 拍平进 content 流，
   或末尾 </think> 预填充被回显——这些不该出现在玩家看到的正文里，也不该喂给演化阶段。
   只删【闭合】的 <think>/<thinking>/<thought> 块 + 开头残留的孤立 </think>（预填充回显）；
   不动未闭合的开标签（删它会把悬空链内容暴露成正文，宁可留着由长度/坏味把关）。确定性、无 API。 */
export function stripLeakedThinking(text: string): string {
  if (!text) return text;
  let t = text;
  if (/<\/?(?:think|thinking|thought)\b/i.test(t)) {
    t = t.replace(/<(think|thinking|thought)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trimStart();   // 闭合思维块（任意位置）
    // 预填充 <think>/</think> 强制或跳过思维链时，端点可能只回「…思考续写…</think>正文」——开标签在 prefill 里没回显，
    // 剩下一个「前方没有任何 <think 开标签」的孤立闭合标签：把它连同它之前的思考草稿整段剥掉（普通正文不会出现裸 </think>）。
    const cm = /<\/(?:think|thinking|thought)>/i.exec(t);
    if (cm && !/<(?:think|thinking|thought)\b/i.test(t.slice(0, cm.index))) t = t.slice(cm.index + cm[0].length);
    t = t.trimStart();
  }
  return stripLeadingPlanLeak(t);
}

/* 兜底：模型把「动笔前思考」草稿裸奔在正文最前（没包 <think>，故上面按标签剥不到）。
   仅当开头那段——含 ≥2 个规划标记（切入点/节拍/防OOC/字数目标/世界之源/要输出/钩子/落点/时间设定…）——
   且以「落笔」收口时，整段剥掉。两道闸（≥2标记 + 落笔收口）保证普通正文绝不误伤。 */
const PLAN_MARKS = ['切入点', '节拍', '防OOC', '字数目标', '字数设定', '世界之源', '要输出', '信息卡', '钩子', '落点', '时间设定', '观察核心', '本回合是'];
function stripLeadingPlanLeak(text: string): string {
  if (!text || text.indexOf('落笔') < 0) return text;
  const m = text.match(/^\s*([\s\S]{20,5000}?落笔[。.!！]?)\s*(?:\n|$)/);
  if (!m) return text;
  const head = m[1].replace(/\s/g, '');
  const hits = PLAN_MARKS.filter((k) => head.includes(k)).length;
  if (hits >= 2) return text.slice(m[0].length).trimStart();
  return text;
}

/* 主角「属性成长信号」——正文里出现 ①某属性/实力词＋成长词(近邻)、②突破/晋阶到更高阶位、或 ③显式数值加成，
   才算"原文写了属性提升"。用于挡住「正文根本没写属性成长、演化阶段却自行给主角加六维」的乱加：无信号一律不许上调。
   宁可漏判(真成长偶尔被挡，交由提示词把关)也不在毫无成长描写时纵容——与"忠于原文"诉求一致。 */
export const ATTR_GROWTH_RE = new RegExp(
  '(属性|六维|资质|根骨|筋骨|力量|膂力|臂力|气力|敏捷|身法|体质|体魄|气血|智力|悟性|心神|神识|精神力|魅力|气质|幸运|气运|实力|战力|修为|根基|底蕴)' +
  '[^。！？!?\\n]{0,16}' +
  '(提升|增长|增强|提高|上涨|上升|增加|涨了|猛涨|精进|强化|蜕变|进化|暴涨|飙升|翻倍|倍增|大增|大涨|更强|变强|强健|强悍|充盈|凝实|凝练|淬炼|脱胎换骨|今非昔比|突飞猛进|更上一层)' +
  '|(?:突破|晋升|晋阶|进阶|升阶|越阶|跃升)[^。！？!?\\n]{0,6}(?:阶|级|境界|大境|重天|层楼|品阶)|渡劫成功|境界[^。！？!?\\n]{0,4}(?:提升|跃升|突破|精进)' +
  '|脱胎换骨|今非昔比|突飞猛进|一日千里|实力大增|功力大涨|修为大进|判若两人' +     // 不需邻接属性词的强成长成语
  '|(?:力量|敏捷|体质|智力|魅力|幸运|属性|六维)\\s*[＋+]\\s*\\d',
);
// 本回合登场判断/重点演化涉及的 NPC（优先重定向目标），由 runPostNarrativePhases 维护
let npcPreferredOwners: string[] = [];
export function setNpcPreferredOwners(ids: string[]) { npcPreferredOwners = ids; }
setNpcOwnerResolver((owner) => {
  const npc = useNpc.getState();
  if (isRealNpc(npc.npcs[owner])) return owner;            // owner 本就是真实NPC id → 保持
  // 1) owner 可能是 NPC 名字（AI 常用名而非 id）→ 按名精确匹配到「唯一」真实 NPC
  const norm = (s?: string) => (s ?? '').replace(/\s+/g, '').toLowerCase();
  const on = norm(owner);
  if (on) {
    const byName = Object.values(npc.npcs).filter((r) => isRealNpc(r) && norm(r.name) === on);
    if (byName.length === 1) { console.log(`[Item] owner「${owner}」按名匹配到 ${byName[0].id}`); return byName[0].id; }
  }
  // 2) 仅当本回合涉及「恰好一个」真实 NPC 时，才把无法解析的 owner 归到它（确属该 NPC 的概率高）
  const pref = npcPreferredOwners.filter((id) => isRealNpc(npc.npcs[id]));
  if (pref.length === 1) { console.log(`[Item] owner ${owner} → 重定向到本回合唯一目标 ${pref[0]}`); return pref[0]; }
  // 3) 归属不明（真实NPC不唯一）→ 保持原 owner、绝不喷到任意在场NPC，
  //    避免「莫名其妙把别人的装备塞进某个无关NPC包里」。原 owner 若是无效串，至多生成一个可见可清理的占位记录。
  console.warn(`[Item] owner「${owner}」归属不明（非真实id、按名匹配不到唯一NPC、本回合目标也不唯一）——保持原ID，不重定向到在场NPC`);
  return owner;
});

/* eq/uneq 短指令把 NPC 物品错挂到 B1 时的兜底：在 NPC 持有物里找到并就地装备/卸下 */
function equipNpcItemFallback(itemId: string, slotStr: string): boolean {
  const npc = useNpc.getState();
  for (const rec of Object.values(npc.npcs)) {
    const ni = rec.items.find((it) => it.id === itemId || it.name === itemId);
    if (ni) {
      if (!isEquippable(ni.category) || isResourcePseudoItem(ni)) { console.warn(`[State] 拒绝装备 NPC ${rec.id}「${ni.name}」：${isResourcePseudoItem(ni) ? '货币/点数类资源' : ni.category + ' 非装备类'}`); return true; }
      npc.equipNpcItem(rec.id, ni.id, slotStr);
      console.log(`[State] NPC ${rec.id} 装备 ${ni.name} → ${slotStr}`);
      return true;
    }
  }
  return false;
}
function unequipNpcItemFallback(itemId: string): boolean {
  const npc = useNpc.getState();
  for (const rec of Object.values(npc.npcs)) {
    const ni = rec.items.find((it) => it.id === itemId || it.name === itemId);
    if (ni) {
      npc.unequipNpcItem(rec.id, ni.id);
      console.log(`[State] NPC ${rec.id} 卸下 ${ni.name}`);
      return true;
    }
  }
  return false;
}

function applyOneUpdate(u: StateUpdate) {
  const { key, op, value } = u;
  const game = useGame.getState();
  const vars = useVariables.getState();

  const playerNumericKeys = ['hp', 'maxHp', 'mp', 'maxMp', 'san', 'maxSan', 'points', 'atk', 'def'] as const;
  type PlayerNumericKey = typeof playerNumericKeys[number];

  if ((playerNumericKeys as readonly string[]).includes(key) && typeof value === 'number') {
    const current = game.player[key as PlayerNumericKey] as number;
    const next = op === '+=' ? current + value : op === '-=' ? current - value : value;
    game.setPlayerField(key as PlayerNumericKey, next);
    return;
  }

  // ── 自定义能量条（仅主角·纯剧情资源）：res.B1.<id> 或 res.<id> op value（id 为 ASCII 机器键）──
  // 例：res.B1.rage += 20、res.corruption = 50、res.B1.spirit -= 10；只改玩家已定义的条，AI 不能自创
  const customRes = key.match(/^res\.(?:B1\.)?([A-Za-z][\w-]*)$/);
  if (customRes && (typeof value === 'number' || typeof value === 'string')) {
    const R = useResource.getState();
    const rid = customRes[1];
    const def = R.resources.find((r) => r.id === rid || r.name === rid);
    if (!def) return;   // 未定义的能量条 → 忽略（只玩家定义，不自创）
    const rmax = playerResourceMax(def);
    let setMode = op === '=', toFull = false, amount = 0;
    if (typeof value === 'number') amount = value;
    else {
      const sv = String(value);
      if (/满|max|full|回满|复满|全满|100\s*%/i.test(sv)) { toFull = true; setMode = true; }
      else { const n = Number(sv.split('/')[0].replace(/[^\d.-]/g, '')); if (!Number.isFinite(n)) return; amount = n; setMode = true; }
    }
    const cur = Math.min(Math.max(0, def.cur ?? 0), rmax);
    const next = toFull ? rmax : setMode ? Math.min(Math.max(0, amount), rmax) : op === '+=' ? Math.min(cur + amount, rmax) : Math.max(0, cur - amount);
    R.setCur(def.id, Math.round(next));
    return;
  }

  // ── 角色资源短指令：hp./mp./san. 等带 .<角色ID> 后缀（主角演化/NPC演化预设格式）──
  // 例：hp.B1 -= 20、san.B1 = 80、hp.C1 -= 15
  const resMatch = key.match(/^(hp|maxHp|mp|maxMp|san|maxSan)\.([A-Za-z]\w*)$/);
  if (resMatch) {
    const stat = resMatch[1];
    const cid  = resMatch[2];
    // 数值：纯数字(=/+=/-=) 或 "当前/上限"字符串(如 100/120，视作设定当前值；上限由前端按六维换算，忽略斜杠后的上限)
    let amount: number; let setMode = op === '='; let toFull = false;
    if (typeof value === 'number') amount = value;
    else {
      const sv = String(value);
      // "满/满血/MAX/full/痊愈/回满/100%" 等 → 回满（上限前端按六维算，AI 常不知确切数值）
      if (/满|max|full|痊愈|回满|复满|全满|100\s*%/i.test(sv)) { toFull = true; setMode = true; amount = 0; }
      else {
        const digits = sv.split('/')[0].replace(/[^\d.-]/g, '');
        const n = Number(digits);
        // 关键修复：digits 为空时 Number('')===0 会把资源误清零（如 AI 写 hp.B1=满）；无有效数字一律跳过
        if (digits === '' || !Number.isFinite(n)) return;
        amount = n; setMode = true;
      }
    }
    if (cid === 'B1') {
      // 玩家 HP/EP：上限按体质×20 / 智力×15 自动换算并同步写回 maxHp/maxMp
      if (stat === 'hp' || stat === 'mp') {
        const dmax = stat === 'hp' ? playerMaxHp() : playerMaxEp();
        const curMaxKey = (stat === 'hp' ? 'maxHp' : 'maxMp') as PlayerNumericKey;
        const cur = effectiveResource(game.player[stat as PlayerNumericKey] as number, game.player[curMaxKey] as number, dmax);
        const next = toFull ? dmax : setMode ? Math.min(Math.max(0, amount), dmax) : op === '+=' ? Math.min(cur + amount, dmax) : Math.max(0, cur - amount);
        game.setPlayerField(stat as PlayerNumericKey, next);
        game.setPlayerField(curMaxKey, dmax);
        return;
      }
      if (toFull) return;   // 非 hp/mp 属性无自动上限，"满"无法换算 → 跳过，避免误清零
      const cur = (game.player[stat as PlayerNumericKey] as number) ?? 0;
      const next = setMode ? amount : op === '+=' ? cur + amount : cur - amount;
      game.setPlayerField(stat as PlayerNumericKey, next);
      return;
    }
    if (/^[CG]/.test(cid)) {   // NPC：含非标准ID（如 C_SAEKO_01）一并路由，避免"未知变量"误报且能正确落档
      if (stat === 'hp' || stat === 'mp') {
        const npc = useNpc.getState();
        const rec = npc.npcs[cid];
        const nc = useCharacters.getState().characters[cid];
        const eqp = (rec?.items ?? []).filter((it) => it.equipped) as any[];
        const dmax = stat === 'hp' ? fullMaxHp(npcBaseAttrs(rec), eqp, nc?.skills, nc?.traits, 1, ratioOf(rec)) : fullMaxEp(npcBaseAttrs(rec), eqp, nc?.skills, nc?.traits, 1, ratioOf(rec));   // npcBaseAttrs=attrs+真实属性点直加(realAttrs)
        const cur = effectiveResource(stat === 'hp' ? rec?.hp : rec?.mp, stat === 'hp' ? rec?.maxHp : rec?.maxMp, dmax);
        const next = toFull ? dmax : setMode ? Math.min(Math.max(0, amount), dmax) : op === '+=' ? Math.min(cur + amount, dmax) : Math.max(0, cur - amount);
        npc.upsertNpc(cid, stat === 'hp' ? { hp: next, maxHp: dmax } : { mp: next, maxMp: dmax });
      }
      return;
    }
    return;
  }

  if (key === 'item.add' && typeof value === 'string') {
    game.addItem(value);
    return;
  }
  if (key === 'item.remove' && typeof value === 'string') {
    game.removeItem(value);
    return;
  }

  // 货币：currency.乐园币 += 500 / currency.灵魂钱币 -= 10 / currency.技能点 += 5 / currency.黄金技能点 += 1
  const ccRsn = op === '+=' ? '正文入账' : op === '-=' ? '正文支出' : '正文设定';   // <state> 货币简写的流水缘由（AI 未细分时的兜底）
  const ccMatch = key.match(/^currency\.(乐园币|灵魂钱币|技能点|黄金技能点)$/);
  if (ccMatch && typeof value === 'number') {
    const type = ccMatch[1] as '乐园币' | '灵魂钱币' | '技能点' | '黄金技能点';
    const itemStore = useItems.getState();
    const cur = itemStore.currency[type];
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    itemStore.adjustCurrency(type, next - cur, ccRsn, true);   // silent：正文<state>驱动，AI 自知，不生成场外通报
    return;
  }
  // 简写：直接用货币名作为 key（乐园币 += 100 / 技能点 += 5 / 黄金技能点 += 1）
  if ((key === '乐园币' || key === '灵魂钱币' || key === '技能点' || key === '黄金技能点') && typeof value === 'number') {
    const ck = key as '乐园币' | '灵魂钱币' | '技能点' | '黄金技能点';
    const itemStore = useItems.getState();
    const cur = itemStore.currency[ck];
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    itemStore.adjustCurrency(ck, next - cur, ccRsn, true);   // silent：正文<state>驱动，不生成场外通报
    return;
  }

  // eq.* 短指令：装备物品
  // 格式: eq.B1 = slot:part:itemId|reason
  // 例如: eq.B1 = armor:head:I_B1_12|装备头部防具
  //        eq.B1 = weapon:right:I_B1_08|右手持武器
  //        eq.B1 = treasure:#5:I_B1_50|装备法宝
  //        eq.B1 = technique:2:I_B1_01|装备技能书
  if (key.startsWith('eq.') && typeof value === 'string') {
    const valueStr = value.split('|')[0].trim();
    const parts = valueStr.split(':');
    if (parts.length >= 3) {
      const [slot, partOrHand, itemId] = parts;
      let slotStr = '';
      if (slot === 'armor') slotStr = `armor:${partOrHand}`;
      else if (slot === 'weapon') slotStr = `weapon:${partOrHand}`;
      else if (slot === 'treasure') slotStr = partOrHand.startsWith('#') ? `treasure:${partOrHand}` : `treasure:#${partOrHand}`;
      else if (slot === 'accessory') slotStr = partOrHand.startsWith('#') ? `accessory:${partOrHand}` : `accessory:#${partOrHand}`;
      else if (slot === 'technique') slotStr = `technique:${partOrHand}`;
      else slotStr = slot;

      const itemStore = useItems.getState();
      const item = itemStore.items.find((it) => it.id === itemId || it.name === itemId);
      if (item) {
        // 主角自动装备开关：关闭时忽略 AI 对主角的 eq 指令（玩家在装备面板手动穿戴）
        if (key === 'eq.B1' && !useSettings.getState().allowAutoEquip) { console.log('[State] 已关闭自动装备，忽略主角 eq 指令'); return; }
        if (!isEquippable(item.category) || isResourcePseudoItem(item)) { console.warn(`[State] 拒绝装备「${item.name}」：${isResourcePseudoItem(item) ? '货币/点数类资源，不可装备' : item.category + ' 非装备类'}`); return; }
        // 按分类校验槽位：AI 槽位与分类不符（如武器→饰品槽）时自动改到正确槽
        const fixedSlot = resolveEquipSlot(item, itemStore.items, slotStr);
        itemStore.equipItem(item.id, fixedSlot);
        console.log(`[State] 装备 ${item.name} → ${fixedSlot}`);
      } else if (!equipNpcItemFallback(itemId, slotStr)) {
        // 物品既不在玩家背包，也不在任何 NPC 持有物中
        console.warn(`[State] eq 指令找不到物品: ${itemId}`);
      }
    }
    return;
  }

  // uneq.* 短指令：卸下装备
  // 格式: uneq.B1 = slot:part:itemId|reason
  if (key.startsWith('uneq.') && typeof value === 'string') {
    const valueStr = value.split('|')[0].trim();
    const segs = valueStr.split(':').map((s) => s.trim()).filter(Boolean);
    const itemId = segs.length >= 3 ? segs[2] : (segs[segs.length - 1] || valueStr);
    const itemStore = useItems.getState();
    // 1) 精确：按 id / 名 找
    let item = itemStore.items.find((it) => it.id === itemId || it.name === itemId);
    // 2) 槽位/部位关键词兜底：如 uneq.B1 = armor / weapon:main / armor:upper → 卸下对应已装备项
    if (!item) {
      const v = valueStr.toLowerCase();
      item = itemStore.items.find((it) => it.equipped && it.equipSlot && (
        it.equipSlot.toLowerCase() === v || it.equipSlot.toLowerCase().split(':')[0] === v || it.equipSlot.toLowerCase().startsWith(v)
      ));
    }
    if (item) {
      itemStore.unequipItem(item.id);
      console.log(`[State] 卸下 ${item.name}`);
    } else if (!unequipNpcItemFallback(itemId)) {
      console.warn(`[State] uneq 指令找不到物品: ${itemId}`);
    }
    return;
  }

  // 副职业短指令：ca.<id>.<副职业名> = 档位/进度 或 += / -= 进度
  const caM = key.match(/^ca\.(B\d+)\.(.+)$/);   // 副职业仅主角
  if (caM && !caM[2].includes('::')) {
    const cid = caM[1]; const name = caM[2].trim();
    const cs = useCharacters.getState();
    if (op === '=') {
      const sv = String(value); const parts = sv.split('/');
      let tier: string | undefined; let prog: number | undefined;
      if (parts.length > 1) { tier = parts[0].trim() || undefined; prog = Number(parts[1]); }
      else if (isNaN(Number(parts[0]))) { tier = parts[0].trim(); }
      else { prog = Number(parts[0]); }
      cs.addSubProfession(cid, { name, tier: tier as string, progress: prog });
    } else if (typeof value === 'number') {
      cs.bumpSubProf(cid, name, op === '-=' ? -value : value);
    }
    return;
  }
  // 配方短指令：rc.<id>.<副职业>::<配方> += N / -= N / = N
  const rcM = key.match(/^rc\.(B\d+)\.(.+?)::(.+)$/);   // 副职业仅主角
  if (rcM && typeof value === 'number') {
    useCharacters.getState().bumpRecipe(rcM[1], rcM[2].trim(), rcM[3].trim(), op === '-=' ? -value : value);
    return;
  }

  // 其他角色短指令前缀（cr./pr./loc./character(s).<id>.*）应用未建模，静默跳过避免控制台噪音
  if (/^(cr|pr|ca|rc|loc|tm)\.[A-Za-z]/.test(key) || /^characters?\.[A-Za-z]/.test(key) || /^npc\.[A-Za-z]/.test(key) || /^faction\.[A-Za-z]/.test(key)) {
    return;
  }

  const def = vars.variables.find((v) => v.key === key);
  if (!def) {
    console.warn(`[State] 未知变量 "${key}"，跳过`);
    return;
  }

  if (def.type === 'number' && typeof value === 'number') {
    const cur = typeof def.value === 'number' ? def.value : 0;
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    vars.setVariable(key, next);
  } else if (def.type === 'boolean') {
    vars.setVariable(key, Boolean(value));
  } else {
    vars.setVariable(key, String(value));
  }
}

/* 结算·货币完全忠于【最终清算】面板「获得货币: N 乐园币/灵魂钱币」（玩家亲眼所见的唯一授予）：
   结算这一笔货币授予就是面板那一条，<state> 里所有 乐园币/灵魂钱币 的 += 都被**收敛成唯一一条 `面板币种 += 面板额`**，
   一次修好三种 AI 出错：① 金额不符（面板 7000、指令 4000）② **币种写错**（面板 灵魂钱币、指令却 乐园币 += → 钱进错币种）
   ③ 重复/双发（统计+发放各写一遍、或两种币各发一次）。仅结算回合(atSettlement)调用。
   注：结算 <state> 规范只有一条货币行（见 WORLD_SETTLEMENT_RULE），故收敛安全；实物奖励走 <upstore> createItem 不受影响。 */
export function reconcileSettlementCurrency(raw: string, updates: StateUpdate[]): StateUpdate[] {
  const gm = /获得货币\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*([\d,]+)\s*\*{0,2}\s*(乐园币|灵魂钱币|魂币)/.exec(raw);
  if (!gm) return updates;
  const panelAmt = Number(gm[1].replace(/,/g, ''));
  const panelType = gm[2] === '魂币' ? '灵魂钱币' : gm[2];
  if (!Number.isFinite(panelAmt) || panelAmt <= 0) return updates;
  const curType = (k: unknown) => (typeof k === 'string' ? (k.startsWith('currency.') ? k.slice(9) : k) : '');   // 'currency.乐园币' → '乐园币'
  const isCurAward = (u: StateUpdate) => (curType(u.key) === '乐园币' || curType(u.key) === '灵魂钱币') && u.op === '+=' && typeof u.value === 'number';
  let placed = false;
  const out: StateUpdate[] = [];
  for (const u of updates) {
    if (isCurAward(u)) {
      const before = `${curType(u.key)} += ${u.value}`;
      if (placed) { console.warn(`[结算·货币忠于面板] 丢弃多余货币指令 ${before}（面板唯一授予 ${panelType} ${panelAmt}）`); continue; }   // 去重/去双发
      placed = true;
      if (curType(u.key) !== panelType || u.value !== panelAmt) console.warn(`[结算·货币忠于面板] ${before} → ${panelType} += ${panelAmt}（以面板「获得货币」为准·纠正币种/金额）`);
      out.push({ ...u, key: panelType, value: panelAmt, raw: `${panelType} += ${panelAmt}` });   // 收敛成面板币种+面板额
      continue;
    }
    out.push(u);
  }
  return out;
}

export function applyStateUpdates(raw: string) {
  // ★ 点数（潜能点/技能点/黄金技能点/属性点）**只在「世界结算」时由正文一次性发放**：
  //   平时正文只"计入/统计"不入账（防提前发），消耗交由前端确定性系统处理（防按正文"消耗"乱扣），
  //   且各演化阶段(物品/主角/NPC/对账)的输出都不含 <世界结算>，故不会重复计数。判据=本段文本是否含 <世界结算> 块。
  const atSettlement = /<世界结算>/.test(raw);
  // 潜能点（技能树）：pp.B1 += N / pp += N —— 仅世界结算发放，单回合封顶防刷
  if (atSettlement) {
    const ppM = [...raw.matchAll(/\bpp(?:\.B1)?\s*\+?=\s*(\d+)/gi)];
    if (ppM.length) {
      let sum = 0; const seen = new Set<string>();
      for (const m of ppM) { const k = m[0].replace(/\s+/g, ''); if (seen.has(k)) continue; seen.add(k); sum += Number(m[1]) || 0; }   // 去重：同一条 += 在「统计」「发放」各写一遍 → 只算一次
      sum = Math.min(sum, SKILLTREE_TUNING.aiBonusTurnCap);
      if (sum > 0) { try { useSkillTree.getState().grantBonusPP('B1', sum); console.log(`[潜能点] +${sum}`); } catch { /* */ } }
    }
  }
  // 技能点 / 黄金技能点（世界结算奖励）：`技能点 += N`/`黄金技能点 += N`；长名放前面避免被当成「技能点」重复匹配。
  if (atSettlement) {
    const spRe = /(黄金技能点|技能点)\s*([-+]?=)\s*(-?\d+)/g;
    let sm: RegExpExecArray | null; const seenSp = new Set<string>();
    while ((sm = spRe.exec(raw))) {
      const k = sm[0].replace(/\s+/g, ''); if (seenSp.has(k)) continue; seenSp.add(k);   // 去重：统计+发放同一条只算一次
      const type = sm[1] as '技能点' | '黄金技能点';
      const n = Number(sm[3]);
      if (!Number.isFinite(n)) continue;
      try {
        const I = useItems.getState();
        const cur = I.currency[type] ?? 0;
        const next = sm[2] === '+=' ? cur + n : sm[2] === '-=' ? cur - n : n;
        I.adjustCurrency(type, next - cur, '世界结算发放', true);   // silent：世界结算(正文驱动)，AI 自知，不生成场外通报
        console.log(`[${type}] ${sm[2]} ${n} → ${next}`);
      } catch { /* */ }
    }
  }
  // 当地货币（任务世界本地货币·世界限定·离世归零）：土著报酬 / 本地买卖走它，别发乐园币/魂币。
  //   ⚠走独立正则扫 raw（parseLine 的 key 正则是 ASCII \w、匹配不到中文币名，与乐园币同坑）；名称+余额存 miscStore。
  //   `当地货币名 = 贝利`/`本地货币名 = 戒尼` 设定本世界货币名；`当地货币 += N`/`-= N`/`= N` 加减/校准余额。
  try {
    const M = useMisc.getState();
    const nameM = raw.match(/(?:当地货币名称|当地货币名|本地货币名称|本地货币名)\s*[:=]\s*([^\n，,。;；、（()）]{1,16})/);
    if (nameM && nameM[1].trim()) M.setLocalCurrencyName(nameM[1].trim());
    const amtRe = /(?:当地货币|本地货币)\s*([-+]?=)\s*(-?\d[\d,]*)/g;
    let am: RegExpExecArray | null; const seenAmt = new Set<string>();
    while ((am = amtRe.exec(raw))) {
      const k = am[0].replace(/\s+/g, ''); if (seenAmt.has(k)) continue; seenAmt.add(k);   // 去重：同一条「统计+入账」写两遍只算一次
      const n = Number(am[2].replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      if (am[1] === '=') M.setLocalCurrency(n); else M.adjustLocalCurrency(am[1] === '-=' ? -n : n);
    }
  } catch { /* 当地货币解析失败不阻断其余 state 应用 */ }
  let updates = parseAllStateUpdates(raw);
  if (updates.length === 0) return;
  if (atSettlement) updates = reconcileSettlementCurrency(raw, updates);   // 结算·货币忠于【最终清算】面板 + 同类去重防双入账
  console.log('[State] 解析到变量更新:', updates);
  for (const u of updates) {
    try { applyOneUpdate(u); } catch (e) { console.warn('[State] 应用更新失败:', u, e); }
  }
}

export function applyAllUpdates(raw: string, ctx?: LedgerCtx, opts?: { deferItemCreate?: boolean; suppressCreateNames?: string[] }): { itemResults: ItemEditResult[] } {
  // ★ 先创建物品（<upstore> createItem），再应用 <state>（含 eq 装备短指令），
  //   否则 eq 会在物品尚未创建时执行而装备失败（物品全堆在储物袋里）。
  const parsedItemCmds = parseAllItemCommands(raw);
  // 奖励预告守卫：正文只是"🎁奖励预告"时，拦掉与预告金额匹配的货币提前入账（非结算回合）——治"预告≠到账却真加钱"。
  const { cmds: itemCmdsAll, blocked: previewBlocked } = stripPreviewRewardCurrency(raw, parsedItemCmds);
  if (previewBlocked > 0) console.warn(`[货币] 奖励预告守卫：本回合拦截 ${previewBlocked} 笔预告货币提前发放`);
  // 物品阶段独占建物品：主正文在「本回合物品阶段会跑」时传 deferItemCreate=true，跳过正文自带的 createItem，
  //   交由带护栏（思维链/背包快照/判重闸门/货币守卫/回喂纠错）的物品阶段统一建一次——根治
  //   "正文 <upstore> + 物品阶段各建一次 → 同一件物两条(描述还不一样、判重按名字漏网)"。消耗/更新/穿脱/转移等其余物品指令仍即时生效。
  let itemCmds = opts?.deferItemCreate ? itemCmdsAll.filter((c) => c.type !== 'createItem') : itemCmdsAll;
  if (opts?.deferItemCreate && itemCmds.length !== itemCmdsAll.length)
    console.log(`[Item] 主正文延后 ${itemCmdsAll.length - itemCmds.length} 条 createItem → 交物品阶段独占建（去重）`);
  // 设施已发放物：本回合由开箱/合成等确定性发放、已在背包中的物品——**绝不可再 createItem**（防重复建档；
  // 容忍正文把名字写漂：归一化后双向包含匹配，"暗金·裂空战刃"≈"裂空战刃"也拦下，补 dedupeByName 按精确名漏合并的洞）。
  if (opts?.suppressCreateNames?.length) {
    const norm = (s: string) => String(s ?? '').replace(/[\s·・,，。.、"'「」【】\[\]()（）+＋]/g, '').toLowerCase();
    const banned = opts.suppressCreateNames.map(norm).filter((b) => b.length >= 2);   // 太短的名字不做包含匹配，防误杀
    if (banned.length) {
      const before = itemCmds.length;
      itemCmds = itemCmds.filter((c) => {
        if (c.type !== 'createItem') return true;
        const d: any = c.data ?? {};
        const nm = norm(String((d.item ?? d).name ?? (d.item ?? d)['1'] ?? ''));
        if (nm.length < 2) return true;
        const hit = banned.some((b) => nm === b || nm.includes(b) || b.includes(nm));
        if (hit) console.log(`[Item] 抑制重复 createItem「${String((d.item ?? d).name ?? '')}」——本回合已由设施(开箱/合成)确定性发放并入库`);
        return !hit;
      });
      if (itemCmds.length !== before) console.log(`[Item] 设施已发放物：拦下 ${before - itemCmds.length} 条重复 createItem`);
    }
  }
  let itemResults: ItemEditResult[] = [];
  if (itemCmds.length > 0) {
    console.log('[Item] 解析到物品指令:', itemCmds);
    itemResults = applyItemCommands(itemCmds, ctx);   // 经单一闸门：解析稳定 id / 去重 / 记账本 / 返回结构化结果
  }
  applyStateUpdates(raw);
  // ACU 表格数据库：认正文里的 <tableEdit> 块 → 写 tableStore（与 <state>/<upstore> 并存）。
  // 只有真含 <tableEdit> 的回复（主正文/填表阶段）才动手；其余阶段回复走到这里是 no-op。
  // 单一提交闸门 + 幂等留作后续硬化（设计文档 §4B），当前每条回复应用一次（同物品阶段）。
  try {
    const te = applyTableEdits(raw);
    if (te.applied > 0 || te.failed > 0) {
      console.log(`[Table] 填表：应用 ${te.applied} 条，失败 ${te.failed}`, te.modifiedUids);
      if (te.errors.length) console.warn('[Table] 填表告警:', te.errors);
    }
  } catch (e) { console.warn('[Table] 填表应用失败（忽略）:', e); }
  // 1c 投影：store 已在上面(item/state)更新完 → 把 13 张镜像表从 store 重新派生（纪要表=编年史不动）。
  //   单一写入方=store，AI 若用 <tableEdit> 填了镜像表也在此被覆盖 → 表↔store 漂移从构造上不可能发生。
  try { projectStoresToTables(); } catch (e) { console.warn('[Table] 镜像表投影失败（忽略）:', e); }
  // Step 10 状态对账看门狗：每次应用后按不变量核对 货币/物品/NPC 当前态，corruption/漂移当场告警
  //   （幽灵NPC/重复id双计/装备槽冲突/货币漂移）——不是几周后才发现。纯只读，绝不阻断主流程。
  try {
    seedWalletIfEmpty(useItems.getState().currency as unknown as Record<string, number>);   // 货币影子对齐
    seedItemsIfEmpty((useItems.getState() as { items?: unknown[] }).items ?? []);   // 物品影子对齐
    seedNpcsIfEmpty((useNpc.getState() as { npcs?: Record<string, unknown> }).npcs ?? {});   // NPC 影子对齐
    for (const r of watchdogViolations()) console.warn(`[看门狗] ⚠ ${r.domain}：`, r.violations);
  } catch { /* 看门狗绝不阻断主流程 */ }
  return { itemResults };
}

/* 过渡期：进阶点数/击杀结算已移除。正文若仍输出旧 <kill> 清单，直接剥除不显示
   （世界结算改版后由「关键词触发 → 正文 AI 结算」的新机制接管升级）。 */
export function stripKillBlocks(raw: string): string {
  return /<kill>/i.test(raw) ? raw.replace(/<kill>[\s\S]*?<\/kill>/gi, '').trimEnd() : raw;
}

/* 剥除正文末尾的 <状态结算> HP/EP 块（仅用于「显示给玩家」的文本）：
   该块是隐藏数据通道——解析器(applyNarrativeVitals/NpcVitals)与 HP/EP 管理阶段照常读它，但玩家看不到，
   故主角即使把血条改名「血池/血怒」，这里也不会让"当前HP"原词露脸。闭合与未闭合(截断流)两种形态都剥。 */
export function stripVitalsBlocks(raw: string): string {
  let s = raw;
  // 标准尖括号版 <状态结算>…</状态结算>（含截断流未闭合形态）
  if (/<状态结算>/i.test(s)) s = s.replace(/<状态结算>[\s\S]*?<\/状态结算>/gi, '').replace(/<状态结算>[\s\S]*$/i, '');
  // 兜底：AI 受【…】模块块带偏、把状态结算写成方括号【状态结算】(无闭合标签) → 也剥掉，
  //   否则它含「结算」会被 SETTLE_HEADER_RE 当模块卡渲染、把 HP/EP 暴露给玩家。剥到下一个【…】块标题或文末。
  if (/【状态结算】/.test(s)) s = s.replace(/[ \t]*\*{0,2}【状态结算】[\s\S]*?(?=\n\s*\*{0,2}【|$)/g, '');
  return s.trimEnd();
}

/* 剥除正文末尾的 <世界之源> 总量块（仅用于「显示给玩家」的文本）：
   该块是隐藏数据通道——世界之源结算（主角演化阶段 WORLDSOURCE_RULE）照常读它拿"当前累计总量"，但玩家看不到；
   玩家可见的世界之源是击杀结算/任务模块里就地显示的"本次获得多少"明细。闭合与未闭合(截断流)两种形态都剥。 */
export function stripWorldSourceBlocks(raw: string): string {
  return /<世界之源>/i.test(raw)
    ? raw.replace(/<世界之源>[\s\S]*?<\/世界之源>/gi, '').replace(/<世界之源>[\s\S]*$/i, '').trimEnd()
    : raw;
}

/* 安全网：折叠"失控复读"（反极其）。模型偶发卡死会把同一短串（如「极其」「哈」「。」「\n」）连续复读成百上千次，
   原始文本直接渲染会把前端卡死（本仓库即名「前端卡」）。这里把任意 1–8 字的单元连续重复 ≥8 次的串折叠回单个单元。
   阈值 8 远高于中文正常叠词（好好/看看/高高兴兴）与笑声「哈哈哈」，故只命中病态复读、不误伤正常文本；
   只折叠"连续"重复，分散出现的同一短语（A…A）不受影响。dotAll 让换行/多行块也能折叠。 */
export function collapseRunaway(raw: string): string {
  if (!raw || raw.length < 8) return raw;   // 不足 8 字不可能构成"单元×8"的失控串，省正则开销
  return raw.replace(/(.{1,8}?)\1{7,}/gs, '$1');
}
