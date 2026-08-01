import { describe, it, expect } from 'vitest';
import { isLocalEndpoint } from './imageGen';

// 本地/内网地址必须绕过云端 CORS 代理（否则 Cloudflare 回 403 error 1003）——钉住判定，防回归。
describe('isLocalEndpoint（本地/内网直连豁免）', () => {
  it('本地回环与 localhost 域', () => {
    expect(isLocalEndpoint('http://localhost:8000/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1:8188')).toBe(true);
    expect(isLocalEndpoint('https://127.0.0.1/v1/chat/completions')).toBe(true);
    expect(isLocalEndpoint('http://[::1]:4981/openai')).toBe(true);
    expect(isLocalEndpoint('http://0.0.0.0:7860')).toBe(true);
    expect(isLocalEndpoint('http://my-nas.local:9000')).toBe(true);
  });
  it('私网段 10.x / 192.168.x / 172.16-31.x', () => {
    expect(isLocalEndpoint('http://10.0.0.5:3000')).toBe(true);
    expect(isLocalEndpoint('http://192.168.1.20:8080/v1')).toBe(true);
    expect(isLocalEndpoint('http://172.16.0.1')).toBe(true);
    expect(isLocalEndpoint('http://172.31.255.254:5000')).toBe(true);
  });
  it('公网地址不豁免（继续走代理）', () => {
    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(false);
    expect(isLocalEndpoint('http://172.32.0.1')).toBe(false);      // 172.32 不在私网段
    expect(isLocalEndpoint('http://11.0.0.1')).toBe(false);        // 11.x 不是 10.x
    expect(isLocalEndpoint('https://mylocalhost.com/v1')).toBe(false);  // 域名里含 localhost 字样≠本地
  });
  it('无协议裸地址按 http 解析', () => {
    expect(isLocalEndpoint('127.0.0.1:8000/v1')).toBe(true);
    expect(isLocalEndpoint('api.example.com/v1')).toBe(false);
  });
});
