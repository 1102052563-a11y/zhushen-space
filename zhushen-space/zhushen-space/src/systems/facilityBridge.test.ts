import { describe, it, expect, beforeEach } from 'vitest';
import { reportFacilityOutcome } from './facilityBridge';
import { drainSceneNotices, drainGrowthNotices, drainFacilityGranted } from './allocNotice';

/* 设施→正文统一接入口：一次调用扇出到 场外通报 / 发放登记 / 成长交代 三条既有桥。 */

beforeEach(() => { drainSceneNotices(); drainGrowthNotices(); drainFacilityGranted(); });   // 清空模块级缓冲

describe('reportFacilityOutcome（设施统一上报）', () => {
  it('★summary → 场外通报，带统一前缀与守卫语', () => {
    reportFacilityOutcome({ source: '赌坊', summary: '福袋扭蛋开出「幸运符」×1' });
    const notices = drainSceneNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('【场外·赌坊】');
    expect(notices[0]).toContain('福袋扭蛋开出「幸运符」×1');
    expect(notices[0]).toContain('勿重复发放/结算');
  });

  it('granted → 发放登记（物品阶段勿再建），去重', () => {
    reportFacilityOutcome({ source: '深渊', summary: '带出战利品', granted: ['噬魂之刃', '噬魂之刃', '复元灵药'] });
    expect(drainFacilityGranted()).toEqual(['噬魂之刃', '复元灵药']);
  });

  it('growth → 成长交代（单条/多条都认）', () => {
    reportFacilityOutcome({ source: '赌坊', summary: '战绩结算', growth: '因赌坊连胜获得称号「赌圣」' });
    reportFacilityOutcome({ source: '深渊', summary: '觉醒', growth: ['装备「黑刃」觉醒至+2档', '获得称号「堕落行者」'] });
    const g = drainGrowthNotices();
    expect(g).toHaveLength(3);
    expect(g[0]).toContain('赌圣');
  });

  it('summary 为空 → 不产生场外通报（只登记 granted/growth）', () => {
    reportFacilityOutcome({ source: '竞技场', summary: '', granted: ['冠军奖杯'] });
    expect(drainSceneNotices()).toHaveLength(0);
    expect(drainFacilityGranted()).toEqual(['冠军奖杯']);
  });

  it('自定义守卫语覆盖默认', () => {
    reportFacilityOutcome({ source: '仓库', summary: '存入 3 件装备', guard: '这些物品已离开背包，勿在正文中当作仍持有' });
    expect(drainSceneNotices()[0]).toContain('已离开背包');
  });
});
