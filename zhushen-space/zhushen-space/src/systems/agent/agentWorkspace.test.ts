import { describe, it, expect } from 'vitest';
import { AgentWorkspace, normalizePath, textHash } from './agentWorkspace';

describe('agentWorkspace · 路径与哈希', () => {
  it('normalizePath 拒绝越界/绝对/非根路径', () => {
    expect(normalizePath('output/main.md')).toBe('output/main.md');
    expect(normalizePath('scratch/a/b.txt')).toBe('scratch/a/b.txt');
    expect(normalizePath('../etc/passwd')).toBeNull();
    expect(normalizePath('output/../secret')).toBeNull();
    expect(normalizePath('/output/main.md')).toBeNull();
    expect(normalizePath('C:/x')).toBeNull();
    expect(normalizePath('input/prompt.json')).toBeNull();   // 非可写根
    expect(normalizePath('output/')).toBeNull();
  });
  it('textHash 稳定且区分内容', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});

describe('agentWorkspace · read-before-edit 粘性规则', () => {
  it('新建可直接写；replace 已存在文件须先读', () => {
    const ws = new AgentWorkspace();
    expect(ws.writeFile({ path: 'output/main.md', content: 'v1' }).ok).toBe(true);
    const ws2 = new AgentWorkspace();
    ws2.files.set('output/main.md', 'old');
    const r = ws2.writeFile({ path: 'output/main.md', content: 'v2' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('workspace.write_requires_read');
    ws2.readFile({ path: 'output/main.md' });
    expect(ws2.writeFile({ path: 'output/main.md', content: 'v2' }).ok).toBe(true);
  });
  it('append 免读', () => {
    const ws = new AgentWorkspace();
    ws.files.set('scratch/n.md', 'a');
    const r = ws.writeFile({ path: 'scratch/n.md', content: 'b', mode: 'append' });
    expect(r.ok).toBe(true);
    expect(ws.files.get('scratch/n.md')).toBe('ab');
  });
  it('patch 未读→patch_requires_read；读后可 patch；非唯一→not_unique；replace_all 生效', () => {
    const ws = new AgentWorkspace();
    ws.files.set('output/main.md', 'x xx x');
    let r = ws.applyPatch({ path: 'output/main.md', old_string: 'x', new_string: 'y' });
    expect(r.errorCode).toBe('workspace.patch_requires_read');
    ws.readFile({ path: 'output/main.md' });
    r = ws.applyPatch({ path: 'output/main.md', old_string: 'x', new_string: 'y' });
    expect(r.errorCode).toBe('workspace.patch_old_string_not_unique');
    r = ws.applyPatch({ path: 'output/main.md', old_string: 'x', new_string: 'y', replace_all: true });
    expect(r.ok).toBe(true);
    expect(ws.files.get('output/main.md')).toBe('y yy y');
  });
  it('部分读下 old_string 不在已读片段 → 置粘性整读标志，此后必须整读', () => {
    const ws = new AgentWorkspace();
    ws.files.set('output/main.md', ['L1 alpha', 'L2 beta', 'L3 gamma'].join('\n'));
    ws.readFile({ path: 'output/main.md', start_line: 1, line_count: 1 });   // 只读 L1
    let r = ws.applyPatch({ path: 'output/main.md', old_string: 'gamma', new_string: 'delta' });
    expect(r.errorCode).toBe('workspace.patch_requires_full_read');
    // 粘性：即便这次 old_string 在已读片段里也被拦
    r = ws.applyPatch({ path: 'output/main.md', old_string: 'alpha', new_string: 'A' });
    expect(r.errorCode).toBe('workspace.patch_requires_full_read');
    ws.readFile({ path: 'output/main.md' });   // 整读后清除
    r = ws.applyPatch({ path: 'output/main.md', old_string: 'alpha', new_string: 'A' });
    expect(r.ok).toBe(true);
  });
  it('sha 陈旧检测：读后文件被改（模拟外部变化）→ stale', () => {
    const ws = new AgentWorkspace();
    ws.files.set('output/main.md', 'v1');
    ws.readFile({ path: 'output/main.md' });
    ws.files.set('output/main.md', 'v2-外部改动');
    const r = ws.applyPatch({ path: 'output/main.md', old_string: 'v1', new_string: 'v3' });
    expect(r.errorCode).toBe('workspace.patch_stale_file');
  });
  it('行/字符读模式互斥；空 old_string / 无变化 各有错误码', () => {
    const ws = new AgentWorkspace();
    ws.files.set('plan/p.md', 'hello');
    expect(ws.readFile({ path: 'plan/p.md', start_line: 1, start_char: 0 }).errorCode).toBe('workspace.mixed_read_range');
    ws.readFile({ path: 'plan/p.md' });
    expect(ws.applyPatch({ path: 'plan/p.md', old_string: '', new_string: 'x' }).errorCode).toBe('workspace.patch_empty_old_string');
    expect(ws.applyPatch({ path: 'plan/p.md', old_string: 'h', new_string: 'h' }).errorCode).toBe('workspace.patch_no_change');
  });
  it('读返回带行号正文 + 元数据首行；写只回摘要', () => {
    const ws = new AgentWorkspace();
    ws.writeFile({ path: 'output/main.md', content: 'A\nB' });
    const r = ws.readFile({ path: 'output/main.md' });
    expect(r.content).toMatch(/^output\/main\.md lines 1-2 of 2/);
    expect(r.content).toContain('1: A');
    const w = ws.writeFile({ path: 'scratch/s.md', content: '正文内容不回显' });
    expect(w.content).not.toContain('正文内容不回显');
    expect(w.content).toMatch(/Wrote \d+ chars/);
  });
});
