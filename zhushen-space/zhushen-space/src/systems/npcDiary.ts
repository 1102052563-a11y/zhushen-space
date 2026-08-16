/* 📔 NPC 日记（借鉴 Abstract外置手机 diary 思想·代码全自写）：
   偷看离场/在场 NPC 的私人日记——第一人称真心话（"日记不会被人看到"），
   富文本演出走轻量标记（⚠与 NPC_DIARY_RULE 同口径，别单改一边）：
   ~~划掉~~ / ██涂黑██（点开显形·2~5字） / 【【着重】】；稀缺配额在提示词侧约束（合计≤3处·每种≤1次——借鉴其"频次配额"设计）。
   存 npc.extra['日记']（单一真相源·cap 3 篇）。 */

export interface NpcDiaryEntry {
  date: string;       // 世界时间写法
  weather?: string;   // emoji 天气（如 ☁️ 多云）
  content: string;    // 正文（含轻量标记）
  collection?: string; // 纪念品（可选：名称——描述）
  at: number;         // 生成时刻（排序用）
}

export const NPC_DIARY_CAP = 3;
export const DIARY_FAVOR_GATE = 50;   // 好感 ≥50 才偷看得到（关系不到位连日记本都摸不着）

/* 解析：行协议头（日期/天气/纪念品·全半角冒号）+ 其余行=正文；没有头也认（整段当正文，日期由调用方补）*/
export function parseDiary(raw: string): { date?: string; weather?: string; collection?: string; content: string } {
  const text = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  let date: string | undefined, weather: string | undefined, collection: string | undefined;
  const body: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^(日期|天气|纪念品)\s*[:：]\s*(.*)$/.exec(line.trim());
    if (m) {
      const v = m[2].trim();
      if (m[1] === '日期') date = v.slice(0, 40);
      else if (m[1] === '天气') weather = v.slice(0, 20);
      else if (v) collection = v.slice(0, 80);
      continue;
    }
    body.push(line);
  }
  return { date, weather, collection, content: body.join('\n').trim().slice(0, 2000) };
}

/* 标记切分（渲染层用）：~~划掉~~ / ██涂黑██ / 【【着重】】 → 分段；未闭合标记按纯文本处理 */
export type DiarySeg = { type: 'text' | 'strike' | 'censored' | 'mark'; text: string };
export function tokenizeDiary(content: string): DiarySeg[] {
  const out: DiarySeg[] = [];
  const re = /~~([^~]{1,40})~~|██([^█]{1,10})██|【【([^【】]{1,40})】】/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const s = String(content || '');
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    if (m[1] != null) out.push({ type: 'strike', text: m[1] });
    else if (m[2] != null) out.push({ type: 'censored', text: m[2] });
    else out.push({ type: 'mark', text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out.length ? out : [{ type: 'text', text: s }];
}

/* 读/写 npc.extra['日记']（单一真相源；写=去头部插入+cap）*/
export function diariesOf(extra: Record<string, unknown> | undefined): NpcDiaryEntry[] {
  const v = extra?.['日记'];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is NpcDiaryEntry => !!x && typeof x === 'object' && typeof (x as any).content === 'string');
}
export function pushDiary(extra: Record<string, unknown> | undefined, entry: NpcDiaryEntry): Record<string, unknown> {
  const prev = diariesOf(extra);
  return { ...(extra ?? {}), 日记: [entry, ...prev].slice(0, NPC_DIARY_CAP) };
}

/* ── 生成（内聚在本模块·NpcDetail 零 props 穿线，所有渲染点自动获得）──
   走 npcChatCompletion('observe') 路由（featureKey npcObserve 回退 NPC 演化接口）；
   认知边界=eventsKnownTo；污染检测拒收不落盘。 */
export async function generateNpcDiary(npcId: string): Promise<{ ok: boolean; msg: string }> {
  const { useNpc } = await import('../store/npcStore');
  const { useMisc } = await import('../store/miscStore');
  const { usePlayer } = await import('../store/playerStore');
  const { npcChatCompletion } = await import('./npcEvolutionHelpers');
  const { eventsKnownTo, observeContaminated } = await import('./npcObserve');
  const { sameWorld } = await import('./worldScope');
  const { getPrompt } = await import('../store/promptOverrideStore');
  const { NPC_DIARY_RULE } = await import('../promptRules');

  const rec = useNpc.getState().npcs[npcId];
  if (!rec) return { ok: false, msg: '找不到该角色' };
  if (rec.isDead) return { ok: false, msg: '逝者的日记已随他去了' };
  if ((rec.favor ?? 0) < DIARY_FAVOR_GATE) return { ok: false, msg: `关系还不够（好感 ${rec.favor ?? 0} / 需 ≥${DIARY_FAVOR_GATE}）——连TA的日记本放哪都不知道` };
  const M = useMisc.getState();
  const wn = M.worldName || '';
  const known = eventsKnownTo(M.worldEvents ?? [], rec.name || '', wn, sameWorld);
  const playerName = usePlayer.getState().profile.name || '主角';
  const deeds = (rec.deedLog ?? []).slice(-4).map((d) => `${d.time ? `${d.time}·` : ''}${d.description}`).join('；');
  const lines = [
    `【你是谁】${rec.name}（${[rec.npcTag, rec.realm, rec.profession].filter(Boolean).join('·')}）`,
    rec.personality && `性格：${String(rec.personality).slice(0, 60)}`,
    rec.motiveNow && `当前动机：${String(rec.motiveNow).slice(0, 60)}`,
    rec.status && `近况：${String(rec.status).slice(0, 60)}`,
    rec.innerVoice && `此刻心绪：${String(rec.innerVoice).slice(0, 80)}`,
    `与${playerName}（主角）的关系：好感 ${rec.favor}${rec.callPlayer ? `，你称呼TA「${rec.callPlayer}」` : ''}`,
    deeds && `你最近的经历：${deeds}`,
    known.length && `你知道的时事：${known.slice(0, 3).join('；')}`,
    `【今天】世界：${wn || '轮回乐园'}；时间：${M.worldTime || M.paradiseTime || '（未设定）'}${M.weather ? `；天气：${M.weather}` : ''}`,
  ].filter(Boolean).join('\n');
  try {
    const content = await npcChatCompletion(
      getPrompt('NPC_DIARY_RULE', NPC_DIARY_RULE) + '\n\n' + lines,
      '写下今天的日记（按格式：日期/天气 头字段 + 第一人称正文；涂改标记宁缺毋滥）。', 'observe');
    if (observeContaminated(content)) return { ok: false, msg: '这一页被墨渍污了（生成不合格），再试一次' };
    const d = parseDiary(content);
    if (!d.content || d.content.length < 30) return { ok: false, msg: '日记内容太单薄（生成不合格），再试一次' };
    const entry: NpcDiaryEntry = {
      date: d.date || M.worldTime || M.paradiseTime || '某日',
      weather: d.weather || M.weather || undefined,
      content: d.content, collection: d.collection, at: Date.now(),
    };
    useNpc.getState().upsertNpc(npcId, { extra: pushDiary(rec.extra as Record<string, unknown> | undefined, entry) } as any);
    return { ok: true, msg: '' };
  } catch (e) {
    console.warn('[日记] 生成失败', e);
    return { ok: false, msg: '生成失败（网络/接口错误）' };
  }
}
