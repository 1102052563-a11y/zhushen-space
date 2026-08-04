import { describe, it, expect, beforeEach } from 'vitest';
import { buildWorldTimeInjection, buildFacilityInjection } from './promptInjections';
import { useMisc } from '../store/miscStore';
import { useCasino } from '../store/casinoStore';
import { useAbyss } from '../store/abyssStore';
import { useShop } from '../store/shopStore';
import { usePlayer } from '../store/playerStore';

/* P2 叙事读回：<当前时空> 补天气/世界大事（治"misc 每回合生成天气、正文永远读不回"），
   <设施近况> 常驻一行注入（赌坊/深渊/产业长期足迹此前完全游离于叙事外）。 */

const text = (blocks: { content: string }[]) => blocks.map((b) => b.content).join('\n');

beforeEach(() => {
  useMisc.setState({ paradiseTime: '', worldTime: '', worldName: '', weather: '', worldEvents: [] } as never);
  useCasino.setState({ stats: { hands: 0, wagered: 0, won: 0, lost: 0, biggestWin: 0, winStreak: 0, loseStreak: 0, bestWinStreak: 0 } } as never);
  useAbyss.setState({ meta: { ...(useAbyss.getState() as any).meta, deepestFloor: 0, clearsCount: 0 } } as never);
  useShop.setState({ shops: [] } as never);
});

describe('buildWorldTimeInjection（天气+世界大事读回）', () => {
  it('★天气闭环：misc 写的天气进 <当前时空>', () => {
    useMisc.setState({ paradiseTime: '轮回历3年', weather: '血色暴雨' } as never);
    const out = text(buildWorldTimeInjection());
    expect(out).toContain('天气:血色暴雨');
  });

  it('★世界大事回流：近 3 条带进块内，每条截断', () => {
    useMisc.setState({
      paradiseTime: '轮回历3年',
      worldEvents: [
        { id: 'W_1', time: '第1日', location: '王都', desc: '旧闻' },
        { id: 'W_2', time: '第3日', location: '港口', desc: '舰队集结' },
        { id: 'W_3', time: '第5日', location: '', desc: 'A'.repeat(120) },
        { id: 'W_4', time: '第7日', location: '内城', desc: '戒严开始' },
      ],
    } as never);
    const out = text(buildWorldTimeInjection());
    expect(out).toContain('近期世界大事');
    expect(out).not.toContain('旧闻');            // 只取最近 3 条
    expect(out).toContain('舰队集结');
    expect(out).toContain('戒严开始');
    expect(out).not.toContain('A'.repeat(61));    // 60 字截断
  });

  it('无天气无大事 → 不出对应行/段（块本身照旧）', () => {
    useMisc.setState({ paradiseTime: '轮回历3年' } as never);
    const out = text(buildWorldTimeInjection());
    expect(out).not.toContain('天气:');
    expect(out).not.toContain('近期世界大事');
  });
});

describe('buildFacilityInjection（设施近况常驻注入）', () => {
  it('全空 → 不出块（零预算占用）', () => {
    expect(buildFacilityInjection()).toHaveLength(0);
  });

  it('★赌坊玩过/深渊下过/开着产业 → 各一行', () => {
    useCasino.setState({ stats: { hands: 9, wagered: 5000, won: 3000, lost: 1000, biggestWin: 800, winStreak: 0, loseStreak: 0, bestWinStreak: 4 } } as never);
    useAbyss.setState({ meta: { ...(useAbyss.getState() as any).meta, deepestFloor: 12, clearsCount: 1 } } as never);
    useShop.setState({ shops: [{ id: 's1', name: '铁匠铺·星火' }, { id: 's2', name: '杂货铺' }] } as never);
    usePlayer.getState().setProfile({ tier: '六阶', level: 55 });   // 五阶+ → 显示真名「深渊」
    const out = text(buildFacilityInjection());
    expect(out).toContain('赌坊战绩');
    expect(out).toContain('深渊地牢:最深抵达第12层·通关1次');
    expect(out).toContain('名下产业:铁匠铺·星火、杂货铺');
  });

  it('★五阶前深渊行按封印口径称「幽冥地牢」', () => {
    useAbyss.setState({ meta: { ...(useAbyss.getState() as any).meta, deepestFloor: 3, clearsCount: 0 } } as never);
    usePlayer.getState().setProfile({ tier: '一阶', level: 1 });
    const out = text(buildFacilityInjection());
    expect(out).toContain('幽冥地牢:最深抵达第3层');
    expect(out).not.toContain('深渊地牢');
  });
});
