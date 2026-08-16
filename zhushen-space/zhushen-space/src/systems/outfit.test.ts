import { describe, it, expect, beforeEach } from 'vitest';
import { useOutfits, type OutfitRecord } from '../store/outfitStore';
import { useOutfitTemplates } from '../store/outfitTemplateStore';
import { useItems } from '../store/itemStore';
import { activeOutfit, outfitRosterLine, applyOutfitCommand } from './outfit';
import { collectEquippedForOutfit } from './outfitGen';
import { buildOutfitInjection } from './promptInjections';
import { buildPortraitPrompt } from './imageGen';
import { buildTryOnPrompt, charLook } from './outfitTryOn';
import { useImageGen } from '../store/imageGenStore';
import { usePlayer } from '../store/playerStore';

// 👗 衣柜：数据层 + 三线接线读取口 + 立绘提示词覆盖，钉住「钦定穿搭=服装单一权威源」。
describe('衣柜（穿搭预设）', () => {
  beforeEach(() => {
    useOutfits.getState().clearAll();
  });

  it('增删改 + 激活/取消激活', () => {
    const s = useOutfits.getState();
    const id = s.addOutfit('C1', { name: '战斗服', desc: '黑色作战服，护目镜', tags: '战斗', imageTags: 'black bodysuit, goggles' });
    expect(useOutfits.getState().byChar['C1'].outfits).toHaveLength(1);
    expect(activeOutfit('C1')).toBeNull();                      // 未激活=null（回退装备栏/外观）
    s.setActive('C1', id);
    expect(activeOutfit('C1')?.name).toBe('战斗服');
    s.updateOutfit('C1', id, { desc: '深黑色作战服' });
    expect(activeOutfit('C1')?.desc).toBe('深黑色作战服');
    s.removeOutfit('C1', id);                                    // 删除激活中的一套 → activeId 一并清空
    expect(useOutfits.getState().byChar['C1'].activeId).toBe('');
    expect(activeOutfit('C1')).toBeNull();
  });

  it('roster 行：激活才有、含描述与服装标签', () => {
    const s = useOutfits.getState();
    expect(outfitRosterLine('B1')).toBe('');
    const id = s.addOutfit('B1', { name: '礼服', desc: '白色晚礼服', tags: '', imageTags: 'white dress' });
    expect(outfitRosterLine('B1')).toBe('');                    // 加了但没激活 → 不注入
    s.setActive('B1', id);
    const line = outfitRosterLine('B1');
    expect(line).toContain('礼服');
    expect(line).toContain('白色晚礼服');
    expect(line).toContain('white dress');
  });

  it('立绘提示词：自然语言线 ${attire} 被钦定穿搭覆盖（优先于装备栏）', () => {
    useImageGen.setState({ portraitService: 'openai' });        // 走自然语言模板路径
    const s = useOutfits.getState();
    const id = s.addOutfit('C2', { name: '常服', desc: '米色风衣', tags: '', imageTags: '' });
    s.setActive('C2', id);
    const withOutfit = buildPortraitPrompt({ gender: '女', charId: 'C2', equipment: '铁甲', appearance: '红发' });
    expect(withOutfit).toContain('米色风衣');                    // 钦定穿搭 > 装备栏
    const noCharId = buildPortraitPrompt({ gender: '女', equipment: '铁甲', appearance: '红发' });
    expect(noCharId).toContain('铁甲');                          // 不传 charId → 原逻辑（装备栏）
    expect(noCharId).not.toContain('米色风衣');
  });

  it('立绘提示词：标签线并入英文服装标签', () => {
    useImageGen.setState({ portraitService: 'nai' });           // 标签路径
    const s = useOutfits.getState();
    const id = s.addOutfit('C3', { name: '潜行装', desc: '夜行衣', tags: '', imageTags: 'black hood, ninja outfit' });
    s.setActive('C3', id);
    const p = buildPortraitPrompt({ gender: '男', charId: 'C3', imageTags: '1boy, short hair' });
    expect(p).toContain('black hood, ninja outfit');
  });

  it('试衣间 outfitOverride：不必激活即可预览、优先于激活穿搭、两条线都吃', () => {
    useImageGen.setState({ portraitService: 'openai' });        // 自然语言模板路径
    const s = useOutfits.getState();
    const worn = s.addOutfit('C5', { name: '常服', desc: '米色风衣', tags: '', imageTags: '' });
    s.setActive('C5', worn);
    const preview: OutfitRecord = { id: 'try1', name: '礼服', desc: '绯红晚礼服', tags: '', imageTags: 'red dress', createdAt: 1 };
    const p = buildPortraitPrompt({ gender: '女', charId: 'C5', equipment: '铁甲', appearance: '红发', outfitOverride: preview });
    expect(p).toContain('绯红晚礼服');                           // override > 激活穿搭
    expect(p).not.toContain('米色风衣');
    useImageGen.setState({ portraitService: 'nai' });           // 标签路径同样吃 override 英文标签
    const pt = buildPortraitPrompt({ gender: '女', charId: 'C5', imageTags: '1girl', outfitOverride: preview });
    expect(pt).toContain('red dress');
    useImageGen.setState({ portraitService: 'openai' });        // 不传 override → 回到激活穿搭（原逻辑不变）
    const p2 = buildPortraitPrompt({ gender: '女', charId: 'C5', equipment: '铁甲', appearance: '红发' });
    expect(p2).toContain('米色风衣');
  });

  it('试衣提示词 buildTryOnPrompt：读主角档案、未激活的一套也能拼进提示词', () => {
    useImageGen.setState({ portraitService: 'openai' });
    usePlayer.getState().setProfile({ name: '白夜', gender: '男', appearance: '黑发黑瞳' });
    const s = useOutfits.getState();
    const id = s.addOutfit('B1', { name: '夜行衣', desc: '玄黑夜行衣，覆面斗篷', tags: '潜行', imageTags: '' });
    expect(activeOutfit('B1')).toBeNull();                       // 没激活
    const rec = useOutfits.getState().byChar['B1'].outfits.find((o) => o.id === id)!;
    const p = buildTryOnPrompt('B1', rec);
    expect(p).toContain('玄黑夜行衣');                            // 未激活也能试穿
    const look = charLook('B1');
    expect(look?.name).toBe('白夜');                              // 读取当前人物形象
    expect(look?.rows.some((r) => r.value.includes('黑发黑瞳'))).toBe(true);
    expect(charLook('C_不存在')).toBeNull();
  });

  it('AI 换装指令：名称/场景标签模糊命中、取消词、未命中不动', () => {
    const s = useOutfits.getState();
    const a = s.addOutfit('B1', { name: '黑色战斗服', desc: '黑色作战服', tags: '战斗,突袭', imageTags: '' });
    s.addOutfit('B1', { name: '白色礼服', desc: '白色晚礼服', tags: '宴会', imageTags: '' });
    expect(applyOutfitCommand('B1', '黑色战斗服')).toBe(true);        // 精确名
    expect(activeOutfit('B1')?.id).toBe(a);
    expect(applyOutfitCommand('B1', '宴会')).toBe(true);              // 场景标签命中
    expect(activeOutfit('B1')?.name).toBe('白色礼服');
    expect(applyOutfitCommand('B1', '战斗')).toBe(true);              // 标签部分命中回黑色战斗服
    expect(activeOutfit('B1')?.id).toBe(a);
    expect(applyOutfitCommand('B1', '根本没有这套')).toBe(false);     // 未命中：保持不变
    expect(activeOutfit('B1')?.id).toBe(a);
    expect(applyOutfitCommand('B1', '无')).toBe(true);                // 取消钦定
    expect(activeOutfit('B1')).toBeNull();
  });

  it('跨存档模板库：同名覆盖返回原 id、导入衣柜、删除', () => {
    useOutfitTemplates.setState({ templates: [] });
    const T = useOutfitTemplates.getState();
    const id1 = T.saveTemplate({ name: '晚礼服', desc: '黑色晚礼服', tags: '宴会', imageTags: '', hasImage: false });
    expect(useOutfitTemplates.getState().templates).toHaveLength(1);
    const id2 = T.saveTemplate({ name: '晚礼服', desc: '深蓝晚礼服（改）', tags: '宴会,正式', imageTags: '', hasImage: false });
    expect(id2).toBe(id1);                                            // 同名覆盖=原 id
    expect(useOutfitTemplates.getState().templates).toHaveLength(1);
    expect(useOutfitTemplates.getState().templates[0].desc).toContain('深蓝');
    // 导入到某角色衣柜（UI onImportTemplate 的核心路径=addOutfit 拷贝字段）
    const t = useOutfitTemplates.getState().templates[0];
    const oid = useOutfits.getState().addOutfit('C9', { name: t.name, desc: t.desc, tags: t.tags, imageTags: t.imageTags });
    expect(useOutfits.getState().byChar['C9'].outfits[0].id).toBe(oid);
    expect(useOutfits.getState().byChar['C9'].outfits[0].desc).toContain('深蓝');
    T.removeTemplate(id1);
    expect(useOutfitTemplates.getState().templates).toHaveLength(0);
  });

  it('按装备生成：只收已装备物品、带外观与槽位、无装备抛人话错', () => {
    usePlayer.getState().setProfile({ name: '白夜', gender: '男' });
    useItems.setState({
      items: [
        { id: 'I1', name: '幽冥骨卫重甲', category: '防具', gradeDesc: '紫色', effect: '', quantity: 1, equipped: true, equipSlot: '身体', tags: [], appearance: '暗紫色半透明魔纺，双肩苍白骨质外壳', addedAt: 1 },
        { id: 'I2', name: '没穿的斗篷', category: '防具', gradeDesc: '蓝色', effect: '', quantity: 1, equipped: false, tags: [], appearance: '灰色旅行斗篷', addedAt: 2 },
        { id: 'I3', name: '无外观短刀', category: '武器', gradeDesc: '绿色', effect: '', quantity: 1, equipped: true, tags: [], addedAt: 3 },
      ] as any,
    });
    const input = collectEquippedForOutfit('B1');
    expect(input).toContain('白夜');
    expect(input).toContain('幽冥骨卫重甲');
    expect(input).toContain('暗紫色半透明魔纺');
    expect(input).toContain('[身体/防具]');
    expect(input).toContain('无外观短刀');
    expect(input).toContain('未写外观');                       // 缺外观走保守占位
    expect(input).not.toContain('没穿的斗篷');                  // 未装备不进清单
    useItems.setState({ items: [] as any });
    expect(() => collectEquippedForOutfit('B1')).toThrow(/没有已装备/);
  });

  it('<钦定穿搭> 注入：主角有衣柜才出块，含当前穿着与清单与指令说明', () => {
    usePlayer.getState().setProfile({ name: '白夜' });
    expect(buildOutfitInjection()).toHaveLength(0);                   // 无衣柜不出块
    const s = useOutfits.getState();
    const id = s.addOutfit('B1', { name: '常服', desc: '灰色风衣', tags: '日常', imageTags: '' });
    s.setActive('B1', id);
    const inj = buildOutfitInjection();
    expect(inj).toHaveLength(1);
    expect(inj[0].content).toContain('<钦定穿搭>');
    expect(inj[0].content).toContain('灰色风衣');
    expect(inj[0].content).toContain('outfit.角色ID = 穿搭名');
    expect(inj[0].content).toContain('「常服」[日常]');
  });

  it('🎲 手动随机搭配：空衣柜不动、>1套必换不同并激活、候选池限定范围、单套返回自身', () => {
    const s = useOutfits.getState();
    expect(s.rollRandom('C7')).toBe('');                       // 空衣柜 → '' 不动
    s.addOutfit('C7', { name: '甲', desc: 'a', tags: '', imageTags: '' });
    const b = s.addOutfit('C7', { name: '乙', desc: 'b', tags: '', imageTags: '' });
    const c = s.addOutfit('C7', { name: '丙', desc: 'c', tags: '', imageTags: '' });
    // 无候选池：全衣柜抽，>1 套时必换到 ≠ 当前，且激活的就是返回的那套
    for (let i = 0; i < 12; i++) {
      const before = useOutfits.getState().byChar['C7'].activeId;
      const name = useOutfits.getState().rollRandom('C7');
      const w = useOutfits.getState().byChar['C7'];
      expect(name).toBeTruthy();
      expect(w.activeId).not.toBe(before);
      expect(w.outfits.find((o) => o.id === w.activeId)?.name).toBe(name);
    }
    // 设候选池（乙+丙）→ 只会抽到池内的
    s.toggleRandomPool('C7', b);
    s.toggleRandomPool('C7', c);
    for (let i = 0; i < 12; i++) {
      expect(['乙', '丙']).toContain(useOutfits.getState().rollRandom('C7'));
    }
    // 单套衣柜：返回唯一一套并激活（允许与当前相同）
    const only = s.addOutfit('C8', { name: '唯一', desc: 'x', tags: '', imageTags: '' });
    expect(useOutfits.getState().rollRandom('C8')).toBe('唯一');
    expect(useOutfits.getState().byChar['C8'].activeId).toBe(only);
  });

  it('每日随机换装：同日幂等、只动开了 autoDaily 的角色、候选剔除已删穿搭', () => {
    const s = useOutfits.getState();
    const a = s.addOutfit('B1', { name: '甲', desc: 'a', tags: '', imageTags: '' });
    const b = s.addOutfit('B1', { name: '乙', desc: 'b', tags: '', imageTags: '' });
    s.setActive('B1', a);
    s.toggleRandomPool('B1', a);
    s.toggleRandomPool('B1', b);
    // 没开 autoDaily → 不动
    expect(useOutfits.getState().runDailyRandom('3-1')).toHaveLength(0);
    expect(useOutfits.getState().byChar['B1'].activeId).toBe(a);
    // 开了 → 换一套（两套候选时必换到另一套）
    s.setAutoDaily('B1', true);
    const changed = useOutfits.getState().runDailyRandom('3-2');
    expect(changed).toHaveLength(1);
    expect(useOutfits.getState().byChar['B1'].activeId).toBe(b);
    // 同日再调 → 幂等不动
    expect(useOutfits.getState().runDailyRandom('3-2')).toHaveLength(0);
    // 候选里的穿搭被删 → 剔除后无可换不炸
    s.removeOutfit('B1', a);
    s.removeOutfit('B1', b);
    expect(useOutfits.getState().runDailyRandom('3-3')).toHaveLength(0);
  });
});
