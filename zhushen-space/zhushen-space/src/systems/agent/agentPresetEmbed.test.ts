/* Agent 内置预设·真实文件解析验收：
   对 public/presets/agent-huyu.json（[Agent] V14.7 狐神抚 · 毓忻，2.5MB·214 prompts·TauriTavern agent 槽位）
   与 agent-fairy.json（Fairy_Tale 2.3.0，双 prompt_order）跑**真实导入链**（importTextPreset→parseSTPreset），
   断言忠实 ST 语义：取 character_id=100001 的 order、按 order 序拼装、启用以 order 为准、库存条目保留但禁用。
   （旧解析器的两处缺口：取 prompt_order[0] 选错份；不在 order 的库存条目被误启用——此测试即回归守卫。） */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { useSettings } from '../../store/settingsStore';
import { compileFindRegex, runRegexReplace } from '../regexEngine';
import { HUYU_CURE_SCRIPTS } from './agentPresetCure';
import { unzipTextFiles } from './miniZip';
import { importEmbeddedAgentAssets } from './agentAssets';
import { useAgentSkills } from '../../store/agentSkillStore';

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

function importAndGet(raw: string, name: string, stFaithful = false) {
  const r = useSettings.getState().importTextPreset(raw, name, true, false, stFaithful);
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
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻', true);
    expect(p.id).toBe('builtin:[Agent] V14.7 狐神抚 · 毓忻');
    expect(p.entries.length).toBe(214);
    const exp = expectedEnabled(rawHuyu);
    const gotEnabled = p.entries.filter((e) => e.enabled).map((e) => e.identifier);
    expect(new Set(gotEnabled)).toEqual(new Set(exp.ids));
    expect(p.entries.filter((e) => e.enabled && !e.marker).length).toBe(58);
    expect(p.entries.filter((e) => e.enabled && e.marker).length).toBe(11);
  });
  it('顺序忠实 order 序；库存巨型配置条目（SPresetSettings 等）保留但禁用', () => {
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻', true);
    const exp = expectedEnabled(rawHuyu);
    for (let i = 0; i < 50; i++) expect(p.entries[i].identifier).toBe(exp.orderIds[i]);
    const sps = p.entries.find((e) => e.identifier === 'SPresetSettings')!;
    expect(sps).toBeTruthy();
    expect(sps.enabled).toBe(false);
    expect(sps.content.length).toBeGreaterThan(100000);   // 197KB 配置块完整保留（不进注入）
  });
  it('TauriTavern 专用 agent 槽位以 marker 保留（本作不消费、组装时被 !marker 过滤，不会泄漏进提示词）', () => {
    const p = importAndGet(rawHuyu, '[Agent] V14.7 狐神抚 · 毓忻', true);
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
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0', true);
    const exp = expectedEnabled(rawFairy);
    const gotEnabled = p.entries.filter((e) => e.enabled).map((e) => e.identifier);
    expect(new Set(gotEnabled)).toEqual(new Set(exp.ids));
    expect(p.entries[0].identifier).toBe(exp.orderIds[0]);
  });
  it('不在 order 的库存变体（NSFW/剧本格式）保留但禁用（旧版会误启用）', () => {
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0', true);
    const nsfw = p.entries.find((e) => e.name === 'NSFW')!;
    expect(nsfw).toBeTruthy();
    expect(nsfw.enabled).toBe(false);
    const juben = p.entries.find((e) => e.name === '输出格式: 剧本')!;
    expect(juben.enabled).toBe(false);
  });
  it('采样参数从预设根字段提取（temperature / openai_max_tokens→max_tokens）', () => {
    const j = JSON.parse(rawFairy);
    const p = importAndGet(rawFairy, 'Fairy_Tale 2.3.0', true);
    if (typeof j.temperature === 'number') expect(p.temperature).toBe(j.temperature);
    if (typeof j.openai_max_tokens === 'number') expect(p.max_tokens).toBe(j.openai_max_tokens);
  });
});

describe('parseSTPreset · 默认=旧生态语义（⚠ 回归守卫：2026-08-02 玩家实测——默认忠实化会崩社区预设的正文格式，勿再改默认）', () => {
  it('默认：库序拼装 + order 只管启用状态（不重排）', () => {
    const raw = JSON.stringify({ name: 'flat', prompts: [{ identifier: 'a', content: 'A' }, { identifier: 'b', content: 'B' }], prompt_order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] });
    const p = importAndGet(raw, 'flat');
    expect(p.entries.map((e) => e.identifier)).toEqual(['a', 'b']);   // 库序，不按 order 重排
    expect(p.entries.find((e) => e.identifier === 'a')!.enabled).toBe(false);
    expect(p.entries.find((e) => e.identifier === 'b')!.enabled).toBe(true);
  });
  it('默认：不在 order 里的库存条目**保持缺省启用**（社区预设按此行为调教，绝不默认禁用）', () => {
    const raw = JSON.stringify({
      name: 'eco',
      prompts: [{ identifier: 'a', content: 'A' }, { identifier: 'extra', content: '库存条目' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }] }],
    });
    const p = importAndGet(raw, 'eco');
    expect(p.entries.find((e) => e.identifier === 'extra')!.enabled).toBe(true);
  });
  it('默认：多份 order 仍优先 100001（纯选份修复，不带其它语义变化）', () => {
    const raw = JSON.stringify({
      name: 'dual',
      prompts: [{ identifier: 'a', content: 'A' }, { identifier: 'b', content: 'B' }],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: 'a', enabled: false }, { identifier: 'b', enabled: false }] },
        { character_id: 100001, order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }] },
      ],
    });
    const p = importAndGet(raw, 'dual');
    expect(p.entries.find((e) => e.identifier === 'a')!.enabled).toBe(true);   // 用的是 100001 那份
    expect(p.entries.find((e) => e.identifier === 'b')!.enabled).toBe(false);
  });
  it('忠实模式（仅显式开启·两枚 Agent 内置用）：order 序 + 库存条目禁用', () => {
    const raw = JSON.stringify({
      name: 'faith',
      prompts: [{ identifier: 'extra', content: '库存' }, { identifier: 'a', content: 'A' }, { identifier: 'b', content: 'B' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'b', enabled: true }, { identifier: 'a', enabled: false }] }],
    });
    const p = importAndGet(raw, 'faith', true);
    expect(p.entries.map((e) => e.identifier)).toEqual(['b', 'a', 'extra']);   // order 序 + 库存垫尾
    expect(p.entries.find((e) => e.identifier === 'extra')!.enabled).toBe(false);
    expect(p.entries.find((e) => e.identifier === 'b')!.enabled).toBe(true);
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

