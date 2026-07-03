// 世界竞技场·战斗桥接：把一张参赛卡的快照映射成赌场角斗场的 Gladiator（复用其战斗过场/描写/世界书管线），
// 以及上传前的挑选裁剪（技能+天赋合并≤10、储存空间物品≤5）与 AI 失败时的确定性兜底战报。
import type { Gladiator, BattleRound } from './casinoEngine';
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

/** AI 生成战报失败时的确定性兜底：几回合逐步磨血，钉死败方最终 HP=0。 */
export function fallbackArenaBattle(fighters: [Gladiator, Gladiator], winner: 0 | 1): { rounds: BattleRound[]; summary: string } {
  const loser: 0 | 1 = winner === 0 ? 1 : 0;
  const hp: [number, number] = [fighters[0].hpMax, fighters[1].hpMax];
  const rounds: BattleRound[] = [];
  const order: (0 | 1)[] = [winner, loser, winner, loser, winner];
  order.forEach((actor, i) => {
    const tgt: 0 | 1 = actor === 0 ? 1 : 0;
    const isFinal = i === order.length - 1;
    const skill = fighters[actor].skills[i % fighters[actor].skills.length] || { name: '搏击', effect: '' };
    const base = actor === winner ? fighters[loser].hpMax * 0.34 : fighters[winner].hpMax * 0.1;
    let dmg = Math.max(1, Math.round(base));
    if (isFinal) dmg = hp[tgt];   // 收尾一击带走
    hp[tgt] = Math.max(actor === winner && isFinal ? 0 : 1, Math.round(hp[tgt] - dmg));
    rounds.push({
      round: i + 1,
      actor,
      action: skill.name,
      desc: `${fighters[actor].name}以「${skill.name}」直取${fighters[tgt].name}，造成约 ${dmg} 点伤害。`,
      damage: dmg,
      hp: [hp[0], hp[1]],
      buffs: [[], []],
      os: [actor === winner ? '胜局在握。' : '还不能倒下……', ''],
    });
  });
  return { rounds, summary: `${fighters[winner].name} 在世界竞技场笑到了最后。` };
}
