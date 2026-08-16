/* ════════════════════════════════════════════
   👗🎨 试衣间（形象工坊系统层）：任意角色（B1=主角 / C×=NPC）的「基础形象 + 指定穿搭」→ 生图预览。
   - charLook：读取角色当前形象（生图参数 + 面板展示摘要）——形象工坊「读取当前人物形象」的单一入口；
   - buildTryOnPrompt：buildPortraitPrompt(outfitOverride) —— 不必激活衣柜即可预览任意一套；
   - generateTryOnImage：走 portraitService 同路由；参考图=角色现有立绘/头像（锁脸·仅 chatimg 多模态线生效），
     返回已压缩(768) dataURL，由面板决定存进哪套穿搭（outfitImgSet）；
   - 立绘提示词（avatarPrompt）读/存/按新词重生成——与 PlayerSidebar/NpcDetail「编辑提示词→重新生成」
     同一持久化字段（playerStore.profile.avatarPrompt / npc.avatarPrompt），工坊只是把入口集中。
════════════════════════════════════════════ */
import { generateImage, buildPortraitPrompt, equippedForPrompt, shrinkDataUrl } from './imageGen';
import { activeOutfit, outfitRefImages } from './outfit';
import { useImageGen } from '../store/imageGenStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { useItems } from '../store/itemStore';
import { realmFromLevel } from './derivedStats';
import type { OutfitRecord } from '../store/outfitStore';

export interface CharLookRow { label: string; value: string }
export interface CharLook {
  charId: string;
  name: string;
  avatar: string;    // 现有立绘/头像 dataURL（可空）
  attire: string;    // 当前穿着描述（衣柜「从当前穿着导入」预填：主角=外观描述 / NPC=appearance5 穿着段）
  rows: CharLookRow[];                                  // 「当前形象」展示区（只列非空项）
  params: Parameters<typeof buildPortraitPrompt>[0];    // 立绘提示词重建参数（含 charId）
}

/** 形象工坊左侧角色列：主角 + 全部未归档/未冻结 NPC（在场优先）。 */
export function listWardrobeChars(): { id: string; name: string; avatar: string; hint: string; dead?: boolean }[] {
  const p = usePlayer.getState().profile;
  const out: { id: string; name: string; avatar: string; hint: string; dead?: boolean }[] = [
    { id: 'B1', name: p.name || '主角', avatar: p.avatar || '', hint: '主角' },
  ];
  const npcs = Object.values(useNpc.getState().npcs).filter((n) => !n.archived && !n.frozenAt);
  npcs.sort((a, b) => Number(b.onScene) - Number(a.onScene) || String(a.name).localeCompare(String(b.name), 'zh'));
  for (const n of npcs) {
    out.push({ id: n.id, name: n.name, avatar: n.avatar || '', hint: [n.onScene ? '在场' : '离场', n.npcTag || ''].filter(Boolean).join('·'), dead: !!n.isDead });
  }
  return out;
}

/** 读取角色当前形象。找不到角色返回 null。 */
export function charLook(charId: string): CharLook | null {
  const rowsOf = (pairs: [string, string | undefined][]): CharLookRow[] =>
    pairs.map(([label, value]) => ({ label, value: String(value ?? '').trim() })).filter((r) => r.value);
  if (charId === 'B1') {
    const p = usePlayer.getState().profile;
    const equip = equippedForPrompt(useItems.getState().items);
    const o = activeOutfit('B1');
    return {
      charId, name: p.name || '主角', avatar: p.avatar || '', attire: (p.appearance || '').trim(),
      rows: rowsOf([
        ['基底外观', p.baseAppearance],
        ['外观描述', p.appearance],
        ['装备穿戴', equip],
        ['激活穿搭', o ? `「${o.name}」${o.desc}` : '（未钦定·跟随装备栏/外观）'],
        ['生图标签', p.imageTags],
      ]),
      params: {
        gender: p.gender, race: p.race, appearance: p.appearance, baseAppearance: p.baseAppearance, bodyType: p.bodyType,
        equipment: equip, profession: p.profession, tier: realmFromLevel(p.level), imageTags: p.imageTags, charId: 'B1',
      },
    };
  }
  const n = useNpc.getState().npcs[charId];
  if (!n) return null;
  const seg = String(n.appearance5 ?? '').split('|').map((x) => x.trim());   // 动作|穿着|位置|身段|样貌
  const [action = '', attire5 = '', location = '', figure = '', look = ''] = seg;
  const appearance = [look, figure, attire5, n.appearanceDetail].filter(Boolean).join('，');
  const equip = equippedForPrompt(n.items);
  const tier = String(n.realm ?? '').split('·')[0].trim();
  const o = activeOutfit(charId);
  return {
    charId, name: n.name, avatar: n.avatar || '', attire: attire5,
    rows: rowsOf([
      ['基底外观', n.baseAppearance],
      ['样貌', look],
      ['身段', figure],
      ['当前穿着', attire5],
      ['装备穿戴', equip],
      ['激活穿搭', o ? `「${o.name}」${o.desc}` : '（未钦定·跟随装备栏/外观）'],
      ['生图标签', n.imageTags],
    ]),
    params: {
      gender: n.gender, age: n.age, appearance, baseAppearance: n.baseAppearance, bodyType: n.bodyType,
      equipment: equip, profession: n.profession, tier, npcTag: n.npcTag, imageTags: n.imageTags,
      action, attire: attire5, location, figure, appearanceDetails: n.appearanceDetail, charId,
    },
  };
}

