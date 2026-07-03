// 世界竞技场·战斗桥接：把一张参赛卡的快照映射成赌场角斗场的 Gladiator（复用其战斗过场/描写/世界书管线），
// 以及上传前的挑选裁剪（技能+天赋合并≤10、储存空间物品≤5）与 AI 失败时的确定性兜底战报。
import type { Gladiator } from './casinoEngine';
import type { AssistSnapshot } from './arenaWorldProtocol';

const nameOf = (x: any): string => String((x && (x.name || x.title)) || '').trim();

function parseLevel(snap: AssistSnapshot): number {
  const m = String(snap.realm || snap.line || '').match(/Lv\.?\s*(\d+)/i);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 快照 → Gladiator（供 genArenaWorldBattle / ArenaWorldBattle 回放使用）。数值只用于战斗描写；胜负由服务端已定。 */
export function cardToGladiator(snap: AssistSnapshot): Gladiator {
  const a: any = snap.attrs || {};
  const num = (x: any, d = 5) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : d; };
  const list = (arr: any[] | undefined) =>
    (arr || [])
      .map((x) => ({ name: nameOf(x).slice(0, 40), effect: String((x && (x.effect || x.desc || x.description || x.detail)) || '').slice(0, 300) }))
      .filter((s) => s.name);
  const con = num(a.con, 10);
  const skills = list(snap.skills);
  return {
    name: snap.name || '契约者',
    race: snap.race || '人族',
    tier: snap.tier || '一阶',
    level: parseLevel(snap),
    profession: snap.profession || '契约者',
    rareProfession: false,
    bioStrength: snap.bioStrength || '',
    gender: snap.gender || '',
    style: snap.profession || '均衡',
    attrs: { str: num(a.str), agi: num(a.agi), con, int: num(a.int), cha: num(a.cha), luck: num(a.luck) },
    skills: skills.length ? skills : [{ name: '近身搏斗', effect: '徒手格斗，随机应变' }],
    talents: list(snap.traits),
    items: list(snap.items),
    appearance: snap.appearance || '',
    hpMax: Math.max(1, Math.round(Number(snap.maxHp) || con * 20)),
  };
}

export const ARENA_MAX_SKILLS = 10;   // 技能 + 天赋 合计上限
export const ARENA_MAX_ITEMS = 5;     // 储存空间物品上限

/** 上传前裁剪：按玩家勾选（名字集合）保留，未给勾选则取靠前的；再各自封顶。 */
export function trimForUpload(snap: AssistSnapshot, sel?: { keep?: Set<string>; keepItems?: Set<string> }): AssistSnapshot {
  const skillArr = (snap.skills || []) as any[];
  const traitArr = (snap.traits || []) as any[];
  let keptSkills = sel?.keep ? skillArr.filter((s) => sel.keep!.has(nameOf(s))) : skillArr.slice();
  let keptTraits = sel?.keep ? traitArr.filter((t) => sel.keep!.has(nameOf(t))) : traitArr.slice();
  if (keptSkills.length + keptTraits.length > ARENA_MAX_SKILLS) {
    keptSkills = keptSkills.slice(0, ARENA_MAX_SKILLS);
    keptTraits = keptTraits.slice(0, Math.max(0, ARENA_MAX_SKILLS - keptSkills.length));
  }
  let keptItems = (snap.items || []) as any[];
  if (sel?.keepItems) keptItems = keptItems.filter((it) => sel.keepItems!.has(nameOf(it)));
  keptItems = keptItems.slice(0, ARENA_MAX_ITEMS);
  return { ...snap, skills: keptSkills, traits: keptTraits, items: keptItems };
}

/** 把 AI 输出的一整段散文战报拆成"战斗场景"：优先按空行分段；无空行→按换行；仍是一整段→按句末标点粗切成 ~5 段。 */
export function splitScenes(prose: string): string[] {
  const clean = (prose || '').replace(/<think[\s\S]*?<\/think>/gi, '').replace(/```+/g, '').trim();
  if (!clean) return [];
  let parts = clean.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    const sentences = clean.split(/(?<=[。！？…])/).map((s) => s.trim()).filter(Boolean);
    const per = Math.max(1, Math.ceil(sentences.length / 5));
    parts = [];
    for (let i = 0; i < sentences.length; i += per) parts.push(sentences.slice(i, i + per).join(''));
  }
  return parts.slice(0, 12);
}

/** AI 生成战报失败时的确定性兜底：给一组通用战斗场景（钉死预定胜者获胜）。 */
export function fallbackArenaBattle(fighters: [Gladiator, Gladiator], winner: 0 | 1): { scenes: string[]; summary: string } {
  const w = fighters[winner], l = fighters[winner === 0 ? 1 : 0];
  const scenes = [
    `${w.name}与${l.name}在世界竞技场的擂台上相对而立，气机锁定，杀意在空气里绷成一线。`,
    `${l.name}率先抢攻，招式如潮水般压来；${w.name}沉住气见招拆招，在攻防之间试探对手的破绽。`,
    `战至酣处，双方倾尽所学，招式往来间擂台震颤、光华四溅，一时难分高下、险象环生。`,
    `捕捉到${l.name}露出的一线空当，${w.name}骤然爆发，倾力一击直贯要害，局势就此逆转。`,
    `${l.name}力竭倒地，${w.name}屹立于擂台之上——这场对决，终究是${w.name}笑到了最后。`,
  ];
  return { scenes, summary: `${w.name} 战胜 ${l.name}，赢得这场对决。` };
}
