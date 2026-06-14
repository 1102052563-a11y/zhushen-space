import type { Instance } from '../types';

// 副本配置表。nodes 是从入口到 BOSS 的节点序列，按顺序推进。
export const instances: Instance[] = [
  {
    id: 'hospital',
    name: '废弃医院',
    theme: '丧尸 · 入门试炼',
    difficulty: '入门',
    recommend: 70,
    reward: 70,
    nodes: [
      { type: 'event', eventId: 'supply' },
      { type: 'combat', monsterId: 'zombie' },
      { type: 'event', eventId: 'survivor' },
      { type: 'combat', monsterId: 'zombie_dog' },
      { type: 'boss', monsterId: 'nurse' },
    ],
  },
  {
    id: 'raccoon',
    name: '浣熊市',
    theme: '生化危机 · 城市沦陷',
    difficulty: '普通',
    recommend: 130,
    reward: 140,
    nodes: [
      { type: 'combat', monsterId: 'zombie' },
      { type: 'event', eventId: 'trap' },
      { type: 'combat', monsterId: 'licker' },
      { type: 'event', eventId: 'altar' },
      { type: 'combat', monsterId: 'zombie_dog' },
      { type: 'boss', monsterId: 'tyrant' },
    ],
  },
  {
    id: 'alien',
    name: '诺斯特罗莫号',
    theme: '异形 · 深空惊魂',
    difficulty: '困难',
    recommend: 220,
    reward: 240,
    nodes: [
      { type: 'event', eventId: 'whisper' },
      { type: 'combat', monsterId: 'facehugger' },
      { type: 'combat', monsterId: 'drone' },
      { type: 'event', eventId: 'mirror' },
      { type: 'combat', monsterId: 'drone' },
      { type: 'boss', monsterId: 'queen' },
    ],
  },
  {
    id: 'mansion',
    name: '七夜古宅',
    theme: '灵异 · 精神炼狱',
    difficulty: '噩梦',
    recommend: 300,
    reward: 360,
    nodes: [
      { type: 'event', eventId: 'whisper' },
      { type: 'combat', monsterId: 'wraith' },
      { type: 'event', eventId: 'mirror' },
      { type: 'combat', monsterId: 'wraith' },
      { type: 'event', eventId: 'altar' },
      { type: 'boss', monsterId: 'vengeful' },
    ],
  },
];

export const getInstance = (id: string) => instances.find((i) => i.id === id);
