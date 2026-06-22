import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithProxy } from './apiChat';

/* node 测试环境没有 location → sameOriginProxyAvailable() 为 false，fetchViaProxy 自然走「网关 worker」回退分支，
   正好覆盖「直连失败 → 服务端代理」这条主链与「按源记忆」逻辑。同源 /proxy 分支需浏览器环境，另在线上验。
   注意：directFailedOrigins 是模块级、跨用例保留 → 每个用例用**不同 host**，互不污染。*/
const GW_MARK = '/api/gw/proxy?url=';

describe('fetchWithProxy（直连失败自动走代理 + 按源记忆，仿 fanren）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('直连成功 → 不走代理，只请求一次原始地址', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok'));
    const url = 'https://direct-ok.test/v1/chat/completions';
    const r = await fetchWithProxy(url, { method: 'POST' });
    expect(await r.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(url);
  });

  it('直连因 CORS 抛错 → 自动回退到服务端代理（网关 ?url=）', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))   // 直连失败
      .mockResolvedValueOnce(new Response('via-gw'));            // 代理成功
    const url = 'https://cors-a.test/v1/chat/completions';
    const r = await fetchWithProxy(url, { method: 'POST' });
    expect(await r.text()).toBe('via-gw');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const gwUrl = String(fetchMock.mock.calls[1][0]);
    expect(gwUrl).toContain(GW_MARK);
    expect(gwUrl).toContain(encodeURIComponent(url));
  });

  it('同源失败过 → 下次直接走代理，不再尝试直连（按源记忆）', async () => {
    // 第一次：直连失败 → 网关
    fetchMock
      .mockRejectedValueOnce(new TypeError('cors'))
      .mockResolvedValueOnce(new Response('gw1'));
    await fetchWithProxy('https://cached.test/v1/chat/completions', {});
    // 第二次：同源不同路径，应直接走网关、不再先撞一次直连
    fetchMock.mockResolvedValueOnce(new Response('gw2'));
    const r2 = await fetchWithProxy('https://cached.test/v1/models', {});
    expect(await r2.text()).toBe('gw2');
    expect(fetchMock).toHaveBeenCalledTimes(3);                  // 失败1 + 网关1 + (第二次直接)网关1
    expect(String(fetchMock.mock.calls[2][0])).toContain(GW_MARK);   // 第二次确实跳过直连、直奔网关
  });

  it('用户中止(AbortError) → 原样抛出，不回退代理、不标记该源失败', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abortErr);
    await expect(fetchWithProxy('https://abort.test/v1/chat/completions', {})).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);                  // 没有走网关
    // 未被缓存为失败：下一次同源仍先尝试直连，且成功
    fetchMock.mockResolvedValueOnce(new Response('ok2'));
    const r = await fetchWithProxy('https://abort.test/v1/chat/completions', {});
    expect(await r.text()).toBe('ok2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('相对地址/非绝对 http(s) → 直发，不进代理逻辑', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rel'));
    await fetchWithProxy('/relative/models', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/relative/models');
  });
});
