import { describe, it, expect } from 'vitest';
import { isPetLike, isCompanionTag, ownerOf } from './petEvolution';

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

describe('isCompanionTag（随行伙伴＝随从/宠物/召唤物——随行清单/编号表统一判据，防散写漏召唤物）', () => {
  it('随从 / 宠物 / 召唤物 → true', () => {
    expect(isCompanionTag({ npcTag: '随从' })).toBe(true);
    expect(isCompanionTag({ npcTag: '宠物' })).toBe(true);
    expect(isCompanionTag({ npcTag: '召唤物' })).toBe(true);   // 历史坑：散写 随从||宠物 时召唤物被漏掉
  });
  it('契约者 / 土著 / 空 → false', () => {
    expect(isCompanionTag({ npcTag: '契约者' })).toBe(false);
    expect(isCompanionTag({ npcTag: '土著' })).toBe(false);
    expect(isCompanionTag({})).toBe(false);
  });
});

describe('ownerOf（归属外键·缺省=主角B1）', () => {
  it('有 ownerId 用 ownerId，缺省回退 B1', () => {
    expect(ownerOf({ ownerId: 'C3' })).toBe('C3');
    expect(ownerOf({ ownerId: 'B1' })).toBe('B1');
    expect(ownerOf({ ownerId: undefined })).toBe('B1');
    expect(ownerOf({})).toBe('B1');
    expect(ownerOf({ ownerId: '' })).toBe('B1');
  });
});
