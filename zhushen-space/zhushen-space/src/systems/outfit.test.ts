import { describe, it, expect, beforeEach } from 'vitest';
import { useOutfits } from '../store/outfitStore';
import { useOutfitTemplates } from '../store/outfitTemplateStore';
import { activeOutfit, outfitRosterLine, applyOutfitCommand } from './outfit';
import { buildOutfitInjection } from './promptInjections';
import { buildPortraitPrompt } from './imageGen';
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
});
