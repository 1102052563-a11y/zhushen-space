import { create } from 'zustand';
import type { Player, Monster, GameEvent } from '../types';
import { getInstance } from '../data/instances';
import { monsters } from '../data/monsters';
import { events } from '../data/events';
import { enhancements, enhanceCost } from '../data/enhancements';
import { rollDamage } from '../systems/combat';
import {
  loadSave, writeSave, clearSave, encodeSave, decodeSave,
} from '../utils/save';

type View = 'hub' | 'instance' | 'result';

interface CombatState {
  monster: Monster;
  enemyHp: number;
  log: string[];
  over: boolean;     // 敌人已被击败，等待玩家点「继续」
}

interface ResultState {
  success: boolean;
  title: string;
  detail: string;
}

const BASE_PLAYER: Player = {
  hp: 100, maxHp: 100, mp: 50, maxMp: 50, atk: 18, def: 6, san: 100, maxSan: 100, points: 0, cleared: [],
};

interface GameState {
  player: Player;
  view: View;
  enhanceLevels: Record<string, number>;

  runInstanceId: string | null;
  nodeIndex: number;
  combat: CombatState | null;
  currentEvent: GameEvent | null;
  eventResult: string | null; // 事件选择后的结果文本，展示后再推进
  result: ResultState | null;

  inventory: string[];

  enterInstance: (id: string) => void;
  chooseOption: (i: number) => void;
  continueAfterEvent: () => void;
  attack: () => void;
  defend: () => void;
  continueAfterCombat: () => void;
  leaveResult: () => void;
  buyEnhancement: (id: string) => void;
  rest: () => void;
  hardReset: () => void;
  doExport: () => string;
  doImport: (text: string) => boolean;
  setPlayerField: (key: 'hp' | 'maxHp' | 'mp' | 'maxMp' | 'san' | 'maxSan' | 'points' | 'atk' | 'def', value: number) => void;
  addItem: (name: string) => void;
  removeItem: (name: string) => void;
}

const persist = (s: { player: Player; enhanceLevels: Record<string, number> }) =>
  writeSave(s.player, s.enhanceLevels);

const clampPlayer = (p: Player): Player => {
  // 兼容旧存档：缺失 mp/maxMp 时补默认值
  const maxMp = p.maxMp ?? BASE_PLAYER.maxMp;
  const mp = p.mp ?? maxMp;
  return {
    ...p,
    maxMp,
    mp: Math.min(mp, maxMp),
    hp: Math.min(p.hp, p.maxHp),
    san: Math.min(p.san, p.maxSan),
  };
};

const saved = loadSave();

