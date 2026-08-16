/* 👥 群聊回复行协议解析（借鉴 Abstract外置手机 group_message 思想·代码全自写）。
   AI 按「发言人|消息内容」一行一条输出；解析侧两道硬过滤（协议层兜底，不信模型自觉——借鉴其 filter(!msg.me)）：
   ① 禁代主角：发言人=主角名/主角/我 → 丢弃；② 成员白名单：发言人不在群成员名单 → 丢弃（防幻觉成员）。
   无竖线的行视为上一条消息的续行（多行消息容错）；一轮硬上限 8 条。 */

export interface GroupMsg { sender: string; text: string; kind?: 'sticker' }   // kind='sticker'：text=表情包名称（消费侧按库硬过滤）

const MAX_MSGS = 8;
const MAX_LEN = 400;

const norm = (s: string) => (s || '').replace(/\s+/g, '');

export function parseGroupReply(raw: string, opts: { playerName: string; memberNames: string[]; cap?: number }): GroupMsg[] {
  const text = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();
  if (!text) return [];
  const playerN = norm(opts.playerName);
  const members = opts.memberNames.map((n) => ({ raw: n, key: norm(n) })).filter((m) => !!m.key);
  const out: GroupMsg[] = [];
  let dropped = 0;

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('<!--') || t.startsWith('//')) continue;
    const m = /^(.{1,24}?)\s*[|｜]\s*(.+)$/.exec(t);
    if (!m) {
      // 无竖线：并进上一条（多行消息）；没有上一条就丢；表情包消息不吸收续行（会污染名称）
      const last = out[out.length - 1];
      if (last && last.kind !== 'sticker') last.text = (last.text + '\n' + t).slice(0, MAX_LEN);
      continue;
    }
    const senderKey = norm(m[1]);
    const body = m[2].trim();
    if (!senderKey || !body) continue;
    if (senderKey === playerN || senderKey === '主角' || senderKey === '我') { dropped++; continue; }   // 禁代主角
    const hit = members.find((x) => x.key === senderKey);
    if (!hit) { dropped++; continue; }   // 成员白名单（防幻觉成员/示例行）
    // 😊 表情包：内容形如「贴: 名称」→ sticker（名称有效性由消费侧按库硬过滤）
    const st = /^贴\s*[:：]\s*(.+)$/.exec(body);
    if (st) out.push({ sender: hit.raw, text: st[1].trim().slice(0, 30), kind: 'sticker' });
    else out.push({ sender: hit.raw, text: body.slice(0, MAX_LEN) });
    if (out.length >= (opts.cap ?? MAX_MSGS)) break;
  }
  if (dropped) console.warn(`[群聊] 硬过滤丢弃 ${dropped} 条（冒充主角/名单外发言人）`);
  return out;
}

/* 历史压缩：群消息喂回 AI 时统一成「名字: 内容」单行（主角消息由调用方冠名）*/
export function groupMsgToHistoryText(senderName: string, text: string): string {
  return `${senderName}: ${String(text).replace(/\n+/g, ' ')}`;
}
