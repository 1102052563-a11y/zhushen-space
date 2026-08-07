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

  it('P1 可见性门：hidden 整条不进正文且不占名额；trace 只给表象不给事件名；秘闻附知情边界', () => {
    useMisc.setState({
      paradiseTime: '轮回历3年',
      worldEvents: [
        { id: 'W_1', time: '第1日', location: '', desc: '最早的事' },
        { id: 'W_2', time: '第2日', location: '内城', desc: '幕后密谋中', name: '刺杀行动', visibility: 'hidden' },
        { id: 'W_3', time: '第3日', location: '城南', desc: '实为布防内情', name: '布防调整', visibility: 'trace', publicTrace: '卫兵换岗突然加倍' },
        { id: 'W_4', time: '第4日', location: '王都', desc: '全城筹备庆典', name: '秋收庆典', knownBy: '林澈' },
      ],
    } as never);
    const out = text(buildWorldTimeInjection());
    expect(out).not.toContain('刺杀行动');
    expect(out).not.toContain('幕后密谋');
    expect(out).not.toContain('布防调整');          // trace 连名字都不给
    expect(out).toContain('卫兵换岗突然加倍');
    expect(out).toContain('最早的事');               // hidden 不占 3 条名额 → W_1 顶上
    expect(out).toContain('仅 林澈 知情');
  });

  it('P1 显露递交：已落幕待显露事件出「镜头外已落幕」块；hidden/已显露不出', () => {
    useMisc.setState({
      paradiseTime: '轮回历3年',
      worldEvents: [
        { id: 'W_1', time: '', location: '', desc: '', name: '漕帮火并', settledAt: 100, reveal: { state: 'pending', attempts: 0 }, chain: [{ date: 'd', text: '【落幕】北堂覆灭' }] },
        { id: 'W_2', time: '', location: '', desc: '密事', name: '密约', visibility: 'hidden', settledAt: 100 },
        { id: 'W_3', time: '', location: '', desc: '旧闻', name: '旧案', settledAt: 100, reveal: { state: 'delivered', attempts: 1 } },
      ],
    } as never);
    const out = text(buildWorldTimeInjection());
    expect(out).toContain('镜头外已落幕');
    expect(out).toContain('漕帮火并');
    expect(out).toContain('北堂覆灭');
    expect(out).not.toContain('密约');
    expect(out).not.toContain('旧案');
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
