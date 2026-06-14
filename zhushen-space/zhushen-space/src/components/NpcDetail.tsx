import { useState, useRef } from 'react';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useCharacters, RARITY_CLS, ELEMENT_CLS, type Deed } from '../store/characterStore';
import { computeDerived, lvFromRealm, normalizeTier, realmFromLevel, trueAttr, computeMaxHp, computeMaxEp, gearMaxHpBonus, gearMaxEpBonus, effectiveResource } from '../systems/derivedStats';
import { computeAttrBreakdown, ATTR_LABEL, type AttrBreak } from '../systems/attrBonus';
import type { PlayerAttrs } from '../store/playerStore';
import { gradeBadgeClass, gradeNameClass } from '../store/itemStore';
import NpcEquip from './NpcEquip';
import StatusEffectChips from './StatusEffectChips';
import { useImageGen, effectiveEquipService } from '../store/imageGenStore';
import { generateImage, buildPortraitPrompt, buildEquipPrompt, shrinkDataUrl } from '../systems/imageGen';
import { useImageViewer } from '../store/imageViewerStore';
import { genPortraitTags, genEquipTags, isTagService } from '../systems/imageTags';

/* ════════════════════════════════════════════
   单个 NPC 详情（轮回乐园适配 · 多栏目）
════════════════════════════════════════════ */

type TabKey =
  | 'basic' | 'portrait' | 'hidden' | 'custom' | 'attr' | 'bag'
  | 'equip' | 'skill' | 'trait' | 'relation' | 'history';

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'basic',    icon: '👤', label: '基本信息' },
  { key: 'portrait', icon: '🖼', label: '肖像绘卷' },
  { key: 'hidden',   icon: '🙈', label: '隐秘' },
  { key: 'custom',   icon: '▦',  label: '自定义列' },
  { key: 'attr',     icon: '⚡', label: '属性' },
  { key: 'bag',      icon: '🎒', label: '储存空间' },
  { key: 'equip',    icon: '🛡', label: '装备' },
  { key: 'skill',    icon: '✦',  label: '技能' },
  { key: 'trait',    icon: '❖',  label: '天赋' },
  { key: 'relation', icon: '👥', label: '关系' },
  { key: 'history',  icon: '📖', label: '经历' },
];

/* 第16列：动作|穿着|位置|身段|样貌 */
function parseAppearance5(s: string) {
  const seg = (s || '').split('|');
  return {
    action: seg[0]?.trim() ?? '',
    outfit: seg[1]?.trim() ?? '',
    location: seg[2]?.trim() ?? '',
    figure: seg[3]?.trim() ?? '',
    look: seg[4]?.trim() ?? '',
  };
}
/* 阶位字段：阶位·Lv.X|身份 */
function parseRealm(realm: string) {
  const [head, role] = (realm || '').split('|');
  const hasLv = /Lv\.?\s*\d+/i.test(realm || '');
  const lv = hasLv ? lvFromRealm(realm) : null;
  // 阶位只取合法名（一阶~无上之境）；存量脏数据（如"结丹中期·Lv.25"）按 Lv 推导
  const tier = normalizeTier(head || '') || (lv != null ? realmFromLevel(lv) : '');
  return { tier, lv, role: (role || '').trim() };
}

function favorCls(v: number) {
  if (v >= 60) return 'text-rose-400';
  if (v >= 30) return 'text-amber-400';
  if (v >= 0) return 'text-slate-300';
  if (v >= -30) return 'text-sky-400';
  return 'text-blood';
}

