import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compressWithMark, decompressMaybe, isCompressed, lzLocalStorage, migrateCompressLegacy,
  flushPersistWrites, suspendPersistWrites, resumePersistWrites, debouncedLocalStorage,
} from './compressedStorage';

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

  it('lzLocalStorage：set 排程合并、flush 后底层为压缩串、get 全程读到明文', () => {
    const json = '{"state":{"x":1},"version":0}';
    lzLocalStorage.setItem('drpg-misc-test', json);
    expect(lzLocalStorage.getItem('drpg-misc-test')).toBe(json);               // 未落盘也读得到（排程值·读写一致）
    flushPersistWrites();                                                      // 合并写盘：强制落盘（正常运行由 300ms 定时器/关页钩子触发）
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

describe('合并写盘（debounce·治回合结算几十次全量压缩写卡主线程）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    flushPersistWrites();      // 清空排程（fake timer 还在时 clearTimeout 才能对上号）
    resumePersistWrites();     // 挂起态是模块级状态，测试间必须复位
    vi.useRealTimers();
    localStorage.removeItem('drpg-db-test');
    localStorage.removeItem('drpg-db-plain');
  });

  it('同 key 连写 30 次：窗口内底层零写入，到 300ms 只落盘最后一次的值', () => {
    for (let i = 0; i < 30; i++) lzLocalStorage.setItem('drpg-db-test', `{"state":{"i":${i}},"version":0}`);
    expect(localStorage.getItem('drpg-db-test')).toBeNull();                  // 窗口内：一次都没写
    vi.advanceTimersByTime(299);
    expect(localStorage.getItem('drpg-db-test')).toBeNull();                  // 窗口固定不重置（首写起算）
    vi.advanceTimersByTime(1);
    expect(isCompressed(localStorage.getItem('drpg-db-test'))).toBe(true);    // 到点落盘且为压缩串
    expect(decompressMaybe(localStorage.getItem('drpg-db-test'))).toBe('{"state":{"i":29},"version":0}');   // 只保留最后值
  });

  it('读写一致：排程未落盘期间 getItem 立即读到最新明文', () => {
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"a":1},"version":0}');
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"a":2},"version":0}');
    expect(lzLocalStorage.getItem('drpg-db-test')).toBe('{"state":{"a":2},"version":0}');   // 底层没写也读得到
    expect(localStorage.getItem('drpg-db-test')).toBeNull();
  });

  it('removeItem 取消排程：删除后到点不会「复活」旧值', () => {
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"x":1},"version":0}');
    lzLocalStorage.removeItem('drpg-db-test');
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem('drpg-db-test')).toBeNull();
  });

  it('suspendPersistWrites（读档窗口）：先 flush 已排程的，随后的写被丢弃，maxMs 兜底自动恢复', () => {
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"pre":1},"version":0}');
    suspendPersistWrites(1000);
    expect(decompressMaybe(localStorage.getItem('drpg-db-test'))).toBe('{"state":{"pre":1},"version":0}');   // 挂起先落盘已排程的
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"dropped":1},"version":0}');   // 挂起期写＝读档要抛弃的 live 状态
    vi.advanceTimersByTime(500);
    expect(decompressMaybe(localStorage.getItem('drpg-db-test'))).toBe('{"state":{"pre":1},"version":0}');   // 没被盖（读档快照安全）
    vi.advanceTimersByTime(500);                                               // 到 maxMs：自动恢复（读档失败没 reload 的兜底）
    lzLocalStorage.setItem('drpg-db-test', '{"state":{"after":1},"version":0}');
    vi.advanceTimersByTime(300);
    expect(decompressMaybe(localStorage.getItem('drpg-db-test'))).toBe('{"state":{"after":1},"version":0}');
  });

  it('debouncedLocalStorage（不压缩版）：同样合并，落盘为裸 JSON（与 zustand 默认格式一致·切换零迁移）', () => {
    for (let i = 0; i < 10; i++) debouncedLocalStorage.setItem('drpg-db-plain', `{"state":{"i":${i}},"version":0}`);
    expect(localStorage.getItem('drpg-db-plain')).toBeNull();
    expect(debouncedLocalStorage.getItem('drpg-db-plain')).toBe('{"state":{"i":9},"version":0}');   // 读写一致
    vi.advanceTimersByTime(300);
    expect(localStorage.getItem('drpg-db-plain')).toBe('{"state":{"i":9},"version":0}');   // 裸 JSON、未压缩
  });
});
