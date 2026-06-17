import type { WorldBook } from '../store/settingsStore';

/* 欢愉宫世界书注入 + 条目标题提取。
   注入规则与正文一致（App.callApi）：constant=蓝灯·常驻必注入；selective && key 命中 matchCtx=绿灯·关键词触发。
   matchCtx = 玩家本轮输入 + 最近若干条对话，lowercased。*/

/** 选中本轮要注入的世界书条目（蓝灯常驻 + 绿灯关键词命中）。*/
export function selectJoyWbEntries(books: WorldBook[], matchCtx: string) {
  const ctx = (matchCtx || '').toLowerCase();
  return (books ?? [])
    .filter((b) => b.enabled)
    .flatMap((b) => b.entries.filter((e) =>
      e.enabled && (
        e.constant ||                                            // 蓝灯：常驻
        (e.selective && e.key.some((k) => k && ctx.includes(k.toLowerCase())))  // 绿灯：关键词触发
      )
    ));
}

/** 拼成注入文本：每条 `[标题]\n内容`。无则空串。*/
export function buildJoyWbInjection(books: WorldBook[], matchCtx: string): string {
  const entries = selectJoyWbEntries(books, matchCtx);
  if (!entries.length) return '';
  const body = entries.map((e) => `[${e.comment}]\n${e.content}`).join('\n\n');
  return `【世界书·设定参考（融入演绎，勿照抄复述）】\n${body}`;
}

/* ── 快捷条目（姿势 / BDSM 按钮）：从条目标题里挑出"真正的项"，过滤掉分隔行/配置/触发器条目 ── */
function isQuickItem(comment: string): boolean {
  const c = (comment || '').trim();
  if (!c) return false;
  if (/^[-—<【(（]/.test(c)) return false;                       // 分隔线/标签/配置起手符
  if (/起$|止$/.test(c)) return false;                            // ---体位起/止、道具起/止
  if (/检测|联动|qr|无需|触发|随机|设定|不许|丰胸|撕衣|漏尿|超晕/i.test(c)) return false;  // 配置/触发器/约束条目
  return true;
}

/** 清掉标题里的配置注解 `{...}`（如 `捆绑方式{可改为蓝灯常驻}`→`捆绑方式`）；保留有意义的 `（别名）`（如 `正常（传教士）`）。*/
function cleanQuickTitle(comment: string): string {
  return (comment || '').replace(/\s*\{[^}]*\}\s*/g, '').trim();
}

/** 取某世界书里可作为快捷插入的条目标题列表（去重、保序、去配置注解）。*/
export function quickInsertTitles(book: WorldBook | undefined): string[] {
  if (!book) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of book.entries) {
    const raw = (e.comment || '').trim();
    if (!e.enabled || !isQuickItem(raw)) continue;
    const t = cleanQuickTitle(raw);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** 在世界书列表里按名字找「姿势」「BDSM」两本（用于包间快捷按钮）。*/
export function findJoyBook(books: WorldBook[], kind: 'pose' | 'bdsm'): WorldBook | undefined {
  const re = kind === 'pose' ? /姿势|体位/i : /BDSM|调教|束缚|捆绑/i;
  return (books ?? []).find((b) => re.test(b.name));
}