export default function NpcDetail({
  npc, list, onClose, onSelect,
}: {
  npc: NpcRecord;
  list: NpcRecord[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<TabKey>('basic');
  const [confirmDel, setConfirmDel] = useState(false);
  const upsertNpc = useNpc((s) => s.upsertNpc);
  const clearNpcBag = useNpc((s) => s.clearNpcBag);
  const hardRemoveNpc = useNpc((s) => s.hardRemoveNpc);
  const chars = useCharacters((s) => s.characters);
  const cdata = chars[npc.id];
  const skills = cdata?.skills ?? [];
  const traits = cdata?.traits ?? [];

  const idx = list.findIndex((r) => r.id === npc.id);
  const realm = parseRealm(npc.realm);
  const genderCls = npc.gender === '女' ? 'text-rose-400' : npc.gender === '男' ? 'text-sky-400' : 'text-dim/40';

  const equipped = (npc.items ?? []).filter((i) => i.equipped);
  const bag = (npc.items ?? []).filter((i) => !i.equipped);

  const counts: Partial<Record<TabKey, number>> = {
    bag: bag.length, equip: equipped.length, skill: skills.length, trait: traits.length,
    relation: npc.relations ? npc.relations.split(';').filter(Boolean).length : 0,
    custom: Object.keys(npc.extra ?? {}).filter((k) => !PRIVATE_KEYS.has(k)).length,
    history: npc.deedLog?.length ?? 0,
  };

  function go(delta: number) {
    if (list.length === 0) return;
    const n = (idx + delta + list.length) % list.length;
    onSelect(list[n].id);
    setTab('basic');
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-stretch justify-center p-0 sm:p-4">
      <div className="w-full max-w-5xl flex flex-col rounded-none sm:rounded-2xl border border-edge bg-void shadow-[0_0_80px_rgba(0,0,0,0.85)] overflow-hidden">

        {/* ── 头部 ── */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-gradient-to-b from-panel to-void">
          <div className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center text-lg font-bold ${
            npc.onScene ? 'border-god/40 bg-god/5 text-god' : 'border-edge bg-void text-dim/50'
          }`}>
            {(npc.name || npc.id).slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-slate-100 truncate">{npc.name || npc.id}</span>
              {npc.gender && <span className={`text-sm font-mono px-1.5 py-0.5 rounded border border-edge ${genderCls}`}>{npc.gender}</span>}
              {!npc.onScene && <span className="text-[12px] font-mono text-dim/50">离场</span>}
              {npc.isDead && <span className="text-[12px] font-mono text-blood">已死亡</span>}
            </div>
            <div className="text-sm font-mono text-dim/70 truncate">
              {realm.tier || '—'}{realm.lv != null ? ` Lv.${realm.lv}` : ''}{realm.role ? ` · ${realm.role}` : ''}
            </div>
          </div>

          <div className="flex-1" />

          {/* 离场/上场 */}
          <button
            onClick={() => upsertNpc(npc.id, { onScene: !npc.onScene })}
            className={`hidden sm:inline-flex px-3 py-1.5 text-sm rounded-lg border font-mono transition-colors ${
              npc.onScene ? 'border-edge text-dim hover:border-amber-600/50 hover:text-amber-400' : 'border-god/40 text-god hover:bg-god/10'
            }`}
          >
            {npc.onScene ? '令其离场' : '重新上场'}
          </button>

          {/* 直接删除该 NPC（物理删除，连同其技能/天赋一并清除；两步确认）*/}
          <button
            onClick={() => { if (confirmDel) { hardRemoveNpc(npc.id); onClose(); } else setConfirmDel(true); }}
            onMouseLeave={() => setConfirmDel(false)}
            title="彻底删除该 NPC（不可恢复）"
            className={`inline-flex px-3 py-1.5 text-sm rounded-lg border font-mono transition-colors ${
              confirmDel ? 'border-blood bg-blood/15 text-blood' : 'border-edge text-dim/60 hover:border-blood/50 hover:text-blood'
            }`}
          >
            {confirmDel ? '确认删除？' : '🗑 删除'}
          </button>

          {/* 上一个 / 选择 / 下一个 */}
          <div className="flex items-center gap-1">
            <button onClick={() => go(-1)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-god hover:border-god/40 transition-colors text-sm">‹</button>
            <select
              value={npc.id}
              onChange={(e) => { onSelect(e.target.value); setTab('basic'); }}
              className="bg-panel border border-edge rounded-lg px-2 py-1.5 text-sm font-mono text-slate-200 outline-none focus:border-god max-w-[8rem]"
            >
              {list.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
            </select>
            <button onClick={() => go(1)} className="w-7 h-7 rounded-lg border border-edge text-dim hover:text-god hover:border-god/40 transition-colors text-sm">›</button>
          </div>

          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg border border-edge text-dim hover:text-blood hover:border-blood/40 transition-colors text-sm">✕</button>
        </header>

        {/* ── 栏目条 ── */}
        <nav className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-edge bg-panel overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${
                tab === t.key ? 'bg-god/10 text-god border border-god/40' : 'text-dim hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="opacity-80">{t.icon}</span>
              {t.label}
              {counts[t.key] !== undefined && counts[t.key]! > 0 && (
                <span className="text-[11px] px-1 rounded bg-void/60 text-dim/70">{counts[t.key]}</span>
              )}
            </button>
          ))}
        </nav>

        {/* ── 内容 ── */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'basic'    && <BasicTab npc={npc} realm={realm} genderCls={genderCls} />}
          {tab === 'portrait' && <PortraitTab npc={npc} />}
          {tab === 'hidden'   && <HiddenTab npc={npc} />}
          {tab === 'custom'   && <CustomTab npc={npc} />}
          {tab === 'attr'     && <AttrTab npc={npc} realm={realm} />}
          {tab === 'bag'      && <ItemsTab items={bag} empty="储存空间空空如也" ownerId={npc.id} ownerGender={npc.gender} onClear={() => clearNpcBag(npc.id)} />}
          {tab === 'equip'    && <NpcEquip npc={npc} />}
          {tab === 'skill'    && <SkillTab skills={skills} />}
          {tab === 'trait'    && <TraitTab traits={traits} />}
          {tab === 'relation' && <RelationTab npc={npc} list={list} onSelect={onSelect} />}
          {tab === 'history'  && <HistoryTab npc={npc} />}
        </div>
      </div>
    </div>
  );
}

/* ────────── 通用小组件 ────────── */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-mono text-god/70 uppercase tracking-widest">{title}</h3>
        {hint && <span className="text-[12px] text-dim/50">{hint}</span>}
      </div>
      <div className="rounded-xl border border-edge bg-panel/60 p-4 space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-void/40 border border-edge/60 px-3 py-2">
      <div className="text-[12px] font-mono text-dim/50">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${accent ? 'text-god' : value ? 'text-slate-200' : 'text-dim/40'}`}>
        {value || '未设置'}
      </div>
    </div>
  );
}
function Chip({ label, value, cls = 'text-slate-200' }: { label: string; value: string; cls?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-edge bg-void/40 px-2.5 py-1 text-sm font-mono">
      <span className="text-dim/50">{label}</span>
      <span className={cls}>{value}</span>
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-dim/40 text-sm font-mono border border-dashed border-edge rounded-xl">{text}</div>;
}

/* ── 当前状态/Buff 解析为状态胶囊（参考 fanren-remake 的状态栏样式）──
   格式：`状态名:Emoji(效果|激活条件|结束条件|来源)`，多个用 ；分隔；也兼容无括号简写 */
interface ParsedBuff { name: string; emoji: string; effect?: string; activate?: string; end?: string; source?: string }
function parseBuffs(status?: string): ParsedBuff[] {
  const s = (status ?? '').trim();
  if (!s || s === '一切正常') return [];
  return s.split(/[；;]\s*|\n+/).map((x) => x.trim()).filter(Boolean).map((seg) => {
    const m = /^(.+?)\s*[:：]?\s*([^\s:：(（]*?)\s*[（(]([\s\S]*)[)）]\s*$/.exec(seg);
    if (m) {
      const [effect, activate, end, source] = m[3].split(/\s*\|\s*/).map((p) => p && p.trim());
      // emoji 段若混入了名字（无 : 分隔时），尽量回退
      return { name: m[1].trim(), emoji: /[A-Za-z0-9一-龥]/.test(m[2]) ? '' : m[2], effect, activate, end, source };
    }
    const m2 = /^(.+?)\s*[:：]\s*(\S*)$/.exec(seg);
    if (m2) return { name: m2[1].trim(), emoji: /[A-Za-z0-9一-龥]/.test(m2[2]) ? '' : m2[2] };
    return { name: seg, emoji: '' };
  });
}
function buffTone(b: ParsedBuff): string {
  const t = b.name + (b.effect ?? '') + (b.source ?? '');
  if (/毒|伤|虚弱|疲惫|流血|麻痹|眩晕|衰弱|诅咒|损|寒|冻|灼|痛|病|昏迷|中毒|debuff|削弱|束缚|恐惧|混乱|魅惑|冰封/.test(t))
    return 'border-red-700/50 text-red-300 bg-red-900/20';
  if (/增益|强化|护|愈|恢复|提升|加成|盾|庇护|祝福|觉醒|充盈|buff|护脉|护体|加速|凝神/.test(t))
    return 'border-emerald-700/50 text-emerald-300 bg-emerald-900/20';
  return 'border-amber-700/40 text-amber-300 bg-amber-900/15';
}
export function StatusChips({ status, exclude }: { status?: string; exclude?: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ex = new Set((exclude ?? []).map((x) => (x ?? '').trim()).filter(Boolean));
  // 过滤掉与「限时状态」重名的自由文本状态，避免上下重复显示同一个状态
  const buffs = parseBuffs(status).filter((b) => !ex.has((b.name ?? '').trim()));
  if (buffs.length === 0) return ex.size ? null : <div className="text-sm text-emerald-300/70">一切正常</div>;
  const cur = open !== null ? buffs[open] : null;
  const scroll = buffs.length > 4;   // 超过4个用滑窗
  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap gap-1.5 ${scroll ? 'max-h-[5rem] overflow-y-auto onscene-scroll pr-1' : ''}`}>
        {buffs.map((b, i) => (
          <button key={i} onClick={() => setOpen(open === i ? null : i)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-sm font-mono transition-colors ${buffTone(b)} ${open === i ? 'ring-1 ring-god/40' : ''}`}>
            {b.emoji && <span>{b.emoji}</span>}
            <span>{b.name}</span>
          </button>
        ))}
      </div>
      {cur && (cur.effect || cur.activate || cur.end || cur.source) && (
        <div className="rounded-lg border border-edge bg-void/40 px-3 py-2 text-[13px] space-y-0.5">
          {cur.effect && <div><span className="text-dim/50">效果·</span> <span className="text-slate-200">{cur.effect}</span></div>}
          {cur.activate && <div><span className="text-dim/50">激活·</span> <span className="text-slate-300">{cur.activate}</span></div>}
          {cur.end && <div><span className="text-dim/50">结束·</span> <span className="text-slate-300">{cur.end}</span></div>}
          {cur.source && <div><span className="text-dim/50">来源·</span> <span className="text-slate-300">{cur.source}</span></div>}
        </div>
      )}
    </div>
  );
}

