// 全局类型定义。游戏数据与逻辑都围绕这些类型构建。

export interface Player {
  hp: number;
  maxHp: number;
  mp: number;        // 法力值
  maxMp: number;
  atk: number;
  def: number;
  san: number;       // 精神值，归零即精神崩溃
  maxSan: number;
  points: number;    // 主神奖励点，用于强化与修整
  cleared: string[]; // 已通关副本 id
}

export interface Monster {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
  sanAtk?: number;   // 每次攻击额外造成的精神伤害
  desc: string;
  boss?: boolean;
}

export interface EventOption {
  label: string;
  result: string;                 // 选择后的结果描述
  effects: {                      // 对玩家的影响（可正可负）
    hp?: number;
    san?: number;
    points?: number;
  };
}

export interface GameEvent {
  id: string;
  title: string;
  text: string;
  options: EventOption[];
}

export type NodeDef =
  | { type: 'combat'; monsterId: string }
  | { type: 'boss'; monsterId: string }
  | { type: 'event'; eventId: string };

export type Difficulty = '入门' | '普通' | '困难' | '噩梦';

export interface Instance {
  id: string;
  name: string;
  theme: string;
  difficulty: Difficulty;
  recommend: number; // 推荐战力
  reward: number;    // 通关基础奖励点
  nodes: NodeDef[];
}

export interface Enhancement {
  id: string;
  name: string;
  desc: string;
  stat: 'maxHp' | 'atk' | 'def' | 'maxSan';
  amount: number;
  baseCost: number;
  costGrowth: number; // 每级成本倍率
}
