import { describe, it, expect } from 'vitest';
import { parseDoctorReply, buildPatch, describeDoctorKey, parsePatchLine, fmtVarValue, inverseLine, applyDoctorPatches, undoDoctorPatches } from './stateDoctor';
import { useNpc } from '../store/npcStore';
import { useVariables } from '../store/variableStore';
import { useItems } from '../store/itemStore';

/* 🩺 状态诊断：行协议解析 + 白名单预检 + 逆补丁往返。钉住三条命门：
   ① applyOneUpdate 对未知键静默跳过 → 可用性判定只能靠这里的白名单（清单外必须 ok:false 且给理由）；
   ② 点数/上限/档案类必须拒（只对账不发福利）；③ 撤销=旧值逆补丁走同一条 <state> 管道，能精确往返。 */
describe('状态诊断 · 行协议解析', () => {
  it('「补丁:/依据:」成对解析 + 同键去重 + 无需修复', () => {
    const rep = parseDoctorReply([
      '补丁: hp.B1 -= 30',
      '依据: 正文「肋骨断裂咳血倒地」但 HP 未扣',
      '补丁: 乐园币 -= 500',
      '依据: 「递出五百枚乐园币」未入账',
      '补丁: hp.B1 -= 10',
      '依据: 重复键应被去重',
    ].join('\n'));
    expect(rep.patches).toHaveLength(2);
    expect(rep.patches[0].line).toBe('hp.B1 -= 30');
    expect(rep.patches[0].reason).toContain('肋骨断裂');
    expect(rep.clean).toBe(false);
    const clean = parseDoctorReply('无需修复');
    expect(clean.clean).toBe(true);
    expect(clean.patches).toHaveLength(0);
  });

  it('CJK 键与列表前缀都认', () => {
    expect(parsePatchLine('乐园币 += 100')).toEqual({ key: '乐园币', op: '+=', value: '100' });
    const rep = parseDoctorReply('- 补丁: 乐园币 += 100\n- 依据: 正文明说收款一百');
    expect(rep.patches[0].key).toBe('乐园币');
    expect(rep.patches[0].reason).toContain('收款');
  });
});

describe('状态诊断 · 白名单预检', () => {
  it('主角 hp/mp/san 放行；上限/衍生/点数拒', () => {
    expect(describeDoctorKey('hp.B1').ok).toBe(true);
    expect(describeDoctorKey('mp').ok).toBe(true);
    expect(describeDoctorKey('maxHp.B1').ok).toBe(false);
    expect(describeDoctorKey('atk').ok).toBe(false);
    expect(describeDoctorKey('技能点').ok).toBe(false);
    expect(describeDoctorKey('currency.黄金技能点').ok).toBe(false);
  });

  it('NPC：在档才放行、只认 hp/mp', () => {
    expect(describeDoctorKey('hp.C999').ok).toBe(false);
    useNpc.getState().upsertNpc('C77', { name: '测试军医靶子', hp: 50, maxHp: 80, onScene: true });
    const info = describeDoctorKey('hp.C77');
    expect(info.ok).toBe(true);
    expect(info.current).toBe('50');
    expect(describeDoctorKey('san.C77').ok).toBe(false);
  });

  it('档案/物品类拒并指路；未定义变量拒', () => {
    expect(describeDoctorKey('character.C1.trust').rejectReason).toContain('档案');
    expect(describeDoctorKey('eq.B1').ok).toBe(false);
    expect(describeDoctorKey('不存在的变量键').ok).toBe(false);
  });

  it('buildPatch：数值型给出「当前 → 预测」', () => {
    useNpc.getState().upsertNpc('C78', { name: '预测靶子', hp: 40, onScene: true });
    const p = buildPatch('hp.C78 -= 15', '中了一箭');
    expect(p.ok).toBe(true);
    expect(p.current).toBe('40');
    expect(p.predicted).toBe('25');
    const bad = buildPatch('这不是指令', '瞎写');
    expect(bad.ok).toBe(false);
  });
});

describe('状态诊断 · 逆补丁与往返', () => {
  it('fmtVarValue：字符串带引号、数字/布尔裸值', () => {
    expect(fmtVarValue('number', 7)).toBe('7');
    expect(fmtVarValue('boolean', true)).toBe('true');
    expect(fmtVarValue('string', '他说"好"')).toBe('"他说\'好\'"');
  });

  it('自定义变量：应用 → 撤销精确往返（走真 applyStateUpdates 管道）', () => {
    useVariables.getState().upsertDefinition({ key: 'doctor_test_var', label: '军医测试', type: 'number', value: 5, showInStatusBar: false });
    const p = buildPatch('doctor_test_var += 3', '测试');
    expect(p.ok).toBe(true);
    const r = applyDoctorPatches([p]);
    expect(r.applied).toBeGreaterThan(0);
    expect(r.undoLines).toEqual(['doctor_test_var = 5']);
    expect(useVariables.getState().variables.find((v) => v.key === 'doctor_test_var')?.value).toBe(8);
    undoDoctorPatches(r.undoLines);
    expect(useVariables.getState().variables.find((v) => v.key === 'doctor_test_var')?.value).toBe(5);
  });

  it('货币：乐园币走 scanCjk 补扫管道往返', () => {
    const I = useItems.getState();
    const base = I.currency['乐园币'] ?? 0;
    const p = buildPatch('乐园币 += 100', '测试入账');
    expect(p.ok).toBe(true);
    const r = applyDoctorPatches([p]);
    expect(useItems.getState().currency['乐园币']).toBe(base + 100);
    expect(r.undoLines).toEqual([`乐园币 = ${base}`]);
    undoDoctorPatches(r.undoLines);
    expect(useItems.getState().currency['乐园币']).toBe(base);
  });

  it('inverseLine：主角裸键归一到 .B1 形态', () => {
    expect(inverseLine('hp')).toMatch(/^hp\.B1 = -?\d+/);
    expect(inverseLine('不存在的键')).toBeNull();
  });

  it('不可应用的补丁绝不进管道', () => {
    const bad = buildPatch('技能点 += 99', '想白嫖');
    const r = applyDoctorPatches([bad]);
    expect(r.applied).toBe(0);
    expect(r.undoLines).toHaveLength(0);
  });
});
