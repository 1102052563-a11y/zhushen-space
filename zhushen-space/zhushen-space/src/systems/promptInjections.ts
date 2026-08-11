// 正文系统提示·注入块构建器（从 App.tsx 抽出；纯读 store，不依赖组件 state）。
// 每个返回 {role:'system',content}[]，由 callApi 拼进 sysPrompt 前。门控各看自己的开关。
import { useSettings } from '../store/settingsStore';
import { useFanfic } from '../store/fanficStore';
import { useFact } from '../store/factStore';
import { useCosmos, cosmosNameEq, cleanCosmosName, type CosmosEntity } from '../store/cosmosStore';
import { useMisc } from '../store/miscStore';
import { useCalendar } from '../store/calendarStore';
import { useLocations, locationTreeLines } from '../store/locationStore';
import { useMap } from '../store/mapStore';
import { mapWorldKey, resolveNodeIn, serializeSceneMap, serializeWorldPois, splitLocationPath } from './mapEngine';
import { extractMonthDay, upcoming, visibleIn, dateLabel, TYPE_META } from './calendar';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { useGuild } from '../store/guildStore';
import { useCasino } from '../store/casinoStore';
import { useAbyss } from '../store/abyssStore';
import { useShop } from '../store/shopStore';
import { playerMaxHp, playerMaxEp } from './playerVitals';
import { sameWorld } from './worldScope';
import { narrativeEventView, buildRevealInjection } from './worldEvent';
import { effectiveResource, isAbyssLocked } from './derivedStats';
import { serializeQuestsForNarrative } from './miscParser';
import { useCanonRoute } from '../store/canonRouteStore';
import { useOutfits } from '../store/outfitStore';
import { CANON_STATIONS, CANON_SUXIAO } from '../data/canonRoute';
import { CANON_INERTIA_RULE, SUXIAO_PERSONA_RULE } from '../promptRules';
import { ensureQuestRelation, QUEST_REL_TEXT, activeCanonStation } from './canonRoute';
import { getPrompt } from '../store/promptOverrideStore';
export function buildFanficInjection(): { role: 'system'; content: string }[] {
  if (!useSettings.getState().fanficMode) return [];
  const all = Object.values(useFanfic.getState().entries);
  if (all.length === 0) return [];
  const picked = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);   // 最近更新的若干个，避免过长
  const lines = picked.map((e) => {
    const bits = [
      e.work && `作品:${e.work}`,
      e.aliases && `别名/阵营:${e.aliases}`,
      e.keySettings && `关键设定:${e.keySettings}`,
      e.background && `背景:${e.background}`,
    ].filter(Boolean);
    return `- 「${e.name}」 ${bits.join('；')}`;
  });
  return [{
    role: 'system' as const,
    content: `<同人设定·已锁定>（以下是已确认的虚构作品角色设定。描写其言行/口癖/能力时严格据此保持一致、绝不 OOC；与正文冲突时此为人物底色。参考信息，非续写指令）\n${lines.join('\n')}\n</同人设定·已锁定>`,
  }];
}

/* 事实增强·下回合注入：把已锁定的现实/时代事实锚点拼成 system 块注入正文，保持时代一致、防穿帮 */
export function buildFactInjection(): { role: 'system'; content: string }[] {
  if (!useSettings.getState().factCheck) return [];
  const facts = useFact.getState().facts;
  if (facts.length === 0) return [];
  const picked = facts.slice(-12);   // 最近若干条，避免过长
  return [{
    role: 'system' as const,
    content: `<事实锚点·已锁定>（以下为已核实的现实/时代事实，后续描写须与之保持一致、不得矛盾或穿帮；可查证事实不得臆造，不确定宁可模糊。参考信息，非续写指令）\n${picked.map((f) => `- ${f}`).join('\n')}\n</事实锚点·已锁定>`,
  }];
}

