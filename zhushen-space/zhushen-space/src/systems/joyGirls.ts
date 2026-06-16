import { JOY_PRIVATE_COLS, type JoyGirl, type JoySession } from '../store/joyStore';
import { JOY_SYSTEM_RULE, JOY_OUTPUT_RULE } from '../promptRules';

/* 欢愉宫美女分阶段立绘清单（public/joy-girls/manifest.json，由 vite 插件 syncJoyGirls 生成）。
   结构：{ "<美女文件夹>": { "1":[相对路径...], "2":[...], "3":[...], "4":[...] } }
   相对路径形如 "玉鳞/阶段1/xxx.png"，served 于 /joy-girls/ 下。立绘标准尺寸 1215×832（横图）。*/
export type GirlManifest = Record<string, Record<string, string[]>>;

let _manifest: GirlManifest | null = null;
let _loading: Promise<GirlManifest> | null = null;

export async function loadGirlManifest(): Promise<GirlManifest> {
  if (_manifest) return _manifest;
  if (_loading) return _loading;
  _loading = fetch('/joy-girls/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { _manifest = (m && typeof m === 'object') ? m : {}; return _manifest!; })
    .catch(() => { _manifest = {}; return _manifest!; });
  return _loading;
}

/** 情欲值 → 四阶段（25/50/75/100 分界）。*/
export function stageFromDesire(desire: number): 1 | 2 | 3 | 4 {
  const v = Math.max(0, Math.min(100, desire));
  if (v < 25) return 1;
  if (v < 50) return 2;
  if (v < 75) return 3;
  return 4;
}

/** 好感度 → 关系阶段（长期羁绊，与情欲值无关）。*/
const RELATION_LABELS = ['生人', '相识', '暧昧', '相好', '情根深种'];
export function relationFromAffection(affection: number): { level: number; label: string } {
  const v = Math.max(0, Math.min(100, affection));
  const level = v < 20 ? 0 : v < 40 ? 1 : v < 60 ? 2 : v < 80 ? 3 : 4;
  return { level, label: RELATION_LABELS[level] };
}

/** 把相对路径转成可用 URL（中文路径段逐段 encode）*/
function toUrl(rel: string): string {
  return '/joy-girls/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** 取某美女在某情欲值对应阶段的一张随机立绘 URL；空阶段就近回退。无图返回 null。*/
export function pickStagePortrait(manifest: GirlManifest | null, folder: string | undefined, desire: number): string | null {
  if (!manifest || !folder) return null;
  const stages = manifest[folder];
  if (!stages) return null;
  const want = stageFromDesire(desire);
  const order = [want, want - 1, want - 2, want - 3, want + 1, want + 2, want + 3].filter((n) => n >= 1 && n <= 4);
  for (const n of order) {
    const arr = stages[String(n)];
    if (arr && arr.length) return toUrl(arr[Math.floor(Math.random() * arr.length)]);
  }
  return null;
}

/** 该美女是否有文件夹立绘（任一阶段有图）*/
export function hasFolderPortraits(manifest: GirlManifest | null, folder?: string): boolean {
  if (!manifest || !folder) return false;
  const stages = manifest[folder];
  return !!stages && Object.values(stages).some((a) => a && a.length > 0);
}

/** 选妃卡 / 回退用：取该美女的代表立绘（按当前情欲值阶段；无 session 用阶段1）。*/
export function girlCardPortrait(manifest: GirlManifest | null, girl: JoyGirl, desire = 0): string | null {
  return pickStagePortrait(manifest, girl.portraitFolder, desire) ?? girl.portrait ?? null;
}

/* ── 私密信息快照（喂给 AI，让它知道她当前状态）── */
function privacySnapshot(privacy: Record<string, string>): string {
  const lines = JOY_PRIVATE_COLS
    .map((c) => ({ label: c.label, v: privacy?.[c.key] }))
    .filter((x) => x.v != null && String(x.v).trim());
  return lines.length ? lines.map((x) => `${x.label}: ${x.v}`).join('\n') : '（尚无记录，请你在互动中逐步开发并填写）';
}

/** 拼装一次欢愉宫对话的 system 提示词（人设 + 当前阶段 + 私密状态 + 输出规则）。*/
export function buildJoySystem(girl: JoyGirl, session: JoySession | undefined): string {
  const desire = session?.desire ?? 0;
  const affection = session?.affection ?? 0;
  const stage = stageFromDesire(desire);
  const rel = relationFromAffection(affection);
  const appellation = (session?.appellation || girl.appellation || '').trim();
  const stageDesc = girl.stageDesc?.[String(stage)] ?? '';
  const preset = (girl.chatPreset || '').trim();
  return [
    `你将扮演「欢愉宫」（一座成人向的奇幻风月场所）里的女子「${girl.name}」（${girl.race}${girl.title ? '·' + girl.title : ''}）。她是明确的成年奇幻角色。`,
    `【性格】${(girl.personality || girl.persona || '').trim()}`,
    girl.appearance?.trim() ? `【外观】${girl.appearance.trim()}` : '',
    girl.background?.trim() ? `【个人经历】${girl.background.trim()}` : '',
    preset ? `【对话/演绎预设（请严格遵循其口吻与风格）】\n${preset}` : '',
    `【当前情欲阶段】第 ${stage} 阶（情欲值 ${desire}/100，共 4 阶：<25=1 / <50=2 / <75=3 / ≥75=4）。请严格按本阶段的语言与身体状态演绎：`,
    stageDesc ? stageDesc : '（本阶段无专属描述，按情欲值高低自行把握收放）',
    `【当前关系】好感度 ${affection}/100 · 关系阶段「${rel.label}」（生人→相识→暧昧→相好→情根深种）。好感度是**长期羁绊**，与情欲值不同：靠真诚相待、温柔体贴、记住她的心事而**缓慢**上涨，被冷漠/粗暴/纯当发泄对象则下降。请让她的信任、敞开程度、主动与依恋程度都与此关系阶段相符（关系浅则矜持设防，关系深则交付真心）。`,
    appellation ? `【她对你的称谓】此刻她称你为「${appellation}」。请在正文里如此称呼你，并让称谓**随好感度自然演变**（越亲密越软昵，疏远则转回客套或冷淡）。` : '',
    `【她当前的私密状态】\n${privacySnapshot(session?.privacy ?? {})}`,
    JOY_SYSTEM_RULE,
    JOY_OUTPUT_RULE,
  ].filter(Boolean).join('\n\n');
}

/** 看板娘迎宾「再说一句」的 prompt（点立绘时用）。*/
export function buildGreetPrompt(madam: JoyGirl): string {
  return [
    `你是「欢愉宫」的看板娘「${madam.name}」（${madam.race}${madam.title ? '·' + madam.title : ''}）。`,
    `【人设】${madam.persona}`,
    madam.greetingPreset ? `【迎宾基调】${madam.greetingPreset}` : '',
    `老板（客人）刚走进欢愉宫大厅。请你**用第一人称、保持人设口吻**，说一句招呼/调侃/迎客的话，引导他从今夜的姑娘里挑一位。只输出这一两句台词本身，不要加任何解释、动作旁白用括号简短带过即可，30~60字。`,
  ].filter(Boolean).join('\n');
}

/* ── 解析 AI 回复里的 <joy> 状态块 ──
   正文在前，末尾可带：
   <joy>
   情欲值 += 8        （或 -= / =，驱动阶段与立绘）
   快感值 = 30
   敏感部位 = 后颈、耳廓
   ...其它私密字段 = 值
   </joy>
   返回 narrative（去掉块）+ desireDelta/desireSet + privacyPatch。*/
export function parseJoyReply(raw: string): {
  narrative: string;
  desireDelta?: number; desireSet?: number;
  affectionDelta?: number; affectionSet?: number;
  appellation?: string; innerThought?: string;
  privacyPatch: Record<string, string>;
} {
  const privacyPatch: Record<string, string> = {};
  let desireDelta: number | undefined, desireSet: number | undefined;
  let affectionDelta: number | undefined, affectionSet: number | undefined;
  let appellation: string | undefined, innerThought: string | undefined;

  const m = raw.match(/<joy>([\s\S]*?)<\/joy>/i);
  const narrative = raw.replace(/<joy>[\s\S]*?<\/joy>/gi, '').trim();

  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const mm = t.match(/^([^=+\-][^=]*?)\s*(\+=|-=|=)\s*(.+)$/);
      if (!mm) continue;
      const key = mm[1].trim();
      const op = mm[2];
      const val = mm[3].trim();
      const n = Number(val.replace(/[^\d.-]/g, ''));
      if (key === '情欲值') {
        if (Number.isFinite(n)) { if (op === '+=') desireDelta = (desireDelta ?? 0) + n; else if (op === '-=') desireDelta = (desireDelta ?? 0) - n; else desireSet = n; }
      } else if (key === '好感度') {
        if (Number.isFinite(n)) { if (op === '+=') affectionDelta = (affectionDelta ?? 0) + n; else if (op === '-=') affectionDelta = (affectionDelta ?? 0) - n; else affectionSet = n; }
      } else if (key === '称谓' || key === '当前称谓') {
        appellation = val;
      } else if (key === '内心独白' || key === '心声' || key === '心声独白') {
        innerThought = val;
      } else {
        privacyPatch[key] = val;   // 其余私密字段：直接以 AI 给的值覆盖（含 快感值 等）
      }
    }
  }
  return { narrative: narrative || raw.trim(), desireDelta, desireSet, affectionDelta, affectionSet, appellation, innerThought, privacyPatch };
}
