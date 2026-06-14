import { useState, useRef, useEffect } from 'react';
import { useGame } from './store/gameStore';
import { useSettings, resolveApiChain } from './store/settingsStore';
import { apiChatFallback } from './systems/apiChat';
import { useVariables } from './store/variableStore';
import { parseAllStateUpdates, stripStateBlocks, parseAllItemCommands, applyItemCommands, parseAllCharCommands, applyCharacterCommands, parseAllNpcCommands, applyNpcCommands, parseAllFactionCommands, applyFactionCommands, applyTerritoryCommands, applyTeamCommands, isEquippable, setNpcOwnerResolver, type StateUpdate } from './systems/stateParser';
import { useTerritory, buildTerritorySystemPrompt, buildingCap } from './store/territoryStore';
import { useTeam, buildTeamSystemPrompt, memberCap as teamMemberCap } from './store/adventureTeamStore';
import { useCosmos, buildCosmosSystemPrompt } from './store/cosmosStore';
import { realmFromLevel, normalizeTier, lvFromRealm, trueAttr, computeMaxHp, computeMaxEp, effectiveResource } from './systems/derivedStats';
import { useImageGen, effectiveEquipService } from './store/imageGenStore';
import { generateImage, buildPortraitPrompt, buildEquipPrompt, shrinkDataUrl } from './systems/imageGen';
import { genPortraitTags, genEquipTags, isTagService } from './systems/imageTags';
import { hydrateImages, initImageSync } from './systems/imageSync';
import { loadWb, saveWb } from './systems/wbDb';
import TerritoryPanel from './components/TerritoryPanel';
import CosmosPanel from './components/CosmosPanel';
import AdventureTeamPanel from './components/AdventureTeamPanel';
import ImageViewer from './components/ImageViewer';
import ImageBusyToast from './components/ImageBusyToast';
import { useItems, extractItemPresetFromJson } from './store/itemStore';
import type { ItemPresetEntry } from './store/itemStore';
import { usePlayer, buildPlayerSystemPrompt, extractPlayerPresetFromJson } from './store/playerStore';
import { useNpcEvo, extractNpcPresetFromJson } from './store/npcEvoStore';
import { useFaction } from './store/factionStore';
import { useFactionEvo, buildFactionSystemPrompt, buildFactionEntryPrompt, extractFactionPresetFromJson } from './store/factionEvoStore';
import FactionPanel from './components/FactionPanel';
import { useTurnInsight } from './store/turnInsightStore';
import TurnInsightPanel from './components/TurnInsightPanel';
import { useNpc, looksDead } from './store/npcStore';
import { useCharacters, type MemoryEntry } from './store/characterStore';
import { useMemory } from './store/memoryStore';
import { useMisc, buildMiscSystemPrompt } from './store/miscStore';
import { useChannel, buildChannelSystemPrompt, CHANNEL_DEFS } from './store/channelStore';
import { applyMiscCommands, serializeTasks, serializeEvents, extractTurnSummaries } from './systems/miscParser';
import { buildNarrativeHistory, NM_COMPILE_PROMPT, NM_INGEST_PROMPT } from './systems/narrativeMemory';
import { parseGameMinutes, parseDurationMinutes, parseDurationTurns } from './systems/gameClock';
import type { StatusEffect } from './store/playerStore';
import { serializePlayerCard, serializeNpcCard, buildNpcCandidateTitles, rankNpcsLocal, serializeFactionsSection, NM_STRUCT_SELECT_PROMPT, type RecallLimits } from './systems/structuredRecall';
import MiscPanel from './components/MiscPanel';
import ChannelPanel from './components/ChannelPanel';
import SystemShop from './components/SystemShop';
import SummaryPanel from './components/SummaryPanel';
import SaveLoadPanel from './components/SaveLoadPanel';
import { PENDING_STARTED_KEY, clearProgress, autoSaveSlot, saveSlot, loadSlot, UNDO_ID, hasUndoPoint } from './systems/saveManager';
import * as chatDb from './systems/chatDb';
import PlayerSidebar from './components/PlayerSidebar';
import StartScreen from './components/StartScreen';
import CharacterCreation, { type CreationData } from './components/CharacterCreation';
import SettingsPanel from './components/SettingsPanel';
import WorldSelector, { type WorldOption } from './components/WorldSelector';
import BackpackModal from './components/BackpackModal';
import EquipmentPanel from './components/EquipmentPanel';
import CharacterPanel from './components/CharacterPanel';
import TitlePanel from './components/TitlePanel';
import AchievementPanel from './components/AchievementPanel';
import SubProfessionPanel from './components/SubProfessionPanel';
import NpcPanel from './components/NpcPanel';
import NpcDetail from './components/NpcDetail';
import OnScenePanel from './components/OnScenePanel';
import PlayerEquipPanel from './components/PlayerEquipPanel';
import ItemListPanel from './components/ItemListPanel';
import VersionToast from './components/VersionToast';
import { APP_VERSION, VERSION_NOTE } from './version';

const PENDING_REGEN_KEY = 'drpg-pending-regen';   // reload 后自动重发的输入（重新生成用）
interface StoryImage { anchor: string; url: string; prompt: string; nsfw: string; ts: number }
interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  smallSummary?: string;   // 该楼层小总结（叙事记忆三档注入用）
  largeSummary?: string;   // 该楼层大总结
  images?: StoryImage[];   // 正文配图（按 anchor 插入楼层正文）
}

// 首次启动自动载入内置世界书 + 各演化预设（仅当对应项为空才填，永不覆盖玩家已有数据）。
// 文件放 public/presets/，按需 fetch、不进 JS 包；某项 fetch 失败则下次启动重试（因仍为空）。
async function loadBuiltinDefaults() {
  const base = import.meta.env.BASE_URL || '/';
  const grab = async (f: string): Promise<string | null> => {
    try { const r = await fetch(base + 'presets/' + f); return r.ok ? await r.text() : null; } catch { return null; }
  };
  try {
    // 一次性迁移：清掉早期误放进「世界选择」(worldBooks) 的正文世界书（它们属于正文 textWorldBooks，不该出现在选择世界里）
    try {
      if (!localStorage.getItem('zs-worldsel-cleaned-v1')) {
        const bad = ['轮回乐园世界书', 'ST模块化输出·铁律', 'ST模块化输出', '轮回乐园小说'];
        const wb0 = useSettings.getState().worldBooks ?? [];
        const wb1 = wb0.filter((b) => !bad.includes(b.name));
        if (wb1.length !== wb0.length) useSettings.setState({ worldBooks: wb1 } as any);
        localStorage.setItem('zs-worldsel-cleaned-v1', '1');
      }
    } catch { /* */ }
    // 世界选择世界书 → worldBooks（仅「选择世界」功能读取）
    if ((useSettings.getState().worldBooks?.length ?? 0) === 0) {
      const w = await grab('worldgen.json'); if (w) useSettings.getState().importWorldBook(w, '世界选择', true);
    }
    // 正文世界书 → textWorldBooks（正文生成读取）；按要求只内置 ST模块化·铁律 + 轮回乐园小说（______.json 不内置）
    if ((useSettings.getState().textWorldBooks?.length ?? 0) === 0) {
      const m = await grab('modular-output.json'); if (m) useSettings.getState().importTextWorldBook(m, 'ST模块化输出·铁律', true);
      const n = await grab('novel.json');          if (n) useSettings.getState().importTextWorldBook(n, '轮回乐园小说', true);
    }
    // 正文文本预设（双人成行·春和景明）→ textPresets
    if ((useSettings.getState().textPresets?.length ?? 0) === 0) {
      const t = await grab('textpreset.json'); if (t) useSettings.getState().importTextPreset(t, '双人成行·春和景明', true);
    }
    if (usePlayer.getState().settings.entries.length === 0) {
      const t = await grab('player.json'); const p = t ? extractPlayerPresetFromJson(t) : null;
      if (p) usePlayer.getState().setPresetEntries(p.entries, p.name, p.version);
    }
    if (useItems.getState().settings.entries.length === 0) {
      const t = await grab('item.json'); const p = t ? extractItemPresetFromJson(t) : null;
      if (p) useItems.getState().setPresetEntries(p.entries, p.name, p.version);
    }
    if (useNpcEvo.getState().settings.entries.length === 0) {
      const t = await grab('npc.json'); const p = t ? extractNpcPresetFromJson(t) : null;
      if (p) useNpcEvo.getState().setPresetEntries(p.entries, p.name, p.version);
    }
    if (useFactionEvo.getState().settings.entries.length === 0) {
      const t = await grab('faction.json'); const p = t ? extractFactionPresetFromJson(t) : null;
      if (p) useFactionEvo.getState().setPresetEntries(p.entries, p.name, p.version);
    }
  } catch (e) { console.warn('[内置预设] 载入失败', e); }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 模块块标题（无 > 前缀时的兜底识别）。模块化输出规范见 ST_WI_Modular_Output：
// 时间结算/动作日志/击杀结算/成长结算/判定块/战斗块/信息卡/登场/离场/装备替换/任务推进/目标/提示/主角资源/敌方信息/环境效果…
const SETTLE_HEADER_RE = /^\s*\*{0,2}\s*【[^】]*(结算|日志|战报|战斗|掉落|奖励|登场|离场|信息卡|资源|敌方|环境效果|判定|目标|提示|任务|成长|装备替换|获得|获取|入手|拾取|战利品|开启|物品|宝箱|商店|交易|购买)[^】]*】/;
function renderSettleBlock(title: string, body: string[]): string {
  // 标题里若紧跟正文（AI 常把「【动作日志】+整段结算」写在同一行）→ 拆出真正的 【标题】，
  // 余下内容并入正文，避免整段挤进标题行。
  let realTitle = title;
  const merged = [...body];
  if (title) {
    const m = title.match(/^(\s*【[^】]*】)([\s\S]*)$/);
    if (m) {
      realTitle = m[1].trim();
      const rest = m[2].trim();
      if (rest) merged.unshift(rest);
    }
  }
  // 把每段正文按句末标点（。；！？等）拆成多行，避免一长串结算文字挤成一坨
  const splitClauses = (s: string): string[] => {
    const raw = s.replace(/([。；！？;!?])\s*/g, '$1\n').split('\n').map((x) => x.trim()).filter(Boolean);
    // 修复"】等收尾符号被句末标点切到下一行、独占一行"：仅由收尾括号/标点组成的碎片并回上一行
    const out: string[] = [];
    for (const c of raw) {
      if (out.length && /^[】」』）)\]》〕＞>"”'’。，、；;！!？?…·\s]+$/.test(c)) out[out.length - 1] += c;
      else out.push(c);
    }
    return out;
  };
  const lines = merged.flatMap(splitClauses);
  const head = realTitle
    ? `<div class="text-[13px] font-bold text-amber-300 mb-1 tracking-wider">${escapeHtml(realTitle)}</div>`
    : '';
  const bodyHtml = lines.length
    ? lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')
    : '';
  return '<div class="my-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2">' + head +
    `<div class="text-[15px] text-slate-200/90 leading-relaxed space-y-0.5">${bodyHtml}</div>` +
    '</div>';
}
// 把模块块（橙线引用块 + 标题块）用"格子"包起来突出显示。
// HTML 感知：含 HTML 标签的行/区域原样透传（让 ST 正则输出的 HTML 卡片正常渲染），
// 同时仍对同一条消息里的 > 引用块 / 【…结算…】块打包——修复"消息里只要有一处 HTML，
// 整条消息就跳过结算格子，导致 > 模块块退化成普通框"的问题。
function wrapSettlementBlocks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const isQuote = (l: string) => /^\s*>\s?\S/.test(l);
  const isHtmlLine = (l: string) => /<[a-zA-Z/][^>]*>/.test(l);
  const opensHtml = (l: string) => (l.match(/<(div|details|table|section|article|blockquote|ul|ol|pre)\b/gi) ?? []).length;
  const closesHtml = (l: string) => (l.match(/<\/(div|details|table|section|article|blockquote|ul|ol|pre)>/gi) ?? []).length;
  const unquote = (l: string) => l.replace(/^\s*>\s?/, '').replace(/\*\*/g, '');
  let i = 0;
  let htmlDepth = 0;   // 处于未闭合的 HTML 块内时，一律原样透传，不当结算块处理
  while (i < lines.length) {
    const line = lines[i];
    // 0) HTML 行 / HTML 块内：原样透传（含 details 默认展开），仅维护嵌套深度
    if (htmlDepth > 0 || isHtmlLine(line)) {
      out.push(line.replace(/<details\b/gi, '<details open'));
      htmlDepth = Math.max(0, htmlDepth + opensHtml(line) - closesHtml(line));
      i++;
      continue;
    }
    // 1) 连续 > 引用行 = 模块块（规范要求每行带 > 前缀）→ 整段打包
    if (isQuote(line)) {
      const run: string[] = [];
      while (i < lines.length && isQuote(lines[i]) && !isHtmlLine(lines[i])) { run.push(unquote(lines[i])); i++; }
      const hasTitle = /【.+】/.test(run[0] ?? '');
      out.push(renderSettleBlock(hasTitle ? run[0].trim() : '', hasTitle ? run.slice(1) : run));
      continue;
    }
    // 2) 无 > 前缀但以【…模块名…】开头：兜底打包（到空行/下个标题/引用行/HTML 行止）
    if (SETTLE_HEADER_RE.test(line)) {
      const header = line.replace(/\*\*/g, '').trim();
      i++;
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !SETTLE_HEADER_RE.test(lines[i]) && !isQuote(lines[i]) && !isHtmlLine(lines[i])) {
        body.push(lines[i].replace(/\*\*/g, '')); i++;
      }
      out.push(renderSettleBlock(header, body));
      continue;
    }
    out.push(escapeHtml(line));
    i++;
  }
  return out.join('<br>');
}

// 将正文内容转为 HTML：始终走 HTML 感知的结算块打包（既渲染 ST 正则输出的 HTML，
// 又对 > 模块块/【…结算…】块统一打琥珀格子，二者可在同一条消息里共存）。
function toHtml(text: string): string {
  return wrapSettlementBlocks(text);
}

/* 正文配图：在 anchor 命中处插入 <img>，无命中则追加到末尾。
   先在原文锚点后插入安全占位符（不含 HTML 特殊字符，能穿过 escapeHtml/wrap），再替换为图片标签。*/
function toHtmlWithImages(text: string, images?: StoryImage[]): string {
  if (!images || images.length === 0) return toHtml(text);
  let work = text;
  const tokens: string[] = [];
  images.forEach((img, i) => {
    const token = `@@ZSIMG${i}@@`;
    tokens.push(token);
    const at = img.anchor && work.includes(img.anchor) ? work.indexOf(img.anchor) + img.anchor.length : -1;
    if (at >= 0) work = work.slice(0, at) + `\n${token}\n` + work.slice(at);
    else work += `\n${token}\n`;
  });
  let html = toHtml(work);
  images.forEach((img, i) => {
    const tag = `<a href="${img.url}" target="_blank" rel="noopener" class="story-illust-link"><img src="${img.url}" alt="${escapeHtml(img.nsfw || '')}" class="story-illust" style="display:block;max-width:100%;border-radius:10px;margin:10px auto;border:1px solid rgba(255,255,255,0.08);cursor:zoom-in" loading="lazy" /></a>`;
    html = html.split(tokens[i]).join(tag);
  });
  return html;
}

/* NPC 物品 owner 解析器：把物品阶段的"幻觉ID"重定向到真实 NPC（修复 C1/C66 分裂）*/
const isRealNpc = (r?: { name: string; id: string; isDead?: boolean }) =>
  !!(r && r.name && r.name !== r.id && !r.isDead);
// 本回合登场判断/重点演化涉及的 NPC（优先重定向目标），由 runPostNarrativePhases 维护
let npcPreferredOwners: string[] = [];
setNpcOwnerResolver((owner) => {
  const npc = useNpc.getState();
  if (isRealNpc(npc.npcs[owner])) return owner;            // owner 本就是真实NPC → 保持
  // 1) 优先本回合涉及的真实 NPC
  for (const id of npcPreferredOwners) {
    if (isRealNpc(npc.npcs[id])) { console.log(`[Item] owner ${owner} → 重定向到 ${id}（本回合目标）`); return id; }
  }
  // 2) 退化：所有真实 NPC，在场优先、最近更新优先
  const cands = Object.values(npc.npcs)
    .filter(isRealNpc)
    .sort((a, b) => (Number(b.onScene) - Number(a.onScene)) || (b.updatedAt - a.updatedAt));
  if (cands[0]) { console.log(`[Item] owner ${owner} → 重定向到 ${cands[0].id}（最近真实NPC）`); return cands[0].id; }
  console.warn(`[Item] owner ${owner} 无可重定向的真实 NPC，保持原 ID`);
  return owner;
});

