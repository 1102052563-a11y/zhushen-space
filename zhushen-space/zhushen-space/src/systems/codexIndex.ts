/* 正文关键词悬浮图鉴 · 实体词典（2026-07-24）
   ─────────────────────────────────────────────────────────────────────────────
   把「本档里已经存在的具名实体」（NPC/物品/技能/天赋/称号/副职业/势力/万族/领地/团队效果/阶位）
   + 可选的「轮回 wiki 人物」编成一部 **字面名 → 词条** 的索引，供 narrativeHtml 渲染散文行时
   做最长匹配，给命中的词套 <span class="zs-ent" data-ek="…">；悬浮卡（CodexHover）再按 data-ek 取词条。

   ⚠ 性能铁则（打字卡顿的教训）——本模块被正文渲染器在**流式每帧**调用：
   1. **零订阅**：一律 `useX.getState()`，绝不 hook；调用方（MessageRow）也不许因此新增 store 订阅。
   2. **惰性重建 + 引用比对**：getCodexIndex() 每次只做 ~10 次对象引用比较（zustand 不可变更新保证
      写入必换引用）；没变直接返回上次索引。真正的重建只在实体真的增删改时发生。
   3. **首字快筛**：扫描按 heads(Set<首字>) 过一遍，未命中的字符 O(1) 跳过；命中才按长度降序探 Map。
      故复杂度 ≈ O(正文长度)，与词典大小无关。
   4. 索引 version 单调自增，进渲染缓存签名 → 实体变了旧楼层不会拿到过期 HTML。

   ⚠ 匹配铁则：**位置保持**。不做 normName 那种「删标点再比对」的归一（会让下标对不上原文，
   没法把 span 插回去）。变体靠「同一词条注册多个字面名」（全名 + 分隔段 + wiki 别名）解决。 */

import { useNpc, hasRealName } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useFaction } from '../store/factionStore';
import { useCosmos } from '../store/cosmosStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';
import { TIERS, TIER_LEVEL_RANGE, ATTR_CAP_BY_TIER } from './derivedStats';
import { lunhuiCharsCached, loadLunhuiCharacters, parseLunhuiChar, stripMd } from './lunhuiChars';
import { useMisc } from '../store/miscStore';
import { getWorldDetail } from './worldDetail';
import { parseWorldDetailCodex, type WorldCodexLite } from './worldDetailCodex';

export type CodexKind =
  | 'npc' | 'item' | 'skill' | 'talent' | 'title' | 'subprof'
  | 'faction' | 'cosmos' | 'territory' | 'perk' | 'tier' | 'wiki'
  | 'wchar' | 'witem';

/** 四色系：人物 / 物件 / 能力 / 世界。CSS 按 data-ek 前缀分组着色。 */
export type CodexAccent = 'person' | 'thing' | 'power' | 'world';

/** data-ek 的类型短码（进 HTML，正文里可能出现几十次，越短越省） */
export const KIND_CODE: Record<CodexKind, string> = {
  npc: 'n', item: 'i', skill: 'k', talent: 't', title: 'l', subprof: 'p',
  faction: 'f', cosmos: 'c', territory: 'y', perk: 'm', tier: 'r', wiki: 'w',
  wchar: 'o', witem: 'v',
};
const ACCENT_OF: Record<CodexKind, CodexAccent> = {
  npc: 'person', wiki: 'person', wchar: 'person',
  item: 'thing', witem: 'thing',
  skill: 'power', talent: 'power', title: 'power', subprof: 'power', perk: 'power',
  faction: 'world', cosmos: 'world', territory: 'world', tier: 'world',
};

export interface CodexEntry {
  key: string;            // "n:C1" —— 进 HTML 的 data-ek
  kind: CodexKind;
  accent: CodexAccent;
  kindLabel: string;      // 卡片右上角的类型徽章
  name: string;           // 展示名（原名）
  icon: string;
  meta?: string;          // 副标题一行（阶位/品级/类别…）
  lines: string[];        // 正文若干行（已截断，最多 LINE_MAX 行）
  img?: string;           // 头像 / 物品图（dataURL 或 URL）
  npcId?: string;         // 仅 NPC：供悬浮卡「查看详情 →」跳 NpcPanel
  spoiler?: boolean;      // wiki 条目：原著设定，可能剧透
}

