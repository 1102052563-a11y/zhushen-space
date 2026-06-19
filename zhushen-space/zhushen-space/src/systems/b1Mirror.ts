import { useCharacters } from '../store/characterStore';

/* ── 主角(B1) 轻量镜像 + 启动自检兜底 ─────────────────────────────────────
   characterStore 里 B1 的 技能/天赋/副职业/称号/记忆 单独镜像到一个**独立 localStorage 键**，
   作为「角色库被清 / B1 莫名丢失」的最后一道兜底：
   - 每回合（随自动存档）写一次，**只在 B1 非空时写**——绝不用空 B1 覆盖已有好镜像；
   - 启动自检：B1 空(或不存在)、却**存在其它角色(NPC)**（=对局进行中而非全新档）、且镜像有内容
     → 自动把镜像并回 B1（按名字去重、只增不减）。
   该键不在 loadSlot 的 CLEAR_ON_MISSING 里（读档/回退不会删它），随 clearProgress(新游戏) 清。*/
const MIRROR_KEY = 'drpg-b1-mirror';

interface B1Mirror {
  skills: any[]; traits: any[]; subProfessions: any[]; titles: any[]; memories: any[];
  updatedAt: number;
}

const len = (a: any) => (Array.isArray(a) ? a.length : 0);
const hasContent = (b: any) => !!b && (len(b.skills) + len(b.traits) + len(b.subProfessions) > 0);
const keyOf = (x: any) => (typeof x === 'string' ? x : (x?.name ?? x?.title ?? ''));
function mergeByName(a: any[] = [], b: any[] = []): any[] {
  const out = [...(a || [])];
  const have = new Set((a || []).map(keyOf));
  for (const x of (b || [])) { const k = keyOf(x); if (k && !have.has(k)) { out.push(x); have.add(k); } }
  return out;
}

/** 随回合写镜像（仅当 B1 有实质内容时）。失败静默——兜底不该影响主流程。 */
export function writeB1Mirror(): void {
  try {
    const b: any = useCharacters.getState().characters['B1'];
    if (!hasContent(b)) return;
    const m: B1Mirror = {
      skills: b.skills || [], traits: b.traits || [], subProfessions: b.subProfessions || [],
      titles: b.titles || [], memories: b.memories || [], updatedAt: Date.now(),
    };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(m));
  } catch { /* 兜底写失败忽略 */ }
}

export function readB1Mirror(): B1Mirror | null {
  try { const r = localStorage.getItem(MIRROR_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

export function clearB1Mirror(): void {
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* */ }
}

/** 启动自检：B1 异常空且对局在进行 → 从镜像并回。返回并入后计数（供提示）；无需恢复返回 null。 */
export function restoreB1IfWiped(): { counts: { skills: number; traits: number; subProfessions: number; titles: number } } | null {
  try {
    const chars: Record<string, any> = useCharacters.getState().characters || {};
    const b1 = chars['B1'];
    if (hasContent(b1)) return null;                                   // B1 有内容，无需补
    if (!Object.keys(chars).some((k) => k !== 'B1')) return null;      // 没有其它角色=全新/空档，别误补
    const m = readB1Mirror();
    if (!m || len(m.skills) + len(m.traits) + len(m.subProfessions) === 0) return null;

    const cur: any = b1 || {};
    const merged = {
      ...cur,
      skills: mergeByName(cur.skills, m.skills),
      traits: mergeByName(cur.traits, m.traits),
      subProfessions: mergeByName(cur.subProfessions, m.subProfessions),
      titles: mergeByName(cur.titles, m.titles),
      memories: mergeByName(cur.memories, m.memories),
    };
    useCharacters.setState((s) => ({ characters: { ...s.characters, B1: merged } }));
    try { (useCharacters.getState() as any).dedupeIds?.(); } catch { /* 合并可能撞历史 id，去重一次 */ }
    return {
      counts: {
        skills: len(merged.skills), traits: len(merged.traits),
        subProfessions: len(merged.subProfessions), titles: len(merged.titles),
      },
    };
  } catch { return null; }
}
