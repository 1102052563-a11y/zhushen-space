import { describe, it, expect, beforeEach } from 'vitest';
import { applyTrade, walletKey, escrowCoin, consumeCoin, refundCoinsForListing, settleHelloHistory } from './tradeClient';
import { useTrade } from '../store/tradeStore';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import type { TradeRecord } from './tradeProtocol';

// 交易行「成交自动转移 + 出价即托管货币」结算单测：
// 用真 store（itemStore.adjustCurrency/addItem、tradeStore.me）+ localStorage 垫片（物品托管/货币托管/applied）。

const ESCROW_KEY = 'drpg-trade-escrow';
const COIN_KEY = 'drpg-trade-coin-escrow';
const ZERO = { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } as const;

function rec(over: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'r1', listingId: 'L1', offerId: 'O1', item: { name: '九转还魂丹', category: '消耗品' },
    sellerId: 'chat:1', sellerName: 'A', buyerId: 'chat:2', buyerName: 'B',
    price: 80, currency: '乐园币', at: Date.now(), ...over,
  };
}
const setItemEscrow = (m: Record<string, unknown>) => localStorage.setItem(ESCROW_KEY, JSON.stringify(m));
const getItemEscrow = () => JSON.parse(localStorage.getItem(ESCROW_KEY) || '{}');
const setCoin = (m: Record<string, unknown>) => localStorage.setItem(COIN_KEY, JSON.stringify(m));
const getCoin = () => JSON.parse(localStorage.getItem(COIN_KEY) || '{}');
const coin = (over: Record<string, unknown> = {}) => ({ token: 't1', listingId: 'L1', offerId: 'O1', price: 80, currency: '乐园币', at: Date.now(), ...over });

