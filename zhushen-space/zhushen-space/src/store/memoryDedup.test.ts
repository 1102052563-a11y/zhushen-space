import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacters } from './characterStore';

/* appendMemory 去重 + removeMemoryEntry 手动删除
   —— 治「同一条 addMemory 被 AI 连发多次、一件事堆成 N 条重复记忆」，并给记忆列表可手动删除 */

beforeEach(() => {
  useCharacters.setState({ characters: {} });
});

describe('appendMemory 去重（时间+地点+内容全同不重复追加）', () => {
  it('★同一条记忆连发 5 次 → 只保留 1 条（修复重复更新五次）', () => {
    const { appendMemory } = useCharacters.getState();
    const entry = { time: '第3日', location: '主神空间', content: '与林然初次交手，互相试探' };
    for (let i = 0; i < 5; i++) appendMemory('C1', entry);
    expect(useCharacters.getState().characters['C1'].memory!.shortTerm.length).toBe(1);
  });

  it('内容仅首尾空白 / 内部空白数量差异 → 归一后判为重复，不追加', () => {
    const { appendMemory } = useCharacters.getState();
    appendMemory('C1', { time: '第3日', location: '主神空间', content: '与林然 初次交手' });     // 基准（单空格）
    appendMemory('C1', { time: '第3日', location: '主神空间', content: '  与林然 初次交手  ' }); // 首尾空白 → trim 后同
    appendMemory('C1', { time: '第3日', location: '主神空间', content: '与林然  初次交手' });     // 内部双空格 → collapse 后同
    expect(useCharacters.getState().characters['C1'].memory!.shortTerm.length).toBe(1);
  });

  it('时间不同 → 是不同记忆，正常都保留（不误伤真实重复事件）', () => {
    const { appendMemory } = useCharacters.getState();
    appendMemory('C1', { time: '第3日', location: '演武场', content: '练剑' });
    appendMemory('C1', { time: '第5日', location: '演武场', content: '练剑' });
    expect(useCharacters.getState().characters['C1'].memory!.shortTerm.length).toBe(2);
  });

  it('已沉淀进 longTerm 的记忆 → shortTerm 不再重复追加', () => {
    useCharacters.setState({
      characters: {
        C1: { skills: [], talents: [], titles: [], subProfessions: [],
          memory: { shortTerm: [], longTerm: [{ time: '第1日', location: '甬道', content: '被卷入轮回乐园' }] } } as any,
      },
    });
    useCharacters.getState().appendMemory('C1', { time: '第1日', location: '甬道', content: '被卷入轮回乐园' });
    expect(useCharacters.getState().characters['C1'].memory!.shortTerm.length).toBe(0);
  });
});

describe('removeMemoryEntry 手动删除', () => {
  it('删短期第 1 条 → 只剩其余，且删对了那条', () => {
    const { appendMemory } = useCharacters.getState();
    appendMemory('C1', { time: '一', location: 'A', content: '甲' });
    appendMemory('C1', { time: '二', location: 'B', content: '乙' });
    appendMemory('C1', { time: '三', location: 'C', content: '丙' });
    useCharacters.getState().removeMemoryEntry('C1', 'short', 1);   // 删「乙」
    const short = useCharacters.getState().characters['C1'].memory!.shortTerm;
    expect(short.map((m) => m.content)).toEqual(['甲', '丙']);
  });

  it('删长期条目 → 只动 longTerm，不影响 shortTerm', () => {
    useCharacters.setState({
      characters: {
        C1: { skills: [], talents: [], titles: [], subProfessions: [],
          memory: { shortTerm: [{ time: 't', location: 'l', content: '短' }], longTerm: [{ time: 't', location: 'l', content: '长1' }, { time: 't', location: 'l', content: '长2' }] } } as any,
      },
    });
    useCharacters.getState().removeMemoryEntry('C1', 'long', 0);
    const mem = useCharacters.getState().characters['C1'].memory!;
    expect(mem.longTerm.map((m) => m.content)).toEqual(['长2']);
    expect(mem.shortTerm.length).toBe(1);   // 短期不受影响
  });

  it('越界索引 / 无记忆角色 → 安全 no-op，不报错', () => {
    const { appendMemory, removeMemoryEntry } = useCharacters.getState();
    appendMemory('C1', { time: 't', location: 'l', content: '唯一' });
    removeMemoryEntry('C1', 'short', 9);      // 越界
    removeMemoryEntry('C2', 'short', 0);      // 角色不存在
    expect(useCharacters.getState().characters['C1'].memory!.shortTerm.length).toBe(1);
  });
});
