import { describe, it, expect } from 'vitest';
import { compressWithMark, decompressMaybe, isCompressed, lzLocalStorage, migrateCompressLegacy } from './compressedStorage';

describe('compressedStorage · drpg-misc 压缩存（治长期事实撑爆 localStorage 配额）', () => {
  it('compress → decompress 往返一致（含大量中文事实）', () => {
    const facts = Array.from({ length: 2000 }, (_, i) => ({ id: `F_${i}`, title: `事实${i}`, text: `林源在轮回历第${i}回合确认了一个长期事实，用于关键词召回防穿帮。`, keywords: ['林源', '轮回', String(i)], addedAt: i }));
    const json = JSON.stringify({ state: { narrativeFacts: facts }, version: 0 });
    const packed = compressWithMark(json);
    expect(isCompressed(packed)).toBe(true);
    expect(packed.length).toBeLessThan(json.length / 2);   // 中文文本压缩显著（这里远超 2×）
    expect(decompressMaybe(packed)).toBe(json);            // 无损还原
  });

  it('旧·未压缩 JSON（无 LZ 前缀）→ decompressMaybe 原样返回（向后兼容·自动迁移）', () => {
    const legacy = '{"state":{"narrativeFacts":[]},"version":0}';
    expect(isCompressed(legacy)).toBe(false);
    expect(decompressMaybe(legacy)).toBe(legacy);   // 旧数据原样读出，不当压缩去解
  });

  it('lzLocalStorage：set 写入压缩、get 读回明文；且底层 localStorage 存的确实是压缩串', () => {
    const json = '{"state":{"x":1},"version":0}';
    lzLocalStorage.setItem('drpg-misc-test', json);
    expect(isCompressed(localStorage.getItem('drpg-misc-test'))).toBe(true);   // 底层是压缩的
    expect(lzLocalStorage.getItem('drpg-misc-test')).toBe(json);               // 读回明文一致
    lzLocalStorage.removeItem('drpg-misc-test');
    expect(lzLocalStorage.getItem('drpg-misc-test')).toBeNull();
  });

  it('lzLocalStorage.get 兼容底层已有的旧·未压缩值', () => {
    localStorage.setItem('drpg-misc-legacy', '{"a":1}');   // 直接写未压缩
    expect(lzLocalStorage.getItem('drpg-misc-legacy')).toBe('{"a":1}');
    localStorage.removeItem('drpg-misc-legacy');
  });

  describe('migrateCompressLegacy（启动即把旧·未压缩大值就地压缩·立即释放配额）', () => {
    it('未压缩的大值 → 就地重写为压缩（且解压还原一致）', () => {
      const big = JSON.stringify({ state: { npcs: Array.from({ length: 500 }, (_, i) => ({ id: `C${i}`, name: `契约者${i}`, bio: '在轮回历第若干回合与主角结盟，历经数个任务世界。' })) } });
      localStorage.setItem('drpg-npc', big);
      expect(isCompressed(localStorage.getItem('drpg-npc'))).toBe(false);
      migrateCompressLegacy(['drpg-npc']);
      const now = localStorage.getItem('drpg-npc');
      expect(isCompressed(now)).toBe(true);          // 已就地压缩
      expect(decompressMaybe(now)).toBe(big);         // 无损
      localStorage.removeItem('drpg-npc');
    });

    it('已压缩的值 → 原样不动（幂等·不重复压）', () => {
      const packed = compressWithMark('{"state":{"x":1}}');
      localStorage.setItem('drpg-faction', packed);
      migrateCompressLegacy(['drpg-faction']);
      expect(localStorage.getItem('drpg-faction')).toBe(packed);   // 未变
      localStorage.removeItem('drpg-faction');
    });

    it('缺失的 key → 静默跳过（不抛、不建空键）', () => {
      localStorage.removeItem('drpg-nope');
      expect(() => migrateCompressLegacy(['drpg-nope'])).not.toThrow();
      expect(localStorage.getItem('drpg-nope')).toBeNull();
    });
  });
});
