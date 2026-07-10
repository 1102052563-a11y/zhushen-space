import { asText } from '../store/itemStore';
import { useAutoText } from '../i18n/autoTranslate';

/* 共享只读展示：技能/天赋/装备(物品) 的紧凑卡片 + 完整信息弹窗。
   供「聊天室分享卡」与「交易行挂牌物品」共用。data 为剥过大图的快照（纯数据，不连 store）。 */

export type EntityKind = 'skill' | 'talent' | 'equip' | 'item' | 'npc';

const ITEM_GRADE_COLOR: [RegExp, string][] = [
  [/创世|永恒|起源/, '#ff6b6b'],
  [/不朽|圣灵/, '#ff9f43'],
  [/史诗/, '#e84393'],
  [/传说/, '#feca57'],
  [/暗金|淡金|金色|金/, '#d4af37'],
  [/暗紫|紫/, '#a55eea'],
  [/蓝/, '#54a0ff'],
  [/绿/, '#26de81'],
  [/白/, '#c8d6e5'],
];
const RARITY_COLOR: Record<string, string> = {
  SSS: '#ff6b6b', SS: '#ff6b6b', S: '#feca57', A: '#a55eea', B: '#54a0ff', C: '#26de81', D: '#c8d6e5',
  极境: '#ff6b6b', 奥义: '#feca57', 稀有: '#a55eea', 精良: '#54a0ff', 普通: '#c8d6e5',
  天: '#feca57', 地: '#a55eea', 玄: '#54a0ff', 人: '#c8d6e5',
};

/** 品级/评级文字 → 颜色（兼容物品色阶 与 技能天赋评级 D~SSS/品质词/人玄地天）。 */
export function gradeColor(text?: string): string {
  const g = String(text || '').trim();
  if (!g) return '#c8d6e5';
  for (const [re, c] of ITEM_GRADE_COLOR) if (re.test(g)) return c;
  const head = g.split(/[·\s.|/、，]/)[0] || g;
  const up = head.toUpperCase();
  return RARITY_COLOR[up] || RARITY_COLOR[head] || '#c8d6e5';
}

const CAT_EMOJI: Record<string, string> = {
  武器: '⚔️', 防具: '🛡️', 饰品: '💍', 法宝: '🔮', 宝石: '💎',
  消耗品: '🧪', 材料: '🧱', 工具: '🛠️', 丹药: '🧪', 符箓: '📜', 灵药: '🌿', 功法: '📖', 阵具: '🔯',
};
export function entityEmoji(kind: EntityKind, data: any): string {
  if (kind === 'skill') return '✨';
  if (kind === 'talent') return '🧬';
  if (kind === 'npc') return '📇';
  return CAT_EMOJI[String(data?.category || '')] || '📦';
}

/** 该实体用于上色/展示档位的文字。 */
export function gradeTextOf(kind: EntityKind, data: any): string {
  if (kind === 'skill') return String(data?.rarity || data?.skillType || data?.level || '');
  if (kind === 'talent') return String(data?.rarity || '');
  if (kind === 'npc') return String(data?.bioStrength || String(data?.realm || '').split(/[|｜]/)[0] || data?.npcTag || '');
  return String(data?.gradeDesc || '');
}

/** 卡片/弹窗主强调色：NPC 用固定青绿，其余按品级/评级取色。 */
export function accentColor(kind: EntityKind, data: any): string {
  if (kind === 'npc') return '#5fd3bc';
  return gradeColor(gradeTextOf(kind, data));
}

function kindLabel(kind: EntityKind): string {
  return kind === 'skill' ? '技能' : kind === 'talent' ? '天赋' : kind === 'npc' ? 'NPC' : '装备';
}

/** 各类型「完整信息」按顺序展示的字段（标签, 取值键）。仅展示非空项。 */
const FIELDS: Record<EntityKind, [string, string][]> = {
  skill: [
    ['类型', 'skillType'], ['品级', 'rarity'], ['等级', 'level'], ['目标', 'target'],
    ['冷却', 'cooldown'], ['消耗', 'cost'], ['伤害', 'damage'], ['属性加成', 'attrBonus'],
    ['效果', 'effect'], ['层数', 'layers'], ['各层效果', 'layerEffects'], ['简描', 'desc'],
    ['标签', 'tags'], ['备注', 'note'],
  ],
  talent: [
    ['评级', 'rarity'], ['类型', 'category'], ['等级', 'level'], ['来源', 'source'],
    ['属性加成', 'attrBonus'], ['效果', 'effect'], ['简描', 'desc'], ['备注', 'note'],
  ],
  equip: [
    ['分类', 'category'], ['细分', 'subType'], ['品级', 'gradeDesc'], ['战斗数值', 'combatStat'],
    ['词缀', 'affix'], ['属性加成', 'attrBonus'], ['效果', 'effect'], ['耐久', 'durability'],
    ['装备需求', 'requirement'], ['评分', 'score'], ['简介', 'intro'], ['外观', 'appearance'],
    ['获得途径', 'acquisition'], ['产地', 'origin'], ['标签', 'tags'], ['备注', 'notes'],
  ],
  item: [
    ['分类', 'category'], ['细分', 'subType'], ['品级', 'gradeDesc'], ['战斗数值', 'combatStat'],
    ['词缀', 'affix'], ['属性加成', 'attrBonus'], ['效果', 'effect'], ['评分', 'score'],
    ['简介', 'intro'], ['外观', 'appearance'], ['获得途径', 'acquisition'], ['标签', 'tags'], ['备注', 'notes'],
  ],
  npc: [
    ['性别', 'gender'], ['阶位/身份', 'realm'], ['标签', 'npcTag'], ['职业', 'profession'],
    ['性格', 'personality'], ['称号', 'title'], ['生物强度', 'bioStrength'], ['年龄', 'age'],
    ['契约者ID', 'contractorId'], ['隶属', 'affiliatedTeam'], ['背景', 'background'],
    ['外观', 'appearanceDetail'], ['当前状态', 'status'], ['评价', 'review'],
  ],
};