/* eq/uneq 短指令把 NPC 物品错挂到 B1 时的兜底：在 NPC 持有物里找到并就地装备/卸下 */
function equipNpcItemFallback(itemId: string, slotStr: string): boolean {
  const npc = useNpc.getState();
  for (const rec of Object.values(npc.npcs)) {
    const ni = rec.items.find((it) => it.id === itemId || it.name === itemId);
    if (ni) {
      if (!isEquippable(ni.category)) { console.warn(`[State] 拒绝装备 NPC ${rec.id}「${ni.name}」：${ni.category} 非装备类`); return true; }
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

  // ── 角色资源短指令：hp./mp./san. 等带 .<角色ID> 后缀（主角演化/NPC演化预设格式）──
  // 例：hp.B1 -= 20、san.B1 = 80、hp.C1 -= 15
  const resMatch = key.match(/^(hp|maxHp|mp|maxMp|san|maxSan)\.([A-Za-z]\w*)$/);
  if (resMatch) {
    const stat = resMatch[1];
    const cid  = resMatch[2];
    // 数值：纯数字(=/+=/-=) 或 "当前/上限"字符串(如 100/120，视作设定当前值；上限由前端按六维换算，忽略斜杠后的上限)
    let amount: number; let setMode = op === '=';
    if (typeof value === 'number') amount = value;
    else {
      const n = Number(String(value).split('/')[0].replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n)) return;   // 解析不出数字 → 静默跳过，不刷 warn
      amount = n; setMode = true;
    }
    if (cid === 'B1') {
      // 玩家 HP/EP：上限按体质×20 / 智力×15 自动换算并同步写回 maxHp/maxMp
      if (stat === 'hp' || stat === 'mp') {
        const prof = usePlayer.getState().profile;
        const dmax = stat === 'hp' ? computeMaxHp(prof.attrs) : computeMaxEp(prof.attrs);
        const curMaxKey = (stat === 'hp' ? 'maxHp' : 'maxMp') as PlayerNumericKey;
        const cur = effectiveResource(game.player[stat as PlayerNumericKey] as number, game.player[curMaxKey] as number, dmax);
        const next = setMode ? Math.min(Math.max(0, amount), dmax) : op === '+=' ? Math.min(cur + amount, dmax) : Math.max(0, cur - amount);
        game.setPlayerField(stat as PlayerNumericKey, next);
        game.setPlayerField(curMaxKey, dmax);
        return;
      }
      const cur = (game.player[stat as PlayerNumericKey] as number) ?? 0;
      const next = setMode ? amount : op === '+=' ? cur + amount : cur - amount;
      game.setPlayerField(stat as PlayerNumericKey, next);
      return;
    }
    if (/^[CG]/.test(cid)) {   // NPC：含非标准ID（如 C_SAEKO_01）一并路由，避免"未知变量"误报且能正确落档
      if (stat === 'hp' || stat === 'mp') {
        const npc = useNpc.getState();
        const rec = npc.npcs[cid];
        const dmax = stat === 'hp' ? computeMaxHp(rec?.attrs) : computeMaxEp(rec?.attrs);
        const cur = effectiveResource(stat === 'hp' ? rec?.hp : rec?.mp, stat === 'hp' ? rec?.maxHp : rec?.maxMp, dmax);
        const next = setMode ? Math.min(Math.max(0, amount), dmax) : op === '+=' ? Math.min(cur + amount, dmax) : Math.max(0, cur - amount);
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

  // 货币：currency.乐园币 += 500 / currency.灵魂钱币 -= 10
  const ccMatch = key.match(/^currency\.(乐园币|灵魂钱币)$/);
  if (ccMatch && typeof value === 'number') {
    const type = ccMatch[1] as '乐园币' | '灵魂钱币';
    const itemStore = useItems.getState();
    const cur = itemStore.currency[type];
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    itemStore.adjustCurrency(type, next - cur);
    return;
  }
  // 简写：直接用货币名作为 key（乐园币 += 100）
  if ((key === '乐园币' || key === '灵魂钱币') && typeof value === 'number') {
    const itemStore = useItems.getState();
    const cur = itemStore.currency[key as '乐园币' | '灵魂钱币'];
    const next = op === '+=' ? cur + value : op === '-=' ? cur - value : value;
    itemStore.adjustCurrency(key as '乐园币' | '灵魂钱币', next - cur);
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
        if (!isEquippable(item.category)) { console.warn(`[State] 拒绝装备「${item.name}」：${item.category} 非装备类，不能上装备栏`); return; }
        itemStore.equipItem(item.id, slotStr);
        console.log(`[State] 装备 ${item.name} → ${slotStr}`);
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

function applyStateUpdates(raw: string) {
  const updates = parseAllStateUpdates(raw);
  if (updates.length === 0) return;
  console.log('[State] 解析到变量更新:', updates);
  for (const u of updates) {
    try { applyOneUpdate(u); } catch (e) { console.warn('[State] 应用更新失败:', u, e); }
  }
}

function applyAllUpdates(raw: string) {
  // ★ 先创建物品（<upstore> createItem），再应用 <state>（含 eq 装备短指令），
  //   否则 eq 会在物品尚未创建时执行而装备失败（物品全堆在储物袋里）。
  const itemCmds = parseAllItemCommands(raw);
  if (itemCmds.length > 0) {
    console.log('[Item] 解析到物品指令:', itemCmds);
    applyItemCommands(itemCmds);
  }
  applyStateUpdates(raw);
}

/* ─── 物品管理阶段：构建注入 system prompt（替换模板变量）─── */
function buildItemPhaseSystemPrompt(entries: ItemPresetEntry[], narrative: string): string {
  const { items, currency } = useItems.getState();
  const { player } = useGame.getState();

  // 背包清单
  const inventoryText = items.length > 0
    ? items.map((it) =>
        `[${it.id}] ${it.name}（${it.category}${it.gradeDesc ? '·' + it.gradeDesc : ''}）×${it.quantity}` +
        (it.equipped ? `【已装备:${it.equipSlot ?? ''}】` : '') +
        (it.effect ? `  ${it.effect}` : '')
      ).join('\n')
    : '（背包为空）';

  // 装备槽
  const equippedItems = items.filter((it) => it.equipped);
  const equipmentText = equippedItems.length > 0
    ? equippedItems.map((it) => `${it.equipSlot ?? '未知槽位'}: ${it.name} [${it.id}]`).join('\n')
    : '（未装备任何物品）';

  // 货币
  const ssText = `乐园币:${currency.乐园币} 灵魂钱币:${currency.灵魂钱币}`;

  // 下一个可用物品 ID
  const maxId = items.reduce((m, it) => Math.max(m, parseInt(it.id.replace(/^I_B1_/, '')) || 0), 0);
  const nextItemId = `I_B1_${String(maxId + 1).padStart(2, '0')}`;

  // NPC 角色注册表（让物品管理阶段把装备挂到已存在的 NPC ID 上，而非新建）
  const npcRecords = Object.values(useNpc.getState().npcs);
  const npcExistingIds = ['B1（玩家）', ...npcRecords.map((r) => `${r.id}(${r.name})${r.onScene ? '·在场' : '·离场'}`)].join(', ');
  const npcCNums = npcRecords.map((r) => r.id.match(/^C(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const npcNextId = `C${npcCNums.length > 0 ? Math.max(...npcCNums) + 1 : 1}`;
  const npcOnscreenText = npcRecords.filter((r) => r.onScene && !r.isDead).length > 0
    ? npcRecords.filter((r) => r.onScene && !r.isDead).map((r) => `[${r.id}] ${r.name} 阶位:${r.realm || '未知'}`).join('\n')
    : '（无在场NPC）';

  // 玩家基本状态
  const _pAttrs = usePlayer.getState().profile.attrs;
  const _pMaxHp = computeMaxHp(_pAttrs), _pMaxEp = computeMaxEp(_pAttrs);   // HP/EP 上限按六维算，让演化 AI 看到的也是真实值（非 100/50 旧默认）
  const playerSnapshot = `B1 玩家 HP:${effectiveResource(player.hp, player.maxHp, _pMaxHp)}/${_pMaxHp} EP:${effectiveResource(player.mp, player.maxMp, _pMaxEp)}/${_pMaxEp} SAN:${player.san}/${player.maxSan} ATK:${player.atk} DEF:${player.def} 积分:${player.points}`;

  const vars: Record<string, string> = {
    story_text:             narrative,
    user_input:             '',
    player_items:           inventoryText,
    owner_items:            inventoryText,
    character_items:        inventoryText,
    player_equipment:       equipmentText,
    character_snapshot:     playerSnapshot,
    spirit_stones:          ssText,
    next_available_item_id: nextItemId,
    // NPC 角色注册表（让物品管理阶段复用正确的 NPC ID，避免把装备挂到新 ID 上）
    existing_character_ids: npcExistingIds,
    next_available_npc_id:  npcNextId,
    onscreen_characters:    npcOnscreenText,
    offscreen_biographies:  '',
    beasts_summary:         '',
    focus_list:             '',
    world_factors:          '',
    world_map_pois:         '',
    current_time:           '',
    current_location:       '',
  };

  return entries
    .filter((e) => e.enabled)
    .map((e) => {
      let content = e.content;
      for (const [k, v] of Object.entries(vars)) {
        // 同时替换 ${key} 和 {{key}} 两种格式
        content = content.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v);
        content = content.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
      return content;
    })
    .join('\n\n');
}

/* ════════════════════════════════════════════
   各演化阶段「强制铁则」补丁（代码注入，独立于导入的预设，始终生效）
   解决：① 所有演化必须优先逐条参照正文、不遗漏；正文没有的再自行补全
        ② BUFF 也算当前状态  ③ 副职业中文且仅正文显式  ④ NPC 年龄
        ⑤ 势力所处世界  ⑥ 物品固定格式 + 武器杀敌数
════════════════════════════════════════════ */
const NARRATIVE_FIRST_RULE = `
【最高优先·正文为准铁则】本阶段所有字段更新**必须先逐条比对本轮正文**：正文里明确写到的信息（属性/状态/效果/数值/关系/外观/事件等）一律**照抄、不得遗漏**（哪怕只是顺带提到的一个增益/减益/效果也要记录）；正文**没有**提到的字段，才允许你按设定**合理补全**。严禁用想象覆盖正文已写明的内容。`;

const BUFF_AS_STATUS_RULE = `
【BUFF 即状态】正文中出现的任何增益/减益/buff/debuff/中毒/灼烧/护盾/虚弱/加速/恢复等效果，**都必须当作"当前状态"记录**：有明确时限的写结构化限时状态 addStatus(...)；长期/无时限的写入当前状态(列4 / character.<id>.status)。不要因为它叫"buff"就漏记。`;

const ITEM_FIXED_FORMAT_RULE = `
【物品固定格式·强制补全】每次 createItem 必须按固定字段输出，**优先取正文已写明的值，正文没有的字段你必须自行合理补全（不得留空、不得省略）**：
名称(name) | ID(id) | 品质(quality→gradeDesc) | 类型(category+subType) | 攻击力/防御力(combatStat：武器填攻击力，其余装备填防御力) | 属性加成(attrBonus 或写进 effect) | 评分(score) | 词缀(affix，可多条) | 效果(effect) | 描述/简介(intro) | 外观(appearance) | 获取途径(acquisition)。
**武器类额外必填「杀敌数量」killCount**（新武器一般为 0，随战斗累计）。
- **外观(appearance) 一律必填、绝不可留空或省略——不分类型：装备、消耗品、材料、工具、重要物品、特殊物品…全部都要写**：必须**逐部件/逐特征列举可视化细节**，把物品拆成各部分，每部分写清「材质·质地 + 颜色 + 造型·形状 + 纹饰/做工/光泽 +（消耗品还要写）盛装容器」，要"画得出来"。
  · 装备正例：「黄铜枪管，胡桃木枪托，机括处刻有海浪纹，扳机护圈年久泛着幽光」「玄铁胸甲，表面蚀刻金色狮纹，肩甲包覆赤红皮革，边缘镶一圈黄铜铆钉」。
  · **消耗品/材料正例（同样必须写）**：「深红黏稠药液，盛于鼓腹玻璃小瓶，软木塞封口，瓶身缠一圈褪色麻绳标签」「焦黄烤肉串，油脂正往下滴，撒着粗盐与香料碎，竹签穿成三块」「拇指大的半透明蓝色晶簇，断面有放射状纹路，表面凝着薄霜」「巴掌大的金属急救针剂，针管内淡蓝药液，外壳印着磨损的红十字标」。
  · **反例（严禁拿来当外观）**：「一把保养尚可的单发燧发枪」「一瓶治疗药水」「品相不错」「看起来很普通」「喝下可回复生命」——这些是**品相/状态/用途/效果**的笼统话，不是外观，画不出图。
  这是**生成配图的唯一依据**。外观**独立于简介(intro)与效果(effect)**：简介写 flavor、效果写数值作用，**外观只写逐部件的画面描述**；三者都要给，**不能用简介/效果/品相互相顶替、也不能为空**。
  · **即使本阶段其它"固定条目模板/字段清单/示例"里没有列出 appearance，你也必须照样补上 appearance 字段**——本外观要求优先于任何未列外观的模板。
- **NPC 持有物品/装备（owner≠B1）与主角【完全一致】地按本固定格式生成全部字段**：名称/产地/品质/类型/攻防/耐久/装备需求/词缀/评分/效果/简介/外观（武器另加杀敌数）一个都不能少，**不准因为是 NPC 就省略外观、词缀、评分、数值等任何字段或敷衍偷懒**。NPC 装备同样要写清攻防/耐久/装备需求/词缀，消耗品同样要写效果与外观。
数值化要求：攻击/防御/加成/效果都要写具体数字。`;

const ITEM_ACQUIRE_RULE = `
【装备/物品仅"明确入手"才生成·最高优先铁则】createItem 只用于正文里**确实发生入手事件**的新物品：
- 算入手（才可 createItem）：获得/得到/捡到/拾取/掉落/缴获/搜刮到/购买/买下/打造/制作/锻造/合成/系统奖励/任务奖励/赠予/抢夺到 等清楚的"到手"动作。
- **不算入手（一律不要 createItem）**：仅仅描述、提及、穿着、身上有、手持、回忆、陈列、他人拥有、外观/装束描写——那只是叙述或既有物品的描写，不是新获得。"提到一个装备名字"绝不等于获得。
- **同部位/同类防重复**：玩家某部位若已有装备（见 player_items 的【已装备】），除非正文明确"换上/获得了新的该部位装备"，否则**绝不生成同部位/同类的相似装备**（例：已穿「战术丛林靴」就不要再造「军用战术靴」；已有上衣就不要再造另一件上衣）。换装走 updateItem，或先明确获得新物再替换。
- 拿不准是否真入手就**不生成**——宁可漏生成，也不要凭一句描写凭空造装备。`;

const ITEM_EXACT_REF_RULE = `
【引用已有物品·照抄铁则】消耗/销毁/装备/卸下/更新/转移某件**已存在**的物品时（consumeItem/destroyItem/equipItem/unequipItem/updateItem/updateItemQuantity/transferItem），**name 与 itemId 必须照抄"储存空间清单(player_items)"里那件物品的完整名称与真实 ID**：
- 禁止简写或省略品级/前缀（如把"次级止血喷雾"写成"止血喷雾"）、禁止凭印象自行编造 itemId。
- 名字与 ID 尽量都给且都准确；二者哪怕一个写错，系统就可能匹配不到、导致操作失败。
- 清单(player_items)里没有的物品，不要去消耗/销毁/装备它。`;

const EVO_EXACT_REF_RULE = `
【引用已有技能/天赋/称号·照抄铁则】删除或"升级更新"某个**已存在**的技能/天赋/称号/副职业/配方时（deSkill/deTalent/deTitle/deSubProfession/deRecipe，以及用**同名** addSkill/addTalent/addTitle 表示该条目"升级"），**名称必须照抄上方快照/已有清单里该条目的完整准确名称**：
- 禁止简写、改写措辞、增删标点或空格（如把"烈焰斩·改"写成"烈焰斩"）。名字对不上会导致：① 删除失败删不掉；② 被当成全新条目重复添加，越堆越多。
- 升级已有条目时，用与它**完全相同**的名字；只有确实是全新条目才用新名字。`;

const SUBPROF_RULE = `
【副职业·中文且仅正文显式】副职业名称、配方名一律用**中文**（禁止 tactics/wasteland_survival 之类英文或拼音）。**只有当本轮正文明确写出主角在从事/习得某项副职业（生活/制造/社交手艺）时，才允许 addSubProfession/addRecipe**；正文没有明确提及副职业，本轮一律不要新增或推断任何副职业。`;

const NPC_AGE_RULE = `
【NPC 年龄】每个 NPC 维护「年龄」：正文写明则照抄（character.<id>.age = "约25岁"），正文未写则按其阶位/设定合理生成一个年龄（可写"青年/中年/约30岁/数百岁"等）。`;

const NPC_REVIEW_TAG_RULE = `
【NPC 锐评(review)】每个 NPC 给一句**诙谐幽默、玩家第一人称视角的锐评/吐槽**（可夸张、可玩梗、可用颜文字/划掉体），风格示例：「我的妈呀，这谁顶得住！这身材这脸蛋这职业范儿，简直从幻想里走出来的，我的主线任务就是攻略她！(¯﹃¯)」。指令 character.<id>.review = "…"。锐评随剧情/印象变化可更新。
【NPC 标签(npcTag)】每个 NPC 必须打一个**标签，且只能从这五个里选**：契约者 / 土著 / 随从 / 宠物 / 召唤物。判断依据：与轮回乐园签约的玩家类=契约者；任务世界原住民=土著；跟随主角的人形伙伴=随从；豢养的生物=宠物；法术/能力召唤出的存在=召唤物。指令 character.<id>.npcTag = "随从"。`;

const FACTION_WORLD_RULE = `
【势力所处世界】每个势力维护「所处世界」(worldName)=该势力当前所在/所属的世界名：正文写明则照抄，未写则填当前世界名。用 faction.<id> 命名键 worldName 更新。`;

const FACTION_FULL_FORMAT_RULE = `
【势力固定格式·全量必填铁则（最高优先，禁止偷懒/漏项）】每次 addFaction / faction.<id> 创建或更新势力，**必须把下列字段一次性全部带上、不得遗漏留空**（正文写明的照抄，没写的按设定合理补全）：
- name（**中文、有具体含义**的势力名，严禁 F1/F2/英文/无意义占位）、type（类型：帮派/政府/企业/教会/军团/部落/星际势力…）、**worldName（所处世界＝该势力所在世界名，必填！直接填当前所在世界名）**、scale（规模）、powerLevel（实力/战力层级）、territory（地盘/势力范围）、leader（首领）、members（核心成员）、relations（与其他势力关系）、favorToPlayer（对主角态度，数值）、goal（当前目标）、resources（资源）、assets（资产）、status（当前状态，如"正常运作"）。
- **worldName 绝不能空**：它决定该势力属于哪个世界，缺失会导致换世界后旧势力一直挂在当前世界出不去。哪怕只是更新一句近况，也要把 worldName 与上面这些关键字段一并补全，绝不能只更新 deeds/status 而漏掉其余条目。`;

const NPC_DEAD_EXCLUDE_RULE = `
【死亡角色不演化·铁则】本轮正文中已死亡/被击杀/被摧毁的角色**一律不纳入演化考虑范围**：
- **同回合出现又死亡的角色，绝对不要建档**：凡是在本轮正文里"刚登场/刚出现就被打死、被秒杀、当场毙命"的角色（含有名字的杂兵、临时敌人、炮灰、哥布林/丧尸群、路人等），一律**不要放进 entries、不要 new、不要分配 ID、不要写任何 add/骨架**——当他们不存在。判断标准：该角色从登场到死亡都在本回合正文内完成。
- **不要**为一击毙命的临时敌人新建档案（哪怕正文给了名字）。
- 已建档的老角色若本轮死亡：只用 de(...) 归档并把状态标记为"已死亡"，**不要再补全/更新/演化**其属性、技能、天赋、装备、目标等任何字段。
- 只对**存活、且明显会在后续剧情继续出场**的角色建档与演化。拿不准是否会再出场的，宁可不建档。`;

const NPC_SKILL_KEEP_RULE = `
【NPC 技能/天赋·只增不刷铁则（最高优先）】NPC 已拥有的技能与天赋是**持久档案**，绝不要每回合重新生成、更不要用"新版本"覆盖替换已有的同名条目：
- 默认**原样保留**该 NPC 已有的全部技能/天赋（见下方 character_snapshot / 已有技能·天赋清单），本轮不要去动它们。
- **只有**本轮正文明确写出该 NPC「学会/领悟/掌握/获得了一个**全新**技能」或「觉醒/获得了一个**全新**天赋」时，才 addSkill / addTalent **新增那一个新条目**（用与已有不同的名字）。
- **只有**本轮正文明确写出某个**已有**技能/天赋发生了「升级/进阶/突破/层数提升」时，才用**同名**addSkill / addTalent 去更新它（名字保持不变，体现更高等级/评级）。
- 若本轮没有"学会新技能 / 已有技能升级"的明确情节，**本轮就不要输出任何 addSkill / addTalent**。严禁把已有技能换个数值或换种措辞再报一遍。`;

const TIER_RULE = `
【阶位规范·铁则】阶位(tier)**只能**是这 13 个之一：一阶/二阶/三阶/四阶/五阶/六阶/七阶/八阶/九阶/绝强/至强/巅峰至强/无上之境，**与等级一一对应**：一阶=Lv.1-10、二阶=11-20、三阶=21-30、四阶=31-40、五阶=41-50、六阶=51-60、七阶=61-70、八阶=71-80、九阶=81-90、绝强=91-100、至强=101-120、巅峰至强=121-140、无上之境=140+。
- 阶位字段只填上述阶位名（不带 Lv、不带初期/中期/后期）；等级字段只填纯数字（如 Lv.25）。
- 绝不要出现"结丹/筑基/金丹/元婴/三阶中期"等任何其他写法。NPC 列2 格式固定为「阶位·Lv.X|身份」，如「三阶·Lv.25|调查员」。`;

const SKILL_TALENT_NOTE_RULE = `
【技能/天赋·备注(note)】addSkill/addTalent 时尽量补一个 note 字段——**寓言式或评价式的一句点评**（点出该技能/天赋的本质、代价或克制，风格如「即使是不死者，被斩下头颅或彻底碾碎心脏也会迎来终结。」「快到极致的剑，连影子都追不上主人。」）。简短有韵味即可；实在无合适点评可省略，不要硬凑。`;

const IMAGE_TAGS_RULE = `
【生图提示词·第19列(imageTags)·轮回乐园】为角色维护一份**英文 Danbooru/NAI tags 生图提示词**，供 AI 自动生成角色立绘/肖像、并保证同角色多次出图形象一致。
- 输出方式：主角用 \`add("B1", {"19":"<英文tags>"})\` 或 \`character.B1.imageTags = "<英文tags>"\`；NPC 用 \`add("<id>", {"19":"<英文tags>"})\`。
- 格式：**15~25 个具体、忠实**的英文 danbooru tags（逗号分隔，别泛化），依次覆盖：① 主体数量+性别开头（1girl/1boy/1other，非人生物写 monster/dragon/robot 等+种类）；② 发型(长度+颜色+样式)；③ 瞳色+眼型；④ 面容/肤色/年龄感/疤痕等辨识点；⑤ 表情；⑥ 体型(若知)；⑦ **服装逐件拆开**(每件带颜色/材质，如 black military coat, leather gloves, red scarf)+标志性配饰/随身武器；⑧ 构图+光影氛围(upper body, looking at viewer, dramatic lighting)。权重用 NAI 冒号语法或不加；**禁止**中文、整句、质量词(画师串系统自动追加)、负面词、Markdown。把角色档案里的外观/着装/发型等信息**尽量写全写细**（这是质量关键，宁多勿少）。
- **轮回乐园适配**：服饰/风格按该角色所属世界与设定来写（现代/科幻/奇幻/末世等皆可），**不要**写修仙味的灵气/法袍/飞剑/灵纹等词，除非角色设定本身就是修仙者。
- **同人/二次创作角色·准确性铁则**：当角色是已知的动漫/游戏/小说等**同人角色**时，必须输出**准确的 danbooru 角色 tags**——优先写「角色名 tag(下划线式，如 \`artoria_pendragon\`) + 作品/系列 tag(\`fate/stay_night\`) + 该角色的**经典固定外观**(发型发色/瞳色/标志性服装/配饰)」，而不是泛化描述；若不确定该角色的标准 danbooru tag，则按其公认经典形象尽量准确地用具体特征 tag 还原，禁止张冠李戴或编造不符的外观。原创角色才用纯特征描述。
- 何时生成/更新：角色形象**稳定可辨识**时生成；只有**长期外观锚点**变化（发型/发色/容貌/年龄感/体型、整套主造型或常驻装备替换、稳定疤痕/异变纹路等）才覆盖更新，并把冲突的旧 tag 一并改掉（如剃光头后必须含 bald/shaved head 并移除 long hair）。**临时**动作/表情/光影/场景/临时换装不要写进第19列。`;

const FIRST_UPDATE_COMPLETE_RULE = `
【首次建档·全量铁律（最高优先，禁止偷懒/遗漏）】当本轮**首次为某个角色建档**（该角色此前不存在），或某个该有的变量此前从未被赋值时，**必须一次性把所有该有的变量补全，禁止遗漏、禁止省略、禁止留空、禁止"以后再说"**：
- 角色(主角 B*/NPC C*·G*)首次建档**必须全部给出**：阶位·Lv等级、性别、性格、身份、六维属性(力/敏/体/智/魅/幸)、年龄、外观、第19列生图提示词等。
- **生命 HP / 蓝量 EP 的上限由前端自动换算，禁止你写 maxHp/maxMp**：HP上限 = 体质(con)×20，EP上限 = 智力(int)×15（真实属性按每80普通=1真实折算，公式自动适配）。因此**只要把六维（尤其体质、智力）按其阶位/生物强度合理给足**，HP/EP 上限即自动生成——**不要**再输出 \`hp.<id> = 当前/上限\` 的上限部分。新建角色默认满血满蓝，无需显式写当前值。只有在正文发生**受伤/治疗/消耗/恢复**时，才用 \`hp.<id> -= N\` / \`hp.<id> += N\` / \`mp.<id> -= N\` / \`mp.<id> += N\` 调整**当前**值。
- 正文写明的照抄；正文没写的按设定合理生成——**但不得以"正文没写"为由跳过任何变量**。
- 之后回合只做增量更新，不必反复重置上限。
- 此规则同样适用于物品/势力/领地等的首次建档：首次创建必须把该对象的固定字段一次性填全。`;

const HPEP_NARRATIVE_ONLY_RULE = `
【HP/EP 更新·严格遵正文铁则（最高优先，覆盖任何"每回合回血/扣血"旧文案）】主角与 NPC 的**当前** HP(生命)/EP(蓝量) **只在以下两种情况才允许变动，其余一律原样保持不变**：
① 本轮正文**明确写到**该角色的生命/精力发生了变化——受伤/流血/被击中/中毒/灼烧/力竭/眩晕等掉血掉蓝，或被治疗/包扎/休息/进食/吸收能量等回血回蓝——则按正文描述的幅度用 \`hp.<id> -= N\` / \`hp.<id> += N\` / \`mp.<id> -= N\` / \`mp.<id> += N\` 调整。
② 主角**本轮主动使用了背包里的恢复品/消耗品**（药剂/食物/回复道具等）——按该物品效果回复，用 \`hp.B1 += N\` / \`mp.B1 += N\`。
- **若本轮正文没有提到某角色的 HP/EP 变化、且没有主动使用恢复品 → 绝对不要改它的 HP/EP**。禁止凭"刚打了一架应该掉血""歇了一会儿应该回点""习惯性每回合回血"等任何推测擅自增减。拿不准就不动。
- **最大值由前端算、你不写 maxHp/maxMp**：最大HP = 体质(con)×20 + 装备里写明"增加生命上限"的加成；最大EP = 智力(int)×15 + 装备里写明"增加法力/能量上限"的加成。前端会把当前值自动夹在 ≤ 最大值。你只负责按正文增减**当前**值。
- **若某件装备的效果是提升生命/法力上限**，请把它**写进该装备的 effect 文本里**（如"生命上限+50""最大EP+30"），前端据此把它计入最大值——不要写成 maxHp 指令。
- **连带铁则：不要为了改 HP/EP 而偷偷改六维**。体质(con)决定 HP 上限、智力(int)决定 EP 上限——**六维只在正文明确写到该角色成长/突破/被强化/被削弱时才调整**；不得每回合无依据地把六维（尤其体质、智力）上下浮动，否则 HP/EP 上限会跟着"自己变化"。建档后六维保持稳定，除非正文给出明确变化理由。`;

const ADVANCE_POINTS_RULE = `
【进阶点数·获得量 vs 当前总量·区分铁则】进阶点数(advancePoints)是升级所需的**累积资源**，三种指令务必区分，别混：
- 正文写本轮【获得/奖励/赚得/掉落/到手】N 点 → 用 \`ap.<id> += N\`（在原有总量上**累加**，绝不是把总量设成 N）。
- 正文写升级【消耗/花费/扣除】N 点 → 用 \`ap.<id> -= N\`。
- 仅当正文**明确报出当前总量**（"当前进阶点数为 N / 现有 N 点 / 累计 N 点"）时，才用 \`ap.<id> = N\`（直接设为该总量）。
- **严禁把"本轮获得 N 点"误判成"当前共有 N 点"**（会冲掉已累积的总量），也别把"当前共有 N 点"当成又获得 N 去累加。**分不清是增量还是总量时，一律按增量 \`+= \` 处理**。`;

const WORLDSOURCE_RULE = `
【世界之源·总量百分比铁则】世界之源是当前任务世界累计获取的进度**百分比**（带小数，如 0.6 表示 0.6%），指令 character.B1.worldSource：
- 正文报【当前累计/总计 X%】→ 用 \`character.B1.worldSource = X\`（直接设为该总量，如"当前总计0.6%"→ \`= 0.6\`）。
- 正文报【本次获得/增加 X%】→ 用 \`character.B1.worldSource += X\`（在原有总量上累加）。
- 回归轮回乐园 → \`character.B1.worldSource = 0\`。
- **务必区分"当前总计"与"本次新增"**：正文说"当前总计 0.6%"就 \`= 0.6\`，绝不要只 += 一个小增量导致面板与正文对不上。`;

const POINTS_NARRATIVE_RULE = `
【属性点/真实属性点/技能点·完全按正文铁则】这三类点数**只在本回合正文明确出现相关数字或增减时才更新；正文没提到就保持原值，绝不臆造、绝不归零、不要每回合刷**。指令：
- 主角：\`character.B1.attrPoints\`、\`character.B1.realAttrPoints\`。
- NPC：\`character.<id>.attrPoints\`、\`character.<id>.realAttrPoints\`、\`character.<id>.skillPoints\`。
- 用法：正文报【当前总量 N】→ \`= N\`；正文报【本次获得/奖励 N】→ \`+= N\`；正文报【消耗/扣除 N】→ \`-= N\`。无正文依据则完全不输出这些指令。`;

const ATTR_SANITY_RULE = `
【六维合理性铁则·按"它是什么"给属性】生成/更新六维必须**贴合角色的种族、形象与身份**，禁止给所有角色套同一套人类模板：
- **非人/低等/无智生物**（丧尸/僵尸/魔物/野兽/虫群/骷髅/史莱姆/暴走数据体/亡灵等）：智力(int)、魅力(cha)、幸运(luck)一律**极低**（多为 1~3）；力量/体质按其凶性给（如丧尸高体质耐打、低敏捷）。**绝对不要给丧尸、野兽这类怪物高魅力或高智力**。
- **魅力(cha)=社交吸引力/外貌气质**：只有外形佳、有人格魅力的人形角色才高；怪物、丑陋、狰狞、无智的存在魅力必须低。
- 有智慧的反派/精英可有高智力，但魅力仍按其形象（狰狞首领魅力不高）。
- 普通人类（学生/平民/职员）六维平实，不要动辄全高。
- 宁可偏低写实，禁止凭空拔高；**先判断"这是个什么东西"，再据此分配六维**。`;

const APPEARANCE_UPDATE_RULE = `
【主角「位置」+「外观」每回合必更新铁则（本回合不输出即视为失职）】**每一回合都必须同时刷新主角的当前位置与外观**，反映本轮正文此刻的最新状态：
- **位置**：主角现在身处何地——用 \`character.B1.location = "具体地点（有坐标就带 X,Y）"\`。场景一变就更新，**绝不许停留在上一轮的旧地点**。
- **外观**：当前动作/姿态、所处场景、衣着/装备变化，以及身上的污渍/伤痕/血迹/湿身/凌乱/表情情绪等即时变化——用 \`character.B1.appearance = "…"\`（或 add("B1",{"16":动作\\|穿着\\|位置\\|身段\\|样貌})，五段用半角竖线｜分隔，其中位置段也要同步当前地点）。
- **即便长相/地点没大变，也要按本回合情境更新动作姿态与即时状态**；绝不要照搬上一轮原文、绝不要这回合跳过不输出。本回合若没输出主角的位置与外观更新指令，即为失职。`;

const PLAYER_STATE_EMIT_RULE = `
【系统·主角状态同步（每回合正文末尾必输出，前端解析后会从显示中自动移除，不影响阅读）】每回合正文的最后，追加一个 <state> 块，更新主角此刻的位置、外观与当前状态：
<state>
character.B1.location = "主角当前所在的具体地点（有坐标就带 X,Y）"
character.B1.appearance = "主角此刻的动作/姿态/衣着/即时状态（污渍·伤痕·湿身·表情等）"
character.B1.status = "状态名:表情符(效果|激活条件|结束条件|来源)；状态名2:表情符(…)；…"
</state>
- 位置随场景变化即时更新、绝不要停留在旧地点；外观每回合都按当前情境刷新。
- **当前状态(status)必须严格按「状态名:Emoji(效果|激活|结束|来源)」格式**——多个状态用中文分号；分隔；括号内四段顺序固定、用半角竖线|分隔（某段不详可留空但保留|）；状态名后紧跟一个表情符；无任何状态时写「一切正常」。**绝不能只写状态名（那样前端解析不出可展开的胶囊详情、也没有图标）**。
  例：character.B1.status = "浑身浴血:🩸(威慑+10%、易被追踪|血战之后|清洗后消退|斩杀群敌)；暂时脱离战斗:🚪(短暂喘息|主动后撤|再次交战时|战术撤离)；煞气缠身:⚔️(近战气势压制|连续杀戮|情绪平复后|嗜血状态)"
- 此块只供系统读取。`;

const STATUS_FORMAT_RULE = `
【当前状态·固定格式铁则（主角+NPC）】「当前状态/Buff」(列4 / character.<id>.status) 必须按**固定格式**输出，供前端解析成状态胶囊：
- 每个状态写 \`状态名:Emoji(效果|激活条件|结束条件|来源)\`，**多个状态之间用中文分号 ；分隔**。
- 例：\`受伤:🩸(每回合-5HP|战斗中受创|休息或治疗后|被抓伤)；疲惫:😮‍💨(行动效率-20%|连续奔逃|充分休息后|长时间逃命)\`。
- 括号内四段用半角竖线 | 分隔，顺序固定为「效果|激活|结束|来源」；某段不详可留空但保留 |。状态名后紧跟一个 Emoji（半角冒号 : 连接）。
- **不要把当前状态写成整段自由文本/句子**，必须严格按上述结构，否则前端解析不出胶囊。没有任何状态时写「一切正常」或留空，不要编造。`;

const NPC_PRIVATE_EXTRA_RULE = `
【女性 NPC 私密补充字段·铁则】**仅当目标是女性 NPC（第1列性别=女）、且本轮正文确有性接触/身体开发剧情时**才维护以下命名字段；无相关剧情或男性 NPC 一律不写、留空。用 add("<id>",{...}) 写入（会展示在「私密信息」面板）：
- 淫纹：印刻在该女性**小腹**上的纹路，**每个女性随其性格与经历各不相同**，会随着被征服与开发的程度逐步浮现/演变（尚未开发可写「未显现」）。需描述纹路形态并与其性格/经历呼应。
- 解锁服装：该女性**已在性爱过程中穿过**的服装，分号分隔、**去重累积**（如「校服；护士服；婚纱」）。
- 独特技巧：属于该女性的**独特榨精技巧**——结合她的性格/身份/特点**发挥想象原创**（禁止套模板照抄），每次性爱后精进（可附熟练度/进化）。
- 性爱姿势：记录**已掌握**的体位（传教士/观音坐莲/后入/骑乘等），每次性爱把本轮新掌握的并入、**合并类似姿势**；下列仅参考，禁止不经思考照抄。
- 开发玩法：该女性被主角**开发过**的玩法，分号分隔累积。**参考库（仅供参考、禁止无脑照抄，按实际剧情思考选用）**：阿黑颜；性玩具[假阳具/口球/跳蛋/炮机/尿道塞/乳夹/阴蒂夹/肛塞/肛珠/肛勾/振动棒/圆头按摩棒/眼罩/手足枷/口衔]；装置[十字架/反省板/三角木马/拘束推车]；捆绑[后手反捆/龟甲缚/M字开腿缚/高抬腿缚/片足上吊缚]。
铁则：①只对女性 NPC、且正文有相应剧情才写；②**累积式更新**，不要每轮清空重来；无新进展则不输出这些字段；③参考库只是清单，必须结合角色与剧情思考，禁止照抄堆砌；④**【强制】本轮正文只要发生了女性性行为（性接触/插入/口交/调教/被开发等），事后必须把该女性的全部私密条目逐项更新或新增——既包括上面这些命名字段，也包括性相关列（8性经验/17表性癖/18里性癖/20敏感部位/21性器状态/22情欲值/23快感值/24性观念），一项都不能漏；情欲值/快感值给具体数值，独特技巧/性爱姿势/开发玩法按本轮新进展累积。`;

const FACTION_NAME_RULE = `
【势力命名·铁则】势力 name 必须是**符合当前世界观、有具体含义的中文名称**（如「青云宗」「黑鸦佣兵团」「哥布林巢穴·血牙部族」「圣盾骑士团」）。**严禁**用势力ID（F1/F2…）、英文代号、或「未命名/某势力/势力一」这类无意义占位文字当名字。正文已出现该势力名号则照用；未命名时按其类型/规模/首领/所处世界自拟一个贴切中文名。**若某势力当前的名字仍是 ID/英文/无意义占位（如 F1），必须在本次演化中把它改成贴切的中文名。**`;

const TITLE_DIVERSITY_RULE = `
【称号·多样化 & 去重铁则】称号是角色**长期赢得的身份/成就/江湖外号**，不是每回合的临时心情或场景状态：
- **绝不为转瞬的情绪/场景造称号**：如「受惊的XX」「浴血的XX」「慌乱的XX」这类是**当前状态**，不是称号，禁止 addTitle。
- **不许堆同主题变体**：已有「解析天才」就别再加「粉色天才」「受惊的粉色天才」这种换汤不换药的同义称号；同一侧面只留一个最贴切的——要改就 addTitle 同名更新、或 deTitle 旧的再加新的，**不要平行堆叠近义称号**。
- 新称号必须与已有称号**主题不同、来源不同**，覆盖不同维度（战斗实力 / 身份地位 / 重大成就 / 性格外号 / 职业专长 等各取其一）才值得新增。
- **只有正文出现明确的「获得称号/被冠以名号/达成里程碑」证据时才 addTitle**；没有就不加，宁缺毋滥，不要每回合新增。每个角色称号库保持精炼（通常 1~4 个）。`;

const TALENT_NO_CAP_RULE = `
【天赋数量解除上限·覆盖旧规则】**本规则优先级高于任何预设里"每角色最多3个天赋/天赋不可超过3个"之类的限制**——天赋数量**不设上限**，同类型也不再强制唯一。仍遵守：只有正文出现明确"觉醒/获得/融合/传承"等证据时才用 addTalent 新增；同名天赋只更新不重复添加；无证据不要凭空堆叠。技能同理不卡死数量。`;

/* 是否身处轮回乐园（任务间歇·回归态）——worldName 指向家园 */
function isHomeWorld(name?: string): boolean {
  return /轮回乐园|专属房间|主神空间/.test(name ?? '');   // 含「主神空间」仅为兼容旧存档的家园判定，非展示文案
}
/* 回归乐园后的一致性兜底（每回合开头跑，基于上一回合落库的状态）：
   ① 顶/底时间一致：home 时 worldTime = paradiseTime
   ② 任务世界的势力移出"当前世界"：home 时，worldName 属于任务世界(非家园)的势力 inCurrentWorld=false */
function reconcileHomeWorld(): void {
  const M = useMisc.getState();
  if (!isHomeWorld(M.worldName)) return;
  if (M.paradiseTime && M.worldTime !== M.paradiseTime) M.setTime({ worldTime: M.paradiseTime });
  const F = useFaction.getState();
  for (const f of Object.values(F.factions)) {
    if (f.inCurrentWorld && f.worldName && !isHomeWorld(f.worldName)) F.setWorld(f.id, false);
  }
}

/* HP/EP 兜底：主角 HP/EP 仍是旧硬编码默认(100/100 & 50/50，从未被正文改过)时，按六维(体质×20 / 智力×15)重算为满。
   解决「主角 HP/EP 永远停在 100/50、不随体质/智力变化」。任一值被正文动过(≠默认)即不再插手，避免覆盖剧情伤害。
   （NPC 的 hp/mp 默认 undefined→effectiveResource 已按属性算满，本来就正常；只有主角有硬编码默认值需兜底。）*/
function reconcilePlayerVitals(): void {
  const g = useGame.getState();
  const p = g.player;
  if (p.hp === 100 && p.maxHp === 100 && p.mp === 50 && p.maxMp === 50) {
    const a = usePlayer.getState().profile.attrs;
    const mh = computeMaxHp(a), me = computeMaxEp(a);
    if (mh !== 100 || me !== 50) {
      g.setPlayerField('maxHp', mh); g.setPlayerField('hp', mh);
      g.setPlayerField('maxMp', me); g.setPlayerField('mp', me);
    }
  }
}

const MISC_HOME_TIME_RULE = `
【回归乐园·时间一致】当主角身处轮回乐园/专属房间（任务间歇或已回归）时，**世界时间(worldTime / current_world_time) 必须与轮回历(paradiseTime) 完全一致**，并把 worldName 设为「轮回乐园」或「轮回乐园·专属房间」。绝不要把上一个任务世界的时间（如 1943 年）继续留在世界时间里。`;

const MISC_SUMMARY_CADENCE_RULE = `
【总结分工铁则（最高优先，覆盖预设里"每轮都给大总结"的旧要求）】小总结与大总结**职责不同、节奏不同，绝不能内容雷同**：
- 小总结 addSmallSummary：**每轮必给**，只聚焦【本回合】发生的关键变化（关键人物 / 地点·时间 / 事件经过 / 结果 / 下一步），具体精炼，不要复述更早回合。
- 大总结 addLargeSummary：**不是每轮都写**。是否输出严格听从下方「本轮大总结开关」：
  · 开关=否 → **禁止输出任何 addLargeSummary**（即便写了也会被系统丢弃）。
  · 开关=是 → 必须且只输出 **1 条** addLargeSummary：它是对下方【最近小总结】的更高层「阶段压缩」——归纳这一阶段的整体走向、当前处境、未决任务与后续风险，**抹去单回合细节**，与任何一条小总结都明显不同；严禁把本回合小总结原样换句话当作大总结。`;

const FACTION_HOME_EXIT_RULE = `
【势力随世界进出·铁则】势力是**世界绑定**的：只有 worldName 与「当前世界」一致的势力才算"当前世界(inCurrentWorld)"。
- 当前世界为轮回乐园（主角已回归）时，**上一个任务世界（如哥布林杀手世界）的所有势力都必须放进 exits（移出当前世界）**，只保留轮回乐园本身的组织。
- 切换到新任务世界时，旧世界势力同样移出。判断 exits 时优先看势力的 worldName 是否等于当前世界。`;

/* ── 限时状态过期：硬控类应短暂，无明确时长的也要给默认回合数，避免"持续"类永不消失 ── */
const CC_STATUS_RE = /昏迷|眩晕|晕眩|麻痹|麻痺|定身|冰冻|冻结|石化|沉默|击晕|僵直|瘫痪|震慑|束缚|禁锢|缴械|致盲|恐惧|魅惑|催眠|休克|窒息|击飞|倒地|失神|眩/;
const INDEFINITE_STATUS_RE = /永久|永远|长期|永续|不限|无限|terminal|permanent/i;
const DEFAULT_STATUS_TURNS = 4;   // 限时状态无明确时长时的默认持续回合
const STALE_STATUS_TURNS = 5;     // 旧存档里无任何时限、未标永久的限时状态，超过此回合数强制清理（兜底）

const rightMenuItems = [
  { icon: '⚔', label: '装备' },
  { icon: '🎒', label: '储存空间' },
  { icon: '📇', label: 'NPC' },
  { icon: '✨', label: '技能' },
  { icon: '🛠', label: '副职业' },
  { icon: '🎖', label: '称号' },
  { icon: '🏆', label: '成就' },
  { icon: '🏛', label: '势力' },
  { icon: '🏯', label: '领地' },
  { icon: '🛡', label: '冒险团' },
  { icon: '🌌', label: '万族' },
  { icon: '🔍', label: '回合洞察' },
  { icon: '📋', label: '任务' },
  { icon: '📡', label: '频道' },
  { icon: '🧠', label: '记忆' },
  { icon: '💾', label: '存档' },
  { icon: '⚙', label: '设置' },
];

export default function App() {
  const hasSave = useGame((s) => s.player.cleared.length > 0 || s.player.points > 0);

  // 综合设置
  const historyLimit = useSettings((s) => s.historyLimit);
  const narrativeMem = useSettings((s) => s.narrativeMemory);

  // 正文生成设置
  const textApi          = useSettings((s) => s.textApi);
  const sharedApi        = useSettings((s) => s.api);
  const textUseShared    = useSettings((s) => s.textUseSharedApi);
  const textWorldBooks   = useSettings((s) => s.textWorldBooks);
  const textPresets      = useSettings((s) => s.textPresets);
  const activePresetId   = useSettings((s) => s.activeTextPresetId);
  const textStream           = useSettings((s) => s.textStream);
  const globalRegexScripts   = useSettings((s) => s.globalRegexScripts);

  // 物品管理 + 主角演化：回合计数 + 阶段状态 + 最近正文缓存
  const turnCountRef         = useRef(0);
  const lastUserInputRef     = useRef('');
  const lastNarrativeRef     = useRef('');
  const [itemPhaseRunning,   setItemPhaseRunning]   = useState(false);
  const [itemPhaseLog,       setItemPhaseLog]       = useState('');
  const [playerPhaseRunning, setPlayerPhaseRunning] = useState(false);
  const [playerPhaseLog,     setPlayerPhaseLog]     = useState('');
  const [npcPhaseRunning,    setNpcPhaseRunning]    = useState(false);
  const [npcPhaseLog,        setNpcPhaseLog]        = useState('');
  const [factionPhaseLog,    setFactionPhaseLog]    = useState('');     // 势力演化阶段提示
  const [factionPanelOpen,   setFactionPanelOpen]   = useState(false);
  const [territoryPhaseLog,  setTerritoryPhaseLog]  = useState('');     // 领地演化阶段提示
  const [territoryPanelOpen, setTerritoryPanelOpen] = useState(false);
  const [cosmosPhaseLog,     setCosmosPhaseLog]     = useState('');     // 万族演化阶段提示
  const [cosmosPanelOpen,    setCosmosPanelOpen]    = useState(false);
  const [teamPhaseLog,       setTeamPhaseLog]       = useState('');     // 冒险团演化阶段提示
  const [teamPanelOpen,      setTeamPanelOpen]      = useState(false);
  const [imagePhaseLog,      setImagePhaseLog]      = useState('');     // 生图（肖像/装备）阶段提示
  const [onSceneDetailId,    setOnSceneDetailId]    = useState<string | null>(null);  // 在场人物浮窗 → NPC 详情
  const [insightOpen,        setInsightOpen]        = useState(false);
  const [cleanupNpcs,        setCleanupNpcs]        = useState<{ id: string; name: string }[]>([]);  // NPC 定期清理提醒弹窗
  const [nmRecalling,        setNmRecalling]        = useState(false);  // 叙事记忆：正在进行记忆回溯
  const [nmPhaseLog,         setNmPhaseLog]         = useState('');     // 叙事记忆：回溯/整理结果提示
  const [backpackOpen,     setBackpackOpen]     = useState(false);
  const [showVer,          setShowVer]          = useState(false);   // 版本「已更新」提示横幅
  const [equipOpen,        setEquipOpen]        = useState(false);
  const [charPanelOpen,    setCharPanelOpen]    = useState(false);
  const [titlePanelOpen,   setTitlePanelOpen]   = useState(false);
  const [achievePanelOpen, setAchievePanelOpen] = useState(false);
  const [subProfOpen,      setSubProfOpen]      = useState(false);
  const [npcPanelOpen,     setNpcPanelOpen]     = useState(false);
  const [miscPanelOpen,    setMiscPanelOpen]    = useState(false);
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [summaryPanelOpen, setSummaryPanelOpen] = useState(false);
  const [saveOpen,         setSaveOpen]         = useState(false);
  const miscParadiseTime = useMisc((s) => s.paradiseTime);
  const miscWorldTime    = useMisc((s) => s.worldTime);
  const miscWorldName    = useMisc((s) => s.worldName);
  const miscWeather      = useMisc((s) => s.weather);

  const [started, setStarted] = useState(false);
  const [creating, setCreating] = useState(false);   // 角色创建页
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<'player' | 'menu' | null>(null); // 手机端：左角色栏 / 右导航 抽屉
  const [inputValue, setInputValue] = useState('');
  const [rawResponse, setRawResponse] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [promptSent, setPromptSent] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [injectedMem, setInjectedMem] = useState('');   // 上次注入正文的记忆/档案块（叙事记忆+结构化档案）
  const [showInjected, setShowInjected] = useState(false);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [prevWorlds, setPrevWorlds] = useState<WorldOption[]>([]);
  const [prevInput, setPrevInput] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);      // 对话滚动容器
  const stickBottomRef = useRef(true);                     // 是否吸附底部（用户上滑查看时置 false，流式生成不再强拉到底）
  const msgId = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);   // 始终镜像 messages，供 callApi 取到最新历史（避免 setState 后闭包仍是旧值）
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);   // 正文生成中止控制器（停止生成用）
  const [canUndo, setCanUndo] = useState(false);           // 是否有可回退的上一回合
  const [confirmAction, setConfirmAction] = useState<null | { title: string; desc: string; run: () => void }>(null); // 回退/重新生成的确认弹窗

  useEffect(() => {
    messagesRef.current = messages;
    // 仅当用户已在底部附近时才自动跟随（上滑查看时不强拉到最新，解决"流式生成时被强制拽到底"）
    if (stickBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: generating ? 'auto' : 'smooth' });
  }, [messages, generating]);

  // 滚动监听：判断是否贴近底部（贴近=继续吸附跟随；上滑超过阈值=暂停跟随）
  function onChatScroll() {
    const el = chatScrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // 进入/返回游戏界面（关设置、选完世界、读档进入等）时，跳到最新对话底部——修复"返回后回到顶层最早对话"
  useEffect(() => {
    if (started && !settingsOpen && worlds.length === 0) {
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) { el.scrollTop = el.scrollHeight; stickBottomRef.current = true; }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, started, worlds.length]);

  // 打开公共频道时：内容为空或距上次刷新过久则懒刷新一批（手动 🔄 强制刷新）
  useEffect(() => {
    if (channelPanelOpen) refreshChannel(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPanelOpen]);

  /* 每回合结束（生成完成、末条为正文）后，延时自动存档到固定槽（覆盖式）。
     延时是为了等 NPC/物品/势力等并发演化阶段写完 store，使快照包含本回合变化。 */
  useEffect(() => {
    if (!started || generating) return;
    if (!chatHydrated.current) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { captureTurnSnapshot(); void autoSaveSlot(messagesRef.current); }, 20000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [messages, generating, started]);

  const chatHydrated = useRef(false);

  // 挂载：从 IndexedDB 读回上次对话（跨刷新自动保留）；读档后自动进入游戏
  useEffect(() => {
    (async () => {
      // 世界书/正文世界书/文本预设改存 IndexedDB（localStorage 太小）：先回填用户自有，迁移旧 localStorage 残留，再补内置，最后开镜像
      try {
        const wb = await loadWb();
        if (wb) {
          useSettings.setState({ worldBooks: wb.worldBooks ?? [], textWorldBooks: wb.textWorldBooks ?? [], textPresets: wb.textPresets ?? [] });
        } else {
          const c = useSettings.getState();   // IndexedDB 为空：把老版本残留在 localStorage 的世界书迁移过来
          if (c.worldBooks?.length || c.textWorldBooks?.length || c.textPresets?.length) {
            await saveWb({
              worldBooks: c.worldBooks.filter((b: any) => !b.builtin),
              textWorldBooks: c.textWorldBooks.filter((b: any) => !b.builtin),
              textPresets: c.textPresets.filter((p: any) => !p.builtin),
            });
          }
        }
      } catch { /* */ }
      void loadBuiltinDefaults();   // 补内置（仅当对应仓库仍为空）；内置项标 builtin、不入库，每次从 public 重载
      // 镜像：世界书/预设变化（剔除 builtin 内置项）→ 防抖写入 IndexedDB
      { let wbT: ReturnType<typeof setTimeout> | null = null; let wbLast: any[] | null = null;
        useSettings.subscribe((s) => {
          const ref = [s.worldBooks, s.textWorldBooks, s.textPresets];
          if (wbLast && wbLast[0] === ref[0] && wbLast[1] === ref[1] && wbLast[2] === ref[2]) return;
          wbLast = ref; if (wbT) clearTimeout(wbT);
          wbT = setTimeout(() => saveWb({
            worldBooks: s.worldBooks.filter((b: any) => !b.builtin),
            textWorldBooks: s.textWorldBooks.filter((b: any) => !b.builtin),
            textPresets: s.textPresets.filter((p: any) => !p.builtin),
          }), 800);
        });
      }
      // 版本「已更新」提示：仅老玩家、且版本号变化时弹一次（纯提示，不动存档/预设/世界书）
      try {
        const sv = localStorage.getItem('zs-seen-version');
        if (sv && sv !== APP_VERSION) setShowVer(true);
        localStorage.setItem('zs-seen-version', APP_VERSION);
      } catch { /* */ }
      // 图片：从 IndexedDB 回填 avatar/image 到各 store（localStorage 已不存图），再开启自动镜像
      try { await hydrateImages(); } catch { /* */ }
      initImageSync();
      const loaded = await chatDb.loadAll();
      if (loaded.length) {
        setMessages(loaded as any);
        msgId.current = loaded.reduce((mx, x) => Math.max(mx, x.id ?? 0), 0);
        // 回合数按已有用户消息数恢复——否则刷新/读档后 turnCount 归0，与持久化的 lastSeenTurn/lastRefreshTurn 等错位（回合数"乱"）
        turnCountRef.current = (loaded as any[]).filter((m) => m.role === 'user').length;
      }
      chatHydrated.current = true;
      try { useCharacters.getState().dedupeIds(); } catch { /* 修复历史存档的重复技能 id */ }
      try { useItems.getState().normalizeEquipSlots(); } catch { /* 规范化历史非规范装备槽（armor:armor→armor:upper 等），使装备面板与背包一致 */ }
      try { setCanUndo(await hasUndoPoint()); } catch { /* */ }
      if (sessionStorage.getItem(PENDING_STARTED_KEY)) {
        setStarted(true);
        sessionStorage.removeItem(PENDING_STARTED_KEY);
      }
      // 重新生成：回退点已 reload 恢复，自动重发同一条输入（演化不叠加）
      const regen = sessionStorage.getItem(PENDING_REGEN_KEY);
      if (regen) {
        sessionStorage.removeItem(PENDING_REGEN_KEY);
        setStarted(true);
        setTimeout(() => { sendMessage(regen); }, 400);
      }
    })();
  }, []);

  // 对话变化时增量写入 IndexedDB（流式只写变化的 1 条；hydrate 完成前不写，避免覆盖）
  useEffect(() => {
    if (!chatHydrated.current) return;
    chatDb.putChanged(messages as any);
  }, [messages]);

  // 对文本执行正则替换
  // placement=1 是我们的 AI输出，placement=2 是 ST 原始 AI输出（兼容已存储的旧数据）
  function applyRegex(text: string, preset: (typeof textPresets)[0] | undefined): string {
    const all = [...globalRegexScripts, ...(preset?.regexScripts ?? [])];
    const scripts = all.filter((s) => !s.disabled && (s.placement.includes(1) || s.placement.includes(2)) && s.findRegex);
    console.log(`[正则] 共 ${all.length} 条，过滤后执行 ${scripts.length} 条`, scripts.map((s) => ({ name: s.scriptName, find: s.findRegex, flags: s.flags, placement: s.placement })));

    let result = text;
    // ── 安全网：隐藏常见「思考/推理」标签块（dotAll），即便用户正则漏配或模型变体也兜底 ──
    //   覆盖 <thinking>/<think>/<reasoning>/<reason>/<plan>/<analysis>/<scratchpad>/<cot> 配对标签
    result = result.replace(/<(thinking|think|reasoning|reason|plan|analysis|scratchpad|cot)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    for (const s of scripts) {
      try {
        // 兼容存量数据：运行时再剥一次 /pattern/flags 格式
        let pattern = s.findRegex;
        let rawFlags = s.flags || '';
        if (pattern.startsWith('/')) {
          const last = pattern.lastIndexOf('/');
          if (last > 0) {
            rawFlags = pattern.slice(last + 1) + rawFlags;
            pattern  = pattern.slice(1, last);
          }
        }
        if (!pattern) continue;
        // 去重 + 只保留合法字符
        const flags = [...new Set(rawFlags)].filter((c) => /[gimsuy]/.test(c)).join('') || 'g';
        const re = new RegExp(pattern, flags);
        const before = result;
        result = result.replace(re, s.replaceString);
        // 兜底重试：未命中 + 含 `.` + 缺 dotAll 时，补 s 标志再试一次
        //   （绝大多数"隐藏思考过程/多行块"漏匹配都是因为忘了 s 标志，导致 . 不跨行）
        if (result === before && /\./.test(pattern) && !flags.includes('s')) {
          try {
            const reS = new RegExp(pattern, flags + 's');
            const retried = result.replace(reS, s.replaceString);
            if (retried !== result) {
              result = retried;
              console.log(`[正则] ✓ "${s.scriptName}" 命中（自动补 s/dotAll 标志后）`);
            } else {
              console.log(`[正则] ✗ "${s.scriptName}" 未命中（含补 s 重试）| pattern="${pattern}" flags="${flags}"`);
            }
          } catch { /* 补 s 失败则忽略 */ }
        } else if (result !== before) {
          console.log(`[正则] ✓ "${s.scriptName}" 命中并替换`);
        } else {
          console.log(`[正则] ✗ "${s.scriptName}" 未命中 | pattern="${pattern}" flags="${flags}"`);
        }
      } catch (e) {
        console.warn(`[正则] "${s.scriptName}" 执行失败:`, e);
      }
    }
    return result;
  }

  // 从 entries[] 构建系统提示和示例消息
  function buildPresetMessages(preset: (typeof textPresets)[0] | undefined, ctx: string) {
    const entries = (preset?.entries ?? []).filter((e) => e.enabled && !e.marker);

    // system role 条目拼成系统提示
    const sysParts = entries.filter((e) => e.role === 'system' || e.system_prompt).map((e) => e.content).filter(Boolean);
    let sysPrompt = sysParts.join('\n\n') || '你是一个沉浸式文字RPG的故事叙述者。';

    // 注入世界书
    if (ctx) sysPrompt += '\n\n[世界书信息]\n' + ctx;
    // 主角状态同步：让始终运行的主正文每回合输出位置/外观（前端解析后剥除），不依赖被节流的主角演化阶段
    sysPrompt += '\n\n' + PLAYER_STATE_EMIT_RULE;

    // user/assistant 条目作为示例历史
    const examples = entries
      .filter((e) => e.role !== 'system' && !e.system_prompt && e.content)
      .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content }));

    return { sysPrompt, examples };
  }

  // 无预设条目时的内置兜底提示词
  const ITEM_FALLBACK_PROMPT = `你是一个游戏状态追踪助手。根据玩家的正文内容，判断是否发生了物品变化或货币变化，并用结构化指令输出。

## 可用指令格式（<state> 块，每行一条）
- item.add = 物品名          # 玩家获得物品
- item.remove = 物品名       # 玩家失去/使用物品
- item.create = 名称|分类|数量  # 创建物品（分类：武器/防具/饰品/功法/法宝/丹药/符箓/材料/灵药/阵具/重要物品/凡物/其他物品）
- item.consume = 名称|数量   # 消耗物品数量
- 乐园币 += 数字             # 获得乐园币
- 乐园币 -= 数字             # 花费乐园币
- 灵魂钱币 += 数字           # 获得灵魂钱币
- 灵魂钱币 -= 数字           # 花费灵魂钱币

## 规则
- 只根据正文中明确发生的事件输出指令
- 无变化时输出空的 <state></state>
- 禁止输出正文内容，只输出指令块`;

  /* ─── 物品管理手动触发（跳过频率检查）─── */
  async function triggerItemPhaseManually() {
    if (itemPhaseRunning) return;
    const narrative = lastNarrativeRef.current;
    if (!narrative) {
      setItemPhaseLog('⚠ 暂无正文内容，请先发送消息后再手动更新');
      setTimeout(() => setItemPhaseLog(''), 4000);
      return;
    }
    // 临时绕过频率检查：直接调用核心逻辑
    await runItemManagementPhaseCore(narrative);
  }

  /* ─── 物品管理核心执行（供自动和手动共用）─── */
  async function runItemManagementPhaseCore(narrative: string) {
    const itemState = useItems.getState();
    const { settings } = itemState;

    // 检查：API 配置
    const ss = useSettings.getState();
    const legacyApi = itemState.itemUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : itemState.itemApi;
    const chain = resolveApiChain('item', legacyApi);

    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      console.warn('[Item] API 未配置（设置→物品管理→API设置）');
      setItemPhaseLog('⚠ 物品阶段：API 未配置');
      setTimeout(() => setItemPhaseLog(''), 5000);
      return;
    }

    // 预设条目：有则用，无则用内置兜底
    const allEntries     = settings.entries ?? [];
    const enabledEntries = allEntries.filter((e) => e.enabled);
    const usingFallback  = enabledEntries.length === 0;

    // ── 诊断日志 ──
    console.log('[Item] ========= 物品阶段诊断 =========');
    console.log('[Item] 预设名称:', settings.presetName || '（无）');
    console.log('[Item] 总条目数:', allEntries.length, '| 已启用:', enabledEntries.length);
    console.log('[Item] 使用兜底:', usingFallback);
    if (enabledEntries.length > 0) {
      console.log('[Item] 已启用条目:', enabledEntries.map((e) => `"${e.name}"(${e.content.length}字)`).join(' / '));
    }

    setItemPhaseRunning(true);
    setItemPhaseLog('物品管理阶段处理中…');
    console.log(`[Item] API 路由: ${chain.length} 条 | 首选 model: ${chain[0]?.modelId}`);

    try {
      // 物品演化发送【全部正文】（不截断），确保整段剧情里的物品/货币变化都能被处理
      const trimmedNarrative = narrative;
      // 注：NPC 初始装备/储物改由码内 backfillNpcStarterKits 在登场时确定性发放（不依赖本阶段时序）；
      //     本阶段对 NPC 物品也只按「明确入手」规则增减（与主角一致），不再强制补全，避免重复/换名生成。

      // system prompt：只放规则，正文放到 user 消息里
      const systemPrompt = (usingFallback
        ? ITEM_FALLBACK_PROMPT
        : buildItemPhaseSystemPrompt(enabledEntries, ''))   // 不在 system 里放正文
        + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + ITEM_FIXED_FORMAT_RULE
        + '\n【穿戴装备处理】不要无故销毁玩家正在穿的装备；但当正文明确"丢弃/扔掉/卖掉/损毁/被夺走"某件穿戴装备时，可直接对它 destroyItem（引擎会自动先卸下再销毁，无需另发 uneq）。已装备物品不要 consumeItem（消耗品不会处于穿戴态）。'
        + '\n【destroy/consume 必带物品名】destroyItem/consumeItem **必须带 "name" 字段=物品全名**（与背包清单一致），itemId 用清单里的真实 ID；引擎优先按 name 匹配。**严禁臆造 itemId**——若不确定 ID，只写 name。例：开宝箱 destroyItem({"name":"白色宝箱","reason":"开启后消失"})；用绷带 consumeItem({"name":"残旧的止血绷带","quantity":1})。'
        + '\n' + ITEM_ACQUIRE_RULE
        + '\n【勿重复生成】背包清单(player_items)里已存在的物品**不要再 createItem**；需要修改已有物品用 updateItem(同 itemId)。'
        + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + ITEM_EXACT_REF_RULE;

      // user 消息：正文 + 指令要求
      const userContent = `# 本轮正文\n${trimmedNarrative}\n\n---\n${
        usingFallback
          ? '请输出本轮物品与货币变化指令。'
          : '请根据以上正文，输出本轮物品与货币（乐园币、灵魂钱币）状态变化指令。只输出 <state> 和 <upstore> 块，无变化时输出空块，禁止输出正文内容。'
      }`;

      console.log('[Item] system prompt 长度:', systemPrompt.length,
        '| 前200字:', systemPrompt.slice(0, 200).replace(/\n/g, '↵'));
      console.log('[Item] user 消息长度:', userContent.length);

      // 参数优先使用 preset（覆盖接口默认）；多接口轮流 + 失败 fallback
      const ss2 = useSettings.getState();
      const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId)
        ?? ss2.textPresets[0];
      const extra: Record<string, unknown> = {};
      if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
      if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
      if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;

      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ], { extra });
      console.log(`[Item] 物品阶段原始响应:`, reply);

      if (reply) {
        applyAllUpdates(reply);
        const itemCmds = parseAllItemCommands(reply);
        const stateUpds = parseAllStateUpdates(reply);
        const total = itemCmds.length + stateUpds.length;
        setItemPhaseLog(
          total > 0
            ? `✓ 物品阶段完成：${itemCmds.length} 条物品指令，${stateUpds.length} 条变量更新`
            : '✓ 物品阶段完成：本轮无变化'
        );
      } else {
        setItemPhaseLog('✓ 物品阶段完成：无输出');
      }
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[Item] 物品管理阶段失败:', msg);
      setItemPhaseLog(`⚠ 物品阶段失败：${msg.slice(0, 60)}`);
    } finally {
      setItemPhaseRunning(false);
      setTimeout(() => setItemPhaseLog(''), 8000);
    }
  }

  /* ─── 物品管理独立阶段（自动，含启用和频率检查）─── */
  async function runItemManagementPhase(narrative: string) {
    const { settings } = useItems.getState();

    if (!settings.enabled) {
      console.log('[Item] 物品管理阶段未启用');
      return;
    }
    const freq = settings.frequency || 1;
    if (turnCountRef.current % freq !== 0) {
      console.log(`[Item] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
      return;
    }
    await runItemManagementPhaseCore(narrative);
  }

  /* ─── 主角演化核心执行 ─── */
  async function runPlayerEvolutionPhaseCore(narrative: string) {
    const playerState = usePlayer.getState();
    const { settings } = playerState;

    const ss = useSettings.getState();
    const legacyApi = playerState.playerUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : playerState.playerApi;
    const chain = resolveApiChain('player', legacyApi);

    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      console.warn('[Player] API 未配置（设置→主角演化→API设置）');
      setPlayerPhaseLog('⚠ 主角演化：API 未配置');
      setTimeout(() => setPlayerPhaseLog(''), 5000);
      return;
    }

    const allEntries     = settings.entries ?? [];
    const enabledEntries = allEntries.filter((e) => e.enabled);

    if (enabledEntries.length === 0) {
      console.log('[Player] 无已启用的预设条目，跳过');
      return;
    }

    console.log('[Player] ========= 主角演化阶段诊断 =========');
    console.log('[Player] 预设名称:', settings.presetName || '（无）');
    console.log('[Player] 总条目数:', allEntries.length, '| 已启用:', enabledEntries.length);

    setPlayerPhaseRunning(true);
    setPlayerPhaseLog('主角演化阶段处理中…');

    try {
      // 主角演化发送【全部正文】（不截断）
      const trimmedNarrative = narrative;

      // 注入主角当前档案快照，让主角演化看到等级/进阶点数/已有技能天赋（避免重复生成、便于进阶点数结算）
      const prof = playerState.profile;
      const b1 = useCharacters.getState().characters['B1'];
      const pSkills = b1?.skills ?? [];
      const pTalents = b1?.traits ?? [];
      const a = prof.attrs;
      const playerProfileSnapshot = [
        `姓名:${prof.name || '主角'} | 阶位:${prof.tier} Lv.${prof.level} | 进阶点数:${prof.advancePoints ?? 0} | 世界之源:${prof.worldSource ?? 0} | 属性点:${prof.attrPoints ?? 0} | 真实属性点:${prof.realAttrPoints ?? 0}`,
        prof.homeParadise && `所属乐园:${prof.homeParadise}`,
        prof.preParadiseJob && `主角背景(入园前职业):${prof.preParadiseJob}`,
        prof.contractorId && `契约者ID:${prof.contractorId}`,
        prof.title && `称号:${prof.title}`,
        prof.profession && `职业:${prof.profession}`,
        prof.arenaRank && `竞技场排名:${prof.arenaRank}`,
        prof.bioStrength && `生物强度模板:${prof.bioStrength}`,
        `六维: 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
        `真实属性(每80普通=1真实,前端自动算,勿写入): 真力${trueAttr(a.str)} 真敏${trueAttr(a.agi)} 真体${trueAttr(a.con)} 真智${trueAttr(a.int)} 真魅${trueAttr(a.cha)} 真幸${trueAttr(a.luck)}`,
        `生命HP上限=体质×20=${computeMaxHp(a)}，蓝量EP上限=智力×15=${computeMaxEp(a)}（前端自动换算，勿写maxHp/maxMp；只有受伤/消耗时才用 hp.B1 -=N / mp.B1 -=N 改当前值）`,
        `当前状态/Buff: ${prof.status || '一切正常'}`,
        (prof.statusEffects?.length ?? 0) > 0 && `限时状态(引擎自动过期,勿重复添加): ${prof.statusEffects.map((e) => `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}`).join('；')}`,
        `当前外观: ${prof.appearance || '（未填写）'}`,
        `当前位置: ${prof.location || '（未填写）'}`,
        `当前生图提示词(列19,有则沿用/仅长期外观变化时更新): ${prof.imageTags || '（未生成,请生成英文NAI tags）'}`,
        `已有技能(${pSkills.length}): ${pSkills.length ? pSkills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）'}`,
        `已有天赋(${pTalents.length}): ${pTalents.length ? pTalents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）'}`,
        (b1?.subProfessions?.length ?? 0) > 0 && `副职业(勿重复add,按需累加进度): ${b1!.subProfessions!.map((p) => `${p.name}[${p.tier} ${p.progress ?? 0}%]${p.recipes?.length ? `(${p.recipeLabel || '配方'}:${p.recipes.map((r) => r.name).join('、')})` : ''}`).join('；')}`,
      ].filter(Boolean).join('\n');
      const systemPrompt = buildPlayerSystemPrompt(enabledEntries)
        .replaceAll('${character_snapshot}', playerProfileSnapshot)
        .replaceAll('${player_skills}', pSkills.length ? pSkills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）')
        .replaceAll('${player_traits}', pTalents.length ? pTalents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）')
        + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + BUFF_AS_STATUS_RULE + '\n' + SUBPROF_RULE + '\n' + TALENT_NO_CAP_RULE + '\n' + TITLE_DIVERSITY_RULE + '\n' + SKILL_TALENT_NOTE_RULE + '\n' + TIER_RULE + '\n' + IMAGE_TAGS_RULE + '\n' + HPEP_NARRATIVE_ONLY_RULE + '\n' + ADVANCE_POINTS_RULE + '\n' + WORLDSOURCE_RULE + '\n' + POINTS_NARRATIVE_RULE + '\n' + ATTR_SANITY_RULE + '\n' + APPEARANCE_UPDATE_RULE + '\n' + STATUS_FORMAT_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + EVO_EXACT_REF_RULE;
      const userContent  = `# 本轮正文\n${trimmedNarrative}\n\n---\n请根据以上正文，输出本轮主角属性与状态变化指令。只输出 <state> 块，无变化时输出空块，禁止输出正文内容。`;

      const ss2 = useSettings.getState();
      const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId)
        ?? ss2.textPresets[0];
      const extra: Record<string, unknown> = {};
      if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
      if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
      if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;

      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent },
      ], { extra });
      console.log('[Player] 主角演化原始响应:', reply);

      if (reply) {
        applyAllUpdates(reply);
        applyPlayerProfileCommands(reply);   // 主角身份/属性/外观/位置变量
        const charCmds  = parseAllCharCommands(reply);
        applyCharacterCommands(charCmds);
        const stateUpds = parseAllStateUpdates(reply);
        const total = stateUpds.length + charCmds.length;
        setPlayerPhaseLog(
          total > 0
            ? `✓ 主角演化完成：${stateUpds.length} 条属性更新，${charCmds.length} 条技能/天赋指令`
            : '✓ 主角演化完成：本轮无变化'
        );
      } else {
        setPlayerPhaseLog('✓ 主角演化完成：无输出');
      }
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[Player] 主角演化阶段失败:', msg);
      setPlayerPhaseLog(`⚠ 主角演化失败：${msg.slice(0, 60)}`);
    } finally {
      setPlayerPhaseRunning(false);
      setTimeout(() => setPlayerPhaseLog(''), 8000);
    }
  }

  /* ─── 主角演化独立阶段（自动，含启用和频率检查）─── */
  async function runPlayerEvolutionPhase(narrative: string) {
    const { settings } = usePlayer.getState();
    if (!settings.enabled) {
      console.log('[Player] 主角演化阶段未启用');
      return;
    }
    const freq = settings.frequency || 1;
    if (turnCountRef.current % freq !== 0) {
      console.log(`[Player] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
      return;
    }
    await runPlayerEvolutionPhaseCore(narrative);
  }

  /* ════════════════════════════════════════════
     NPC 演化通用工具
  ════════════════════════════════════════════ */

  function getNpcApi() {
    const npcEvoState = useNpcEvo.getState();
    const ss = useSettings.getState();
    return npcEvoState.npcUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : npcEvoState.npcApi;
  }

  // NPC / 势力演化仍用此截断控 token（可能逐目标并发多次调用）；杂项/领地/冒险团已改发全文
  const MAX_NARRATIVE = 6000;
  function trimNarrative(narrative: string) {
    return narrative.length > MAX_NARRATIVE
      ? '…（已截取最后部分）\n' + narrative.slice(-MAX_NARRATIVE)
      : narrative;
  }

  /* 统一的一次 chat/completions 调用，返回正文字符串（接口路由多选→轮流+fallback）*/
  async function npcChatCompletion(systemPrompt: string, userContent: string): Promise<string> {
    const chain = resolveApiChain('npc', getNpcApi());
    const ss2 = useSettings.getState();
    const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId) ?? ss2.textPresets[0];
    const extra: Record<string, unknown> = {};
    if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
    if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
    if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;
    const timeoutSec = Math.max(10, useNpcEvo.getState().settings.scheduling.requestTimeout || 90);
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      { timeoutMs: timeoutSec * 1000, extra },
    );
    return content;
  }

  /* NPC 上下文变量（两阶段共用） */
  function buildNpcVars(narrative: string): Record<string, string> {
    const records  = Object.values(useNpc.getState().npcs);
    const onScene  = records.filter((r) => r.onScene && !r.isDead);
    const offScene = records.filter((r) => !r.onScene && !r.isDead);

    const existingIds = ['B1（玩家）', ...records.map((r) => `${r.id}(${r.name})`)].join(', ');
    const cNums = records.map((r) => r.id.match(/^C(\d+)$/)?.[1]).filter(Boolean).map(Number);
    const nextNpcId = `C${cNums.length > 0 ? Math.max(...cNums) + 1 : 1}`;

    const onscreenText = onScene.length > 0
      ? onScene.map((r) =>
          `[${r.id}] ${r.name}${r.gender ? '·' + r.gender : ''} 阶位:${r.realm || '未知'} 状态:${r.status} 好感:${r.favor}`
          + (r.personality ? ` 性格:${r.personality}` : '')
          + (r.appearance5 ? ` 外观:${r.appearance5.split('|')[0] ?? ''}` : '')
        ).join('\n')
      : '（本轮暂无在场NPC）';
    const offscreenText = offScene.length > 0
      ? offScene.map((r) =>
          `[${r.id}] ${r.name} 已离场 背景:${(r.background || '—').slice(0, 80)}`
          + (r.deeds ? ` 近况:${r.deeds.split('\n').slice(-2).join('；')}` : '')
        ).join('\n')
      : '（无离场角色）';

    const M = useMisc.getState();
    const curTime = M.worldTime || M.paradiseTime || '';
    const curLoc = M.worldName || '';

    return {
      story_text: narrative, 本轮正文: narrative, user_input: '',
      existing_character_ids: existingIds, all_character_ids: existingIds, next_available_npc_id: nextNpcId,
      onscreen_characters: onscreenText, offscreen_biographies: offscreenText,
      world_factors: '', world_map_pois: '', world_events: serializeEvents(M.worldEvents),
      current_time: curTime, currentTime: curTime, current_location: curLoc, season: '',
      time_location_row: `${curLoc} ${curTime}`.trim(),
      focus_list: '', 重点演化列表: '',
      // 单角色重点演化才会被覆盖；这里先置空，避免预设里的 ${...} 占位符原样泄漏进提示词
      character_snapshot: '', npc_biography: '', character_equipment: '', character_items: '',
      character_gongfa: '', beasts_summary: '（无）', target_narrative_memory: '', npc_perspective_story: '',
      quick_chat_npc: '', item_management_results: '', timeSinceLastEvolution: '', thinking_content: '',
      cultivation_naming_rule: '',
    };
  }

  function fillVars(content: string, vars: Record<string, string>): string {
    let out = content;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v ?? '');
      out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
    }
    return out;
  }

  /* 目标角色当前档案快照（供重点演化"继续"既有角色，不要重新取名/重建）*/
  function serializeNpcSnapshot(r: import('./store/npcStore').NpcRecord): string {
    const cdata = useCharacters.getState().characters[r.id];
    const skills = cdata?.skills ?? [];
    const talents = cdata?.traits ?? [];
    const attrs = r.attrs;
    const lines = [
      `角色ID: ${r.id}`,
      `姓名: ${r.name || '（未命名）'}${r.gender ? ` | 性别:${r.gender}` : ''}`,
      r.age && `年龄: ${r.age}`,
      r.npcTag && `标签: ${r.npcTag}`,
      r.review && `诙谐评价: ${r.review}`,
      r.realm && `阶位/身份(列2): ${r.realm}`,
      r.title && `称号: ${r.title}`,
      r.profession && `职业: ${r.profession}`,
      r.arenaRank && `竞技场排名: ${r.arenaRank}`,
      r.brandLevel && `烙印等级: ${r.brandLevel}`,
      r.contractorId && `契约者ID: ${r.contractorId}`,
      r.bioStrength && `生物强度模板: ${r.bioStrength}`,
      attrs && `生命HP: ${effectiveResource(r.hp, r.maxHp, computeMaxHp(attrs))}/${computeMaxHp(attrs)}（上限=体质×20，前端自动算，勿写maxHp）`,
      attrs && `蓝量EP: ${effectiveResource(r.mp, r.maxMp, computeMaxEp(attrs))}/${computeMaxEp(attrs)}（上限=智力×15，前端自动算，勿写maxMp）`,
      !attrs && (r.hp != null || r.maxHp != null) && `HP: ${r.hp ?? '?'}/${r.maxHp ?? '?'}`,
      !attrs && (r.mp != null || r.maxMp != null) && `MP/EP: ${r.mp ?? '?'}/${r.maxMp ?? '?'}`,
      r.advancePoints != null && `进阶点数: ${r.advancePoints}`,
      r.attrPoints != null && `属性点: ${r.attrPoints}`,
      r.realAttrPoints != null && `真实属性点: ${r.realAttrPoints}`,
      r.skillPoints != null && `技能点: ${r.skillPoints}`,
      attrs && `六维: 力${attrs.str ?? '?'} 敏${attrs.agi ?? '?'} 体${attrs.con ?? '?'} 智${attrs.int ?? '?'} 魅${attrs.cha ?? '?'} 幸${attrs.luck ?? '?'}`,
      attrs && `真实属性(每80普通=1真实,前端自动算,勿写入): 真力${trueAttr(attrs.str ?? 0)} 真敏${trueAttr(attrs.agi ?? 0)} 真体${trueAttr(attrs.con ?? 0)} 真智${trueAttr(attrs.int ?? 0)} 真魅${trueAttr(attrs.cha ?? 0)} 真幸${trueAttr(attrs.luck ?? 0)}`,
      r.personality && `性格(列3): ${r.personality}`,
      r.status && `状态(列4): ${r.status}`,
      (r.statusEffects?.length ?? 0) > 0 && `限时状态(引擎自动过期,勿重复添加): ${r.statusEffects!.map((e) => `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}`).join('；')}`,
      r.callPlayer && `对你称呼(列7): ${r.callPlayer}`,
      r.background && `背景(列10): ${r.background}`,
      r.innerThought && `内心(列12): ${r.innerThought}`,
      r.relations && `关系(列13): ${r.relations}`,
      `好感(列15): ${r.favor}`,
      r.appearance5 && `肖像(列16): ${r.appearance5}`,
      `生图提示词(列19,有则沿用/仅长期外观变化时更新): ${r.imageTags || '（未生成,请生成英文NAI tags）'}`,
      r.motiveNow && `当前动机(列27): ${r.motiveNow}`,
      r.appearanceDetail && `容貌(列34): ${r.appearanceDetail}`,
      // ── 已有技能/天赋：让 AI 看到现状，避免每轮重建累积 ──
      `已有技能(${skills.length}): ${skills.length ? skills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）'}`,
      `已有天赋(${talents.length}): ${talents.length ? talents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）'}`,
    ].filter(Boolean);
    return `【该角色已由登场判断建档，本阶段只做"补全 + 增量更新"，不要重造】
- 姓名、阶位(列2)、性格、背景、外观(列16/34)等已确立字段必须**沿用**，禁止重新取名或换成不同的值；只有正文出现明确突破/变故时才更新对应字段。
- 你的职责是补全缺失列（内心/动机/目标/属性/画像tag/性相关列等）与记录本轮真实发生的变化。
- **技能/天赋反累积铁则**：上方「已有技能」「已有天赋」就是该角色的完整清单。**天赋数量不设上限**（旧的"最多3个天赋"限制已解除），技能也不再卡死数量；但只有正文明确写出该角色"学会/领悟/获得"了清单里没有的新技能、或"觉醒/获得"了新天赋时，才允许新增，且必须复用清单中已存在的同名条目ID做更新而非另建。无明确习得证据时，本轮不输出任何 addSkill/addTalent，不要凭空堆叠或重复添加同名。
- 物品/装备不在本阶段生成（由物品管理阶段负责）。
${lines.join('\n')}`;
  }

  /* 重点演化 system prompt（策略B：单角色 charId / 策略A：留空→在场列表） */
  function buildNpcPhaseSystemPrompt(
    entries: import('./store/npcEvoStore').NpcPresetEntry[],
    narrative: string,
    charId?: string,
    entryCreatedIds?: Set<string>,
  ): string {
    const vars = buildNpcVars(narrative);
    const rec = charId ? useNpc.getState().npcs[charId] : undefined;
    const onSceneIds = Object.values(useNpc.getState().npcs).filter((r) => r.onScene && !r.isDead).map((r) => r.id);
    vars.character_id = charId ?? (onSceneIds.join(', ') || vars.next_available_npc_id);
    // 注入目标角色当前档案，让重点演化"继续"既有角色而非重新生成（尤其是姓名），对齐原版 ${character_snapshot}
    if (rec) {
      vars.character_snapshot = serializeNpcSnapshot(rec);
      vars.npc_biography = rec.background ?? '';
    }
    vars.scene_type = charId ? (rec?.onScene ? 'onscene' : 'offscene') : (onSceneIds.length > 0 ? 'onscene' : 'offscene');
    vars.is_offscene = charId ? String(!rec?.onScene) : String(onSceneIds.length === 0);
    vars.is_entry_created_target = String(!!(charId && entryCreatedIds?.has(charId)));

    return entries
      .filter((e) => e.enabled && e.source !== 'entrySharedRules')
      .map((e) => fillVars(e.content, vars))
      .join('\n\n')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + BUFF_AS_STATUS_RULE + '\n' + NPC_AGE_RULE + '\n' + TALENT_NO_CAP_RULE + '\n' + TITLE_DIVERSITY_RULE + '\n' + NPC_DEAD_EXCLUDE_RULE + '\n' + SKILL_TALENT_NOTE_RULE + '\n' + NPC_SKILL_KEEP_RULE + '\n' + NPC_REVIEW_TAG_RULE + '\n' + TIER_RULE + '\n' + IMAGE_TAGS_RULE + '\n' + HPEP_NARRATIVE_ONLY_RULE + '\n' + ADVANCE_POINTS_RULE + '\n' + POINTS_NARRATIVE_RULE + '\n' + ATTR_SANITY_RULE + '\n' + STATUS_FORMAT_RULE + '\n' + NPC_PRIVATE_EXTRA_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + EVO_EXACT_REF_RULE;
  }

  /* 登场判断 system prompt（只取 entrySharedRules 条目） */
  function buildEntryPhaseSystemPrompt(
    entries: import('./store/npcEvoStore').NpcPresetEntry[],
    narrative: string,
  ): string {
    const vars = buildNpcVars(narrative);
    return entries
      .filter((e) => e.enabled && e.source === 'entrySharedRules')
      .map((e) => fillVars(e.content, vars))
      .join('\n\n')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + NPC_DEAD_EXCLUDE_RULE + '\n' + TIER_RULE;
  }

  /* 解析 NPC <state> 短指令（favor/title/realm/hp），可按 charId 过滤 */
  function applyNpcShortCommands(reply: string, onlyId?: string): number {
    const npc = useNpc.getState();
    let n = 0;
    const ok = (id: string) => !onlyId || id === onlyId;
    let m: RegExpExecArray | null;

    const favorRe = /\bcharacter\.(C\d+)\.stats\.favor\s*=\s*(-?\d+)/g;
    while ((m = favorRe.exec(reply))) { if (ok(m[1])) { npc.applyColumns(m[1], { '15': Number(m[2]) }); n++; } }

    const titleRe = /\bcharacter\.(C\d+)\.identity\.title\s*=\s*"([^"]*)"/g;
    while ((m = titleRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { title: m[2] }); n++; } }

    // 状态短指令：character.C1.status = "..."（仅当状态表示"真的死亡"时才标记 isDead，避免"濒临死亡"等误杀）
    const statRe = /\bcharacter\.(C\d+)\.status\s*=\s*"([^"]*)"/g;
    while ((m = statRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const dead = looksDead(m[2]);
      npc.upsertNpc(m[1], dead ? { status: m[2], isDead: true } : { status: m[2] });
      n++;
    }

    // cr.C1 = 一阶/8 → 列2 "一阶·Lv.8|（保留原身份）"；无 /Lv 时只写阶位
    const crRe = /\bcr\.(C\d+)\s*=\s*([^\n/]+?)(?:\/([\d.]+))?\s*(?:\n|$)/g;
    while ((m = crRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const lv = m[3];
      // 阶位只接受合法名；非法则按 Lv 推导（保证只出现 一阶~无上之境）
      const tier = normalizeTier(m[2]) || (lv ? realmFromLevel(Number(lv)) : '一阶');
      const prev = npc.npcs[m[1]]?.realm ?? '';
      const idPart = prev.includes('|') ? prev.slice(prev.indexOf('|') + 1) : '';
      const realmStr = lv ? `${tier}·Lv.${lv}` : tier;
      npc.applyColumns(m[1], { '2': idPart ? `${realmStr}|${idPart}` : realmStr });
      n++;
    }

    // hp.C1 -= 20 / += 10 / = 80：上限按体质×20 自动换算（忽略 AI 写的 /上限），未记录当前值时以满血为基准
    const hpRe = /\bhp\.(C\d+)\s*(=|-=|\+=)\s*(\d+)(?:\s*\/\s*(\d+))?/g;
    while ((m = hpRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      const dmax = computeMaxHp(rec?.attrs);
      const base = effectiveResource(rec?.hp, rec?.maxHp, dmax);
      const v = Number(m[3]);
      const next = m[2] === '=' ? v : m[2] === '+=' ? Math.min(base + v, dmax) : Math.max(0, base - v);
      npc.upsertNpc(m[1], { hp: next, maxHp: dmax });
      n++;
    }

    // identity 字段 → 写入 extra，供 NPC 档案"伪装身份/战斗属性"栏显示
    const idStr: Record<string, string> = { aliasName: '化名', disguiseRealm: '伪装境界', youthRetentionReason: '驻颜理由' };
    for (const [field, label] of Object.entries(idStr)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) {
        if (!ok(m[1])) continue;
        const rec = npc.npcs[m[1]];
        npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), [label]: m[2] } });
        n++;
      }
    }
    const idNum: Record<string, string> = { appearanceAge: '外貌年龄', extraShouyuan: '额外寿元' };
    for (const [field, label] of Object.entries(idNum)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*(-?\\d+)`, 'g');
      while ((m = re.exec(reply))) {
        if (!ok(m[1])) continue;
        const rec = npc.npcs[m[1]];
        npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), [label]: m[2] } });
        n++;
      }
    }

    // 新增身份字段：职业 / 竞技场排名 / 烙印等级 / 契约者ID
    const npcStr: Record<string, keyof import('./store/npcStore').NpcRecord> = {
      profession: 'profession', arenaRank: 'arenaRank', brandLevel: 'brandLevel', contractorId: 'contractorId',
    };
    for (const [field, key] of Object.entries(npcStr)) {
      const re = new RegExp(`\\bcharacter\\.(C\\d+)\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { [key]: m[2] } as any); n++; } }
    }
    // 外观描写 → 列34
    const apRe = /\bcharacter\.(C\d+)\.appearance\s*=\s*"([^"]*)"/g;
    while ((m = apRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { appearanceDetail: m[2] }); n++; } }
    // 生物强度模板（T0~T9，含非人生物）：character.C1.bioStrength = "T3·勇士"
    const bioRe = /\bcharacter\.(C\d+)\.bioStrength\s*=\s*"([^"]*)"/g;
    while ((m = bioRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { bioStrength: m[2] }); n++; } }
    // 年龄：character.C1.age = "约25岁"（正文有则照抄，没有则按设定生成）
    const ageRe = /\bcharacter\.(C\d+)\.age\s*=\s*"([^"]*)"/g;
    while ((m = ageRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { age: m[2] }); n++; } }
    // 诙谐评价：character.C1.review = "..."
    const reviewRe = /\bcharacter\.(C\d+)\.review\s*=\s*"([^"]*)"/g;
    while ((m = reviewRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { review: m[2] }); n++; } }
    // 标签（契约者/土著/随从/宠物/召唤物）：character.C1.npcTag = "随从"
    const tagRe = /\bcharacter\.(C\d+)\.npcTag\s*=\s*"([^"]*)"/g;
    while ((m = tagRe.exec(reply))) { if (ok(m[1])) { npc.upsertNpc(m[1], { npcTag: m[2] }); n++; } }
    // 所处位置 → extra.位置
    const locRe2 = /\bcharacter\.(C\d+)\.location\s*=\s*"([^"]*)"/g;
    while ((m = locRe2.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      npc.upsertNpc(m[1], { extra: { ...(rec?.extra ?? {}), 位置: m[2] } });
      n++;
    }
    // 六维基础属性（支持 = 绝对值 / += / -= 增减；含 C 与 G 系 NPC；可随剧情成长/受损更新）
    const npcAttrRe = /\bcharacter\.([CG]\d+)\.attrs\.(str|agi|con|int|cha|luck)\s*(=|\+=|-=)\s*(-?\d+)/g;
    while ((m = npcAttrRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const base = npc.npcs[m[1]]?.attrs ?? { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
      const cur = (base as unknown as Record<string, number>)[m[2]] ?? 5;
      const v = Number(m[4]);
      const next = m[3] === '=' ? v : m[3] === '+=' ? cur + v : cur - v;
      npc.upsertNpc(m[1], { attrs: { ...base, [m[2]]: Math.max(0, next) } });
      n++;
    }
    // mp.C1（蓝量 EP）：上限按智力×15 自动换算（忽略 AI 写的 /上限），未记录当前值时以满蓝为基准
    const mpRe = /\bmp\.(C\d+)\s*(=|-=|\+=)\s*(\d+)(?:\s*\/\s*(\d+))?/g;
    while ((m = mpRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const rec = npc.npcs[m[1]];
      const dmax = computeMaxEp(rec?.attrs);
      const base = effectiveResource(rec?.mp, rec?.maxMp, dmax);
      const v = Number(m[3]);
      const next = m[2] === '=' ? v : m[2] === '+=' ? Math.min(base + v, dmax) : Math.max(0, base - v);
      npc.upsertNpc(m[1], { mp: next, maxMp: dmax });
      n++;
    }
    // 进阶点数：ap.C1 += N (正文获取) / ap.C1 -= N (升级消耗) / ap.C1 = N
    const advPtsRe = /\bap\.(C\d+)\s*(=|-=|\+=)\s*(\d+)/g;
    while ((m = advPtsRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const cur = npc.npcs[m[1]]?.advancePoints ?? 0;
      const v = Number(m[3]);
      npc.upsertNpc(m[1], { advancePoints: m[2] === '=' ? v : m[2] === '+=' ? cur + v : Math.max(0, cur - v) });
      n++;
    }
    // 属性点 / 真实属性点 / 技能点：character.<id>.(attrPoints|realAttrPoints|skillPoints) = / += / -= N（完全按正文）
    const npcPtRe = /\bcharacter\.([CG]\w*)\.(attrPoints|realAttrPoints|skillPoints)\s*(=|-=|\+=)\s*(\d+)/g;
    while ((m = npcPtRe.exec(reply))) {
      if (!ok(m[1])) continue;
      const key = m[2] as 'attrPoints' | 'realAttrPoints' | 'skillPoints';
      const cur = ((npc.npcs[m[1]] as any)?.[key]) ?? 0;
      const v = Number(m[4]);
      npc.upsertNpc(m[1], { [key]: m[3] === '=' ? v : m[3] === '+=' ? cur + v : Math.max(0, cur - v) } as any);
      n++;
    }
    applyTimedStatusCommands(reply, onlyId);   // NPC 限时状态 addStatus/deStatus
    return n;
  }

  /* 主角档案短指令（character.B1.* / 仅主角演化阶段）→ playerStore */
  function applyPlayerProfileCommands(reply: string): number {
    const sp = usePlayer.getState().setProfile;
    const sa = usePlayer.getState().setAttr;
    let n = 0; let m: RegExpExecArray | null;

    const strMap: Record<string, string> = {
      title: 'title', profession: 'profession', arenaRank: 'arenaRank',
      role: 'identity', identity: 'identity', brandLevel: 'brandLevel', contractorId: 'contractorId',
    };
    for (const [field, key] of Object.entries(strMap)) {
      const re = new RegExp(`\\bcharacter\\.B\\d+\\.identity\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { sp({ [key]: m[1] } as any); n++; }
    }
    // 阶位：只接受合法阶位名（一阶~无上之境）；非法则按当前等级推导，绝不写入"结丹/三阶中期"等
    const tierRe = /\bcharacter\.B\d+\.identity\.tier\s*=\s*"([^"]*)"/g;
    while ((m = tierRe.exec(reply))) { sp({ tier: normalizeTier(m[1]) || realmFromLevel(usePlayer.getState().profile.level) }); n++; }
    for (const field of ['appearance', 'location', 'bioStrength', 'homeParadise', 'preParadiseJob', 'imageTags'] as const) {
      const re = new RegExp(`\\bcharacter\\.B\\d+\\.${field}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { sp({ [field]: m[1] } as any); n++; }
    }
    // 当前状态：固定格式 = 含「:Emoji(…)」结构。若新值是纯状态名、而当前已是固定格式，拒绝覆盖
    // （避免主角演化阶段用纯文本把主正文写好的"带图标+可展开详情"的状态胶囊清掉）。
    const statusRe = /\bcharacter\.B\d+\.status\s*=\s*"([^"]*)"/g;
    const isFmtStatus = (s: string) => /[:：]\s*\S{0,4}\s*[（(]/.test(s || '');
    while ((m = statusRe.exec(reply))) {
      const incoming = m[1];
      const cur = usePlayer.getState().profile.status ?? '';
      if (incoming && !isFmtStatus(incoming) && isFmtStatus(cur)) continue;   // 纯文本不覆盖已格式化状态
      sp({ status: incoming }); n++;
    }
    // 等级变化时，阶位随等级自动对应（保证阶位↔等级一致、且只为合法阶位）
    const lvRe = /\bcharacter\.B\d+\.level\s*=\s*(\d+)/g;
    while ((m = lvRe.exec(reply))) { const lv = Number(m[1]); sp({ level: lv, tier: realmFromLevel(lv) }); n++; }
    const attrRe = /\bcharacter\.B\d+\.attrs\.(str|agi|con|int|cha|luck)\s*(=|\+=|-=)\s*(-?\d+)/g;
    while ((m = attrRe.exec(reply))) {
      const a = usePlayer.getState().profile.attrs as unknown as Record<string, number>;
      const cur = a[m[1]] ?? 5;
      const v = Number(m[3]);
      sa(m[1] as any, Math.max(0, m[2] === '=' ? v : m[2] === '+=' ? cur + v : cur - v));
      n++;
    }
    // 兼容预设的列写法 add("B1",{"16":动作|穿着|位置|身段|样貌,"10":背景}) → 同步到 profile.appearance/location/background
    // （侧栏外观描写读 profile.appearance，旧预设却用列16输出，导致外观不更新——这里做映射）
    const b1AddRe = /\badd\s*\(\s*"B\d+"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    while ((m = b1AddRe.exec(reply))) {
      let payload: any;
      try { payload = JSON.parse(m[1]); } catch { try { payload = JSON.parse(m[1].replace(/'/g, '"')); } catch { continue; } }
      if (typeof payload['16'] === 'string' && payload['16'].trim()) {
        const parts = payload['16'].split('|').map((s: string) => s.trim());
        if (parts.length >= 5) {
          sp({ appearance: [parts[1], parts[3], parts[4]].filter(Boolean).join('；') });
          if (parts[2]) sp({ location: parts[2] });
        } else {
          sp({ appearance: payload['16'].trim() });
        }
        n++;
      }
      if (typeof payload['4'] === 'string' && payload['4'].trim()) {
        sp({ status: payload['4'].trim() });  // 列4 当前状态/Buff → 侧栏当前状态
        n++;
      }
      if (typeof payload['10'] === 'string' && payload['10'].trim()) {
        usePlayer.getState().setBackground(payload['10'].trim());
        n++;
      }
      // 列19 / imageTags：生图提示词（英文 NAI tags）→ profile.imageTags
      const tags19 = payload['19'] ?? payload.imageTags ?? payload['生图提示词'];
      if (typeof tags19 === 'string' && tags19.trim()) { sp({ imageTags: tags19.trim() }); n++; }
    }
    // 进阶点数：ap.B1 += N (正文获取) / ap.B1 -= N (升级消耗) / ap.B1 = N
    const apRe = /\bap\.B\d+\s*(=|-=|\+=)\s*(\d+)/g;
    while ((m = apRe.exec(reply))) {
      const cur = usePlayer.getState().profile.advancePoints ?? 0;
      const v = Number(m[2]);
      sp({ advancePoints: m[1] === '=' ? v : m[1] === '+=' ? cur + v : Math.max(0, cur - v) });
      n++;
    }
    // 世界之源：character.B1.worldSource += N（正文获取）/ = 0（回归乐园归零，支持小数百分比）
    const wsRe = /\bcharacter\.B\d+\.worldSource\s*(=|-=|\+=)\s*([\d.]+)/g;
    while ((m = wsRe.exec(reply))) {
      const cur = usePlayer.getState().profile.worldSource ?? 0;
      const v = Number(m[2]);
      const raw = m[1] === '=' ? v : m[1] === '+=' ? cur + v : Math.max(0, cur - v);
      sp({ worldSource: Math.round(raw * 10) / 10 });   // 最多保留 1 位小数，避免 0.3000000004 浮点误差
      n++;
    }
    // 属性点 / 真实属性点：character.B1.(attrPoints|realAttrPoints) = / += / -= N（完全按正文，正文没出现就不动）
    const ptRe = /\bcharacter\.B\d+\.(attrPoints|realAttrPoints)\s*(=|-=|\+=)\s*(\d+)/g;
    while ((m = ptRe.exec(reply))) {
      const key = m[1] as 'attrPoints' | 'realAttrPoints';
      const cur = (usePlayer.getState().profile as any)[key] ?? 0;
      const v = Number(m[3]);
      sp({ [key]: m[2] === '=' ? v : m[2] === '+=' ? cur + v : Math.max(0, cur - v) } as any);
      n++;
    }
    applyTimedStatusCommands(reply);   // 主角限时状态 addStatus/deStatus
    return n;
  }

  /* 限时状态指令：addStatus("B1"/"C1",{name,emoji,tone,effect,source,duration}) / deStatus("id","name")
     duration 例："3回合"（回合制）/ "5分钟"/"2小时"/"3天"（游戏时间制，需杂项演化时间可解析）。
     引擎据此自动过期（见 expireStatuses）。仅处理 onlyId（若给）以适配策略B单角色。 */
  function applyTimedStatusCommands(reply: string, onlyId?: string) {
    const M = useMisc.getState();
    const nowGameMin = parseGameMinutes(M.worldTime || M.paradiseTime);
    const turn = turnCountRef.current;
    let m: RegExpExecArray | null;
    // 新增/更新
    const addRe = /\baddStatus\s*\(\s*"([A-Za-z]\w*)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    while ((m = addRe.exec(reply))) {
      const cid = m[1];
      if (onlyId && cid !== onlyId) continue;
      let d: any; try { d = JSON.parse(m[2]); } catch { try { d = JSON.parse(m[2].replace(/'/g, '"')); } catch { continue; } }
      const name = String(d.name ?? '').trim();
      if (!name) continue;
      const durStr = String(d.duration ?? d.dur ?? d.durationDesc ?? '').trim();
      let durTurns = parseDurationTurns(durStr);
      const durMin = parseDurationMinutes(durStr);
      // 无明确时长（如"持续"）→ 按类型给默认回合数，避免限时状态永不过期；显式"永久/长期"才保留无限期
      if (durTurns == null && durMin == null && !INDEFINITE_STATUS_RE.test(durStr)) {
        durTurns = CC_STATUS_RE.test(`${name}${d.type ?? ''}${d.effect ?? ''}`) ? 2 : DEFAULT_STATUS_TURNS;
      }
      const eff: StatusEffect = {
        id: `ST_${cid}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name,
        type: d.type,
        emoji: d.emoji,
        tone: d.tone === 'buff' || d.tone === 'debuff' || d.tone === 'neutral' ? d.tone : undefined,
        effect: d.effect,
        desc: d.desc ?? d.description,
        tags: Array.isArray(d.tags) ? d.tags : undefined,
        source: d.source,
        startTurn: turn,
        durationTurns: durTurns ?? undefined,
        durationDesc: durStr || undefined,
        startGameMin: nowGameMin,
        expireAtMin: (durMin != null && nowGameMin != null) ? nowGameMin + durMin : null,
        addedAt: Date.now(),
      };
      if (/^B\d+$/.test(cid)) usePlayer.getState().addStatusEffect(eff);
      else if (/^[CG]\d+$/.test(cid)) { if (useNpc.getState().npcs[cid]) useNpc.getState().addNpcStatus(cid, eff); }
    }
    // 移除
    const delRe = /\bdeStatus\s*\(\s*"([A-Za-z]\w*)"\s*,\s*"([^"]*)"\s*\)/g;
    while ((m = delRe.exec(reply))) {
      const cid = m[1]; const nm = m[2];
      if (onlyId && cid !== onlyId) continue;
      if (/^B\d+$/.test(cid)) usePlayer.getState().removeStatusEffect(nm);
      else if (/^[CG]\d+$/.test(cid)) useNpc.getState().removeNpcStatus(cid, nm);
    }
  }

  /* 限时状态过期清理：按回合数或游戏时间判定，移除已过期项。每回合发请求前调用。 */
  function expireStatuses() {
    const M = useMisc.getState();
    const nowMin = parseGameMinutes(M.worldTime || M.paradiseTime);
    const turn = turnCountRef.current;
    const isExpired = (e: StatusEffect): boolean => {
      if (e.durationTurns != null && turn - e.startTurn >= e.durationTurns) return true;
      if (e.expireAtMin != null && nowMin != null && nowMin >= e.expireAtMin) return true;
      // 兜底：旧存档里既无回合上限也无时间上限、且未标注永久/长期的限时状态，超过 STALE 回合强制清理
      if (e.durationTurns == null && e.expireAtMin == null
          && !INDEFINITE_STATUS_RE.test(e.durationDesc ?? '')
          && typeof e.startTurn === 'number' && turn - e.startTurn >= STALE_STATUS_TURNS) return true;
      return false;
    };
    // 主角
    const pe = usePlayer.getState().profile.statusEffects ?? [];
    const peKept = pe.filter((e) => !isExpired(e));
    if (peKept.length !== pe.length) usePlayer.getState().setStatusEffects(peKept);
    // NPC
    const npcs = useNpc.getState().npcs;
    for (const id of Object.keys(npcs)) {
      const list = npcs[id].statusEffects ?? [];
      if (list.length === 0) continue;
      const kept = list.filter((e) => !isExpired(e));
      if (kept.length !== list.length) useNpc.getState().setNpcStatuses(id, kept);
    }
  }

  /* ─── 策略B 第一段：登场判断 ─── */
  function parseEntryJson(reply: string): any {
    let t = reply.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const i = t.indexOf('{'); const j = t.lastIndexOf('}');
    if (i >= 0 && j > i) t = t.slice(i, j + 1);
    try { return JSON.parse(t); } catch { return null; }
  }

  // 解析 npc.<id> = {n:"..",r:"..",..} 短键骨架
  function parseSkeleton(stateCommands: string): { id: string; short: Record<string, unknown> } | null {
    const m = /npc\.([CG]\d+)\s*=\s*\{([\s\S]*)\}/.exec(stateCommands || '');
    if (!m) return null;
    const short: Record<string, unknown> = {};
    const kv = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g;
    let k: RegExpExecArray | null;
    while ((k = kv.exec(m[2]))) {
      const key = k[1]; let val = k[2];
      short[key] = val.startsWith('"') ? val.slice(1, -1).replace(/\\"/g, '"') : Number(val);
    }
    return { id: m[1], short };
  }

  function applyEntryResult(result: any, turn: number): Set<string> {
    const npc = useNpc.getState();
    const createdIds = new Set<string>();
    if (!result) return createdIds;

    // 已占用 id（含本批次新分配），用于防止"新角色复用已有 id 覆盖旧角色"
    const used = new Set(Object.keys(npc.npcs));
    const isReal = (r: any) =>
      !!(r && r.name && r.name !== r.id && (r.realm || r.personality || r.background));
    const nextFreeCId = () => { let n = 1; while (used.has(`C${n}`)) n++; return `C${n}`; };
    // ── 同名去重：name→id（含已有真实角色 + 本批次新建），避免一次生成两个同名 NPC ──
    const nameToId = new Map<string, string>();
    for (const r of Object.values(npc.npcs)) {
      if (isReal(r)) nameToId.set((r.name as string).split('|')[0].trim(), r.id);
    }

    // 本回合即死亡的角色不建档：登场条目里带死亡关键词的 new 直接跳过
    const DEATH_RE = /(死亡|死了|已死|身亡|毙命|丧命|气绝|阵亡|被杀|被击杀|被斩杀|被击毙|被秒杀|被消灭|被摧毁|灰飞烟灭|化为灰烬|当场死|一击毙命|尸体|尸首|断气)/;
    const narrativeNow = lastNarrativeRef.current || '';
    for (const e of result.entries ?? []) {
      if (!e?.id) continue;
      if (e.type === 'new') {
        const skel = parseSkeleton(e.stateCommands ?? '');
        const nameKey = String(e.name ?? skel?.short?.n ?? '').split('|')[0].trim();   // 去掉"|性别"后缀，确保同名能匹配
        // 本回合即死亡：条目自带死亡关键词，或正文里该角色名紧邻死亡描述 → 不建档
        const blob = `${e.name ?? ''} ${e.status ?? ''} ${e.note ?? ''} ${e.stateCommands ?? ''}`;
        const deadInNarr = !!(nameKey && narrativeNow.includes(nameKey) &&
          DEATH_RE.test(narrativeNow.slice(Math.max(0, narrativeNow.indexOf(nameKey) - 40), narrativeNow.indexOf(nameKey) + 80)));
        if (DEATH_RE.test(blob) || deadInNarr) {
          console.warn(`[NPC] 跳过为本回合即死亡的新角色「${nameKey || e.id}」建档`);
          continue;
        }
        // 已存在/本批已建同名真实角色 → 复用其ID当作"重新登场"，不再新建（防重复）
        const dupId = nameKey ? nameToId.get(nameKey) : undefined;
        if (dupId && npc.npcs[dupId]) {
          npc.setScene(dupId, true, turn);
          console.warn(`[NPC] 登场判断出现同名「${nameKey}」，复用已有ID ${dupId}，跳过新建（防重复）`);
          continue;
        }
        let id = skel?.id ?? e.id;
        const exist = npc.npcs[id];
        // 该 id 已被"另一个真实角色"占用，而本条是新角色 → 重新分配空闲 id，避免覆盖
        const sameChar = !!(exist && e.name && exist.name === e.name);
        if (exist && isReal(exist) && !sameChar) {
          const fresh = nextFreeCId();
          console.warn(`[NPC] 登场判断把新角色「${e.name ?? '?'}」分配到已占用ID ${id}（${exist.name}），改用空闲ID ${fresh} 防止覆盖`);
          id = fresh;
        }
        used.add(id);
        if (nameKey) nameToId.set(nameKey, id);   // 登记新建名字，使本批后续同名条目并入此角色
        if (skel) npc.applySkeleton(id, skel.short);
        else npc.upsertNpc(id, { name: e.name ?? id, onScene: true });
        npc.setScene(id, true, turn);
        createdIds.add(id);
      } else {
        // reentry / 已存在
        npc.setScene(e.id, true, turn);
        if (e.name) npc.upsertNpc(e.id, { name: e.name });
        const loc = /loc\.[CG]\d+\s*=\s*([^\n]+)/.exec(e.stateCommands ?? '');
        if (loc) npc.upsertNpc(e.id, { extra: { ...(npc.npcs[e.id]?.extra ?? {}), 位置: loc[1].trim() } });
      }
    }
    for (const x of result.exits ?? []) { if (x?.id) npc.setScene(x.id, false); }
    for (const [id, deed] of Object.entries(result.deedsUpdates ?? {})) {
      if (typeof deed === 'string') npc.appendDeed(id, deed);
      else if (deed && typeof deed === 'object') npc.appendDeed(id, deed as any); // {time,location,description}
    }
    return createdIds;
  }

  async function runEntryJudgment(narrative: string): Promise<{ result: any; createdIds: Set<string> }> {
    const { settings } = useNpcEvo.getState();
    const entryEntries = (settings.entries ?? []).filter((e) => e.enabled && e.source === 'entrySharedRules');
    if (entryEntries.length === 0) {
      console.log('[NPC] 无启用的登场判断条目，跳过登场判断');
      return { result: null, createdIds: new Set() };
    }
    const trimmed = trimNarrative(narrative);
    const systemPrompt = buildEntryPhaseSystemPrompt(settings.entries, trimmed);
    const userContent = `# 本轮正文\n${trimmed}\n\n---\n请按【输出格式】输出登场/退场判断的 JSON object（含 entries/exits/deedsUpdates/globalCommands），不要输出多余文字或 <state>/<upstore> 块。`;
    const reply = await npcChatCompletion(systemPrompt, userContent);
    console.log('[NPC] 登场判断响应:', reply);
    const result = parseEntryJson(reply);
    const createdIds = applyEntryResult(result, turnCountRef.current);
    try { useNpc.getState().dedupeByName(); } catch { /* 合并同名重复角色（防一回合内重复建档）*/ }
    refreshNpcPreferredOwners(createdIds);   // 登场判断完成后刷新物品 owner 重定向目标
    return { result, createdIds };
  }

  /* 刷新物品 owner 重定向优先目标：本轮新建 + 在场真实 NPC（最近优先）*/
  function refreshNpcPreferredOwners(created?: Set<string>) {
    const npcSt = useNpc.getState();
    npcPreferredOwners = [
      ...(created ?? new Set<string>()),
      ...Object.values(npcSt.npcs)
        .filter((r) => r.onScene && isRealNpc(r))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => r.id),
    ];
  }

  /* ─── 策略B 第二段：调度（计算重点演化列表）─── */
  function passFrequency(rec: import('./store/npcStore').NpcRecord, turn: number, sch: import('./store/npcEvoStore').NpcScheduling): boolean {
    const interval = Math.max(1, rec.freqInterval ?? sch.defaultFreqInterval ?? 1);
    // date 模式暂回落到 turn 行为（无稳定游戏日期源）
    const last = rec.lastEvolvedTurn ?? -Infinity;
    return (turn - last) >= interval;
  }

  function computeFocusList(createdIds: Set<string>, turn: number): string[] {
    const { npcs } = useNpc.getState();
    const { scheduling } = useNpcEvo.getState().settings;
    const alive = (n: import('./store/npcStore').NpcRecord) => (scheduling.skipDead === false) || !n.isDead;

    // 手动模式：只推进「手动重点列表」（+本轮新登场，确保新角色至少建档一次）
    if (scheduling.targetMode === 'manual') {
      const ids = new Set<string>([...createdIds, ...(scheduling.manualFocusIds ?? [])]);
      return [...ids].filter((id) => npcs[id] && alive(npcs[id]));
    }

    const must = new Set<string>();
    createdIds.forEach((id) => { if (npcs[id] && alive(npcs[id])) must.add(id); });  // 本轮新建但已死亡的不强塞焦点
    Object.values(npcs).filter((n) => n.onScene && alive(n)).forEach((n) => must.add(n.id));

    const offCands = Object.values(npcs)
      .filter((n) => !n.onScene && alive(n) && !must.has(n.id))
      .filter((n) => passFrequency(n, turn, scheduling))
      .sort((a, b) => {
        const aB = /B1/.test(a.relations) ? 1 : 0;
        const bB = /B1/.test(b.relations) ? 1 : 0;
        if (aB !== bB) return bB - aB;
        return (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0);
      })
      .slice(0, Math.max(0, scheduling.offSceneQuota))
      .map((n) => n.id);

    return [...must, ...offCands];
  }

  /* ─── 策略B 第三段：单 NPC 重点演化 ─── */
  async function runNpcEvolutionForTarget(charId: string, narrative: string, createdIds: Set<string>): Promise<number> {
    const { settings } = useNpcEvo.getState();
    const trimmed = trimNarrative(narrative);
    const systemPrompt = buildNpcPhaseSystemPrompt(settings.entries, trimmed, charId, createdIds);
    const userContent = `# 本轮正文\n${trimmed}\n\n---\n只为角色 ${charId} 输出 <state> 与 <upstore> 指令。无变化输出空标签，禁止输出其他角色的指令，禁止输出正文。`;
    // 失败重试：单条请求失败/超时后额外重试 retryCount 次
    const retries = Math.max(0, settings.scheduling.retryCount ?? 0);
    let reply = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { reply = await npcChatCompletion(systemPrompt, userContent); if (reply) break; }
      catch (e) { if (attempt >= retries) throw e; console.warn(`[NPC] ${charId} 第${attempt + 1}次失败，重试…`); }
    }
    if (!reply) return 0;
    // 单角色作用域：过滤掉越界指令
    const npcCmds = parseAllNpcCommands(reply).filter((c) => c.id === charId);
    applyNpcCommands(npcCmds);
    const charCmds = parseAllCharCommands(reply).filter((c) => c.charId === charId);
    applyCharacterCommands(charCmds);
    const shorts = applyNpcShortCommands(reply, charId);
    useNpc.getState().markEvolved(charId, turnCountRef.current);
    console.log(`[NPC] ${charId} 演化：${npcCmds.length} 档案 / ${charCmds.length} 技能天赋 / ${shorts} 短指令`);
    return npcCmds.length + charCmds.length + shorts;
  }

  // 限并发批处理
  async function runBatched<T>(items: T[], size: number, fn: (it: T, idx: number) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) {
      await Promise.allSettled(items.slice(i, i + size).map((it, k) => fn(it, i + k)));
    }
  }

  /* ─── 策略B 第四段：清理提醒（本地启发式建议）─── */
  function maybeAskCleanup(turn: number) {
    const { scheduling } = useNpcEvo.getState().settings;
    if (!scheduling.cleanupEnabled) return;
    if (turn % Math.max(1, scheduling.cleanupCycle) !== 0) return;
    const { npcs } = useNpc.getState();
    const stale = Object.values(npcs).filter(
      (n) => !n.onScene && !n.isBond && !n.keepForever && !n.isDead
        && (turn - (n.lastSeenTurn ?? 0)) >= scheduling.cleanupCycle * 2,
    );
    if (stale.length > 0) {
      console.log('[NPC] 长期不出场建议清理:', stale.map((n) => `${n.id}(${n.name})`).join(', '));
      setCleanupNpcs(stale.map((n) => ({ id: n.id, name: n.name || n.id })));  // 弹出清理提示框
    }
  }

  /* ─── 策略B：登场判断之后的"调度 + 逐NPC演化" ─── */
  async function runNpcFocusEvolution(narrative: string, createdIds: Set<string>) {
    setNpcPhaseRunning(true);
    try {
      const turn = turnCountRef.current;
      const sched = useNpcEvo.getState().settings.scheduling;
      let focusIds = computeFocusList(createdIds, turn);
      // 每回合最多演化几个（0=不限）
      if ((sched.modelPerTurnLimit ?? 0) > 0) focusIds = focusIds.slice(0, sched.modelPerTurnLimit);
      console.log('[NPC] 重点演化列表:', focusIds.join(', ') || '（空）');
      if (focusIds.length === 0) { setNpcPhaseLog('✓ NPC 演化完成：本轮无目标'); return; }

      let done = 0;
      // 并发数可在 设置→NPC演化→调度 里调；太高会把慢端点打到 524 超时（表现为 CORS 报错）
      const conc = Math.max(1, sched.concurrency || 2);
      await runBatched(focusIds, conc, async (id) => {
        setNpcPhaseLog(`NPC 调度中 ${done + 1}/${focusIds.length}…`);
        try { await runNpcEvolutionForTarget(id, narrative, createdIds); }
        catch (e: any) { console.error(`[NPC] ${id} 演化失败:`, e?.message ?? e); }
        done++;
      });
      setNpcPhaseLog(`✓ NPC 演化完成：${focusIds.length} 个目标`);
      maybeAskCleanup(turn);
    } catch (e: any) {
      console.error('[NPC] 调度演化失败:', e?.message ?? e);
      setNpcPhaseLog(`⚠ NPC 演化失败：${String(e?.message ?? '').slice(0, 60)}`);
    } finally {
      setNpcPhaseRunning(false);
      setTimeout(() => setNpcPhaseLog(''), 8000);
    }
  }

  /* ─── 策略B 总管线（登场判断 → 调度 → 逐NPC，供直接调用）─── */
  async function runNpcPipelineB(narrative: string) {
    setNpcPhaseRunning(true);
    setNpcPhaseLog('NPC 登场判断中…');
    let createdIds = new Set<string>();
    try { createdIds = (await runEntryJudgment(narrative)).createdIds; }
    catch (e: any) { console.error('[NPC] 登场判断失败:', e?.message ?? e); }
    try { applyNarrativeAttrs(narrative); } catch { /* 新建NPC的卡六维 */ }   // 登场建档后照抄
    await runNpcFocusEvolution(narrative, createdIds);
    try { applyNarrativeAttrs(narrative); autoGenMissingAttrs(); } catch { /* 重点演化后：先以正文卡为准覆盖，再给无卡NPC自动生成有起伏六维 */ }
    try { const merged = useNpc.getState().dedupeByName(); if (merged) console.log(`[NPC] 重点演化后合并了 ${merged} 个同名重复角色`); } catch { /* 防重复兜底 */ }
    try { backfillNpcStarterKits(); } catch (e) { console.warn('[NPC] 初始家当发放失败:', e); }   // 码内保证新NPC初次出现就有固定装备+储物
  }

  /* ── NPC 初始家当：码内确定性生成，保证 NPC 初次出现就携带固定数量的装备+储物物品 ──
     不依赖物品阶段时序（其与登场判断并发，新NPC常来不及）；后续增减由物品阶段按"明确入手"规则维护（与主角一致）。 */
  const NPC_KIT_EQUIP_N = 3;     // 初始装备件数
  const NPC_KIT_STORAGE_N = 2;   // 初始储物件数
  /* 给"在场、真实、且尚未发放过家当"的 NPC 由 AI **读其身份/职业/年龄/所处世界后**生成贴合人物的初始装备+储物
     （完整固定格式，与主角同标准）。彻底取代旧的"固定池随机发放"——避免给学生发军刺/战术装备这类离谱情况。
     每个 NPC 仅发一次（kitDone 立即置位防并发重复；无 API 则只标记、不乱发）。 */
  async function backfillNpcStarterKits() {
    const npc = useNpc.getState();
    const M = useMisc.getState();
    const allowEquip = useSettings.getState().allowAutoEquipNpc;
    const targets = Object.values(npc.npcs).filter((r) =>
      !r.isDead && r.onScene && r.name && r.name !== r.id && !r.kitDone && (r.items?.length ?? 0) === 0);
    if (targets.length === 0) return;
    for (const r of targets) npc.upsertNpc(r.id, { kitDone: true });   // 立即标记，防并发/重复发放
    const worldName = M.worldName || '轮回乐园';
    const list = targets.slice(0, 8).map((r) =>
      `${r.id} | 姓名:${r.name} | 性别:${r.gender || '?'} | 阶位等级:${r.realm || '?'} | 身份/职业:${r.profession || r.title || '?'} | 年龄:${r.age || '?'} | 背景:${(r.background || '').replace(/\s+/g, ' ').slice(0, 60)}`,
    ).join('\n');
    const sys = `你是"轮回乐园·NPC 初始物资"生成器。为下列 NPC 各生成**严格贴合其身份/职业/年龄/所处世界**的随身装备与储物。
- **必须先读懂每个 NPC 是什么人，再据此发物**：学生→课本/手机/校服/零食；上班族→公文包/工牌/西装；医生→医疗箱/手术刀/白大褂；士兵/战士→制式武器/战术护甲；街头混混→匕首/香烟；法师→法杖/魔导书；贵族→华服/首饰。**严禁给普通学生、平民、文职这类非战斗人物发军刺、军用武器、战术装备**——那是离谱错误。
- 所处世界=「${worldName}」，物品的风格/科技必须符合该世界（现代/校园/科幻/奇幻/末世等）。
- 每个 NPC 给 ${NPC_KIT_EQUIP_N} 件可穿戴装备 + ${NPC_KIT_STORAGE_N} 件储物。无战斗力的平民：装备位用**日常衣物/便服/制服**充当(category=防具)、武器可省或用日常工具，攻防可低或留空；品质(gradeDesc)按其身份与阶位给(平民多为白/绿色)。
- **完整固定格式、与主角物品同标准、不准偷懒**：每件给 name/category(武器/防具/饰品/消耗品/材料/工具/重要物品/特殊物品/其他物品)/subType(类型细分)/gradeDesc(颜色品质)/combatStat(装备攻防,平民可低/无)/durability(耐久)/requirement(装备需求)/affix(词缀)/score(评分)/effect(效果)/intro(简介)/appearance(**逐部件外观,必填不可空**)；武器另加 killCount。
- equip 每件给 equipSlot：武器→weapon:main，上身→armor:upper，鞋→armor:feet，头→armor:head，饰品→accessory:#1 等。
只输出 JSON：{"kits":[{"npcId":"C1","equip":[{...固定格式字段, "equipSlot":"..."}],"storage":[{...固定格式字段}]}]}`;
    const user = `世界：${worldName}\nNPC 列表：\n${list}\n\n请为每个 NPC 生成贴合其身份的初始装备+储物（完整固定格式，别给学生/平民发军用装备）。`;
    try {
      const reply = await npcChatCompletion(sys, user);
      const j = parseEntryJson(reply);
      const kits = Array.isArray(j?.kits) ? j.kits : [];
      const mkItem = (id: string, it: any) => ({
        id: `I_${id}_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
        name: String(it.name ?? '物品'), category: it.category ?? '其他物品',
        gradeDesc: it.gradeDesc ?? it.grade ?? '白色', effect: it.effect ?? '', quantity: 1, equipped: false,
        equipSlot: it.equipSlot, appearance: it.appearance, acquisition: '初始携带', tags: ['初始'],
        origin: it.origin, subType: it.subType, combatStat: it.combatStat ?? it.attack ?? it.defense,
        durability: it.durability, requirement: it.requirement, affix: it.affix,
        score: it.score != null ? String(it.score) : undefined, intro: it.intro,
        killCount: it.killCount != null ? String(it.killCount) : undefined, addedAt: Date.now(),
      });
      let cnt = 0;
      for (const k of kits) {
        const id = String(k?.npcId ?? '');
        if (!useNpc.getState().npcs[id]) continue;
        for (const e of (Array.isArray(k.equip) ? k.equip : [])) {
          const item = mkItem(id, e); useNpc.getState().addNpcItem(id, item as any);
          if (allowEquip && item.equipSlot) useNpc.getState().equipNpcItem(id, item.id, item.equipSlot);
          cnt++;
        }
        for (const s of (Array.isArray(k.storage) ? k.storage : [])) { useNpc.getState().addNpcItem(id, mkItem(id, s) as any); cnt++; }
      }
      console.log(`[NPC] AI 按身份生成初始家当 ${cnt} 件（${kits.length} 个NPC）`);
    } catch (e: any) { console.warn('[NPC] AI 初始家当生成失败（本轮跳过，后续物品阶段会补）:', e?.message ?? e); }
  }

  /* ─── 策略A 核心：单次合并调用 ─── */
  async function runNpcEvolutionPhaseCoreA(narrative: string) {
    const { settings } = useNpcEvo.getState();
    const enabledEntries = (settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.log('[NPC] 无已启用的预设条目，跳过'); return; }

    setNpcPhaseRunning(true);
    setNpcPhaseLog('NPC 演化阶段处理中…');
    try {
      const trimmed = trimNarrative(narrative);
      const systemPrompt = buildNpcPhaseSystemPrompt(settings.entries, trimmed); // 无 charId → 在场列表
      const userContent  = `# 本轮正文\n${trimmed}\n\n---\n请为正文中出现/相关的 NPC 输出 <state> 与 <upstore> 指令。无变化时输出空标签，禁止输出正文内容。`;
      const reply = await npcChatCompletion(systemPrompt, userContent);
      console.log('[NPC] 原始响应:', reply);
      if (reply) {
        const npcCmds  = parseAllNpcCommands(reply); applyNpcCommands(npcCmds);
        const charCmds = parseAllCharCommands(reply); applyCharacterCommands(charCmds);
        const shorts   = applyNpcShortCommands(reply);
        try { useNpc.getState().dedupeByName(); } catch { /* 防同名重复建档 */ }
        try { backfillNpcStarterKits(); } catch { /* 初始家当 */ }
        try { applyNarrativeAttrs(narrative); autoGenMissingAttrs(); } catch { /* 卡六维优先，无卡则自动生成有起伏六维 */ }
        const total = npcCmds.length + charCmds.length + shorts;
        setNpcPhaseLog(total > 0
          ? `✓ NPC 演化完成：${npcCmds.length} 条档案更新，${charCmds.length} 条技能/天赋指令`
          : '✓ NPC 演化完成：本轮无变化');
      } else {
        setNpcPhaseLog('✓ NPC 演化完成：无输出');
      }
    } catch (e: any) {
      const msg = e.message ?? '未知错误';
      console.error('[NPC] NPC 演化阶段失败:', msg);
      setNpcPhaseLog(`⚠ NPC 演化失败：${msg.slice(0, 60)}`);
    } finally {
      setNpcPhaseRunning(false);
      setTimeout(() => setNpcPhaseLog(''), 8000);
    }
  }

  /* ─── NPC 演化独立阶段（自动，按策略分支 + 频率检查）─── */
  async function runNpcEvolutionPhase(narrative: string) {
    const { settings } = useNpcEvo.getState();
    if (!settings.enabled) { console.log('[NPC] NPC 演化阶段未启用'); return; }

    // 用接口路由链判断（中心 API 接口库选了 NPC 路由也算已配置），不只看 NPC 自己的单配置
    const npcChain = resolveApiChain('npc', getNpcApi());
    if (!npcChain[0]?.baseUrl || !npcChain[0]?.apiKey) {
      console.warn('[NPC] API 未配置（设置→NPC演化→API设置，或综合设置→API 接口库选路由）');
      setNpcPhaseLog('⚠ NPC 演化：API 未配置');
      setTimeout(() => setNpcPhaseLog(''), 5000);
      return;
    }

    if (settings.strategy === 'B') {
      // 策略B：频率由调度层逐目标控制，这里每回合都进入管线
      await runNpcPipelineB(narrative);
    } else {
      const freq = settings.frequency || 1;
      if (turnCountRef.current % freq !== 0) {
        console.log(`[NPC] 回合 ${turnCountRef.current} 不触发（每 ${freq} 回合一次）`);
        return;
      }
      await runNpcEvolutionPhaseCoreA(narrative);
    }
  }

  /* ─── 正文完成后的后续阶段编排 ───
     三阶段**全部并发、互不阻塞**：物品管理绝不等待 NPC 登场判断
     （此前 await 登场判断会让慢/挂起的 NPC API 拖死物品管理）。
     登场判断（较快）通常先于体量巨大的物品阶段完成，并在完成时刷新
     `npcPreferredOwners`，配合 owner 解析器仍能把 NPC 装备挂到正确的 NPC 上。 */
  /* ════════════════════════════════════════════
     生平压缩 / 记忆整理阶段（达阈值时批量压缩 short/long 记忆）
  ════════════════════════════════════════════ */
  async function runMemoryCompressionPhase() {
    const { settings } = useMemory.getState();
    if (!settings.enabled) return;

    const chars = useCharacters.getState().characters;
    const inScope = (id: string) => {
      const isPlayer = /^B\d+$/.test(id);
      const isNpc = /^[CG]\d+$/.test(id);
      if (settings.scope === 'player') return isPlayer;
      if (settings.scope === 'npc') return isNpc;
      return isPlayer || isNpc;
    };
    const overThreshold = (mem?: { shortTerm: MemoryEntry[]; longTerm: MemoryEntry[] }) =>
      !!mem && ((mem.shortTerm?.length ?? 0) >= settings.shortTermThreshold
        || (mem.longTerm?.length ?? 0) >= settings.longTermThreshold);

    const targets = Object.values(chars).filter((c) => inScope(c.id) && overThreshold(c.memory));
    if (targets.length === 0) return;

    // API：生平压缩独立 API（可共用正文 API）
    const memState = useMemory.getState();
    const ss = useSettings.getState();
    const legacyApi = memState.memoryUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : memState.memoryApi;
    const chain = resolveApiChain('memory', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Memory] API 未配置，跳过生平压缩'); return; }

    const npcs = useNpc.getState().npcs;
    const playerBg = usePlayer.getState().profile.background;
    const payload = targets.map((c) => ({
      id: c.id,
      name: /^B\d+$/.test(c.id) ? '主角' : (npcs[c.id]?.name ?? c.id),
      bio: /^B\d+$/.test(c.id) ? playerBg : (npcs[c.id]?.background ?? ''),
      shortTerm: c.memory?.shortTerm ?? [],
      longTerm: c.memory?.longTerm ?? [],
    }));

    const systemPrompt = settings.prompt.replace('${characters_payload}', JSON.stringify(payload, null, 2));
    console.log('[Memory] 生平压缩触发，目标:', targets.map((t) => t.id).join(', '));

    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式】只输出 JSON 对象。' },
      ]);
      console.log('[Memory] 压缩响应:', reply);

      // 提取 JSON object
      const jsonText = (reply.match(/\{[\s\S]*\}/) ?? [''])[0];
      if (!jsonText) { console.warn('[Memory] 未解析到 JSON'); return; }
      const parsed = JSON.parse(jsonText);
      const results = parsed.results ?? {};

      const charStore = useCharacters.getState();
      const npcStore = useNpc.getState();
      for (const [id, r] of Object.entries(results) as [string, any][]) {
        const clamp = (arr: any, keep: number): MemoryEntry[] =>
          (Array.isArray(arr) ? arr : []).slice(0, keep).map((e: any) => ({
            time: String(e?.time ?? ''), location: String(e?.location ?? ''), content: String(e?.content ?? ''),
          })).filter((e: MemoryEntry) => e.content);
        const shortTerm = clamp(r.shortTerm, settings.shortTermKeep);
        const longTerm = clamp(r.longTerm, settings.longTermKeep);
        charStore.setMemory(id, { shortTerm, longTerm });
        if (typeof r.bio === 'string' && r.bio.trim()) {
          if (/^B\d+$/.test(id)) usePlayer.getState().setBackground(r.bio.trim());
          else if (npcStore.npcs[id]) npcStore.upsertNpc(id, { background: r.bio.trim() });
        }
        console.log(`[Memory] ${id} 压缩完成：short ${shortTerm.length} / long ${longTerm.length}`);
      }
    } catch (e: any) {
      console.error('[Memory] 生平压缩失败:', e.message ?? e);
    }
  }

  /* ════════════════════════════════════════════
     杂项演化阶段（分段总结 / 双时间 / 天气 / 世界大事 / 任务）
  ════════════════════════════════════════════ */
  async function runMiscEvolutionPhase(narrative: string) {
    const M = useMisc.getState();
    if (!M.settings.enabled) return;
    const ss = useSettings.getState();
    const legacyApi = M.miscUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : M.miscApi;
    const chain = resolveApiChain('misc', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Misc] API 未配置，跳过杂项演化'); return; }

    const enabledEntries = (M.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Misc] 无启用的预设条目，跳过杂项演化'); return; }
    // 大总结周期：每 largeEvery 个杂项演化回合才产一条大总结（聚合压缩近期小总结），其余回合只出小总结
    const round = M.bumpSummaryRound();
    const largeEvery = Math.max(1, M.settings.largeEvery || 6);
    const isLargeTurn = round % largeEvery === 0;
    const recentSmall = M.smallSummaries.slice(-(largeEvery + 2)).map((s, i) => `${i + 1}. ${s}`).join('\n') || '（暂无小总结）';
    const playerName = usePlayer.getState().profile.name || '主角';
    const tlRow = `${M.worldName || '轮回乐园'} ${M.worldTime || M.paradiseTime || ''}`.trim();
    const systemPrompt = buildMiscSystemPrompt(M.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${user_input}', '')
      .replaceAll('${current_paradise_time}', M.paradiseTime || '（未设定）')
      .replaceAll('${current_world_time}', M.worldTime || '（未设定）')
      .replaceAll('${current_world_name}', M.worldName || '轮回乐园')
      .replaceAll('${weather}', M.weather || '（未设定）')
      .replaceAll('${current_tasks}', serializeTasks(M.tasks))
      .replaceAll('${world_events}', serializeEvents(M.worldEvents))
      .replaceAll('${next_available_task_id}', M.nextTaskId())
      // ── 原版 13 条规则里残留的占位符（无小地图，按需填充/置空）──
      .replaceAll('${current_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${current_location}', M.worldName || '（未设定）')
      .replaceAll('${time_location_row}', tlRow || '（未设定）')
      .replaceAll('${world_map_pois}', '（未启用小地图）')
      .replaceAll('${current_scene_map}', '（未启用小地图）')
      .replaceAll('${world_factors}', '（无）')
      .replaceAll('${player_name}', playerName)
      .replaceAll('${player_traits}', '（略）')
      + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + MISC_HOME_TIME_RULE
      + '\n\n' + MISC_SUMMARY_CADENCE_RULE
      + `\n【本轮大总结开关】：${isLargeTurn ? `是（本轮是第 ${round} 轮，到达大总结周期，必须压缩近期小总结输出 1 条大总结）` : `否（本轮第 ${round} 轮，未到周期，只写小总结，禁止输出大总结）`}`
      + `\n【最近小总结（供大总结压缩参考，仅在开关=是时使用）】：\n${recentSmall}`;

    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式铁律】只输出 <upstore> 指令块。' },
      ]);
      console.log('[Misc] 杂项演化响应:', reply);
      const applied = applyMiscCommands(reply, { allowLarge: isLargeTurn });
      console.log(`[Misc] 杂项演化应用 ${applied} 条指令（第 ${round} 轮，大总结周期：${isLargeTurn ? '是' : '否'}）`);
      // 把本轮小/大总结挂到最近一条 assistant 楼层（供叙事记忆三档注入）；非大总结周期不挂大总结
      const { small, large: largeRaw } = extractTurnSummaries(reply);
      const large = isLargeTurn ? largeRaw : undefined;
      if (small || large) {
        setMessages((ms) => {
          for (let i = ms.length - 1; i >= 0; i--) {
            if (ms[i].role === 'assistant') {
              const next = [...ms];
              next[i] = { ...next[i], ...(small ? { smallSummary: small } : {}), ...(large ? { largeSummary: large } : {}) };
              return next;
            }
          }
          return ms;
        });
      }
    } catch (e: any) {
      console.error('[Misc] 杂项演化失败:', e.message ?? e);
    }
  }

  /* ════════════════════════════════════════════
     领地演化阶段（单一基地，仿杂项演化：单目标 + 独立 API + frequency 门控）
  ════════════════════════════════════════════ */
  function serializeTerritorySnapshot(): string {
    const T = useTerritory.getState();
    if (!T.unlocked) return '（领地尚未开辟。若本回合正文中主角建立/获得了据点/基地/领地，用 unlockTerritory 开辟；name 取正文中该基地的既有称呼或主角为其起的名字，正文未命名则留空 name（待玩家自定义），**不要凭空编一个通用名如“轮回乐园基地/我的领地”**。）';
    const cap = buildingCap(T.level);
    const lines: string[] = [
      `名称：${T.name || '（未命名）'}`,
      `等级：${realmFromLevel(T.level)}·Lv.${T.level}（建设进度 ${T.buildProgress}/100）`,
      `建筑：${T.buildings.length}/${cap} 栋${T.buildings.length ? '——' + T.buildings.map((b) => `${b.name}(Lv.${b.level})`).join('、') : '（无）'}`,
      `领地效果：${T.effects.length ? T.effects.map((e) => e.name).join('、') : '（无）'}`,
      `成员：${T.members.length ? T.members.map((m) => `${m.id}${m.role ? '(' + m.role + ')' : ''}`).join('、') : '（无）'}`,
      `仓库：${T.storageItems.length ? T.storageItems.map((i) => `${i.name}×${i.quantity}`).slice(0, 12).join('、') : '（空）'}`,
      `外观：${T.appearance || '（未描写）'}`,
      `被动产出：${T.passiveOutput || '（无）'}`,
    ];
    return lines.join('\n');
  }

  async function runTerritoryEvolutionPhase(narrative: string) {
    const T = useTerritory.getState();
    if (!T.settings.enabled) return;
    if (turnCountRef.current % (T.settings.frequency || 1) !== 0) return;
    const ss = useSettings.getState();
    const legacyApi = T.territoryUseSharedApi
      ? (ss.textUseSharedApi ? ss.api : ss.textApi)
      : T.territoryApi;
    const chain = resolveApiChain('territory', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Territory] API 未配置，跳过领地演化'); return; }

    const enabledEntries = (T.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Territory] 无启用预设条目，跳过'); return; }

    const npcRecords = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead);
    const onscreenNpcs = npcRecords.filter((r) => r.onScene).length > 0
      ? npcRecords.filter((r) => r.onScene).map((r) => `[${r.id}] ${r.name}（${r.realm || '阶位未知'}）`).join('\n')
      : '（无在场 NPC，addMember 只能用已建档的 C-id）';
    const playerName = usePlayer.getState().profile.name || '主角';

    const systemPrompt = buildTerritorySystemPrompt(T.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${territory_snapshot}', serializeTerritorySnapshot())
      .replaceAll('${onscreen_npcs}', onscreenNpcs)
      .replaceAll('${player_name}', playerName)
      + '\n\n' + NARRATIVE_FIRST_RULE;

    setTerritoryPhaseLog('领地演化中…');
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式铁律】只输出 <upstore> 指令块（必要时附 <state> 块）。' },
      ]);
      console.log('[Territory] 领地演化响应:', reply);
      const applied = applyTerritoryCommands(reply);
      // 被动产出/货币：复用物品指令通道（transferSpiritStones 进钱包）
      const itemCmds = parseAllItemCommands(reply);
      if (itemCmds.length > 0) applyItemCommands(itemCmds);
      console.log(`[Territory] 领地演化应用 ${applied} 条指令`);
      setTerritoryPhaseLog('✓ 领地演化完成');
    } catch (e: any) {
      console.error('[Territory] 领地演化失败:', e.message ?? e);
      setTerritoryPhaseLog(`⚠ 领地演化失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setTerritoryPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     万族演化（cosmos）——宇宙背景层（七乐园/万族/文明/原生世界/神灵/深渊）
     - 独立 API + frequency(默认3)；代码选焦点 + 参与门槛，AI 出 JSON 推演
  ════════════════════════════════════════════ */
  function serializeCosmosSnapshot(focusIds: Set<string>): string {
    const all = useCosmos.getState().entities;
    if (all.length === 0) return '（宇宙棋盘为空，可据正文/设定按需新建实体）';
    const detail = all.filter((e) => focusIds.has(e.id)).map((e) => {
      const bits = [
        `「${e.name}」[${e.category}·优先级${e.priority}]`,
        `状态:${e.status}${e.destroyed ? '(已覆灭)' : ''}`,
        e.rank ? `排名:${e.rank}` : '',
        e.power && `实力:${e.power}`,
        e.territory && `疆域:${e.territory}`,
        e.goal && `动向:${e.goal}`,
        e.towardParadise && `对轮回乐园:${e.towardParadise}`,
        e.relations.length ? `关系:${e.relations.map((r) => `${r.target}(${r.relation})`).join('、')}` : '',
        Object.keys(e.extra).length ? `备注:${Object.entries(e.extra).map(([k, v]) => `${k}:${v}`).join('；')}` : '',
      ].filter(Boolean);
      return '· ' + bits.join('；');
    });
    const others = all.filter((e) => !focusIds.has(e.id)).map((e) => `${e.name}(${e.status})`);
    return `【焦点实体（本轮重点推演）】\n${detail.join('\n') || '（无）'}\n\n【其余实体名录（一般不动，必要时可微调）】\n${others.join('、') || '（无）'}`;
  }

  /* 注入正文的 <万族态势> 块（独立于叙事记忆开关；轮回乐园 + 当前动荡 + 相关 + 不相关采样）*/
  function buildCosmosInjection(): { role: 'system'; content: string }[] {
    const C = useCosmos.getState();
    if (!C.settings.enabled) return [];
    const all = C.entities.filter((e) => e.name);
    if (all.length === 0) return [];
    const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】]/g, '').toLowerCase();
    const nw = norm((useMisc.getState().worldName || '').trim());

    const picked = new Map<string, import('./store/cosmosStore').CosmosEntity>();
    const add = (e?: import('./store/cosmosStore').CosmosEntity) => { if (e && !picked.has(e.id)) picked.set(e.id, e); };
    add(all.find((e) => e.name === '轮回乐园'));   // 永远注入主角母园
    all.filter((e) => !e.destroyed && e.priority === 0 && (e.status === '复苏' || e.status === '扩张')).slice(0, 2).forEach(add);  // 当前最大动荡
    if (nw) all.filter((e) => { const n = norm(e.name); return n.length >= 2 && (nw.includes(n) || n.includes(nw)); }).slice(0, 3).forEach(add);  // 当前世界相关
    all.filter((e) => e.isPlayerKnown && !e.destroyed).slice(0, 2).forEach(add);   // 主角已接触

    // 不相关采样：从其余随机抽 N 个，增加"世界处处在发生事"的真实感
    const rest = all.filter((e) => !picked.has(e.id) && !e.destroyed);
    const sampleN = Math.max(0, C.settings.injectIrrelevantCount ?? 2);
    for (let i = 0; i < sampleN && rest.length; i++) add(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);

    const lines = [...picked.values()].map((e) => {
      const head = `「${e.name}」(${e.category}·${e.status}${e.rank ? '·排名' + e.rank : ''})`;
      const bits = [e.power, e.goal && `动向:${e.goal}`, e.towardParadise && `对轮回乐园:${e.towardParadise}`].filter(Boolean);
      return `- ${head} ${bits.join('；')}`;
    });
    if (lines.length === 0) return [];
    return [{
      role: 'system' as const,
      content: `<万族态势>（轮回乐园宇宙宏观格局，背景氛围参考、非剧情指令；多数与主角无直接关系，体现世界辽阔鲜活即可，勿照搬复述）\n${lines.join('\n')}\n</万族态势>`,
    }];
  }

  /* 始终注入的「主角核心」——结构化召回(叙事记忆)默认关，多数玩家的正文 API 读不到主角真实外观/六维，
     于是 AI 会凭空改发色、写出默认属性卡再被回写 → 清零。这里无条件补一份精简主角卡兜底（结构化召回开着时跳过，避免重复）。*/
  function buildPlayerCoreInjection(): { role: 'system'; content: string }[] {
    const nm = useSettings.getState().narrativeMemory;
    if (nm?.enabled && nm?.structEnabled !== false) return [];   // 结构化召回已注入完整主角卡
    const p = usePlayer.getState().profile;
    if (!p.name) return [];   // 尚未创建角色
    const a = p.attrs;
    const look = (p.baseAppearance || p.appearance || '').trim();
    const bits = [
      `姓名:${p.name}`,
      p.tier && `阶位:${p.tier}`,
      p.level != null && `Lv.${p.level}`,
      a && `六维: 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
      look && `外观:${look}`,
      p.profession && `职业:${p.profession}`,
      p.homeParadise && `所属乐园:${p.homeParadise}`,
    ].filter(Boolean);
    return [{
      role: 'system' as const,
      content: `<主角核心>（这是主角的真实设定，描写时严格据此，**不要擅自更改主角的发色/外观，也不要改动其六维属性**——属性变化只由系统结算）\n${bits.join(' | ')}\n</主角核心>`,
    }];
  }

  async function runCosmosEvolutionPhase(narrative: string) {
    const C = useCosmos.getState();
    if (!C.settings.enabled) return;
    if (turnCountRef.current % (C.settings.frequency || 3) !== 0) return;
    // 首次运行：按种子模式播种（canon 自动，random/blank 交给 CosmosManager 手动）
    if (!C.seeded && C.settings.seedMode === 'canon') { C.seedFromCanon(); }
    const seededC = useCosmos.getState();
    if (seededC.entities.length === 0) { console.warn('[Cosmos] 棋盘为空，跳过（请在万族演化里选种子模式/生成）'); return; }

    const ss = useSettings.getState();
    const legacyApi = seededC.cosmosUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : seededC.cosmosApi;
    const chain = resolveApiChain('cosmos', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Cosmos] API 未配置，跳过万族演化'); return; }
    const enabledEntries = (seededC.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Cosmos] 无启用预设条目，跳过'); return; }

    // 焦点选择：核心(priority0)全选 + 当前世界相关 + 按 lastEvolvedTurn 轮换的次要/边缘，封顶 focusPerTurn
    const all = seededC.entities.filter((e) => !e.destroyed);
    const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】]/g, '').toLowerCase();
    const nw = norm((useMisc.getState().worldName || '').trim());
    const focus = new Map<string, import('./store/cosmosStore').CosmosEntity>();
    all.filter((e) => e.priority === 0).forEach((e) => focus.set(e.id, e));
    if (nw) all.filter((e) => { const n = norm(e.name); return n.length >= 2 && (nw.includes(n) || n.includes(nw)); }).forEach((e) => focus.set(e.id, e));
    const cap = Math.max(3, seededC.settings.focusPerTurn || 8);
    if (focus.size < cap) {
      all.filter((e) => !focus.has(e.id)).sort((a, b) => (a.lastEvolvedTurn || 0) - (b.lastEvolvedTurn || 0))
         .slice(0, cap - focus.size).forEach((e) => focus.set(e.id, e));
    }
    const focusIds = new Set(focus.keys());
    const focusList = [...focus.values()].map((e) => e.name).join('、') || '（无）';

    // 参与门槛
    const profile = usePlayer.getState().profile;
    const turn = turnCountRef.current;
    let unlocked = false;
    const g = seededC.settings.participationGate;
    if (g === 'off') unlocked = false;
    else if (g === 'manual') unlocked = seededC.settings.participationUnlocked;
    else { const auto = (profile.level ?? 1) >= 61 || turn >= 50; unlocked = seededC.settings.participationUnlocked || auto; if (unlocked && !seededC.settings.participationUnlocked) useCosmos.getState().setSettings({ participationUnlocked: true }); }
    const participation = unlocked
      ? '【参与状态】已解锁（中后期）：主角已有资格搅动宇宙格局，可把其世界级战功/重大事件顺着因果反馈到宏观层（需正文有相应分量）。'
      : '【参与状态】未解锁（前期）：主角还没资格影响宏观大势，本轮只推演宇宙自身运转，不要因主角行为去改乐园排行/大阵营态度。';

    const systemPrompt = buildCosmosSystemPrompt(seededC.settings.entries)
      .replaceAll('${cosmos_snapshot}', serializeCosmosSnapshot(focusIds))
      .replaceAll('${story_text}', narrative)
      .replaceAll('${focus_list}', focusList)
      .replaceAll('${player_name}', profile.name || '主角')
      .replaceAll('${player_tier}', `${profile.tier || '一阶'} Lv.${profile.level ?? 1}`)
      .replaceAll('${turn}', String(turn))
      .replaceAll('${participation}', participation);

    setCosmosPhaseLog('万族演化中…');
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '只输出一个 JSON 对象 {"entities":[...],"digest":"..."}，不要任何多余文字。' },
      ], { timeoutMs: 90000 });
      const j = parseEntryJson(reply);
      const arr = Array.isArray(j?.entities) ? j.entities : [];
      let n = 0;
      for (const e of arr) {
        if (!e || !e.name) continue;
        useCosmos.getState().upsertEntity(e);
        useCosmos.getState().markEvolved(String(e.name), turn);
        n++;
      }
      const digest = typeof j?.digest === 'string' ? j.digest : '';
      console.log(`[Cosmos] 万族演化应用 ${n} 个实体变更`, digest);
      setCosmosPhaseLog(digest ? `✓ 万族演化：${digest.slice(0, 40)}` : `✓ 万族演化完成（${n} 项变更）`);
    } catch (e: any) {
      console.error('[Cosmos] 万族演化失败:', e.message ?? e);
      setCosmosPhaseLog(`⚠ 万族演化失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setCosmosPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     冒险团演化阶段（仅主角单一冒险团，仿领地：单目标 + 独立 API + frequency）
  ════════════════════════════════════════════ */
  function serializeTeamSnapshot(): string {
    const T = useTeam.getState();
    if (!T.established) return '（主角尚未建立冒险团。仅当本回合正文明确写出主角"建立/正式组建永久冒险团"时，才用 establishTeam 建团；否则输出空指令、不要创建。）';
    const cap = teamMemberCap(T.rank);
    const a = T.assessment;
    const asLine = a.pending
      ? `考核中：${a.note || ''}（目标阶位 ${a.targetRank || '?'}，状态 ${a.status}）——进入考核世界后 startAssessment，出结果用 resolveAssessment(pass/fail/disband）`
      : (a.status !== 'none' ? `上次考核：${a.status}` : '无');
    return [
      `团名：${T.name || '（未命名）'}${T.disbanded ? '（已解散）' : ''}`,
      `阶位：${T.rank}　团队经验：${T.teamExp}/100　活跃度：${T.activity}/100（晋级需活跃度≥${60}）`,
      `成员：${T.members.length}/${cap}${T.members.length ? '——' + T.members.map((m) => `${m.id}${m.role ? '(' + m.role + ')' : ''}`).join('、') : '（仅团长主角）'}`,
      `团队效果：${T.perks.length ? T.perks.map((p) => p.name).join('、') : '（无）'}`,
      `考核：${asLine}`,
    ].join('\n');
  }

  async function runTeamEvolutionPhase(narrative: string) {
    const T = useTeam.getState();
    if (!T.settings.enabled) return;
    if (turnCountRef.current % (T.settings.frequency || 1) !== 0) return;
    const ss = useSettings.getState();
    const legacyApi = T.teamUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : T.teamApi;
    const chain = resolveApiChain('team', legacyApi);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Team] API 未配置，跳过冒险团演化'); return; }
    const enabledEntries = (T.settings.entries ?? []).filter((e) => e.enabled);
    if (enabledEntries.length === 0) { console.warn('[Team] 无启用预设条目，跳过'); return; }

    const npcRecords = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead);
    const onscreenNpcs = npcRecords.filter((r) => r.onScene).length > 0
      ? npcRecords.filter((r) => r.onScene).map((r) => `[${r.id}] ${r.name}（${r.realm || '阶位未知'}）`).join('\n')
      : '（无在场 NPC，addTeamMember 只能用已建档的 C-id）';
    const systemPrompt = buildTeamSystemPrompt(T.settings.entries)
      .replaceAll('${story_text}', narrative)
      .replaceAll('${team_snapshot}', serializeTeamSnapshot())
      .replaceAll('${onscreen_npcs}', onscreenNpcs)
      .replaceAll('${player_name}', usePlayer.getState().profile.name || '主角')
      + '\n\n' + NARRATIVE_FIRST_RULE;

    setTeamPhaseLog('冒险团演化中…');
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请按【输出格式铁律】只输出 <upstore> 指令块（必要时附 <state> 块）。团队未建立且本轮未明确建团时输出空块。' },
      ]);
      console.log('[Team] 冒险团演化响应:', reply);
      const applied = applyTeamCommands(reply);
      console.log(`[Team] 冒险团演化应用 ${applied} 条指令`);
      setTeamPhaseLog('✓ 冒险团演化完成');
    } catch (e: any) {
      console.error('[Team] 冒险团演化失败:', e.message ?? e);
      setTeamPhaseLog(`⚠ 冒险团演化失败：${(e.message ?? '').slice(0, 50)}`);
    } finally { setTimeout(() => setTeamPhaseLog(''), 8000); }
  }

  /* ════════════════════════════════════════════
     生图·肖像自动化：为在场且无立绘的角色（主角 + NPC）补肖像
     —— 受 imageGen.autoPortrait 开关门控；串行生成，避免打爆服务（尤其 NAI）
  ════════════════════════════════════════════ */
  async function runPortraitPhase() {
    const ig = useImageGen.getState();
    if (!ig.autoPortrait) { console.log('[Portrait] 自动肖像未开启，跳过'); return; }
    const service = ig.portraitService;
    console.log('[Portrait] 自动肖像阶段触发，服务=', service);

    // 目标：在场存活、无 avatar、且有外观线索的 NPC + 无立绘的主角
    type Job = { kind: 'npc' | 'player'; id: string; name: string; fields: any; descForTags: string; imageTags?: string; forceRetag?: boolean; appSig?: string };
    const jobs: Job[] = [];

    const refresh = ig.refreshOnLook;   // 外观(imageTags)变化时刷新已有立绘
    const pf = usePlayer.getState().profile;
    const pfApp = (pf.appearance || '').trim();
    const pfTagsChanged = !!pf.imageTags && pf.imageTags !== pf.avatarTags;            // 列19 生图标签变了
    const pfLookChanged = !!pfApp && pfApp !== (pf.avatarAppearance ?? '').trim();      // 外观文字变了
    const pfNeedNew = !pf.avatar && (pf.imageTags || pf.appearance || pf.profession);
    const pfNeedRefresh = refresh && !!pf.avatar && (pfTagsChanged || pfLookChanged);   // 标签或外观任一变化即刷新立绘
    if (pfNeedNew || pfNeedRefresh) {
      jobs.push({
        kind: 'player', id: 'B1', name: pf.name || '主角',
        fields: { appearance: pf.appearance, baseAppearance: pf.baseAppearance, profession: pf.profession, tier: realmFromLevel(pf.level) },
        descForTags: [pf.baseAppearance, pf.appearance, pf.profession, realmFromLevel(pf.level), pf.background].filter(Boolean).join('，'),
        imageTags: pf.imageTags,
        forceRetag: !!pf.avatar && pfLookChanged && !pfTagsChanged,   // 仅外观文字变(标签没跟着变)→ 重新翻译标签，让新图真的不同
        appSig: pfApp,
      });
    }
    for (const r of Object.values(useNpc.getState().npcs)) {
      if (r.isDead || !r.onScene) continue;
      const needNew = !r.avatar;
      const needRefresh = refresh && !!r.avatar && !!r.imageTags && r.imageTags !== r.avatarTags;
      if (!needNew && !needRefresh) continue;
      const seg = (r.appearance5 || '').split('|');
      const appearance = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
      // 只跳过"只有物品没档案"的空壳（名字=ID）；真实在场 NPC 即使外观稀疏也生成（genPortraitTags 会按 名字/性别/阶位 翻译）
      if ((!appearance && !r.imageTags) && (!r.name || r.name === r.id)) continue;
      const head = (r.realm || '').split('|')[0];
      const lv = /Lv\.?\s*\d+/i.test(r.realm || '') ? lvFromRealm(r.realm) : null;
      const tier = normalizeTier(head || '') || (lv != null ? realmFromLevel(lv) : '');
      jobs.push({
        kind: 'npc', id: r.id, name: r.name,
        fields: { gender: r.gender, age: r.age, appearance, profession: r.profession, tier, npcTag: r.npcTag,
          action: seg[0], attire: seg[1], location: seg[2], figure: seg[3], appearanceDetails: r.appearanceDetail },
        descForTags: [r.name, r.gender, appearance, r.profession, tier, r.npcTag].filter(Boolean).join('，'),
        imageTags: r.imageTags,
      });
    }
    const MAX_PORTRAIT_PER_TURN = 6;
    if (jobs.length > MAX_PORTRAIT_PER_TURN) jobs.length = MAX_PORTRAIT_PER_TURN;   // 本回合限量，余下下回合继续
    if (jobs.length === 0) {
      console.log('[Portrait] 自动肖像：没有需要生成的目标（主角已有立绘 / 在场NPC都已有头像或缺外观线索）');
      setImagePhaseLog('自动肖像：无需生成（都已有图或缺外观）');
      setTimeout(() => setImagePhaseLog(''), 6000);
      return;
    }
    console.log(`[Portrait] 自动肖像：待生成 ${jobs.length} 张 →`, jobs.map((j) => j.name).join('、'));

    setImagePhaseLog(`肖像生成中…（0/${jobs.length}）`);
    let done = 0, ok = 0;
    for (const job of jobs) {
      try {
        // 无英文标签时先用 LLM 翻译（NAI 必须英文才像），存回 imageTags 供复用
        let tags = job.imageTags;
        if (!tags || !tags.trim() || job.forceRetag) {   // 无标签 或 外观文字变了(forceRetag) → (重新)翻译标签
          const gen = await genPortraitTags(job.descForTags);
          if (gen) {
            tags = gen;
            if (job.kind === 'player') usePlayer.getState().setProfile({ imageTags: gen });
            else useNpc.getState().upsertNpc(job.id, { imageTags: gen });
          }
        }
        const prompt = buildPortraitPrompt({ ...job.fields, imageTags: tags });
        const url = await shrinkDataUrl(await generateImage(service, { prompt, negative: ig.portraitNegative, label: `自动肖像 · ${job.name}` }));
        // 记下本次所用 imageTags + 外观文本，供"标签/外观变化时刷新"对比
        if (job.kind === 'player') usePlayer.getState().setProfile({ avatar: url, avatarTags: tags || '', avatarAppearance: job.appSig ?? '' });
        else useNpc.getState().upsertNpc(job.id, { avatar: url, avatarTags: tags || '' });
        ok++;
      } catch (e: any) { console.warn(`[Portrait] ${job.name} 生成失败:`, e.message ?? e); }
      done++;
      setImagePhaseLog(`肖像生成中…（${done}/${jobs.length}）`);
    }
    setImagePhaseLog(ok > 0 ? `✓ 肖像生成完成（${ok}/${jobs.length}）` : `⚠ 肖像生成失败（0/${jobs.length}）`);
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* ════════════════════════════════════════════
     生图·装备自动化：为有外观无图的装备补设定图（主角背包 + NPC 持有物）
     —— 受 autoEquipPlayer / autoEquipNpc 开关门控；串行生成
  ════════════════════════════════════════════ */
  async function runEquipImagePhase() {
    const ig = useImageGen.getState();
    if (!ig.autoEquipPlayer && !ig.autoEquipNpc) return;
    const service = effectiveEquipService(ig);

    type EJob = { run: (url: string) => void; name: string; fields: any; descForTags: string };
    const jobs: EJob[] = [];

    // 只给「装备类」补设定图（武器/防具/饰品/特殊/法宝/功法）；不再要求 appearance（AI 常不填→以前几乎都被跳过）。
    // 已穿戴的优先，且每回合限量（其余下回合继续补），避免一次打爆生图接口。
    const MAX_EQUIP_PER_TURN = 6;
    if (ig.autoEquipPlayer) {
      const items = useItems.getState();
      for (const it of [...items.items].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0))) {
        if (it.image || !isEquippable(it.category)) continue;
        jobs.push({
          name: it.name,
          fields: { name: it.name, category: it.category, gradeDesc: it.gradeDesc, appearance: it.appearance, effect: it.effect },
          descForTags: [it.name, it.category, it.gradeDesc, it.appearance, it.effect].filter(Boolean).join('，'),
          run: (url) => useItems.getState().updateItem(it.id, { image: url }),
        });
      }
    }
    if (ig.autoEquipNpc) {
      const npcState = useNpc.getState();
      for (const r of Object.values(npcState.npcs)) {
        if (r.isDead) continue;
        for (const it of [...(r.items ?? [])].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0))) {
          if ((it as any).image || !isEquippable(it.category)) continue;
          const itemId = it.id;
          jobs.push({
            name: `${r.name}·${it.name}`,
            fields: { name: it.name, category: it.category, gradeDesc: (it as any).gradeDesc, appearance: it.appearance, effect: it.effect, ownerGender: r.gender },
            descForTags: [it.name, it.category, (it as any).gradeDesc, it.appearance, it.effect].filter(Boolean).join('，'),
            run: (url) => useNpc.getState().updateNpcItem?.(r.id, itemId, { image: url }),
          });
        }
      }
    }
    if (jobs.length === 0) return;
    if (jobs.length > MAX_EQUIP_PER_TURN) jobs.length = MAX_EQUIP_PER_TURN;   // 本回合限量，余下下回合继续

    setImagePhaseLog(`装备生图中…（0/${jobs.length}）`);
    let done = 0, ok = 0;
    for (const job of jobs) {
      try {
        // NAI/ComfyUI 标签模型：把中文描述翻成英文 tags；自然语言模型用中文模板
        let prompt = '';
        if (isTagService(service)) prompt = await genEquipTags(job.descForTags);
        if (!prompt) prompt = buildEquipPrompt(job.fields);
        const url = await shrinkDataUrl(await generateImage(service, { prompt, negative: ig.equipNegative, label: `自动装备图 · ${job.name}` }), 768);
        job.run(url); ok++;
      } catch (e: any) { console.warn(`[EquipImage] ${job.name} 生成失败:`, e.message ?? e); }
      done++;
      setImagePhaseLog(`装备生图中…（${done}/${jobs.length}）`);
    }
    setImagePhaseLog(ok > 0 ? `✓ 装备生图完成（${ok}/${jobs.length}）` : `⚠ 装备生图失败（0/${jobs.length}）`);
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* ════════════════════════════════════════════
     生图·正文配图：独立 LLM 抽锚点(<image>/<anchor>/<nsfw_rating>/<prompt>) → 逐张生成 → 按 anchor 插入该楼层
     —— 受 autoStory 开关门控；LLM 走 image_story_llm 路由，配图走 storyService
  ════════════════════════════════════════════ */
  async function runStoryImagePhase(narrative: string, msgId: number) {
    const ig = useImageGen.getState();
    if (!ig.autoStory) return;
    const count = Math.max(1, Math.min(9, ig.storyImageCount || 4));

    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('image_story_llm', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[StoryImg] 正文生图 LLM 未配置（综合设置→生图设置→正文生图→独立 LLM 路由），跳过'); return; }

    // 在场角色外观资料
    const onNpcs = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead && r.onScene);
    const charsFull = onNpcs.length
      ? onNpcs.map((r) => {
          const seg = (r.appearance5 || '').split('|');
          const ap = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
          return `[${r.id}] ${r.name}（${r.gender || '性别未知'}）：${ap || '外观未知'}`;
        }).join('\n')
      : '（无在场 NPC 资料）';
    const M = useMisc.getState();

    const sys = ig.storyTemplate
      .replaceAll('${image_count}', String(count))
      .replaceAll('${onscreen_characters_full}', charsFull)
      .replaceAll('${current_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${current_location}', M.worldName || '（未设定）')
      .replaceAll('${entry_decision_new_characters}', '（见正文）')
      .replaceAll('${story_text}', narrative);

    setImagePhaseLog('正文配图·抽取画面中…');
    let reply = '';
    try {
      const r = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: `请只输出 ${count} 个 <image> 块（含 <anchor>/<nsfw_rating>/<prompt>），不要其它内容。` },
      ]);
      reply = r.content;
    } catch (e: any) {
      console.error('[StoryImg] 抽取失败:', e.message ?? e);
      setImagePhaseLog(`⚠ 正文配图抽取失败：${(e.message ?? '').slice(0, 40)}`);
      setTimeout(() => setImagePhaseLog(''), 8000); return;
    }

    // 解析 <image> 块
    const blocks = reply.match(/<image>[\s\S]*?<\/image>/gi) ?? [];
    const get = (s: string, tag: string) => (s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? '').trim();
    let specs = blocks.map((b) => ({ anchor: get(b, 'anchor'), nsfw: get(b, 'nsfw_rating') || 'sfw', prompt: get(b, 'prompt') })).filter((s) => s.prompt);
    // 兜底①：模型没用 <image> 外层包裹，但给了 <prompt> 块 → 直接抽 prompt
    if (specs.length === 0) {
      const proms = reply.match(/<prompt>[\s\S]*?<\/prompt>/gi) ?? [];
      specs = proms.map((p) => ({ anchor: get(p, 'anchor'), nsfw: 'sfw', prompt: get(p, 'prompt') })).filter((s) => s.prompt);
    }
    if (specs.length === 0) {
      // 打印模型原始回复片段，便于判断是"拒绝"还是"格式没遵守"
      console.warn('[StoryImg] 未解析到有效 <image> 块。模型回复前 200 字：', (reply || '（空回复）').slice(0, 200));
      setImagePhaseLog('⚠ 正文配图：抽取模型未按 <image> 格式输出（可能拒绝NSFW/模型不支持），本轮跳过');
      setTimeout(() => setImagePhaseLog(''), 7000);
      return;
    }

    const size = ig.storySize && ig.storySize !== 'inherit' ? ig.storySize : undefined;
    setImagePhaseLog(`正文配图生成中…（0/${specs.length}）`);
    let done = 0, ok = 0;
    for (const sp of specs) {
      try {
        // 按 NSFW 等级补一个 nsfw tag（忠实正文，仅做强度提示）
        const prompt = sp.nsfw && sp.nsfw !== 'sfw' ? `${sp.prompt}, nsfw` : sp.prompt;
        const url = await generateImage(ig.storyService, { prompt, size });
        const img: StoryImage = { anchor: sp.anchor, url, prompt: sp.prompt, nsfw: sp.nsfw, ts: Date.now() };
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, images: [...(m.images ?? []), img] } : m));
        ok++;
      } catch (e: any) { console.warn('[StoryImg] 生成失败:', e.message ?? e); }
      done++;
      setImagePhaseLog(`正文配图生成中…（${done}/${specs.length}）`);
    }
    setImagePhaseLog(ok > 0 ? `✓ 正文配图完成（${ok}/${specs.length}）` : `⚠ 正文配图失败（0/${specs.length}）`);
    setTimeout(() => setImagePhaseLog(''), 8000);
  }

  /* ════════════════════════════════════════════
     叙事记忆 LLM 两步法（发送前查询改写 / 回复后事实抽取）
  ════════════════════════════════════════════ */
  function getNmApi() {
    const ss = useSettings.getState();
    return ss.nmUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ss.nmApi;
  }
  async function nmChatCompletion(systemPrompt: string, userContent: string, modelId?: string): Promise<string> {
    const chain = resolveApiChain('nm', getNmApi());
    const cfg = useSettings.getState().narrativeMemory;
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      { timeoutMs: Math.max(30, cfg.requestTimeout || 90) * 1000, extra: modelId ? { model: modelId } : undefined },
    );
    return content;
  }
  /* 发送前整理：LLM 改写检索查询 → 返回关键词（让召回找"相关"而非"最新"）*/
  async function narrativeCompile(context: string, candidateTitles: string): Promise<string[]> {
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return [];
    const cfg = useSettings.getState().narrativeMemory;
    const sys = NM_COMPILE_PROMPT.replaceAll('${context}', context).replaceAll('${candidates}', candidateTitles || '（无）');
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.compileModelId || undefined);
      const j = parseEntryJson(reply);
      return Array.isArray(j?.keywords) ? j.keywords.map(String).filter(Boolean) : [];
    } catch (e) { console.warn('[NM] 发送前整理失败:', e); return []; }
  }
  /* 结构化召回·LLM 预测下回合相关 NPC → 返回 id 列表（失败/未开 LLM 回 []）*/
  async function narrativeSelectChars(context: string, candidateTitles: string, maxNpcs: number): Promise<string[]> {
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return [];
    const cfg = useSettings.getState().narrativeMemory;
    const sys = NM_STRUCT_SELECT_PROMPT
      .replaceAll('${context}', context)
      .replaceAll('${candidates}', candidateTitles || '（无）')
      .replaceAll('${max_npcs}', String(maxNpcs));
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.compileModelId || undefined);
      const j = parseEntryJson(reply);
      return Array.isArray(j?.npcs) ? j.npcs.map(String).filter(Boolean) : [];
    } catch (e) { console.warn('[NM] 结构化预测失败:', e); return []; }
  }

  /* 结构化档案召回：主角必含 + 选中 NPC，序列化成 <在场与相关档案> system 块。
     返回 system 消息数组（空数组=不注入）。在 callApi 召回阶段 await 调用。*/
  async function buildStructuredRecall(context: string): Promise<{ role: 'system'; content: string }[]> {
    const cfg = useSettings.getState().narrativeMemory;
    if (cfg.structEnabled === false) return [];   // 仅显式关闭才停；旧存档无此字段时默认开
    const limits: RecallLimits = {
      maxNpcs: Math.max(0, cfg.structMaxNpcs ?? 2),
      maxSkills: Math.max(0, cfg.structMaxSkills ?? 3),
      maxItems: Math.max(0, cfg.structMaxItems ?? 2),
      maxSubProfs: Math.max(0, cfg.structMaxSubProfs ?? 4),
    };
    const chars = useCharacters.getState().characters;
    const npcs = Object.values(useNpc.getState().npcs);

    // ── 主角卡（必含）──
    const profile = usePlayer.getState().profile;
    const game = useGame.getState().player;
    const b1 = chars['B1'];
    const cards: string[] = [
      serializePlayerCard(profile, game, b1?.skills ?? [], b1?.traits ?? [], useItems.getState().items, limits, b1?.titles, b1?.subProfessions, useItems.getState().currency),
    ];

    // ── NPC 选择：LLM 预测（开 LLM 模式）→ 本地在场优先兜底 ──
    if (limits.maxNpcs > 0 && npcs.length > 0) {
      let chosen: import('./store/npcStore').NpcRecord[] = [];
      if (cfg.llmMode) {
        const ids = await narrativeSelectChars(context, buildNpcCandidateTitles(npcs), limits.maxNpcs);
        const byId = new Map(npcs.map((r) => [r.id, r]));
        chosen = ids.map((id) => byId.get(id)).filter((r): r is import('./store/npcStore').NpcRecord => !!r && !r.isDead).slice(0, limits.maxNpcs);
      }
      if (chosen.length === 0) chosen = rankNpcsLocal(npcs, limits.maxNpcs);  // 兜底
      for (const r of chosen) {
        const cd = chars[r.id];
        cards.push(serializeNpcCard(r, cd?.skills ?? [], cd?.traits ?? [], cd?.titles));  // NPC 全量，无上限（副职业仅主角）
      }
    }

    // ── 当前世界势力（按对主角态度绝对值 + 近况排序，限量）──
    const maxFac = Math.max(0, cfg.structMaxFactions ?? 4);
    if (maxFac > 0) {
      const facs = Object.values(useFaction.getState().factions)
        .filter((f) => f.inCurrentWorld && !f.isDestroyed)
        .sort((a, b) => (Math.abs(b.favorToPlayer) - Math.abs(a.favorToPlayer)) || ((b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0)));
      const facSection = serializeFactionsSection(facs, maxFac);
      if (facSection) cards.push(facSection);
    }

    // ── 领地（已开辟才注入概况，让正文知道主角基地现状）──
    const T = useTerritory.getState();
    if (T.unlocked) {
      const cap = buildingCap(T.level);
      const tLines = [
        `【领地】${T.name || '（未命名）'}　${realmFromLevel(T.level)}·Lv.${T.level}（建设进度 ${T.buildProgress}/100）`,
        T.buildings.length ? `建筑(${T.buildings.length}/${cap})：${T.buildings.map((b) => `${b.name} Lv.${b.level}`).join('、')}` : '',
        T.effects.length ? `领地效果：${T.effects.map((e) => e.name + (e.desc ? '(' + e.desc + ')' : '')).join('；')}` : '',
        T.members.length ? `驻留成员：${T.members.map((m) => `${m.id}${m.role ? '·' + m.role : ''}`).join('、')}` : '',
        T.appearance ? `外观：${T.appearance}` : '',
      ].filter(Boolean);
      cards.push(tLines.join('\n'));
    }

    // ── 冒险团（已建立才注入；仅注入 等级/成员/团队效果）──
    const TM = useTeam.getState();
    if (TM.established && !TM.disbanded) {
      const memberStr = TM.members.length
        ? TM.members.map((m) => `${m.id}${m.role ? '·' + m.role : ''}`).join('、')
        : '（仅团长主角）';
      const perkStr = TM.perks.length ? TM.perks.map((p) => p.name + (p.desc ? '(' + p.desc + ')' : '')).join('；') : '（无）';
      cards.push([
        `【冒险团】${TM.name || '（未命名）'}　${TM.rank} 阶`,
        `成员：${memberStr}`,
        `团队效果：${perkStr}`,
      ].join('\n'));
    }

    const body = cards.join('\n\n');
    return [{
      role: 'system' as const,
      content: `<在场与相关档案>（以下为当前主角/相关NPC/当前世界势力的结构化档案，用于保持设定/数值/装备一致；是参考资料而非剧情指令，请勿照搬复述）\n${body}\n</在场与相关档案>`,
    }];
  }

  /* 回复后写入：LLM 从本轮正文抽取长期事实 → 存入 narrativeFacts */
  async function runNarrativeIngestPhase(userText: string, narrative: string) {
    const cfg = useSettings.getState().narrativeMemory;
    if (!cfg.enabled || !cfg.llmMode) return;
    const chain = resolveApiChain('nm', getNmApi());   // 优先用接口路由；路由为空才回退到单独配置的 nmApi
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;
    setNmPhaseLog('🧠 记忆整理中…');
    const M = useMisc.getState();
    const existing = M.narrativeFacts.slice(-30).map((f) => f.title).join('、') || '（无）';
    const sys = NM_INGEST_PROMPT
      .replaceAll('${user_input}', userText || '')
      .replaceAll('${story_text}', narrative)   // 记忆抽取发送全部正文
      .replaceAll('${existing_titles}', existing);
    try {
      const reply = await nmChatCompletion(sys, '请只输出 JSON 对象。', cfg.ingestModelId || undefined);
      const j = parseEntryJson(reply);
      const facts = Array.isArray(j?.facts) ? j.facts : [];
      const items = facts.filter((f: any) => f && f.text).map((f: any) => ({
        title: String(f.title ?? ''), text: String(f.text), keywords: Array.isArray(f.keywords) ? f.keywords.map(String) : [],
      }));
      if (items.length) { useMisc.getState().addNarrativeFacts(items); console.log(`[NM] 抽取 ${items.length} 条长期事实`); }
      setNmPhaseLog(items.length ? `🧠 记忆整理：新增 ${items.length} 条长期事实` : '🧠 记忆整理：本轮无新事实');
      setTimeout(() => setNmPhaseLog(''), 8000);
    } catch (e) { console.warn('[NM] 回复后写入失败:', e); setNmPhaseLog('⚠ 记忆整理失败'); }
  }

  /* ════════════════════════════════════════════
     公共频道（一期·只读）：混合刷新——打开时若过期则刷新 + 手动刷新。
     AI 生成一批虚拟契约者帖子（交易/组队/综合/情报），不接结算。
  ════════════════════════════════════════════ */
  function getChannelApi() {
    const cs = useChannel.getState();
    if (cs.channelUseSharedApi) { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; }
    return cs.channelApi;
  }
  async function refreshChannel(force = false) {
    const C = useChannel.getState();
    if (!C.settings.enabled || C.refreshing) return;
    // 懒刷新：非强制时，已有帖子且距上次刷新不足 staleTurns 回合 → 跳过
    if (!force && C.messages.length > 0 && (turnCountRef.current - C.lastRefreshTurn) < C.settings.staleTurns) return;
    const enabledDefs = CHANNEL_DEFS.filter((d) => C.settings.channels[d.key]);
    if (enabledDefs.length === 0) return;
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Channel] API 未配置（频道刷新跳过）'); return; }

    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const recent = [
      ...M.worldEvents.slice(-5).map((e) => `${e.time} ${e.location} ${e.desc}`),
      ...M.smallSummaries.slice(-3),
    ].filter(Boolean).join('；') || '（暂无）';
    const existing = C.messages.slice(0, 18).map((m) => `[${m.channel}] ${m.authorName}: ${m.content}`).join('\n') || '（暂无）';
    const enabledChannels = enabledDefs.map((d) => `${d.label}(${d.key})`).join('、');
    const enabledKeys = new Set(enabledDefs.map((d) => d.key));
    const sys = buildChannelSystemPrompt(C.settings.entries)
      .replaceAll('${player_name}', prof.name || '主角')
      .replaceAll('${player_tier}', `${prof.tier || realmFromLevel(prof.level)}·Lv.${prof.level}`)
      .replaceAll('${world_name}', M.worldName || '轮回乐园')
      .replaceAll('${world_time}', M.worldTime || M.paradiseTime || '（未设定）')
      .replaceAll('${enabled_channels}', enabledChannels)
      .replaceAll('${recent_events}', recent)
      .replaceAll('${existing_messages}', existing)
      .replaceAll('${message_count}', String(C.settings.genCount))
      + '\n\n【交易出售帖·固定格式铁则】交易频道里 kind="sell" 的出售帖，其 offer 必须按**物品固定格式给全所有属性**，供玩家查看与购买带入：offer={"itemName","category","subType","gradeDesc"(品质色),"origin"(产地),"combatStat"(攻防数值),"durability"(耐久),"requirement"(装备需求),"affix"(词缀),"score"(评分),"effect"(效果),"intro"(简介),"appearance"(逐部件外观),"killCount"(武器杀敌数),"qty","price","currency"}。装备类必给攻防/耐久/装备需求/词缀；消耗品必给效果；**技能书/技能卷轴/知识卷轴/图纸配方/天赋碎片类**必给 subType(类型，如「技能卷轴」「技能书」「知识卷轴」「图纸」「天赋碎片」) + effect(**明确写清学会/获得什么**——技能名及层阶(入门/精通/大师/宗师/极道)、或知识领域、或可制造产品、或天赋名及评级 D~SSS)；**外观一律必填、不准省略或偷懒**（与物品生成同标准）。';

    useChannel.getState().setRefreshing(true);
    try {
      const { content: reply } = await apiChatFallback(chain, [
        { role: 'system', content: sys },
        { role: 'user', content: '请按格式只输出 JSON 对象 {"messages":[...]}。' },
      ]);
      const j = parseEntryJson(reply);
      const arr = Array.isArray(j?.messages) ? j.messages : [];
      const items = arr
        .filter((x: any) => x && x.content && enabledKeys.has(x.channel))
        .map((x: any) => ({
          channel: x.channel,
          authorName: String(x.author ?? x.authorName ?? '某契约者').split('|')[0].trim(),
          authorTier: x.tier ?? x.authorTier,
          authorTag: x.tag ?? x.authorTag,
          kind: x.kind ?? 'chat',
          content: String(x.content),
          offer: x.offer && typeof x.offer === 'object' ? x.offer : undefined,
          recruit: x.recruit && typeof x.recruit === 'object' ? x.recruit : undefined,
          gameTime: M.worldTime || M.paradiseTime || '',
        }));
      if (items.length) useChannel.getState().addMessages(items);
      useChannel.getState().markRefreshed(turnCountRef.current);
      console.log(`[Channel] 刷新生成 ${items.length} 条帖子`);
    } catch (e: any) {
      console.warn('[Channel] 刷新失败:', e?.message ?? e);
    } finally {
      useChannel.getState().setRefreshing(false);
    }
    await solicitQuotes();   // 刷新后顺带为玩家未成交的求购/出售帖补报价
  }

  /* 主角在某频道发言 → 频道 API 生成 1~N 条契约者回复（语气随频道变化、数量不等），与发言一并存入 speak 流（限10条）。系统频道禁止。 */
  async function replyToChannelPost(channel: string, content: string, replyTo?: { authorName: string; content: string }) {
    const C = useChannel.getState();
    if (!C.settings.enabled || channel === 'system' || !content.trim()) return;
    const prof = usePlayer.getState().profile;
    const playerName = prof.name || '主角';
    // 先把主角发言立即上墙（回复随后逐条插到它上方，增加真实感）
    const postId = useChannel.getState().addPlayerSpeak(channel as any, playerName, content.trim(), replyTo?.authorName);
    const M = useMisc.getState();
    const chDef = CHANNEL_DEFS.find((d) => d.key === channel);

    // 频道近期对话（最多 20 条，排除刚发的这条）→ 给 AI 上下文，让回复有延续感、能接住之前回复过主角的人
    const history = useChannel.getState().messages
      .filter((m) => m.channel === channel && m.id !== postId)
      .slice(0, 20)
      .reverse();
    const histText = history.length
      ? history.map((m) => {
          const who = m.byPlayer ? `主角(${playerName})` : `${m.authorName}${m.authorTier ? '·' + m.authorTier : ''}`;
          const rt = m.replyToName ? `（回复@${m.replyToName}）` : '';
          return `${who}${rt}：${String(m.content).slice(0, 120)}`;
        }).join('\n')
      : '（暂无更早的对话）';

    let replies: { authorName: string; authorTier?: string; content: string }[] = [];
    const chain = resolveApiChain('channel', getChannelApi());
    if (chain[0]?.baseUrl && chain[0]?.apiKey) {
      const otherN = 2 + Math.floor(Math.random() * 3);   // 回复某人时，其他人插嘴 2~4 条
      const replyN = 2 + Math.floor(Math.random() * 5);   // 普通发言 2~6 条
      const common = `你是「轮回乐园·公共频道」的回复生成器，模拟【${chDef?.label ?? channel}】频道里其他契约者/土著的真实回复。
- 语气务必**多样**、贴合频道氛围：嘲讽 / 认同 / 赞赏 / 吐槽 / 崇拜 / 抬杠 / 阴阳怪气 / 玩梗整活 / 看热闹 / 话不着边 / 提问 / 泼冷水 等（不止这些，自行发挥），别千篇一律、也别都正面。
- 不同频道风格不同：综合更整活玩梗，战斗更热血/支招，情报更分析推理，世界更见闻闲谈，交易更砍价吐槽，组队更搭话约人。
- 发帖人用游戏化网名（如 夜影剑心 / 量子咸鱼 / 虚空观测者）；贴合当前世界(${M.worldName || '轮回乐园'})与主角阶位强度，别离谱。
- **务必延续上文**：顺着之前的话题接话、可回应之前回复过主角的人，保持对话连贯，别每条都另起炉灶。
- **只输出 JSON**：{"replies":[{"author":"网名","tier":"阶位·Lv（可省）","content":"回复正文"}]}，不要任何多余文字或 markdown。

【该频道近期对话（旧→新，供你延续）】
${histText}`;

      const sys = replyTo
        ? `${common}

【本次场景：主角“回复了某人”】
被回复者：${replyTo.authorName}
${replyTo.authorName} 之前说：「${String(replyTo.content).slice(0, 200)}」
主角(${playerName}·${prof.tier || '一阶'}Lv.${prof.level}) 回复 ${replyTo.authorName}：「${content.trim()}」

要求：
1. **第一条回复必须是「${replyTo.authorName}」本人**，直接回应主角（被当面回复自然要接话，可顺可怼，贴合其身份语气）。
2. 随后 ${otherN} 条是**其他不同契约者**围观插嘴（起哄/认同/抬杠/看热闹等）。
3. 第一条的 author 字段必须正好是「${replyTo.authorName}」。`
        : `${common}

【本次场景：主角发了一条新言】
主角(${playerName}·${prof.tier || '一阶'}Lv.${prof.level}) 说：「${content.trim()}」

要求：生成 ${replyN} 条回复，每条不同发帖人，结合上文自然回应。`;

      try {
        const { content: reply } = await apiChatFallback(chain, [
          { role: 'system', content: sys },
          { role: 'user', content: '只输出 JSON 对象 {"replies":[...]}。' },
        ], { timeoutMs: 60000 });
        const j = parseEntryJson(reply);
        const arr = Array.isArray(j?.replies) ? j.replies : (Array.isArray(j?.messages) ? j.messages : []);
        replies = arr
          .filter((x: any) => x && x.content)
          .map((x: any) => ({ authorName: String(x.author ?? x.authorName ?? '某契约者').split('|')[0].trim(), authorTier: x.tier ?? x.authorTier, content: String(x.content) }));
        // 回复某人时兜底：保证第一条确实是被回复者本人（模型偶尔不遵守）
        if (replyTo && replies.length) replies[0].authorName = replyTo.authorName;
      } catch (e: any) { console.warn('[Channel] 生成回复失败:', e?.message ?? e); }
    }
    // 回复逐条错峰插到主角发言上方（模拟陆续有人回帖，增加真实感）
    for (const r of replies) {
      await new Promise((res) => setTimeout(res, 450 + Math.random() * 700));
      useChannel.getState().addOneSpeakReply(channel as any, r, postId);
    }
  }

  /* 系统商店·补货：AI 生成 20 件商品（价偏高），供「系统商店」购买 */
  async function genShopItems() {
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Shop] 频道 API 未配置'); return []; }
    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const sys = `你是「轮回乐园·系统商店」补货员。一次性生成 **20 件** 待售商品，类别要丰富搭配：消耗品、制式装备(武器/防具/饰品)、技能书/技能卷轴、材料、工具、特殊物品等。
- 贴合当前世界(${M.worldName || '轮回乐园'})与主角阶位(${prof.tier || '一阶'}·Lv.${prof.level})的强度区间；**价格一般偏高**（系统商店溢价，约市场价 1.2~1.8 倍）。
- 每件按物品固定格式给全字段。**只输出 JSON**：{"items":[{"name","category"(武器/防具/饰品/消耗品/材料/工具/特殊物品/重要物品等),"subType","gradeDesc"(品质色:白/绿/蓝/紫/淡金/金/暗金…),"price"(数字),"currency"("乐园币"或"魂币"),"effect","combatStat"(装备攻防如"防御8-8"),"durability","requirement","affix","origin","intro","appearance","qty"(默认1)}]}，共 20 件，不要任何多余文字或 markdown。`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: '只输出 JSON {"items":[…20件…]}。' }], { timeoutMs: 90000 });
      const j = parseEntryJson(content);
      return (Array.isArray(j?.items) ? j.items : []).slice(0, 20);
    } catch (e: any) { console.warn('[Shop] 生成失败:', e?.message ?? e); return []; }
  }

  /* 系统回收·估价：AI 给选中的背包物品逐件报价（回收价约市场 50~80%）*/
  async function genSellQuotes(list: { id: string; name: string; gradeDesc: string; category: string; effect?: string; qty: number }[]) {
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return {};
    const lines = list.map((it) => `${it.id} | ${it.name} | 品质:${it.gradeDesc} | 类型:${it.category} | x${it.qty}${it.effect ? ' | 效果:' + it.effect.slice(0, 40) : ''}`).join('\n');
    const sys = `你是「轮回乐园·系统回收」估价员，为主角要出售的物品逐件给出**回收报价**（系统回收价约市场价 50%~80%，按品质/效果/稀有度/数量估算；品质越高价越高）。
**只输出 JSON**：{"quotes":[{"id":"原样照抄物品id","price":数字,"currency":"乐园币"或"魂币"}]}，每件一条，不要多余文字。

【待估物品】
${lines}`;
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: '只输出 JSON {"quotes":[...]}。' }], { timeoutMs: 60000 });
      const j = parseEntryJson(content);
      const out: Record<string, { price: number; currency: string }> = {};
      (Array.isArray(j?.quotes) ? j.quotes : []).forEach((q: any) => {
        if (q?.id != null) out[String(q.id)] = { price: Math.max(0, Math.round(Number(q.price) || 0)), currency: (q.currency === '魂币' || q.currency === '灵魂钱币') ? '灵魂钱币' : '乐园币' };
      });
      return out;
    } catch (e: any) { console.warn('[Shop] 估价失败:', e?.message ?? e); return {}; }
  }

  /* 为玩家未成交的求购/出售帖生成契约者报价/出价（每条带留言）。成交结算仍由代码确定性处理。*/
  async function solicitQuotes() {
    const C = useChannel.getState();
    if (!C.settings.enabled) return;
    const open = C.messages.filter((m) => m.byPlayer && !m.fulfilled && (m.kind === 'buy' || m.kind === 'sell') && (m.quotes?.length ?? 0) < 4);
    if (open.length === 0) return;
    const chain = resolveApiChain('channel', getChannelApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) return;
    const prof = usePlayer.getState().profile;
    const M = useMisc.getState();
    const sys = buildChannelSystemPrompt(C.settings.entries)
      .replaceAll('${player_name}', prof.name || '主角')
      .replaceAll('${player_tier}', `${prof.tier || realmFromLevel(prof.level)}·Lv.${prof.level}`)
      .replaceAll('${world_name}', M.worldName || '轮回乐园')
      .replaceAll('${world_time}', M.worldTime || M.paradiseTime || '')
      .replaceAll('${enabled_channels}', '交易').replaceAll('${recent_events}', '').replaceAll('${existing_messages}', '').replaceAll('${message_count}', '0')
      + '\n\n【报价生成铁则】针对玩家在交易频道挂的求购/出售帖，扮演多位**不同**契约者给出报价/出价，每条务必：① 价格贴合该物品的颜色品质定价与玩家预算（有人急出压价、有人坐地起价、有人给替代品/附赠）；② **求购帖里你是卖家**（报价把东西卖给玩家），**出售帖里你是买家**（出价收购玩家的东西）；③ 必带一句符合该契约者身份口吻的【留言】（可砍价/吹嘘/吐槽/玩梗/讲价由头）。货币用 乐园币 或 灵魂钱币。\n④ **求购帖的卖家报价：必须按固定格式给出所提供物品的完整属性**——名称/产地(origin)/品质色(gradeDesc)/类型(category+subType)/攻防(combatStat)/耐久(durability)/装备需求(requirement)/词缀(affix)/评分(score)/效果(effect)/简介(intro)/外观(appearance)，武器另加杀敌数(killCount)；**若是技能书/技能卷轴/知识卷轴/图纸/天赋碎片**，subType 写明类型、effect 明确写学会/获得什么（技能名+层阶 / 知识领域 / 可制造产品 / 天赋名+评级）；**一个都不能省略、不准偷懒**（与物品生成同标准）。出售帖你是买家、出价即可，不必重复物品属性。';
    const postsDesc = open.map((m) => {
      const o = m.offer ?? {};
      const base = `「${o.itemName}」${o.gradeDesc ? `(${o.gradeDesc})` : ''}${o.qty && o.qty > 1 ? ` ×${o.qty}` : ''}`;
      return m.kind === 'buy'
        ? `${m.id} 求购：玩家想买 ${base}，预算 ${o.price || '面议'} ${o.currency || '乐园币'}；玩家留言：${o.note || '无'}`
        : `${m.id} 出售：玩家想卖 ${base}，期望 ${o.price || '面议'} ${o.currency || '乐园币'}；玩家留言：${o.note || '无'}`;
    }).join('\n');
    const user = `玩家挂出的帖子如下，请为每个帖子生成 2~4 条报价/出价：\n${postsDesc}\n\n只输出 JSON：{"quotes":[{"postId":"<帖子号如 M_5>","fromName":"昵称","fromTier":"三阶·Lv.25","fromTag":"契约者","itemName":"(求购帖填你提供的物品名，出售帖填玩家那件物品名)","gradeDesc":"品质色","category":"分类","subType":"类型细分","origin":"产地","combatStat":"攻防数值","durability":"耐久","requirement":"装备需求","affix":"词缀","score":"评分","effect":"效果","intro":"简介","appearance":"逐部件外观","killCount":"杀敌数(武器)","qty":1,"price":数字,"currency":"乐园币","note":"留言"}]}（求购帖的卖家报价务必填全 origin/subType/combatStat/durability/requirement/affix/score/effect/intro/appearance 等固定格式字段；出售帖的买家出价可只给 price/currency/note）`;
    useChannel.getState().setRefreshing(true);
    try {
      const { content } = await apiChatFallback(chain, [{ role: 'system', content: sys }, { role: 'user', content: user }]);
      const j = parseEntryJson(content);
      const arr = Array.isArray(j?.quotes) ? j.quotes : [];
      const byPost: Record<string, any[]> = {};
      for (const q of arr) { const pid = String(q?.postId ?? ''); if (pid && q?.price != null) (byPost[pid] ??= []).push(q); }
      let total = 0;
      const live = useChannel.getState().messages;
      for (const [pid, qs] of Object.entries(byPost)) {
        if (!live.some((m) => m.id === pid)) continue;
        useChannel.getState().addQuotes(pid, qs.map((q) => ({
          fromName: String(q.fromName ?? '某契约者').split('|')[0].trim(),
          fromTier: q.fromTier, fromTag: q.fromTag,
          itemName: q.itemName, category: q.category, gradeDesc: q.gradeDesc, qty: Number(q.qty) || 1,
          price: Number(q.price) || 0, currency: q.currency || '乐园币', note: q.note,
          // 固定格式完整字段（卖家报价的物品属性，供详情展示 + 购买带入）
          origin: q.origin, subType: q.subType, combatStat: q.combatStat, durability: q.durability,
          requirement: q.requirement, affix: q.affix, score: q.score != null ? String(q.score) : undefined,
          effect: q.effect, intro: q.intro, appearance: q.appearance,
          killCount: q.killCount != null ? String(q.killCount) : undefined,
        })));
        total += qs.length;
      }
      console.log(`[Channel] 为 ${Object.keys(byPost).length} 个玩家帖生成 ${total} 条报价`);
    } catch (e: any) { console.warn('[Channel] 报价生成失败:', e?.message ?? e); }
    finally { useChannel.getState().setRefreshing(false); }
  }

  /* ════════════════════════════════════════════
     势力演化（仿 NPC：当前世界=在场 / 非当前世界=离场；独立API；策略A/B）
  ════════════════════════════════════════════ */
  function getFactionApi() {
    const fs = useFactionEvo.getState();
    if (fs.factionUseSharedApi) { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; }
    return fs.factionApi;
  }
  async function factionChatCompletion(systemPrompt: string, userContent: string): Promise<string> {
    const chain = resolveApiChain('faction', getFactionApi());
    const cfg = useFactionEvo.getState().settings.scheduling;
    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      { timeoutMs: Math.max(30, cfg.requestTimeout || 90) * 1000 },
    );
    return content;
  }
  /* 势力短指令：faction.F1.favorToPlayer = N / faction.F1.status = "战争中" / faction.F1.inCurrentWorld = true */
  function applyFactionShortCommands(reply: string, onlyId?: string): number {
    const fac = useFaction.getState(); let n = 0; let m: RegExpExecArray | null;
    const ok = (id: string) => !onlyId || id === onlyId;
    const numRe = /\bfaction\.(F\d+)\.favorToPlayer\s*(=|\+=|-=)\s*(-?\d+)/g;
    while ((m = numRe.exec(reply))) { if (!ok(m[1])) continue; const cur = fac.factions[m[1]]?.favorToPlayer ?? 0; const v = Number(m[3]); fac.upsertFaction(m[1], { favorToPlayer: m[2] === '=' ? v : m[2] === '+=' ? cur + v : cur - v }); n++; }
    const boolRe = /\bfaction\.(F\d+)\.inCurrentWorld\s*=\s*(true|false)/g;
    while ((m = boolRe.exec(reply))) { if (!ok(m[1])) continue; fac.setWorld(m[1], m[2] === 'true', turnCountRef.current); n++; }
    const strFields = ['status', 'goal', 'territory', 'leader', 'resources', 'scale', 'powerLevel', 'type', 'relations'];
    for (const f of strFields) {
      const re = new RegExp(`\\bfaction\\.(F\\d+)\\.${f}\\s*=\\s*"([^"]*)"`, 'g');
      while ((m = re.exec(reply))) { if (ok(m[1])) { fac.upsertFaction(m[1], { [f]: m[2] } as any); n++; } }
    }
    return n;
  }
  /* 势力快照（重点演化注入） */
  function serializeFactionSnapshot(r: import('./store/factionStore').FactionRecord): string {
    return [
      `势力ID: ${r.id}`, `名称: ${r.name}`, r.type && `类型: ${r.type}`,
      `所在: ${r.inCurrentWorld ? '当前世界' : '非当前世界'}${r.worldName ? `(${r.worldName})` : ''}`,
      r.scale && `规模: ${r.scale}`, r.powerLevel && `实力: ${r.powerLevel}`, r.territory && `地盘: ${r.territory}`,
      r.leader && `首领: ${r.leader}`, r.members && `核心成员: ${r.members}`, r.relations && `势力关系: ${r.relations}`,
      `对主角态度: ${r.favorToPlayer}`, r.goal && `当前目标: ${r.goal}`, r.resources && `资源: ${r.resources}`,
      `状态: ${r.status}`, r.assets && `产业: ${r.assets}`, r.background && `背景: ${r.background}`,
    ].filter(Boolean).join('\n');
  }
  /* 当前世界势力 + 非当前世界配额，计算 focus 列表 */
  function computeFactionFocus(): string[] {
    const { scheduling } = useFactionEvo.getState().settings;
    const all = Object.values(useFaction.getState().factions).filter((f) => !f.isDestroyed);
    if (scheduling.targetMode === 'manual') return scheduling.manualFocusIds.filter((id) => useFaction.getState().factions[id]);
    const cur = all.filter((f) => f.inCurrentWorld).map((f) => f.id);
    const off = all.filter((f) => !f.inCurrentWorld)
      .sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0))
      .slice(0, Math.max(0, scheduling.offWorldQuota)).map((f) => f.id);
    let focus = [...cur, ...off];
    const lim = scheduling.modelPerTurnLimit;
    if (lim > 0) focus = focus.slice(0, lim);
    return focus;
  }
  /* 策略B 第一段：当前世界判断 */
  async function runFactionWorldJudgment(narrative: string) {
    const { entries } = useFactionEvo.getState().settings;
    const sys = buildFactionEntryPrompt(entries) + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + FACTION_HOME_EXIT_RULE + '\n' + FACTION_WORLD_RULE + '\n' + FACTION_FULL_FORMAT_RULE + '\n' + FACTION_NAME_RULE;
    const facStore = useFaction.getState();
    const list = Object.values(facStore.factions);
    const known = list.map((f) => `${f.id}(${f.name})${f.worldName ? '·所属世界:' + f.worldName : ''}${f.inCurrentWorld ? '·当前世界' : '·非当前世界'}`).join(', ') || '（无）';
    const cNums = list.map((f) => f.id.match(/^F(\d+)$/)?.[1]).filter(Boolean).map(Number);
    const nextId = `F${cNums.length ? Math.max(...cNums) + 1 : 1}`;
    const M = useMisc.getState();
    const user = `# 本轮正文\n${trimNarrative(narrative)}\n\n当前世界: ${M.worldName || '轮回乐园'}\n已知势力: ${known}\n下一个可用势力ID: ${nextId}\n\n请判断本世界出现/相关的势力：新势力建档(type:new)、已知势力重新活跃(type:reentry)、离开本世界(exits)。只输出 JSON：{"entries":[{"id":"F1","type":"new|reentry","name":"…","stateCommands":"faction.F1.type=\\"…\\""}],"exits":[{"id":"F2"}]}`;
    const reply = await factionChatCompletion(sys || '你判断当前世界有哪些势力。', user);
    const j = parseEntryJson(reply); if (!j) return;
    const used = new Set(Object.keys(facStore.factions));
    const nextFree = () => { let n = 1; while (used.has(`F${n}`)) n++; return `F${n}`; };
    for (const e of j.entries ?? []) {
      if (!e?.id) continue;
      let id = e.id;
      const exist = facStore.factions[id];
      const sameName = exist && e.name && exist.name === e.name;
      if (e.type === 'new' && exist && exist.name && exist.name !== exist.id && !sameName) { id = nextFree(); }
      // 同名去重
      const dup = Object.values(facStore.factions).find((f) => f.name && f.name === e.name && f.id !== id);
      if (e.type === 'new' && dup) { facStore.setWorld(dup.id, true, turnCountRef.current); used.add(dup.id); continue; }
      used.add(id);
      facStore.upsertFaction(id, { name: e.name ?? id, inCurrentWorld: true });
      facStore.setWorld(id, true, turnCountRef.current);
      if (e.stateCommands) applyFactionShortCommands(String(e.stateCommands), id);
    }
    for (const x of j.exits ?? []) { if (x?.id) facStore.setWorld(x.id, false); }
  }
  /* 策略B 第二段：逐势力重点演化 */
  async function runFactionFocusEvolution(narrative: string) {
    const focus = computeFactionFocus();
    if (focus.length === 0) return;
    const { entries, scheduling } = useFactionEvo.getState().settings;
    const sysBase = buildFactionSystemPrompt(entries) + '\n\n' + NARRATIVE_FIRST_RULE + '\n' + FACTION_WORLD_RULE + '\n' + FIRST_UPDATE_COMPLETE_RULE + '\n' + FACTION_FULL_FORMAT_RULE + '\n' + FACTION_NAME_RULE;
    const trimmed = trimNarrative(narrative);
    const conc = Math.max(1, scheduling.concurrency || 2);
    for (let i = 0; i < focus.length; i += conc) {
      const batch = focus.slice(i, i + conc);
      await Promise.all(batch.map(async (id) => {
        const rec = useFaction.getState().factions[id]; if (!rec) return;
        const sys = `${sysBase}\n\n【目标势力当前档案（只补全+增量更新，勿重造）】\n${serializeFactionSnapshot(rec)}`;
        const user = `# 本轮正文\n${trimmed}\n\n只为势力 ${id}(${rec.name}) 输出 <upstore> 的 addFaction("${id}",{…}) 或 <state> 的 faction.${id}.* 短指令。无变化输出空。`;
        try {
          const reply = await factionChatCompletion(sys, user);
          if (reply) {
            applyFactionCommands(parseAllFactionCommands(reply).filter((c) => c.id === id));
            applyCharacterCommands(parseAllCharCommands(reply).filter((c) => c.charId === id));  // addDeed("F1",…)
            applyFactionShortCommands(reply, id);
            useFaction.getState().markEvolved(id, turnCountRef.current);
          }
        } catch (e: any) { console.warn(`[Faction] ${id} 演化失败:`, e?.message ?? e); }
      }));
    }
  }
  /* 策略A：单次合并 */
  async function runFactionStrategyA(narrative: string) {
    const { entries } = useFactionEvo.getState().settings;
    const sys = entries.filter((e) => e.enabled).map((e) => e.content).join('\n\n');
    if (!sys) return;
    const list = Object.values(useFaction.getState().factions);
    const known = list.map((f) => `${f.id}(${f.name})${f.inCurrentWorld ? '·当前世界' : '·非'}`).join(', ') || '（无）';
    const user = `# 本轮正文\n${trimNarrative(narrative)}\n已知势力: ${known}\n请为正文相关势力输出 addFaction()/deFaction()/faction.* 指令，无变化输出空。`;
    const reply = await factionChatCompletion(sys, user);
    if (reply) {
      applyFactionCommands(parseAllFactionCommands(reply));
      applyCharacterCommands(parseAllCharCommands(reply).filter((c) => /^F\d+$/.test(c.charId)));
      applyFactionShortCommands(reply);
    }
  }
  async function runFactionEvolutionPhase(narrative: string) {
    const { settings } = useFactionEvo.getState();
    if (!settings.enabled) return;
    // 用接口路由链判断（中心 API 接口库选了势力路由也算已配置），而不是只看势力自己的单配置
    const chain = resolveApiChain('faction', getFactionApi());
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) { console.warn('[Faction] API 未配置（设置→势力演化→API，或综合设置→API 接口库选路由）'); return; }
    setFactionPhaseLog('势力演化中…');
    try {
      if (settings.strategy === 'B') { await runFactionWorldJudgment(narrative); await runFactionFocusEvolution(narrative); }
      else { if (turnCountRef.current % (settings.frequency || 1) === 0) await runFactionStrategyA(narrative); }
      setFactionPhaseLog('✓ 势力演化完成');
    } catch (e: any) { setFactionPhaseLog(`⚠ 势力演化失败：${(e.message ?? '').slice(0, 50)}`); }
    finally { setTimeout(() => setFactionPhaseLog(''), 8000); }
  }

  /* 直接从正文「人物信息卡」抽取六维并写入对应角色（主角/已建档NPC，按名字匹配）。
     解决"正文卡里写了六维但演化没照抄/漏项导致属性与正文不一致"。 */
  function applyNarrativeAttrs(narrative: string) {
    // 名称/姓名…(窗口内)…六维[属性]: 力X[｜| ]敏Y…幸C —— 容忍"姓名/名称"、"六维属性："、全角｜、空格、冒号
    const re = /(?:名称|姓名)\s*[:：]\s*([^\n（(｜|]{1,20})[\s\S]{0,320}?六维[^力\n]{0,8}?力[量]?\s*[:：]?\s*(\d{1,3})[^敏\n]{0,6}?敏[捷]?\s*[:：]?\s*(\d{1,3})[^体\n]{0,6}?体[质]?\s*[:：]?\s*(\d{1,3})[^智\n]{0,6}?智[力]?\s*[:：]?\s*(\d{1,3})[^魅\n]{0,6}?魅[力]?\s*[:：]?\s*(\d{1,3})[^幸\n]{0,6}?幸[运]?\s*[:：]?\s*(\d{1,3})/g;
    let m: RegExpExecArray | null; let applied = 0;
    const npc = useNpc.getState();
    const P = usePlayer.getState();
    const pName = P.profile.name?.trim();
    while ((m = re.exec(narrative)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      const attrs = { str: +m[2], agi: +m[3], con: +m[4], int: +m[5], cha: +m[6], luck: +m[7] };
      // 主角？仅当主角六维仍是未分配的默认(全5)时才用正文卡填充；已分配过(创建/加点)就不让正文卡覆盖，
      // 避免"创建时加好的点、进世界被 AI 卡写回 5"的清零 bug（主角属性以创建+主角演化 character.B1.attrs 为准）。
      if (pName && (name === pName || name.includes(pName) || pName.includes(name))) {
        const c = P.profile.attrs;
        const untouched = !c || (c.str === 5 && c.agi === 5 && c.con === 5 && c.int === 5 && c.cha === 5 && c.luck === 5);
        if (untouched) { P.setProfile({ attrs }); applied++; }
        continue;
      }
      // 已建档 NPC（按名字匹配；卡名常含前缀如"灰烬拾荒者·卡尔"，做包含匹配，名字≥2字防误配）
      const rec = Object.values(npc.npcs).find((r) => {
        const rn = r.name?.trim();
        return rn && rn !== r.id && rn.length >= 2 && (rn === name || name.includes(rn) || rn.includes(name));
      });
      if (rec) { npc.upsertNpc(rec.id, { attrs }); applied++; }
    }
    if (applied > 0) console.log(`[Attr] 从正文人物卡照抄六维：${applied} 个角色`);
  }

  /* 从正文抽取主角「当前HP：X/Y」「当前EP/MP：X/Y」并写入 gameStore（取最后一次=最新状态）。
     解决"正文说 HP 恢复到 145/160、侧栏 HP 却没变"——AI 漏输出 hp.B1 时用正文显式数值兜底。仅认带"当前"的状态行，避免误抓 NPC 卡。 */
  function applyNarrativeVitals(narrative: string) {
    const g = useGame.getState();
    const grabLast = (src: string): [number, number] | null => {
      const r = new RegExp(src, 'gi'); let m: RegExpExecArray | null, last: [number, number] | null = null;
      while ((m = r.exec(narrative)) !== null) last = [Number(m[1]), Number(m[2])];
      return last;
    };
    const hp = grabLast('当前\\s*(?:HP|血量|生命值?)\\s*[:：]\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})');
    if (hp && hp[1] >= 0 && hp[2] > 0) { g.setPlayerField('maxHp', hp[2]); g.setPlayerField('hp', Math.min(hp[0], hp[2])); }
    const ep = grabLast('当前\\s*(?:EP|MP|蓝量|法力|能量|精力)\\s*[:：]\\s*(\\d{1,7})\\s*/\\s*(\\d{1,7})');
    if (ep && ep[1] >= 0 && ep[2] > 0) { g.setPlayerField('maxMp', ep[2]); g.setPlayerField('mp', Math.min(ep[0], ep[2])); }
    if (hp || ep) console.log(`[Vitals] 正文照抄主角 ${hp ? `HP ${hp[0]}/${hp[1]}` : ''} ${ep ? `EP ${ep[0]}/${ep[1]}` : ''}`);
  }

  /* 无信息卡时，按阶位预算自动生成【有起伏】的六维（一主一次三低，非平均），替代"全5"默认 */
  const TIER_ATTR: Record<number, { min: number; max: number; budget: number; luckMax: number }> = {
    1: { min: 5, max: 20, budget: 55, luckMax: 2 },
    2: { min: 18, max: 50, budget: 150, luckMax: 3 },
    3: { min: 45, max: 80, budget: 300, luckMax: 4 },
    4: { min: 75, max: 149, budget: 510, luckMax: 5 },
    5: { min: 110, max: 220, budget: 760, luckMax: 6 },
    6: { min: 180, max: 360, budget: 1250, luckMax: 8 },
    7: { min: 300, max: 600, budget: 2000, luckMax: 10 },
    8: { min: 480, max: 950, budget: 3200, luckMax: 12 },
    9: { min: 750, max: 1500, budget: 5000, luckMax: 15 },
  };
  function parseTierNum(realm?: string): number {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const m = /([一二三四五六七八九])阶/.exec(realm ?? '');
    if (m) return map[m[1]];
    if (/无上|巅峰至强/.test(realm ?? '')) return 9;
    if (/至强|绝强/.test(realm ?? '')) return 9;
    return 1;
  }
  /* 按职业（从正文写入的 profession/realm 身份）判定主副属性排序，对齐框架【职业主属性排序】 */
  function professionOrder(text?: string): string[] | null {
    const p = text ?? '';
    if (/战士|骑士|武者|剑|斗士|战|拳|武僧|蛮|狂战/.test(p)) return ['str', 'con', 'agi', 'cha', 'int'];
    if (/刺客|游侠|盗|猎|弓|潜|斥候|杀手|忍|飞贼|枪手|射手/.test(p)) return ['agi', 'str', 'con', 'cha', 'int'];
    if (/坦克|守护|盾|护卫|卫兵|肉盾|重装/.test(p)) return ['con', 'str', 'agi', 'cha', 'int'];
    if (/法师|术士|学者|巫|咒|魔导|奥术|秘法|工程|黑客|医师|药剂/.test(p)) return ['int', 'cha', 'agi', 'con', 'str'];
    if (/牧师|圣职|祭司|医|治疗|辅助|支援|召唤|吟游|歌|圣骑/.test(p)) return ['cha', 'int', 'con', 'agi', 'str'];
    if (/领袖|统御|首领|王|领主|队长|头目|教主|主教|社交|谈判|商人/.test(p)) return ['cha', 'con', 'int', 'str', 'agi'];
    return null;
  }
  /* realm/bioStrength（含 T0~T9 模板）→ 模板档（越高越特化/越强）；无则按阶位估 */
  function templateNum(realm?: string, bio?: string): number {
    const m = /[Tt]\s*(\d)/.exec(bio ?? '') ?? /[Tt]\s*(\d)/.exec(realm ?? '');
    if (m) return Number(m[1]);
    return Math.min(6, Math.max(0, parseTierNum(realm) - 1));   // 一阶≈T0、二阶≈T1…
  }
  function genVariedAttrs(realm?: string, profession?: string, bio?: string) {
    const t = TIER_ATTR[parseTierNum(realm)] ?? TIER_ATTR[1];
    const tpl = templateNum(realm, bio);                       // 0~9，越高越特化
    const keys = ['str', 'agi', 'con', 'int', 'cha'];
    // 主副排序：优先职业，其次身份(realm里的身份段)，都没有则随机
    const order = professionOrder(profession) ?? professionOrder(realm) ?? [...keys].sort(() => Math.random() - 0.5);
    const spec = 1.7 + tpl * 0.12 + Math.random() * 0.5;       // 主属性权重随模板档提高（越强越偏科）
    const w: Record<string, number> = {};
    w[order[0]] = spec;
    w[order[1]] = 1.1 + tpl * 0.05 + Math.random() * 0.4;
    w[order[2]] = 0.7 + Math.random() * 0.35;
    w[order[3]] = 0.55 + Math.random() * 0.3;
    w[order[4]] = 0.45 + Math.random() * 0.25;
    const wsum = keys.reduce((s, k) => s + w[k], 0);
    // 低模板(T0/T1杂兵)只用部分预算，整体更弱；高模板用满
    const budget = t.budget * (tpl <= 1 ? 0.55 + tpl * 0.15 : Math.min(1, 0.78 + tpl * 0.04));
    const attrs: Record<string, number> = {};
    for (const k of keys) attrs[k] = Math.max(t.min, Math.min(t.max, Math.round((budget * w[k]) / wsum)));
    attrs.luck = Math.floor(Math.random() * Math.random() * (t.luckMax + 1));
    return attrs as { str: number; agi: number; con: number; int: number; cha: number; luck: number };
  }
  /* 给在场、缺六维（或五项全等=平均默认）的 NPC 自动生成有起伏的六维 */
  function autoGenMissingAttrs() {
    const npc = useNpc.getState(); let n = 0;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead) continue;
      const a = r.attrs;
      const isDefault = !!a && a.str === 5 && a.agi === 5 && a.con === 5 && a.int === 5 && a.cha === 5; // 恰好默认 5/5/5/5/5
      if (!a || isDefault) { npc.upsertNpc(r.id, { attrs: genVariedAttrs(r.realm, r.profession, r.bioStrength) }); n++; }
    }
    if (n > 0) console.log(`[Attr] 无卡自动生成有起伏六维：${n} 个NPC`);
  }

  /* 抓取本回合精简快照，供「回合洞察」对比变化 */
  function captureTurnSnapshot() {
    try {
      const prof = usePlayer.getState().profile;
      const game = useGame.getState().player;
      const b1 = useCharacters.getState().characters['B1'];
      const mapSE = (list: any[]) => (list ?? []).map((e) => ({ name: e.name, type: e.type, effect: e.effect, source: e.source, desc: e.desc, durationDesc: e.durationDesc }));
      useTurnInsight.getState().pushSnapshot({
        turn: turnCountRef.current,
        time: Date.now(),
        worldName: useMisc.getState().worldName || '',
        player: {
          level: prof.level, attrs: { ...prof.attrs }, status: prof.status,
          statusEffects: mapSE(prof.statusEffects), hp: game.hp, maxHp: game.maxHp, mp: game.mp, maxMp: game.maxMp,
          skills: (b1?.skills ?? []).map((s) => s.name),
          titlesEquipped: (b1?.titles ?? []).find((t) => t.equipped)?.name,
        },
        npcs: Object.fromEntries(Object.values(useNpc.getState().npcs).map((r) => [r.id, {
          name: r.name, favor: r.favor, status: r.status, motiveNow: r.motiveNow, realm: r.realm, onScene: r.onScene, statusEffects: mapSE(r.statusEffects ?? []),
        }])),
        factions: Object.fromEntries(Object.values(useFaction.getState().factions).map((f) => [f.id, {
          name: f.name, favorToPlayer: f.favorToPlayer, status: f.status, inCurrentWorld: f.inCurrentWorld,
          goal: f.goal, territory: f.territory, resources: f.resources, scale: f.scale, powerLevel: f.powerLevel, relations: f.relations, leader: f.leader,
        }])),
      });
    } catch (e) { console.warn('[Insight] 快照失败:', e); }
  }

  /* 取最近 N 回合正文拼接（read>1 时；末条用清洗后的当前正文）。供各演化"读取前N回合正文"设置使用。 */
  function buildRecentNarrative(latest: string, n: number): string {
    const k = Math.max(1, n || 1);
    if (k <= 1) return latest;
    const assistants = messagesRef.current.filter((m) => m.role === 'assistant').map((m) => String(m.content || ''));
    if (assistants.length === 0) return latest;
    const recent = assistants.slice(-k);
    recent[recent.length - 1] = latest;   // 当前回合用清洗后正文，确保一致
    return recent.map((c, i) => {
      const ago = recent.length - 1 - i;
      return `【${ago === 0 ? '本回合正文' : `前${ago}回合正文`}】\n${c}`;
    }).join('\n\n');
  }

  /* 在场/离场校正（兜底，解决"登场判断漏标 exits 导致离场B区一直空、离场角色不进档案"）：
     - 本轮正文提到姓名：离场角色→回到在场；在场角色→刷新出场回合。
     - 在场角色连续 ARCHIVE_AFTER 回合没在正文出现（且非羁绊/非手动保留）→ 自动归档到离场B区（仍在档案、可查看）。*/
  function reconcileScenePresence(narrative: string) {
    const npc = useNpc.getState();
    const turn = turnCountRef.current;
    const text = narrative || '';
    const ARCHIVE_AFTER = 2;
    for (const r of Object.values(npc.npcs)) {
      if (r.isDead || !r.name || r.name === r.id) continue;
      const nameKey = r.name.split('|')[0].trim();
      if (nameKey.length < 2) continue;                       // 单字名易误命中，跳过
      const mentioned = text.includes(nameKey);
      if (mentioned) {
        if (!r.onScene) npc.setScene(r.id, true, turn);       // 离场角色重新出现→回到在场
        else npc.upsertNpc(r.id, { lastSeenTurn: turn });
      } else if (r.onScene && !r.isBond && !r.keepForever) {
        const last = r.lastSeenTurn ?? turn;
        if (turn - last >= ARCHIVE_AFTER) npc.setScene(r.id, false);   // 久未出场→自动离场
        else if (r.lastSeenTurn == null) npc.upsertNpc(r.id, { lastSeenTurn: turn });
      }
    }
  }

  function runPostNarrativePhases(narrative: string, assistantMsgId?: number) {
    // 先从正文人物卡照抄六维（同步，先于各演化阶段，使快照与显示即刻正确）
    try { applyNarrativeAttrs(narrative); } catch (e) { console.warn('[Attr] 六维抽取失败:', e); }
    // 主角 HP/EP：正文出现"当前HP/EP：X/Y"就照抄（AI 漏写 hp.B1 时兜底，解决 HP 恢复了但侧栏不变）
    try { applyNarrativeVitals(narrative); } catch (e) { console.warn('[Vitals] HP/EP 抽取失败:', e); }
    // 在场/离场校正（兜底登场判断漏标，确保离场角色进入离场B区档案）
    try { reconcileScenePresence(narrative); } catch (e) { console.warn('[NPC] 在场/离场校正失败:', e); }
    // 先用当前已有 NPC 设一份重定向目标（登场判断完成后会再刷新）
    refreshNpcPreferredOwners();
    // 各演化阶段调度（综合设置→演化调度）：every=每N回合一次，read=读取最近N回合正文
    const sched = useSettings.getState().phaseSched ?? {};
    const turn = turnCountRef.current;
    const due = (key: string) => turn % Math.max(1, sched[key]?.every || 1) === 0;
    const narr = (key: string) => buildRecentNarrative(narrative, sched[key]?.read ?? 1);
    // 物品 / 主角演化
    if (due('item')) runItemManagementPhase(narr('item'));
    if (due('player')) runPlayerEvolutionPhase(narr('player'));
    // NPC 演化（内部自行判断启用/API/策略）
    if (due('npc')) runNpcEvolutionPhase(narr('npc'));
    // 势力演化
    if (due('faction')) runFactionEvolutionPhase(narr('faction'));
    // 领地演化（单一基地）
    if (due('territory')) runTerritoryEvolutionPhase(narr('territory'));
    // 冒险团演化（仅主角单一冒险团）
    if (due('team')) runTeamEvolutionPhase(narr('team'));
    // 万族演化（宇宙背景层：七乐园/万族/文明/原生世界/神灵/深渊）
    if (due('cosmos')) runCosmosEvolutionPhase(narr('cosmos'));
    // 生平压缩：达阈值才会真正调用 AI，不走回合门控
    runMemoryCompressionPhase();
    // 杂项演化（总结/双时间/天气/世界大事/任务）
    if (due('misc')) runMiscEvolutionPhase(narr('misc'));
    // 叙事记忆·回复后写入：LLM 抽取长期事实
    if (due('nm')) runNarrativeIngestPhase(lastUserInputRef.current, narr('nm'));
    // 生图·肖像/装备自动化：受各自开关门控，独立并发（依赖 NPC/物品演化已写档，故延后触发）
    setTimeout(() => { runPortraitPhase(); runEquipImagePhase(); }, 6000);   // 延后约 6s 等演化先写档；肖像可用名字/阶位翻译、装备不再强求 appearance，故无需久等
    // 生图·正文配图：受 autoStory 门控，挂到本楼层
    if (assistantMsgId != null) runStoryImagePhase(narrative, assistantMsgId);
  }

  async function callApi(userText: string, extraHistory: ChatMessage[] = []) {
    // 每次用户发消息计为一回合
    turnCountRef.current += 1;
    lastUserInputRef.current = userText;   // 供叙事记忆·回复后写入使用
    expireStatuses();                      // 回合推进：清理已过期的限时状态（主角+NPC）
    reconcileHomeWorld();                  // 回归乐园一致性兜底：时间同步 + 任务世界势力移出当前世界
    reconcilePlayerVitals();               // HP/EP 兜底：仍是 100/50 旧默认时按六维重算为满

    const api = textUseShared ? sharedApi : textApi;
    const apiChain = resolveApiChain('text', api);   // 接口路由：多选轮流 + 失败 fallback
    if (!apiChain[0]?.baseUrl || !apiChain[0]?.apiKey) {
      setGenError('请先在设置→正文生成→API配置中填写 API 地址和 Key（或在综合设置→API 接口库添加后于此选择路由）');
      return;
    }

    const preset = textPresets.find((p) => p.id === activePresetId) ?? textPresets[0];

    // 历史裁切：historyLimit > 0 时只取最近 N 条（即"显示楼层"范围）
    const allHistory = extraHistory.length > 0 ? extraHistory : messagesRef.current;
    const visibleHistory = historyLimit > 0 ? allHistory.slice(-historyLimit) : allHistory;

    // 世界书关键词匹配：用当前输入 + 可见历史内容一起匹配
    const matchCtx = ([
      userText,
      ...visibleHistory.slice(-10).map((m) => m.content),
    ]).join(' ').toLowerCase();

    const wbEntries = textWorldBooks
      .filter((b) => b.enabled)
      .flatMap((b) => b.entries.filter((e) =>
        e.enabled && (
          e.constant ||   // 蓝灯：常驻，无条件纳入
          (e.selective && e.key.some((k) => k && matchCtx.includes(k.toLowerCase())))
        )
      ));
    const worldInfoText = wbEntries.map((e) => `[${e.comment}]\n${e.content}`).join('\n\n');

    const { sysPrompt, examples } = buildPresetMessages(preset, worldInfoText);

    // 历史：叙事记忆（关键词召回，启用时）或按 historyLimit 切片（现状）
    let memory: { role: 'system'; content: string }[] = [];
    let structMem: { role: 'system'; content: string }[] = [];   // <在场与相关档案> 结构化档案块
    let recent: { role: 'user' | 'assistant'; content: string }[];
    if (narrativeMem.enabled) {
      setNmRecalling(true);          // 显示「正在进行记忆回溯…」
      setNmPhaseLog('');
      try {
        const M = useMisc.getState();
        const facts = [
          ...M.narrativeFacts.map((f) => ({ title: f.title, text: f.keywords.length ? `${f.text} ｜${f.keywords.join(' ')}` : f.text, kind: 'fact' as const })),
          ...M.largeSummaries.map((t) => ({ title: t.slice(0, 18), text: t, kind: 'large' as const })),
          ...M.smallSummaries.map((t) => ({ title: t.slice(0, 18), text: t, kind: 'small' as const })),
          ...M.worldEvents.map((e) => ({ title: `${e.time} ${e.location}`.trim(), text: `${e.time}@${e.location} ${e.desc}`, kind: 'event' as const })),
        ];
        const lastAssistant = [...allHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
        const structContext = `${userText}\n${lastAssistant}`;   // 给结构化预测用的原始情境（不被关键词改写覆盖）
        let query = structContext;
        // 发送前整理：LLM 改写查询（仅在开启 LLM 模式且有素材时）
        if (narrativeMem.llmMode && facts.length > 0) {
          const titles = facts.map((f, i) => `${i}｜${f.title}`).join('\n');
          const kws = await narrativeCompile(query, titles);
          if (kws.length) query = kws.join(' ');
        }
        // 全局「历史楼层(historyLimit)」也对叙事记忆生效：正文 API 只读最近 historyLimit 楼原文（再叠加召回的长期事实）。
        // 否则开了叙事记忆后正文只发最近 recentFullTextCount(默认5) 楼、忽略你设的限制——"只读这几楼"形同虚设。
        const effCfg = historyLimit > 0
          ? { ...narrativeMem, recentFullTextCount: historyLimit }
          : narrativeMem;
        const built = buildNarrativeHistory(allHistory, effCfg, facts, query);
        memory = built.memory;
        recent = built.recent;
        // 结构化档案召回（主角必含 + 预测/在场 NPC）
        structMem = await buildStructuredRecall(structContext);
        const structNote = structMem.length > 0 ? ' + 结构化档案' : '';
        setNmPhaseLog(
          facts.length === 0
            ? `🧠 记忆回溯：素材库为空（需先经总结/LLM抽取积累事实）${structNote}`
            : memory.length > 0
              ? `🧠 记忆回溯：已注入相关记忆（素材库 ${facts.length} 条）${structNote}`
              : `🧠 记忆回溯：素材库 ${facts.length} 条，本轮无强相关${structNote}`
        );
        setTimeout(() => setNmPhaseLog(''), 8000);
      } finally {
        setNmRecalling(false);
      }
    } else {
      recent = visibleHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    const history = [
      ...examples,
      ...memory,                                       // <过往记忆> system 块（如有）
      ...structMem,                                    // <在场与相关档案> 结构化档案块（如有）
      ...buildPlayerCoreInjection(),                    // <主角核心> 始终注入主角真实外观/六维（结构化召回关时兜底，防 AI 改发色/清属性）
      ...buildCosmosInjection(),                        // <万族态势> 宇宙背景层（独立于叙事记忆开关，cosmos 自己的启用控制）
      ...recent,                                       // 最近原文楼层
      { role: 'user' as const, content: userText },
    ];

    // stream 以预设为准，统一一个变量
    const useStream = preset?.stream ?? textStream;

    setPromptSent(`=== SYSTEM ===\n${sysPrompt}\n\n=== HISTORY ===\n${history.map((m) => `[${m.role}] ${m.content}`).join('\n')}`);
    setShowPrompt(false);
    // 记录本回合实际注入正文的「记忆/档案」块，供「查看注入记忆」核对
    {
      const memBlock = memory.map((m) => m.content).join('\n\n');
      const structBlock = structMem.map((m) => m.content).join('\n\n');
      const segs: string[] = [];
      if (memBlock) segs.push(`【叙事记忆召回】\n${memBlock}`);
      if (structBlock) segs.push(`【结构化档案召回】\n${structBlock}`);
      setInjectedMem(
        !narrativeMem.enabled
          ? '（未启用叙事记忆——本回合按历史楼层切片，无召回/档案注入）'
          : segs.length
            ? segs.join('\n\n──────────\n\n')
            : '（叙事记忆已启用，但本回合无任何记忆/档案被注入：素材库为空 或 无相关命中 或 无 NPC/角色数据）'
      );
    }
    setGenerating(true);
    setGenError('');
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // 接口路由：按优先级逐个尝试，失败/非 OK 自动 fallback 到下一条；首个成功者用于（流式）读取
      let res: Response | null = null;
      let usedApi = apiChain[0];
      let lastErr: unknown;
      for (let ci = 0; ci < apiChain.length; ci++) {
        const ep = apiChain[ci];
        if (!ep.baseUrl || !ep.apiKey) continue;
        const reqBody: Record<string, unknown> = {
          model:       ep.modelId,
          messages:    [{ role: 'system', content: sysPrompt }, ...history],
          temperature: preset?.temperature ?? ep.temperature,
          max_tokens:  preset?.max_tokens  ?? Math.max(ep.maxTokens || 0, 60000),   // 无预设时给足上限（对齐 60000），避免 2048 旧默认截断长正文
          top_p:       preset?.top_p       ?? ep.topP,
          stream:      useStream,
        };
        if ((preset?.frequency_penalty ?? 0) !== 0) reqBody.frequency_penalty = preset!.frequency_penalty;
        if ((preset?.presence_penalty  ?? 0) !== 0) reqBody.presence_penalty  = preset!.presence_penalty;
        if ((preset?.seed ?? -1) !== -1)             reqBody.seed              = preset!.seed;
        if ((preset?.n ?? 1) > 1)                    reqBody.n                 = preset!.n;
        try {
          const r = await fetch(ep.baseUrl.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.apiKey}` },
            body: JSON.stringify(reqBody),
            signal: ac.signal,
          });
          if (!r.ok) { const errText = await r.text(); lastErr = new Error(`HTTP ${r.status}: ${errText.slice(0, 160)}`); console.warn(`[正文] 接口失败${ci < apiChain.length - 1 ? '，回退下一条' : ''}：${ep.modelId}`, lastErr); continue; }
          res = r; usedApi = ep; break;
        } catch (e) { lastErr = e; console.warn(`[正文] 接口异常${ci < apiChain.length - 1 ? '，回退下一条' : ''}：${ep.modelId}`, e); }
      }
      if (!res) throw (lastErr ?? new Error('全部正文接口调用失败'));
      void usedApi;

      if (useStream) {
        // ── 流式读取 SSE ──
        const streamMsgId = ++msgId.current;
        setMessages((prev) => [...prev, { id: streamMsgId, role: 'assistant', content: '' }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer = '';
        let aborted = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE 按行处理
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';   // 最后一行可能不完整，留到下次

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  accumulated += delta;
                  // 流式期间显示原始内容，避免正则对不完整结构误判导致内容闪烁
                  setMessages((prev) =>
                    prev.map((m) => m.id === streamMsgId ? { ...m, content: accumulated } : m)
                  );
                }
              } catch { /* 忽略解析失败的行 */ }
            }
          }
        } catch (streamErr: any) {
          if (streamErr?.name === 'AbortError') aborted = true;   // 用户手动停止
          else throw streamErr;
        }

        if (aborted) {
          // 手动停止：只清洗已生成的部分用于显示，不解析 state、不触发任何演化（避免半截数据污染存档）
          const partial = stripStateBlocks(applyRegex(accumulated, preset));
          setMessages((prev) =>
            prev.map((m) => m.id === streamMsgId ? { ...m, content: partial || accumulated || '（已停止生成）' } : m)
          );
          console.log('[正文] 已手动停止，保留部分正文（未触发演化）');
          return;   // finally 仍会执行 setGenerating(false)
        }
        // 流结束后：先用原始文本解析 state 块，再执行正则并剥除 state 块
        applyAllUpdates(accumulated);
        try { applyPlayerProfileCommands(accumulated); } catch { /* 主角位置/外观/身份：正文若直接输出 character.B1.* 也即时生效，不必等主角演化阶段 */ }
        const finalDisplayed = stripStateBlocks(applyRegex(accumulated, preset));
        setMessages((prev) =>
          prev.map((m) => m.id === streamMsgId ? { ...m, content: finalDisplayed } : m)
        );
        setRawResponse(accumulated);
        if (!accumulated) throw new Error('模型未返回内容');
        // 演化阶段只读「清洗后正文」（已剥思维链/正则处理 + 去 state 块），不读思维链
        lastNarrativeRef.current = finalDisplayed;
        // 正文完成后：策略B先登场判断再并发其余阶段（修复NPC装备挂错ID）
        runPostNarrativePhases(finalDisplayed, streamMsgId);

      } else {
        // ── 非流式：等待完整响应 ──
        const rawText = await res.text();
        setRawResponse(rawText);
        const data = JSON.parse(rawText);
        const reply: string = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
        if (!reply) throw new Error('模型未返回内容');
        applyAllUpdates(reply);
        try { applyPlayerProfileCommands(reply); } catch { /* 主角位置/外观/身份：正文直接输出 character.B1.* 即时生效 */ }
        const processed = stripStateBlocks(applyRegex(reply, preset));
        const newMsgId = ++msgId.current;
        setMessages((prev) => [...prev, { id: newMsgId, role: 'assistant', content: processed }]);
        // 演化阶段只读「清洗后正文」（已剥思维链/正则处理 + 去 state 块），不读思维链
        lastNarrativeRef.current = processed;
        // 正文完成后：策略B先登场判断再并发其余阶段（修复NPC装备挂错ID）
        runPostNarrativePhases(processed, newMsgId);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') { setGenError(''); console.log('[正文] 已手动停止生成'); }
      else setGenError(e.message ?? '请求失败');
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  /* 记录回退点：每次发送前，把"上一回合结束时"的完整状态（所有演化 store + 对话 + 图）存到固定槽，供回退/重新生成 */
  async function captureUndoPoint() {
    try { await saveSlot(UNDO_ID, '↩ 回退点', messagesRef.current); setCanUndo(true); }
    catch (e) { console.warn('[Undo] 记录回退点失败:', e); }
  }
  function stopGeneration() { abortRef.current?.abort(); }
  /* 回退到上一回合：恢复所有演化/对话/图到发送本回合之前（整页 reload）*/
  async function rollbackTurn() {
    const ok = await loadSlot(UNDO_ID);
    if (!ok) { setGenError('没有可回退的回合（本局还没产生过回退点）'); setTimeout(() => setGenError(''), 5000); }
  }
  /* 重新生成本次正文：先回退到本回合之前，reload 后自动重发同一条输入（演化不会叠加）*/
  async function regenerateTurn() {
    const input = lastUserInputRef.current;
    if (!input) { setGenError('本会话无可重新生成的输入（刷新后会丢失，请直接重新输入）'); setTimeout(() => setGenError(''), 5000); return; }
    try { sessionStorage.setItem(PENDING_REGEN_KEY, input); } catch { /* */ }
    const ok = await loadSlot(UNDO_ID);
    if (!ok) { try { sessionStorage.removeItem(PENDING_REGEN_KEY); } catch { /* */ } setGenError('没有回退点，无法重新生成'); setTimeout(() => setGenError(''), 5000); }
  }

  async function sendMessage(textArg?: string) {
    const text = (textArg ?? inputValue).trim();
    if (!text || generating) return;
    await captureUndoPoint();   // 发送前记录回退点（=上一回合结束状态）
    const userMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    if (textArg == null) setInputValue('');
    await callApi(text);
  }

  /* 角色创建·开场白：用创建数据填充模板（设置里有自定义则用自定义） */
  function buildOpening(d: CreationData): string {
    const custom = useSettings.getState().customOpening?.trim();
    const attrStr = `力${d.attrs.str} 敏${d.attrs.agi} 体${d.attrs.con} 智${d.attrs.int} 魅${d.attrs.cha} 幸${d.attrs.luck}`;
    if (custom) {
      return custom
        .replaceAll('${name}', d.name)
        .replaceAll('${age}', d.age || '未知')
        .replaceAll('${personality}', d.personality || '—')
        .replaceAll('${prevProfession}', d.prevProfession || '普通人')
        .replaceAll('${paradise}', d.paradise)
        .replaceAll('${difficulty}', d.difficulty)
        .replaceAll('${talentName}', d.talentName || '（无）')
        .replaceAll('${talentEffect}', d.talentEffect || '')
        .replaceAll('${attrs}', attrStr);
    }
    const park = d.paradise;
    const user = d.name;
    const talent = d.talentName || '（未觉醒）';
    const talentDesc = d.talentEffect || '（尚无明确说明，等待在试炼中显现）';
    const pastLife = `${d.age || '未知'}岁 · ${d.prevProfession || '普通人'}${d.personality ? `（${d.personality}）` : ''}`;
    const contractNo = d.contractId || '随机分配中';
    return [
      `# ${park}·开局`,
      `你在彻底的黑暗中苏醒。没有呼吸，没有心跳，连身体的轮廓都仿佛被剥离，只剩下意识在冰冷虚空中漂浮。`,
      `下一瞬，一行行淡金色的文字在你面前浮现——它们不是光，而是直接烙进灵魂的讯息。`,
      `> 【${park}】正在校验灵魂。\n> 标识：${user}\n> 生理状态：死亡 / 临界。\n> 适配判定：通过。\n> 所属乐园：${park}\n> 主角背景：${pastLife}\n> 外观：${d.appearance?.trim() || '（待你在后续描写中确立）'}\n> 六维属性：${attrStr}\n> 初始天赋：${talent}\n> 契约者编号：${contractNo}`,
      `某种冷漠却并不敌意的目光，从上而下打量着你。那不是人类的视角，更像是在审阅一份可回收资源。`,
      `它向你伸出了一只手——不是肉体的手，而是一份连注释都冷冰冰的契约。`,
      `只要应答，你将被记录为「${park}·一阶预备契约者」，以「${talent}」之天赋记录，投放诸多世界。`,
      `成功者获得力量、地位与不可名状之物。失败者，则被执行【强制处决】——灵魂拆解，全部收益与残渣一并回收。`,
      `作为「${talent}」天赋的持有者，你被允许携带如下倾向与缺陷：\n${talentDesc}`,
      `没有人向你解释更多规则，因为在这里，"不清楚"本身也是一种测试。`,
      `黑暗深处，有某种东西在注视你。你伸出手。指尖碰到那枚悬浮的乐园印记。`,
      `——刺痛、自我剥离、数据化、编号写入。`,
      `当意识再度聚拢时，你已经站在一座陌生而冰冷的大厅中。【${park}】的提示音在耳边响起：`,
      `> 欢迎加入，契约者。\n> 初始天赋：${talent} 已记录完毕。\n> ${d.contractId ? `契约者编号：${d.contractId} 已写入。` : '随机分配契约者编号中。'}\n> 请查看您的天赋与技能情况。\n> - 系统载入中……\n>   - 请做好准备。`,
      `从这一刻起，你的每一次"活着"，都将写在乐园的结算列表里。请以${park}新人的视角为我展开故事：先给我大约三小时的时间熟悉环境、确认自身状态与能力，再循序渐进地引出第一个事件，不要一上来就进入高强度战斗。`,
    ].join('\n\n');
  }

  /* 角色创建确认：清空旧进度 → 写入主角演化变量 → 发送开场白（全新存档） */
  async function confirmCreation(d: CreationData) {
    await clearProgress();   // 开始游戏=全新存档：先清空之前的玩家/NPC/物品/角色/杂项/对话
    msgId.current = 0;
    const P = usePlayer.getState();
    P.setProfile({
      name: d.name,
      homeParadise: d.paradise,
      preParadiseJob: d.prevProfession,   // 主角背景=入园前职业（开局设定）
      contractorId: d.contractId,         // 契约者ID（开局设定，可留空）
      baseAppearance: d.appearance || undefined,   // 基底外观（不可变，生图始终包含）
      appearance: d.appearance || '',     // 初始外观=基底外观（之后随剧情演化）
      attrs: { ...d.attrs },
      background: `【开局设定】所属乐园：${d.paradise}｜游戏难度：${d.difficulty}（${d.points}属性点）｜年龄：${d.age || '未知'}｜性格：${d.personality || '—'}｜主角背景：${d.prevProfession || '普通人'}`,
    });
    // 开局按六维换算 HP/EP 上限（体质×20 / 智力×15）并拉满，避免主角永远停在 100/50 默认值
    { const g = useGame.getState(); const mh = computeMaxHp(d.attrs), me = computeMaxEp(d.attrs);
      g.setPlayerField('maxHp', mh); g.setPlayerField('hp', mh); g.setPlayerField('maxMp', me); g.setPlayerField('mp', me); }
    if (d.talentName) {
      useCharacters.getState().addTrait('B1', {
        name: d.talentName, desc: d.talentEffect, effect: d.talentEffect,
        rarity: 'C', category: '特殊异能类', source: '开局自带',
      });
    }
    setCreating(false);
    setStarted(true);
    const opening = buildOpening(d);
    const userMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: opening };
    messagesRef.current = [];   // 全新存档：历史清空，避免 callApi 取到旧对话
    setMessages([userMsg]);
    await callApi(opening, []);
  }

  // 选择世界：把卡片全部内容作为上下文发给 API
  async function enterWorld(world: WorldOption) {
    setWorlds([]);
    setCardIndex(0);

    const lines: string[] = [`【进入世界：${world.name}】`];
    if (world.worldType)   lines.push(`类型：${world.worldType}`);
    if (world.tier)        lines.push(`阶位：${world.tier}`);
    if (world.dangerLevel) lines.push(`难度：${world.dangerLevel}`);
    if (world.desc)        lines.push(`\n世界简介：\n${world.desc}`);
    if (world.peakPower)   lines.push(`\n巅峰战力：${world.peakPower}`);
    if (world.entryPoint)  lines.push(`\n切入点：\n${world.entryPoint}`);
    if (world.mainMission) lines.push(`\n主线任务：\n${world.mainMission}`);
    if (world.sideMission) lines.push(`\n支线任务：\n${world.sideMission}`);
    if (world.warning)     lines.push(`\n警告：\n${world.warning}`);
    if (world.reward)      lines.push(`\n奖励预览：${world.reward}`);
    if (world.region)      lines.push(`\n任务区域：${world.region}`);

    const contextText = lines.join('\n');
    // 进入任务世界：立即把「当前世界」设为该世界名、清空世界时间（底部状态栏即时反映当前世界，
    // 之后由杂项演化按正文细化 worldTime；worldName 始终跟随正文/所在世界，不写死轮回乐园）
    try { useMisc.getState().setTime({ worldName: world.name || '', worldTime: '' }); } catch { /* */ }
    // 进入新任务世界：把"所处世界已知、且明显不属于新世界"的旧势力移出当前世界（避免上个世界的势力继续挂在新世界出不去）
    try {
      const F = useFaction.getState();
      const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜（）()【】]/g, '').toLowerCase();
      const nn = norm((world.name || '').trim());
      if (nn) for (const f of Object.values(F.factions)) {
        if (!f.inCurrentWorld) continue;
        const fw = norm((f.worldName || '').trim());
        if (fw && !fw.includes(nn) && !nn.includes(fw)) F.setWorld(f.id, false);
      }
    } catch { /* */ }
    const systemMsg: ChatMessage = { id: ++msgId.current, role: 'user', content: contextText };
    messagesRef.current = [];   // 进入新世界：以空历史起头，避免取到旧对话
    setMessages([systemMsg]);
    await callApi(contextText, []);
  }

  if (settingsOpen) {
    return <SettingsPanel onClose={() => setSettingsOpen(false)} />;
  }

  if (!started) {
    return (
      <>
        <StartScreen
          hasSave={hasSave}
          onStart={() => setCreating(true)}
          onContinue={() => setSaveOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        {creating && (
          <CharacterCreation onConfirm={confirmCreation} onCancel={() => setCreating(false)} />
        )}
        {saveOpen && (
          <SaveLoadPanel messages={messages} onClose={() => setSaveOpen(false)} />
        )}
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-void text-slate-300 overflow-hidden" style={{ fontFamily: 'var(--app-font)' }}>

      {/* ── 顶部状态栏 ── */}
      <header className="shrink-0 h-14 flex items-center justify-between px-3 border-b border-edge bg-panel z-10">
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={() => setMobileDrawer((d) => (d === 'player' ? null : 'player'))}
            aria-label="角色面板"
            className="lg:hidden w-8 h-8 flex items-center justify-center border border-edge rounded text-god hover:bg-god/10 transition-colors text-base"
          >
            ☰
          </button>
          <button
            onClick={() => setStarted(false)}
            className="px-2 py-0.5 border border-edge rounded text-dim hover:border-blood/40 hover:text-blood transition-colors"
          >
            ← 主界面
          </button>
        </div>
        <div className="text-center font-mono">
          <div className="text-slate-100 text-lg font-bold">🕒 {miscParadiseTime || '——'}</div>
          <div className="text-dim text-xs mt-0.5">
            {miscWorldName || '轮回乐园'}
            {/* 回归乐园时显示与轮回历一致的时间（兜底：底层数据下回合同步）*/}
            {(() => { const wt = isHomeWorld(miscWorldName) ? (miscParadiseTime || miscWorldTime) : miscWorldTime; return wt ? ` · ${wt}` : ''; })()}
            {miscWeather ? ` · ${miscWeather}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSaveOpen(true)}
            className="px-2.5 py-1 border border-god/40 rounded text-god hover:bg-god/10 text-xs font-bold font-mono transition-colors"
          >
            💾 存档
          </button>
          <button
            onClick={() => setMobileDrawer((d) => (d === 'menu' ? null : 'menu'))}
            aria-label="功能菜单"
            className="lg:hidden w-8 h-8 flex items-center justify-center border border-edge rounded text-god hover:bg-god/10 transition-colors text-base"
          >
            ⊞
          </button>
        </div>
      </header>

      {/* ── 主体3栏 ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 手机端抽屉遮罩（点击关闭）*/}
        {mobileDrawer && (
          <div
            className="lg:hidden fixed inset-x-0 top-14 bottom-0 z-40 bg-black/50"
            onClick={() => setMobileDrawer(null)}
          />
        )}

        {/* ── 左侧角色面板（桌面常驻列 / 手机左侧抽屉）── */}
        <aside
          className={`shrink-0 w-72 border-r border-edge bg-panel flex flex-col overflow-hidden
            max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-50 max-lg:max-w-[82vw]
            max-lg:shadow-[8px_0_40px_rgba(0,0,0,0.7)] max-lg:transition-transform max-lg:duration-300
            ${mobileDrawer === 'player' ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}`}
        >
          <PlayerSidebar />
        </aside>

        {/* ── 中间主内容区 ── */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 叙事/对话滚动区 */}
          <div className="flex-1 overflow-hidden relative">
            {/* 左上角「主角装备」/ 右上角「在场人物」/ 右下角「物品栏」浮窗（仅叙事视图；手机端隐藏，改用左/右抽屉）*/}
            {worlds.length === 0 && started && (
              <div className="max-lg:hidden">
                <PlayerEquipPanel />
                <OnScenePanel onOpenNpc={setOnSceneDetailId} />
                <ItemListPanel />
              </div>
            )}
            {worlds.length > 0 ? (
              <WorldCardView
                worlds={worlds}
                index={cardIndex}
                onPrev={() => setCardIndex((i) => (i - 1 + worlds.length) % worlds.length)}
                onNext={() => setCardIndex((i) => (i + 1) % worlds.length)}
                onJump={(i) => setCardIndex(i)}
                onSelect={(_, world) => {
                  setPrevWorlds(worlds);
                  enterWorld(world);
                }}
                onClose={() => { setWorlds([]); setCardIndex(0); }}
              />
            ) : (
              <div ref={chatScrollRef} onScroll={onChatScroll} className="h-full overflow-y-auto px-6 max-lg:px-3 py-4 space-y-4 max-w-4xl mx-auto w-full border-x border-edge">
                {messages.length === 0 && !generating && (
                  <div className="h-full flex items-center justify-center text-dim/30 text-sm font-mono select-none">
                    在此输入行动，故事将在这里展开…
                  </div>
                )}
                {(() => {
                  const visibleMsgs = historyLimit > 0 ? messages.slice(-historyLimit) : messages;
                  const hiddenCount = messages.length - visibleMsgs.length;
                  return (
                    <>
                      {hiddenCount > 0 && (
                        <div className="text-center text-xs font-mono text-dim/40 py-1 select-none">
                          — 已隐藏 {hiddenCount} 条历史记录（共 {messages.length} 楼）—
                        </div>
                      )}
                      {visibleMsgs.map((msg) => (
                        <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                          {msg.role === 'user' ? (
                            <div className="max-w-sm px-4 py-2 rounded-xl bg-god/10 border border-god/20 text-sm text-god/90 font-mono">
                              {msg.content}
                            </div>
                          ) : (
                            <div
                              className="text-[17px] text-slate-300 leading-relaxed narrative-content"
                              dangerouslySetInnerHTML={{ __html: toHtmlWithImages(msg.content, msg.images) }}
                            />
                          )}
                        </div>
                      ))}
                    </>
                  );
                })()}
                {generating && (
                  <div className="flex items-center gap-2 text-dim text-xs font-mono">
                    <span className="animate-spin inline-block">◌</span>
                    <span>正在生成…</span>
                  </div>
                )}
                {genError && (
                  <div className="text-xs text-blood font-mono px-3 py-2 border border-blood/30 rounded-lg bg-blood/5">
                    ⚠ {genError}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 状态命令栏 */}
          <div className="shrink-0 border-t border-edge bg-panel px-4 py-1.5 flex items-center max-lg:flex-wrap gap-2 text-[11px] font-mono text-dim">
            <span className="text-god/60">📋</span>
            <span>本回合状态命令 · {turnCountRef.current} 回合</span>
            {itemPhaseRunning && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="animate-spin inline-block">◌</span>
                物品管理处理中…
              </span>
            )}
            {!itemPhaseRunning && itemPhaseLog && (
              <span className={itemPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-god/80'}>
                {itemPhaseLog}
              </span>
            )}
            {playerPhaseRunning && (
              <span className="flex items-center gap-1 text-sky-400">
                <span className="animate-spin inline-block">◌</span>
                主角演化处理中…
              </span>
            )}
            {!playerPhaseRunning && playerPhaseLog && (
              <span className={playerPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-sky-400/80'}>
                {playerPhaseLog}
              </span>
            )}
            {npcPhaseRunning && (
              <span className="flex items-center gap-1 text-violet-400">
                <span className="animate-spin inline-block">◌</span>
                NPC 演化处理中…
              </span>
            )}
            {!npcPhaseRunning && npcPhaseLog && (
              <span className={npcPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-violet-400/80'}>
                {npcPhaseLog}
              </span>
            )}
            {factionPhaseLog && (
              <span className={factionPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-orange-400/80'}>
                {factionPhaseLog}
              </span>
            )}
            {territoryPhaseLog && (
              <span className={territoryPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-emerald-400/80'}>
                {territoryPhaseLog}
              </span>
            )}
            {teamPhaseLog && (
              <span className={teamPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-cyan-400/80'}>
                {teamPhaseLog}
              </span>
            )}
            {cosmosPhaseLog && (
              <span className={cosmosPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-fuchsia-400/80'}>
                {cosmosPhaseLog}
              </span>
            )}
            {imagePhaseLog && (
              <span className={imagePhaseLog.startsWith('⚠') ? 'text-blood' : 'text-pink-400/80'}>
                {imagePhaseLog}
              </span>
            )}
            {nmRecalling && (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="animate-spin inline-block">◌</span>
                正在进行记忆回溯…
              </span>
            )}
            {!nmRecalling && nmPhaseLog && (
              <span className={nmPhaseLog.startsWith('⚠') ? 'text-blood' : 'text-emerald-400/80'}>
                {nmPhaseLog}
              </span>
            )}
            {prevWorlds.length > 0 && worlds.length === 0 && (
              <button
                onClick={() => {
                  setWorlds(prevWorlds);
                  setCardIndex(0);
                  setInputValue(prevInput);
                  setPrevWorlds([]);
                  setPrevInput('');
                }}
                className="px-2 py-0.5 border border-amber-500/40 text-amber-400 rounded hover:bg-amber-900/20 font-mono text-[10px] transition-colors"
              >
                ↺ 撤销选择
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {injectedMem && (
                <button
                  onClick={() => { setShowInjected((v) => !v); setShowPrompt(false); setShowRaw(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showInjected ? 'border-emerald-400/40 text-emerald-400 bg-emerald-900/10' : 'border-edge text-dim hover:border-emerald-400/40 hover:text-emerald-400'
                  }`}
                >
                  {showInjected ? '隐藏注入' : '🧠 查看注入记忆'}
                </button>
              )}
              {promptSent && (
                <button
                  onClick={() => { setShowPrompt((v) => !v); setShowRaw(false); setShowInjected(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showPrompt ? 'border-sky-400/40 text-sky-400 bg-sky-900/10' : 'border-edge text-dim hover:border-sky-400/40 hover:text-sky-400'
                  }`}
                >
                  {showPrompt ? '隐藏输入' : '查看输入'}
                </button>
              )}
              {rawResponse && (
                <button
                  onClick={() => { setShowRaw((v) => !v); setShowPrompt(false); }}
                  className={`px-2 py-0.5 border rounded transition-colors font-mono text-[10px] ${
                    showRaw ? 'border-god/40 text-god bg-god/5' : 'border-edge text-dim hover:border-god/40 hover:text-god'
                  }`}
                >
                  {showRaw ? '隐藏返回' : '查看返回'}
                </button>
              )}
            </div>
          </div>
          {showInjected && injectedMem && (
            <div className="shrink-0 border-t border-emerald-900/40 bg-void px-4 py-3 max-h-72 overflow-y-auto">
              <div className="text-[10px] font-mono text-emerald-400/70 mb-1.5">本回合实际注入正文的记忆 / 结构化档案（即主叙事 API 能看到的内容）</div>
              <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all">{injectedMem}</pre>
            </div>
          )}
          {showPrompt && promptSent && (
            <div className="shrink-0 border-t border-sky-900/40 bg-void px-4 py-3 max-h-52 overflow-y-auto">
              <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all">{promptSent}</pre>
            </div>
          )}
          {showRaw && rawResponse && (
            <div className="shrink-0 border-t border-edge bg-void px-4 py-3 max-h-52 overflow-y-auto">
              <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-all">{rawResponse}</pre>
            </div>
          )}

          {/* 选择世界 */}
          <WorldSelector
            onSelect={(text) => setInputValue(text)}
            onRawResponse={(raw) => { setRawResponse(raw); setShowRaw(false); }}
            onPromptSent={(p) => { setPromptSent(p); setShowPrompt(false); }}
            onWorlds={(list) => { setWorlds(list); setCardIndex(0); }}
          />

          {/* 操作行：停止生成 / 重新生成 / 回退上一回合 */}
          {started && messages.length > 0 && (
            <div className="shrink-0 border-t border-edge bg-panel/60 flex items-center gap-2 px-3 py-1 text-[12px] font-mono">
              {generating ? (
                <button onClick={stopGeneration}
                  className="flex items-center gap-1 px-2.5 py-1 rounded border border-blood/40 text-blood hover:bg-blood/10 transition-colors">■ 停止生成</button>
              ) : (
                <>
                  <button onClick={() => setConfirmAction({
                      title: '重新生成本回合',
                      desc: '将撤销本回合（含正文与所有演化：NPC / 物品 / 势力 / 领地 / 冒险团 / 杂项 / 记忆等），并用同一条输入重新生成。操作会刷新页面，确定继续？',
                      run: regenerateTurn })} disabled={!canUndo}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-edge text-dim hover:border-god/40 hover:text-god disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    title="撤销本回合（含所有演化）并用同一条输入重新生成">⟳ 重新生成</button>
                  <button onClick={() => setConfirmAction({
                      title: '回退上一回合',
                      desc: '将撤销本回合的正文与所有演化（NPC / 物品 / 势力 / 领地 / 冒险团 / 杂项 / 记忆等），恢复到上一回合结束时的状态。操作会刷新页面，确定继续？',
                      run: rollbackTurn })} disabled={!canUndo}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-edge text-dim hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    title="回退到上一回合结束时的状态（撤销本回合的正文+所有演化）">↩ 回退上一回合</button>
                  {canUndo && <span className="text-dim/35">回退/重生会撤销上一回合的全部演化</span>}
                </>
              )}
            </div>
          )}

          {/* 输入框 */}
          <div className="shrink-0 border-t border-edge bg-panel flex items-center gap-2 px-3 py-2">
            <button
              onClick={() => setMessages([])}
              title="清空对话"
              className="w-7 h-7 max-lg:w-9 max-lg:h-9 flex items-center justify-center text-blood bg-blood/10 border border-blood/30 rounded text-sm hover:bg-blood/20 shrink-0"
            >
              ↺
            </button>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="在此输入你的行动..."
              className="flex-1 bg-transparent text-sm max-lg:text-base text-slate-200 placeholder:text-dim outline-none"
            />
            <button
              onClick={() => sendMessage()}
              disabled={generating || !inputValue.trim()}
              className="w-7 h-7 max-lg:w-9 max-lg:h-9 flex items-center justify-center text-god border border-god/30 rounded hover:bg-god/10 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? <span className="animate-spin text-xs">◌</span> : '▶'}
            </button>
          </div>
        </main>

        {/* ── 右侧导航菜单（桌面常驻列 / 手机右侧抽屉）── */}
        <aside
          className={`shrink-0 w-44 border-l border-edge bg-panel overflow-y-auto
            max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:right-0 max-lg:z-50 max-lg:w-52 max-lg:max-w-[78vw]
            max-lg:shadow-[-8px_0_40px_rgba(0,0,0,0.7)] max-lg:transition-transform max-lg:duration-300
            ${mobileDrawer === 'menu' ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full'}`}
        >
          <nav className="py-1">
            {rightMenuItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  const open =
                    item.label === '设置' ? () => setSettingsOpen(true) :
                    item.label === '储存空间' ? () => setBackpackOpen(true) :
                    item.label === '装备' ? () => setEquipOpen(true) :
                    item.label === '技能' ? () => setCharPanelOpen(true) :
                    item.label === '称号' ? () => setTitlePanelOpen(true) :
                    item.label === '成就' ? () => setAchievePanelOpen(true) :
                    item.label === '副职业' ? () => setSubProfOpen(true) :
                    item.label === '势力' ? () => setFactionPanelOpen(true) :
                    item.label === '领地' ? () => setTerritoryPanelOpen(true) :
                    item.label === '冒险团' ? () => setTeamPanelOpen(true) :
                    item.label === '万族' ? () => setCosmosPanelOpen(true) :
                    item.label === '回合洞察' ? () => setInsightOpen(true) :
                    item.label === 'NPC'  ? () => setNpcPanelOpen(true) :
                    item.label === '任务' ? () => setMiscPanelOpen(true) :
                    item.label === '频道' ? () => setChannelPanelOpen(true) :
                    item.label === '记忆' ? () => setSummaryPanelOpen(true) :
                    item.label === '存档' ? () => setSaveOpen(true) :
                    undefined;
                  open?.();
                  setMobileDrawer(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-dim hover:text-slate-200 hover:bg-panel2 transition-colors text-left"
              >
                <span className="w-4 text-center text-xs opacity-70">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
      </div>

      {/* ── 底部状态栏 ── */}
      <footer className="shrink-0 h-7 flex items-center justify-between px-4 border-t border-edge bg-panel text-[10px] font-mono text-dim/60">
        <span>DRPG // DIGITAL ROLE PLAYING GAME</span>
        <span>VERSION V0.0.1 // ONLINE 2</span>
      </footer>

      {/* ── 背包弹窗 ── */}
      {backpackOpen && (
        <BackpackModal
          onClose={() => setBackpackOpen(false)}
          onManualUpdate={triggerItemPhaseManually}
          itemPhaseRunning={itemPhaseRunning}
          itemPhaseLog={itemPhaseLog}
        />
      )}

      {/* ── NPC 档案面板 ── */}
      {npcPanelOpen && (
        <NpcPanel onClose={() => setNpcPanelOpen(false)} />
      )}

      {/* ── NPC 定期清理提示框（策略B 调度提醒）── */}
      {cleanupNpcs.length > 0 && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCleanupNpcs([]); }}>
          <div className="w-full max-w-md bg-void border border-edge rounded-2xl overflow-hidden flex flex-col max-h-[80vh] shadow-[0_0_60px_rgba(0,0,0,0.8)]">
            <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
              <span className="text-amber-400 text-lg">🧹</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-100">NPC 清理提醒</div>
                <div className="text-[10px] font-mono text-dim/60">以下 {cleanupNpcs.length} 个 NPC 长期未出场，可归档以精简档案库</div>
              </div>
              <button onClick={() => setCleanupNpcs([])} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {cleanupNpcs.map((n) => (
                <div key={n.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-edge bg-panel/60">
                  <span className="text-[10px] font-mono text-dim/50 shrink-0">{n.id}</span>
                  <span className="flex-1 text-sm text-slate-200 truncate">{n.name}</span>
                  <button
                    onClick={() => { useNpc.getState().removeNpc(n.id); setCleanupNpcs((p) => p.filter((x) => x.id !== n.id)); }}
                    className="text-[10px] font-mono px-2 py-1 rounded border border-amber-700/40 text-amber-400/80 hover:bg-amber-900/20 transition-colors shrink-0"
                  >归档</button>
                </div>
              ))}
            </div>
            <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-edge bg-panel">
              <button
                onClick={() => { cleanupNpcs.forEach((n) => useNpc.getState().removeNpc(n.id)); setCleanupNpcs([]); }}
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-amber-600/50 text-amber-300 hover:bg-amber-900/20 transition-colors"
              >全部归档 ({cleanupNpcs.length})</button>
              <button
                onClick={() => setCleanupNpcs([])}
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-edge text-dim hover:text-slate-200 transition-colors"
              >保留全部</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 杂项（任务/世界大事）面板 ── */}
      {channelPanelOpen && (
        <ChannelPanel onClose={() => setChannelPanelOpen(false)} onRefresh={refreshChannel} onSolicit={solicitQuotes} onPost={replyToChannelPost} onOpenShop={() => setShopOpen(true)} />
      )}
      {shopOpen && <SystemShop onGenShop={genShopItems} onQuoteSell={genSellQuotes} onClose={() => setShopOpen(false)} />}
      {miscPanelOpen && (
        <MiscPanel onClose={() => setMiscPanelOpen(false)} />
      )}

      {/* ── 记忆（小总结/大总结）面板 ── */}
      {summaryPanelOpen && (
        <SummaryPanel onClose={() => setSummaryPanelOpen(false)} />
      )}

      {/* ── 存档管理面板 ── */}
      {saveOpen && (
        <SaveLoadPanel messages={messages} onClose={() => setSaveOpen(false)} />
      )}

      {/* ── 技能/天赋面板 ── */}
      {titlePanelOpen && <TitlePanel onClose={() => setTitlePanelOpen(false)} />}
      {achievePanelOpen && <AchievementPanel onClose={() => setAchievePanelOpen(false)} />}
      {subProfOpen && <SubProfessionPanel onClose={() => setSubProfOpen(false)} />}
      {factionPanelOpen && <FactionPanel onClose={() => setFactionPanelOpen(false)} />}
      {territoryPanelOpen && <TerritoryPanel onClose={() => setTerritoryPanelOpen(false)} />}
      {teamPanelOpen && <AdventureTeamPanel onClose={() => setTeamPanelOpen(false)} />}
      {cosmosPanelOpen && <CosmosPanel onClose={() => setCosmosPanelOpen(false)} />}
      <ImageViewer />
      <ImageBusyToast />
      {showVer && <VersionToast version={APP_VERSION} note={VERSION_NOTE} onClose={() => setShowVer(false)} />}
      {/* 回退 / 重新生成 确认弹窗（破坏性操作，先确认）*/}
      {confirmAction && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmAction(null); }}>
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-void shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="px-5 py-3 border-b border-edge bg-panel flex items-center gap-2">
              <span className="text-amber-300/80 text-lg">⚠</span>
              <span className="text-base font-bold text-slate-100">{confirmAction.title}</span>
            </div>
            <div className="px-5 py-4 text-[13px] text-slate-300 leading-relaxed">{confirmAction.desc}</div>
            <div className="px-5 py-3 border-t border-edge bg-panel/60 flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded border border-edge text-dim hover:text-slate-200 text-sm font-mono transition-colors">取消</button>
              <button onClick={() => { const run = confirmAction.run; setConfirmAction(null); run(); }}
                className="px-3 py-1.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm font-mono transition-colors">确定</button>
            </div>
          </div>
        </div>
      )}
      {onSceneDetailId && useNpc.getState().npcs[onSceneDetailId] && (
        <NpcDetail
          npc={useNpc.getState().npcs[onSceneDetailId]}
          list={Object.values(useNpc.getState().npcs)}
          onClose={() => setOnSceneDetailId(null)}
          onSelect={(id) => setOnSceneDetailId(id)}
        />
      )}
      {insightOpen && <TurnInsightPanel onClose={() => setInsightOpen(false)} />}
      {charPanelOpen && (
        <CharacterPanel onClose={() => setCharPanelOpen(false)} />
      )}

      {/* ── 装备面板弹窗 ── */}
      {equipOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEquipOpen(false); }}
        >
          <div className="w-full max-w-3xl h-[88vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">
            {/* 标题栏 */}
            <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
              <span className="text-god/60 text-lg">⚔</span>
              <div>
                <div className="text-sm font-bold text-slate-100">装备栏</div>
                <div className="text-[10px] font-mono text-dim/60">主角当前装备配置</div>
              </div>
              <div className="flex-1"/>
              <button
                onClick={() => setEquipOpen(false)}
                className="text-dim hover:text-blood text-lg font-mono transition-colors"
              >✕</button>
            </header>
            {/* 装备面板内容 */}
            <EquipmentPanel onDetailOpen={() => {}} />
          </div>
        </div>
      )}

      {/* ── 全局 API 工作指示器（顶部固定）── */}
      {(generating || itemPhaseRunning) && (
        <div className="fixed inset-x-0 top-0 z-[200] pointer-events-none flex flex-col">
          {/* 滑动光条 */}
          <div className="h-[2px] bg-god/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-transparent via-god to-transparent"
              style={{ width: '40%', animation: 'apiSlide 1.4s ease-in-out infinite' }}
            />
          </div>
          {/* 文字提示 */}
          <div className="self-center mt-1 flex items-center gap-2 bg-panel/95 backdrop-blur-sm border border-god/25 rounded-full px-3 py-0.5 text-[11px] font-mono shadow-lg">
            <span className="animate-spin inline-block text-xs text-god">◌</span>
            {generating && (
              <span className="text-god/85">正在进行剧情生成</span>
            )}
            {generating && itemPhaseRunning && (
              <span className="text-dim/60">·</span>
            )}
            {itemPhaseRunning && (
              <span className="text-amber-400/85">正在进行物品更新</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorldCardView({ worlds, index, onPrev, onNext, onJump, onSelect, onClose }: {
  worlds: WorldOption[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  onSelect: (name: string, world: WorldOption) => void;
  onClose: () => void;
}) {
  const world = worlds[index];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-void/90 backdrop-blur-sm px-6">
      {/* 关闭 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-5 text-dim hover:text-blood text-sm font-mono transition-colors"
      >
        ✕ 关闭
      </button>

      {/* 计数 */}
      <div className="mb-2 text-sm font-mono text-dim tracking-widest">
        {index + 1} / {worlds.length}
      </div>

      {/* 卡片 + 左右箭头 */}
      <div className="flex items-stretch gap-4 w-full max-w-4xl" style={{ maxHeight: 'calc(100vh - 170px)' }}>
        {/* 左箭头 */}
        <button
          onClick={onPrev}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ‹
        </button>

        {/* 卡片 */}
        <div className="flex-1 border border-god/30 rounded-2xl bg-panel shadow-[0_0_50px_rgba(70,227,207,0.08)] overflow-hidden flex flex-col min-h-0">

          {/* ── 头部：编号 + 世界名 + 类型 ── */}
          <div className="px-8 pt-4 pb-3.5 border-b border-edge shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-mono text-god/40 tracking-widest uppercase">
                World · {String(index + 1).padStart(2, '0')}
              </span>
              {world.worldType && (
                <span className="text-sm font-mono px-3 py-0.5 border border-god/20 text-god/60 rounded">
                  {world.worldType}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-slate-100 leading-snug god-glow mt-0.5">{world.name}</h2>
            {/* 阶位 + 难度 + 区域 */}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {world.tier !== '' && (
                <span className="text-base font-mono text-sky-400/80">
                  {typeof world.tier === 'number' || /^\d+$/.test(world.tier)
                    ? `${world.tier} 阶`
                    : world.tier}
                </span>
              )}
              {world.dangerLevel && (
                <span className="text-base font-mono text-amber-400/80">{world.dangerLevel}</span>
              )}
              {world.region && (
                <span className="text-sm font-mono text-dim truncate max-w-sm">📍 {world.region}</span>
              )}
            </div>
          </div>

          {/* ── 可滚动正文 ── */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-edge/40">
            {world.desc       && <CardSection label="世界简介" content={world.desc} />}
            {world.peakPower  && <CardSection label="巅峰战力" content={world.peakPower} />}
            {world.contractorDist && <CardSection label="契约者分布" content={world.contractorDist} />}
            {world.entryPoint && <CardSection label="切入点"   content={world.entryPoint}  accent="god" />}
            {world.mainMission && <CardSection label="主线任务" content={world.mainMission} accent="amber" />}
            {world.sideMission && <CardSection label="支线任务" content={world.sideMission} />}
            {world.warning    && <CardSection label="警告"     content={world.warning}     accent="blood" />}
            {world.reward     && <CardSection label="奖励预览" content={world.reward}      accent="gold" />}
          </div>

          {/* ── 底部按钮 ── */}
          <div className="px-8 py-3 border-t border-edge text-center shrink-0">
            <button
              onClick={() => onSelect(world.name, world)}
              className="px-12 py-2.5 border border-god/50 text-god text-base rounded-xl hover:bg-god/10 font-mono transition-colors"
            >
              进入此世界
            </button>
          </div>
        </div>

        {/* 右箭头 */}
        <button
          onClick={onNext}
          className="shrink-0 w-11 h-11 self-center flex items-center justify-center border border-edge rounded-full text-dim hover:border-god/50 hover:text-god transition-colors text-2xl"
        >
          ›
        </button>
      </div>

      {/* 缩略点导航 */}
      <div className="mt-3 flex gap-2">
        {worlds.map((_, i) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === index ? 'bg-god scale-125' : 'bg-dim/40 hover:bg-dim'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

const accentMap: Record<string, string> = {
  god:   'text-god/60',
  amber: 'text-amber-400/70',
  blood: 'text-blood/70',
  gold:  'text-gold/70',
};

function CardSection({ label, content, accent }: { label: string; content: string; accent?: string }) {
  const labelColor = accent ? accentMap[accent] ?? 'text-dim' : 'text-dim';
  return (
    <div className="px-8 py-3">
      <div className={`text-sm font-mono mb-1 ${labelColor}`}>{label}</div>
      <p className="text-[15px] text-slate-300 leading-relaxed">{content}</p>
    </div>
  );
}