export interface CodexIndex {
  version: number;
  byKey: Map<string, CodexEntry>;
  byName: Map<string, CodexEntry>;   // 小写字面名 → 词条
  heads: Set<string>;                // 所有字面名的小写首字（快筛）
  maxLen: number;
  size: number;                      // 字面名条数（诊断用）
}

// ── 词条内容裁剪 ──
const LINE_MAX = 3;          // 卡片正文最多几行
const LINE_CHARS = 90;       // 每行截断
const META_CHARS = 60;
const NAME_MAX = 16;         // 字面名上限（超长的不进词典：正文不会原样出现，且拖慢最长匹配）
const NAME_TOTAL_CAP = 6000; // 字面名总数硬顶（防极端存档把扫描拖慢）

/* 停用词：这些名字一旦进词典就会在正文里满屏命中。哪怕真有实体叫这名，也不标——
   宁可漏一个，不可把整段正文变成下划线。 */
const STOP_NAMES = new Set([
  '主角', '自己', '对方', '敌人', '队友', '同伴', '所有人', '全体', '目标', '未知', '无',
  '世界', '乐园', '契约者', '猎杀者', '土著', '随从', '宠物', '召唤物',
  '状态', '效果', '技能', '物品', '装备', '道具', '任务', '属性', '天赋', '称号', '副职业',
  '时间', '地点', '人物', '势力', '领地', '团队', '背包', '仓库',
  '攻击', '防御', '生命', '体质', '力量', '敏捷', '智力', '精神', '幸运',
  'hp', 'ep', 'atk', 'def', 'lv', 'exp', 'none', 'null', 'n/a',
]);

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function cut(s: string, n: number): string {
  const t = txt(s).replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
function lines(...xs: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const t = cut(x ?? '', LINE_CHARS);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= LINE_MAX) break;
  }
  return out;
}
function meta(...xs: (string | undefined)[]): string | undefined {
  const t = xs.map((x) => txt(x ?? '')).filter(Boolean).join(' · ');
  return t ? cut(t, META_CHARS) : undefined;
}

/** 字面名合法性：太短/纯符号/像 id/停用词 一律拒绝。纯 ASCII 要 ≥4（挡掉 HP/EP/Lv 之类）。 */
export function usableName(raw: string): string | null {
  const s = txt(raw).replace(/^[【「『（(\[<《〈]+|[】」』）)\]>》〉]+$/g, '').trim();
  if (!s || s.length > NAME_MAX) return null;
  if (STOP_NAMES.has(s.toLowerCase())) return null;
  if (/^[CGBF]\d+$/i.test(s)) return null;                 // C1/G2/B1/F3 这类内部 id
  if (!/[一-鿿぀-ヿ가-힯A-Za-z]/.test(s)) return null;   // 必须含真正的文字（汉/假名/谚文/拉丁）
  if (/^[\x00-\x7F]+$/.test(s)) return s.length >= 4 ? s : null;
  return s.length >= 2 ? s : null;
}

/** 复合名的分隔段（神威·空洞褫夺 → 空洞褫夺）：玩家/AI 常只写核心段。≥3 字才收，避免通用短前缀。 */
function segmentsOf(name: string): string[] {
  const out: string[] = [];
  for (const seg of name.split(/[·•・|｜\/／\-—_,，、\s]+/)) {
    const s = usableName(seg);
    if (s && s !== name && s.length >= 3) out.push(s);
  }
  return out;
}

// ══════════════════ 索引构建 ══════════════════

class Builder {
  byKey = new Map<string, CodexEntry>();
  byName = new Map<string, CodexEntry>();
  heads = new Set<string>();
  maxLen = 0;
  private segQueue: [string, CodexEntry][] = [];

  /** 注册一个词条。先来先得——调用顺序即优先级（本档实体 > wiki 原著设定）。 */
  add(kind: CodexKind, id: string, name: string, e: Omit<CodexEntry, 'key' | 'kind' | 'accent' | 'kindLabel' | 'name'>, extraNames: string[] = []) {
    const nm = usableName(name);
    if (!nm) return;
    const key = `${KIND_CODE[kind]}:${id}`;
    if (this.byKey.has(key)) return;
    const entry: CodexEntry = { ...e, key, kind, accent: ACCENT_OF[kind], kindLabel: KIND_LABEL[kind], name: nm };
    this.byKey.set(key, entry);
    this.bind(nm, entry);
    for (const a of extraNames) { const an = usableName(a); if (an) this.bind(an, entry); }
    for (const s of segmentsOf(nm)) this.segQueue.push([s, entry]);   // 分隔段延后，让全名先占坑
  }

