import { describe, it, expect } from 'vitest';
import { namesMentionedIn, serializePlayerCard } from './structuredRecall';
import type { PlayerProfile } from '../store/playerStore';
import type { Talent } from '../store/characterStore';

/* 护栏：情境（用户输入+最近正文）里字面喊到的条目名 → 强制注入。
   治"都喊技能名字了还不注入进去"。仅测纯匹配逻辑（namesMentionedIn）。 */

const named = (...names: string[]) => names.map((name) => ({ name }));
const pick = (arr: { name: string }[]) => arr.map((x) => x.name);

describe('namesMentionedIn（字面喊到→强制命中）', () => {
  const skills = named(
    '神威·空洞褫夺（天启魔改版）',
    '十尾原核·森罗万象',
    '巨人之盾·不破之壁',
    '极值奖励·源血熔炉',
  );

  it('喊整名 → 命中', () => {
    expect(pick(namesMentionedIn(skills, '我催动神威·空洞褫夺（天启魔改版）！')))
      .toEqual(['神威·空洞褫夺（天启魔改版）']);
  });

  it('只喊核心段（·之后）也命中——玩家常只喊核心', () => {
    expect(pick(namesMentionedIn(skills, '苏晓低喝一声，空洞褫夺撕裂了空间。')))
      .toEqual(['神威·空洞褫夺（天启魔改版）']);
    expect(pick(namesMentionedIn(skills, '森罗万象铺展开来')))
      .toEqual(['十尾原核·森罗万象']);
  });

  it('归一化容差：去掉间隔点/空格/「」引号仍命中', () => {
    expect(pick(namesMentionedIn(skills, '他展开「不破之壁」'))).toEqual(['巨人之盾·不破之壁']);
    expect(pick(namesMentionedIn(skills, '巨人 之 盾 撑起'))).toEqual(['巨人之盾·不破之壁']);
  });

  it('多个技能同时被喊 → 全部命中（不受数量上限约束，上限在调用处之外）', () => {
    const out = pick(namesMentionedIn(skills, '空洞褫夺配合森罗万象齐发'));
    expect(out).toContain('神威·空洞褫夺（天启魔改版）');
    expect(out).toContain('十尾原核·森罗万象');
    expect(out).toHaveLength(2);
  });

  it('没喊到 → 不命中（无误注入）', () => {
    expect(namesMentionedIn(skills, '他只是普通地挥了一拳')).toEqual([]);
  });

  it('短通用前缀（<3字的段）单独出现不误命中', () => {
    // "神威"=2字段、"巨人"被"之盾"拆出后……核心段≥3字才参与，避免泛词污染
    expect(namesMentionedIn(named('神威·空洞褫夺'), '神威凛凛的气势')).toEqual([]);
  });

  it('空/undefined 情境 → []', () => {
    expect(namesMentionedIn(skills, '')).toEqual([]);
    expect(namesMentionedIn(skills, undefined)).toEqual([]);
  });

  it('对装备同样适用（同一护栏）', () => {
    const items = named('湮灭·灭世之刃', '寻常布衣');
    expect(pick(namesMentionedIn(items, '他抽出灭世之刃'))).toEqual(['湮灭·灭世之刃']);
  });

  it('对 NPC（含 isDead 等额外字段）同样适用——2字专名也命中', () => {
    const npcs = [
      { name: '苏晓', isDead: false, id: 'C1' },
      { name: '薇妮', isDead: false, id: 'C2' },
      { name: '病犬', isDead: false, id: 'C3' },
    ];
    const out = namesMentionedIn(npcs, '薇妮远远看见苏晓走来').map((r) => r.id);
    expect(out).toContain('C1');
    expect(out).toContain('C2');
    expect(out).not.toContain('C3');
  });
});

/* serializePlayerCard：叙事回忆注入的主角基本信息——HP/EP 满状态须含天赋/装备六维加成，
   且新增「真实属性（含加成）」行。治"正文识别不到加成后的血量/蓝量、恢复不到面板满状态"。 */
describe('serializePlayerCard（HP/EP 满状态含加成 + 真实属性注入）', () => {
  const profile = { name: '云舒', attrs: { str: 50, agi: 50, con: 50, int: 50, cha: 50, luck: 50 } } as unknown as PlayerProfile;
  // 天赋给「体质+30」→ 实战体质 50+30=80 → 满血上限 80×20=1600（基础体质 50 只有 1000）
  const talents = [{ name: '造物主权', attrBonus: '体质+30，智力+20' }] as unknown as Talent[];
  const limits = { maxNpcs: 0, maxSkills: 3, maxItems: 2 };
  // game 里塞旧的 200/200（模拟天赋后没同步上限），卡片不该被它压低
  const card = serializePlayerCard(profile, { hp: 200, maxHp: 200, mp: 100, maxMp: 100 }, [], talents, [], limits);

  it('HP 满状态上限折入天赋体质加成（体80×20=1600），不被旧的 200 压成上限', () => {
    expect(card).toContain('/1600');
    expect(card).toContain('满状态上限=1600');
    expect(card).not.toContain('HP:200/200');
  });

  it('注入「真实属性口径」说明行（四阶起六维即真实属性，勿÷80）', () => {
    expect(card).toMatch(/真实属性口径/);
    expect(card).toContain('四阶起');
  });

  it('六维实战值标注基础值（体: 80(基50)）', () => {
    expect(card).toContain('体80(基50)');
  });
});
