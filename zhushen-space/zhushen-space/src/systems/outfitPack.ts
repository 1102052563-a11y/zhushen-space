/* ════════════════════════════════════════════
   👗📦 成衣包解析——纯函数（可单测·不碰 IndexedDB）。
   源格式=ST 插件 Outfit-Manager 2.0 的角色导出 outfit-mgr-char-*.json
   （github gabby1111111111/Outfit-Manager·无 LICENSE=只借格式思想，代码自写）：
   { type:'char'|'user', charName, outfits:[{ id,name,category,type,style,season,sceneTag,description,imageData,createdAt }], categories[] }
   映射到本项目：description→desc；category/style/season/sceneTag→场景标签合并（AI 换装指令按标签可命中）；
   imageData(dataURL·原图~100KB/张)→由导入器压缩(768)后入 outfitPackDb（跨存档成衣库）。
════════════════════════════════════════════ */

export interface PackOutfit {
  key: string;        // 去重键：<charName>#<源id>——重复导入同一包自动跳过
  sourceId: string;
  name: string;
  desc: string;
  tags: string;       // category/style/season/sceneTag 合并（逗号分隔·去重·≤10个）
  imageData: string;  // 原始 dataURL（可空；导入器压缩后入库）
  createdAt: number;  // 源时间戳（无则 0，导入器补当前时间）
}
export interface ParsedPack { charName: string; outfits: PackOutfit[]; skipped: number }

const splitTokens = (s: unknown): string[] =>
  String(s ?? '').split(/[、，,/;；|\s]+/).map((x) => x.trim()).filter(Boolean);

/** category/style/season/sceneTag → 合并成场景标签串（去重·保序·≤10 个 token）。 */
export function mergePackTags(o: { category?: unknown; style?: unknown; season?: unknown; sceneTag?: unknown }): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...splitTokens(o.category), ...splitTokens(o.style), ...splitTokens(o.season), ...splitTokens(o.sceneTag)]) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out.join(',').slice(0, 60);
}

/** 解析导出 JSON 文本。格式不对抛人话错；条目缺名称+描述则跳过（计入 skipped）。 */
export function parseOutfitPack(jsonText: string): ParsedPack {
  let root: any;
  try { root = JSON.parse(jsonText); } catch { throw new Error('不是有效的 JSON 文件'); }
  const list = Array.isArray(root?.outfits) ? root.outfits : null;
  if (!list) throw new Error('缺少 outfits 数组——请选择 Outfit-Manager 导出的 outfit-mgr-char-*.json');
  const charName = String(root?.charName ?? '').trim() || '导入包';
  const outfits: PackOutfit[] = [];
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i] ?? {};
    const name = String(o.name ?? '').trim();
    const desc = String(o.description ?? o.desc ?? '').trim();
    if (!name && !desc) { skipped++; continue; }
    const sourceId = String(o.id ?? '').trim() || `idx${i}`;
    const img = typeof o.imageData === 'string' && o.imageData.startsWith('data:image/') ? o.imageData : '';
    outfits.push({
      key: `${charName}#${sourceId}`,
      sourceId,
      name: (name || desc.slice(0, 16)).slice(0, 24),
      desc: desc.slice(0, 600),
      tags: mergePackTags(o),
      imageData: img,
      createdAt: Number(o.createdAt) || 0,
    });
  }
  if (!outfits.length) throw new Error('包里没有可导入的穿搭（每条至少要有名称或描述）');
  return { charName, outfits, skipped };
}
