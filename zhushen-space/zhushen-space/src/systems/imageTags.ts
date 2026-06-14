import { useSettings, resolveApiChain, type ApiConfig } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { type ImgService } from '../store/imageGenStore';

/* ════════════════════════════════════════════
   按需把「中文角色/装备描述」用 LLM 翻成英文 danbooru/NAI 标签。
   NAI/ComfyUI 是标签型模型，喂中文出来的图完全不像——必须英文 tags。
   LLM 走「正文生图 LLM 路由」(image_story_llm)，未配置则回退正文 API。
════════════════════════════════════════════ */

function legacyApi(): ApiConfig {
  const ss = useSettings.getState();
  return ss.textUseSharedApi ? ss.api : ss.textApi;
}
function chain(): ApiConfig[] {
  return resolveApiChain('image_story_llm', legacyApi());
}
/** LLM 是否可用（有 baseUrl+key 才能翻译标签）*/
export function tagsLlmReady(): boolean {
  const c = chain();
  return !!(c[0]?.baseUrl && c[0]?.apiKey);
}
/** 标签型服务（NAI/ComfyUI）需要英文 tags；OpenAI/Gemini 等自然语言模型可直接用中文描述 */
export function isTagService(s: ImgService): boolean {
  return s === 'nai' || s === 'comfy';
}

function clean(t: string): string {
  return (t || '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/^\s*(tags?|prompt|提示词|标签)\s*[:：]/i, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/，/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,(\s*,)+/g, ',')
    .trim()
    .replace(/^,|,$/g, '')
    .trim();
}

const PORTRAIT_SYS = `You are an expert NovelAI/Danbooru tag-prompt engineer for anime-style character portraits. Convert the given character profile (often Chinese) into ONE rich line of **discrete English danbooru tags**.
This is NOT translation — never output a sentence. Produce **15–25 specific booru tags** (1–3 words each), comma-separated, and be faithful & specific to the description (do not generalize).
**STEP 0 — FANDOM CHECK (highest priority, do this FIRST):** Look at the character's NAME (it may be Chinese). If it corresponds to a KNOWN anime/game/manga/visual-novel character, you MUST begin the output with that character's accurate danbooru character tag (name_with_underscores, e.g. komi_shouko, artoria_pendragon, makima_(chainsaw_man)) **and** the copyright/series tag, then their canonical signature look. Never output a generic "original character" when the name is a recognizable fandom character; never mismatch a name to the wrong character. If unsure of the exact booru tag, reproduce the character's well-known canonical features (hair/eyes/signature outfit) as precisely as possible.
Cover, in this order:
1) subject + gender: 1girl / 1boy / 1other (non-human: monster/dragon/robot/etc + the species).
2) hair: length + color + style (e.g. long hair, silver hair, ponytail, bangs).
3) eyes: color + shape (e.g. red eyes, sharp eyes, heterochromia).
4) face/skin/age look (e.g. pale skin, scar on face, young man).
5) expression (e.g. serious, smug, gentle smile).
6) body/figure if known (e.g. tall, muscular, slender).
7) FULL outfit broken into garments, each with color/material (e.g. black military coat, leather gloves, red scarf, armored pauldron); include signature accessories/weapons-on-body.
8) pose/framing + light/mood (e.g. upper body, looking at viewer, dramatic lighting).
- KNOWN anime/game/novel (fan/derivative) character → FIRST the accurate danbooru character tag (name_with_underscores) + copyright/series tag, THEN canonical signature look. Never mismatch.
- Output ONLY comma-separated English tags. No Chinese, no sentences, no quality/booster words, no negatives, no markdown, no explanation.
Example —
input: 林源，男，约25岁，黑色短寸发，锐利的灰色眼睛，左眉有疤，常穿墨绿色军用外套配战术背心，体格精壮，神情冷峻
output: 1boy, solo, short hair, black hair, undercut, grey eyes, sharp eyes, scar on face, scar through eyebrow, young man, pale skin, muscular, serious, cold expression, dark green military coat, tactical vest, utility belt, upper body, looking at viewer, dramatic lighting, simple background
Example (fandom character — name recognized) —
input: 古见硝子，女，长直黑发，紫色眼睛，校服
output: komi_shouko, komi-san_wa_komyushou_desu, 1girl, solo, long hair, very long hair, black hair, straight hair, purple eyes, light blush, school uniform, serafuku, upper body, looking at viewer, soft lighting`;

const EQUIP_SYS = `You are an expert NovelAI/Danbooru tag-prompt engineer for SINGLE-item equipment concept art. Convert the given item profile (often Chinese) into ONE rich line of **discrete English danbooru tags** depicting only the item.
This is NOT translation — never output a sentence. Produce **12–20 specific booru tags**, faithful to the appearance description (prioritize the appearance text; if sparse, infer reasonably from name/category/quality).
Cover: exact category (longsword/dagger/greatsword/plate armor/robe/ring/staff/pistol/coat...), material(s), main color(s) + accent color, shape/silhouette, ornament/engraving/runes, condition (pristine/worn/blood-stained), quality/rarity feel.
Always append: item focus, still life, no humans, simple background.
- KNOWN work → reflect its canonical design.
- Output ONLY comma-separated English tags. No Chinese, no people, no sentences, no quality/booster words, no negatives, no markdown, no explanation.
Example —
input: 寒霜之牙，匕首，蓝色，霜冻钢刃身，皮革缠柄，银制护手，刃上刻满霜纹，淡金品质
output: dagger, curved blade, frost-blue steel, frosted edge, leather-wrapped hilt, silver guard, intricate frost engraving, runes, glowing faint blue, ornate, high quality, item focus, still life, no humans, simple background`;

async function gen(sys: string, desc: string): Promise<string> {
  if (!desc.trim()) { console.warn('[ImageTags] 描述为空，跳过标签生成'); return ''; }
  if (!tagsLlmReady()) { console.warn('[ImageTags] LLM 未配置（综合设置→生图设置→正文生图→独立 LLM 路由，或正文 API），无法翻译生图标签 → 将回退到原始字段'); return ''; }
  try {
    const { content } = await apiChatFallback(
      chain(),
      [{ role: 'system', content: sys }, { role: 'user', content: desc.slice(0, 1500) }],
      { timeoutMs: 60000 },
    );
    const out = clean(content);
    console.log(`[ImageTags] 输入: ${desc.slice(0, 120)}\n→ 生成标签: ${out}`);
    return out;
  } catch (e) {
    console.warn('[ImageTags] 标签生成失败:', e);
    return '';
  }
}

export const genPortraitTags = (desc: string) => gen(PORTRAIT_SYS, desc);
export const genEquipTags = (desc: string) => gen(EQUIP_SYS, desc);
