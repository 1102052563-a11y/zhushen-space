import type { GameEvent } from '../types';

// 抉择事件表。每个事件给出 2-3 个选项，选择后对玩家产生不同影响。
export const events: Record<string, GameEvent> = {
  supply: {
    id: 'supply',
    title: '补给箱',
    text: '走廊尽头有一只半开的军用补给箱，但金属反光后似乎有什么在动。',
    options: [
      { label: '直接翻找', result: '你找到了医疗包和几枚奖励点芯片。', effects: { hp: 25, points: 15 } },
      { label: '谨慎绕开', result: '你绕开了它，错过补给，但毫发无伤。', effects: {} },
    ],
  },
  survivor: {
    id: 'survivor',
    title: '幸存者',
    text: '一名瑟瑟发抖的幸存者向你求救，他说知道安全屋的位置。',
    options: [
      { label: '带上他', result: '他带你抄了近路，并塞给你一些储备物资。', effects: { points: 25, hp: -5 } },
      { label: '独自前行', result: '你留下了他。背后传来的惨叫让你心头发紧。', effects: { san: -10 } },
    ],
  },
  trap: {
    id: 'trap',
    title: '诡雷',
    text: '地面上隐约有一根被踩亮的绊线。',
    options: [
      { label: '小心拆解', result: '你成功拆下雷管，回收了可观的零件。', effects: { points: 30 } },
      { label: '快速通过', result: '爆炸掀飞了你，所幸只是擦伤。', effects: { hp: -20 } },
    ],
  },
  whisper: {
    id: 'whisper',
    title: '黑暗中的低语',
    text: '墙壁里传来呼唤你名字的声音，温柔得令人想要靠近。',
    options: [
      { label: '凑近倾听', result: '声音钻进脑海，你的理智被狠狠撕咬了一口。', effects: { san: -25, points: 20 } },
      { label: '捂耳快走', result: '你强迫自己离开，心跳久久无法平复。', effects: { san: -8 } },
    ],
  },
  mirror: {
    id: 'mirror',
    title: '古镜',
    text: '一面蒙尘的铜镜里，你的倒影比你慢了半拍。',
    options: [
      { label: '打碎它', result: '镜碎的刹那一阵清明，精神为之一振。', effects: { san: 20, hp: -5 } },
      { label: '凝视倒影', result: '倒影对你笑了。你猛地后退，冷汗浸透后背。', effects: { san: -18, points: 15 } },
    ],
  },
  altar: {
    id: 'altar',
    title: '献祭石台',
    text: '石台上刻着：以血换力。一道凹槽正等待着鲜血。',
    options: [
      { label: '割破手掌', result: '剧痛之后，你感到力量在血管里奔涌。', effects: { hp: -25, points: 40 } },
      { label: '不予理会', result: '你转身离开，石台在身后发出失望的低鸣。', effects: {} },
    ],
  },
};
