import type { Enhancement } from '../types';

// 强化商店配置。成本随已购等级指数增长：cost = round(baseCost * costGrowth^level)。
export const enhancements: Enhancement[] = [
  { id: 'hp', name: '强化体魄', desc: '生命上限 +20', stat: 'maxHp', amount: 20, baseCost: 30, costGrowth: 1.35 },
  { id: 'atk', name: '锤炼杀意', desc: '攻击 +4', stat: 'atk', amount: 4, baseCost: 40, costGrowth: 1.4 },
  { id: 'def', name: '淬炼护体', desc: '防御 +2', stat: 'def', amount: 2, baseCost: 35, costGrowth: 1.4 },
  { id: 'san', name: '凝练神魂', desc: '精神上限 +20', stat: 'maxSan', amount: 20, baseCost: 30, costGrowth: 1.35 },
];

export const enhanceCost = (e: Enhancement, level: number) =>
  Math.round(e.baseCost * Math.pow(e.costGrowth, level));
