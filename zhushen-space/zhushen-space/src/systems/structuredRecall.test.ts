import { describe, it, expect } from 'vitest';
import { namesMentionedIn, serializePlayerCard, serializeNpcCard, pickOffsceneRescue } from './structuredRecall';
import type { PlayerProfile } from '../store/playerStore';
import type { Talent, Skill } from '../store/characterStore';
import type { InventoryItem } from '../store/itemStore';
import type { NpcRecord } from '../store/npcStore';

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

/* 外观锚点：基底外观为空时，回退用即时外观当常驻锚点注入（治"只传即时外观、外貌每回合让 AI 猜/漂移"）。 */
describe('serializePlayerCard（外观锚点：基底外观为空回退即时外观）', () => {
  const base = { name: '云舒', attrs: { str: 50, agi: 50, con: 50, int: 50, cha: 50, luck: 50 } };
  const limits = { maxNpcs: 0, maxSkills: 0, maxItems: 0 };
  const mk = (p: object) => serializePlayerCard({ ...base, ...p } as unknown as PlayerProfile, { hp: 100, maxHp: 100, mp: 50, maxMp: 50 }, [], [], [], limits);

  it('基底外观为空、有即时外观 → 即时外观被当作「基底外观」常驻锚点注入', () => {
    const card = mk({ baseAppearance: '', appearance: '身高180·黑发金瞳·精瘦无肌肉' });
    expect(card).toContain('基底外观(常驻长相·开局设定·最高基准·绝不漂移):身高180·黑发金瞳·精瘦无肌肉');
  });
  it('基底外观为空时不重复输出「外观(即时状态…)」行（避免同段重复）', () => {
    const card = mk({ baseAppearance: '', appearance: '身高180·黑发金瞳' });
    expect(card).not.toContain('外观(即时状态');
  });
  it('基底外观已填、即时外观不同 → 两段都注入（基底 + 即时）', () => {
    const card = mk({ baseAppearance: '身高180·黑发金瞳·精瘦', appearance: '满身尘土、左臂缠绷带' });
    expect(card).toContain('基底外观(常驻长相·开局设定·最高基准·绝不漂移):身高180·黑发金瞳·精瘦');
    expect(card).toContain('外观(即时状态·动作/姿态/衣着/伤损·须与上方基底外观一致):满身尘土、左臂缠绷带');
  });
});

/* 精简物品栏（leanItems）：用户输入提到的物品 + 当前已装备 → 全量信息；其余整背包 → 仅名称。
   治"每件物品都全量太占 token"，同时保证相关/在用物品细节不丢。 */