  private bind(name: string, entry: CodexEntry) {
    if (this.byName.size >= NAME_TOTAL_CAP) return;
    const k = name.toLowerCase();
    if (this.byName.has(k)) return;                       // 撞名：先注册的赢
    this.byName.set(k, entry);
    this.heads.add(k[0]);
    if (name.length > this.maxLen) this.maxLen = name.length;
  }

  finish(version: number): CodexIndex {
    for (const [s, e] of this.segQueue) this.bind(s, e);
    return { version, byKey: this.byKey, byName: this.byName, heads: this.heads, maxLen: this.maxLen, size: this.byName.size };
  }
}

const KIND_LABEL: Record<CodexKind, string> = {
  npc: '人物', item: '物品', skill: '技能', talent: '天赋', title: '称号', subprof: '副职业',
  faction: '势力', cosmos: '万族', territory: '领地', perk: '团队', tier: '阶位', wiki: '原著',
  wchar: '原著人物', witem: '原著宝物',
};

function npcIcon(r: { isDead?: boolean; npcTag?: string; partyMember?: boolean; isFriend?: boolean }): string {
  if (r.isDead) return '💀';
  if (r.npcTag === '宠物' || r.npcTag === '召唤物') return '🐾';
  if (r.npcTag === '随从' || r.partyMember) return '🤝';
  if (r.isFriend) return '💠';
  return '👤';
}
const COSMOS_ICON: Record<string, string> = { 乐园: '🏛', 种族: '🧬', 文明组织: '🛰', 原生世界: '🌍', 神灵: '✴', 深渊: '🕳' };

