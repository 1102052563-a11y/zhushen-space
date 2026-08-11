import { describe, it, expect, beforeEach } from 'vitest';
import { parseTrainingBlock, parseTrainingReply, applyTrainPatch } from './training';
import { useNpc } from '../store/npcStore';

/* 造一个最小 NPC 档案塞进 store（字段用 as any 免造全字段） */
function seedNpc(id: string, extra: Record<string, string> = {}, disp: Partial<{ trust: number; respect: number; lust: number; corruption: number }> = {}, name = '测试娘') {
  useNpc.setState((s: any) => ({
    npcs: { ...s.npcs, [id]: { id, name, onScene: true, extra: { ...extra }, trust: 10, respect: 10, lust: 0, corruption: 0, ...disp } },
  }));
}

describe('parseTrainingReply 三块解析', () => {
  it('对白/交互/调教 各归其位', () => {
    const r = parseTrainingReply('<对白>「不要…」</对白>\n<交互>她别过脸</交互>\n<调教>\n情欲值+=5\n</调教>');
    expect(r.dialogue).toBe('「不要…」');
    expect(r.scene).toBe('她别过脸');
    expect(r.patch.extra['情欲值']).toBe('+=5');
  });
  it('缺标签：非交互/调教文本当对白', () => {
    expect(parseTrainingReply('她轻轻点头。').dialogue).toBe('她轻轻点头。');
  });
});

describe('parseTrainingBlock 字段白名单', () => {
  it('识别 = / += / -= / disp / 受孕；未知键忽略', () => {
    const p = parseTrainingBlock([
      '情欲值+=8', '快感值=30', '开发·下体+=5', '调教值+=2', '性经验=初次口部侍奉',
      'disp.沉沦+=3', 'disp.情欲=5', '受孕提示=真', '身高=170', '乱写一行',
    ].join('\n'));
    expect(p.extra['情欲值']).toBe('+=8');
    expect(p.extra['快感值']).toBe('=30');
    expect(p.extra['开发·下体']).toBe('+=5');
    expect(p.extra['调教值']).toBe('+=2');
    expect(p.extra['性经验']).toBe('初次口部侍奉');
    expect(p.disp.corruption).toBe(3);
    expect(p.disp.lust).toBe(5);
    expect(p.pregHint).toBe(true);
    expect(p.extra['身高']).toBeUndefined();   // 非白名单键忽略
  });
});

