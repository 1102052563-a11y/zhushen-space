/* 悬浮图鉴 · 世界档案层接线：异步装载 / 撞名优先级 / 世界切换重装 / 查无档案不重复请求。
   解析本身在 worldDetailCodex.test.ts；这里只验证 codexIndex 的异步缓存与失效逻辑——
   那是流式每帧调用的路径，出 bug 会变成每 100ms 一次网络请求。 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGetWorldDetail } = vi.hoisted(() => ({ mockGetWorldDetail: vi.fn() }));

vi.mock('./worldDetail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./worldDetail')>()),
  getWorldDetail: mockGetWorldDetail,
}));
// 轮回 wiki 层在测试里恒空：它走 fetch，与本测试无关，且会引入噪声
vi.mock('./lunhuiChars', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lunhuiChars')>()),
  lunhuiCharsCached: () => [],
  loadLunhuiCharacters: async () => [],
}));

import { getCodexIndex, resetCodexIndex } from './codexIndex';
import { useMisc } from '../store/miscStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useFaction } from '../store/factionStore';
import { useCosmos } from '../store/cosmosStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';

const PLOT = `**【主要人物】**
- **克莱恩·莫雷蒂/愚者（周明瑞）**｜谨慎幽默重责任；马甲夏洛克、格尔曼。
- **奥黛丽·霍尔（正义）**｜空想家途径。

**【贵重物品】**
- 魔药配方：序列晋升的核心。
`;

/** 异步装载落地：ensureWorldDetail 的 then/finally 是微任务链 */
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function setup(worldName: string, npcs: Record<string, unknown> = {}) {
  useNpc.setState({ npcs } as any);
  useItems.setState({ items: [] } as any);
  useCharacters.setState({ characters: {} } as any);
  useFaction.setState({ factions: {} } as any);
  useCosmos.setState({ entities: [] } as any);
  useTerritory.setState({ unlocked: false, name: '', buildings: [], effects: [] } as any);
  useTeam.setState({ perks: [] } as any);
  useMisc.setState({ worldName } as any);
  resetCodexIndex();
}

beforeEach(() => {
  mockGetWorldDetail.mockReset();
  mockGetWorldDetail.mockResolvedValue({ name: '诡秘之主', plot: PLOT });
});

describe('世界档案层', () => {
  it('任务世界：异步装载后人物/宝物进词典', async () => {
    setup('诡秘之主');
    getCodexIndex(true);
    await flush();
    const idx = getCodexIndex(true);
    expect(idx.byName.get('克莱恩·莫雷蒂')?.key).toBe('o:诡秘之主/克莱恩·莫雷蒂');
    expect(idx.byName.get('魔药配方')?.key).toBe('v:诡秘之主/魔药配方');
  });

  it('别名同样进词典——正文常只写马甲名', async () => {
    setup('诡秘之主');
    getCodexIndex(true);
    await flush();
    const idx = getCodexIndex(true);
    expect(idx.byName.get('夏洛克')?.name).toBe('克莱恩·莫雷蒂');
    expect(idx.byName.get('周明瑞')?.name).toBe('克莱恩·莫雷蒂');
  });

  it('撞名时本档 NPC 赢——玩家真见过的人优先于档案里的同名人', async () => {
    setup('诡秘之主', { C1: { id: 'C1', name: '克莱恩·莫雷蒂', realm: '绝强·Lv.95' } });
    getCodexIndex(true);
    await flush();
    expect(getCodexIndex(true).byName.get('克莱恩·莫雷蒂')?.key).toBe('n:C1');
  });

  it('乐园本部不装载，也不发请求', async () => {
    setup('轮回乐园');
    getCodexIndex(true);
    await flush();
    expect(mockGetWorldDetail).not.toHaveBeenCalled();
    expect(getCodexIndex(true).byName.has('克莱恩·莫雷蒂')).toBe(false);
  });

  it('codexWiki 关 → 不装载（世界档案是原著设定，跟着剧透开关走）', async () => {
    setup('诡秘之主');
    getCodexIndex(false);
    await flush();
    expect(mockGetWorldDetail).not.toHaveBeenCalled();
  });

  it('世界一换就重装', async () => {
    setup('诡秘之主');
    getCodexIndex(true);
    await flush();
    expect(getCodexIndex(true).byName.has('克莱恩·莫雷蒂')).toBe(true);

    mockGetWorldDetail.mockResolvedValue({ name: '我欲封天', plot: '**【主要人物】**\n- 孟浩（主角）｜隐忍护短。\n' });
    useMisc.setState({ worldName: '我欲封天' } as any);
    getCodexIndex(true);
    await flush();
    const idx = getCodexIndex(true);
    expect(idx.byName.has('孟浩')).toBe(true);
    expect(idx.byName.has('克莱恩·莫雷蒂')).toBe(false);   // 旧世界的条目必须清掉
  });

  it('⚠ 查无档案只请求一次——本函数被流式每帧调用，重试会打成每 100ms 一发', async () => {
    setup('某个没写过的世界');
    mockGetWorldDetail.mockResolvedValue(null);
    for (let i = 0; i < 5; i++) { getCodexIndex(true); await flush(); }
    expect(mockGetWorldDetail).toHaveBeenCalledTimes(1);
  });

  it('⚠ 装载失败同样不重试（失败也要落已试过标记）', async () => {
    setup('诡秘之主');
    mockGetWorldDetail.mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 5; i++) { getCodexIndex(true); await flush(); }
    expect(mockGetWorldDetail).toHaveBeenCalledTimes(1);
  });
});
