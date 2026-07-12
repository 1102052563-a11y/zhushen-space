import { useState } from 'react';
import { usePlayer, type Achievement } from '../store/playerStore';
import { RARITY_CLS } from '../store/characterStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useMisc } from '../store/miscStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { ACHIEVEMENT_GEN_RULE } from '../promptRules';
import { buildPlayerGenContext } from '../systems/playerGenContext';

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
    { role: 'system', content: ACHIEVEMENT_GEN_RULE },
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

/* 成就系统（仅主角 B1）：展示已解锁成就，固定格式
   id|名称|说明|分类|类型|稀有度|是否隐藏|解锁条件|解锁时间。成就不计入叙事记忆注入。 */
export default function AchievementPanel({ onClose }: { onClose: () => void }) {
  const achievements = usePlayer((s) => s.achievements);
  const removeAchievement = usePlayer((s) => s.removeAchievement);
  const addAchievement = usePlayer((s) => s.addAchievement);
  const [cat, setCat] = useState('全部');
  const [gening, setGening] = useState(false);
  const [msg, setMsg] = useState('');

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
              <span className="text-[13px] font-mono text-dim/50">已解锁 {achievements.length}</span>
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

        {/* 分类筛选 */}
        <div className="px-4 py-2 border-b border-edge/60 shrink-0 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`text-[13px] font-mono px-2 py-0.5 rounded border transition-colors ${
                cat === c ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim/60 hover:text-slate-200'
              }`}>
              {c}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filtered.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无成就。成就会在剧情达成条件时由叙事自动解锁。</div>
          )}
          {filtered.map((a) => <AchievementCard key={a.id} a={a} onDelete={() => removeAchievement(a.id)} />)}
        </div>
      </div>
    </div>
  );
}

function AchievementCard({ a, onDelete }: { a: Achievement; onDelete: () => void }) {
  const cls = RARITY_CLS[a.rarity] ?? 'border-edge text-slate-300';
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 bg-panel ${cls}`}>
      <div className="flex items-center gap-2">
        <span className="text-base">🏅</span>
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{a.name}</span>
        {a.hidden && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-purple-500/40 text-purple-300/80 shrink-0">🔒隐藏</span>}
        {a.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{a.rarity}</span>}
      </div>
      {a.desc && <div className="text-[13px] text-dim/75 leading-relaxed">{a.desc}</div>}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
        {a.category && <span className="text-sky-300/70">分类:{a.category}</span>}
        {a.type && <span className="text-amber-300/70">类型:{a.type}</span>}
        {a.unlockTime && <span>解锁:{a.unlockTime}</span>}
        <span className="text-dim/30">{a.id}</span>
      </div>
      {a.condition && <div className="text-[12px] text-dim/50 leading-relaxed">达成条件·{a.condition}</div>}
      <div className="flex justify-end">
        <button onClick={onDelete} className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors">删除</button>
      </div>
    </div>
  );
}