describe('P3 · TT 内嵌 Agent 资产（真实文件：zip skill 包 + 子代理档案 + 作者指令）', () => {
  const HUYU = '[Agent] V14.7 狐神抚 · 毓忻';
  beforeEach(() => useAgentSkills.setState({ skills: [], subagents: [], writerNotes: {} }));

  it('miniZip：真实 ttskill 包解出含 SKILL.md 的文本文件', async () => {
    const j = JSON.parse(rawHuyu);
    const item = j.extensions.tauritavern.skills.items.find((x: { skillName: string }) => x.skillName === 'fox-banword-rules');
    const files = await unzipTextFiles(item.contentBase64);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const md = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path))!;
    expect(md).toBeTruthy();
    expect(md.content).toMatch(/name:\s*fox-banword-rules/);
  });
  it('importEmbeddedAgentAssets：4 个 skill + 2 个子代理 + 作者指令，全部落库且作用域挂到导入预设名', async () => {
    // ⚠ 断言看 store 终态而非 report 计数：前面 describe 经 importTextPreset 钩子触发的 fire-and-forget
    //   资产导入可能在本测试 beforeEach 清空后才 resolve、重新填库 → 本次直接调用全被 sha 判重跳过（计数 0 但库正确）。
    const rep = await importEmbeddedAgentAssets(JSON.parse(rawHuyu), HUYU, true);
    expect(rep.errors).toEqual([]);
    const st = useAgentSkills.getState();
    const huyuSkills = st.skills.filter((s) => s.scopePresetName === HUYU);   // Fairy 的滞后导入可能混入其它作用域，只看本预设的
    expect(huyuSkills.map((s) => s.name).sort()).toEqual(['fox-banword-rules', 'fox-format-rules', 'fox-nsfw-rules', 'fox-persona-rules']);
    expect(huyuSkills.every((s) => s.files.some((f) => /SKILL\.md$/i.test(f.path)))).toBe(true);
    const banword = st.subagents.find((d) => d.id === 'fox-banword-checker')!;
    expect(banword).toBeTruthy();
    expect(banword.instructions!.length).toBeGreaterThan(1000);
    expect(banword.maxRounds).toBeLessThanOrEqual(12);   // TT 的 999 被夹取
    expect(banword.skillsVisible).toEqual(['fox-banword-rules']);
    expect(st.writerNotes[HUYU].length).toBeGreaterThan(4000);   // fox-writer 的工作流指令
  });
  it('幂等：重复导入按 sha 跳过', async () => {
    await importEmbeddedAgentAssets(JSON.parse(rawHuyu), HUYU, true);
    const rep2 = await importEmbeddedAgentAssets(JSON.parse(rawHuyu), HUYU, true);
    expect(rep2.skills).toBe(0);
    expect(useAgentSkills.getState().skills.filter((s) => s.scopePresetName === HUYU).length).toBe(4);
  });
});

describe('V14.7 cure 适配正则 · 真实引擎行为（compileFindRegex + runRegexReplace）', () => {
  const apply = (id: string, text: string) => {
    const s = HUYU_CURE_SCRIPTS.find((x) => x.id === id)!;
    expect(s).toBeTruthy();
    const c = compileFindRegex(s.findRegex, s.flags);
    expect(c).toBeTruthy();
    return runRegexReplace(text, c!.re, s);
  };
  it('剥 <think_fox~> 思维链（含多行）', () => {
    expect(apply('huyu-thinkfox', '<think_fox~>\n【开始思考】\n表格…\n</think_fox~>\n正文开始')).toBe('正文开始');
  });
  it('拆 <content> 壳保留内文', () => {
    expect(apply('huyu-content', '<content>\n夜色渐深。\n</content>')).toBe('夜色渐深。\n');
  });
  it('拆 fox_selc/fox_tip 标签保留内文', () => {
    expect(apply('huyu-foxwrap', '<fox_selc>\nA. 选项一\n</fox_selc>\n<fox_tip>\n唔～\n</fox_tip>')).toBe('A. 选项一\n唔～\n');
  });
  it('收敛 3+ 连续空行 → 1 个空行', () => {
    expect(apply('huyu-blank', '上段\n\n\n\n\n下段')).toBe('上段\n\n下段');
  });
  it('收敛 3+ 连排 <br>（大小写/自闭合/夹空白都认）→ 两个', () => {
    expect(apply('huyu-brrun', '行1<br><br/> <BR >\n<br>行2')).toBe('行1<br><br>行2');
  });
});
