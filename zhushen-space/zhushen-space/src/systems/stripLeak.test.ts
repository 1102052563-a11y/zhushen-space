import { describe, it, expect } from 'vitest';
import { stripLeakedThinking } from './stateApply';

describe('stripLeakedThinking · 裸奔规划兜底', () => {
  it('剥掉开头裸奔的「动笔前思考」草稿（含多个规划标记 + 落笔收口）', () => {
    const leak =
      '本回合是进入釜山行世界的开场。切入点：首尔站KTX101即将发车，患病少女冲上车门。\n' +
      '时间设定釜山行世界自有时钟，早晨发车。本回合无击杀、无任务完成，世界之源+0%。要输出：时间结算块。\n' +
      '节拍：①传送落地 ②任务降临 ③观察车厢 ④患病少女冲上车 ⑤林源试探 ⑥首个异常征兆 ⑦钩子：第一声惨叫。\n' +
      '防OOC：石宇——疲惫、心不在焉。秀安——早熟、安静。\n' +
      '字数目标2500-3500。落笔。\n\n' +
      '林源踏上站台的那一刻，凉透的晨风灌进领口。';
    expect(stripLeakedThinking(leak)).toBe('林源踏上站台的那一刻，凉透的晨风灌进领口。');
  });

  it('普通正文（无规划标记）原样保留——哪怕出现"落笔"二字', () => {
    const normal = '他提笔蘸墨，缓缓落笔，写下两个字。窗外雨声渐密。';
    expect(stripLeakedThinking(normal)).toBe(normal);
  });

  it('带 <think> 标签的思维块照常剥掉', () => {
    expect(stripLeakedThinking('<think>我先想想</think>正文开始了。')).toBe('正文开始了。');
  });

  it('只有一个规划标记 + 落笔 → 不剥（防误伤）', () => {
    const t = '本回合是个安静的开场，他独自落笔。接着抬头望向窗外。';
    expect(stripLeakedThinking(t)).toBe(t);
  });

  // ── 强制思维链预填充（forceNarrativeThinking）：末尾预填 <think>，端点续写 ──
  it('强制 <think> 预填充·端点不回显开标签：思考续写+孤立 </think> 整段剥掉', () => {
    // 开标签 <think> 在 prefill 里，content 里只回「思考续写…</think>正文」
    const r = '确认语言为简体中文，视角第三人称限知，过一遍在场角色……反八股自检完毕。</think>\n林源睁开眼，头顶是陌生的天花板。';
    expect(stripLeakedThinking(r)).toBe('林源睁开眼，头顶是陌生的天花板。');
  });

  it('跳过思维链预填充·回显的开头孤立 </think> 照剥（不回归）', () => {
    expect(stripLeakedThinking('</think>\n正文照常开始。')).toBe('正文照常开始。');
  });

  it('普通正文绝无裸 </think> → 不受新兜底影响', () => {
    const normal = '他抬头望向漫天星斗，久久没有说话。风穿过山谷。';
    expect(stripLeakedThinking(normal)).toBe(normal);
  });
});