/* 各源 → 词条。顺序即撞名优先级：本档 NPC/势力/物品 最先，wiki 原著垫底。 */
function build(version: number, wiki: WikiEntryLite[] | null, world: WorldCodexLite[] | null): CodexIndex {
  const b = new Builder();
  const safe = (fn: () => void) => { try { fn(); } catch { /* 单个源取数失败不该毁掉整部词典 */ } };

  // ① NPC（在场/好友/随从优先注册，撞名时压过归档路人）
  safe(() => {
    const npcs = Object.values(useNpc.getState().npcs ?? {});
    const rank = (r: any) => (r.isFriend || r.partyMember || r.keepForever ? 0 : r.onScene ? 1 : r.archived ? 3 : 2);
    for (const r of [...npcs].sort((a: any, x: any) => rank(a) - rank(x))) {
      const n: any = r;
      if (!hasRealName(n)) continue;
      b.add('npc', n.id, n.name, {
        icon: npcIcon(n),
        meta: meta(n.realm, n.title || n.profession || n.npcTag, n.isDead ? '已故' : n.archived ? '已归档' : undefined),
        lines: lines(n.status, n.review || n.personality, n.background),
        img: txt(n.avatar) || undefined,
        npcId: n.id,
      });
    }
  });

  // ② 势力
  safe(() => {
    for (const f of Object.values(useFaction.getState().factions ?? {}) as any[]) {
      b.add('faction', f.id, f.name, {
        icon: f.isDestroyed ? '🏴' : '⚑',
        meta: meta(f.type, f.powerLevel, f.isDestroyed ? '已覆灭' : f.status),
        lines: lines(f.goal, f.leader ? `首领：${f.leader}` : '', f.territory || f.background),
      });
    }
  });

  // ③ 物品（背包）
  safe(() => {
    for (const it of (useItems.getState().items ?? []) as any[]) {
      b.add('item', it.id, it.name, {
        icon: '🎒',
        meta: meta(it.gradeDesc, it.category, it.enhanceLevel ? `+${it.enhanceLevel}` : ''),
        lines: lines(it.effect, it.affix, it.intro || it.notes),
        img: txt(it.image) || undefined,
      });
    }
  });

  // ④ 技能 / 天赋 / 称号 / 副职业（全角色，主角 B1 先）
  safe(() => {
    const chars = useCharacters.getState().characters ?? {};
    const ids = Object.keys(chars).sort((a, x) => (a === 'B1' ? -1 : x === 'B1' ? 1 : 0));
    for (const cid of ids) {
      const c: any = chars[cid];
      if (!c) continue;
      for (const s of (c.skills ?? []) as any[])
        b.add('skill', s.id || `${cid}-${s.name}`, s.name, {
          icon: '✨', meta: meta(s.rarity, s.skillType, s.level ? `Lv.${s.level}` : ''),
          lines: lines(s.desc, s.effect, s.note),
        });
      for (const t of (c.traits ?? []) as any[])
        b.add('talent', `${cid}-${t.name}`, t.name, {
          icon: '🧬', meta: meta(t.rarity, t.category, t.source),
          lines: lines(t.desc, t.effect, t.note),
        });
      for (const t of (c.titles ?? []) as any[])
        b.add('title', `${cid}-${t.name}`, t.name, {
          icon: '🏅', meta: meta(t.rarity, t.equipped ? '佩戴中' : '', t.source),
          lines: lines(t.effect, t.bonusEffect, t.desc),
        });
      for (const p of (c.subProfessions ?? []) as any[]) {
        b.add('subprof', `${cid}-${p.name}`, p.name, {
          icon: '⚒', meta: meta(p.tier, p.category, '副职业'),
          lines: lines(p.desc, p.effect, p.recipeLabel),
        });
        for (const r of (p.recipes ?? []) as any[])
          b.add('subprof', r.id || `${cid}-${p.name}-${r.name}`, r.name, {
            icon: '📜', meta: meta(r.tier, `${p.name} 配方`),
            lines: lines(r.desc, r.output ? `产出：${r.output}` : '', r.materials ? `材料：${r.materials}` : ''),
          });
      }
    }
  });

  // ⑤ 万族（只收主角已知晓的：没接触过的不该在正文里被剧透）
  safe(() => {
    for (const e of (useCosmos.getState().entities ?? []) as any[]) {
      if (!e.isPlayerKnown) continue;
      b.add('cosmos', e.id, e.name, {
        icon: COSMOS_ICON[e.category] || '🌌',
        meta: meta(e.category, e.power, e.destroyed ? '已覆灭' : e.status),
        lines: lines(e.goal, e.territory, e.towardParadise),
      });
    }
  });

  // ⑥ 领地（建筑 / 效果 / 领地本体）
  safe(() => {
    const t: any = useTerritory.getState();
    if (t.unlocked && txt(t.name))
      b.add('territory', 'self', t.name, {
        icon: '🏰', meta: meta('领地', t.level ? `Lv.${t.level}` : ''),
        lines: lines(t.appearance, t.passiveOutput),
      });
    for (const g of (t.buildings ?? []) as any[])
      b.add('territory', `b-${g.id}`, g.name, {
        icon: '🏛', meta: meta('领地建筑', g.level ? `Lv.${g.level}` : ''),
        lines: lines(g.effect, g.description, g.appearance),
      });
    for (const e of (t.effects ?? []) as any[])
      b.add('territory', `e-${e.name}`, e.name, {
        icon: '🌿', meta: meta('领地效果', e.source),
        lines: lines(e.desc),
      });
  });

  // ⑦ 冒险团效果
  safe(() => {
    for (const p of (useTeam.getState().perks ?? []) as any[])
      b.add('perk', `p-${p.name}`, p.name, {
        icon: '🎖', meta: meta('冒险团效果', p.source),
        lines: lines(p.desc),
      });
  });

  // ⑧ 阶位（14 阶·常驻）——新玩家最想悬浮的就是「绝强 是什么」
  safe(() => {
    for (const t of TIERS) {
      const rg = TIER_LEVEL_RANGE[t];
      const cap = ATTR_CAP_BY_TIER[t];
      b.add('tier', t, t, {
        icon: '📶',
        meta: meta('阶位', rg ? (Number.isFinite(rg[1]) ? `Lv.${rg[0]}~${rg[1]}` : `Lv.${rg[0]}+`) : ''),
        lines: lines(
          cap ? `单属性极值 ${cap}` : '单属性无数值上限（EX）',
          `轮回乐园战力阶位第 ${TIERS.indexOf(t) + 1}/${TIERS.length} 档`,
        ),
      });
    }
  });

  // ⑨ 当前世界的原著档案（【主要人物】/【贵重物品】·可选层）——比全局 wiki 更贴近眼下这一场，
  //    故排在它前面；但仍让位于本档实体：玩家真见过的 NPC 优先于档案里的同名人。
  if (world) for (const w of world) {
    b.add(w.kind, w.id, w.name, {
      icon: w.kind === 'wchar' ? '📖' : '💠', meta: w.meta, lines: w.lines, spoiler: true,
    }, w.aliases);
  }

  // ⑩ 轮回 wiki 人物（可选层·原著设定·可能剧透 → 垫底注册，永远让位于本档实体）
  if (wiki) for (const w of wiki) {
    b.add('wiki', w.id, w.name, {
      icon: '📚', meta: w.meta, lines: w.lines, spoiler: true,
    }, w.aliases);
  }

  return b.finish(version);
}