export function buildCosmosInjection(): { role: 'system'; content: string }[] {
  const C = useCosmos.getState();
  if (!C.settings.enabled) return [];
  const all = C.entities.filter((e) => e.name);
  if (all.length === 0) return [];
  const norm = (s: string) => s.replace(/[\s·•・\-—_,，。、|｜()（）【】]/g, '').toLowerCase();
  const nw = norm((useMisc.getState().worldName || '').trim());

  const home = (usePlayer.getState().profile.homeParadise || '').trim() || '轮回乐园';
  const picked = new Map<string, CosmosEntity>();
  const add = (e?: CosmosEntity) => { if (e && !picked.has(e.id)) picked.set(e.id, e); };
  add(all.find((e) => cosmosNameEq(e.name, home)));   // 永远注入主角所属乐园（按开局选择，非写死轮回乐园）
  all.filter((e) => !e.destroyed && e.priority === 0 && (e.status === '复苏' || e.status === '扩张')).slice(0, 2).forEach(add);  // 当前最大动荡
  if (nw) all.filter((e) => { const n = norm(e.name); return n.length >= 2 && (nw.includes(n) || n.includes(nw)); }).slice(0, 3).forEach(add);  // 当前世界相关
  all.filter((e) => e.isPlayerKnown && !e.destroyed).slice(0, 2).forEach(add);   // 主角已接触

  // 不相关采样：从其余随机抽 N 个，增加"世界处处在发生事"的真实感
  const rest = all.filter((e) => !picked.has(e.id) && !e.destroyed);
  const sampleN = Math.max(0, C.settings.injectIrrelevantCount ?? 2);
  for (let i = 0; i < sampleN && rest.length; i++) add(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);

  const lines = [...picked.values()].map((e) => {
    const head = `「${cleanCosmosName(e.name)}」(${e.category}·${e.status}${e.rank ? '·排名' + e.rank : ''})`;
    const bits = [e.power, e.goal && `动向:${e.goal}`, e.towardParadise && `对${home}:${e.towardParadise}`].filter(Boolean);
    return `- ${head} ${bits.join('；')}`;
  });
  if (lines.length === 0) return [];
  return [{
    role: 'system' as const,
    content: `<万族态势>（轮回乐园宇宙宏观格局，背景氛围参考、非剧情指令；多数与主角无直接关系，体现世界辽阔鲜活即可，勿照搬复述）\n${lines.join('\n')}\n</万族态势>`,
  }];
}

/* 始终注入的「主角核心」——结构化召回(叙事记忆)默认关，多数玩家的正文 API 读不到主角真实外观/六维，
   于是 AI 会凭空改发色、写出默认属性卡再被回写 → 清零。这里无条件补一份精简主角卡兜底（结构化召回开着时跳过，避免重复）。*/
export function buildPlayerCoreInjection(): { role: 'system'; content: string }[] {
  const nm = useSettings.getState().narrativeMemory;
  if (nm?.enabled && nm?.structEnabled !== false) return [];   // 结构化召回已注入完整主角卡
  const p = usePlayer.getState().profile;
  if (!p.name) return [];   // 尚未创建角色
  const a = p.attrs;
  const look = (p.baseAppearance || p.appearance || '').trim();
  const gp = useGame.getState().player;
  const hpMax = playerMaxHp(), epMax = playerMaxEp();
  const hpCur = effectiveResource(gp.hp, gp.maxHp, hpMax), epCur = effectiveResource(gp.mp, gp.maxMp, epMax);
  const bits = [
    `姓名:${p.name}`,
    p.tier && `阶位:${p.tier}`,
    p.level != null && `Lv.${p.level}`,
    a && `六维: 力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 幸${a.luck}`,
    `当前HP:${hpCur}/${hpMax} 当前EP:${epCur}/${epMax}`,
    look && `外观:${look}`,
    p.profession && `职业:${p.profession}`,
    p.homeParadise && `所属乐园:${p.homeParadise}`,
  ].filter(Boolean);
  return [{
    role: 'system' as const,
    content: `<主角核心>（这是主角的真实设定，描写时严格据此，**不要擅自更改主角的发色/外观，也不要改动其六维属性**——属性变化只由系统结算）\n${bits.join(' | ')}\n</主角核心>`,
  }];
}

/* <钦定穿搭> 注入正文：衣柜激活的穿搭=服装单一权威源（立绘/正文配图/漫画三线已读同一数据），正文描写同样以此为准。
   同时给出各角色衣柜清单（名称+场景标签），并教 AI 用 `outfit.<角色ID>=穿搭名` 指令按剧情换装——
   闭环：AI 换装 → outfitStore → 下回合注入与生图全部跟随。范围=主角 + 在场存活 NPC；全空不出块。 */
