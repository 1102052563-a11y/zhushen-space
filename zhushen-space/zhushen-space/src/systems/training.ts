/* ════════════════════════════════════════════
   🔗 调教系统·对话链路与落库护栏
   - 隐私变化单一真相源 = npc.extra（与 NpcDetail「私密信息」同源）；本模块负责把 <调教> 块安全落到 extra；
   - 护栏（复用 NPC 演化「只增不重置」纪律）：数值 clamp / 调教值·次数·开发度只增 / 文本 append 去重 / 拒绝空值覆盖非空；
   - 四轴走 dispositionGuard 限速 + npcStore.applyDisposition 棘轮（不另造数值）；
   - 生理周期底色复用 bioCycle 引擎（单人版·不要求在场）。
   规则见 promptRules.TRAINING_CHAT_RULE；数据键与 NpcDetail.PRIVATE_COLS + 开发度六格一致。
════════════════════════════════════════════ */
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useTraining } from '../store/trainingStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useBioCycle } from '../store/bioCycleStore';
import { useMisc } from '../store/miscStore';
import { useJoy } from '../store/joyStore';
import { apiChatFallback } from './apiChat';
import { serializeNpcSnapshot } from './npcEvolutionHelpers';
import { clampDispositionDelta } from './dispositionGuard';
import { worldDayIndex, cycleStateOf, pregnancyStateOf, dailyMood } from './bioCycle';
import { loadJoyPlays, buildPlayGuideBlock } from './joyPlays';
import { buildJoyWbInjection } from './joyWorldBook';
import { getPrompt } from '../store/promptOverrideStore';
import { TRAINING_CHAT_RULE, NSFW_WRITING_RULE } from '../promptRules';

/* ── 字段分类（与 TRAINING_CHAT_RULE 白名单一致） ── */
export const DEV_KEYS = ['开发·口部', '开发·乳部', '开发·下体', '开发·后庭', '开发·手足', '开发·全身感度'] as const;
const DEV_SET = new Set<string>(DEV_KEYS);
const CLAMP_NUM_KEYS = new Set<string>(['情欲值', '快感值', '服从度', '依赖度', '性开放度', '性自信']);   // 即时/关系/性向状态·可增可减·0~100
const MONO_NUM_KEYS = new Set<string>(['调教值', '性爱次数', '性爱人数', '高潮次数', '内射次数', '怀孕次数', '生产次数', '流产次数', ...DEV_KEYS]);   // 不可逆·只增（开发度另夹 0~100 上限）
const TEXT_KEYS = new Set<string>(['性经验', '表性癖', '里性癖', '敏感部位', '性器状态', '性观念', '淫纹', '解锁服装', '独特技巧', '性爱姿势', '开发玩法', '最近性行为', '床上淫语风格', '羞耻点', '泌乳', '后庭状态', '对主角的称呼',
  // 私密档案扩展（借鉴V3.2大调查）：记录/评估/关系类文本
  '贞操状态', '破处对象', '破处时间', '部位初次', '初体验', '最难忘经历',
  '性爱频率', '常用体位', '常去场所', '子嗣',
  '性魅力标签', '吸引力部位', '声音魅力', '专属印记', '安全词', '红线禁忌',
  // 心理/倾向扩展：性向 · BDSM圈子角色扮演 · 情感依恋 · 心理软肋 · 好恶趣味
  '性取向', '性癖倾向', 'BDSM倾向', '角色扮演偏好', '圈内代号', '喜欢的动作',
  '恋爱观', '依恋类型', '对主角期待', '心结软肋', '执念渴望', '雷点禁忌', '当前心事',
  '喜好', '厌恶', '癖好趣味']);
// 当前态·单一属性（直接替换，非累加）——落库替换列表见 applyTrainPatch
const REPLACE_KEYS = new Set<string>(['对主角的称呼', '性器状态', '后庭状态', '泌乳', '最近性行为',
  '性魅力标签', '吸引力部位', '声音魅力', '性爱频率', '安全词', '最难忘经历', '专属印记',
  '性取向', '性癖倾向', 'BDSM倾向', '角色扮演偏好', '圈内代号', '恋爱观', '依恋类型', '当前心事']);
