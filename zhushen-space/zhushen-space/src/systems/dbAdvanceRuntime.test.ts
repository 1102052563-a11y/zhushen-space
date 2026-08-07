import { describe, it, expect } from 'vitest';
import { mergeDbAdvanceRuntime } from './dbAdvanceRuntime';
import { compressWithMark, isCompressed, decompressMaybe } from './compressedStorage';

/* 数据库推进·读档/回退：运行态(桌面态/stage/scene/recall)随时间线回滚，预设/开关保当前。
   治「回档后推进还记着之前内容」——旧行为是整个 drpg-dbadvance 不进快照，桌面态原封不动活过回档。 */

const mk = (o: Record<string, unknown>) => JSON.stringify({ state: { preset: null, presetName: '', enabled: true, useRecall: true, lastTabletop: '', lastStage: '', lastScene: '', lastRecall: '', ...o }, version: 0 });
const st = (json: string | null) => JSON.parse(json!).state;

describe('mergeDbAdvanceRuntime · 读档回滚推进运行态', () => {
  it('存档带运行态 → 回滚到存档那份；预设/开关保留【当前】值', () => {
    const cur = mk({ lastTabletop: '未来·第10回合桌面', lastStage: '未来stage', presetName: '玩家刚导入的新预设', enabled: false });
    const saved = mk({ lastTabletop: '第5回合桌面', lastStage: '旧stage', lastScene: '旧scene', lastRecall: '旧recall', presetName: '存档当时的老预设', enabled: true });
    const s = st(mergeDbAdvanceRuntime(saved, cur));
    expect(s.lastTabletop).toBe('第5回合桌面');       // 运行态回滚
    expect(s.lastStage).toBe('旧stage');
    expect(s.lastScene).toBe('旧scene');
    expect(s.lastRecall).toBe('旧recall');
    expect(s.presetName).toBe('玩家刚导入的新预设');   // 配置不回滚
    expect(s.enabled).toBe(false);
  });

  it('存档没带（修复前的旧档/回退点）→ 运行态清空，绝不留"未来"的桌面态；预设仍在', () => {
    const cur = mk({ lastTabletop: '未来桌面', lastRecall: '未来召回', presetName: 'Stitches' });
    const s = st(mergeDbAdvanceRuntime(undefined, cur));
    expect(s.lastTabletop).toBe('');
    expect(s.lastRecall).toBe('');
    expect(s.presetName).toBe('Stitches');
  });

  it('本 store 走 lzStorage：当前值是压缩串 → 合并结果也回压缩（格式不漂）', () => {
    const cur = compressWithMark(mk({ lastTabletop: '未来桌面', presetName: 'Stitches' }));
    const out = mergeDbAdvanceRuntime(compressWithMark(mk({ lastTabletop: '存档桌面' })), cur);
    expect(isCompressed(out!)).toBe(true);
    const s = st(decompressMaybe(out));
    expect(s.lastTabletop).toBe('存档桌面');
    expect(s.presetName).toBe('Stitches');
  });

  it('本机还没有推进配置 → 直接用存档值；两边都没有 → null（不写）', () => {
    const saved = mk({ lastTabletop: '存档桌面' });
    expect(mergeDbAdvanceRuntime(saved, null)).toBe(saved);
    expect(mergeDbAdvanceRuntime(undefined, null)).toBeNull();
    expect(mergeDbAdvanceRuntime(undefined, 'not-json')).toBeNull();   // 当前值坏了也不抛
  });
});