export function buildOutfitInjection(): { role: 'system'; content: string }[] {
  const byChar = useOutfits.getState().byChar;
  const p = usePlayer.getState().profile;
  const npcs = useNpc.getState().npcs;
  const lines: string[] = [];
  for (const [charId, w] of Object.entries(byChar)) {
    if (!w.outfits.length) continue;
    if (charId !== 'B1' && (!npcs[charId] || npcs[charId].isDead || !npcs[charId].onScene)) continue;   // NPC 只注入在场存活的
    const name = charId === 'B1' ? (p?.name || '主角') : npcs[charId].name;
    if (!name) continue;
    const active = w.outfits.find((o) => o.id === w.activeId) ?? null;
    const list = w.outfits.map((o) => `「${o.name}」${o.tags ? `[${o.tags}]` : ''}`).join(' / ');
    lines.push(`- ${name}(${charId})：当前穿着=${active ? `「${active.name}」——${active.desc}` : '未钦定（按装备栏/外观描述）'}；衣柜可选：${list}`);
    if (lines.length >= 8) break;   // 防块膨胀
  }
  if (!lines.length) return [];
  return [{
    role: 'system' as const,
    content: `<钦定穿搭>（玩家在衣柜为下列角色钦定的服装——**正文描写这些角色的衣着时以"当前穿着"为准**，不要擅自更换或虚构服装；立绘与配图读的也是同一份数据。剧情确实需要换装时（备战/赴宴/就寝/沐浴更衣/乔装…），在 <state> 指令里写 \`outfit.角色ID = 穿搭名\` 切换（也可写场景标签，如 \`outfit.B1 = 战斗\`）；临时脱下或不再钦定写 \`outfit.角色ID = 无\`。只能从该角色衣柜里已有的穿搭中选择，不得自创新名）\n${lines.join('\n')}\n</钦定穿搭>`,
  }];
}

/* <所属公会> 注入正文：主角隶属的玩家公会（契约者战队）身份 + 已解锁公会增益 → 叙事体现归属/靠山/公会声望士气。
   这是跨存档·账号级的**社交身份**，非当前任务世界的势力，勿混淆。无公会则不注入。（公会系统见 指导/家族系统-设计.md） */
export function buildGuildInjection(): { role: 'system'; content: string }[] {
  const g = useGuild.getState().my;
  if (!g) return [];
  const RANK: Record<string, string> = { leader: '会长', viceLeader: '副会长', elder: '长老', member: '成员' };
  const perks = (g.perks || []).map((p) => p.label).join('、');
  const bits = [
    `公会:${g.name}${g.emblem ? ' ' + g.emblem : ''}${g.tag ? ` [${g.tag}]` : ''}`,
    `我的军衔:${RANK[g.role] || g.role}`,
    `公会等级:Lv.${g.level}`,
    perks && `公会庇荫/增益(可化作靠山与士气):${perks}`,
  ].filter(Boolean);
  return [{
    role: 'system' as const,
    content: `<所属公会>（主角隶属下列玩家公会/契约者战队——叙事可自然体现其归属感、靠山、公会声望与士气；相熟 NPC/契约者可据此提及。这是跨世界的社交身份，**非当前任务世界的势力**，勿混淆）\n${bits.join(' | ')}\n</所属公会>`,
  }];
}

/* <当前时空> 注入正文：把「杂项」的两个时间——轮回历(乐园时间) 与 世界时间——连同当前世界名、天气、
   近期世界大事常驻注入，让写正文的 AI 始终知道此刻是什么时间、在哪个世界、什么天气、世界正在发生什么，
   叙事不与之矛盾（结构化召回里没有这些，故独立注入）。
   ★天气闭环：此前 misc 阶段每回合花 API 生成天气→写 store→只服务顶栏 UI 和战场词缀，主正文永远读不回、
   下回合只能自己再编一个（审计"只出不进"头名）。加一行即三方同一现实。
   ★世界大事回流：misc 写的 worldEvents 此前只能靠向量/关键词召回碰运气才被正文看到。
   时间都未设定时不注入。推进仍由「杂项演化」结算，正文只读不改。 */