const CHASTITY_KEY = '贞操状态';                                              // 不可逆：一旦已失贞，不许写回处女/完璧
const LOCKED_ONCE = new Set<string>(['破处对象', '破处时间', '部位初次', '初体验']);   // 初次记录·首次写入即锁定（历史事实不可篡改）
const CHASTITY_LOST = /破|已失|非处女|失贞|开苞|落红|不再是处/;
const CHASTITY_VIRGIN = /处女|完璧|未经人事|清白|童贞|尚未/;
const DISP_MAP: Record<string, 'trust' | 'respect' | 'lust' | 'corruption'> = { 信任: 'trust', 尊重: 'respect', 情欲: 'lust', 沉沦: 'corruption' };

const num = (v: unknown): number => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const clamp01 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export interface TrainPatch {
  extra: Record<string, string>;                 // 落 npc.extra 的键值（已过护栏）
  disp: Partial<Record<'trust' | 'respect' | 'lust' | 'corruption', number>>;   // 四轴增量（未限速·由 applyTrainPatch 过 guard）
  pregHint: boolean;                             // AI 提示可能受孕
}

export interface TrainReply { dialogue: string; scene: string; patch: TrainPatch }

/* ── 解析回复 → 对白/交互/调教块 ── */
export function parseTrainingReply(raw: string): TrainReply {
  const text = String(raw ?? '');
  const dM = text.match(/<对白>([\s\S]*?)<\/对白>/);
  const sM = text.match(/<交互>([\s\S]*?)<\/交互>/);
  const tM = text.match(/<调教>([\s\S]*?)<\/调教>/);
  const scene = sM ? sM[1].trim() : '';
  let dialogue: string;
  if (dM) dialogue = dM[1].trim();
  else dialogue = text.replace(/<交互>[\s\S]*?<\/交互>/g, '').replace(/<调教>[\s\S]*?<\/调教>/g, '').replace(/<\/?对白>/g, '').trim();
  return { dialogue, scene, patch: parseTrainingBlock(tM ? tM[1] : '') };
}

/* <调教> 块 → 结构化 patch（纯函数·可单测）。识别 键=值 / 键+=N / 键-=N；未知键忽略。 */
export function parseTrainingBlock(block: string): TrainPatch {
  const patch: TrainPatch = { extra: {}, disp: {}, pregHint: false };
  for (const raw of String(block ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^=+\-]+?)\s*(\+=|-=|=)\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const op = m[2];
    const valRaw = m[3].trim();
    if (key === '受孕提示') { if (/真|是|yes|true|1/i.test(valRaw)) patch.pregHint = true; continue; }
    const dispM = /^disp\.(信任|尊重|情欲|沉沦)$/.exec(key);
    if (dispM) {
      const axis = DISP_MAP[dispM[1]];
      const d = op === '-=' ? -Math.abs(num(valRaw)) : num(valRaw);
      if (d) patch.disp[axis] = (patch.disp[axis] ?? 0) + d;
      continue;
    }
    // 数值键：记成带符号的意图串，落库时按 op 应用（这里先原样带 op 标记）
    if (CLAMP_NUM_KEYS.has(key) || MONO_NUM_KEYS.has(key)) {
      patch.extra[key] = `${op}${valRaw}`;   // 落库时解析 op（保留是增量还是绝对）
      continue;
    }
    if (TEXT_KEYS.has(key)) { patch.extra[key] = valRaw; continue; }
    // 未知键忽略（防污染）
  }
  return patch;
}

/* 把 patch 落到 npc.extra（过护栏：只增不重置/clamp/文本 append 去重/拒空覆盖）+ 四轴过 guard。
   返回落库摘要（供 UI 提示「本轮进展」）。 */
