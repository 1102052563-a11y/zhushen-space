import { useState } from 'react';
import { useCharacters, RARITY_CLS, type Title } from '../store/characterStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { useMisc } from '../store/miscStore';
import { apiChatFallback } from '../systems/apiChat';
import { lenientJsonParse } from '../systems/stateParser';
import { TITLE_FUSION_RULE, TITLE_GEN_RULE } from '../promptRules';
import { getPrompt } from '../store/promptOverrideStore';   // 预设中心：主提示词 override
import { buildPlayerGenContext } from '../systems/playerGenContext';

/* 称号库（主角 B1）：展示已获得称号，最多佩戴 1 个；
   仅佩戴的称号会被叙事记忆结构化召回注入正文。
   + 称号合成（二合一/三合一）：选 2~3 个称号 → 调 AI 熔铸成一个更强称号，旧的被消耗。 */

function extractJson(text: string): string {
  let s = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

/* 调 AI 把 2~3 个称号熔铸成一个更强称号（走主角演化路由，回退正文/共享 API）。 */
async function fuseTitles(sources: Title[]): Promise<Omit<Title, 'addedAt'> | null> {
  const ss = useSettings.getState();
  const ps = usePlayer.getState();
  const legacy = ps.playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ps.playerApi;
  const chain = resolveApiChain('player', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→主角演化→API设置 或 综合设置→正文生成）');
  const list = sources.map((t, i) =>
    `${i + 1}. 「${t.name}」品级:${t.rarity || '—'}${t.effect ? ` ｜效果:${t.effect}` : ''}${t.desc ? ` ｜描述:${t.desc}` : ''}${t.source ? ` ｜来源:${t.source}` : ''}`,
  ).join('\n');
  const userMsg = `【参与合成的称号（共 ${sources.length} 个）】\n${list}\n\n请把以上 ${sources.length} 个称号熔铸成**一个**全新的、更强大的称号，按系统要求只输出 JSON。`;
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('TITLE_FUSION_RULE', TITLE_FUSION_RULE) },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 120000 });
  const raw: any = lenientJsonParse(extractJson(content ?? ''));
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  return {
    name: String(raw.name).trim(),
    rarity: String(raw.rarity ?? 'A').trim(),
    effect: raw.effect ? String(raw.effect).trim() : undefined,
    bonusEffect: (raw.bonusEffect ?? raw.bonus_effect ?? raw.extraEffect) ? String(raw.bonusEffect ?? raw.bonus_effect ?? raw.extraEffect).trim() : undefined,
    desc: raw.desc ? String(raw.desc).trim() : undefined,
    source: raw.source ? String(raw.source).trim() : `名号熔炉·${sources.map((s) => s.name).join('+')}`,
    obtainedTime: raw.obtainedTime ? String(raw.obtainedTime).trim() : undefined,
    equipped: sources.some((s) => s.equipped),
  };
}

/* 调 AI 据主角当前处境「凭空」生成一枚贴切的新称号（走主角演化路由，回退正文/共享 API）。
   与合成不同：不消耗任何来源，纯据主角档案（身份/阶位/六维/所在世界/经历）授予。 */
async function genTitle(existing: Title[]): Promise<Omit<Title, 'addedAt'> | null> {
  const ss = useSettings.getState();
  const ps = usePlayer.getState();
  const legacy = ps.playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ps.playerApi;
  const chain = resolveApiChain('player', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→主角演化→API设置 或 综合设置→正文生成）');
  const dupes = existing.map((t) => t.name).join('、') || '（无）';
  const userMsg = `【主角档案】\n${buildPlayerGenContext()}\n\n【已有称号（勿重复或近义）】\n${dupes}\n\n请据主角档案生成**一枚**贴切的新称号，只输出 JSON。`;
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('TITLE_GEN_RULE', TITLE_GEN_RULE) },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 120000 });
  const raw: any = lenientJsonParse(extractJson(content ?? ''));
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  return {
    name: String(raw.name).trim(),
    rarity: String(raw.rarity ?? 'C').trim(),
    effect: raw.effect ? String(raw.effect).trim() : undefined,
    desc: raw.desc ? String(raw.desc).trim() : undefined,
    source: raw.source ? String(raw.source).trim() : '手动生成',
    obtainedTime: raw.obtainedTime ? String(raw.obtainedTime).trim() : (useMisc.getState().worldTime || undefined),
  };
}

