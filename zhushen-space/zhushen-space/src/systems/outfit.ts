// 👗 衣柜助手：激活穿搭 = 服装的「单一权威源」，三条生图线共用读取口。
// 立绘：buildPortraitPrompt 的 charId 字段 → 覆盖 ${attire}/追加标签；
// 正文配图：App.genStoryImagesFor 的 charLine 追加 outfitRosterLine；
// 漫画：comic.buildRoster 追加 outfitRosterLine（分镜外观锁直接引用钦定穿搭）。
// 正文闭环：promptInjections.buildOutfitInjection 注入 <钦定穿搭>；AI 经 <state> `outfit.<id>=名` 换装（applyOutfitCommand）。
import { useOutfits, type OutfitRecord } from '../store/outfitStore';
import { useNpc } from '../store/npcStore';
import { outfitImageKey } from './outfitImages';

/** 某角色当前激活的穿搭；未钦定/无衣柜返回 null（调用方回退装备栏/外观描述）。 */
export function activeOutfit(charId?: string): OutfitRecord | null {
  if (!charId) return null;
  const w = useOutfits.getState().byChar[charId];
  if (!w || !w.activeId) return null;
  return w.outfits.find((o) => o.id === w.activeId) ?? null;
}

/** 穿搭参考图在 imageDb 里的 key（实现移居 systems/outfitImages——内存缓存模块作单一权威源；此处转发导出，旧调用点 import 路径不变）。 */
export { outfitImageKey };

/** 该角色激活穿搭的参考图（立绘/配图 chatimg 线随请求发送；无钦定/无图返回 []）。 */
export async function outfitRefImages(charId?: string): Promise<string[]> {
  const o = activeOutfit(charId);
  if (!o?.hasImage || !charId) return [];
  try {
    const { getImg } = await import('./imageDb');   // 动态引入避免测试环境无 IndexedDB 时模块级炸掉
    const img = await getImg(outfitImageKey(charId, o.id));
    return img && img.startsWith('data:image/') ? [img] : [];
  } catch { return []; }
}

/** 立绘提示词里配套的参考图说明（有参考图时拼在 prompt 尾）。
    硬约束措辞借鉴V3.2「最高优先级：本次替换服装」块——只换衣不换人。 */
export const OUTFIT_REF_HINT = '【参考图·钦定穿搭（最高优先）】随附一张该角色的钦定穿搭参考图——服装的款式/颜色/材质**严格以图为准，不自行改款**；本约束只作用于服装：人物的脸型、发型发色、瞳色、体型与身份**保持文字设定不变**，剧情上下文里的旧穿着一律让位于本穿搭。';

/* ── AI 换装指令（<state>）：`outfit.<角色ID> = 穿搭名`；名称/场景标签模糊命中；「无/none/脱下/取消/默认」=取消钦定。
   角色 ID 允许 AI 误用 NPC 名字：唯一同名时自动纠到真实 id（同物品 owner 解析款）。返回是否生效。 */
export function applyOutfitCommand(charRaw: string, nameRaw: string): boolean {
  const S = useOutfits.getState();
  const nrm = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
  let charId = String(charRaw || '').trim();
  if (charId !== 'B1' && !S.byChar[charId]) {
    const byName = Object.values(useNpc.getState().npcs).filter((r) => r.name && nrm(r.name) === nrm(charId));
    if (byName.length === 1) charId = byName[0].id;
  }
  const name = String(nameRaw || '').trim();
  if (!name || /^(无|none|off|脱下|取消|默认|跟随装备)$/i.test(name)) {
    if (S.byChar[charId]?.activeId) { S.setActive(charId, ''); console.log(`[Outfit] ${charId} 取消钦定穿搭`); }
    return true;
  }
  const w = S.byChar[charId];
  if (!w || !w.outfits.length) { console.warn(`[Outfit] ${charId} 没有衣柜/穿搭，忽略换装「${name}」`); return false; }
  const hit = w.outfits.find((o) => nrm(o.name) === nrm(name))
    || w.outfits.find((o) => nrm(o.name).includes(nrm(name)) || nrm(name).includes(nrm(o.name)))
    || w.outfits.find((o) => (o.tags || '').split(/[,，、\s]+/).some((t) => t && (nrm(t) === nrm(name) || nrm(name).includes(nrm(t)))));   // 场景标签命中：outfit.B1=战斗
  if (!hit) { console.warn(`[Outfit] ${charId} 衣柜里没有「${name}」，忽略（只能选已有穿搭）`); return false; }
  if (w.activeId !== hit.id) { S.setActive(charId, hit.id); console.log(`[Outfit] ${charId} 换装 →「${hit.name}」`); }
  return true;
}

/** roster 行追加文案（正文配图/漫画共用）：钦定穿搭描述+服装标签；无激活穿搭返回 ''。
    硬约束措辞借鉴V3.2：高于剧情上下文旧穿着，且只换衣不换人。 */
export function outfitRosterLine(charId?: string): string {
  const o = activeOutfit(charId);
  if (!o) return '';
  const parts = [`钦定穿搭「${o.name}」（服装以此为准·最高优先·高于剧情上下文里的旧穿着；只作用于服装——脸型/发型发色/体型/身份照旧设定，不自行改款）：${o.desc}`];
  if (o.imageTags.trim()) parts.push(`服装标签：${o.imageTags.trim()}`);
  return parts.join('；');
}
