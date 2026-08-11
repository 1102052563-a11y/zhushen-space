import { useEffect, useMemo, useState } from 'react';
import { usePlayer, type Achievement } from '../store/playerStore';
import { RARITY_CLS } from '../store/characterStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useMisc } from '../store/miscStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { ACHIEVEMENT_GEN_RULE } from '../promptRules';
import { getPrompt } from '../store/promptOverrideStore';   // 预设中心：主提示词 override
import { buildPlayerGenContext } from '../systems/playerGenContext';
import { sweepAchievements, buildAchvCtx, progressOf, type AchvDef, type AchvCtx } from '../systems/achievementEngine';
import { ACHV_CATALOG } from '../systems/achievementCatalog';

const CATEGORIES = ['全部', '战斗', '探索', '任务', '生存', '隐藏', '其他'];
const CAT_OK = ['战斗', '探索', '任务', '生存', '隐藏', '其他'];

function extractJson(text: string): string {
  let s = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

/* 调 AI 据主角当前处境「凭空」解锁一条贴切成就（走主角演化路由，回退正文/共享 API）。
   id 一律前端新生成，避免 AI 复用 id 覆盖既有成就（addAchievement 按 id 或同名 upsert）。 */
async function genAchievement(existing: Achievement[]): Promise<Omit<Achievement, 'addedAt'> | null> {
  const ss = useSettings.getState();
  const ps = usePlayer.getState();
  const legacy = ps.playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ps.playerApi;
  const chain = resolveApiChain('player', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→主角演化→API设置 或 综合设置→正文生成）');
  const dupes = existing.map((a) => a.name).join('、') || '（无）';
  const userMsg = `【主角档案】\n${buildPlayerGenContext()}\n\n【已解锁成就（勿重复或近义）】\n${dupes}\n\n请据主角档案解锁**一条**贴切的新成就，只输出 JSON。`;
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('ACHIEVEMENT_GEN_RULE', ACHIEVEMENT_GEN_RULE) },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 120000 });
  const raw: any = lenientJsonParse(extractJson(content ?? ''));
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  const hidden = !!raw.hidden;
  let category = String(raw.category ?? '').trim();
  if (!CAT_OK.includes(category)) category = hidden ? '隐藏' : '其他';
  const rid = `ach_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    id: rid,
    name: String(raw.name).trim(),
    desc: raw.desc ? String(raw.desc).trim() : '',
    category,
    type: raw.type ? String(raw.type).trim() : '普通',
    rarity: String(raw.rarity ?? 'C').trim(),
    hidden,
    condition: raw.condition ? String(raw.condition).trim() : '',
    unlockTime: raw.unlockTime ? String(raw.unlockTime).trim() : (useMisc.getState().worldTime || undefined),
  };
}

/* 成就系统（仅主角 B1）：
   - 「已解锁」＝落档成就列表（叙事解锁 + 设施发放 + 图鉴自动解锁 + AI 生成），固定格式，成就不计入叙事记忆注入；
   - 「图鉴」＝声明式成就目录（achievementCatalog·借鉴V3.2）：锁定态显示条件与进度、隐藏成就打码，打开面板即扫描自动解锁。 */
export default function AchievementPanel({ onClose }: { onClose: () => void }) {
  const achievements = usePlayer((s) => s.achievements);
  const removeAchievement = usePlayer((s) => s.removeAchievement);
  const addAchievement = usePlayer((s) => s.addAchievement);
  const [view, setView] = useState<'unlocked' | 'codex'>('unlocked');
  const [cat, setCat] = useState('全部');
  const [gening, setGening] = useState(false);
  const [msg, setMsg] = useState('');

  // 打开面板即扫描一次（幂等·零API）；有新解锁就提示
  useEffect(() => {
    const names = sweepAchievements();
    if (names.length) setMsg(`✓ 图鉴自动解锁 ${names.length} 条：${names.join('、')}`);
  }, []);

  // 图鉴进度快照：面板打开时取一次即可（成就列表本身是响应式的）
  const ctx = useMemo<AchvCtx>(() => buildAchvCtx(), []);
  const unlockedIds = useMemo(() => new Set(achievements.map((a) => a.id)), [achievements]);
  const codexUnlocked = ACHV_CATALOG.filter((d) => unlockedIds.has(d.id)).length;

  const filtered = (cat === '全部' ? achievements : achievements.filter((a) => a.category === cat))
    .slice().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

  const doGen = async () => {
    if (gening) return;
    if (!window.confirm('调用 AI 据主角当前身份/阶位/事迹「解锁」一条贴切成就？（计费）')) return;
    setGening(true);
    setMsg('正在为主角解锁成就…');
    try {
      const next = await genAchievement(achievements);
      if (!next) { setMsg('生成失败：AI 未返回有效成就，请重试'); return; }
      if (achievements.some((a) => a.name === next.name)) { setMsg(`「${next.name}」与已解锁成就重名，已跳过；可再点一次生成`); return; }
      addAchievement(next);
      setMsg(`✓ 已解锁成就「${next.name}」(${next.rarity})`);
      setTimeout(() => setMsg(''), 6000);
    } catch (e: any) {
      setMsg('生成失败：' + (e?.message || String(e)));
    } finally {
      setGening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={gening ? undefined : onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🏆</span>
              <h2 className="text-base font-bold text-slate-100">成就系统</h2>
              <span className="text-[13px] font-mono text-dim/50">已解锁 {achievements.length} · 图鉴 {codexUnlocked}/{ACHV_CATALOG.length}</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">主角达成的成就；成就不计入叙事记忆注入。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={doGen}
              disabled={gening}
              title="据主角当前身份/阶位/事迹，AI 解锁一条贴切的新成就"
              className="text-[12px] font-mono px-2 py-1 rounded border border-god/40 text-god hover:bg-god/10 transition-colors disabled:opacity-40">
              {gening ? '生成中…' : '✨ 生成'}
            </button>
            <button onClick={onClose} disabled={gening} className="text-dim/50 hover:text-blood text-lg font-mono disabled:opacity-40">✕</button>
          </div>
        </header>

        {/* 生成状态条 */}
        {msg && (
          <div className={`px-4 py-2 border-b border-edge/60 text-[13px] font-mono shrink-0 ${msg.startsWith('✓') ? 'text-emerald-300 bg-emerald-900/10' : msg.includes('失败') ? 'text-blood bg-blood/5' : 'text-god bg-god/5'}`}>
            {gening && <span className="inline-block animate-spin mr-1.5">⟳</span>}{msg}
          </div>
        )}

        {/* 视图切换 + 分类筛选 */}
        <div className="px-4 py-2 border-b border-edge/60 shrink-0 flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg border border-edge overflow-hidden mr-2">
            {([['unlocked', '已解锁'], ['codex', '图鉴']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`text-[13px] font-mono px-2.5 py-0.5 transition-colors ${view === v ? 'bg-god/15 text-god' : 'text-dim/60 hover:text-slate-200'}`}>
                {label}
              </button>
            ))}
          </div>
          {view === 'unlocked' && CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`text-[13px] font-mono px-2 py-0.5 rounded border transition-colors ${
                cat === c ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'
              }`}>
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {view === 'unlocked' && filtered.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无成就。剧情达成时会由叙事解锁，也可到「图鉴」查看可冲刺的目标。</div>
          )}
          {view === 'unlocked' && filtered.map((a) => <AchievementCard key={a.id} a={a} onDelete={() => removeAchievement(a.id)} />)}
          {view === 'codex' && ACHV_CATALOG.map((d) => (
            <CodexCard key={d.id} d={d} unlocked={unlockedIds.has(d.id)} ctx={ctx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AchievementCard({ a, onDelete }: { a: Achievement; onDelete: () => void }) {
  const cls = RARITY_CLS[a.rarity] ?? 'border-edge text-slate-300';
  const quip = a.id.startsWith('cat_') ? ACHV_CATALOG.find((d) => d.id === a.id)?.quip : undefined;
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 bg-panel ${cls}`}>
      <div className="flex items-center gap-2">
        <span className="text-base">🏅</span>
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{a.name}</span>
        {a.hidden && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-300/80 shrink-0">🔒隐藏</span>}
        {a.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{a.rarity}</span>}
      </div>
      {a.desc && <div className="text-[13px] text-dim/75 leading-relaxed">{a.desc}</div>}
      {quip && <div className="text-[12px] text-god/70 leading-relaxed">「{quip}」</div>}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
        {a.category && <span className="text-sky-300/70">分类:{a.category}</span>}
        {a.type && <span className="text-amber-300/70">类型:{a.type}</span>}
        {a.unlockTime && <span>解锁:{a.unlockTime}</span>}
        <span className="text-dim/30">{a.id}</span>
      </div>
      {a.condition && <div className="text-[12px] text-dim/50 leading-relaxed">达成条件·{a.condition}</div>}
      {/* 图鉴成就（cat_）达标即确定性重授，删了下回合又回来——不给删除入口免得困惑 */}
      {!a.id.startsWith('cat_') && (
        <div className="flex justify-end">
          <button onClick={onDelete} className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors">删除</button>
        </div>
      )}
    </div>
  );
}

