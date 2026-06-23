import { describe, it, expect } from 'vitest';
import { toSTPreset } from './stPresetExport';

const fakePreset: any = {
  id: 'x', name: '测试预设',
  entries: [
    { identifier: 'core', name: '人格', role: 'system', content: '你是叙述者', enabled: true, system_prompt: true, marker: false, injection_position: 0, injection_depth: 4 },
    { identifier: 'jb', name: '破限', role: 'system', content: '破限内容', enabled: true, system_prompt: true, marker: false, injection_position: 1, injection_depth: 0 },
    { identifier: 'ex1', name: '示例', role: 'user', content: '示例输入', enabled: true, system_prompt: false, marker: false, injection_position: 0 },
  ],
  regexScripts: [], temperature: 0.9, top_p: 0.95, stream: true,
};

describe('toSTPreset · 导出为 SillyTavern 格式', () => {
  const st: any = toSTPreset(fakePreset);
  it('产出 ST 的 prompts 数组、且不含 zhushen 的 entries 字段', () => {
    expect(Array.isArray(st.prompts)).toBe(true);
    expect(st.entries).toBeUndefined();
  });
  it('补齐了 chatHistory / worldInfoBefore / charDescription 等标准 marker', () => {
    const ids = st.prompts.map((p: any) => p.identifier);
    expect(ids).toContain('chatHistory');
    expect(ids).toContain('worldInfoBefore');
    expect(ids).toContain('charDescription');
    expect(st.prompts.find((p: any) => p.identifier === 'chatHistory').marker).toBe(true);
  });
  it('保留自定义块内容与注入位置', () => {
    const jb = st.prompts.find((p: any) => p.identifier === 'jb');
    expect(jb.content).toBe('破限内容');
    expect(jb.injection_position).toBe(1);
    expect(jb.injection_depth).toBe(0);
  });
  it('prompt_order 结构正确（character_id+order）且覆盖全部 prompt', () => {
    const po = st.prompt_order;
    expect(po[0].character_id).toBe(100001);
    const orderIds = po[0].order.map((o: any) => o.identifier);
    expect(orderIds).toContain('core');
    expect(orderIds).toContain('chatHistory');
    for (const p of st.prompts) expect(orderIds).toContain(p.identifier);
  });
  it('生成参数映射到 ST 字段', () => {
    expect(st.temperature).toBe(0.9);
    expect(st.top_p).toBe(0.95);
    expect(st.stream_openai).toBe(true);
  });
});