export const useGame = create<GameState>((set, get) => ({
  player: saved ? clampPlayer(saved.player) : { ...BASE_PLAYER },
  view: 'hub',
  enhanceLevels: saved?.enhanceLevels ?? {},
  inventory: [],

  runInstanceId: null,
  nodeIndex: 0,
  combat: null,
  currentEvent: null,
  eventResult: null,
  result: null,

  enterInstance: (id) => {
    const inst = getInstance(id);
    if (!inst) return;
    const player = clampPlayer(get().player);
    set({ player, runInstanceId: id, nodeIndex: 0, view: 'instance', result: null });
    loadNode(set, get, 0);
  },

  chooseOption: (i) => {
    const ev = get().currentEvent;
    if (!ev) return;
    const opt = ev.options[i];
    let player = { ...get().player };
    if (opt.effects.hp) player.hp = player.hp + opt.effects.hp;
    if (opt.effects.san) player.san = player.san + opt.effects.san;
    if (opt.effects.points) player.points = Math.max(0, player.points + (opt.effects.points || 0));
    player = clampPlayer(player);
    set({ player, currentEvent: null, eventResult: opt.result });
    persist(get());
    if (checkDeath(set, get)) return;
  },

  continueAfterEvent: () => {
    set({ eventResult: null });
    advance(set, get);
  },

  attack: () => {
    const c = get().combat;
    if (!c || c.over) return;
    const player = get().player;
    const dmg = rollDamage(player.atk, c.monster.def);
    const enemyHp = c.enemyHp - dmg;
    const log = [...c.log, `你对${c.monster.name}造成 ${dmg} 点伤害。`];

    if (enemyHp <= 0) {
      log.push(`${c.monster.name}倒下了。`);
      set({ combat: { ...c, enemyHp: 0, log, over: true } });
      return;
    }
    // 敌方反击
    enemyTurn(set, get, c, enemyHp, log, false);
  },

  defend: () => {
    const c = get().combat;
    if (!c || c.over) return;
    const log = [...c.log, '你举盾格挡，准备承受下一击。'];
    enemyTurn(set, get, c, c.enemyHp, log, true);
  },

  continueAfterCombat: () => {
    set({ combat: null });
    advance(set, get);
  },

  leaveResult: () => {
    set({ view: 'hub', result: null, runInstanceId: null, combat: null, currentEvent: null });
  },

  buyEnhancement: (id) => {
    const e = enhancements.find((x) => x.id === id);
    if (!e) return;
    const levels = get().enhanceLevels;
    const lv = levels[id] ?? 0;
    const cost = enhanceCost(e, lv);
    const player = { ...get().player };
    if (player.points < cost) return;
    player.points -= cost;
    (player[e.stat] as number) += e.amount;
    // 提升上限时同步回满当前值，体验更好
    if (e.stat === 'maxHp') player.hp = player.maxHp;
    if (e.stat === 'maxSan') player.san = player.maxSan;
    const enhanceLevels = { ...levels, [id]: lv + 1 };
    set({ player, enhanceLevels });
    persist(get());
  },

  rest: () => {
    const COST = 25;
    const player = { ...get().player };
    if (player.points < COST) return;
    if (player.hp >= player.maxHp && player.san >= player.maxSan) return;
    player.points -= COST;
    player.hp = player.maxHp;
    player.san = player.maxSan;
    set({ player });
    persist(get());
  },

  hardReset: () => {
    clearSave();
    set({
      player: { ...BASE_PLAYER }, enhanceLevels: {}, inventory: [], view: 'hub',
      runInstanceId: null, nodeIndex: 0, combat: null, currentEvent: null,
      eventResult: null, result: null,
    });
  },

  setPlayerField: (key, value) => {
    set((s) => {
      const updated = { ...s.player, [key]: value };
      return { player: clampPlayer(updated) };
    });
    persist(get());   // 关键修复(2026-06-19)：HP/EP 改动必须落盘到 zhushen-save-v1。正文末尾<状态结算>/解析器/syncPlayerVitalsMax 全经 setPlayerField 改血蓝，旧实现不落盘→刷新/读档就回退到旧的持久化值(用户报"游戏中满血、一刷新就残血")。
  },

  addItem: (name) =>
    set((s) => ({ inventory: [...s.inventory, name] })),

  removeItem: (name) =>
    set((s) => {
      const idx = s.inventory.indexOf(name);
      if (idx === -1) return s;
      const next = [...s.inventory];
      next.splice(idx, 1);
      return { inventory: next };
    }),

  doExport: () => {
    const { player, enhanceLevels } = get();
    return encodeSave({ version: 1, player, enhanceLevels });
  },

  doImport: (text) => {
    const data = decodeSave(text);
    if (!data) return false;
    set({
      player: clampPlayer(data.player),
      enhanceLevels: data.enhanceLevels ?? {},
      view: 'hub', runInstanceId: null, combat: null, currentEvent: null,
      eventResult: null, result: null,
    });
    persist({ player: data.player, enhanceLevels: data.enhanceLevels ?? {} });
    return true;
  },
}));

// ---- 内部流程函数 ----

function loadNode(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
  index: number,
) {
  const inst = getInstance(get().runInstanceId!);
  if (!inst) return;
  if (index >= inst.nodes.length) {
    winInstance(set, get);
    return;
  }
  const node = inst.nodes[index];
  set({ nodeIndex: index, currentEvent: null, combat: null, eventResult: null });

  if (node.type === 'event') {
    const ev = events[node.eventId];
    set({ currentEvent: ev });
  } else {
    const m = monsters[node.monsterId];
    set({ combat: { monster: m, enemyHp: m.hp, log: [`${m.name}挡住了去路！`], over: false } });
  }
}

