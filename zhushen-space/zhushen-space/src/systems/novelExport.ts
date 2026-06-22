// 把当前对话历史导出成「小说形式」的 TXT（自动分章：第一章 / 第二章 …）。
// 仅保留剧情正文：剥掉游戏数据块（<世界结算>/<检定结果>/<状态结算>…）、结算/日志卡片（【…结算…】+ > 引用块）、HTML 卡片标记与 markdown。
// 玩家行动以「▷」标出，AI 正文作为故事主体。放在 存档管理（SaveLoadPanel）里调用。
import { usePlayer } from '../store/playerStore';

export interface NovelMsg { role: string; content: string }
export interface NovelOpts { includePlayer?: boolean; charsPerChapter?: number }

// 数字 → 中文章节序号（支持到几百章，足够）
function cnNum(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + d[n % 10];
  if (n < 100) { const t = Math.floor(n / 10), o = n % 10; return d[t] + '十' + (o ? d[o] : ''); }
  const h = Math.floor(n / 100), r = n % 100;
  let s = d[h] + '百';
  if (r === 0) return s;
  if (r < 10) return s + '零' + d[r];
  if (r === 10) return s + '一十';
  if (r < 20) return s + '一十' + d[r % 10];
  return s + d[Math.floor(r / 10)] + '十' + (r % 10 ? d[r % 10] : '');
}

// 模块结算/日志块标题（与 narrativeHtml.ts 的识别保持一致）：以这类【…】开头的行属于游戏数据，导出小说时删掉
const SETTLE_HEADER_RE = /^\s*\*{0,2}\s*【[^】]*(结算|日志|战报|战斗|掉落|奖励|登场|离场|信息卡|资源|敌方|环境效果|判定|目标|提示|任务|成长|装备替换|获得|获取|入手|拾取|战利品|开启|物品|宝箱|商店|交易|购买)[^】]*】/;

// 单条消息 → 干净小说正文
export function toProse(content: string): string {
  let s = content || '';
  // 成对游戏数据块整段删（含内文）
  s = s.replace(/<世界结算>[\s\S]*?<\/世界结算>/gi, '')
    .replace(/<检定结果>[\s\S]*?<\/检定结果>/gi, '')
    .replace(/<(状态结算|世界源|击杀结算|battle|image)>[\s\S]*?<\/\1>/gi, '');
  // 残留的任意尖括号标签（ST 正则输出的 HTML 卡片 / 自闭合标签 / 漏网标签）
  s = s.replace(/<\/?[a-zA-Z一-龥][^>]*>/g, '');
  // 行级清理：删 > / ＞ 引用结算块 + 以【…结算…】开头的标题块
  s = s.split('\n').filter((line) => {
    const t = line.trim();
    if (/^[>＞]/.test(t)) return false;
    if (SETTLE_HEADER_RE.test(t)) return false;
    return true;
  }).join('\n');
  // markdown 标题/强调符
  s = s.replace(/^#{1,6}\s*/gm, '').replace(/\*\*|__|~~|`/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2');
  // 收敛空白
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 每行缩进两个全角空格（小说排版）
function indent(block: string): string {
  return block.split('\n').map((l) => (l.trim() ? '　　' + l.trim() : '')).join('\n');
}

export function buildNovel(messages: NovelMsg[], opts: NovelOpts = {}): { text: string; chapters: number } {
  const includePlayer = opts.includePlayer !== false;
  const target = Math.max(800, opts.charsPerChapter ?? 3200);
  const name = (usePlayer.getState().profile?.name || '').trim() || '主角';

  // 整理成段落序列
  const paras: string[] = [];
  for (const m of messages || []) {
    if (!m || !m.content) continue;
    if (m.role === 'user') {
      if (!includePlayer) continue;
      const t = toProse(m.content).replace(/\n+/g, ' ').trim();
      if (t) paras.push('▷　' + t);     // 玩家行动：单段、▷ 标出
    } else if (m.role === 'assistant') {
      const t = toProse(m.content);
      if (t) paras.push(t);
    }
    // system 跳过
  }

  // 分章：累计字数到阈值就在段落边界断章
  const chapters: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const p of paras) {
    cur.push(p);
    curLen += p.length;
    if (curLen >= target) { chapters.push(cur); cur = []; curLen = 0; }
  }
  if (cur.length) chapters.push(cur);

  const date = new Date().toISOString().slice(0, 10);
  const head = `《${name}的轮回旅程》\n\n———— 轮回乐园 · 对话实录（${date}）————\n`;
  const body = chapters.length
    ? chapters.map((ps, i) => `\n\n　　第${cnNum(i + 1)}章\n\n` + ps.map(indent).join('\n\n')).join('')
    : '\n\n（暂无可导出的剧情正文）';
  return { text: head + body + '\n', chapters: chapters.length };
}

// 生成并触发浏览器下载，返回章数 / 字数（供 UI 提示）
export function exportNovelTxt(messages: NovelMsg[], opts?: NovelOpts): { chapters: number; chars: number } {
  const { text, chapters } = buildNovel(messages, opts);
  const name = (usePlayer.getState().profile?.name || '轮回乐园').trim() || '轮回乐园';
  const fname = `${name}·小说_${new Date().toISOString().slice(0, 10)}.txt`;
  const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });   // 加 BOM，Windows 记事本不乱码
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  return { chapters, chars: text.length };
}
