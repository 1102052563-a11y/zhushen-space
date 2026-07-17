import { describe, it, expect } from 'vitest';
import {
  guardRealmChange, guardBioStrength, guardAttrValue,
  parseRealmParts, highestTierIn, tierIdxOf,
  LV_STEP_MAX, ATTR_STEP_STRONG_BASE,
  type GrowthGuardCtx,
} from './npcGrowthGuard';

const plain = '希尔薇擦拭着酒杯，和主角闲聊了几句今天的见闻。';                       // 无任何证据词
const brk   = '激战之后，希尔薇终于突破瓶颈，气息一路攀升，成功晋阶。';               // 突破证据（就近）
const down  = '仪式中希尔薇的修为被废，境界跌落，众人骇然。';                         // 跌落证据（就近）
const ctx = (narrative: string, extra?: Partial<GrowthGuardCtx>): GrowthGuardCtx => ({ narrative, ...extra });

describe('parseRealmParts / highestTierIn / tierIdxOf', () => {
  it('拆串 + 阶位等级自洽（矛盾以阶位为准夹回）', () => {
    expect(parseRealmParts('三阶·Lv.25|调查员')).toEqual({ tierIdx: 2, lv: 25, id: '调查员' });
    expect(parseRealmParts('二阶·Lv.86')).toEqual({ tierIdx: 1, lv: 20, id: '' });   // Lv.86 夹回二阶上限
    expect(parseRealmParts('Lv.35|队长').tierIdx).toBe(3);                            // 无阶位按 Lv 推 → 四阶
    expect(parseRealmParts('神官').tierIdx).toBe(-1);                                 // 纯身份认不出
  });
  it('highestTierIn 扫自由文本取最高阶位', () => {
    expect(highestTierIn('世界巅峰不过五阶，个别老怪物摸到六阶门槛')).toBe('六阶');
    expect(highestTierIn('巅峰至强坐镇，至强如云')).toBe('巅峰至强');
    expect(highestTierIn('凡人的世界')).toBe('');
    expect(tierIdxOf('九阶')).toBe(8);
  });
});

describe('guardRealmChange · 升阶闸门', () => {
  it('无突破证据的升阶被驳回（保留原阶位，身份段照常更新）', () => {
    const g = guardRealmChange('一阶·Lv.5|佣兵', '三阶·Lv.25|佣兵队长', '希尔薇', ctx(plain));
    expect(g.realm).toBe('一阶·Lv.5|佣兵队长');
    expect(g.notes.length).toBeGreaterThan(0);
  });
  it('有突破证据放行，但一回合最多 +1 阶、落新阶初期', () => {
    const g = guardRealmChange('一阶·Lv.9|佣兵', '三阶·Lv.30|佣兵', '希尔薇', ctx(brk));
    expect(g.realm.startsWith('二阶·Lv.1')).toBe(true);                               // 三阶被限速成二阶，Lv 落 11~13
    const lv = parseRealmParts(g.realm).lv!;
    expect(lv).toBeGreaterThanOrEqual(11);
    expect(lv).toBeLessThanOrEqual(11 + LV_STEP_MAX);
  });
  it('世界结算放宽到 +2 阶', () => {
    const g = guardRealmChange('一阶·Lv.9', '四阶·Lv.35', '希尔薇', ctx(plain, { settlement: true }));
    expect(parseRealmParts(g.realm).tierIdx).toBe(2);                                 // 一阶→三阶（+2）
  });
});

describe('guardRealmChange · 降阶/等级棘轮', () => {
  it('无跌落证据的降阶被驳回', () => {
    const g = guardRealmChange('三阶·Lv.25|长老', '一阶·Lv.5|长老', '希尔薇', ctx(plain));
    expect(g.realm).toBe('三阶·Lv.25|长老');
  });
  it('有跌落/被废证据放行降阶', () => {
    const g = guardRealmChange('三阶·Lv.25|长老', '一阶·Lv.5|长老', '希尔薇', ctx(down));
    expect(g.realm).toBe('一阶·Lv.5|长老');
  });
  it('同阶升级每回合限步（+5 → +2）', () => {
    const g = guardRealmChange('二阶·Lv.12', '二阶·Lv.17', '希尔薇', ctx(plain));
    expect(parseRealmParts(g.realm).lv).toBe(12 + LV_STEP_MAX);
  });
  it('同阶等级下调无证据 → 保持原级', () => {
    const g = guardRealmChange('二阶·Lv.18', '二阶·Lv.11', '希尔薇', ctx(plain));
    expect(parseRealmParts(g.realm).lv).toBe(18);
  });
  it('AI 写矛盾串「二阶·Lv.86」→ 先自洽夹回，再按步长收敛', () => {
    const g = guardRealmChange('二阶·Lv.15', '二阶·Lv.86', '希尔薇', ctx(plain));
    expect(parseRealmParts(g.realm).lv).toBe(15 + LV_STEP_MAX);                       // 86→夹回20→步长收敛到17
  });
});