describe('applyTrainPatch 落库护栏', () => {
  beforeEach(() => { useNpc.setState({ npcs: {} } as any); });

  it('clamp 数值键 0~100·可增可减', () => {
    seedNpc('C1', { 情欲值: '90' });
    applyTrainPatch('C1', { extra: { 情欲值: '+=20' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['情欲值']).toBe('100');   // 夹顶
    applyTrainPatch('C1', { extra: { 情欲值: '-=30' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['情欲值']).toBe('70');
  });

  it('调教值/性爱次数只增：绝对赋值更小值被拒、-= 不生效', () => {
    seedNpc('C1', { 调教值: '50', 性爱次数: '10' });
    applyTrainPatch('C1', { extra: { 调教值: '=10', 性爱次数: '+=3' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['调教值']).toBe('50');    // 更小的绝对赋值被拒（只增）
    expect(useNpc.getState().npcs['C1'].extra['性爱次数']).toBe('13');
    applyTrainPatch('C1', { extra: { 调教值: '=80' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['调教值']).toBe('80');    // 更大的绝对赋值放行
  });

  it('文本键：累积去重·拒空覆盖·当前态字段替换', () => {
    seedNpc('C1', { 性经验: '初次接吻', 性器状态: '完璧' });
    applyTrainPatch('C1', { extra: { 性经验: '口部开发', 性器状态: '已开苞' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['性经验']).toContain('初次接吻');
    expect(useNpc.getState().npcs['C1'].extra['性经验']).toContain('口部开发');   // 累加
    expect(useNpc.getState().npcs['C1'].extra['性器状态']).toBe('已开苞');         // 当前态字段替换
    // 拒空覆盖：空串不动既有
    applyTrainPatch('C1', { extra: { 性器状态: '' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['性器状态']).toBe('已开苞');
    // 重复内容不叠加
    const before = useNpc.getState().npcs['C1'].extra['性经验'];
    applyTrainPatch('C1', { extra: { 性经验: '口部开发' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['性经验']).toBe(before);
  });

  it('绝不把已开发写回处女初始态（只增护栏：调教值/开发度都拒降）', () => {
    seedNpc('C1', { '调教值': '60', '开发·下体': '70' });
    // AI 试图重置
    applyTrainPatch('C1', { extra: { '调教值': '=0', '开发·下体': '=0', '开发·后庭': '-=50' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['调教值']).toBe('60');    // 只增→不降
    expect(useNpc.getState().npcs['C1'].extra['开发·下体']).toBe('70');  // 开发度不可逆→不降
    // 开发度 += 正常涨且夹顶
    applyTrainPatch('C1', { extra: { '开发·下体': '+=50' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['开发·下体']).toBe('100');
  });

  it('四轴增量落库（过 guard 限速后）', () => {
    seedNpc('C1', { }, { corruption: 20 });
    applyTrainPatch('C1', { extra: {}, disp: { corruption: 3, lust: 5 }, pregHint: false }, '媚药 生死与共');   // 强事件词放宽
    const rec = useNpc.getState().npcs['C1'];
    expect(rec.corruption).toBeGreaterThanOrEqual(20);   // 只增棘轮
    expect(rec.lust).toBeGreaterThan(0);
  });

  it('扩展计数只增：性爱人数/高潮/内射/怀孕次数 拒降', () => {
    seedNpc('C1', { 高潮次数: '30', 怀孕次数: '1' });
    applyTrainPatch('C1', { extra: { 高潮次数: '+=5', 内射次数: '+=2', 性爱人数: '=3', 怀孕次数: '=0' }, disp: {}, pregHint: false }, '');
    const ex = useNpc.getState().npcs['C1'].extra;
    expect(ex['高潮次数']).toBe('35');
    expect(ex['内射次数']).toBe('2');    // 从无到 2
    expect(ex['性爱人数']).toBe('3');
    expect(ex['怀孕次数']).toBe('1');    // =0 更小 → 拒（只增）
  });

  it('服从度/依赖度可增可减·0~100', () => {
    seedNpc('C1', { 服从度: '40' });
    applyTrainPatch('C1', { extra: { 服从度: '+=30', 依赖度: '=20' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['服从度']).toBe('70');
    expect(useNpc.getState().npcs['C1'].extra['依赖度']).toBe('20');
    applyTrainPatch('C1', { extra: { 服从度: '-=50' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['服从度']).toBe('20');   // 关系态可回落
  });

  it('贞操不可逆：已破处不许写回处女', () => {
    seedNpc('C1', { 贞操状态: '已破处' });
    applyTrainPatch('C1', { extra: { 贞操状态: '完璧处女' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['贞操状态']).toBe('已破处');   // 回写处女被拦
    // 处女→已破处 单向放行（用不同名字避免同名合并 sweep）
    seedNpc('C2', { 贞操状态: '处女' }, {}, '测试娘乙');
    applyTrainPatch('C2', { extra: { 贞操状态: '已破处·落红' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C2'].extra['贞操状态']).toContain('已破处');
  });

  it('初次记录首次写入即锁定：破处对象/初体验不被改写', () => {
    seedNpc('C1', { 破处对象: '主角' });
    applyTrainPatch('C1', { extra: { 破处对象: '别人', 初体验: '雨夜的初次' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['破处对象']).toBe('主角');      // 已有→锁定不覆盖
    expect(useNpc.getState().npcs['C1'].extra['初体验']).toBe('雨夜的初次');   // 首次写入放行
  });

  it('心理/倾向扩展：当前态替换 vs 累积 append；性开放度可增减', () => {
    seedNpc('C1', { BDSM倾向: '倾向服从', 心结软肋: '怕被抛弃', 性开放度: '30' });
    applyTrainPatch('C1', { extra: {
      BDSM倾向: 'sub·喜欢被当宠物',   // 当前态→替换
      角色扮演偏好: '主人-小狗',       // 新键接收
      心结软肋: '也很在意容貌',        // 累积→append
      性开放度: '+=25',               // 可增
    }, disp: {}, pregHint: false }, '');
    const ex = useNpc.getState().npcs['C1'].extra;
    expect(ex['BDSM倾向']).toBe('sub·喜欢被当宠物');           // 替换
    expect(ex['角色扮演偏好']).toBe('主人-小狗');
    expect(ex['心结软肋']).toContain('怕被抛弃');              // append 保留旧
    expect(ex['心结软肋']).toContain('也很在意容貌');
    expect(ex['性开放度']).toBe('55');
    applyTrainPatch('C1', { extra: { 性开放度: '-=15' }, disp: {}, pregHint: false }, '');
    expect(useNpc.getState().npcs['C1'].extra['性开放度']).toBe('40');   // 可回落
  });
});
