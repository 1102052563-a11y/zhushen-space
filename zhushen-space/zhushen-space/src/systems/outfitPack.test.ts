import { describe, it, expect } from 'vitest';
import { parseOutfitPack, mergePackTags } from './outfitPack';

// 👗📦 成衣包（Outfit-Manager 2.0 导出 JSON）解析：字段映射/去重键/标签合并/坏输入人话错。
describe('成衣包解析', () => {
  const pack = JSON.stringify({
    type: 'char',
    charName: '纯欲风2.0',
    categories: ['外出服', '常服'],
    outfits: [
      { id: 'aaa', name: '灰短款Polo衫配牛仔短裤', category: '外出服', type: 'outfit', style: '休闲', season: '夏', sceneTag: '外出', description: '灰色罗纹短款Polo衫搭配蓝色牛仔短裤', imageData: 'data:image/jpeg;base64,XXXX', createdAt: 1782302251784 },
      { id: 'bbb', name: '粉色蕾丝吊带连衣裙', category: '常服', type: 'outfit', style: '优雅、甜美', season: '春、夏', sceneTag: '约会、外出', description: '粉色吊带连衣裙，外搭白色毛绒外套', imageData: 'data:image/jpeg;base64,YYYY', createdAt: 1782302251791 },
      { id: 'ccc', name: '', description: '', imageData: 'data:image/jpeg;base64,ZZZZ' },   // 缺名+缺描述 → 跳过
    ],
  });

  it('解析：charName/条目映射/去重键/跳过空条目', () => {
    const r = parseOutfitPack(pack);
    expect(r.charName).toBe('纯欲风2.0');
    expect(r.outfits).toHaveLength(2);
    expect(r.skipped).toBe(1);
    const a = r.outfits[0];
    expect(a.key).toBe('纯欲风2.0#aaa');
    expect(a.name).toBe('灰短款Polo衫配牛仔短裤');
    expect(a.desc).toContain('灰色罗纹');
    expect(a.tags).toBe('外出服,休闲,夏,外出');
    expect(a.imageData.startsWith('data:image/')).toBe(true);
    const b = r.outfits[1];
    expect(b.tags).toBe('常服,优雅,甜美,春,夏,约会,外出');       // 顿号拆分合并
  });

  it('标签合并：拆分/去重/保序', () => {
    expect(mergePackTags({ category: '外出', sceneTag: '外出' })).toBe('外出');
    expect(mergePackTags({ style: '休闲/街头', season: '秋,冬' })).toBe('休闲,街头,秋,冬');
    expect(mergePackTags({})).toBe('');
  });

  it('坏输入抛人话错', () => {
    expect(() => parseOutfitPack('not json')).toThrow(/JSON/);
    expect(() => parseOutfitPack('{"foo":1}')).toThrow(/outfits/);
    expect(() => parseOutfitPack(JSON.stringify({ charName: 'x', outfits: [{}] }))).toThrow(/没有可导入/);
  });

  it('非 dataURL 图片链接不入 imageData（只认 data:image/）', () => {
    const r = parseOutfitPack(JSON.stringify({ charName: 'y', outfits: [{ id: 'a', name: '套', description: 'd', imageData: 'https://x/img.png' }] }));
    expect(r.outfits[0].imageData).toBe('');
  });
});
