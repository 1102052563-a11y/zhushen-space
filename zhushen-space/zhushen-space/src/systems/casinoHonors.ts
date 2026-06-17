import { useCharacters } from '../store/characterStore';
import { usePlayer } from '../store/playerStore';
import type { CasinoStats } from '../store/casinoStore';

/* ════════════════════════════════════════════
   赌坊战绩 → 称号 / 成就（纯确定性，达标即授予；upsert 去重，重复调用无副作用）
   - 称号授予主角 B1（characterStore.addTitle，会维持≤6上限）
   - 成就走 playerStore.addAchievement（按 id upsert）
   - 在每次结算后由 casinoStore 调用（recordResult / cashoutLadder / 翻车收尾）
════════════════════════════════════════════ */

interface HonorDef {
  test: (s: CasinoStats) => boolean;
  title?: { name: string; rarity: string; effect?: string; desc: string };
  ach?: { id: string; name: string; rarity: string; desc: string; condition: string; hidden?: boolean };
}

const HONORS: HonorDef[] = [
  {
    test: (s) => s.hands >= 25,
    title: { name: '赌坊常客', rarity: '绿色', desc: '在轮回赌坊厮混已久，认得每一张牌桌。' },
    ach: { id: 'casino_regular', name: '赌坊常客', rarity: '绿色', desc: '在赌坊累计下注 25 局。', condition: '累计 25 局' },
  },
  {
    test: (s) => s.biggestWin >= 2000,
    title: { name: '一掷千金', rarity: '蓝色', desc: '单局豪赢，眼都不眨。' },
    ach: { id: 'casino_bigwin', name: '一掷千金', rarity: '蓝色', desc: '单局净赢 ≥ 2000 筹码。', condition: '单局净赢≥2000' },
  },
  {
    test: (s) => s.bestWinStreak >= 5,
    title: { name: '连胜赌徒', rarity: '紫色', effect: '气运加身', desc: '五连绝胜，桌上无人敢与之对赌。' },
    ach: { id: 'casino_streak5', name: '五连绝胜', rarity: '紫色', desc: '取得 5 连胜。', condition: '连胜≥5' },
  },
  {
    test: (s) => s.wagered >= 50000,
    ach: { id: 'casino_whale', name: '豪赌之王', rarity: '暗紫色', desc: '累计投注 ≥ 50000 筹码。', condition: '累计投注≥50000' },
  },
  {
    test: (s) => s.lost >= 30000 && s.lost > s.won,
    title: { name: '赌鬼', rarity: '紫色', desc: '输红了眼也不肯离桌——一个略带讥诮的"荣誉"。' },
    ach: { id: 'casino_degenerate', name: '十赌九输', rarity: '紫色', desc: '累计输掉 ≥ 30000 且净亏损。', condition: '累计输≥30000且净亏', hidden: true },
  },
  {
    test: (s) => s.biggestWin >= 10000 || s.bestWinStreak >= 10,
    title: { name: '赌神', rarity: '暗金', effect: '令众赌客胆寒的传说', desc: '轮回赌坊公认的赌神，一坐下便能搅动整座赌场的风云。' },
    ach: { id: 'casino_godofgamblers', name: '赌神降世', rarity: '暗金', desc: '单局净赢 ≥ 10000 或达成 10 连胜。', condition: '单局≥10000 或 连胜≥10' },
  },
];

export function awardCasinoHonors(stats: CasinoStats): void {
  try {
    const ch = useCharacters.getState();
    const pl = usePlayer.getState();
    const ownedTitles = new Set((ch.characters['B1']?.titles ?? []).map((t) => t.name));
    const ownedAch = new Set((pl.achievements ?? []).map((a) => a.id));
    for (const h of HONORS) {
      if (!h.test(stats)) continue;
      if (h.title && !ownedTitles.has(h.title.name)) {
        ch.addTitle('B1', { ...h.title, source: '轮回赌坊', equipped: false });
      }
      if (h.ach && !ownedAch.has(h.ach.id)) {
        pl.addAchievement({ name: h.ach.name, desc: h.ach.desc, category: '赌坊', type: '累计', rarity: h.ach.rarity, hidden: !!h.ach.hidden, condition: h.ach.condition, id: h.ach.id });
      }
    }
  } catch { /* 角色未建档等异常静默 */ }
}
