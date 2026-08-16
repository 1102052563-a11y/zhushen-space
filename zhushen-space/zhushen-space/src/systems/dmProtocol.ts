/* 私信回复行协议解析（借鉴 Abstract外置手机的消息类型思想·代码全自写）。
   AI 按行协议输出：状态/心声 是状态头，说/撤回/引用/戳 是消息行；
   任何不匹配协议前缀的行都归并进当前纯文本消息（容错优先——解析不出协议时整段当一条纯文本，绝不丢内容）。*/
import type { DmMsgKind, DmMsgMeta } from '../store/dmStore';

export interface ParsedDmMsg { kind: DmMsgKind; text: string; orig?: string; quote?: string }
export interface ParsedDmReply { meta?: DmMsgMeta; msgs: ParsedDmMsg[] }

const MAX_MSGS = 4;          // 一轮回复消息条数硬上限（防刷屏；与提示词口径一致）
const MAX_LEN = 600;         // 单条消息长度上限（沿用 dmReply 原 slice 口径）

/* 行首字段匹配：全/半角冒号皆可，字段名后允许空白 */
function fieldOf(line: string): { key: string; val: string } | null {
  const m = /^(状态|心声|说|撤回|引用|戳|贴)\s*[:：]\s*(.*)$/.exec(line.trim());
  return m ? { key: m[1], val: m[2].trim() } : null;
}

/* 状态行「情绪｜地点｜现状」：｜ / | 都认；段数不足时从后往前对齐（只给一段=现状）*/
function parseStateLine(val: string): DmMsgMeta {
  const parts = val.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { emotion: parts[0], location: parts[1], state: parts.slice(2).join('，') };
  if (parts.length === 2) return { emotion: parts[0], state: parts[1] };
  if (parts.length === 1) return { state: parts[0] };
  return {};
}

export function parseDmReply(raw: string): ParsedDmReply {
  const text = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();   // 剥代码围栏
  if (!text) return { msgs: [] };
  const meta: DmMsgMeta = {};
  const msgs: ParsedDmMsg[] = [];
  let plainBuf: string[] = [];   // 连续的非协议行 → 归并成一条纯文本
  const flushPlain = () => {
    const t = plainBuf.join('\n').trim();
    plainBuf = [];
    if (t) msgs.push({ kind: 'text', text: t.slice(0, MAX_LEN) });
  };

  for (const line of text.split('\n')) {
    const f = fieldOf(line);
    if (!f) { if (line.trim()) plainBuf.push(line); continue; }
    flushPlain();
    switch (f.key) {
      case '状态': Object.assign(meta, parseStateLine(f.val)); break;
      case '心声': if (f.val) meta.thought = f.val.slice(0, 120); break;
      case '说':   if (f.val) msgs.push({ kind: 'text', text: f.val.slice(0, MAX_LEN) }); break;
      case '贴':   if (f.val) msgs.push({ kind: 'sticker', text: f.val.slice(0, 30) }); break;   // 表情包（text=名称·消费侧按库硬过滤）
      case '撤回': if (f.val) msgs.push({ kind: 'recalled', text: '撤回了一条消息', orig: f.val.slice(0, MAX_LEN) }); break;
      case '戳':   msgs.push({ kind: 'poke', text: '' }); break;
      case '引用': {
        // 「被引用原话 => 回应」；分隔符 => / ⇒ / →；缺分隔符时整行当回应、不带引用块
        const m = /^(.*?)\s*(?:=>|⇒|→)\s*(.+)$/.exec(f.val);
        if (m && m[2].trim()) msgs.push({ kind: 'quote', text: m[2].trim().slice(0, MAX_LEN), quote: m[1].trim().slice(0, 200) || undefined });
        else if (f.val) msgs.push({ kind: 'text', text: f.val.slice(0, MAX_LEN) });
        break;
      }
    }
  }
  flushPlain();

  // 去重压条：戳最多 1 条、撤回最多 1 条（提示词口径），总数夹到上限（保头部——状态头之后最先说的最要紧）
  let pokeSeen = false, recallSeen = false;
  const dedup = msgs.filter((m) => {
    if (m.kind === 'poke') { if (pokeSeen) return false; pokeSeen = true; }
    if (m.kind === 'recalled') { if (recallSeen) return false; recallSeen = true; }
    return true;
  }).slice(0, MAX_MSGS);

  const hasMeta = !!(meta.emotion || meta.location || meta.state || meta.thought);
  // 全文没解析出任何消息（AI 没按协议来）→ 整段当一条纯文本，绝不丢回复
  if (!dedup.length) {
    const fallback = text.trim().slice(0, MAX_LEN);
    return { meta: hasMeta ? meta : undefined, msgs: fallback ? [{ kind: 'text', text: fallback }] : [] };
  }
  return { meta: hasMeta ? meta : undefined, msgs: dedup };
}

/* 历史压缩：带花样的消息喂回 AI 时压成一行方括号标记（借鉴外置手机 formatMessageForPrompt）。
   撤回的消息 NPC 自己知道原文（是他撤的），主角侧历史只有占位。*/
export function dmMsgToHistoryText(m: { kind?: DmMsgKind; text: string; orig?: string; quote?: string }): string {
  if (m.kind === 'recalled') return `[你撤回的消息] ${m.orig || ''}`.trim();
  if (m.kind === 'poke') return '[你戳了戳对方]';
  if (m.kind === 'quote') return m.quote ? `[引用「${m.quote}」] ${m.text}` : m.text;
  if (m.kind === 'sticker') return `[表情包] ${m.text}`;
  return m.text;
}