// ══════════════════ wiki 层（异步·可选） ══════════════════

interface WikiEntryLite { id: string; name: string; meta?: string; lines: string[]; aliases: string[] }
let _wiki: WikiEntryLite[] | null = null;
let _wikiLoading = false;

function digestWiki(): WikiEntryLite[] {
  const all = lunhuiCharsCached() ?? [];
  const out: WikiEntryLite[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    const d = parseLunhuiChar(c);
    if (!d.name || seen.has(d.name)) continue;
    seen.add(d.name);
    out.push({
      id: d.name,
      name: d.name,
      meta: meta(d.front['分类'] ? stripMd(d.front['分类']) : '', stripMd(d.front['身份'] || ''), d.world),
      lines: lines(stripMd(d.front['阶位'] || ''), stripMd(d.front['所属'] || d.front['职业'] || ''), d.brief),
      aliases: d.aliases,
    });
  }
  return out;
}

/** wiki 层按需拉取；就绪后自增版本，下一次渲染自然带上（不强行重渲，避免打扰正在读的楼层）。 */
function ensureWiki(on: boolean) {
  if (!on) { if (_wiki) { _wiki = null; _ver++; _idx = null; } return; }
  if (_wiki || _wikiLoading) return;
  if (lunhuiCharsCached()) { _wiki = digestWiki(); _ver++; _idx = null; return; }
  _wikiLoading = true;
  void loadLunhuiCharacters().then(() => {
    _wiki = digestWiki(); _ver++; _idx = null;
  }).catch(() => { /* 拉不到就一直没有 wiki 层，其余照常 */ })
    .finally(() => { _wikiLoading = false; });
}

// ── 当前世界的原著档案层（异步·可选·跟随世界切换） ──
let _wdet: WorldCodexLite[] | null = null;
let _wdetName = '';              // 已装载/已尝试过的世界名（'' = 未装载）
let _wdetLoading = false;
const HUB_WORLD = /轮回乐园|专属房间|主神空间/;   // 乐园本部无原著档案（与 miscStore.setTime 同款判断）

/** 当前世界的【主要人物】/【贵重物品】按需装载；世界一换就重装。
    与 ensureWiki 同款：异步就绪后自增版本，下次渲染自然带上，不强行重渲打扰正在读的楼层。
    数据走 getWorldDetail 的进程内缓存——callApi 每回合已 ensureWorldDetailFor 预取过，
    这里通常是内存命中，不产生额外网络。
    ⚠ 成功与失败都要落 _wdetName：本函数被流式每帧调用，不标记「已试过」的话，
      查无此世界的档案会变成每 100ms 一次重复请求。 */
function ensureWorldDetail(on: boolean) {
  const cur = on ? txt(useMisc.getState().worldName) : '';
  if (!cur || HUB_WORLD.test(cur)) {
    if (_wdet || _wdetName) { _wdet = null; _wdetName = ''; _ver++; _idx = null; }
    return;
  }
  if (_wdetName === cur || _wdetLoading) return;
  _wdetLoading = true;
  void getWorldDetail(cur)
    .then((d) => { _wdet = d ? parseWorldDetailCodex(d.plot, d.name) : null; })
    .catch(() => { _wdet = null; })
    .finally(() => { _wdetName = cur; _wdetLoading = false; _ver++; _idx = null; });
}

