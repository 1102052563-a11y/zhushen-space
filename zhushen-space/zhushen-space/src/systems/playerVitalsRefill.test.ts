import { describe, it, expect } from 'vitest';
import { refillAllVitals, playerMaxHp, playerMaxEp } from './playerVitals';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';

describe('refillAllVitals 一键回满（治"队友 400/4000 残疾、刷新也回不满"）', () => {
  it('主角回满到上限；在场/常驻队友回满；满世界路人不动', () => {
    useGame.setState((s) => ({ player: { ...s.player, hp: 1, mp: 1 } }));
    useNpc.setState({ npcs: {
      C1: { id: 'C1', name: '在场队友', onScene: true, isDead: false, hp: 400, mp: 10, maxHp: 4000, maxMp: 100, items: [] },
      C2: { id: 'C2', name: '满世界路人', onScene: false, isDead: false, hp: 50, mp: 5, maxHp: 1000, maxMp: 50, items: [] },
      C3: { id: 'C3', name: '常驻队友', keepForever: true, isDead: false, hp: 200, mp: 0, maxHp: 2000, maxMp: 80, items: [] },
      C4: { id: 'C4', name: '死掉的', onScene: true, isDead: true, hp: 0, mp: 0, maxHp: 500, maxMp: 50, items: [] },
    } } as any);

    const r = refillAllVitals();

    expect(r.team).toBe(2);                                   // C1(onScene) + C3(keepForever)，不含路人/死者
    expect(useGame.getState().player.hp).toBe(playerMaxHp()); // 主角满
    expect(useGame.getState().player.mp).toBe(playerMaxEp());
    expect(useNpc.getState().npcs.C1.hp).toBe(4000);          // 在场队友满
    expect(useNpc.getState().npcs.C1.mp).toBe(100);
    expect(useNpc.getState().npcs.C3.hp).toBe(2000);          // 常驻队友满
    expect(useNpc.getState().npcs.C2.hp).toBe(50);            // 路人不动
    expect(useNpc.getState().npcs.C4.hp).toBe(0);             // 死者不动
  });

  it('有六维的队友回满到真实上限（六维+装备上限加成），而非陈旧的存储 maxHp', () => {
    useNpc.setState({ npcs: {
      C9: { id: 'C9', name: '披甲队友', onScene: true, isDead: false, hp: 100, mp: 10,
        maxHp: 200, maxMp: 75,   // 陈旧缓存：换装前的旧上限（曾按它回满 → 装备加成形同虚设）
        realm: '三阶·Lv.25',
        attrs: { str: 5, agi: 5, con: 10, int: 5, cha: 5, luck: 5 },
        items: [{ id: 'i1', name: '巨龙胸甲', equipped: true, effect: '生命值上限+1000' }] },
    } } as any);

    refillAllVitals();

    const c9 = useNpc.getState().npcs.C9;
    expect(c9.hp).toBe(1200);      // 体10×20=200 + 装备平值+1000
    expect(c9.maxHp).toBe(1200);   // 存储上限缓存同步刷新
    expect(c9.mp).toBe(75);        // 智5×15
    expect(c9.maxMp).toBe(75);
  });
});