/** 把结构化文本（性格/当前状态/性经验等）按 ；; / 空格竖线 / 换行 切分成多行展示，
 *  并识别 [标签]/【标签】前缀作为左侧小标签。解决"一整块挤在一起"的问题。 */
export function SegmentedText({ text, fallback = '—', accent = false }: { text?: string; fallback?: string; accent?: boolean }) {
  const t = (text ?? '').trim();
  if (!t) return <div className="text-sm text-dim/40">{fallback}</div>;
  // 按 ；; 、被空格包围的竖线 | 、句号+空格（AI 常用作视觉分段，保留句号）、或换行切分；
  // buff 内部 (效果|激活|...) 无空格竖线不受影响
  const segs = t
    .replace(/。[ \t　]+/g, '。\n')
    .split(/[；;]\s*|\s+\|\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const tone = accent ? 'text-amber-300' : 'text-slate-200';
  if (segs.length <= 1) return <div className={`text-sm leading-relaxed whitespace-pre-wrap ${tone}`}>{t}</div>;
  return (
    <div className="space-y-1.5">
      {segs.map((s, i) => {
        const m = /^[[【]([^\]】]{1,12})[\]】][:：]?\s*([\s\S]*)$/.exec(s);
        if (m) {
          return (
            <div key={i} className="flex gap-2.5">
              <span className="shrink-0 text-[13px] font-mono text-god/60 mt-0.5 min-w-[64px]">{m[1]}</span>
              <span className={`flex-1 text-sm leading-relaxed ${tone}`}>{m[2]}</span>
            </div>
          );
        }
        return (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-god/40 mt-0.5">·</span>
            <span className={`flex-1 text-sm leading-relaxed ${tone}`}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ────────── 经历时间线（NPC/主角共用） ────────── */
export function DeedTimeline({
  log, legacy, onRemove,
}: { log?: Deed[]; legacy?: string; onRemove?: (index: number) => void }) {
  const items: Deed[] = log && log.length > 0
    ? log
    // 兜底：把旧字符串 deeds 解析成 Deed（识别 "[时间@地点] 描述" 前缀）
    : (legacy || '').split('\n').filter(Boolean).map((line) => {
        const m = /^\[([^@]*)@([^\]]*)\]\s*(.*)$/.exec(line);
        return m
          ? { time: m[1].trim(), location: m[2].trim(), description: m[3].trim() }
          : { time: '', location: '', description: line };
      });
  // 仅当数据来自结构化 log 时才允许删除（兜底解析出的不可删）
  const canRemove = !!onRemove && !!log && log.length > 0;
  if (items.length === 0) return <Empty text="尚无经历记录" />;
  return (
    <ol className="relative border-l border-edge/60 ml-2 space-y-4">
      {items.map((d, i) => (
        <li key={i} className="ml-4 group">
          <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-god/60 border border-void" />
          {(d.time || d.location) && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-mono text-dim/60 mb-1">
              {d.time && <span className="px-1.5 py-0.5 rounded border border-edge">🕒 {d.time}</span>}
              {d.location && <span className="px-1.5 py-0.5 rounded border border-edge">📍 {d.location}</span>}
            </div>
          )}
          <div className="flex items-start gap-2">
            <div className="flex-1 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{d.description}</div>
            {canRemove && (
              <button
                onClick={() => onRemove!(i)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-[12px] font-mono text-blood/50 hover:text-blood transition-opacity"
              >删</button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ────────── 基本信息 ────────── */
function BasicTab({ npc, realm, genderCls }: { npc: NpcRecord; realm: ReturnType<typeof parseRealm>; genderCls: string }) {
  const ap = parseAppearance5(npc.appearance5);
  const ex = npc.extra ?? {};
  const titles = useCharacters((s) => s.characters[npc.id]?.titles ?? []);
  const equipTitle = useCharacters((s) => s.equipTitle);
  const unequipTitle = useCharacters((s) => s.unequipTitle);
  return (
    <div>
      <Section title="身份信息">
        <div className="text-[12px] font-mono text-dim/50">名称</div>
        <div className="text-2xl font-bold text-slate-100">{npc.name || npc.id}</div>
        <div className="flex flex-wrap gap-2 pt-1">
          {npc.npcTag && <Chip label="标签" value={npc.npcTag} cls="text-cyan-300" />}
          {realm.role && <Chip label="身份" value={realm.role} />}
          {npc.gender && <Chip label="性别" value={npc.gender} cls={genderCls} />}
          {realm.tier && <Chip label="阶位" value={realm.tier} cls="text-god" />}
          {realm.lv != null && <Chip label="等级" value={`Lv.${realm.lv}`} cls="text-god/80" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
          <Field label="角色 ID" value={npc.id} />
          <Field label="对你称呼" value={npc.callPlayer} />
          <Field label="称号" value={npc.title} accent={!!npc.title} />
          <Field label="职业" value={npc.profession} />
          <Field label="竞技场排名" value={npc.arenaRank} />
          <Field label="烙印等级" value={npc.brandLevel} />
          <Field label="契约者ID" value={npc.contractorId} />
          <Field label="生物强度" value={npc.bioStrength} accent={!!npc.bioStrength} />
        </div>
      </Section>

      {titles.length > 0 && (
        <Section title="称号库" hint="最多佩戴 1 个；仅佩戴者注入叙事记忆">
          <div className="space-y-1.5">
            {[...titles].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0)).map((t) => (
              <div key={t.name} className={`rounded-lg border px-2.5 py-1.5 ${RARITY_CLS[t.rarity] ?? 'border-edge bg-panel/60'}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-semibold text-slate-100 truncate">{t.name}</span>
                  {t.rarity && <span className="text-[12px] font-mono font-bold opacity-80">{t.rarity}</span>}
                  {t.equipped
                    ? <button onClick={() => unequipTitle(npc.id)} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/50 text-god bg-god/10">佩戴中</button>
                    : <button onClick={() => equipTitle(npc.id, t.name)} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:border-god/50 hover:text-god transition-colors">佩戴</button>}
                </div>
                <div className="flex flex-wrap gap-x-3 text-[12px] font-mono text-dim/50 mt-0.5">
                  {t.obtainedTime && <span>获得：{t.obtainedTime}</span>}
                  {t.source && <span>来源：{t.source}</span>}
                </div>
                {t.effect && <div className="text-[13px] text-emerald-300/80 leading-relaxed">效果·{t.effect}</div>}
                {t.desc && <div className="text-[13px] text-dim/55 leading-relaxed italic">{t.desc}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="伪装身份" hint="仅用于叙事；不改变真实姓名、真实阶位、等阶进度或数值">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="化名（对外假身份）" value={ex['化名'] ?? ex['aliasName']} />
          <Field label="伪装阶位" value={ex['伪装境界'] ?? ex['disguiseRealm']} />
        </div>
      </Section>

      <Section title="性格" hint="人物气质">
        <SegmentedText text={npc.personality} fallback="未设置" />
      </Section>

      {npc.review && (
        <Section title="锐评" hint="诙谐吐槽">
          <div className="text-[13px] text-amber-200/80 leading-relaxed italic border-l-2 border-amber-600/50 pl-2.5 bg-amber-900/10 rounded-r py-1.5 pr-2">{npc.review}</div>
        </Section>
      )}

      <Section title="战斗属性">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="天赋资质" value={ex['5'] ?? ex['天赋'] ?? ex['灵根']} />
          <Field label="年龄" value={npc.age ?? ex['年龄'] ?? ex['外貌年龄']} />
        </div>
      </Section>

      <Section title="当前状态" hint="点击状态查看详情">
        <StatusChips status={npc.status} exclude={(npc.statusEffects ?? []).map((e) => e.name)} />
        {(npc.statusEffects?.length ?? 0) > 0 && (
          <div className="mt-2 pt-2 border-t border-edge/40">
            <div className="text-[11px] text-dim/50 font-mono mb-1">⏳ 限时状态（自动过期）</div>
            <StatusEffectChips effects={npc.statusEffects!} onRemove={(name) => useNpc.getState().removeNpcStatus(npc.id, name)} />
          </div>
        )}
      </Section>

      <Section title="行为与位置">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-void/40 border border-edge/60 px-3 py-2">
            <div className="text-[12px] font-mono text-dim/50 mb-1">当前行为</div>
            <div className="text-sm text-slate-200">{ap.action || '—'}</div>
            {ap.location && <div className="text-[13px] text-dim/60 mt-1">📍 {ap.location}</div>}
          </div>
          <div className="rounded-lg bg-void/40 border border-edge/60 px-3 py-2">
            <div className="text-[12px] font-mono text-dim/50 mb-1">外观总览</div>
            <div className="text-sm text-slate-300 leading-relaxed">{ap.look || npc.appearanceDetail || '—'}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* 头像：上传/替换/移除/AI生成（dataURL 存 npcStore.avatar），与右上角在场面板共用同一字段 */
function AvatarBlock({ npc }: { npc: NpcRecord }) {
  const upsert = useNpc((s) => s.upsertNpc);
  const portraitService = useImageGen((s) => s.portraitService);
  const portraitNegative = useImageGen((s) => s.portraitNegative);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gening, setGening] = useState(false);
  const [err, setErr] = useState('');
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => upsert(npc.id, { avatar: await shrinkDataUrl(String(reader.result)) });
    reader.readAsDataURL(file);
  }
  async function handleGen() {
    setGening(true); setErr('');
    try {
      const ap = parseAppearance5(npc.appearance5);
      const appearance = [ap.look, ap.figure, ap.outfit, npc.appearanceDetail].filter(Boolean).join('，');
      // 无英文生图标签(列19)时，先用 LLM 把中文外观翻成英文 danbooru tags（NAI 必须英文才像）
      let tags = npc.imageTags;
      if (!tags || !tags.trim()) {
        const desc = [`${npc.name}`, npc.gender, appearance, npc.profession, parseRealm(npc.realm).tier, npc.npcTag].filter(Boolean).join('，');
        const gen = await genPortraitTags(desc);
        if (gen) { tags = gen; upsert(npc.id, { imageTags: gen }); }
      }
      const prompt = buildPortraitPrompt({ gender: npc.gender, age: npc.age, appearance, profession: npc.profession, tier: parseRealm(npc.realm).tier, npcTag: npc.npcTag, imageTags: tags,
        action: ap.action, attire: ap.outfit, location: ap.location, figure: ap.figure, appearanceDetails: npc.appearanceDetail });
      const url = await generateImage(portraitService, { prompt, negative: portraitNegative, label: `生成 ${npc.name} 肖像` });
      upsert(npc.id, { avatar: await shrinkDataUrl(url), avatarTags: tags || '' });
    } catch (e: any) { setErr(e.message ?? '生成失败'); }
    finally { setGening(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div onClick={() => npc.avatar && useImageViewer.getState().open(npc.avatar, npc.name)}
          title={npc.avatar ? '点击查看大图' : ''}
          className={`shrink-0 w-28 h-28 rounded-lg overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center ${npc.avatar ? 'cursor-zoom-in hover:border-god/40' : ''}`}>
          {gening ? <span className="text-[11px] font-mono text-god/70 animate-pulse">生成中…</span>
            : npc.avatar
            ? <img src={npc.avatar} alt={npc.name} className="w-full h-full object-cover" />
            : <span className="text-4xl text-dim/25">👤</span>}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          <button onClick={handleGen} disabled={gening}
            className="px-3 py-1.5 text-[13px] font-mono border border-god/50 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
            {gening ? '生成中…' : '✨ AI 生成'}
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-god/40 hover:text-god transition-colors">
            {npc.avatar ? '替换图片' : '上传图片'}
          </button>
          {npc.avatar && (
            <button onClick={() => upsert(npc.id, { avatar: '' })}
              className="px-3 py-1.5 text-[13px] font-mono border border-edge text-dim rounded hover:border-blood/40 hover:text-blood transition-colors">
              移除
            </button>
          )}
          {err && <div className="text-[11px] text-blood font-mono max-w-[240px] leading-snug whitespace-pre-line">{err}</div>}
          <div className="text-[11px] text-dim/40 leading-relaxed max-w-[160px]">AI 生成走「生图设置」选定的服务；也可上传自定义图。</div>
        </div>
      </div>
    </div>
  );
}

/* ────────── 肖像绘卷 ────────── */
function PortraitTab({ npc }: { npc: NpcRecord }) {
  const ap = parseAppearance5(npc.appearance5);
  const segs = [
    { label: '动作', value: ap.action },
    { label: '穿着', value: ap.outfit },
    { label: '位置', value: ap.location },
    { label: '身段', value: ap.figure },
    { label: '样貌', value: ap.look },
  ].filter((s) => s.value);
  return (
    <div>
      <Section title="人物头像">
        <AvatarBlock npc={npc} />
      </Section>
      <Section title="肖像锚点（第16列）">
        {segs.length === 0 ? <Empty text="暂无肖像描述" /> : (
          <div className="space-y-2">
            {segs.map((s) => (
              <div key={s.label} className="flex gap-3">
                <span className="shrink-0 w-12 text-right text-[13px] font-mono text-god/50">{s.label}</span>
                <span className="flex-1 text-sm text-slate-200 leading-relaxed">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
      {npc.appearanceDetail && (
        <Section title="容貌与身姿（第34列）">
          <SegmentedText text={npc.appearanceDetail} />
        </Section>
      )}
    </div>
  );
}

/* ────────── 隐秘 ────────── */
/* 性相关列（与 NPC 演化预设「性相关列定义」一致）：汇总进「私密信息」面板，并从「自定义列」隐藏。
   列19=画像提示(imageTags) 已映射到字段、不在 extra，故不含。*/
const PRIVATE_COLS: { key: string; label: string; alias: string; num?: boolean; inline?: boolean }[] = [
  { key: '8',  label: '性经验',   alias: '性经验' },
  { key: '17', label: '表性癖',   alias: '表性癖' },
  { key: '18', label: '里性癖',   alias: '里性癖' },
  { key: '20', label: '敏感部位', alias: '敏感部位' },
  { key: '21', label: '性器状态', alias: '性器状态' },
  { key: '22', label: '情欲值',   alias: '情欲值', num: true },
  { key: '23', label: '快感值',   alias: '快感值', num: true },
  { key: '24', label: '性观念',   alias: '性观念' },
  // 私密补充字段（命名键，由 NPC_PRIVATE_EXTRA_RULE 生成）；inline=短枚举项，横向胶囊排列省空间
  { key: '淫纹',     label: '淫纹',     alias: '淫纹' },
  { key: '解锁服装', label: '解锁服装', alias: '解锁服装', inline: true },
  { key: '独特技巧', label: '独特技巧', alias: '独特技巧' },
  { key: '性爱姿势', label: '性爱姿势', alias: '性爱姿势', inline: true },
  { key: '开发玩法', label: '开发玩法', alias: '开发玩法', inline: true },
];
const PRIVATE_KEYS = new Set(PRIVATE_COLS.flatMap((c) => [c.key, c.alias]));

function HiddenTab({ npc }: { npc: NpcRecord }) {
  const ex = npc.extra ?? {};
  const priv = PRIVATE_COLS
    .map((c) => ({ ...c, value: ex[c.key] ?? ex[c.alias] }))
    .filter((p) => p.value != null && String(p.value).trim());
  return (
    <div>
      <Section title="内心想法">
        <SegmentedText text={npc.innerThought} fallback="此人心思尚不可知" />
      </Section>
      <Section title="当前动机">
        <div className="text-sm text-slate-300">{npc.motiveNow || '—'}</div>
      </Section>
      {priv.length > 0 && (
        <Section title="私密信息">
          <div className="space-y-2.5">
            {priv.map((p) => (
              <div key={p.key}>
                <div className="text-[12px] font-mono text-god/45 mb-0.5">{p.label}</div>
                {p.num
                  ? (() => { const n = Number(String(p.value).replace(/[^\d.-]/g, '')); return <div className="text-sm font-mono text-rose-300/85">{Number.isFinite(n) ? `${n} / 100` : String(p.value)}</div>; })()
                  : p.inline
                    ? (
                      <div className="flex flex-wrap gap-1.5">
                        {String(p.value).split(/[；;、,，/｜|]+/).map((s) => s.trim()).filter(Boolean).map((it, i) => (
                          <span key={i} className="text-[12px] px-2 py-0.5 rounded-full border border-edge bg-void/40 text-slate-300">{it}</span>
                        ))}
                      </div>
                    )
                    : <SegmentedText text={String(p.value)} />}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ────────── 自定义列 ────────── */
function CustomTab({ npc }: { npc: NpcRecord }) {
  // 隐藏已归入「私密信息」的性相关列，避免重复
  const entries = Object.entries(npc.extra ?? {}).filter(([k]) => !PRIVATE_KEYS.has(k));
  if (entries.length === 0) return <Empty text="暂无自定义列数据" />;
  return (
    <Section title="自定义列（演化兜底字段）">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {entries.map(([k, v]) => (
          <Field key={k} label={/^\d+$/.test(k) ? `列 ${k}` : k} value={String(v)} />
        ))}
      </div>
    </Section>
  );
}

/* ────────── 属性 ────────── */
function AttrTab({ npc, realm }: { npc: NpcRecord; realm: ReturnType<typeof parseRealm> }) {
  const cdata = useCharacters((s) => s.characters[npc.id]);
  const equippedFull = (npc.items ?? []).filter((it) => it.equipped);
  // 属性构成：原始 + 装备/技能/天赋加成（真实加载）
  const breakdown = computeAttrBreakdown(npc.attrs, cdata?.skills ?? [], cdata?.traits ?? [], equippedFull as any);
  const effAttrs = { str: breakdown.str.total, agi: breakdown.agi.total, con: breakdown.con.total, int: breakdown.int.total, cha: breakdown.cha.total, luck: breakdown.luck.total } as PlayerAttrs;
  // HP/EP 上限由(有效)体质×20 / 智力×15 自动换算
  // 最大HP/EP = 基础六维换算 + 装备里明确写"增加HP/EP上限"的效果；技能/天赋加成不计入上限
  const maxHp = computeMaxHp(npc.attrs) + gearMaxHpBonus(equippedFull as any);
  const maxEp = computeMaxEp(npc.attrs) + gearMaxEpBonus(equippedFull as any);
  const hpStr = `${effectiveResource(npc.hp, npc.maxHp, maxHp)} / ${maxHp}`;
  const epStr = `${effectiveResource(npc.mp, npc.maxMp, maxEp)} / ${maxEp}`;
  const attrDefs: { key: keyof PlayerAttrs; label: string }[] = [
    { key: 'str', label: '力量' }, { key: 'agi', label: '敏捷' }, { key: 'con', label: '体质' },
    { key: 'int', label: '智力' }, { key: 'cha', label: '魅力' }, { key: 'luck', label: '幸运' },
  ];
  const hasAttrs = !!npc.attrs;
  const [showTrue, setShowTrue] = useState(false);   // 基础属性 ↔ 真实属性
  const [attrPop, setAttrPop] = useState<keyof PlayerAttrs | null>(null);
  const npcEquipped = equippedFull.map((it) => ({ category: it.category, grade: (it.numeric?.grade as number) ?? 1 }));
  const derived = computeDerived(effAttrs, lvFromRealm(npc.realm), npcEquipped);   // 衍生属性按"有效六维"
  const derivedNoEq = computeDerived(effAttrs, lvFromRealm(npc.realm), []);
  const [derivedPop, setDerivedPop] = useState<keyof typeof derived | null>(null);
  return (
    <div>
      <Section title="资源与状态">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="生命 HP" value={hpStr} />
          <Field label="蓝量 EP" value={epStr} />
          <Field label="阶位" value={realm.tier} accent />
          <Field label="等级" value={realm.lv != null ? `Lv.${realm.lv}` : ''} />
          <Field label="进阶点数" value={npc.advancePoints != null ? String(npc.advancePoints) : undefined} />
          <Field label="属性点" value={npc.attrPoints != null ? String(npc.attrPoints) : undefined} />
          <Field label="真实属性点" value={npc.realAttrPoints != null ? String(npc.realAttrPoints) : undefined} />
          <Field label="技能点" value={npc.skillPoints != null ? String(npc.skillPoints) : undefined} />
          <Field label="战斗状态" value={npc.inCombat ? '战斗中' : '非战斗'} />
        </div>
      </Section>
      <Section title={showTrue ? '真实属性' : '基础属性'} hint={hasAttrs ? undefined : '尚未生成'}>
        {hasAttrs && (
          <div className="flex justify-end -mt-1 mb-1">
            <button onClick={() => setShowTrue((v) => !v)} title="真实属性 = 每80点普通属性折算1点"
              className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60 hover:border-god/40 hover:text-god transition-colors">
              {showTrue ? '基础属性' : '真实属性'}
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {attrDefs.map(({ key, label }) => {
            const bk = breakdown[key]; const bonus = bk.total - bk.base;
            return (
              <button key={key} onClick={() => hasAttrs && setAttrPop(attrPop === key ? null : key)} title="点击查看属性构成"
                className="text-left rounded-lg border border-edge bg-void/40 px-2 py-1.5 hover:border-god/40 transition-colors">
                <div className="text-[11px] font-mono text-dim/50">{showTrue ? `真实${label}` : label}</div>
                <div className={`text-sm font-mono font-bold ${showTrue ? 'text-amber-300/90' : 'text-slate-100'}`}>
                  {npc.attrs ? (showTrue ? trueAttr(bk.total) : bk.total) : '—'}
                  {!showTrue && bonus !== 0 && <span className={`ml-0.5 text-[11px] ${bonus > 0 ? 'text-emerald-400/70' : 'text-blood/70'}`}>({bonus > 0 ? '+' : ''}{bonus})</span>}
                </div>
              </button>
            );
          })}
        </div>
        {attrPop && !showTrue && hasAttrs && (() => {
          const bk: AttrBreak = breakdown[attrPop];
          return (
            <div className="mt-2 rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
              <div className="flex items-center justify-between"><span className="text-god/80">{ATTR_LABEL[attrPop]} · 构成</span><button onClick={() => setAttrPop(null)} className="text-dim/40 hover:text-blood">✕</button></div>
              <div className="flex justify-between"><span className="text-dim/60">原始</span><span className="text-slate-200">{bk.base}</span></div>
              {bk.equip !== 0 && <div className="flex justify-between"><span className="text-dim/60">装备加成</span><span className="text-amber-300/80">{bk.equip > 0 ? '+' : ''}{bk.equip}</span></div>}
              {bk.skill !== 0 && <div className="flex justify-between"><span className="text-dim/60">技能加成</span><span className="text-sky-300/80">{bk.skill > 0 ? '+' : ''}{bk.skill}</span></div>}
              {bk.talent !== 0 && <div className="flex justify-between"><span className="text-dim/60">天赋加成</span><span className="text-fuchsia-300/80">{bk.talent > 0 ? '+' : ''}{bk.talent}</span></div>}
              <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计</span><span className="text-slate-100 font-bold">{bk.total}</span></div>
              {bk.equip === 0 && bk.skill === 0 && bk.talent === 0 && <div className="text-dim/40 text-[11px]">暂无装备/技能/天赋加成</div>}
            </div>
          );
        })()}
      </Section>
      <Section title="衍生属性" hint={hasAttrs ? '有效六维+装备换算' : '需先生成六维'}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([['patk', '物理攻击'], ['pdef', '物理防御'], ['matk', '法术攻击'], ['mdef', '法术防御']] as const).map(([k, label]) => (
            <button key={k} onClick={() => hasAttrs && setDerivedPop(derivedPop === k ? null : k)} title="点击查看构成"
              className="text-left rounded-lg border border-edge bg-void/40 px-2 py-1.5 hover:border-god/40 transition-colors">
              <div className="text-[11px] font-mono text-dim/50">{label}</div>
              <div className="text-sm font-mono font-bold text-amber-300/90">{hasAttrs ? derived[k] : '—'}</div>
            </button>
          ))}
        </div>
        {derivedPop && hasAttrs && (() => {
          const k = derivedPop; const total = derived[k]; const eq = total - derivedNoEq[k];
          const label = { patk: '物理攻击', pdef: '物理防御', matk: '法术攻击', mdef: '法术防御' }[k];
          return (
            <div className="mt-2 rounded-lg border border-god/30 bg-void/50 px-3 py-2 text-[12px] font-mono space-y-1">
              <div className="flex items-center justify-between"><span className="text-god/80">{label} · 构成</span><button onClick={() => setDerivedPop(null)} className="text-dim/40 hover:text-blood">✕</button></div>
              <div className="flex justify-between"><span className="text-dim/60">有效六维 + 等级</span><span className="text-slate-200">{derivedNoEq[k]}</span></div>
              {eq !== 0 && <div className="flex justify-between"><span className="text-dim/60">装备加成</span><span className="text-amber-300/80">{eq > 0 ? '+' : ''}{eq}</span></div>}
              <div className="flex justify-between border-t border-edge/40 pt-1"><span className="text-slate-300">合计</span><span className="text-slate-100 font-bold">{total}</span></div>
            </div>
          );
        })()}
      </Section>
      <Section title="好感度" hint="-100 ~ 100">
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-bold font-mono ${favorCls(npc.favor)}`}>{npc.favor > 0 ? '+' : ''}{npc.favor}</span>
          <div className="flex-1 relative h-2 bg-void/60 rounded-full overflow-hidden">
            <div className={`absolute inset-y-0 left-0 rounded-full ${npc.favor >= 0 ? 'bg-rose-500/70' : 'bg-sky-500/70'}`}
              style={{ width: `${Math.round(((npc.favor + 100) / 200) * 100)}%` }} />
            <div className="absolute inset-y-0 left-1/2 w-px bg-edge" />
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ────────── 物品（储物袋 / 装备）────────── */
function ItemsTab({ items, empty, showSlot, onClear, ownerId, ownerGender }: { items: NpcRecord['items']; empty: string; showSlot?: boolean; onClear?: () => void; ownerId?: string; ownerGender?: string }) {
  const [confirm, setConfirm] = useState(false);
  if (!items || items.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-3">
      {onClear && (
        <div className="flex justify-end">
          <button
            onClick={() => { if (!confirm) { setConfirm(true); return; } onClear(); setConfirm(false); }}
            onBlur={() => setConfirm(false)}
            className={`px-3 py-1.5 text-sm font-mono rounded-lg border transition-colors ${
              confirm ? 'border-blood/60 text-blood bg-blood/10' : 'border-edge text-dim hover:border-blood/40 hover:text-blood'
            }`}
          >
            {confirm ? `确认清空 ${items.length} 件？` : `🗑 清空储存空间 (${items.length})`}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map((it, i) => <NpcItemCard key={`${it.id}-${i}`} it={it} showSlot={showSlot} ownerId={ownerId} ownerGender={ownerGender} />)}
      </div>
    </div>
  );
}

function NpcItemCard({ it, showSlot, ownerId, ownerGender }: { it: NonNullable<NpcRecord['items']>[number]; showSlot?: boolean; ownerId?: string; ownerGender?: string }) {
  const num = (it.numeric ?? {}) as Record<string, any>;
  const statLines: string[] = Array.isArray(num.statLines) ? num.statLines : [];
  const updateNpcItem = useNpc((s) => s.updateNpcItem);
  const removeNpcItem = useNpc((s) => s.removeNpcItem);
  const equipNegative = useImageGen((s) => s.equipNegative);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gening, setGening] = useState(false);
  const [imgErr, setImgErr] = useState('');
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !ownerId) return;
    if (file.size > 3 * 1024 * 1024) { alert('图片请小于 3MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => updateNpcItem(ownerId, it.id, { image: await shrinkDataUrl(String(reader.result), 768) });
    reader.readAsDataURL(file);
  }
  async function handleGen() {
    if (!ownerId) return;
    setGening(true); setImgErr('');
    try {
      const service = effectiveEquipService(useImageGen.getState());
      // NAI/ComfyUI 等标签模型：把中文装备描述翻成英文 danbooru tags；自然语言模型用中文模板
      let prompt = '';
      if (isTagService(service)) {
        const desc = [it.name, it.category, it.gradeDesc, it.appearance, it.effect].filter(Boolean).join('，');
        prompt = await genEquipTags(desc);
      }
      if (!prompt) prompt = buildEquipPrompt({ name: it.name, category: it.category, gradeDesc: it.gradeDesc, appearance: it.appearance, effect: it.effect, ownerGender });
      const url = await generateImage(service, { prompt, negative: equipNegative, label: `生成装备图 ${it.name}` });
      updateNpcItem(ownerId, it.id, { image: await shrinkDataUrl(url, 768) });
    } catch (e: any) { setImgErr(e.message ?? '生成失败'); }
    finally { setGening(false); }
  }
  return (
    <div className="rounded-lg border border-edge bg-panel/60 px-3 py-2 space-y-1">
      <div className="flex items-start gap-2">
        {ownerId && (
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div onClick={() => it.image && useImageViewer.getState().open(it.image, it.name)}
              title={it.image ? '点击查看大图' : ''}
              className={`w-14 h-14 rounded overflow-hidden border border-edge/60 bg-void/60 flex items-center justify-center ${it.image ? 'cursor-zoom-in hover:border-god/40' : ''}`}>
              {gening ? <span className="text-[8px] font-mono text-god/70 animate-pulse">生成中</span>
                : it.image ? <img src={it.image} alt={it.name} className="w-full h-full object-cover" />
                : <span className="text-lg text-dim/25">⚔</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <div className="flex gap-1">
              <button onClick={handleGen} disabled={gening} title="AI 生成装备图"
                className="text-[9px] font-mono px-1 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 disabled:opacity-40">✨</button>
              <button onClick={() => fileRef.current?.click()} title="上传图片"
                className="text-[9px] font-mono px-1 py-0.5 rounded border border-edge text-dim hover:text-god">⬆</button>
              {it.image && <button onClick={() => updateNpcItem(ownerId, it.id, { image: '' })} title="移除" className="text-[9px] font-mono px-1 py-0.5 rounded border border-edge text-dim hover:text-blood">✕</button>}
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold truncate flex-1 ${gradeNameClass(it.gradeDesc)}`}>{it.name}</span>
        {it.quantity > 1 && <span className="text-[12px] font-mono text-dim/60">×{it.quantity}</span>}
        {ownerId && !it.equipped && (
          <button onClick={() => removeNpcItem(ownerId, it.id)} title="删除该物品"
            className="shrink-0 text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/50 hover:border-blood/50 hover:text-blood transition-colors">删除</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {it.category && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">{it.category}</span>}
        {(num.rarityTier || num.grade) && (
          <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-amber-700/40 text-amber-400/80">
            {[num.rarityTier, num.grade != null ? `g${num.grade}` : ''].filter(Boolean).join('·')}
          </span>
        )}
        {showSlot && it.equipSlot && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/40 text-god/70">槽 {it.equipSlot}</span>}
      </div>
      {it.gradeDesc && <div className="text-[13px] font-mono leading-relaxed"><span className="text-dim/40">品级·</span><span className={gradeBadgeClass(it.gradeDesc)}>{it.gradeDesc}</span></div>}
      {(it.origin || it.subType || it.combatStat || it.durability || it.score || it.killCount) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
          {it.origin && <span>产地:{it.origin}</span>}
          {it.subType && <span>类型:{it.subType}</span>}
          {it.combatStat && <span className="text-amber-300/80">攻防:{it.combatStat}</span>}
          {it.durability && <span>耐久:{it.durability}</span>}
          {it.score && <span className="text-emerald-300/80">评分:{it.score}</span>}
          {it.killCount && <span className="text-blood/80">杀敌:{it.killCount}</span>}
        </div>
      )}
      {it.requirement && <div className="text-[13px] text-sky-200/70 leading-relaxed"><span className="text-dim/40">需求·</span>{it.requirement}</div>}
      {it.affix && <div className="text-[13px] text-amber-200/80 leading-relaxed"><span className="text-dim/40">词缀·</span>{it.affix}</div>}
      {it.effect && <div className="text-[13px] text-slate-300/80 leading-relaxed"><span className="text-god/50">效果·</span>{it.effect}</div>}
      {statLines.length > 0 && <div className="text-[12px] font-mono text-sky-400/70">属性词条：{statLines.join(' / ')}</div>}
      {it.intro && <div className="text-[13px] text-dim/55 leading-relaxed italic border-l-2 border-edge/50 pl-2"><span className="not-italic text-god/40">简介·</span>{it.intro}</div>}
      <div className="text-[13px] leading-relaxed italic border-l-2 border-edge/50 pl-2">
        <span className="not-italic text-god/40">外观·</span>
        {it.appearance ? <span className="text-dim/60">{it.appearance}</span> : <span className="not-italic text-dim/30">（未填写——重新生成可补全，AI 生图需要它）</span>}
      </div>
      {it.acquisition && <div className="text-[12px] font-mono text-dim/40">获得：{it.acquisition}</div>}
      {it.notes && it.notes !== it.acquisition && <div className="text-[12px] font-mono text-dim/40">备注：{it.notes}</div>}
      {imgErr && <div className="text-[11px] text-blood font-mono leading-snug whitespace-pre-line">{imgErr}</div>}
        </div>
      </div>
    </div>
  );
}

/* ────────── 技能（点击展开完整信息） ────────── */
function NpcSkillCard({ sk }: { sk: ReturnType<typeof useCharacters.getState>['characters'][string]['skills'][number] }) {
  const [open, setOpen] = useState(false);
  const el = (sk.numeric?.element as string | undefined) ?? undefined;
  const num = (sk.numeric ?? {}) as Record<string, any>;
  return (
    <div onClick={() => setOpen((o) => !o)}
      className="rounded-lg border border-edge bg-panel/60 px-3 py-2 space-y-1 cursor-pointer hover:border-god/30 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-100 truncate flex-1">{sk.name}</span>
        {el && el !== 'none' && <span className={`text-[12px] font-mono ${ELEMENT_CLS[el] ?? 'text-dim'}`}>{el}</span>}
        <span className="text-[11px] text-dim/30 shrink-0">{open ? '收起▲' : '详情▼'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sk.level && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/30 text-god/60">{sk.level}</span>}
        {sk.skillType && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">{sk.skillType}</span>}
        {sk.rarity && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-amber-700/40 text-amber-400/70">{sk.rarity}</span>}
        {sk.layers && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">层数 {sk.layers}</span>}
        {sk.cooldown && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">冷却 {sk.cooldown}</span>}
        {sk.cost && <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">消耗 {sk.cost}</span>}
      </div>
      {sk.desc && <div className="text-[13px] text-dim/70 leading-relaxed"><span className="text-god/50">技能介绍·</span>{sk.desc}</div>}
      {open && (
        <div className="pt-1.5 border-t border-edge/40 space-y-1">
          {sk.effect && <div className="text-[13px] text-slate-300/80 leading-relaxed"><span className="text-god/50">效果·</span>{sk.effect}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/60">
            {sk.target && <span>目标 {sk.target}</span>}
            {sk.damage && <span className="text-blood/70">伤害 {sk.damage}</span>}
            {sk.attrBonus && <span className="text-emerald-300/70">属性加成 {sk.attrBonus}</span>}
          </div>
          {sk.tags && sk.tags.length > 0 && <div className="flex flex-wrap gap-1">{sk.tags.map((tg) => <span key={tg} className="text-[11px] font-mono px-1 py-0.5 bg-void border border-edge/50 text-dim/50 rounded">{tg}</span>)}</div>}
          {sk.layerEffects && <div className="text-[13px] text-dim/60 leading-relaxed whitespace-pre-wrap"><span className="text-god/40">层效果·</span>{sk.layerEffects}</div>}
          {sk.note && <div className="text-[12px] text-amber-200/60 italic leading-relaxed border-l-2 border-amber-700/40 pl-2">备注·{sk.note}</div>}
          {sk.layerProgress && <div className="text-[12px] font-mono text-dim/50">熟练进度：{sk.layerProgress}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-sky-400/60">
            {num.rarityTier && <span>品阶 {num.rarityTier}</span>}
            {num.grade != null && <span>g{num.grade}</span>}
            {num.activeProfile && <span>{num.activeProfile}</span>}
            {num.targetMode && <span>目标 {num.targetMode}{num.targetScope ? `/${num.targetScope}` : ''}{num.maxTargets ? `×${num.maxTargets}` : ''}</span>}
            {num.cooldownProfile && <span>冷却档 {num.cooldownProfile}</span>}
            {num.mpCostMultiplier != null && <span>耗能×{num.mpCostMultiplier}</span>}
            {num.summonProfile?.count && <span>分身×{num.summonProfile.count}</span>}
          </div>
          <div className="text-[11px] font-mono text-dim/30">{sk.id}</div>
        </div>
      )}
    </div>
  );
}
function SkillTab({ skills }: { skills: ReturnType<typeof useCharacters.getState>['characters'][string]['skills'] }) {
  if (!skills || skills.length === 0) return <Empty text="暂无技能" />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {skills.map((sk, i) => <NpcSkillCard key={`${sk.id}-${i}`} sk={sk} />)}
    </div>
  );
}

/* ────────── 天赋（评级 D→SSS，点击展开完整信息） ────────── */
function NpcTalentCard({ t }: { t: ReturnType<typeof useCharacters.getState>['characters'][string]['traits'][number] }) {
  const [open, setOpen] = useState(false);
  const num = (t.numeric ?? {}) as Record<string, any>;
  return (
    <div onClick={() => setOpen((o) => !o)}
      className={`rounded-lg border px-3 py-2 cursor-pointer hover:opacity-90 transition-opacity ${RARITY_CLS[t.rarity] ?? 'border-edge bg-panel/60'}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate flex-1">{t.name}</span>
        {t.category && <span className="text-[12px] font-mono opacity-50">{t.category}</span>}
        <span className="text-[12px] font-mono font-bold opacity-80">{t.rarity}级</span>
        <span className="text-[11px] opacity-30 shrink-0">{open ? '▲' : '▼'}</span>
      </div>
      {t.desc && <div className="text-[13px] opacity-80 mt-1 leading-relaxed"><span className="opacity-50">天赋介绍·</span>{t.desc}</div>}
      {open && (
        <div className="pt-1.5 mt-1 border-t border-current/20 space-y-0.5">
          {t.effect && <div className="text-[13px] opacity-80 leading-relaxed"><span className="opacity-50">效果·</span>{t.effect}</div>}
          {t.level && <div className="text-[12px] opacity-60">等级：{t.level}</div>}
          {t.attrBonus && <div className="text-[12px] text-emerald-300/70">属性加成：{t.attrBonus}</div>}
          {t.note && <div className="text-[12px] text-amber-200/60 italic leading-relaxed border-l-2 border-amber-700/40 pl-2">备注·{t.note}</div>}
          {t.source && <div className="text-[12px] opacity-60">觉醒方式：{t.source}</div>}
          <div className="flex flex-wrap gap-x-3 text-[12px] font-mono opacity-50">
            {num.profile && <span>领域 {num.profile}</span>}
            {num.intensity && <span>强度 {num.intensity}</span>}
            {num.rarity && <span>tier {num.rarity}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
function TraitTab({ traits }: { traits: ReturnType<typeof useCharacters.getState>['characters'][string]['traits'] }) {
  if (!traits || traits.length === 0) return <Empty text="暂无天赋" />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {traits.map((t, i) => <NpcTalentCard key={`${t.name}-${i}`} t={t} />)}
    </div>
  );
}

/* ────────── 关系 ────────── */
function RelationTab({ npc, list, onSelect }: { npc: NpcRecord; list: NpcRecord[]; onSelect: (id: string) => void }) {
  const rels = (npc.relations || '').split(';').map((s) => s.trim()).filter(Boolean)
    .map((pair) => { const [tid, rel] = pair.split(':'); return { tid: (tid || '').trim(), rel: (rel || '').trim() }; });
  if (rels.length === 0) return <Empty text="暂无人际关系记录" />;
  const nameOf = (id: string) => id === 'B1' ? '林源（你）' : (list.find((r) => r.id === id)?.name ?? id);
  return (
    <Section title={`人际关系（${rels.length}）`}>
      <div className="space-y-2">
        {rels.map((r, i) => {
          const canJump = r.tid !== 'B1' && list.some((x) => x.id === r.tid);
          return (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-void/40 border border-edge/60 px-3 py-2">
              <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim/60">{r.tid}</span>
              <span className="text-sm text-slate-200 flex-1">{nameOf(r.tid)}</span>
              <span className="text-sm font-mono text-god/70">{r.rel || '—'}</span>
              {canJump && (
                <button onClick={() => onSelect(r.tid)} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">查看›</button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ────────── 记忆（生平压缩 short/long）NPC/主角共用 ────────── */
export function CharMemoryView({ charId }: { charId: string }) {
  const mem = useCharacters((s) => s.characters[charId]?.memory);
  const short = mem?.shortTerm ?? [];
  const long = mem?.longTerm ?? [];
  if (short.length === 0 && long.length === 0) return null;
  const row = (e: { time: string; location: string; content: string }, i: number) => (
    <div key={i} className="rounded-lg bg-void/40 border border-edge/60 px-3 py-2">
      {(e.time || e.location) && (
        <div className="flex flex-wrap gap-2 text-[12px] font-mono text-dim/50 mb-0.5">
          {e.time && <span>🕒 {e.time}</span>}
          {e.location && <span>📍 {e.location}</span>}
        </div>
      )}
      <div className="text-[14px] text-slate-300 leading-relaxed whitespace-pre-wrap">{e.content}</div>
    </div>
  );
  return (
    <Section title="记忆" hint="生平压缩自动整理">
      {short.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-mono text-god/50">近期记忆 · {short.length}</div>
          {short.map(row)}
        </div>
      )}
      {long.length > 0 && (
        <div className="space-y-1.5 mt-3">
          <div className="text-[12px] font-mono text-dim/50">长期记忆 · {long.length}</div>
          {long.map(row)}
        </div>
      )}
    </Section>
  );
}

/* ────────── 经历 ────────── */
function HistoryTab({ npc }: { npc: NpcRecord }) {
  const removeDeed = useNpc((s) => s.removeDeed);
  return (
    <div>
      <Section title="背景 / 简介">
        <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{npc.background || '暂无背景记录'}</div>
      </Section>
      {(npc.shortGoal || npc.longGoal) && (
        <Section title="目标">
          {npc.shortGoal && <div className="text-sm text-slate-200">近期：{npc.shortGoal}</div>}
          {npc.longGoal && <div className="text-sm text-slate-300 mt-1">长远：{npc.longGoal}</div>}
        </Section>
      )}
      <Section title="经历时间线" hint="随剧情追加">
        <DeedTimeline log={npc.deedLog} legacy={npc.deeds} onRemove={(i) => removeDeed(npc.id, i)} />
      </Section>
      <CharMemoryView charId={npc.id} />
    </div>
  );
}