describe('serializePlayerCard（精简物品栏：提到/已装备→全量，其余→仅名称）', () => {
  const profile = { name: '云舒', attrs: { str: 50, agi: 50, con: 50, int: 50, cha: 50, luck: 50 } } as unknown as PlayerProfile;
  const limits = { maxNpcs: 0, maxSkills: 3, maxItems: 2 };
  const items = [
    { name: '灭世之刃', category: '武器', gradeDesc: '史诗', equipped: true, equipSlot: '武器', effect: '攻击附带火焰', affix: '+10锋锐', appearance: '漆黑长刀泛血光', acquisition: '击败魔王所得', notes: '需吸血维持' },
    { name: '玄铁矿', category: '材料', quantity: 3, effect: '上等锻造材料', appearance: '乌黑矿石' },
    { name: '回春药水', category: '消耗品', quantity: 5, effect: '恢复500点生命' },
  ] as unknown as InventoryItem[];
  // 用户输入只提到「玄铁矿」；leanItems=true
  const card = serializePlayerCard(profile, { hp: 100, maxHp: 100, mp: 50, maxMp: 50 }, [], [], items, limits,
    undefined, undefined, undefined, undefined, undefined, '我想用玄铁矿打造点东西', true);

  it('已装备的武器→全量（含效果/词缀/已装备标记）', () => {
    expect(card).toContain('灭世之刃');
    expect(card).toContain('攻击附带火焰');
    expect(card).toContain('+10锋锐');
    expect(card).toContain('已装备');
  });

  it('用户输入提到的物品（玄铁矿）→全量（含效果）', () => {
    expect(card).toContain('玄铁矿');
    expect(card).toContain('上等锻造材料');
  });

  it('装备(已装备武器)只注入战斗相关，不注入 外观/获得途径/备注', () => {
    expect(card).toContain('攻击附带火焰');        // 效果保留
    expect(card).toContain('+10锋锐');              // 词缀保留
    expect(card).not.toContain('漆黑长刀泛血光');  // 外观省略
    expect(card).not.toContain('击败魔王所得');     // 获得途径省略
    expect(card).not.toContain('需吸血维持');       // 备注省略
  });

  it('非装备物品(玄铁矿·材料)全量行也裁掉 外观/获得/备注，仅留效果', () => {
    expect(card).toContain('上等锻造材料');   // 效果保留
    expect(card).not.toContain('乌黑矿石');    // 外观裁掉（裁剪已推广到非装备）
  });

  it('未提到且未装备的物品（回春药水）→仅名称，不含效果细节', () => {
    expect(card).toContain('回春药水');          // 名称仍在（AI 知道背包有它）
    expect(card).not.toContain('恢复500点生命');  // 但效果细节被省略
  });

  it('渲染「其余物品栏（仅名称）」分块', () => {
    expect(card).toContain('其余物品栏（仅名称）');
  });

  it('不开 leanItems 时维持旧行为（材料/消耗品全量，无"仅名称"块）', () => {
    const legacy = serializePlayerCard(profile, { hp: 100, maxHp: 100, mp: 50, maxMp: 50 }, [], [], items,
      { maxNpcs: 0, maxSkills: 3, maxItems: 99 });
    expect(legacy).toContain('恢复500点生命');       // 旧行为：材料/消耗品全量注入
    expect(legacy).not.toContain('其余物品栏（仅名称）');
  });
});

/* 技能护栏只按【用户输入】判定：治"正文提到一堆技能名就全绕过 maxSkills → 注入一大堆"违背上限。 */
describe('serializePlayerCard·技能护栏仅按用户输入（不扫整段正文）', () => {
  const profile = { name: '云舒', attrs: { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 } } as unknown as PlayerProfile;
  const limits = { maxNpcs: 0, maxSkills: 0, maxItems: 0 };   // 上限=0：只有护栏能把技能塞进来，便于验证护栏范围
  const skills = [{ name: '烈焰斩', effect: '火焰伤害' }] as unknown as import('../store/characterStore').Skill[];
  const game = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };

  it('技能名只在正文(context)出现、用户输入没喊 → 不注入（尊重 maxSkills=0）', () => {
    const card = serializePlayerCard(profile, game, skills, [], [], limits,
      undefined, undefined, undefined, undefined, '他挥出了烈焰斩，火光冲天', '继续', true);
    expect(card).not.toContain('烈焰斩');
  });
  it('技能名在用户输入里喊到 → 强制注入（护栏对玩家显式输入仍生效）', () => {
    const card = serializePlayerCard(profile, game, skills, [], [], limits,
      undefined, undefined, undefined, undefined, '（前情提要）', '我要用烈焰斩劈过去', true);
    expect(card).toContain('烈焰斩');
  });
});

/* NPC 卡物品同口径：装备/物品行也裁掉 外观/获得途径/备注，仅留效果/标签。 */
describe('serializeNpcCard（NPC 装备/物品裁掉 外观/获得/备注）', () => {
  const npc = {
    id: 'C1', name: '薇妮', onScene: true, favor: 50,
    items: [
      { name: '寒铁剑', category: '武器', gradeDesc: '精良', equipped: true, equipSlot: '武器', effect: '冰属性伤害', appearance: '剑身覆霜纹', acquisition: '铁匠铺购入', notes: '需定期保养' },
    ],
  } as unknown as NpcRecord;
  const card = serializeNpcCard(npc, [], []);

  it('NPC 装备保留效果，裁掉 外观/获得途径/备注', () => {
    expect(card).toContain('寒铁剑');
    expect(card).toContain('冰属性伤害');        // 效果保留
    expect(card).not.toContain('剑身覆霜纹');    // 外观裁掉
    expect(card).not.toContain('铁匠铺购入');    // 获得途径裁掉
    expect(card).not.toContain('需定期保养');    // 备注裁掉
  });
});