describe('交易行 结算 + 货币托管', () => {
  beforeEach(() => {
    localStorage.clear();
    useTrade.setState({ me: null });
    useItems.setState({ items: [], currency: { ...ZERO } });
  });

  it('walletKey：魂币→灵魂钱币、乐园币→乐园币、未知→null', () => {
    expect(walletKey('乐园币')).toBe('乐园币');
    expect(walletKey('魂币')).toBe('灵魂钱币');
    expect(walletKey('金叶子')).toBeNull();
  });

  it('me 未就绪 / 旁观者 → 不结算', () => {
    applyTrade(rec());
    expect(useItems.getState().currency.乐园币).toBe(0);
    useTrade.setState({ me: { playerId: 'chat:9', name: '路人' } });
    applyTrade(rec());
    expect(useItems.getState().currency.乐园币).toBe(0);
    expect(useItems.getState().items.length).toBe(0);
  });

  it('escrowCoin：余额够→扣款+建托管；不够→false 不扣', () => {
    useItems.setState({ currency: { 乐园币: 100, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });
    expect(escrowCoin('t1', 'L1', 80, '乐园币')).toBe(true);
    expect(useItems.getState().currency.乐园币).toBe(20);          // 扣了 80
    expect(getCoin().t1.price).toBe(80);                           // 入托管
    expect(escrowCoin('t2', 'L1', 50, '乐园币')).toBe(false);      // 余额 20 < 50
    expect(useItems.getState().currency.乐园币).toBe(20);          // 未扣
    expect(getCoin().t2).toBeUndefined();
  });

  it('consumeCoin：中标→删托管不退款；refundCoinsForListing：落选→退款删', () => {
    setCoin({ t1: coin(), t2: coin({ token: 't2', listingId: 'L2', price: 30 }) });
    expect(consumeCoin('O1', 'L1', 80)).toBe(true);
    expect(getCoin().t1).toBeUndefined();                          // 消费
    expect(useItems.getState().currency.乐园币).toBe(0);           // 不退款（已付卖家）
    refundCoinsForListing('L2');
    expect(getCoin().t2).toBeUndefined();
    expect(useItems.getState().currency.乐园币).toBe(30);          // L2 落选 → 退回 30
  });

  it('卖家：消费托管物(不归还) + 收币', () => {
    useTrade.setState({ me: { playerId: 'chat:1', name: 'A' } });
    setItemEscrow({ tk1: { token: 'tk1', item: { name: '九转还魂丹' }, listingId: 'L1', at: Date.now() } });
    applyTrade(rec());
    expect(getItemEscrow()).toEqual({});                          // 托管物被消费
    expect(useItems.getState().currency.乐园币).toBe(80);          // 收币
    expect(useItems.getState().items.length).toBe(0);
  });

  it('买家：得物 + 消费货币托管(不二次扣款·钱在出价时已扣)', () => {
    useTrade.setState({ me: { playerId: 'chat:2', name: 'B' } });
    useItems.setState({ currency: { 乐园币: 20, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });   // 出价 80 已扣，余 20
    setCoin({ t1: coin() });                                      // 出价时托管的 80
    applyTrade(rec());
    expect(useItems.getState().items.some((it) => it.name === '九转还魂丹')).toBe(true);   // 得物
    expect(getCoin().t1).toBeUndefined();                         // 托管消费
    expect(useItems.getState().currency.乐园币).toBe(20);          // 不二次扣款
  });

  it('立即购买：record.offerId 为空 + 托管 offerId=null → 按 listingId+price 兜底消费、得物不二次扣款', () => {
    useTrade.setState({ me: { playerId: 'chat:2', name: 'B' } });
    useItems.setState({ currency: { 乐园币: 0, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });   // 买断时已扣，余 0
    setCoin({ b1: coin({ token: 'b1', offerId: null }) });        // 立即购买的托管（无 offerId）
    applyTrade(rec({ offerId: '' }));                             // 买断记录无中标 offerId
    expect(useItems.getState().items.some((it) => it.name === '九转还魂丹')).toBe(true);   // 得物
    expect(getCoin().b1).toBeUndefined();                        // 托管按 listingId+price 兜底消费
    expect(useItems.getState().currency.乐园币).toBe(0);          // 不二次扣款
  });

  it('买家：找不到货币托管 → 兜底现扣(≥0 钳制)', () => {
    useTrade.setState({ me: { playerId: 'chat:2', name: 'B' } });
    useItems.setState({ currency: { 乐园币: 100, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });
    applyTrade(rec({ price: 80 }));                               // 无托管
    expect(useItems.getState().currency.乐园币).toBe(20);          // 兜底扣 80
  });

  it('部分上架：扣 n 件 + 归还按名回堆，不覆盖剩余库存', () => {
    // 背包：可堆叠丹药 ×10。模拟 listItem 上架 3 件（consumeItem）→ 剩 7。
    useItems.setState({ items: [{ id: 'i1', name: '渡厄丹', category: '消耗品', quantity: 10, addedAt: 0 } as any], currency: { ...ZERO } });
    useItems.getState().consumeItem('i1', 3);
    expect(useItems.getState().items.find((it) => it.id === 'i1')?.quantity).toBe(7);
    // 模拟 returnItem 归还托管的 3 件：剥掉原 id → addItem 按名回堆（若带原 id 会命中「同 id 原地更新」把 7 覆盖成 3）。
    const snap = { id: 'i1', name: '渡厄丹', category: '消耗品', quantity: 3 };
    const { id: _omit, ...rest } = snap;
    useItems.getState().addItem({ ...rest } as any);
    const stacks = useItems.getState().items.filter((it) => it.name === '渡厄丹');
    expect(stacks.length).toBe(1);          // 仍是一条堆叠，没分裂
    expect(stacks[0].quantity).toBe(10);    // 回到 10，而非被覆盖成 3
  });

  it('随从/宠物成交：买家收到 _entity:npc 记录 → 物化进花名册（不走 addItem）', () => {
    useTrade.setState({ me: { playerId: 'chat:2', name: 'B' } });
    useNpc.setState({ npcs: {} });   // 清空花名册
    applyTrade(rec({
      id: 'rNpc', offerId: '', price: 0,
      item: {
        _entity: 'npc', name: '玄冰貂', npcTag: '宠物', tier: '三阶', realm: '三阶|宠物', profession: '灵兽',
        attrs: { str: 30, agi: 40, con: 25, int: 20, cha: 15, luck: 10 }, maxHp: 500, maxEp: 200, skills: [{ name: '冰咬' }],
      },
    }));
    const pets = Object.values(useNpc.getState().npcs) as any[];
    expect(pets.some((r) => r.name === '玄冰貂' && ['宠物', '召唤物', '随从'].includes(r.npcTag || ''))).toBe(true);
    expect(useItems.getState().items.length).toBe(0);   // NPC 不落背包
  });

  it('幂等：同一 record.id 不重复结算', () => {
    useTrade.setState({ me: { playerId: 'chat:1', name: 'A' } });
    setItemEscrow({ tk1: { token: 'tk1', item: { name: 'x' }, listingId: 'L1', at: Date.now() } });
    applyTrade(rec());
    applyTrade(rec());
    expect(useItems.getState().currency.乐园币).toBe(80);          // 只加一次
  });
});

const getApplied = () => JSON.parse(localStorage.getItem('drpg-trade-applied') || '[]');

// 跨存档残留根治：hello 重放服务器历史时，applied 空(新档/清档)→只记基线不交付；老档才补结算离线成交。
describe('settleHelloHistory（防交易行购买跨存档残留）', () => {
  beforeEach(() => {
    localStorage.clear();
    useTrade.setState({ me: { playerId: 'chat:2', name: 'B' } });   // 我是买家
    useItems.setState({ items: [], currency: { ...ZERO } });
  });

  it('★applied 空(新档/清档)：历史成交只记基线、不把过往购买灌进背包', () => {
    settleHelloHistory([rec()]);
    expect(useItems.getState().items.length).toBe(0);   // 不交付 → 不跨档残留
    expect(getApplied()).toContain('r1');               // 但标记为已见（基线）
  });

  it('老档(applied 非空)：hello 正常补结算离线期间的成交', () => {
    localStorage.setItem('drpg-trade-applied', JSON.stringify(['old-trade']));   // 本档已交易过
    useItems.setState({ currency: { 乐园币: 100, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });
    setCoin({ t1: coin() });                                                     // 出价时的托管
    settleHelloHistory([rec()]);
    expect(useItems.getState().items.some((it) => it.name === '九转还魂丹')).toBe(true);   // 交付
  });

  it('★基线后再次 hello 不重复交付（该成交已标记）', () => {
    settleHelloHistory([rec()]);                                                 // 首次：基线
    useItems.setState({ currency: { 乐园币: 100, 灵魂钱币: 0, 技能点: 0, 黄金技能点: 0 } });
    setCoin({ t1: coin() });
    settleHelloHistory([rec()]);                                                 // 再次(applied 已非空)→ r1 已 applied → 跳过
    expect(useItems.getState().items.length).toBe(0);
  });
});
