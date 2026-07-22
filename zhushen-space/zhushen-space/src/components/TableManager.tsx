/* 表格数据库 · 查看/编辑器（挂进 设置→变量管理）。
   直读 tableStore：选表 → 看/改单元格（updateCell）→ 加行(insertRow)/删行(deleteRow)。
   单行表（主角信息/世界状态）只能改、不能增删。青光主题。ACU 表数据库 Step 8（设计文档 §6）。 */
import { useState, useEffect, useMemo } from 'react';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useTurnReport } from '../store/turnReportStore';
import { useItems } from '../store/itemStore';
import { useNpc } from '../store/npcStore';
import { useSettings } from '../store/settingsStore';
import { migrateStoresToTables } from '../systems/tableMigrate';
import { seedWalletIfEmpty } from '../systems/ledger/walletCore';
import { runWatchdogs, healWatchdog } from '../systems/ledger/watchdog';
import StagedPersonaModal from './StagedPersonaModal';
import CustomTableModal from './CustomTableModal';
import ApiRoutePicker from './ApiRoutePicker';

export default function TableManager() {
  const [showPersona, setShowPersona] = useState(false);
  const [showNewTable, setShowNewTable] = useState(false);
  const tables = useTables((s) => s.tables);
  const insertRow = useTables((s) => s.insertRow);
  const updateCell = useTables((s) => s.updateCell);
  const deleteRow = useTables((s) => s.deleteRow);
  const resetAll = useTables((s) => s.resetAll);
  const [msg, setMsg] = useState('');
  const [healTick, setHealTick] = useState(0);   // 自愈后强制重跑看门狗：影子账本(itemCore/walletCore)不是 React 依赖，重播种不改 items/currency → 不 bump 就一直显示旧漂移

  // Step 10 状态对账·看门狗（可见化）：订阅货币/物品/NPC，任一变化即重算，漂移/幽灵/双计/装备槽冲突当场显
  const currency = useItems((s) => s.currency);
  const items = useItems((s) => s.items);
  const npcs = useNpc((s) => s.npcs);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时播种一次影子钱包（列入 currency 会每次变动重播）
  useEffect(() => { seedWalletIfEmpty(currency as unknown as Record<string, number>); }, []);   // 货币影子对齐
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runWatchdogs 直读 store，依赖数组全部是刻意失效触发器（healTick 见上方注释）
  const watch = useMemo(() => runWatchdogs(), [currency, items, npcs, healTick]);
  const watchBad = watch.filter((r) => r.violations.length > 0);

  const sheets = Object.values(tables).sort((a, b) => a.orderNo - b.orderNo);
  const [uid, setUid] = useState<string>(sheets[0]?.uid ?? '');
  const sheet = tables[uid] ?? sheets[0];
  if (!sheet) return <div className="text-dim/60 text-sm">（无表）</div>;

  const headers = sheet.content[0]?.slice(1) ?? [];
  const dataRows = sheet.content.slice(1);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Step 10 状态对账 · 看门狗（货币/物品/NPC 可见化）+ 手动自愈 */}
      <div className={`flex items-center gap-2 text-[11px] rounded-lg border px-2.5 py-1.5 ${watchBad.length === 0 ? 'border-emerald-700/40 text-emerald-300/70' : 'border-amber-600/50 text-amber-300/90'}`}>
        <span className="flex-1 min-w-0">🛡 状态对账 · 看门狗（Step 10）：{watchBad.length === 0
          ? '✓ 货币 / 物品 / NPC 一致（无漂移 · 无幽灵 · 无双计 · 无槽冲突）'
          : watchBad.map((r) => `【${r.domain}】${r.violations.join('，')}`).join('　　')}</span>
        <button
          onClick={() => {
            const h = healWatchdog();
            setHealTick((t) => t + 1);   // 重跑看门狗，让自愈后的一致态立刻反映到面板（否则漂移条目会一直挂着看似没修）
            const parts = [
              h.driftRealigned > 0 && `漂移对齐 ${h.driftRealigned}`,
              h.itemDeduped > 0 && `物品去重 ${h.itemDeduped}`,
              h.npcDeduped > 0 && `NPC 去重 ${h.npcDeduped}`,
              h.npcAliasMerged > 0 && `别名合并 ${h.npcAliasMerged}`,
            ].filter(Boolean);
            setMsg(h.healed ? `🩹 已自愈：${parts.join(' · ')}` : '🩹 无需自愈（当前已一致）');
            setTimeout(() => setMsg(''), 6000);
          }}
          className="shrink-0 px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 transition-colors"
          title="立即把「数量/货币漂移」按背包·钱包真相重新对齐 + 就地合并同名物品/NPC/别名/储存空间的重复项"
        >
          🩹 立即自愈
        </button>
      </div>

      {/* 📋 回合级变量事务报告 + 表编辑流水（删除找回） */}
      <TurnReportPanel />

      {/* 工具：分阶段人设生成器 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowPersona(true)}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-god/40 text-god hover:bg-god/10 transition-colors"
          title="按属性表数值自动切换人设/语气——表单生成条件块，粘进正文预设/世界书即可"
        >
          🎭 分阶段人设生成器
        </button>
        <button
          onClick={() => setShowNewTable(true)}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-god/40 text-god hover:bg-god/10 transition-colors"
          title="建一张 AI 每回合自动维护的自定义表（维护规则固定·行随剧情变）"
        >
          ➕ 新建自定义表
        </button>
        <span className="text-[10px] text-dim/50">属性阈值→换人设 · 自定义表=AI 据固定维护规则维护的可变数据</span>
      </div>

      {/* 填表调度 */}
      <TableFillSchedule />

      {/* 表选择 */}
      <div className="flex flex-wrap gap-1.5">
        {sheets.map((s) => (
          <button
            key={s.uid}
            onClick={() => setUid(s.uid)}
            className={`px-2.5 py-1 rounded-lg border text-[12px] font-mono transition-colors ${
              s.uid === uid ? 'border-god/60 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-slate-200'
            }`}
          >
            {s.name}
            <span className="text-dim/50 ml-1">{s.single ? '·单行' : `·${s.content.length - 1}`}</span>
          </button>
        ))}
      </div>

      {/* 说明 */}
      {sheet.sourceData?.note && (
        <p className="text-[11px] text-dim/60 leading-relaxed border-l-2 border-god/30 pl-2.5">
          {sheet.name}{sheet.single ? '（单行表·只改不增删）' : '（多行表）'}：{sheet.sourceData.note}
        </p>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto rounded-lg border border-edge/60 bg-black/10">
        <table className="text-[12px] w-full border-collapse">
          <thead>
            <tr className="bg-black/30">
              <th className="px-2 py-1.5 text-dim/45 font-mono text-left w-10" title="行的永久编号（row_id）：AI 填表按它引用行，删行不位移不复用">编号</th>
              {headers.map((h) => (
                <th key={h} className="px-2 py-1.5 text-god/80 font-semibold text-left whitespace-nowrap">{h}</th>
              ))}
              {!sheet.single && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {dataRows.length === 0 && (
              <tr>
                <td colSpan={headers.length + 2} className="px-2 py-4 text-center text-dim/40">（空表·点下方「加一行」）</td>
              </tr>
            )}
            {dataRows.map((row, ri) => (
              <tr key={ri} className="border-t border-edge/40 hover:bg-white/[0.02]">
                <td className="px-2 py-1 text-dim/40 font-mono align-top">{row[0] || ri}</td>
                {headers.map((h, ci) => (
                  <td key={ci} className="px-1 py-0.5">
                    <input
                      value={row[ci + 1] ?? ''}
                      onChange={(e) => updateCell(uid, ri, h, e.target.value)}
                      className="w-full min-w-[84px] bg-transparent px-1.5 py-1 rounded border border-transparent hover:border-edge/60 focus:border-god/50 focus:bg-black/30 outline-none text-slate-200"
                    />
                  </td>
                ))}
                {!sheet.single && (
                  <td className="px-1 align-top">
                    <button onClick={() => deleteRow(uid, ri)} className="text-rose-400/50 hover:text-rose-400 px-1 py-1" title="删除此行">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2 flex-wrap">
        {!sheet.single && (
          <button
            onClick={() => insertRow(uid, {})}
            className="px-3 py-1.5 rounded-lg border border-god/40 text-god text-[12px] font-mono hover:bg-god/10 transition-colors"
          >
            ＋ 加一行
          </button>
        )}
        {msg && <span className="text-[11px] text-emerald-400/80">{msg}</span>}
        <span className="text-[11px] text-dim/40 ml-auto">共 {dataRows.length} 行 · {headers.length} 列</span>
        <button
          onClick={() => {
            if (!window.confirm('从当前游戏态导入：把 13 张镜像表（主角/货币/背包/技能/天赋/称号/NPC/势力/领地/冒险团/任务/世界/自定义变量）按游戏 store 现值覆盖重灌（纪要表不动）。继续？')) return;
            const r = migrateStoresToTables({ overwrite: true });
            setMsg(r.seeded.length ? `✓ 已导入：${r.seeded.join('、')}` : '（无可导入数据）');
            setTimeout(() => setMsg(''), 6000);
          }}
          className="px-3 py-1.5 rounded-lg border border-god/40 text-god text-[12px] font-mono hover:bg-god/10 transition-colors"
          title="把现有游戏 store（主角/货币/世界/背包/NPC）的值覆盖写进对应表"
        >
          ↻ 从游戏态导入
        </button>
        <button
          onClick={() => { if (window.confirm('把所有表重置为默认（清空全部表数据·AI 已填内容都会没）？')) resetAll(); }}
          className="px-3 py-1.5 rounded-lg border border-rose-600/40 text-rose-300/80 text-[12px] font-mono hover:bg-rose-500/10 transition-colors"
        >
          重置全部表
        </button>
      </div>

      {showPersona && <StagedPersonaModal onClose={() => setShowPersona(false)} />}
      {showNewTable && <CustomTableModal onClose={() => setShowNewTable(false)} onCreated={(u) => setUid(u)} />}
    </div>
  );
}

// ── 回合级变量事务报告：本回合变量"动了什么/拦了什么/哪里失败"一眼可见 + 表删除找回 ──
function TurnReportPanel() {
  const records = useTurnReport((s) => s.records);
  const entries = useTableJournal((s) => s.entries);
  const restoreDeleted = useTableJournal((s) => s.restoreDeleted);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const recent = [...records].reverse().slice(0, 12);
  const restorable = [...entries].reverse().filter((e) => e.command === 'deleteRow' && !e.restored && e.before).slice(0, 8);
  const last = records[records.length - 1];
  const lastProblems = last ? last.stateFailed.length + last.tableFailed.length + last.itemRejected.length + (last.tableSkippedDup ? 1 : 0) : 0;
  const summary = !last
    ? '本会话还没有变量应用记录（发一回合正文后出现）'
    : `最近一次（T${last.turn}·${last.source}）：<state> ${last.stateApplied} 条 · 物品 ${last.itemApplied} 条${last.itemBlocked ? `（拦 ${last.itemBlocked}）` : ''} · 填表 ${last.tableApplied} 条${lastProblems ? ` · ⚠ ${lastProblems} 处异常` : ' · 全部成功'}`;
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] space-y-1.5 ${lastProblems ? 'border-amber-600/50' : 'border-edge'}`}>
      <div className="flex items-center gap-2">
        <span className={`flex-1 min-w-0 ${lastProblems ? 'text-amber-300/90' : 'text-dim/70'}`}>📋 变量事务报告：{summary}</span>
        <button onClick={() => setOpen((o) => !o)} className="shrink-0 px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 transition-colors">
          {open ? '收起' : `明细（${records.length}）`}
        </button>
      </div>
      {open && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {recent.length === 0 && <p className="text-dim/40">（暂无记录·每次正文/演化应用变量后在此留痕）</p>}
          {recent.map((r) => (
            <div key={r.id} className="border-t border-edge/40 pt-1">
              <span className="text-dim/50 font-mono">T{r.turn}·{r.source}</span>
              <span className="text-dim/70 ml-2">state {r.stateApplied} · 物品 {r.itemApplied}{r.itemBlocked ? `（拦${r.itemBlocked}）` : ''} · 填表 {r.tableApplied}{r.tableSkippedDup ? '（幂等跳过）' : ''}</span>
              {r.stateFailed.map((f, i) => <p key={`s${i}`} className="text-amber-300/80 pl-3">✗ state：{f}</p>)}
              {r.itemRejected.map((f, i) => <p key={`i${i}`} className="text-amber-300/80 pl-3">✗ 物品：{f}</p>)}
              {r.tableFailed.map((f, i) => <p key={`t${i}`} className="text-amber-300/80 pl-3">✗ 填表：{f}</p>)}
              {r.drift.map((f, i) => <p key={`d${i}`} className="text-amber-300/60 pl-3">🛡 {f}</p>)}
            </div>
          ))}
          {restorable.length > 0 && (
            <div className="border-t border-edge/40 pt-1 space-y-0.5">
              <p className="text-dim/60">🗑 最近被删的表行（图书馆铁则·可找回）：</p>
              {restorable.map((e) => (
                <div key={e.id} className="flex items-center gap-2 pl-3">
                  <span className="flex-1 min-w-0 truncate text-dim/70">T{e.turn}·{e.sheetName} [{e.rowId}] {(e.before ?? []).slice(1).filter(Boolean).slice(0, 3).join(' ｜ ')}</span>
                  <button
                    onClick={() => { const ok = restoreDeleted(e.id); setNote(ok ? `↩ 已放回：${e.sheetName} [${e.rowId}]` : '找回失败（同编号行已存在？）'); setTimeout(() => setNote(''), 5000); }}
                    className="shrink-0 px-1.5 py-0.5 rounded border border-god/40 text-god hover:bg-god/10 transition-colors"
                  >↩ 找回</button>
                </div>
              ))}
            </div>
          )}
          {note && <p className="text-emerald-400/80">{note}</p>}
        </div>
      )}
    </div>
  );
}

// ── 填表调度（设置：总开关 / 每 N 回合填一次 / 只维护指定剧情表）─────────────
const PLOT_TABLES: [string, string][] = [
  ['chronicle', '纪要'], ['progress', '进程'], ['foreshadowing', '伏笔'], ['pacts', '约定'],
];
function TableFillSchedule() {
  const tf = useSettings((s) => s.tableFill) ?? { enabled: true, everyN: 1, only: [] };
  const setTableFill = useSettings((s) => s.setTableFill);
  const allUids = PLOT_TABLES.map((t) => t[0]);
  const isOn = (uid: string) => tf.only.length === 0 || tf.only.includes(uid);
  const toggle = (uid: string) => {
    const cur = tf.only.length === 0 ? [...allUids] : [...tf.only];
    const next = cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid];
    setTableFill({ only: next.length === 0 || next.length === allUids.length ? [] : next });   // 全选/全不选都规约成 []＝全部
  };
  return (
    <div className="rounded-lg border border-edge px-3 py-2 space-y-1.5 text-[12px]">
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={tf.enabled} onChange={(e) => setTableFill({ enabled: e.target.checked })} className="accent-god" />
          <span className="text-slate-200">🗂 启用自动填表（AI 每回合维护剧情表）</span>
        </label>
        <label className={`flex items-center gap-1.5 ${tf.enabled ? 'text-dim' : 'text-dim/40'}`}>
          每
          <input
            type="number" min={1} disabled={!tf.enabled} value={tf.everyN}
            onChange={(e) => setTableFill({ everyN: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            className="w-14 bg-panel2 border border-edge rounded px-1.5 py-0.5 text-center text-slate-200 outline-none focus:border-god/50 disabled:opacity-40"
          />
          回合填一次
        </label>
      </div>
      <div className={`flex items-center gap-2.5 flex-wrap ${tf.enabled ? 'text-dim' : 'text-dim/40'}`}>
        <span>只维护：</span>
        {PLOT_TABLES.map(([uid, name]) => (
          <label key={uid} className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" disabled={!tf.enabled} checked={isOn(uid)} onChange={() => toggle(uid)} className="accent-god" />
            {name}
          </label>
        ))}
        <span className="text-dim/50">（全勾/全不勾＝全部；要一个都不填请关上面总开关）</span>
      </div>
      {/* 填表接口：自动填表跟着主正文走（用正文接口），这条路由只作用于「♻ 重算变量 → 🗂 填表」的独立补填调用。
          留空＝回退正文接口。补填只吐 <tableEdit> 不写正文，挂个便宜模型足够。 */}
      <div className="pt-1 border-t border-edge/60 space-y-1">
        <div className="text-dim/70">
          🔌 填表接口 <span className="text-dim/40">（仅用于「♻ 重算变量 → 🗂 填表」的手动补填；留空＝回退正文接口。补填只输出填表指令、不写正文，用便宜模型即可）</span>
        </div>
        <ApiRoutePicker routeKey="table" />
      </div>
      <div className="text-dim/50 leading-relaxed">
        💡 漏了某一层没记进表？→ 正文下方 <span className="text-god/70">♻ 重算变量</span> → <span className="text-god/70">🗂 填表</span> → 选楼层范围补跑（正文不会变）。
      </div>
    </div>
  );
}