export function buildWorldTimeInjection(): { role: 'system'; content: string }[] {
  const M = useMisc.getState();
  const pt = (M.paradiseTime || '').trim();
  const wt = (M.worldTime || '').trim();
  const wn = (M.worldName || '').trim();
  if (!pt && !wt) return [];   // 两个时间都没设就不注入
  const wx = (M.weather || '').trim();
  const bits = [
    wn && `当前世界:${wn}`,
    pt && `轮回历·乐园时间:${pt}`,
    wt && `当前世界时间:${wt}`,
    wx && `天气:${wx}`,
  ].filter(Boolean);
  // 近期世界大事（最多 3 条·每条截断）：让正文对世界背景演进有感知，而非只靠召回碰运气
  // ⚠ 世界作用域：只喂**属于当前世界**的大事——换世界后继续喂上个世界的事件会直接串戏。
  //   worldName 为空 = 老数据/未归属，放行（宁可多喂，不可把历史存档喂空）。
  // ⚠ 已结算的事件不再喂进"近期"（它们是历史，进编年史那条线）——否则落幕的事会一直在正文里回响。
  const evs = (M.worldEvents || [])
    .filter((e) => !e.worldName || sameWorld(e.worldName, wn))
    .filter((e) => !e.settledAt)
    // 🔒 可见性门（P1·worldEvent.ts）：hidden 整条不进正文（同占卜锚待遇）；trace 只给表象、连事件名都不给；
    //   秘闻(knownBy)附知情边界。先过门再取最近 3 条——别让 hidden 白占注入名额。缺省 known＝老数据行为不变。
    .filter((e) => narrativeEventView(e) != null)
    .slice(-3)
    // ⚠ 取**最新脉络节点**而不是最初的 desc：事件推进几轮之后，desc 还停在"刚发生时那一句"，
    //   正文因此永远读到过时的进展（升级前的老 bug）。老条目无 chain → 自然回退 desc。
    .map((e) => {
      const v = narrativeEventView(e)!;
      const head = [e.time, e.location].filter(Boolean).join('·');
      const body = v.text.slice(0, 60);   // 60 字预算是既有约定（promptInjections.test 守着）
      const traceMark = v.trace ? '（外界所见表象·内情未知）' : '';
      const secret = v.secret ? `（秘闻·仅 ${v.secret} 知情，其余角色不得表现出知情）` : '';
      return `- ${!v.trace && e.name ? `「${e.name}」` : ''}${head}${head ? '：' : ''}${body}${traceMark}${secret}`;
    })
    .filter((l) => l.length > 4);
  const evBlock = evs.length ? `\n近期世界大事（背景事实·可自然呼应，勿整段复述）：\n${evs.join('\n')}` : '';
  const out: { role: 'system'; content: string }[] = [{
    role: 'system' as const,
    content: `<当前时空>（叙事须与下列时间/世界/天气保持一致，勿自相矛盾；时间与天气由系统推进，正文勿擅自跳改）\n${bits.join(' | ')}${evBlock}${buildAlmanacLines(wt, wn)}${buildLocationLines(wn)}\n</当前时空>`,
  }];
  // 🔔 显露递交（P1）：已落幕待显露的后台结果 ≤2 条作为"自然带出"候选；接没接住由回合末对账（App）判定
  const rv = buildRevealInjection(M.worldEvents || [], wn, sameWorld);
  if (rv) out.push({ role: 'system' as const, content: rv });
  return out;
}

/* 🗓 临近的日子（并进 <当前时空> 尾部，不单独占一个块）：把未来 ALMANAC_WITHIN 天内到期的
   节日/生日/纪念日报给正文，让故事与该世界的历法自洽（该过节就过、该记得生日就记得）。
   ⚠ 三重零成本：① 今天靠 `extractMonthDay(worldTime)` **纯前端**抠，不像参考插件那样额外调一次 AI
   ② 历里没条目 / worldTime 抠不出日期 → 整段返回 ''，一个 token 都不加
   ③ 只报窗口内的，不把整本历倒出来。 */
const ALMANAC_WITHIN = 7;

function buildAlmanacLines(worldTime: string, worldName: string): string {
  try {
    const items = visibleIn(useCalendar.getState().items, worldName);
    if (!items.length) return '';
    const anchor = extractMonthDay(worldTime);
    if (!anchor) return '';   // 抠不出「今天」→ 算不了「还有几天」，不猜（无信号不动）
    const soon = upcoming(items, anchor, ALMANAC_WITHIN);
    if (!soon.length) return '';
    const lines = soon.slice(0, 5).map(({ item, inDays }) => {
      const when = inDays === 0 ? '就是今天' : `还有 ${inDays} 天`;
      const meta = TYPE_META[item.type];
      return `- ${dateLabel(item)}　${meta.label}「${item.name}」：${when}${item.note ? `（${item.note}）` : ''}`;
    });
    return `\n临近的日子（本世界历法·背景事实：临近或当天时，市井氛围、NPC 言行、主角安排都应自然受它影响；**不要生硬报幕**，也不要为了凑节日改变既定剧情走向）：\n${lines.join('\n')}`;
  } catch { return ''; }
}

