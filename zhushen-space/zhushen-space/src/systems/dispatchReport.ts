/* ════════════════════════════════════════════
   派遣战报 —— 唯一花 token 的一步，且**只花在叙述上**

   账本（评级/伤亡/战利品/货币）已经由 `dispatchEngine.settleDispatch` 算死并封存，
   这里把它整份喂给 AI，要求"照着写散文，一个数字都别改"。理由见 dispatchEngine 铁则①：
   让 AI 同时决定"打赢没"和"掉了什么"＝每次派遣都通胀。

   **不是每回合的演化阶段**——一次派遣归来才调一次，token 随实际派遣次数走，不随回合数走。
   没配接口 / 调用失败 → 回落确定性文本（`fallbackReport`），零 token 也读得下去，
   不破坏轨道A「NPC 活着不花钱」那条承诺。
════════════════════════════════════════════ */
import { useTeam, type DispatchRecord } from '../store/adventureTeamStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useNpc } from '../store/npcStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { DISPATCH_REPORT_RULE } from './dispatchPrompts';

/** 组装喂给 AI 的「已定结算」——就是账本的可读版本 */
export function buildLedgerBrief(rec: DispatchRecord): string {
  const l = rec.ledger;
  if (!l) return '';
  const o = rec.offer;
  const npcs = useNpc.getState().npcs;
  const roster = l.members.map((m) => {
    const n = npcs[m.id];
    const who = `${m.name}（${n?.realm || '阶位不详'}${n?.profession ? '·' + n.profession : ''}）`;
    const bits = [m.note];
    if (m.dead) bits.push('★阵亡');
    else if (m.injured) bits.push(`★负伤：${m.injured}（需静养${m.injuryTurns}回合）`);
    if (m.lootName) bits.push(`★缴获：${m.lootName}`);
    return `- ${who}：${bits.join('　')}`;
  }).join('\n');

  return [
    `【委托】${o.title}`,
    o.employer ? `【雇主】${o.employer}` : '',
    o.brief ? `【背景】${o.brief}` : '',
    o.objective ? `【目标】${o.objective}` : '',
    o.risk ? `【已知风险】${o.risk}` : '',
    `【地点】${o.world}（${o.tier}阶危险度${o.danger >= 0.6 ? '·高' : o.danger >= 0.4 ? '·中' : '·低'}）`,
    `【历时】${o.turns} 回合${rec.startTime ? `（出发于 ${rec.startTime}）` : ''}`,
    `【冒险团】${useTeam.getState().name || '（未命名）'}`,
    '',
    '【已定结算】（不可改动）',
    `评级：${l.rating}　${l.success ? '委托达成' : '委托失利'}`,
    `进账：${l.currency.amount > 0 ? `${l.currency.amount} ${l.currency.kind}` : '无'}`,
    l.rewardGranted ? `委托酬劳：「${l.rewardGranted}」（已交割给主角，写战报时可提一句交接，**不得改名、不得再加别的酬劳**）` : '',
    l.casualties.length ? `阵亡：${l.casualties.join('、')}` : '阵亡：无',
    '',
    '【出勤成员与各自遭遇】',
    roster,
  ].join('\n');
}

/** 零 token 兜底：没接口/调用失败时也读得下去的确定性战报 */
export function fallbackReport(rec: DispatchRecord): string {
  const l = rec.ledger;
  if (!l) return '';
  const o = rec.offer;
  const lines: string[] = [
    `${rec.memberNames.join('、')}受命前往${o.world}，${o.title}。历经 ${o.turns} 回合，队伍归来——评级 ${l.rating}，${l.success ? '委托达成' : '委托失利'}。`,
  ];
  for (const m of l.members) lines.push(`· ${m.name}：${m.note}${m.lootName ? `缴获「${m.lootName}」。` : ''}`);
  if (l.currency.amount > 0) lines.push(`本次进账 ${l.currency.amount} ${l.currency.kind}。`);
  if (l.rewardGranted) lines.push(`委托酬劳「${l.rewardGranted}」已交割入库。`);
  if (l.casualties.length) lines.push(`折损：${l.casualties.join('、')}。`);
  return lines.join('\n');
}

/**
 * 生成一次派遣战报。**只对已封存（有 ledger）的记录有效**——未到点的记录连账本都没有，无从写起。
 * 结果直接写回 store（reportState: loading → ok/fail）。永不抛错。
 */
export async function generateDispatchReport(recId: string): Promise<void> {
  const T = useTeam.getState();
  const rec = T.dispatchHistory.find((r) => r.id === recId);
  if (!rec?.ledger) return;                                   // 封条未开＝无账本＝不生成（防提前偷看）
  if (rec.reportState === 'loading') return;

  T.setReport(recId, { reportState: 'loading', reportErr: '' });
  try {
    const ss = useSettings.getState();
    const legacy = T.dispatchUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : T.dispatchApi;
    const chain = resolveApiChain('dispatch', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置派遣战报接口');

    const player = usePlayer.getState().profile.name || '主角';
    const { content } = await apiChatFallback(chain, [
      { role: 'system', content: `${getPrompt('DISPATCH_REPORT_RULE', DISPATCH_REPORT_RULE)}\n\n（主角姓名：${player}，本次未随队出勤。）` },
      { role: 'user', content: `${buildLedgerBrief(rec)}\n\n请据此撰写战报正文（只输出正文，不要任何前后缀说明）。` },
    ], { timeoutMs: 120000, label: '派遣战报' });

    const text = (content || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) throw new Error('返回为空');
    useTeam.getState().setReport(recId, { report: text, reportState: 'ok', reportErr: '' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[派遣] 战报生成失败，回落确定性文本:', msg);
    useTeam.getState().setReport(recId, { report: fallbackReport(rec), reportState: 'fail', reportErr: msg.slice(0, 60) });
  }
}
