import { useState } from 'react';
import { useMisc } from '../store/miscStore';
import ApiRoutePicker from './ApiRoutePicker';

/* 任务演化管理页（从「杂项演化」拆出的独立阶段）：
   启用开关（settings.questEnabled）+ 独立 API（featureKey='quest'）+ 任务闸门 / 正文注入设置。
   任务数据仍存 miscStore（tasks/archivedTasks），在右侧导航「📋 任务」面板查看与手动编辑。 */

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}>
      <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  );
}

function SettingsSection() {
  const settings = useMisc((s) => s.settings);
  const setSettings = useMisc((s) => s.setSettings);
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用任务演化</div>
          <div className="text-[13px] text-dim/70 mt-0.5">正文完成后独立维护主角任务：主线路线图规划 / 环推进 / 进度 / 结算（与杂项演化互不影响、可各自开关）</div>
        </div>
        {/* 与运行时门控完全一致：questEnabled 缺省（极端边角，如导入拆分前的旧配置）时跟随杂项演化 enabled */}
        <Toggle checked={settings.questEnabled ?? settings.enabled} onChange={() => setSettings({ questEnabled: !(settings.questEnabled ?? settings.enabled) })} />
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-200">任务注入正文</div>
            <div className="text-[13px] text-dim/70 mt-0.5">把当前主线（重·含当前环目标/下一步/终局）与相关支线（轻）回流到正文上下文，给主线存在感、由系统把控节奏</div>
          </div>
          <Toggle checked={settings.questInjectEnabled !== false}
            onChange={() => setSettings({ questInjectEnabled: settings.questInjectEnabled === false })} />
        </div>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>注入正文的支线条数上限（0 = 只注主线）</span>
          <input type="number" min={0} max={10} value={settings.questSideCap ?? 3}
            onChange={(e) => setSettings({ questSideCap: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } as any)}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <div className="text-[12px] text-dim/50 leading-snug">支线按"贴合当前地点 / 在场 NPC"相关性排序后取前 N 条注入；主线始终全量注入。关掉开关则正文完全不注入任务（回到旧行为）。</div>
      </div>

      {/* 任务闸门（questGuard）：AI 侧护栏——结构锁 + 布置配额；玩家 ✏️ 编辑 / 手动生成不受限 */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-200">任务闸门 · AI 结构锁</div>
            <div className="text-[13px] text-dim/70 mt-0.5">已建档任务 AI 只能推进（状态 / 进度 / 评级 / 环推进），名称 / 描述 / 奖惩 / 终局 / 环内容一律冻结，被驳回的改写记入回合洞察仲裁日志</div>
          </div>
          <Toggle checked={settings.questGuardLock !== false}
            onChange={() => setSettings({ questGuardLock: settings.questGuardLock === false } as any)} />
        </div>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>在场支线数量上限（满额时 AI 新建支线被驳回；0 = 不限）</span>
          <input type="number" min={0} max={20} value={settings.questSideMax ?? 4}
            onChange={(e) => setSettings({ questSideMax: Math.max(0, Math.min(20, Number(e.target.value) || 0)) } as any)}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>每轮任务演化 AI 新建任务上限（0 = 不限）</span>
          <input type="number" min={0} max={10} value={settings.questNewPerRound ?? 1}
            onChange={(e) => setSettings({ questNewPerRound: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } as any)}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <div className="text-[12px] text-dim/50 leading-snug">治"任务乱变动 / 无限布置"：主线、职业任务、进阶通告不占支线额度；AI 的 de() 删除一律转「作废」归档留底（只存不删）。玩家在任务面板 ✏️ 编辑、🎲 手动生成不经闸门。</div>
      </div>

      {/* 环推进闸门（questAdvanceGate/questAdvanceReview）：治"AI 只完成部分要求就乱推进度/跳阶段/整条报完成" */}
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-200">环推进闸门 · 反乱推进度</div>
            <div className="text-[13px] text-dim/70 mt-0.5">AI 推进任务须过确定性检查：ringAdvance 必须附正文原句证据（evidence·前端逐字核验）／每轮每任务最多一种环操作／环状态单向不回退／强制环未全达成时整条「已完成」被驳回。被驳回的转为进度记录、记入回合洞察仲裁日志，不丢信息</div>
          </div>
          <Toggle checked={settings.questAdvanceGate !== false}
            onChange={() => setSettings({ questAdvanceGate: settings.questAdvanceGate === false } as any)} />
        </div>
        <label className="flex items-center justify-between gap-2 text-sm text-dim">
          <span>每轮每任务最多把几个环标为达成/跳过（跨环限幅；0 = 不限）</span>
          <input type="number" min={0} max={12} value={settings.questRingJumpMax ?? 1}
            onChange={(e) => setSettings({ questRingJumpMax: Math.max(0, Math.min(12, Number(e.target.value) || 0)) } as any)}
            className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
        </label>
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-edge/60">
          <div>
            <div className="text-sm text-slate-200">推进二次复核（独立裁判）</div>
            <div className="text-[13px] text-dim/70 mt-0.5">推进 / 跳环 / 整条结算指令落库前，再调一次任务 API 当「复核裁判」：把环目标拆成全部要件、逐件核验正文完成证据，任何一件缺证据即驳回——治 AI 太媚玩家"看半截要求就推进度"。仅在 AI 试图推进的回合才多这一次调用；裁判故障自动放行（确定性闸门仍兜底）</div>
          </div>
          <Toggle checked={settings.questAdvanceReview !== false}
            onChange={() => setSettings({ questAdvanceReview: settings.questAdvanceReview === false } as any)} />
        </div>
        <div className="text-[12px] text-dim/50 leading-snug">推得慢没有代价（环停在原地、进展记进 progress，凑齐证据下一轮照样推）；误推才有代价（污染路线图与逐环结算）。玩家在任务面板 ✏️ 手动改环状态 / 手动结算永远不受闸门与裁判限制。</div>
      </div>

      {/* 提示词与规范来源说明（任务规则全为代码注入，改 promptRules/App 常量即时生效，无需预设） */}
      <div className="rounded-lg border border-god/25 bg-god/5 px-3 py-2.5 text-[12px] text-dim/70 leading-relaxed">
        <div className="text-god/80 font-mono mb-1">📖 任务演化 · 规则与思维链</div>
        本阶段每轮注入完整任务规则链（任务发布系统身份 / 主线路线图规划 / 环推进对账 / 来源分辨 / 击杀阶位上限 / 六选三奖惩与时限 / 同人接地 / 世界志联动），并强制先输出 <code className="text-god/60">{'<quest_cot>'}</code> 思维链推演合理性、再落 <code className="text-god/60">{'<upstore>'}</code> 任务指令。
        另会注入「<span className="text-slate-300">杂项演化·任务与世界规范图鉴</span>」世界书里的<b className="text-slate-300">任务相关条目</b>（总纲 / 任务类型库 / 环结构 / 奖惩时限）——要编辑或关闭，去「设置 → 正文世界书」找这本书；总结 / 天气 / 大事等世界侧条目仍由杂项演化阶段使用。
      </div>

      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 text-[12px] text-dim/60 leading-relaxed">
        任务数据（进行中 / 已归档）仍与原来一样保存在杂项数据里、随存档走：查看与手动编辑去右侧导航「📋 任务」面板；调用频率在「设置 → 综合设置 → 演化调度」的「任务演化」一行调整。
      </div>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <ApiRoutePicker routeKey="quest" />
    </div>
  );
}

type QuestTab = 'settings' | 'api';

export default function QuestManager() {
  const enabled = useMisc((s) => s.settings.questEnabled ?? s.settings.enabled);
  const setSettings = useMisc((s) => s.setSettings);
  const [tab, setTab] = useState<QuestTab>('settings');
  const tabs: { key: QuestTab; label: string; icon: string }[] = [
    { key: 'settings', label: '演化设置', icon: '🎯' },
    { key: 'api', label: 'API 设置', icon: '⚡' },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-edge pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100">任务演化</h2>
          <p className="text-sm text-dim mt-0.5">独立阶段：主角任务的主线路线图 / 环推进 / 进度 / 结算——调用独立 API，不再混在杂项演化里</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-dim font-mono">{enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={enabled} onChange={() => setSettings({ questEnabled: !enabled })} />
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-panel rounded-lg border border-edge">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-sm font-mono transition-colors ${tab === t.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsSection />}
      {tab === 'api' && <ApiSection />}
    </div>
  );
}
