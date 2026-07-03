import { describe, it, expect } from 'vitest';
import {
  parseDbAdvancePreset, resolveDbPlaceholders, buildModuleMessages,
  extractTag, extractTags, stripExcluded, resolveFinalDirective, findModule,
} from './dbAdvancePreset';

const SAMPLE = [{
  name: 'Test_Preset',
  contextExcludeRules: [{ start: '<disclaimer', end: '</disclaimer>' }, { start: '<thinking', end: '</thinking>' }],
  finalSystemDirective: '$8\n\n以下stage：\n{{stage}}\n以下scene：\n{{scene}}\n以下recall：\n{{recall}}',
  plotTasks: [
    { id: 'p1', name: '推进', order: 1, extractTags: 'stage,scene', extractInjectTags: 'tabletop', minLength: 300,
      promptGroup: [{ role: 'SYSTEM', content: '主角:$U 卡片:$C 背景:$1 概览:$5 前文:$7 上轮表:{{tabletop}}' }, { role: 'USER', content: '输入:$8' }] },
    { id: 'p0', name: '召回', order: 0, extractTags: 'recall', extractInjectTags: '', minLength: 10,
      promptGroup: [{ role: 'SYSTEM', content: '找记忆:$5 前文:$7' }] },
  ],
}];

describe('parseDbAdvancePreset', () => {
  it('数组[对象] → 结构化·plotTasks 按 order 升序（召回0 先于 推进1）', () => {
    const p = parseDbAdvancePreset(SAMPLE)!;
    expect(p).not.toBeNull();
    expect(p.name).toBe('Test_Preset');
    expect(p.plotTasks.map((t) => t.name)).toEqual(['召回', '推进']);
    expect(p.plotTasks[1].extractTags).toBe('stage,scene');
    expect(p.plotTasks[1].extractInjectTags).toBe('tabletop');
    expect(p.contextExcludeRules.length).toBe(2);
  });
  it('直接对象也可 / 无 plotTasks → null', () => {
    expect(parseDbAdvancePreset(SAMPLE[0])!.name).toBe('Test_Preset');
    expect(parseDbAdvancePreset({ name: 'x' })).toBeNull();
    expect(parseDbAdvancePreset(null)).toBeNull();
  });
});

describe('resolveDbPlaceholders', () => {
  it('$ 占位 + {{宏}} 全替换·缺省空串', () => {
    const s = resolveDbPlaceholders('$U|$C|$1|$5|$7|$8|{{tabletop}}|{{stage}}', {
      U: '苏晓', C: '卡片', bg: '背景', overview: '概览', prev: '前文', input: '输入', tabletop: '上轮表',
    });
    expect(s).toBe('苏晓|卡片|背景|概览|前文|输入|上轮表|');   // {{stage}} 未给→空
  });
});

describe('buildModuleMessages', () => {
  it('推进模块 → 消息数组·role 归一·占位替换', () => {
    const p = parseDbAdvancePreset(SAMPLE)!;
    const msgs = buildModuleMessages(findModule(p, '推进')!, { U: '苏晓', C: 'C', bg: 'B', overview: 'O', prev: 'P', tabletop: 'T' });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('主角:苏晓');
    expect(msgs[0].content).toContain('上轮表:T');
    expect(msgs[1].role).toBe('user');
  });
});

describe('extractTag / extractTags', () => {
  it('取标签内容·取最后一个·容忍属性', () => {
    expect(extractTag('前<stage>A</stage>中<stage x="1">B</stage>后', 'stage')).toBe('B');
    expect(extractTag('没有', 'stage')).toBe('');
    const r = extractTags('<stage>S</stage><scene>C</scene>', 'stage,scene');
    expect(r.stage).toBe('S'); expect(r.scene).toBe('C');
  });
});

describe('stripExcluded', () => {
  it('剥 <disclaimer>…</disclaimer> / <thinking>…', () => {
    const p = parseDbAdvancePreset(SAMPLE)!;
    const out = stripExcluded('正文<disclaimer>免责</disclaimer>继续<thinking>想</thinking>结束', p.contextExcludeRules);
    expect(out).toBe('正文继续结束');
  });
});

describe('resolveFinalDirective', () => {
  it('注入模板填 $8/stage/scene/recall', () => {
    const p = parseDbAdvancePreset(SAMPLE)!;
    const d = resolveFinalDirective(p, { input: '我出拳', stage: 'STAGE', scene: 'SCENE', recall: 'RECALL' });
    expect(d).toContain('我出拳');
    expect(d).toContain('STAGE'); expect(d).toContain('SCENE'); expect(d).toContain('RECALL');
  });
});