export function applyTrainPatch(npcId: string, patch: TrainPatch, narrative: string): string[] {
  const npc = useNpc.getState().npcs[npcId];
  if (!npc) return [];
  const cur = (npc.extra ?? {}) as Record<string, string>;
  const nextExtra: Record<string, string> = {};
  const notes: string[] = [];

  for (const [key, rawVal] of Object.entries(patch.extra)) {
    const opMatch = /^(\+=|-=|=)(.*)$/.exec(rawVal);
    const op = opMatch ? opMatch[1] : '=';
    const body = (opMatch ? opMatch[2] : rawVal).trim();

    if (CLAMP_NUM_KEYS.has(key)) {
      const base = num(cur[key]);
      const v = op === '+=' ? base + num(body) : op === '-=' ? base - num(body) : num(body);
      const nv = clamp01(v);
      if (nv !== base) { nextExtra[key] = String(nv); notes.push(`${key} ${base}→${nv}`); }
      continue;
    }
    if (MONO_NUM_KEYS.has(key)) {
      const base = num(cur[key]);
      const d = num(body);
      let nv = op === '+=' ? base + Math.abs(d) : op === '-=' ? base : Math.max(base, d);   // 只增：-=忽略、绝对赋值不许比现值小
      nv = Math.round(nv);
      if (DEV_SET.has(key)) nv = clamp01(nv);   // 开发度另夹 0~100 上限
      nv = Math.max(base, nv);                   // 最终保证不降（clamp 后也不降）
      if (nv !== base) { nextExtra[key] = String(nv); notes.push(`${key} ${base}→${nv}`); }
      continue;
    }
    // 贞操状态：不可逆——已失贞就绝不许写回处女/完璧（对齐 CLAUDE.md 铁律「绝不写回处女态」）
    if (key === CHASTITY_KEY) {
      const add = body; if (!add) continue;
      const old = String(cur[key] ?? '').trim();
      if (CHASTITY_LOST.test(old) && CHASTITY_VIRGIN.test(add)) continue;   // 已失贞 → 拒绝回写处女
      if (old !== add) { nextExtra[key] = add; notes.push(`贞操状态：${add.slice(0, 12)}`); }
      continue;
    }
    // 初次记录：第一次是唯一的——首次写入后锁定，后续不覆盖
    if (LOCKED_ONCE.has(key)) {
      const add = body; if (!add) continue;
      if (String(cur[key] ?? '').trim()) continue;         // 已有值 → 锁定不改
      nextExtra[key] = add; notes.push(`${key}：${add.slice(0, 12)}`);
      continue;
    }
    if (TEXT_KEYS.has(key)) {
      const add = body;
      if (!add) continue;                                  // 拒空覆盖
      const old = String(cur[key] ?? '').trim();
      if (!old) { nextExtra[key] = add; notes.push(`${key}：${add.slice(0, 12)}`); continue; }
      if (old.includes(add) || add.includes(old)) {         // 已含/更全 → 取更全的一份
        if (add.length > old.length) { nextExtra[key] = add; }
        continue;
      }
      // append 去重（"当前态"字段直接替换，其余（历史累积如 子嗣/常去场所/心结/喜好）累加）
      if (REPLACE_KEYS.has(key)) {
        nextExtra[key] = add; notes.push(`${key}：${add.slice(0, 12)}`);
      } else {
        nextExtra[key] = `${old}；${add}`.slice(0, 400); notes.push(`${key}+`);
      }
      continue;
    }
  }
  if (Object.keys(nextExtra).length) useNpc.getState().mergeExtra(npcId, nextExtra);

  // 四轴过 dispositionGuard 限速 + 棘轮，再落 applyDisposition
  const dispPatch: Record<string, number> = {};
  const name = String(npc.name || npcId).split('|')[0].trim();
  for (const [axis, d] of Object.entries(patch.disp)) {
    const capped = clampDispositionDelta(axis as any, d as number, name, narrative);
    if (capped) dispPatch[`${axis}Delta`] = capped;
  }
  if (Object.keys(dispPatch).length) { useNpc.getState().applyDisposition(npcId, dispPatch as any); notes.push('态度四轴微调'); }
  return notes;
}

