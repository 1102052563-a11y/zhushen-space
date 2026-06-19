// 正文系统提示·注入块构建器（从 App.tsx 抽出；纯读 store，不依赖组件 state）。
// 每个返回 {role:'system',content}[]，由 callApi 拼进 sysPrompt 前。门控各看自己的开关。
import { useSettings } from '../store/settingsStore';
import { useFanfic } from '../store/fanficStore';
import { useFact } from '../store/factStore';
import { useCosmos, cosmosNameEq, cleanCosmosName, type CosmosEntity } from '../store/cosmosStore';
import { useMisc } from '../store/miscStore';
import { usePlayer } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useNpc } from '../store/npcStore';
import { playerMaxHp, playerMaxEp } from './playerVitals';
import { effectiveResource } from './derivedStats';
import { serializeQuestsForNarrative } from './miscParser';
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

/* <当前时空> 注入正文：把「杂项」的两个时间——轮回历(乐园时间) 与 世界时间——连同当前世界名常驻注入，
   让写正文的 AI 始终知道此刻是什么时间、在哪个世界，叙事不与之矛盾（结构化召回里没有时间，故独立注入）。
   时间都未设定时不注入。时间推进仍由「杂项演化」结算，正文只读不改。 */
export function buildWorldTimeInjection(): { role: 'system'; content: string }[] {
  const M = useMisc.getState();
  const pt = (M.paradiseTime || '').trim();
  const wt = (M.worldTime || '').trim();
  const wn = (M.worldName || '').trim();
  if (!pt && !wt) return [];   // 两个时间都没设就不注入
  const bits = [
    wn && `当前世界:${wn}`,
    pt && `轮回历·乐园时间:${pt}`,
    wt && `当前世界时间:${wt}`,
  ].filter(Boolean);
  return [{
    role: 'system' as const,
    content: `<当前时空>（叙事须与下列时间/世界保持一致，勿自相矛盾；时间由系统推进，正文勿擅自跳改）\n${bits.join(' | ')}\n</当前时空>`,
  }];
}

/* <当前任务> 注入正文：主线(重·当前目标+下一步+终局，作叙事节奏锚点) + 相关支线(轻·限量)。
   解决"主线没存在感、要手动口胡才回归"——把任务面板回流进正文生成上下文。 */
export function buildQuestInjection(): { role: 'system'; content: string }[] {
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