/* 🗺 已探索地点树（并进 <当前时空> 尾部·借鉴V3.2「已探索地点概览」）：让正文记得本世界去过哪些地方、
   引用时拼出全链（如「城东-旧钟楼」），优先复用真去过的地点而非新造同名地点。
   <2 节点 / 本世界无足迹 → 整段 ''，零 token（同临近的日子三重零成本原则）。 */
function buildLocationLines(worldName: string): string {
  try {
    // 🧭 小地图接管：<当前地图> 块启用时本段让位——绝不同时出两份地名清单（两清单会互相漂移+白烧 token）
    const mp = useMap.getState();
    if (mp.settings.enabled && mp.settings.injectNarrative && Object.keys(mp.byWorld[mapWorldKey(worldName)]?.nodes ?? {}).length > 0) return '';
    const lines = locationTreeLines(useLocations.getState().nodes, worldName, 24);
    if (!lines.length) return '';
    return `\n已探索地点（缩进表层级·括号为探索纪要；引用时拼全链如「上级-下级」；这些是主角真去过的地方，续写优先复用、勿另造同名新地点）：\n${lines.join('\n')}`;
  } catch { return ''; }
}

/* <设施近况> 常驻一行注入：主角在各玩法设施留下的长期足迹（赌坊战绩/深渊最深层/产业），
   让正文和 NPC 对话能自然引用"这个人是赌坊常客/深渊行者/产业主"——此前这些完全游离于叙事外。
   全部空则不出块；每行都极短，预算 ≤4 行。竞技场名次已在主角卡（structuredRecall.arenaRank），不重复。 */
export function buildFacilityInjection(): { role: 'system'; content: string }[] {
  const lines: string[] = [];
  try {   // 赌坊：玩过才有一行
    const cs = (useCasino.getState() as any).stats;
    const played = (cs?.won || 0) + (cs?.lost || 0) > 0 || (cs?.wagered || 0) > 0;
    if (played) lines.push(`赌坊战绩:累计投注${cs.wagered ?? 0}筹码·最大单赢${cs.biggestWin ?? 0}·最高连胜${cs.bestWinStreak ?? 0}`);
  } catch { /* casino store 未载入则跳过 */ }
  try {   // 深渊：下过才有一行（五阶前按封印口径称幽冥）
    const meta = (useAbyss.getState() as any).meta;
    if (meta && (meta.deepestFloor > 0 || meta.clearsCount > 0)) {
      const place = isAbyssLocked(usePlayer.getState().profile) ? '幽冥地牢' : '深渊地牢';
      lines.push(`${place}:最深抵达第${meta.deepestFloor}层${meta.clearsCount > 0 ? `·通关${meta.clearsCount}次` : ''}`);
    }
  } catch { /* */ }
  try {   // 玩家产业：开着店才有一行
    const shops = (useShop.getState() as any).shops as { name?: string; kind?: string }[] | undefined;
    if (shops && shops.length > 0) lines.push(`名下产业:${shops.slice(0, 3).map((s) => s.name).filter(Boolean).join('、')}${shops.length > 3 ? ` 等${shops.length}处` : ''}`);
  } catch { /* */ }
  if (lines.length === 0) return [];
  return [{
    role: 'system' as const,
    content: `<设施近况>（主角在乐园各设施的长期足迹·背景事实：对话/叙事可自然引用（如赌客名声、幽冥归来者的气息、产业主身份），勿据此结算数值或重播过程）\n${lines.join('\n')}\n</设施近况>`,
  }];
}

/* 🧭 <当前地图> 注入（小地图·systems/mapEngine）：当前位置全路径 + 本区域已知场所 + 已知区域清单。
   双重职责：①地理一致性（AI 不再发明矛盾方位/忘记三十回合前的地点）②命名权威（同一地点不得另造新名——
   治名称漂移的注入侧防线，引擎侧防线是 resolveNodeIn 的别名吸收）。
   地图启用时旧「已探索地点树」（buildLocationLines）自动让位，绝不出两份地名清单（防两清单漂移+省 token）。
   target='outline' 走细纲开关（规划层同样要认地图）。空图/关闭一律 []，零 token。 */
