/* ════════════════════════════════════════════
   🔗🎨 调教场景生图：复用 buildPortraitPrompt 的角色识别（保证长相/衣柜一致），叠加当前调教情境
   （情欲阶段 + 私密穿着/状态 + 选中玩法 + 最近一句情境）作为动作/场景，生成一张场景图并入图库。
   - 走 portraitService（与 NPC 肖像同一路由/负向词），钦定穿搭参考图对 chatimg 多模态线生效；
   - 图本体存 imageDb（trainImgSet·随存档快照），元数据入 trainingStore.gallery。
   NSFW 尺度由所选生图服务的模型决定，本层只负责把情境描述给足。
════════════════════════════════════════════ */
import { generateImage, buildPortraitPrompt, equippedForPrompt, shrinkDataUrl } from './imageGen';
import { outfitRefImages, OUTFIT_REF_HINT } from './outfit';
import { useImageGen } from '../store/imageGenStore';
import { useNpc } from '../store/npcStore';
import { useTraining } from '../store/trainingStore';
import { trainImageKey, trainImgSet, trainImgDel } from './trainImages';

const num = (v: unknown): number => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const short = (s: string): string => String(s ?? '').split('|')[0].trim();

/** 情欲值 → 阶段 0~3（与档案页徽章同口径）。 */
export function desireStage(v: unknown): number {
  const d = num(v);
  return d >= 75 ? 3 : d >= 50 ? 2 : d >= 25 ? 1 : 0;
}
const STAGE_MOOD = ['神色矜持、隐忍克制', '面泛春潮、呼吸渐乱', '芳心暗涌、眼神迷离', '情动欲焚、浑身酥软'];

/** 组装当前调教情境（中文自然语言·作为 buildPortraitPrompt 的 action/场景）。 */
export function buildTrainingScene(npcId: string): string {
  const npc = useNpc.getState().npcs[npcId];
  const sess = useTraining.getState().sessions[npcId];
  if (!npc) return '';
  const ex = (npc.extra ?? {}) as Record<string, string>;
  const bits: string[] = [];
  bits.push(`私密调教场景中，${STAGE_MOOD[desireStage(ex['情欲值'])]}`);
  if (sess?.appellation) bits.push(`她唤主角作「${sess.appellation}」`);
  const plays = (sess?.selectedPlays ?? []).filter(Boolean);
  if (plays.length) bits.push(`情境涉及：${plays.join('、')}`);
  const bodyState = [ex['性器状态'], ex['敏感部位']].map((x) => String(x ?? '').trim()).filter(Boolean)[0];
  if (bodyState) bits.push(`身体状态：${bodyState.slice(0, 40)}`);
  // 最近一句情境（npc 旁白优先，其次玩家指令）——给画面一个即时锚点
  const last = (sess?.msgs ?? []).slice(-6).reverse().find((m) => (m.scene || m.text)?.trim());
  const lastLine = (last?.scene || last?.text || '').replace(/\s+/g, ' ').trim();
  if (lastLine) bits.push(`此刻：${lastLine.slice(0, 60)}`);
  return bits.join('；');
}

/** 组装完整生图提示词（可被面板「编辑提示词」覆盖）。私密穿着（解锁服装）优先于日常穿着。 */
export function buildTrainingImagePrompt(npcId: string): string {
  const npc = useNpc.getState().npcs[npcId];
  if (!npc) return '';
  const ex = (npc.extra ?? {}) as Record<string, string>;
  const seg = String(npc.appearance5 ?? '').split('|');   // 动作|穿着|位置|身段|样貌
  const attire = String(ex['解锁服装'] ?? '').trim() || (seg[1] ?? '').trim();
  const figure = (seg[3] ?? '').trim();
  const look = (seg[4] ?? '').trim();
  const appearance = [look, figure, attire, npc.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
  const equip = equippedForPrompt(npc.items);
  const tier = String(npc.realm ?? '').split('·')[0].trim();
  return buildPortraitPrompt({
    gender: npc.gender, age: npc.age, appearance, baseAppearance: npc.baseAppearance, bodyType: npc.bodyType,
    equipment: equip, profession: npc.profession, tier, npcTag: npc.npcTag, imageTags: npc.imageTags,
    action: buildTrainingScene(npcId), attire, location: '私密调教室', figure, appearanceDetails: npc.appearanceDetail, charId: npcId,
  });
}

/** 生成一张调教场景图 → 存 imageDb + 入图库。promptOverride 传入则用它（面板编辑提示词重生成）。返回 shotId。 */
export async function generateTrainingShot(npcId: string, promptOverride?: string): Promise<string> {
  const npc = useNpc.getState().npcs[npcId];
  if (!npc) throw new Error('角色不存在');
  const ig = useImageGen.getState();
  const base = (promptOverride && promptOverride.trim()) ? promptOverride.trim() : buildTrainingImagePrompt(npcId);
  if (!base) throw new Error('提示词为空，无法生成');
  const refImages = await outfitRefImages(npcId);   // 👗 钦定穿搭参考图（仅 chatimg 多模态线生效）
  const prompt = refImages.length ? `${base}\n\n${OUTFIT_REF_HINT}` : base;
  const url = await generateImage(ig.portraitService, { prompt, negative: ig.portraitNegative, refImages, label: `调教场景图 ${short(npc.name)}` });
  const dataUrl = await shrinkDataUrl(url);
  const shotId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await trainImgSet(trainImageKey(npcId, shotId), dataUrl);
  const ex = (npc.extra ?? {}) as Record<string, string>;
  useTraining.getState().addShot(npcId, { id: shotId, caption: '', prompt, stage: desireStage(ex['情欲值']), at: Date.now() });
  return shotId;
}

/** 删除一张场景图（imageDb + 元数据）。 */
export async function removeTrainingShot(npcId: string, shotId: string): Promise<void> {
  await trainImgDel(trainImageKey(npcId, shotId));
  useTraining.getState().removeShot(npcId, shotId);
}
