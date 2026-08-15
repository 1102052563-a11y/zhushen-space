/* 📨 NPC 主动来讯（借鉴 Abstract外置手机 <send_message> 意图两阶段思想·代码全自写）。
   流程：正文 AI 在正文尾附 <通讯> 意图块（谁想发讯+动机+一句大意）→ inlineComm 演化阶段解析后，
   走私信链路二次生成具体讯息落 DmPanel（红点提醒）。主模型只出意图不写讯息正文，格式可控且省 token。
   护栏：白名单（isDmableTag：随从/契约者/宠物）+ 仅离场 + 每回合≤1 + 注入侧冷却（everyN 回合内不再注入规则，AI 拿不到规则就发不了）。
   ⚠<通讯> 行格式与 promptRules.INLINE_COMM_RULE 同口径，别单改一边；块由 stateParser.stripStateBlocks 从展示/历史/演化文本剥离。 */
import { isDmableTag } from '../store/dmStore';
import { useSettings } from '../store/settingsStore';
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { INLINE_COMM_RULE } from '../promptRules';

export interface CommIntent {
  kind: '私信';
  sender: string;   // 发送人姓名（须命中白名单，消费端再核验一遍——防 AI 点名单外的人）
  reason: string;   // 一句发讯动机
  gist: string;     // 一句话内容大意
}

/* 从含指令原文里解析 <通讯> 意图块。容错：
   - 闭合/未闭合（流截断）两种形态都认；
   - 行内分隔符 | 与全角 ｜ 都认；
   - 段数不足（<3 段）当提示词示例/误匹配丢弃（示例污染防御——借鉴外置手机"管道数不足即忽略"）；
   - 注释行（# 或 <!--）跳过。 */
export function parseCommIntents(raw: string): CommIntent[] {
  const text = String(raw || '');
  const bodies: string[] = [];
  // ⚠ 不能用 \b：JS 词边界按 ASCII \w 定义，跟在 CJK 字符后永远不成立（<通讯\b 死活匹配不上）
  const re = /<通讯[^>]*>([\s\S]*?)<\/通讯>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) bodies.push(m[1]);
  if (!bodies.length) {
    const tail = /<通讯[^>]*>([\s\S]*)$/i.exec(text);
    if (tail) bodies.push(tail[1]);
  }
  const out: CommIntent[] = [];
  for (const body of bodies) {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('<!--') || t.startsWith('//')) continue;
      const parts = t.split(/[|｜]/).map((s) => s.trim());
      if (parts.length < 3) continue;                    // 示例/残行防御
      if (parts[0] !== '私信') continue;                 // 目前只支持私信（群聊留给 P1）
      const sender = parts[1];
      const reason = parts.length >= 4 ? parts[2] : '';
      const gist = parts.length >= 4 ? parts.slice(3).join('，') : parts[2];
      if (!sender || !gist) continue;
      out.push({ kind: '私信', sender: sender.slice(0, 30), reason: reason.slice(0, 60), gist: gist.slice(0, 120) });
    }
  }
  return out;
}

/* 展示/历史侧剥离（与 stripStateBlocks 同风格：闭合 + 截断未闭合两种形态）*/
export function stripCommBlocks(text: string): string {
  return text
    .replace(/<通讯[^>]*>[\s\S]*?<\/通讯>/gi, '')
    .replace(/<通讯[^>]*>[\s\S]*$/i, '');
}

/* 可来讯名单：白名单 tag（随从/契约者/宠物）+ 离场 + 活着 + 未归档。
   favor 降序取前 cap 个（关系近的优先拿到"发讯权"）。 */
export interface CommNpcLite { id: string; name?: string; npcTag?: string; onScene?: boolean; isDead?: boolean; archived?: boolean; favor?: number }
export function eligibleCommNpcs<T extends CommNpcLite>(npcs: Record<string, T>, cap = 10): T[] {
  return Object.values(npcs)
    .filter((n) => n && !!(n.name || '').trim() && isDmableTag(n.npcTag) && !n.onScene && !n.isDead && !n.archived)
    .sort((a, b) => (b.favor ?? 0) - (a.favor ?? 0))
    .slice(0, cap);
}

/* 注入侧冷却（模块级会话状态：刷新即重置——最多多来一条，可接受）。
   规则不注入 → AI 压根写不出 <通讯> → 频控是确定性的，不靠模型自觉。 */
let lastFiredTurn = -Infinity;
export function noteInlineCommFired(turn: number): void { lastFiredTurn = turn; }
export function inlineCommCooldownOk(turn: number, everyN: number): boolean {
  return turn - lastFiredTurn >= Math.max(1, Math.floor(everyN || 1));
}
/* 测试用：重置冷却 */
export function resetInlineCommCooldown(): void { lastFiredTurn = -Infinity; }

/* 正文 sysPrompt 注入块：开关开 + 冷却过 + 白名单非空才出（否则零 token，AI 拿不到规则就不会写 <通讯>）*/
export function buildInlineCommInjection(): { role: 'system'; content: string }[] {
  const cfg = useSettings.getState().inlineComm;
  if (!cfg?.on) return [];
  if (!inlineCommCooldownOk(useMisc.getState().turnCount, cfg.everyN ?? 3)) return [];
  const roster = eligibleCommNpcs(useNpc.getState().npcs);
  if (!roster.length) return [];
  const names = roster.map((n) => (n.name || '').trim()).filter(Boolean).join('、');
  if (!names) return [];
  return [{ role: 'system', content: INLINE_COMM_RULE.replaceAll('${roster}', names) }];
}
