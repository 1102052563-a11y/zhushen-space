import { describe, it, expect, beforeEach } from 'vitest';
import { useCreationContent } from './creationContentStore';
import { ccPack, ccInstall } from '../systems/workshop';

/* 治用户报「自定义天赋写好简介/评级… → 上传再下载全没了」：自定义/工坊天赋曾只存 {name,effect}，
   丢掉 简描(desc)/评级(rarity)/类型(category)/等级(level)/来源(source)/属性加成(attrBonus)。
   下面锁死：入库 + 工坊 pack→install 全字段 round-trip。 */
describe('自定义/工坊天赋·全固定格式字段留存', () => {
  beforeEach(() => useCreationContent.setState({ paradises: [], races: [], talents: [] }));

  const full = {
    name: '欲断未绝牵丝戏', effect: '剪断仇恨因果线', desc: '发动此神通时，你并不是隐身',
    rarity: 'C', category: '特殊异能类', level: '觉醒·Lv.1', source: '开局自带', attrBonus: '力量+10、智力+15%',
  };

  it('addTalent 保存全部字段（不再只剩 name+effect）', () => {
    useCreationContent.getState().addTalent(full);
    expect(useCreationContent.getState().talents[0]).toMatchObject(full);
  });

  it('ccPack → ccInstall：上传打包 + 下载安装保留全字段（含简介）', () => {
    useCreationContent.getState().addTalent(full);
    const id = useCreationContent.getState().talents[0].id;
    const packed = ccPack('talent', id);
    expect(packed?.payload).toMatchObject(full);   // 打包带全字段

    useCreationContent.setState({ paradises: [], races: [], talents: [] });   // 模拟到别人的空库
    ccInstall('talent', packed!.payload);
    expect(useCreationContent.getState().talents[0]).toMatchObject(full);      // 安装还原全字段
  });

  it('空字段收敛为 undefined、不落空串', () => {
    useCreationContent.getState().addTalent({ name: '空天赋', effect: '', desc: '  ' });
    const t = useCreationContent.getState().talents[0];
    expect(t.name).toBe('空天赋');
    expect(t.effect).toBeUndefined();
    expect(t.desc).toBeUndefined();
  });
});