/* ── 生理周期底色（单人·不要求在场·调教场景一般独处） ── */
function bioLine(npcId: string): string {
  try {
    const S = useBioCycle.getState();
    if (!S.enabled) return '';
    const prof = S.chars[npcId];
    if (!prof?.on) return '';
    const day = worldDayIndex(useMisc.getState().worldTime);
    if (day == null) return '';
    const preg = pregnancyStateOf(prof, day);
    if (preg) {
      if (preg.postpartumDay != null) return `【身体状态】产后第 ${preg.postpartumDay} 天·恢复期——需静养体谅`;
      const stage = preg.trimester === 1 ? '孕早期' : preg.trimester === 2 ? '孕中期' : '孕晚期';
      return `【身体状态】孕 ${preg.weeks} 周·${stage}（距预产约 ${Math.max(0, preg.dueInDays)} 天）`;
    }
    const c = cycleStateOf(prof, day);
    const mood = dailyMood(npcId, day, c.phase);
    const head = c.phase === '经期' ? `经期第 ${c.dayOfPeriod} 天` : c.phase;
    return `【身体状态】${head}·今日基调「${mood.base}${mood.extra ? '·' + mood.extra : ''}」${c.fertile ? '·当前处于易孕期' : ''}`;
  } catch { return ''; }
}

/* ── system 拼装 ── */
export async function buildTrainingSystem(npc: NpcRecord, appellation: string, selectedPlays: string[], userText: string): Promise<string> {
  const parts = [
    getPrompt('NSFW_WRITING_RULE', NSFW_WRITING_RULE),
    getPrompt('TRAINING_CHAT_RULE', TRAINING_CHAT_RULE),
    `【你要扮演的 NPC 档案（含私密累积档·据此保持一致、只增不重置）】\n${serializeNpcSnapshot(npc)}`,
  ];
  const bl = bioLine(npc.id);
  if (bl) parts.push(bl);
  if (appellation.trim()) parts.push(`【她对主角(主人)的当前称呼】${appellation.trim()}`);
  // 已选玩法按选注入（每轮现场展开 {{random}} 宏）
  if (selectedPlays.length) {
    try { const lib = await loadJoyPlays(); const blk = buildPlayGuideBlock(selectedPlays, lib); if (blk) parts.push(blk); } catch { /* 玩法库缺失不阻断 */ }
  }
  // BDSM/姿势世界书关键词命中（复用欢愉宫世界书）
  try {
    const wb = buildJoyWbInjection(useJoy.getState().worldBooks, userText);
    if (wb) parts.push(wb);
  } catch { /* 无世界书跳过 */ }
  return parts.join('\n\n');
}

/* ── 主流程：发一条 → 落库 → 记对话 ── */
export async function runTrainingTurn(npcId: string, userText: string): Promise<{ ok: boolean; error?: string; notes?: string[] }> {
  const npc = useNpc.getState().npcs[npcId];
  if (!npc) return { ok: false, error: '角色不存在' };
  const T = useTraining.getState();
  const sess = T.sessions[npcId] ?? { msgs: [], selectedPlays: [], appellation: '' };
  T.appendMsg(npcId, { role: 'user', text: userText });

  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('training', legacy);   // featureKey 'training'·未配则回退正文 API
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    T.appendMsg(npcId, { role: 'npc', text: '（调教系统的 AI 接口还没配置…到 设置→综合设置 配好正文接口即可）' });
    return { ok: false, error: '未配置 AI 接口' };
  }
  const system = await buildTrainingSystem(npc, sess.appellation, sess.selectedPlays, userText);
  const history = sess.msgs.slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.role === 'npc' ? [m.text, m.scene].filter(Boolean).join('\n') : m.text }));
  const messages = [{ role: 'system' as const, content: system }, ...history, { role: 'user' as const, content: userText }];

  try {
    const { content } = await apiChatFallback(chain, messages, { label: '调教', timeoutMs: 120000 });
    const reply = parseTrainingReply(content);
    T.appendMsg(npcId, { role: 'npc', text: reply.dialogue || '（她沉默着）', scene: reply.scene });
    const notes = applyTrainPatch(npcId, reply.patch, `${userText}\n${reply.dialogue}\n${reply.scene}`);
    // 称呼更新（AI 若在文本键里给了新称呼，同步进 session 顶部显示）
    const newApp = reply.patch.extra['对主角的称呼'];
    if (newApp && !/^[+\-]?=/.test(newApp)) T.setAppellation(npcId, newApp);
    if (reply.patch.pregHint) T.setPregConfirm(npcId, true);
    return { ok: true, notes };
  } catch (e: any) {
    T.appendMsg(npcId, { role: 'npc', text: `（接口异常：${e?.message ?? '请求失败'}）` });
    return { ok: false, error: e?.message ?? '请求失败' };
  }
}
