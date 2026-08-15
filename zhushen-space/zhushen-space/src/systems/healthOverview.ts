/* ── 🩺 运行概览 · 健康检查（借鉴 ACU 仪表盘 dashboard-copy 的思路）────────────
   把散落各处的诊断（回合事务报告 / 填表失败清单 / 积压检测 / 看门狗 / 接口配置）聚合成
   一眼可读的 绿/琥珀/红 行 + 行动指引；再把最近失败明细自动归因成
   「API 连接 / 输出格式 / 指令应用被拦」三桶（ACU 的 apiIssue/outputFormatIssue/commandParseIssue 同款思想）。
   纯读取、零副作用；UI 在 components/HealthOverview.tsx（变量管理页顶部）。 */
import { useSettings } from '../store/settingsStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useTurnReport } from '../store/turnReportStore';
import { runWatchdogs } from './ledger/watchdog';
import { chronicleFillBacklog } from './tablePrompt';

export interface HealthRow { level: 'ok' | 'warn' | 'bad'; icon: string; title: string; text: string }

/** 最近 N 条回合报告（诊断窗口）。 */
const RECENT_N = 10;

/** 收集最近的失败明细（归因用）：填表遗留失败 + 回合报告里的 state/填表/物品失败。 */
export function collectRecentFailures(): string[] {
  const out: string[] = [];
  try { out.push(...useTableJournal.getState().lastErrors); } catch { /* */ }
  try {
    for (const r of useTurnReport.getState().records.slice(-RECENT_N)) {
      out.push(...r.stateFailed, ...r.tableFailed, ...r.itemRejected);
    }
  } catch { /* */ }
  return out;
}

export interface FailureBucket { bucket: 'api' | 'format' | 'apply' | 'other'; label: string; count: number; hint: string; example: string }

/** 失败归因（借鉴 ACU 日志五类归因文案范式）：按特征词把失败明细分桶，各给一句行动指引。 */
export function classifyFailures(errs: string[]): FailureBucket[] {
  const defs: { bucket: FailureBucket['bucket']; label: string; re: RegExp; hint: string }[] = [
    { bucket: 'api',    label: 'API 连接',  re: /超时|timeout|abort|401|403|429|5\d\d|网络|连接|fetch|接口.*(失败|错误)|ECONN/i,
      hint: '指向接口连接/配额问题——检查对应功能的接口路由、密钥与模型名（设置→API / 接口路由）。' },
    { bucket: 'format', label: '输出格式', re: /解析|JSON|格式|数据无效|表未匹配|参数无效|引号|逗号|tableEdit/i,
      hint: '指向 AI 没按格式吐指令——失败清单会自动回喂让它下回合修正；频繁出现可给填表/演化换个更听话的模型。' },
    { bucket: 'apply',  label: '指令被拦', re: /未命中|被拒|锁定|不可变|单行表|行号|白名单|阈值/i,
      hint: '指向护栏拦截——多数是预期行为（锁定行 🔒 / 不可变表 / 行号写错），错误已回喂 AI 自纠，无需处理。' },
  ];
  const hit: Record<string, { count: number; example: string }> = {};
  for (const e of errs) {
    const s = String(e ?? '');
    const d = defs.find((x) => x.re.test(s));
    const key = d?.bucket ?? 'other';
    if (!hit[key]) hit[key] = { count: 0, example: s };
    hit[key].count++;
  }
  const out: FailureBucket[] = [];
  for (const d of defs) {
    const h = hit[d.bucket];
    if (h) out.push({ bucket: d.bucket, label: d.label, count: h.count, hint: d.hint, example: h.example.slice(0, 90) });
  }
  if (hit.other) out.push({ bucket: 'other', label: '其他', count: hit.other.count, hint: '未归类失败——去 表格数据库→📋 变量事务报告 看完整明细。', example: hit.other.example.slice(0, 90) });
  return out.sort((a, b) => b.count - a.count);
}

/** 聚合健康行（绿/琥珀/红 + 行动指引）。读当前各 store 现算，无缓存。 */
export function buildHealthRows(): HealthRow[] {
  const rows: HealthRow[] = [];

  // ① 正文接口配置（ACU 仪表盘「API 未配置」同款检查——一切生成的前提）
  try {
    const ss = useSettings.getState();
    const api = ss.textUseSharedApi ? ss.api : ss.textApi;
    if (!api?.baseUrl || !api?.apiKey) {
      rows.push({ level: 'bad', icon: '🔌', title: '正文接口', text: '未配置（缺 baseUrl / apiKey）——去 设置→正文生成 配接口，或勾「共用全局 API」。没有它所有生成都发不出去。' });
    } else {
      rows.push({ level: 'ok', icon: '🔌', title: '正文接口', text: `已配置${api.modelId ? `（${api.modelId}）` : '（未填模型名·部分服务会拒绝）'}。` });
    }
  } catch { /* */ }

  // ② 填表健康：遗留失败 > 纪要断更 > 正常
  try {
    const J = useTableJournal.getState();
    const recent = useTurnReport.getState().records.slice(-RECENT_N);
    const backlog = chronicleFillBacklog();
    const tApplied = recent.reduce((n, r) => n + r.tableApplied, 0);
    if (J.lastErrors.length) {
      rows.push({ level: 'warn', icon: '🗂', title: '填表', text: `上批 ${J.lastErrors.length} 条指令失败（第 ${J.lastErrorsTurn} 回合·已排队下回合自动回喂修正）。首条：${J.lastErrors[0].slice(0, 80)}` });
    } else if (backlog?.overdue) {
      rows.push({ level: 'warn', icon: '🗂', title: '填表', text: `纪要疑似断更：${backlog.gap} 回合没入账（最后记在第 ${backlog.lastTurn} 回合）——对话界面 ♻（重算变量）→「🗂 填表」按楼层补记。` });
    } else {
      rows.push({ level: 'ok', icon: '🗂', title: '填表', text: recent.length ? `正常（最近 ${recent.length} 条报告 · 应用 ${tApplied} 条指令 · 无遗留失败）。` : '本次会话暂无填表活动（发一回合后这里出数据）。' });
    }
  } catch { /* */ }

  // ③ <state> 状态指令
  try {
    const recent = useTurnReport.getState().records.slice(-RECENT_N);
    const failed = recent.flatMap((r) => r.stateFailed);
    const applied = recent.reduce((n, r) => n + r.stateApplied, 0);
    if (failed.length) {
      rows.push({ level: 'warn', icon: '📥', title: '状态指令', text: `最近 ${failed.length} 条 <state> 未生效（常见：键名写错 / 编号不在在场白名单）。首条：${failed[0].slice(0, 80)}` });
    } else {
      rows.push({ level: 'ok', icon: '📥', title: '状态指令', text: recent.length ? `正常（最近应用 ${applied} 条）。` : '本次会话暂无状态更新。' });
    }
  } catch { /* */ }

  // ④ 数据一致性（看门狗：漂移/幽灵/双计/槽冲突）
  try {
    const bad = runWatchdogs().filter((r) => r.violations.length > 0);
    if (bad.length) {
      rows.push({ level: 'warn', icon: '🛡', title: '一致性', text: `${bad.map((r) => `【${r.domain}】${r.violations[0]}`).join('；').slice(0, 140)}——表格数据库页「🩹 立即自愈」一键修。` });
    } else {
      rows.push({ level: 'ok', icon: '🛡', title: '一致性', text: '货币 / 物品 / NPC 看门狗一致（无漂移 · 无幽灵 · 无双计 · 无槽冲突）。' });
    }
  } catch { /* */ }

  return rows;
}