describe('guardRealmChange · 首档 / 巅峰封顶 / 兼容', () => {
  it('首次建档放行（合法化），但土著超世界巅峰被压回', () => {
    const g = guardRealmChange('', '七阶·Lv.65|城主', '老城主', ctx(plain, { worldPeakTier: '五阶' }));
    expect(parseRealmParts(g.realm).tierIdx).toBe(4);                                 // 压到五阶
  });
  it('随从/宠物豁免巅峰封顶', () => {
    const g = guardRealmChange('', '七阶·Lv.65|随从', '阿姆', ctx(plain, { worldPeakTier: '五阶' }), { exemptPeak: true });
    expect(parseRealmParts(g.realm).tierIdx).toBe(6);
  });
  it('封顶只管上行：既有档高于巅峰时不变相降阶', () => {
    const g = guardRealmChange('六阶·Lv.55|强者', '六阶·Lv.56|强者', '老怪', ctx(plain, { worldPeakTier: '五阶' }));
    expect(parseRealmParts(g.realm).tierIdx).toBe(5);                                 // 保持六阶
  });
  it('纯身份更新（认不出阶位）不动数字段', () => {
    const g = guardRealmChange('三阶·Lv.25|调查员', '首席调查员', '希尔薇', ctx(plain));
    expect(g.realm).toBe('三阶·Lv.25|首席调查员');
  });
  it('无上下文（迁移/测试路径）不做证据裁决，只合法化', () => {
    const g = guardRealmChange('一阶·Lv.5', '三阶·Lv.25', '希尔薇', null);
    expect(parseRealmParts(g.realm).tierIdx).toBe(2);
  });
});

describe('guardBioStrength', () => {
  it('永远夹进本阶位窗口（一阶写 T8 → T3）', () => {
    const g = guardBioStrength(undefined, 'T8·真神', '一阶·Lv.5', '希尔薇', ctx(plain));
    expect(g.bs).toBe('T3·勇士');
  });
  it('升档无证据被驳回，有证据一回合一档', () => {
    expect(guardBioStrength('T1·兵卒', 'T3·勇士', '一阶·Lv.5', '希尔薇', ctx(plain)).bs).toBe('T1·兵卒');
    expect(guardBioStrength('T1·兵卒', 'T3·勇士', '一阶·Lv.5', '希尔薇', ctx(brk)).bs).toBe('T2·精英');
  });
  it('降档无证据被驳回（棘轮）', () => {
    expect(guardBioStrength('T3·勇士', 'T0·杂鱼', '一阶·Lv.5', '希尔薇', ctx(plain)).bs).toBe('T3·勇士');
  });
  it('新值认不出 T 档且已有旧档 → 拒绝覆盖', () => {
    expect(guardBioStrength('T2·精英', '很强', '一阶·Lv.5', '希尔薇', ctx(plain)).bs).toBe('T2·精英');
  });
  it('无上下文仍做窗口夹（bs 锚不许越窗）', () => {
    expect(guardBioStrength(undefined, 'T9·源初', '二阶·Lv.15', '希尔薇', null).bs).toBe('T4·英雄');
  });
});

describe('guardAttrValue', () => {
  const base = { established: true, isPet: false, name: '希尔薇' };
  it('未建档的 `=` 是生成路径 → 放行', () => {
    expect(guardAttrValue({ cur: 5, desired: 48, op: '=', established: false, isPet: false, name: '希尔薇', ctx: ctx(plain) }).value).toBe(48);
  });
  it('已建档的 `=` 折算增量并按步长收敛（50→想写120 → 只挪一步）', () => {
    const r = guardAttrValue({ cur: 50, desired: 120, op: '=', ...base, ctx: ctx(plain) });
    expect(r.value).toBe(53);                                                          // step=max(2, round(50×5%))=3
    expect(r.note).toBeTruthy();
  });
  it('小幅 += 原样通过；大幅 += 被限步', () => {
    expect(guardAttrValue({ cur: 50, desired: 2, op: '+=', ...base, ctx: ctx(plain) }).value).toBe(52);
    expect(guardAttrValue({ cur: 50, desired: 40, op: '+=', ...base, ctx: ctx(plain) }).value).toBe(53);
  });
  it('下调需致残/削弱证据：无证据驳回，有证据放行（仍限步）', () => {
    expect(guardAttrValue({ cur: 50, desired: 10, op: '-=', ...base, ctx: ctx(plain) }).value).toBe(50);
    expect(guardAttrValue({ cur: 50, desired: 2, op: '-=', ...base, ctx: ctx(down) }).value).toBe(48);
  });
  it('突破证据 → 强事件步长放宽', () => {
    const r = guardAttrValue({ cur: 50, desired: 40, op: '+=', ...base, ctx: ctx(brk) });
    expect(r.value).toBe(50 + Math.max(ATTR_STEP_STRONG_BASE, Math.round(50 * 0.2)));  // 60
  });
  it('宠物/召唤物冻结：无主人投入证据一律驳回，有投入放行', () => {
    const pet = { established: true, isPet: true, name: '阿姆' };
    expect(guardAttrValue({ cur: 30, desired: 5, op: '+=', ...pet, ctx: ctx('阿姆趴在角落打盹。') }).value).toBe(30);
    expect(guardAttrValue({ cur: 30, desired: 2, op: '+=', ...pet, ctx: ctx('主角给阿姆喂下一枚淬体丹药，药力化开。') }).value).toBe(32);
  });
  it('无上下文（手动/迁移路径）不裁决', () => {
    expect(guardAttrValue({ cur: 50, desired: 120, op: '=', ...base, ctx: null }).value).toBe(120);
  });
});