export default function TitlePanel({ onClose }: { onClose: () => void }) {
  const titles = useCharacters((s) => s.characters['B1']?.titles ?? []);
  const equipTitle = useCharacters((s) => s.equipTitle);
  const unequipTitle = useCharacters((s) => s.unequipTitle);
  const removeTitle = useCharacters((s) => s.removeTitle);
  const addTitle = useCharacters((s) => s.addTitle);

  const [fuseMode, setFuseMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]);      // 已选称号名（最多 3）
  const [fusing, setFusing] = useState(false);
  const [gening, setGening] = useState(false);       // 手动生成中
  const [fuseMsg, setFuseMsg] = useState('');        // 合成/生成 共用状态条

  const equipped = titles.find((t) => t.equipped);
  const sorted = [...titles].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0) || (b.addedAt ?? 0) - (a.addedAt ?? 0));

  const exitFuse = () => { setFuseMode(false); setSel([]); setFuseMsg(''); };
  const toggleSel = (name: string) => {
    if (fusing) return;
    setFuseMsg('');
    setSel((cur) => cur.includes(name) ? cur.filter((n) => n !== name)
      : cur.length >= 3 ? cur : [...cur, name]);
  };

  const doFuse = async () => {
    if (fusing || sel.length < 2 || sel.length > 3) return;
    const sources = sel.map((n) => titles.find((t) => t.name === n)).filter(Boolean) as Title[];
    if (sources.length < 2) return;
    if (!window.confirm(`将「${sources.map((s) => s.name).join('」「')}」熔铸成一个更强的新称号？\n\n这会调用 AI（计费），且**消耗掉以上 ${sources.length} 个称号**（不可撤销）。`)) return;
    setFusing(true);
    setFuseMsg(`正在熔铸 ${sources.length} 个称号…`);
    try {
      const next = await fuseTitles(sources);
      if (!next) { setFuseMsg('合成失败：AI 未返回有效称号，请重试'); return; }
      sources.forEach((s) => removeTitle('B1', s.name));   // 消耗来源
      addTitle('B1', next);                                // 写入新称号（继承佩戴位）
      setSel([]);
      setFuseMode(false);
      setFuseMsg(`✓ 合成成功：获得新称号「${next.name}」(${next.rarity})`);
      setTimeout(() => setFuseMsg(''), 6000);
    } catch (e: any) {
      setFuseMsg('合成失败：' + (e?.message || String(e)));
    } finally {
      setFusing(false);
    }
  };

  const doGen = async () => {
    if (gening || fusing) return;
    if (!window.confirm('调用 AI 据主角当前身份/阶位/事迹「生成」一枚贴切的新称号？（计费）')) return;
    setGening(true);
    setFuseMsg('正在为主角生成称号…');
    try {
      const next = await genTitle(titles);
      if (!next) { setFuseMsg('生成失败：AI 未返回有效称号，请重试'); return; }
      if (titles.some((t) => t.name === next.name)) { setFuseMsg(`生成的「${next.name}」与已有称号重名，已跳过；可再点一次生成`); return; }
      addTitle('B1', next);
      setFuseMsg(`✓ 已生成新称号「${next.name}」(${next.rarity})`);
      setTimeout(() => setFuseMsg(''), 6000);
    } catch (e: any) {
      setFuseMsg('生成失败：' + (e?.message || String(e)));
    } finally {
      setGening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(fusing || gening) ? undefined : onClose}>
      <div className="bg-void border border-edge rounded-2xl w-full max-w-2xl max-h-[88dvh] flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <header className="flex items-center justify-between p-4 border-b border-edge shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🎖</span>
              <h2 className="text-base font-bold text-slate-100">称号库</h2>
              <span className="text-[13px] font-mono text-dim/50">共 {titles.length} 个</span>
            </div>
            <p className="text-[13px] text-dim/60 mt-0.5">
              {fuseMode
                ? <span className="text-god/80">合成模式：选 2~3 个称号 → 熔铸成一个更强的新称号（旧称号被消耗）。</span>
                : <>最多佩戴 1 个；仅<span className="text-god/80">佩戴中</span>的称号会在叙事记忆中注入正文。</>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {fuseMode
              ? <button onClick={exitFuse} disabled={fusing} className="text-[12px] font-mono px-2 py-1 rounded border border-edge text-dim hover:text-blood hover:border-blood/50 transition-colors disabled:opacity-40">取消合成</button>
              : <>
                  <button
                    onClick={doGen}
                    disabled={gening}
                    title="据主角当前身份/阶位/事迹，AI 生成一枚贴切的新称号"
                    className="text-[12px] font-mono px-2 py-1 rounded border border-god/40 text-god hover:bg-god/10 transition-colors disabled:opacity-40">
                    {gening ? '生成中…' : '✨ 生成'}
                  </button>
                  <button
                    onClick={() => {
                      if (gening) return;
                      if (titles.length < 2) { setFuseMsg('至少需要 2 个称号才能合成（二合一 / 三合一）'); setTimeout(() => setFuseMsg(''), 3500); return; }
                      setFuseMode(true); setFuseMsg('');
                    }}
                    disabled={gening}
                    title={titles.length < 2 ? '至少需要 2 个称号才能合成' : '选 2~3 个称号熔铸成一个更强的新称号'}
                    className={`text-[12px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-40 ${titles.length < 2 ? 'border-edge text-dim/40 hover:text-dim/70' : 'border-god/40 text-god hover:bg-god/10'}`}>
                    🔮 合成
                  </button>
                </>}
            <button onClick={onClose} disabled={fusing || gening} className="text-dim/50 hover:text-blood text-lg font-mono disabled:opacity-40">✕</button>
          </div>
        </header>

        {/* 当前佩戴 */}
        {!fuseMode && (
          <div className="px-4 py-2.5 border-b border-edge/60 bg-panel2/40 shrink-0 flex items-center gap-2 text-sm">
            <span className="text-dim/50 font-mono">当前佩戴：</span>
            {equipped
              ? <span className="text-god font-semibold">{equipped.name}</span>
              : <span className="text-dim/40">（未佩戴）</span>}
            {equipped && (
              <button onClick={() => unequipTitle('B1')} className="ml-auto text-[12px] font-mono text-dim/50 hover:text-blood transition-colors">卸下</button>
            )}
          </div>
        )}

        {/* 合成结果/状态条 */}
        {fuseMsg && (
          <div className={`px-4 py-2 border-b border-edge/60 text-[13px] font-mono shrink-0 ${fuseMsg.startsWith('✓') ? 'text-emerald-300 bg-emerald-900/10' : fuseMsg.includes('失败') ? 'text-blood bg-blood/5' : 'text-god bg-god/5'}`}>
            {(fusing || gening) && <span className="inline-block animate-spin mr-1.5">⟳</span>}{fuseMsg}
          </div>
        )}

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {sorted.length === 0 && (
            <div className="text-center text-dim/40 text-sm py-12">暂无称号。称号会在剧情中获得（由叙事自动写入）。</div>
          )}
          {sorted.map((t) => {
            const idx = sel.indexOf(t.name);
            return (
              <TitleCard key={t.name} t={t}
                fuseMode={fuseMode}
                selected={idx >= 0} selIndex={idx >= 0 ? idx + 1 : 0}
                onToggleSel={() => toggleSel(t.name)}
                onEquip={() => equipTitle('B1', t.name)}
                onUnequip={() => unequipTitle('B1')}
                onDelete={() => removeTitle('B1', t.name)} />
            );
          })}
        </div>

        {/* 合成操作条 */}
        {fuseMode && (
          <footer className="px-4 py-3 border-t border-edge bg-panel2/40 shrink-0 flex items-center gap-3">
            <span className="text-[13px] font-mono text-dim/70">已选 <span className="text-god font-bold">{sel.length}</span>/3</span>
            <span className="text-[12px] text-dim/45">二合一选 2 个 · 三合一选 3 个</span>
            <button
              onClick={doFuse}
              disabled={fusing || (sel.length !== 2 && sel.length !== 3)}
              className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-lg border border-god/50 text-god bg-god/10 hover:bg-god/20 transition-colors disabled:opacity-35 disabled:cursor-not-allowed">
              {fusing ? '熔铸中…' : sel.length === 3 ? '🔮 三合一' : sel.length === 2 ? '🔮 二合一' : '请选 2~3 个'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function TitleCard({ t, fuseMode, selected, selIndex, onToggleSel, onEquip, onUnequip, onDelete }: {
  t: Title; fuseMode: boolean; selected: boolean; selIndex: number;
  onToggleSel: () => void; onEquip: () => void; onUnequip: () => void; onDelete: () => void;
}) {
  const cls = RARITY_CLS[t.rarity] ?? 'border-edge text-slate-300';
  const base = t.equipped ? 'bg-god/5 ' + cls : 'bg-panel ' + cls;
  return (
    <div
      className={`rounded-xl border p-3 space-y-1.5 ${base} ${fuseMode ? 'cursor-pointer select-none transition-shadow ' + (selected ? 'ring-2 ring-god/70 shadow-[0_0_18px_rgba(34,211,238,0.25)]' : 'hover:ring-1 hover:ring-edge') : ''}`}
      onClick={fuseMode ? onToggleSel : undefined}>
      <div className="flex items-center gap-2">
        {fuseMode && (
          <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold border ${selected ? 'bg-god text-void border-god' : 'border-edge text-dim/40'}`}>
            {selected ? selIndex : ''}
          </span>
        )}
        <span className="flex-1 font-semibold text-sm text-slate-100 truncate">{t.name}</span>
        {t.rarity && <span className={`text-[12px] font-mono font-bold shrink-0 ${cls.split(' ').slice(1).join(' ')}`}>{t.rarity}</span>}
        {!fuseMode && (t.equipped
          ? <span className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-god/50 text-god bg-god/10 shrink-0">佩戴中</span>
          : <button onClick={onEquip} className="text-[12px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:border-god/50 hover:text-god transition-colors shrink-0">佩戴</button>)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-mono text-dim/55">
        {t.obtainedTime && <span>获得：{t.obtainedTime}</span>}
        {t.source && <span>来源：{t.source}</span>}
      </div>
      {t.effect && <div className="text-[13px] text-emerald-300/85 leading-relaxed"><span className="text-dim/40">效果·</span>{t.effect}</div>}
      {t.bonusEffect && <div className="text-[13px] text-amber-300/90 leading-relaxed font-medium"><span className="mr-0.5">✦</span><span className="text-amber-400/60">熔铸额外效果·</span>{t.bonusEffect}</div>}
      {t.desc && <div className="text-[13px] text-dim/60 leading-relaxed italic border-l-2 border-edge/40 pl-2">{t.desc}</div>}
      {!fuseMode && (
        <div className="flex justify-end gap-3 pt-0.5">
          {t.equipped && <button onClick={onUnequip} className="text-[12px] font-mono text-dim/50 hover:text-god transition-colors">卸下</button>}
          <button onClick={onDelete} className="text-[12px] font-mono text-blood/60 hover:text-blood transition-colors">删除</button>
        </div>
      )}
    </div>
  );
}