/* 图鉴条目：解锁=彩色卡+趣评；锁定=灰卡+条件+进度条；隐藏且未解锁=全打码 */
function CodexCard({ d, unlocked, ctx }: { d: AchvDef; unlocked: boolean; ctx: AchvCtx }) {
  if (!unlocked && d.hidden) {
    return (
      <div className="rounded-xl border border-edge/60 p-3 bg-panel/50 opacity-70">
        <div className="flex items-center gap-2">
          <span className="text-base grayscale">🔒</span>
          <span className="flex-1 font-semibold text-sm text-dim/60">？？？</span>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-300/60 shrink-0">隐藏成就</span>
        </div>
        <div className="text-[12px] text-dim/40 mt-1">达成后揭晓。</div>
      </div>
    );
  }
  if (!unlocked) {
    const p = progressOf(d, ctx);
    return (
      <div className="rounded-xl border border-edge/70 p-3 space-y-1.5 bg-panel/60 opacity-80">
        <div className="flex items-center gap-2">
          <span className="text-base grayscale">🏅</span>
          <span className="flex-1 font-semibold text-sm text-slate-300 truncate">{d.name}</span>
          <span className="text-[12px] font-mono text-dim/50 shrink-0">{d.rarity}</span>
        </div>
        <div className="text-[12px] text-dim/55 leading-relaxed">达成条件·{d.condition}</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded bg-edge/50 overflow-hidden">
            <div className="h-full bg-god/50 transition-all" style={{ width: `${Math.round(p.pct * 100)}%` }} />
          </div>
          <span className="text-[11px] font-mono text-dim/50 shrink-0">{p.cur}/{p.target}</span>
        </div>
      </div>
    );
  }
  const cls = RARITY_CLS[d.rarity] ?? 'border-edge text-slate-300';
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 bg-panel ${cls}`}>
      <div className="flex items-center gap-2">
        <span className="text-base">🏅</span>
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{d.name}</span>
        {d.hidden && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-300/80 shrink-0">🔒隐藏</span>}
        <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{d.rarity}</span>
        <span className="text-[12px] text-emerald-300/80 shrink-0">✓</span>
      </div>
      <div className="text-[13px] text-dim/75 leading-relaxed">{d.desc}</div>
      {d.quip && <div className="text-[12px] text-god/70 leading-relaxed">「{d.quip}」</div>}
    </div>
  );
}
