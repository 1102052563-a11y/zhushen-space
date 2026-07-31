// 🖼 生成图片库：聚合全部「已生成/已上传」图片，按名字分组浏览（只读投影，不新增存储）。
// 数据源：角色=player/npc.avatar（当前立绘）· 装备=InventoryItem.image/NpcOwnedItem.image（按物品名分组）
//        正文配图=chatDb 消息行携带的 images[]（StoryImage，含提示词，按楼层新→旧）· 漫画=comicDb（自成一类，一批一组）。
// 注：角色/装备图重生成会原位覆盖（store 只留当前版），正文配图与漫画天然留历史。
import { loadAll } from './chatDb';
import { listBatches, pagesOfBatch } from './comicDb';
import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import type { StoryImage } from './narrativeHtml';

export type GalleryKind = 'char' | 'equip' | 'story' | 'comic';
export const GALLERY_KINDS: { key: GalleryKind; label: string }[] = [
  { key: 'char', label: '角色' },
  { key: 'equip', label: '装备/物品' },
  { key: 'story', label: '正文配图' },
  { key: 'comic', label: '漫画' },
];

export interface GalleryImage { url: string; caption: string; prompt?: string }
export interface GalleryGroup { key: string; name: string; kind: GalleryKind; images: GalleryImage[] }

const isImg = (u: unknown): u is string => typeof u === 'string' && (u.startsWith('data:image/') || /^https?:\/\//.test(u));

/** 汇总全部图片分组：角色（一人一组）→ 装备（一物一组）→ 正文配图（一组·楼层新→旧）→ 漫画（一批一组）。 */
export async function collectGallery(opts: { storyLimit?: number } = {}): Promise<GalleryGroup[]> {
  const groups: GalleryGroup[] = [];

  // ── 角色（主角在前，NPC 按在场→其余；已亡故标注）──
  const p = usePlayer.getState().profile;
  if (p?.name && isImg(p.avatar)) groups.push({ key: 'char:B1', name: p.name, kind: 'char', images: [{ url: p.avatar!, caption: '主角立绘' }] });
  const npcs = Object.values(useNpc.getState().npcs).filter((r) => r.name && isImg(r.avatar));
  npcs.sort((a, b) => Number(b.onScene ?? false) - Number(a.onScene ?? false));
  for (const r of npcs) {
    groups.push({ key: `char:${r.id}`, name: r.name, kind: 'char', images: [{ url: r.avatar!, caption: r.isDead ? '立绘 · 已亡故' : '立绘' }] });
  }

  // ── 装备/物品（同名合并一组：主角背包 + 各 NPC 持有物）──
  const equipMap = new Map<string, GalleryImage[]>();
  const pushEquip = (name: string, url: string, owner: string) => {
    const arr = equipMap.get(name) ?? [];
    if (!arr.some((x) => x.url === url)) arr.push({ url, caption: owner });
    equipMap.set(name, arr);
  };
  for (const it of useItems.getState().items) if (it.name && isImg(it.image)) pushEquip(it.name, it.image!, '主角持有');
  for (const r of Object.values(useNpc.getState().npcs)) {
    for (const it of r.items ?? []) if (it.name && isImg(it.image)) pushEquip(it.name, it.image!, `${r.name} 持有`);
  }
  for (const [name, images] of equipMap) groups.push({ key: `equip:${name}`, name, kind: 'equip', images });

  // ── 正文配图（chatDb 消息行自带 images[]·带当时的生图提示词；新楼在前，默认最多 150 张防内存爆）──
  const storyLimit = Math.max(1, opts.storyLimit ?? 150);
  try {
    const rows = await loadAll();
    const story: GalleryImage[] = [];
    for (let i = rows.length - 1; i >= 0 && story.length < storyLimit; i--) {
      const imgs = (rows[i] as { images?: StoryImage[] }).images;
      if (!Array.isArray(imgs)) continue;
      for (const im of imgs) {
        if (!isImg(im?.url)) continue;
        story.push({ url: im.url, caption: `楼${i + 1}`, prompt: im.prompt || undefined });
        if (story.length >= storyLimit) break;
      }
    }
    if (story.length) groups.push({ key: 'story', name: '正文配图', kind: 'story', images: story });
  } catch { /* chatDb 读失败不拖累其它分类 */ }

  // ── 漫画（自成一类：一批=一组，页序排列，带每页实际提示词）──
  try {
    for (const b of await listBatches()) {
      const pages = await pagesOfBatch(b.id);
      if (!pages.length) continue;
      groups.push({
        key: `comic:${b.id}`,
        name: `《${b.title}》`,
        kind: 'comic',
        images: pages.map((pg) => ({ url: pg.dataUrl, caption: `第 ${pg.page}/${b.pageTotal} 页`, prompt: pg.finalPrompt || pg.pagePrompt || undefined })),
      });
    }
  } catch { /* comicDb 读失败不拖累其它分类 */ }

  return groups;
}
