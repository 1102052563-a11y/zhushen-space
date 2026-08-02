/* Agent 内置预设·真实文件解析验收：
   对 public/presets/agent-huyu.json（[Agent] V14.7 狐神抚 · 毓忻，2.5MB·214 prompts·TauriTavern agent 槽位）
   与 agent-fairy.json（Fairy_Tale 2.3.0，双 prompt_order）跑**真实导入链**（importTextPreset→parseSTPreset），
   断言忠实 ST 语义：取 character_id=100001 的 order、按 order 序拼装、启用以 order 为准、库存条目保留但禁用。
   （旧解析器的两处缺口：取 prompt_order[0] 选错份；不在 order 的库存条目被误启用——此测试即回归守卫。） */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { useSettings } from '../../store/settingsStore';

/* vitest 跑在 node 环境，但主 tsconfig 是浏览器环境（无 @types/node）：
   用「非字面量说明符」的动态 import 取 fs——tsc 不做模块解析（类型为 any），运行时正常解析 node:fs。 */
declare const process: { cwd(): string };
let rawHuyu = '';
let rawFairy = '';
beforeAll(async () => {
  const fs = await import('node:' + 'fs') as { readFileSync: (p: string, enc: string) => string };
  rawHuyu = fs.readFileSync(process.cwd() + '/public/presets/agent-huyu.json', 'utf8');
  rawFairy = fs.readFileSync(process.cwd() + '/public/presets/agent-fairy.json', 'utf8');
});

function importAndGet(raw: string, name: string) {
  const r = useSettings.getState().importTextPreset(raw, name, true, false);
  expect(r.ok).toBe(true);
  const p = useSettings.getState().textPresets.find((x) => x.name === name);
  expect(p).toBeTruthy();
  return p!;
}
/** 参照实现：从原始 JSON 独立算出「应启用的 identifier 集合」（100001 order 中 enabled 且在 prompts 库里存在） */
function expectedEnabled(raw: string): { ids: string[]; orderIds: string[] } {
  const j = JSON.parse(raw);
  const order = (j.prompt_order as Array<{ character_id: number; order: Array<{ identifier: string; enabled: boolean }> }>)
    .find((o) => o.character_id === 100001)!.order;
  const lib = new Set((j.prompts as Array<{ identifier: string }>).map((p) => p.identifier));
  return {
    ids: order.filter((o) => o.enabled !== false && lib.has(o.identifier)).map((o) => o.identifier),
    orderIds: order.filter((o) => lib.has(o.identifier)).map((o) => o.identifier),
  };
}

beforeEach(() => useSettings.setState({ textPresets: [], activeTextPresetId: null }));

describe('Agent 内置预设 · [Agent] V14.7 狐神抚 · 毓忻', () => {
  it('完整导入：214 条全保留，启用集与 ST order 完全一致（58 非 marker + 11 marker）', () => {
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻');
    expect(p.id).toBe('builtin:[Agent] V14.7 狐神抚 · 毓忻');
    expect(p.entries.length).toBe(214);
    const exp = expectedEnabled(rawHuyu);
    const gotEnabled = p.entries.filter((e) => e.enabled).map((e) => e.identifier);
    expect(new Set(gotEnabled)).toEqual(new Set(exp.ids));
    expect(p.entries.filter((e) => e.enabled && !e.marker).length).toBe(58);
    expect(p.entries.filter((e) => e.enabled && e.marker).length).toBe(11);
  });
  it('顺序忠实 order 序；库存巨型配置条目（SPresetSettings 等）保留但禁用', () => {
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻');
    const exp = expectedEnabled(rawHuyu);
    for (let i = 0; i < 50; i++) expect(p.entries[i].identifier).toBe(exp.orderIds[i]);
    const sps = p.entries.find((e) => e.identifier === 'SPresetSettings')!;
    expect(sps).toBeTruthy();
    expect(sps.enabled).toBe(false);
    expect(sps.content.length).toBeGreaterThan(100000);   // 197KB 配置块完整保留（不进注入）
  });
  it('TauriTavern 专用 agent 槽位以 marker 保留（本作不消费、组装时被 !marker 过滤，不会泄漏进提示词）', () => {
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻');
    for (const id of ['agentSystemPrompt', 'agentTask', 'agentResults']) {
      const e = p.entries.find((x) => x.identifier === id)!;
      expect(e).toBeTruthy();
      expect(e.marker).toBe(true);
      expect(e.content).toBe('');
    }
  });
});

describe('Agent 内置预设 · Fairy_Tale 2.3.0', () => {
  it('双 prompt_order：取 character_id=100001 那份（旧版取 [0] 会选错成 100000）', () => {
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0');
    const exp = expectedEnabled(rawFairy);
    const gotEnabled = p.entries.filter((e) => e.enabled).map((e) => e.identifier);
    expect(new Set(gotEnabled)).toEqual(new Set(exp.ids));
    expect(p.entries[0].identifier).toBe(exp.orderIds[0]);
  });
  it('不在 order 的库存变体（NSFW/剧本格式）保留但禁用（旧版会误启用）', () => {
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0');
    const nsfw = p.entries.find((e) => e.name === 'NSFW')!;
    expect(nsfw).toBeTruthy();
    expect(nsfw.enabled).toBe(false);
    const juben = p.entries.find((e) => e.name === '输出格式: 剧本')!;
    expect(juben.enabled).toBe(false);
  });
  it('采样参数从预设根字段提取（temperature / openai_max_tokens→max_tokens）', () => {
    const j = JSON.parse(rawFairy);
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0');
    if (typeof j.temperature === 'number') expect(p.temperature).toBe(j.temperature);
    if (typeof j.openai_max_tokens === 'number') expect(p.max_tokens).toBe(j.openai_max_tokens);
  });
});

describe('parseSTPreset · 形态回归（改动不破老格式）', () => {
  it('裸 order 数组形态照常', () => {
    const raw = JSON.stringify({ name: 'flat', prompts: [{ identifier: 'a', content: 'A' }, { identifier: 'b', content: 'B' }], prompt_order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] });
    const p = importAndGet(raw, 'flat');
    expect(p.entries.map((e) => e.identifier)).toEqual(['b', 'a']);   // order 序
    expect(p.entries.find((e) => e.identifier === 'b')!.enabled).toBe(true);
    expect(p.entries.find((e) => e.identifier === 'a')!.enabled).toBe(false);
  });
  it('无 prompt_order：维持库序 + 自带 enabled', () => {
    const raw = JSON.stringify({ name: 'noorder', prompts: [{ identifier: 'a', content: 'A', enabled: false }, { identifier: 'b', content: 'B' }] });
    const p = importAndGet(raw, 'noorder');
    expect(p.entries.map((e) => e.identifier)).toEqual(['a', 'b']);
    expect(p.entries[0].enabled).toBe(false);
    expect(p.entries[1].enabled).toBe(true);
  });
  it('本应用导出格式（顶层 entries）不受影响', () => {
    const raw = JSON.stringify({ name: 'own', entries: [{ identifier: 'x', content: 'X', enabled: true, role: 'system' }] });
    const p = importAndGet(raw, 'own');
    expect(p.entries.length).toBe(1);
    expect(p.entries[0].enabled).toBe(true);
  });
});