export function buildMapInjection(target: 'text' | 'outline' = 'text'): { role: 'system'; content: string }[] {
  try {
    const mp = useMap.getState();
    if (!mp.settings.enabled) return [];
    if (target === 'text' ? !mp.settings.injectNarrative : !mp.settings.injectOutline) return [];
    const M = useMisc.getState();
    const wn = mapWorldKey(M.worldName || '');
    const data = mp.byWorld[wn];
    if (!data || Object.keys(data.nodes).length === 0) return [];
    const loc = (usePlayer.getState().profile.location || '').trim();
    const segs = splitLocationPath(loc, wn);
    const regions = Object.values(data.nodes).filter((n) => n.kind === 'region');
    const regionNode = segs[0] ? resolveNodeIn(regions, segs[0]) : null;
    const scene = regionNode ? serializeSceneMap(data, regionNode.id) : '';
    const pois = serializeWorldPois(data, regionNode?.id);
    if (!scene && !pois) return [];
    return [{
      role: 'system' as const,
      content: `<当前地图>（系统维护的地理事实：叙事中的地名与相对位置须与本清单一致，同一地点**不得另造新名**；清单外的新地点可自然引入，系统会自动收录；勿据此结算任何数值）\n当前位置：${loc || wn}${regionNode ? `\n【本区域·${regionNode.name}】\n${scene || '（尚无已知场所）'}` : ''}${pois ? `\n【已知区域】${pois}` : ''}\n</当前地图>`,
    }];
  } catch { return []; }
}

/* <当前任务> 注入正文：主线(重·当前目标+下一步+终局，作叙事节奏锚点) + 相关支线(轻·限量)。
   解决"主线没存在感、要手动口胡才回归"——把任务面板回流进正文生成上下文。 */
export function buildQuestInjection(deferToPlan = false): { role: 'system'; content: string }[] {
  const M = useMisc.getState();
  if (M.settings.questInjectEnabled === false) return [];
  const tasks = M.tasks ?? [];
  if (tasks.length === 0) return [];
  // 场景信号：当前地点 + 在场 NPC 名（支线相关性排序用）
  const loc = (usePlayer.getState().profile.location || M.worldName || '').trim();
  const onScene = Object.values(useNpc.getState().npcs)
    .filter((n: any) => n?.onScene)
    .map((n: any) => n?.name)
    .filter(Boolean)
    .join(' ');
  const body = serializeQuestsForNarrative(tasks, {
    sideCap: M.settings.questSideCap ?? 3,
    sceneText: `${loc} ${onScene}`.trim(),
  });
  if (!body) return [];
  // 本回合有【剧情指导 / 细纲 / 数据库推进】等前置规划时 deferToPlan=true：任务线降级为「背景参考」，把"是否推进主线"的决定权交给那份规划——
  // 治"三个推进 / 提示词写了『不要管主线』被主线强约束盖过"（原措辞的唯一例外只认玩家输入、无视前置规划）。
  if (deferToPlan) {
    return [{
      role: 'system' as const,
      content:
        `<当前任务>（主角任务线 = 预先规划好的剧情大方向·**本回合仅作背景参考**；勿在正文里罗列或写"环/任务/进度"等系统词）\n${body}\n` +
        `【本回合以"前置规划"为准·不强制推进主线】\n` +
        `- 本回合另有【剧情指导 / 细纲 / 数据库推进】等前置规划——**一律以那份规划为准**：它顺着主线就推进主线，它说暂缓 / 转向 / 让主角休整或自由发展 / 写支线或日常，就照它写，**别硬把剧情拉回主线当前环**。\n` +
        `- 任务线在这里只是让你知道"大方向在哪"，不是本回合必须达成的硬指标；主线不会因此丢失，下回合没有前置规划时自会照常推进。\n` +
        `- 玩家本轮输入明确转向时同样以玩家为准。\n` +
        `</当前任务>`,
    }];
  }
  return [{
    role: 'system' as const,
    content:
      `<当前任务>（主角任务线 = 预先规划好的剧情大方向；你必须据此推进，但勿在正文里罗列或写"环/任务/进度"等系统词）\n${body}\n` +
      `【叙事推进·强约束】\n` +
      `- **大方向由任务线定、细节由你补全**：本回合正文要积极推动主角朝主线【当前环目标】行动并取得实质进展，把该目标落成具体的场景、人物、事件与冲突；不要让主线停滞、跑题或长期失联。\n` +
      `- 适时把"本环奖励 / 惩罚"自然呈现给主角（接近达成给奖励钩子、拖延或失误示惩罚代价），强化目标分量。\n` +
      `- **当前环目标在本轮正文中达成后**，立刻顺着"完成本环后下一环走向"把剧情导向下一环（系统随后会把下一环转为当前环，下回合继续据此推进）。\n` +
      `- **强制环 vs 贪婪环**：强制环(保命底线)要积极推进、失败=死亡或重罚；贪婪环(可选·高潮之后)是"够强才来"的额外赌注，可推进但别逼玩家、失败只丢该环额外奖励。\n` +
      `- **高潮(最后一个强制环)达成、且还有贪婪环时**：本回合要给主角一个"见好就收(主线已达成、可安全离场) 还是 接受隐藏委托·继续赌(进贪婪环)"的**选择点**——附贪婪环奖励预览 + 难度陡增/风险警告，让玩家在安全位置自己决定、别替他选。\n` +
      `- 支线：仅当当前场景/人物契合时按其当前目标自然推进，不喧宾夺主、不强行塞入。\n` +
      `- **唯一例外**：玩家本轮输入明确转向别处时以玩家为准（顺其自然写、系统会据正文重排路线）；除此之外都应朝当前环目标推进。\n` +
      `</当前任务>`,
  }];
}