/** 试衣参考图说明（有角色现有立绘时拼在提示词尾·只锁人不锁衣，与 OUTFIT_REF_HINT 相反方向）。 */
export const TRYON_FACE_HINT = '【参考图·角色本人（锁长相）】随附一张该角色现有立绘——脸型、发型发色、瞳色、体型**严格以图为准**；但**不要参考图中的旧服装**，服装完全按提示词中的穿搭描述重新绘制。';

/** 试衣提示词：角色基础形象 + 指定穿搭（outfitOverride 优先于衣柜激活套，不必激活）。 */
export function buildTryOnPrompt(charId: string, outfit: OutfitRecord): string {
  const c = charLook(charId);
  if (!c) return '';
  return buildPortraitPrompt({ ...c.params, outfitOverride: outfit, attire: outfit.desc });
}

/** 生成一张试衣图（promptOverride=面板编辑后的词）。返回已压缩(768) dataURL，存哪套由调用方决定。 */
export async function generateTryOnImage(charId: string, outfit: OutfitRecord, promptOverride?: string): Promise<string> {
  const c = charLook(charId);
  if (!c) throw new Error('角色不存在');
  const base = (promptOverride ?? '').trim() || buildTryOnPrompt(charId, outfit);
  if (!base) throw new Error('提示词为空，无法生成');
  const ig = useImageGen.getState();
  const refImages = c.avatar.startsWith('data:image/') ? [c.avatar] : [];   // 锁脸（仅 chatimg 多模态线生效，其余服务忽略）
  const prompt = refImages.length ? `${base}\n\n${TRYON_FACE_HINT}` : base;
  const url = await generateImage(ig.portraitService, { prompt, negative: ig.portraitNegative, refImages, label: `试衣 ${c.name}·${outfit.name}` });
  return await shrinkDataUrl(url, 768, 0.85);
}

/* ── 立绘提示词（avatarPrompt）读改——与 PlayerSidebar/NpcDetail 同一字段 ── */

/** 该角色是否已自定义立绘提示词（存过 avatarPrompt）。 */
export function hasCustomAvatarPrompt(charId: string): boolean {
  if (charId === 'B1') return !!(usePlayer.getState().profile.avatarPrompt || '').trim();
  return !!(useNpc.getState().npcs[charId]?.avatarPrompt || '').trim();
}

/** 当前生效的立绘提示词：已存的 avatarPrompt 优先，否则按档案字段实时重建（用现有 imageTags，不重译）。 */
export function currentPortraitPromptFor(charId: string): string {
  if (charId === 'B1') {
    const v = (usePlayer.getState().profile.avatarPrompt || '').trim();
    if (v) return v;
  } else {
    const v = (useNpc.getState().npcs[charId]?.avatarPrompt || '').trim();
    if (v) return v;
  }
  const c = charLook(charId);
  return c ? buildPortraitPrompt(c.params) : '';
}

/** 只保存立绘提示词不生成（传空串=清除自定义，恢复按档案自动重建）。 */
export function saveAvatarPrompt(charId: string, prompt: string): void {
  const v = String(prompt ?? '').trim();
  if (charId === 'B1') usePlayer.getState().setProfile({ avatarPrompt: v });
  else if (useNpc.getState().npcs[charId]) useNpc.getState().upsertNpc(charId, { avatarPrompt: v });
}

/** 按（编辑后的）提示词重生成立绘并存回 avatar+avatarPrompt——与 PlayerSidebar/NpcDetail「重新生成」同款路径。 */
export async function regenAvatarWithPrompt(charId: string, prompt: string): Promise<void> {
  const c = charLook(charId);
  if (!c) throw new Error('角色不存在');
  const p = String(prompt ?? '').trim();
  if (!p) throw new Error('提示词为空，无法生成');
  const ig = useImageGen.getState();
  const refImages = await outfitRefImages(charId);   // 👗 钦定穿搭参考图（仅 chatimg 多模态线生效）
  const url = await generateImage(ig.portraitService, { prompt: p, negative: ig.portraitNegative, refImages, label: `按新提示词重生成 ${c.name} 立绘` });
  const dataUrl = await shrinkDataUrl(url);
  if (charId === 'B1') usePlayer.getState().setProfile({ avatar: dataUrl, avatarPrompt: p });
  else useNpc.getState().upsertNpc(charId, { avatar: dataUrl, avatarPrompt: p });
}
