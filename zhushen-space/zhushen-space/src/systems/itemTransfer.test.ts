import { describe, it, expect, beforeEach } from 'vitest';
import { movePlayerItemToNpc, moveNpcItemToPlayer } from './itemTransfer';
import { useItems, type SocketedGem } from '../store/itemStore';
import { useNpc } from '../store/npcStore';

/* 主角 ⇄ NPC 物品转移的**机械字段保真**。
   背景：`NpcOwnedItem` 长期缺 `equipSet`（锻造套装归属），转移时字段被静默剥掉 →
   送给随从的套装部件到手就成散件、NPC 套装永不激活（战斗与正文都算不到）。
   宝石/强化同理：丢一个字段，装备到对方手里就变白板。 */

const GEM: SocketedGem = {
  gemId: 'g1', name: '紫色·福运石', tier: '紫色', slot: '通用',
  attr: '幸运', statText: '幸运+5', high: false, set: 'fortune',
};

function seedPlayerItem() {
  useItems.getState().addItem({
    name: '余烬护手', category: '防具', gradeDesc: '暗紫色', effect: '【镶嵌加成：幸运+5】',
    quantity: 1, equipped: false, tags: [],
    enhanceLevel: 9, equipSet: 'es_ember', sockets: 2, gems: [GEM],
  } as never);
  return useItems.getState().items.find((it) => it.name === '余烬护手')!;
}

describe('itemTransfer（主角⇄NPC 转移保真：套装/宝石/强化不掉）', () => {
  beforeEach(() => {
    useItems.setState({ items: [] });
    useNpc.setState({ npcs: {} });
    useNpc.getState().upsertNpc('C1', { id: 'C1', name: '薇妮', favor: 90 } as never);
  });

  it('给 NPC → 强化等级/套装归属/镶嵌宝石全部随件过户', () => {
    const src = seedPlayerItem();
    expect(movePlayerItemToNpc('C1', src.id).ok).toBe(true);

    const owned = (useNpc.getState().npcs['C1'].items ?? []).find((it) => it.name === '余烬护手')!;
    expect(owned).toBeTruthy();
    expect(owned.equipSet).toBe('es_ember');        // ⚠核心：套装归属不丢，NPC 穿齐才能激活
    expect(owned.enhanceLevel).toBe(9);
    expect(owned.sockets).toBe(2);
    expect(owned.gems?.[0]?.name).toBe('紫色·福运石');
    expect(owned.gems?.[0]?.set).toBe('fortune');
    expect(useItems.getState().items.find((it) => it.name === '余烬护手')).toBeUndefined();   // 源已扣
  });

  it('从 NPC 取回 → 同样不掉字段（来回搬不掉套）', () => {
    const src = seedPlayerItem();
    movePlayerItemToNpc('C1', src.id);
    const owned = (useNpc.getState().npcs['C1'].items ?? [])[0];
    expect(moveNpcItemToPlayer('C1', owned.id).ok).toBe(true);

    const back = useItems.getState().items.find((it) => it.name === '余烬护手')!;
    expect(back.equipSet).toBe('es_ember');
    expect(back.enhanceLevel).toBe(9);
    expect(back.gems?.[0]?.set).toBe('fortune');
  });

  it('好感不足 → 拒绝取走（原有门禁不受影响）', () => {
    const src = seedPlayerItem();
    movePlayerItemToNpc('C1', src.id);
    useNpc.getState().upsertNpc('C1', { favor: 10 } as never);
    const owned = (useNpc.getState().npcs['C1'].items ?? [])[0];
    const r = moveNpcItemToPlayer('C1', owned.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('好感不足');
  });
});