function fieldText(data: any, key: string): string {
  const v = data?.[key];
  if (v == null || v === '') return '';
  if (key === 'enhanceLevel') return Number(v) > 0 ? `+${v}` : '';
  return asText(v).trim();
}

/** 紧凑一行摘要（卡片副文本）：取首个非空的效果/简描/数值。 */
function summaryOf(kind: EntityKind, data: any): string {
  const keys = kind === 'skill' ? ['effect', 'desc', 'damage']
    : kind === 'talent' ? ['effect', 'desc']
    : kind === 'npc' ? ['personality', 'realm', 'background']
    : ['combatStat', 'effect', 'affix', 'intro'];
  for (const k of keys) { const t = fieldText(data, k); if (t) return t; }
  return '';
}

function GradeChip({ kind, data }: { kind: EntityKind; data: any }) {
  const txt = gradeTextOf(kind, data);
  if (!txt) return null;
  const c = accentColor(kind, data);
  return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: c, border: `1px solid ${c}55`, background: `${c}14` }}>{txt}</span>;
}

/** 紧凑可点卡片：emoji + 名称 + 档位 + 一行摘要。点击→onOpen。 */
export function EntityCard({ kind, data, onOpen, mt }: { kind: EntityKind; data: any; onOpen: () => void; mt?: boolean }) {
  const rawName = String(data?.name || '（无名）');
  const rawSummary = summaryOf(kind, data);
  // mt=true（在线跨玩家内容）：名称/简介按当前语言机翻；本地内容不传 mt、零开销。
  const nameMt = useAutoText(mt ? rawName : undefined);
  const summaryMt = useAutoText(mt ? rawSummary : undefined);
  const name = mt ? nameMt : rawName;
  const summary = mt ? summaryMt : rawSummary;
  const accent = accentColor(kind, data);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-edge bg-panel/70 hover:bg-panel2 transition-colors px-3 py-2 group"
      style={{ borderLeft: `3px solid ${accent}` }}
      title="点击查看完整信息"
    >
      <div className="flex items-center gap-2">
        <span className="text-base shrink-0">{entityEmoji(kind, data)}</span>
        <span className="text-[10px] font-mono text-dim/45 shrink-0">{kindLabel(kind)}</span>
        <span className="text-sm font-semibold text-slate-100 truncate">{name}</span>
        {data?.quantity > 1 && <span className="text-[10px] font-mono text-dim/50 shrink-0">×{data.quantity}</span>}
        <span className="ml-auto shrink-0"><GradeChip kind={kind} data={data} /></span>
      </div>
      {summary && <div className="text-[11px] text-dim/60 mt-1 line-clamp-2 leading-snug">{summary}</div>}
      <div className="text-[10px] font-mono text-god/50 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">点击查看完整信息 →</div>
    </button>
  );
}

/** 弹窗内一行「字段值」——单独组件以便 mt 时逐行调用 useAutoText（符合 hooks 规则）。label 是界面词、由 DomI18n 处理。 */
function DetailRow({ label, value, mt }: { label: string; value: string; mt?: boolean }) {
  const v = useAutoText(mt ? value : undefined);
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 items-start">
      <div className="text-[11px] font-mono text-dim/50 pt-0.5">{label}</div>
      <div className="text-[13px] text-slate-200 leading-relaxed break-words whitespace-pre-wrap">{mt ? v : value}</div>
    </div>
  );
}

/** 完整信息弹窗（只读）。z-[60] 高于各面板(z-50)。mt=true（在线跨玩家内容）时名称/字段值按当前语言机翻。 */
export function EntityDetailModal({ kind, data, onClose, mt }: { kind: EntityKind; data: any; onClose: () => void; mt?: boolean }) {
  const rawName = String(data?.name || '（无名）');
  const nameMt = useAutoText(mt ? rawName : undefined);
  const name = mt ? nameMt : rawName;
  const accent = accentColor(kind, data);
  const rows = FIELDS[kind].map(([label, key]) => [label, fieldText(data, key)] as [string, string]).filter(([, v]) => v);

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md max-h-[80dvh] flex flex-col rounded-2xl border bg-void shadow-[0_0_60px_rgba(0,0,0,0.85)] overflow-hidden" style={{ borderColor: `${accent}66` }}>
        <header className="shrink-0 flex items-center gap-2.5 px-5 py-3.5 border-b border-edge" style={{ background: `linear-gradient(90deg, ${accent}1a, transparent)` }}>
          <span className="text-2xl">{entityEmoji(kind, data)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-100 truncate" style={{ color: accent }}>{name}</span>
              <GradeChip kind={kind} data={data} />
            </div>
            <div className="text-[10px] font-mono text-dim/50 mt-0.5">{kindLabel(kind)}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {rows.length === 0 && <div className="text-center text-dim/40 text-xs font-mono py-6">— 无更多信息 —</div>}
          {rows.map(([label, value]) => <DetailRow key={label} label={label} value={value} mt={mt} />)}
        </div>
      </div>
    </div>
  );
}