function advance(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
) {
  if (checkDeath(set, get)) return;
  loadNode(set, get, get().nodeIndex + 1);
}

function enemyTurn(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
  c: CombatState,
  enemyHp: number,
  log: string[],
  defending: boolean,
) {
  let raw = rollDamage(c.monster.atk, get().player.def);
  if (defending) raw = Math.max(1, Math.round(raw * 0.4));
  const player = { ...get().player };
  player.hp -= raw;
  log.push(`${c.monster.name}反击，造成 ${raw} 点伤害。`);
  if (c.monster.sanAtk) {
    player.san -= c.monster.sanAtk;
    log.push(`你的精神被侵蚀了 ${c.monster.sanAtk} 点。`);
  }
  set({ player, combat: { ...c, enemyHp, log, over: false } });
  persist(get());
  checkDeath(set, get);
}

// 返回 true 表示玩家已死亡并已切换到结算界面
function checkDeath(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
): boolean {
  const p = get().player;
  if (p.hp <= 0) {
    failRun(set, get, '殒命', '你的身体支撑不住，倒在了血泊之中。轮回乐园将你拽了回来。');
    return true;
  }
  if (p.san <= 0) {
    failRun(set, get, '精神崩溃', '理智的弦彻底断裂，你疯狂大笑着扑向虚空，被强制传送回轮回乐园。');
    return true;
  }
  return false;
}

function failRun(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
  title: string,
  detail: string,
) {
  // 死亡惩罚：扣除部分奖励点，HP/SAN 恢复少量以便继续
  const player = { ...get().player };
  const lost = Math.round(player.points * 0.3);
  player.points -= lost;
  player.hp = Math.max(20, Math.round(player.maxHp * 0.3));
  player.san = Math.max(20, Math.round(player.maxSan * 0.3));
  set({
    player, view: 'result', combat: null, currentEvent: null, eventResult: null,
    result: { success: false, title, detail: `${detail}\n损失奖励点 ${lost}。` },
  });
  persist(get());
}

function winInstance(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
) {
  const inst = getInstance(get().runInstanceId!)!;
  const player = { ...get().player };
  const firstClear = !player.cleared.includes(inst.id);
  const reward = firstClear ? inst.reward : Math.round(inst.reward * 0.5);
  player.points += reward;
  if (firstClear) player.cleared = [...player.cleared, inst.id];
  set({
    player, view: 'result', combat: null, currentEvent: null, eventResult: null,
    result: {
      success: true,
      title: '副本通关',
      detail: `你活着走出了「${inst.name}」。\n获得奖励点 ${reward}${firstClear ? '（首通奖励）' : '（重复挑战减半）'}。`,
    },
  });
  persist(get());
}

/* ── 自动落盘兜底（2026-06-19）──
   gameStore 没用 zustand persist 中间件(其它 store 才用,改了自动存)，而是自定义 writeSave→localStorage['zhushen-save-v1']，
   原本只有部分 action 手动 persist(get())、setPlayerField 等曾漏掉→改了血蓝不落盘→刷新丢失。
   这里订阅 store：任何令 player/enhanceLevels 引用变化的 set **一律自动 writeSave**，等效于 persist 中间件的"改了就存"，
   但保留自定义存档格式(export/import 的 encodeSave/decodeSave 与存档槽都依赖它),零迁移、不动既有存档。
   各 action 里已有的 persist(get()) 并存(幂等无害)；即便将来新增动作忘了手动存，这里兜底——彻底杜绝"漏存"。
   guard：仅 player/enhanceLevels 引用变化才写(view/combat 等纯 UI 变化不触发),避免无谓写盘。 */
useGame.subscribe((s, prev) => {
  if (s.player !== prev.player || s.enhanceLevels !== prev.enhanceLevels) {
    try { writeSave(s.player, s.enhanceLevels); } catch { /* localStorage 不可用时静默忽略 */ }
  }
});
