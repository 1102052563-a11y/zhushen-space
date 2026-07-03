import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setResumeFlag, getResumeFlag, clearResumeFlag } from './resumeFlag';

const KEY = 'drpg-pending-started';

describe('resumeFlag · 续玩标志跨 reload 存活（手机/PWA 修复）', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('set→get 往返拿回原值', () => {
    setResumeFlag(KEY);
    expect(getResumeFlag(KEY)).toBe('1');
  });

  it('缺失键返回 null', () => {
    expect(getResumeFlag('drpg-not-set')).toBeNull();
  });

  it('核心保证：标志写进 localStorage（跨 reload 存活），不是只写 sessionStorage（手机会丢）', () => {
    setResumeFlag(KEY);
    // 直接查底层存储：localStorage 有、sessionStorage 无 → 模拟 location.reload() 后仍读得到
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clear 之后读不到（localStorage 与 sessionStorage 两处都清）', () => {
    setResumeFlag(KEY);
    sessionStorage.setItem(KEY, '1');   // 制造两处残留
    clearResumeFlag(KEY);
    expect(getResumeFlag(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('携带任意字符串载荷（如 revar 的 JSON）原样往返', () => {
    const payload = JSON.stringify({ input: '向前走', narrative: '<state>\nhp += 5\n</state> 正文…' });
    setResumeFlag('drpg-pending-revar', payload);
    const got = getResumeFlag('drpg-pending-revar');
    expect(got).toBe(payload);
    expect(JSON.parse(got!).input).toBe('向前走');
  });

  it('TTL：超过有效期（>60s）视为无 → 防陈旧标志导致下次打开 App 误自动续玩', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    setResumeFlag(KEY);
    expect(getResumeFlag(KEY)).toBe('1');           // 刚写：有效
    vi.setSystemTime(new Date(1_000_000 + 61_000)); // 61s 后
    expect(getResumeFlag(KEY)).toBeNull();          // 过期：无效
    expect(localStorage.getItem(KEY)).toBeNull();   // 且顺手清掉（含体积较大的 revar 载荷）
  });

  it('兼容历史遗留在 sessionStorage 的裸值（旧版本写的标志）', () => {
    sessionStorage.setItem(KEY, '1');   // localStorage 为空，仅 sessionStorage 有旧值
    expect(getResumeFlag(KEY)).toBe('1');
  });
});
