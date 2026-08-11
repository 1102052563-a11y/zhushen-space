import { describe, it, expect, beforeEach } from 'vitest';
import { snapshotImages, liveEntityImageKeys, isSnapshotImageKey } from './imageSync';
import { allOutfitImgs, clearOutfitImgCache, hydrateOutfitImgs, outfitImageKey } from './outfitImages';
import { useOutfits } from '../store/outfitStore';
import { useJoy } from '../store/joyStore';
import { useEnhance } from '../store/enhanceStore';
import { useShop } from '../store/shopStore';

// 🖼 读档丢图修复（2026-08-11）的三根柱子：快照域判定 / 衣柜图并进快照 / 全局域图防「清理孤儿图」误删。
// 不碰 IndexedDB（node 环境没有）——只测内存缓存与纯函数口径。
describe('imageSync（图片快照域与孤儿判定）', () => {
  beforeEach(() => {
    clearOutfitImgCache();
    useOutfits.getState().clearAll();
  });

  it('isSnapshotImageKey：快照域含 outfit:；全局配置域(joy/enhance/shop)不在其列', () => {
    for (const k of ['player', 'npc:C1', 'npcitem:C1:I1', 'item:I1', 'map:main:n1', 'outfit:B1:of1']) {
      expect(isSnapshotImageKey(k), k).toBe(true);
    }
    for (const k of ['joy-girl:g1', 'enhance-boss:b1', 'shop-sign:s1', 'shop-good:g1', 'shop-girl:s1', 'shop-smith:s1']) {
      expect(isSnapshotImageKey(k), k).toBe(false);
    }
  });

  it('衣柜参考图经内存缓存并进存档快照；hydrate 只吃 outfit: 前缀、空值不吃', () => {
    hydrateOutfitImgs({
      'outfit:B1:of1': 'data:image/jpeg;base64,AA',
      'joy-girl:g1': 'data:image/jpeg;base64,BB',   // 非 outfit: 前缀 → 不进缓存
      'outfit:C2:of2': '',                           // 空值 → 不进缓存
    });
    expect(allOutfitImgs().size).toBe(1);
    const snap = snapshotImages();
    expect(snap['outfit:B1:of1']).toBe('data:image/jpeg;base64,AA');   // 快照带衣柜图 → 读档 bulkPutImg 原样回来
    expect(snap['joy-girl:g1']).toBeUndefined();                       // 全局配置域不进快照
  });

  it('liveEntityImageKeys：衣柜/欢愉宫/强化老板/店铺四类图都算 live（防「清理孤儿图」误删）', () => {
    const oid = useOutfits.getState().addOutfit('B1', { name: '常服', desc: '灰色风衣', tags: '', imageTags: '' });
    useJoy.setState((s: any) => ({ settings: { ...s.settings, girls: [{ ...s.settings.girls[0], id: 'g_test' }] } }));
    useEnhance.setState((s: any) => ({ settings: { ...s.settings, bosses: [{ ...s.settings.bosses[0], id: 'boss_test' }] } }));
    useShop.setState({
      shops: [{ id: 'shop1', kind: 'smithy', name: '铁匠铺', goods: [{ id: 'good1', name: '货' }], girls: [{ id: 'girl1', name: '姑娘' }] }],
    } as any);
    const live = liveEntityImageKeys();
    expect(live.has(outfitImageKey('B1', oid))).toBe(true);   // 刻意不看 hasImage（标记漂了也不误删）
    expect(live.has('joy-girl:g_test')).toBe(true);
    expect(live.has('enhance-boss:boss_test')).toBe(true);
    for (const k of ['shop-sign:shop1', 'shop-smith:shop1', 'shop-good:good1', 'shop-girl:girl1']) {
      expect(live.has(k), k).toBe(true);
    }
  });

  it('实体删了图才算孤儿：删掉穿搭后其 key 不再 live', () => {
    const oid = useOutfits.getState().addOutfit('B1', { name: '甲', desc: 'a', tags: '', imageTags: '' });
    expect(liveEntityImageKeys().has(outfitImageKey('B1', oid))).toBe(true);
    useOutfits.getState().removeOutfit('B1', oid);
    expect(liveEntityImageKeys().has(outfitImageKey('B1', oid))).toBe(false);
  });
});