/* ════════ 🛤 原著路线注入（仅模式开启且身在当前站世界时） ════════ */

/** 站内判定统一走 systems/canonRoute.activeCanonStation（注入/向量剧透闸共用同一口径） */
const inCanonStationWorld = activeCanonStation;

/** 苏晓本站入场实力基准 = 上一站离世定格 + 站间乐园变化；首站为初始新人 */
function suxiaoEntryBasis(idx: number): string {
  const prev = idx > 0 ? CANON_STATIONS[idx - 1] : undefined;
  if (!prev) return 'LV.1 新人猎杀者：六维凡人级（力6 敏7 体5 智6 魅3 幸1 上下）、持「斩龙闪（白·稀有）」与「亡妻的项坠」、天赋噬灵者、尚无职业与技能';
  const e = prev.suxiao.exit;
  const a = e.attrs;
  const attrs = a ? `六维 力${a.力量 ?? '?'} 敏${a.敏捷 ?? '?'} 体${a.体力 ?? '?'} 智${a.智力 ?? '?'} 魅${a.魅力 ?? '?'} 幸${a.幸运 ?? '?'}` : '';
  const bits = [e.lv != null ? `Lv.${e.lv}` : '', e.realm || '', attrs].filter(Boolean).join(' · ');
  const after = prev.suxiao.paradiseAfter ? `；站间乐园变化：${prev.suxiao.paradiseAfter.slice(0, 300)}` : '';
  return `上一站《${prev.name}》离世定格（${bits}）${after}`;
}

/** <原著路线·本站剧本>：时间轴窗口 + 世界规则 + 原著任务参照 + 结算基准 + 原著惯性铁则 */
export function buildCanonWorldInjection(): { role: 'system'; content: string }[] {
  const hit = inCanonStationWorld();
  if (!hit) return [];
  const s = hit.station;
  const st = useCanonRoute.getState();
  const total = Math.max(1, s.suxiao.track.length);
  const phase = Math.min(Math.max(1, st.worldPhase), total);
  const from = Math.max(0, phase - 3), to = Math.min(total, phase + 2);
  const axis = s.suxiao.track.slice(from, to).map((p, i) => {
    const n = from + i + 1;
    const mark = n < phase ? '✓' : n === phase ? '▶' : '·';
    return `${mark} ${n}. ${p.title}${p.chapters ? `（${p.chapters}）` : ''}${p.note ? ` — ${p.note}` : ''}`;
  });
  const tailN = total - to;
  const extras = [...(s.world.sideMissions ?? []), ...(s.world.triggerQuests ?? [])].slice(0, 6);
  const lines = [
    `第${s.order}站《${s.name}》（${s.volume}卷·${s.stationType}）· 原著时间轴阶段 ${phase}/${total}`,
    s.world.era ? `■ 时间点锚定：${s.world.era}` : '',
    s.world.rules ? `■ 世界规则：${s.world.rules}` : '',
    `■ 原著大事轴（苏晓的轨道＝世界惯性·无人干涉则按此推进）：\n${from > 0 ? `（前 ${from} 阶段已过）\n` : ''}${axis.join('\n')}${tailN > 0 ? `\n（后续还有 ${tailN} 阶段·勿剧透）` : ''}`,
    s.world.mainMission ? `■ 原著任务参照（苏晓的任务·玩家主线与之同场交叉但独立）：${s.world.mainMission}${s.world.mainReward ? `（原著奖励：${s.world.mainReward}）` : ''}` : '',
    extras.length ? `■ 原著支线/隐藏/猎杀线索（真实存在于本世界·玩家可循迹亦可无视）：\n${extras.map((x) => `- ${x}`).join('\n')}` : '',
    s.world.npcRoster?.length
      ? `■ 原著同期人物名册（这些人此刻真实存在于本世界·可自然登场、可遇可用；其既定轨迹随原著惯性推进、玩家可干涉改写；名册与人物底细【绝不向玩家整体罗列或剧透】）：\n${s.world.npcRoster.map((r) => `${r.name}${r.brief ? `（${r.brief}）` : ''}`).join('、')}`
      : '',
    (s.suxiao.settle?.sourcePct != null || s.suxiao.settle?.rating)
      ? `■ 结算基准：白夜本站成绩 ${[s.suxiao.settle?.sourcePct != null ? `世界之源 ${s.suxiao.settle.sourcePct}%` : '', s.suxiao.settle?.rating || ''].filter(Boolean).join(' · ')}`
      : '',
    (() => { const rel = ensureQuestRelation(hit.idx); return `■ 本站任务关系（掷定·全站固定）：${rel} —— ${QUEST_REL_TEXT[rel]}`; })(),
  ].filter(Boolean);
  return [{
    role: 'system' as const,
    content: `<原著路线·本站剧本>（GM 内部参照——绝不向玩家复述、罗列或剧透本块内容）\n${lines.join('\n')}\n${getPrompt('CANON_INERTIA_RULE', CANON_INERTIA_RULE)}\n</原著路线·本站剧本>`,
  }];
}