/* 每-NPC 技能上限：设了 maxNpcSkills 则取前 N 全量 + 其余仅列名称（治"NPC 几十个技能满装备撑爆上下文·AI 流口水"）。*/
describe('serializeNpcCard（每-NPC 技能上限：前 N 全量 + 长尾仅名称）', () => {
  const mkSkill = (name: string, effect: string) => ({ name, effect, rarity: 'A' }) as unknown as Skill;
  const skills = ['技能甲', '技能乙', '技能丙', '技能丁', '技能戊'].map((n, i) => mkSkill(n, `效果串${i}`));
  const npc = { id: 'C1', name: '苏晓', onScene: true, favor: 0 } as unknown as NpcRecord;

  it('无上限（缺省）→ 全部技能带效果（旧行为不变）', () => {
    const card = serializeNpcCard(npc, skills, []);
    for (let i = 0; i < 5; i++) expect(card).toContain(`效果串${i}`);
  });

  it('maxNpcSkills=2 → 恰 2 条带全效果，其余 3 条只列名称', () => {
    const card = serializeNpcCard(npc, skills, [], undefined, undefined,
      { maxNpcs: 2, maxSkills: 3, maxItems: 2, maxNpcSkills: 2 });
    const effShown = [0, 1, 2, 3, 4].filter((i) => card.includes(`效果串${i}`)).length;
    expect(effShown).toBe(2);                        // 只有前 2 条给全效果
    expect(card).toContain('其余 3 个技能(仅名称');   // 长尾折叠提示
    for (const n of ['技能甲', '技能乙', '技能丙', '技能丁', '技能戊']) expect(card).toContain(n);  // 5 个名字都在
  });
});

/* 归档≠删除·防"离场就失忆"：离场但被正文点名的 NPC 带记忆有界救回结构化召回。
   治"归档任务BOSS后 AI 忘了他、同世界前后文对不上"。 */
describe('pickOffsceneRescue（离场角色被正文点名→带记忆救回·有界）', () => {
  const mk = (id: string, name: string, onScene: boolean, lastSeenTurn = 0, isDead = false) =>
    ({ id, name, onScene, isDead, lastSeenTurn, favor: 0 } as unknown as NpcRecord);

  it('离场 NPC 被正文点名 → 救回', () => {
    expect(pickOffsceneRescue([mk('C1', '龙王', false, 5)], '龙王的身影再次浮现', []).map((r) => r.id))
      .toEqual(['C1']);
  });

  it('在场 NPC 不走这条（由 rankNpcsLocal 覆盖）→ 不救回', () => {
    expect(pickOffsceneRescue([mk('C1', '龙王', true, 5)], '龙王就在眼前', [])).toEqual([]);
  });

  it('已在 exclude（已被选中）→ 不重复并入', () => {
    const r = mk('C1', '龙王', false, 5);
    expect(pickOffsceneRescue([r], '龙王', [r])).toEqual([]);
  });

  it('已死的离场角色 → 不救回', () => {
    expect(pickOffsceneRescue([mk('C1', '龙王', false, 5, true)], '龙王的尸骸尚在', [])).toEqual([]);
  });

  it('未被点名 → 空', () => {
    expect(pickOffsceneRescue([mk('C1', '龙王', false, 5)], '一片祥和，无人现身', [])).toEqual([]);
  });

  it('超过上限 → 限量 3，最近在场者(lastSeenTurn 大)优先，最久没露面的被挤掉', () => {
    const npcs = [
      mk('C1', '青牛', false, 1), mk('C2', '白鹿', false, 9),
      mk('C3', '赤蛇', false, 5), mk('C4', '玄龟', false, 7),
    ];
    expect(pickOffsceneRescue(npcs, '青牛白鹿赤蛇玄龟齐聚一堂', [], 3).map((r) => r.id))
      .toEqual(['C2', 'C4', 'C3']);
  });
});