// ══════════════════ 惰性重建（引用比对） ══════════════════

let _idx: CodexIndex | null = null;
let _deps: unknown[] = [];
let _ver = 0;

function deps(): unknown[] {
  const t: any = (() => { try { return useTerritory.getState(); } catch { return {}; } })();
  const grab = <T,>(fn: () => T): T | undefined => { try { return fn(); } catch { return undefined; } };
  return [
    grab(() => useNpc.getState().npcs),
    grab(() => useItems.getState().items),
    grab(() => useCharacters.getState().characters),
    grab(() => useFaction.getState().factions),
    grab(() => useCosmos.getState().entities),
    t.buildings, t.effects, t.name, t.unlocked, t.level,
    grab(() => useTeam.getState().perks),
    _wiki,
    _wdet,
  ];
}

/**
 * 取当前索引（惰性重建）。`wikiOn` 控制是否并入轮回 wiki 人物层。
 * 每次调用成本 ≈ 12 次引用比较；只有实体真变了才重建。
 */
export function getCodexIndex(wikiOn = false): CodexIndex {
  ensureWiki(wikiOn);
  ensureWorldDetail(wikiOn);
  const d = deps();
  if (_idx && d.length === _deps.length && d.every((x, i) => x === _deps[i])) return _idx;
  _deps = d;
  _idx = build(++_ver, _wiki, _wdet);
  return _idx;
}

/** 测试/热重载用：丢弃缓存（含 wiki 层与世界档案层）。 */
export function resetCodexIndex() {
  _idx = null; _deps = []; _wiki = null; _wikiLoading = false;
  _wdet = null; _wdetName = ''; _wdetLoading = false;
}

/** 悬浮卡查词条。**绝不因一次悬浮就重建**已有索引（实体被删导致查不到 → 干脆不弹卡，
    好过为一次悬浮重跑整部词典）；索引压根还没建过时才建一次——这条是给「设置页的示例词条」用的：
    那里在任何正文渲染之前就有 .zs-ent。⚠ 走的是内部 build，不碰 wiki 开关，免得误把已加载的 wiki 层清掉。 */
export function lookupCodex(key: string): CodexEntry | undefined {
  if (!_idx) { try { _idx = build(++_ver, _wiki, _wdet); _deps = deps(); } catch { return undefined; } }
  return _idx.byKey.get(key);
}

// ══════════════════ 扫描器 ══════════════════

export interface CodexMatch { start: number; end: number; entry: CodexEntry }

const ASCII_WORD = /[0-9A-Za-z_]/;
const PURE_ASCII = /^[\x00-\x7F]+$/;

/**
 * 在纯文本片段里找实体名（最长优先·不重叠）。
 * `seen` 跨调用共享 → 同一条消息里每个实体**只标首次**（正文里主角名出现二十次不会变成二十条下划线）。
 */
export function scanEntities(text: string, idx: CodexIndex, seen: Set<string>): CodexMatch[] {
  const out: CodexMatch[] = [];
  if (!text || !idx.maxLen) return out;
  const n = text.length;
  const low = text.toLowerCase();       // 长度与原文一一对应（CJK 不变形，ASCII 仅换大小写）
  let i = 0;
  while (i < n) {
    if (!idx.heads.has(low[i])) { i++; continue; }
    const max = Math.min(idx.maxLen, n - i);
    let hit: CodexEntry | undefined; let len = 0;
    for (let L = max; L >= 2; L--) {
      const e = idx.byName.get(low.substr(i, L));
      if (e) { hit = e; len = L; break; }
    }
    if (!hit) { i++; continue; }
    // 纯 ASCII 名要求词边界：技能 "Fire" 不该命中 "Firewall"
    if (PURE_ASCII.test(low.substr(i, len)) &&
        (ASCII_WORD.test(text[i - 1] ?? '') || ASCII_WORD.test(text[i + len] ?? ''))) { i++; continue; }
    if (!seen.has(hit.key)) { seen.add(hit.key); out.push({ start: i, end: i + len, entry: hit }); }
    i += len;
  }
  return out;
}
