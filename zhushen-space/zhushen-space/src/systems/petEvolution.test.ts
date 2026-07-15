import { describe, it, expect } from 'vitest';
import { isPetLike } from './petEvolution';

describe('isPetLike（宠物/召唤物 从 NPC 演化分流的唯一判据）', () => {
  it('宠物 / 召唤物 → true', () => {
    expect(isPetLike({ npcTag: '宠物' })).toBe(true);
    expect(isPetLike({ npcTag: '召唤物' })).toBe(true);
  });
  it('契约者 / 土著 / 随从 / 空 / 未定义 → false（仍留在 NPC 演化）', () => {
    expect(isPetLike({ npcTag: '契约者' })).toBe(false);
    expect(isPetLike({ npcTag: '土著' })).toBe(false);
    expect(isPetLike({ npcTag: '随从' })).toBe(false);
    expect(isPetLike({ npcTag: '' })).toBe(false);
    expect(isPetLike({ npcTag: undefined })).toBe(false);
    expect(isPetLike({})).toBe(false);
  });
});