/** <苏晓轨道>：同世界猎杀者「白夜」的当前状态卡（轨道态/脱轨/同盟/已陨落） */
export function buildSuxiaoTrackInjection(): { role: 'system'; content: string }[] {
  const hit = inCanonStationWorld();
  if (!hit) return [];
  const st = useCanonRoute.getState();
  const s = hit.station;
  if (st.suxiao.state === 'dead') {
    return [{
      role: 'system' as const,
      content: `<苏晓轨道>（原著猎杀者「白夜」已陨落——本站及之后不再有他的原著轨道；他原本会做的事无人去做，世界按现状自洽演化，可自然呈现他缺席造成的涟漪）</苏晓轨道>`,
    }];
  }
  const total = Math.max(1, s.suxiao.track.length);
  const phase = Math.min(Math.max(1, st.worldPhase), total);
  const cur = s.suxiao.track[phase - 1];
  const curTxt = cur ? `${cur.title}${cur.chapters ? `（${cur.chapters}）` : ''}${cur.note ? ` — ${cur.note}` : ''}` : '（本站轨道已走完·收尾/离世阶段）';
  const stateLine = st.suxiao.state === 'derailed'
    ? `【已脱轨】玩家已实质干涉他的原著轨道${st.suxiao.derailedAt ? `（${st.suxiao.derailedAt}）` : ''}——此后他不再照原著行动，按人设、目标与利害自由决策${st.suxiao.note ? `。当前动向：${st.suxiao.note}` : ''}`
    : st.suxiao.state === 'allied'
      ? `【与主角同盟】仍大体沿原著轨道推进自己的任务。当前阶段：${curTxt}`
      : `【按原著轨道行动中】当前阶段：${curTxt}`;
  const home = (usePlayer.getState().profile.homeParadise || '轮回乐园').trim();
  const lines = [
    `身份：轮回乐园猎杀者「${s.suxiao.alias}」（真名苏晓·在本世界用化名行事）`,
    `人设：${CANON_SUXIAO.persona.replace(/\n/g, ' ')}`,
    `本站入场实力基准：${suxiaoEntryBasis(hit.idx)}`,
    stateLine,
    home !== '轮回乐园'
      ? `立场加剧：主角隶属「${home}」（非轮回乐园）——白夜天然视其为他乐园竞争者，警惕与算计基线更高、绝不透底；若主角行为触犯轮回乐园规则沦为违规者，白夜的猎杀任务可能直接指向主角。`
      : '',
  ].filter(Boolean);
  return [{
    role: 'system' as const,
    content: `<苏晓轨道>（同世界的另一位猎杀者·GM 内部参照，勿向玩家复述）\n${lines.join('\n')}\n${getPrompt('SUXIAO_PERSONA_RULE', SUXIAO_PERSONA_RULE)}\n</苏晓轨道>`,
  }];
}
