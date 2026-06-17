import { useEffect, useMemo, useState } from 'react';
import { usePlayer } from '../store/playerStore';
import { useCharacters } from '../store/characterStore';
import { useNpc } from '../store/npcStore';
import { useItems, gradeToNum } from '../store/itemStore';
import { useDice } from '../store/diceStore';
import { lvFromRealm } from '../systems/derivedStats';
import DiceRoller, { type RollOutcome } from './DiceRoller';
import {
  resolve, buildCheckResultBlock, CRIT_MULT,
  ATTR_LABELS, ATTR_KEYS, DIFFICULTIES,
  favorTierFromValue, strengthScoreFromBio,
  type AttrKey, type Difficulty, type Advantage, type ResolveResult, type ResolveSide, type DiceAttrs, type EquipItemLite,
} from '../systems/diceEngine';
import { aiJudge, aiSuggest, buildJudgeBlock, type JudgeOutcome } from '../systems/diceJudge';
import { effectiveAttrs, withAttrDelta } from '../systems/attrBonus';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus } from '../store/adventureTeamStore';

const LEVEL_COLOR: Record<string, string> = {
  大成功: 'text-amber-300', 碾压成功: 'text-emerald-300', 极难成功: 'text-emerald-300',
  困难成功: 'text-emerald-300', 成功: 'text-emerald-300', 失败: 'text-slate-300', 大失败: 'text-red-400',
};
const DEFAULT_ATTRS: DiceAttrs = { str: 5, agi: 5, con: 5, int: 5, cha: 5, luck: 5 };
const equippedOf = (arr: any[] | undefined): EquipItemLite[] =>
  (arr ?? []).filter((it) => it?.equipped).map((it) => ({ category: it.category as string, grade: (it.numeric?.grade as number) ?? gradeToNum(it.gradeDesc) }));
const itemLine = (arr: any[] | undefined): string =>
  (arr ?? []).filter((it) => it?.equipped).map((it) => `${it.name}(${it.category}${it.gradeDesc ? `·${it.gradeDesc}` : ''})`).join('、') || '无';
const skillLine = (arr: any[] | undefined): string => (arr ?? []).map((s) => `${s.name}${s.level ? `·${s.level}` : ''}`).join('、') || '无';
const talentLine = (arr: any[] | undefined): string => (arr ?? []).map((t) => `${t.name}${t.rarity ? `·${t.rarity}` : ''}`).join('、') || '无';

export default function DicePanel({ onClose, onInject }: { onClose: () => void; onInject: (text: string) => void }) {
  const profile = usePlayer((s) => s.profile);
  const characters = useCharacters((s) => s.characters);
  const npcs = useNpc((s) => s.npcs);
  const items = useItems((s) => s.items);
  const settings = useDice((s) => s.settings);
  const diffOverride = useDice((s) => s.settings.diffOverride);
  const setSettings = useDice((s) => s.setSettings);
  const addHistory = useDice((s) => s.addHistory);
  const setDraft = useDice((s) => s.setDraft);

  const mode = settings.mode;
  const judgeMode = settings.judgeMode;
  const pchar = characters['B1'];
  const pskills = pchar?.skills ?? [];
  const ptalents = pchar?.traits ?? [];
  const pEquipped = useMemo(() => equippedOf(items), [items]);
  const onSceneNpcs = useMemo(() => Object.values(npcs).filter((n) => n.onScene && !n.isDead), [npcs]);

  const draft0 = useDice.getState().draft;   // 一次性读取上次/进行中的草稿，恢复面板状态
  const [action, setAction] = useState(draft0?.action ?? '');
  const [attrKey, setAttrKey] = useState<AttrKey>(draft0?.attrKey ?? 'str');
  const [difficulty, setDifficulty] = useState<Difficulty>(draft0?.difficulty ?? '普通');
  const [advantage, setAdvantage] = useState<Advantage>(draft0?.advantage ?? 'norm');
  const [extraMod, setExtraMod] = useState(draft0?.extraMod ?? 0);
  const [opposed, setOpposed] = useState(draft0?.opposed ?? false);
  const [social, setSocial] = useState(draft0?.social ?? false);
  const [opponent, setOpponent] = useState(draft0?.opponent ?? '');
  const [enemyAttrKey, setEnemyAttrKey] = useState<AttrKey>(draft0?.enemyAttrKey ?? 'agi');
  const [result, setResult] = useState<ResolveResult | null>(draft0?.result ?? null);
  const [verdict, setVerdict] = useState<JudgeOutcome | null>(draft0?.verdict ?? null);
  const [judging, setJudging] = useState(false);
  const [rollToken, setRollToken] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');

  // 同步草稿（关闭面板后再打开/刷新仍保留上次或进行中的检定）
  useEffect(() => {
    setDraft({ action, attrKey, difficulty, advantage, extraMod, opposed, social, opponent, enemyAttrKey, result, verdict });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, attrKey, difficulty, advantage, extraMod, opposed, social, opponent, enemyAttrKey, result, verdict]);

  const extraRange = mode === 'd20' ? 5 : 20;
  const isNpcFoe = opposed && opponent.startsWith('c:');
  const foe = isNpcFoe ? npcs[opponent.slice(2)] : undefined;
  const opponentName = useMemo(() => foe?.name || (opponent.startsWith('c:') ? opponent.slice(2) : ''), [opponent, foe]);
  const sgn = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

  function playerSheet(): string {
    const a = profile.attrs;
    return [
      `姓名:${profile.name || '主角'} 阶位:${profile.tier || ''}Lv.${profile.level} 强度:${profile.bioStrength || '—'}`,
      `六维:${ATTR_KEYS.map((k) => `${ATTR_LABELS[k]}${a[k]}`).join(' ')}`,
      `技能:${skillLine(pskills)}`, `天赋:${talentLine(ptalents)}`, `装备:${itemLine(items)}`,
      `状态:${(profile as any).status || '正常'}`,
    ].join('\n');
  }
  function opponentSheet(): string | undefined {
    if (!foe) return undefined;
    const fchar = characters[foe.id];
    const a = foe.attrs;
    return [
      `姓名:${foe.name || foe.id} ${foe.realm || ''} 强度:${foe.bioStrength || '—'}`,
      `六维:${a ? ATTR_KEYS.map((k) => `${ATTR_LABELS[k]}${a[k]}`).join(' ') : '未知'}`,
      `技能:${skillLine(fchar?.skills)}`, `天赋:${talentLine(fchar?.traits)}`, `装备:${itemLine(foe.items)}`,
      `好感:${foe.favor ?? 0} 应对属性:${ATTR_LABELS[enemyAttrKey]}`,
    ].join('\n');
  }

  async function onSuggest() {
    if (suggesting) return;
    setSuggesting(true); setSuggestNote('');
    const out = await aiSuggest({ action, playerSheet: playerSheet(), onscene: onSceneNpcs.map((n) => n.name || n.id).join('、') });
    if (out.attrKey) setAttrKey(out.attrKey);
    if (out.difficulty) setDifficulty(out.difficulty);
    setSuggestNote(out.error
      ? `建议失败：${out.error}`
      : `已填：${ATTR_LABELS[out.attrKey ?? attrKey]} / ${out.difficulty ?? difficulty}${out.skill ? ` · ${out.skill}` : ''}${out.reason ? `（${out.reason}）` : ''}`);
    setSuggesting(false);
  }

  function computeFe(): ResolveResult {
    let enemyStrengthScore: number | undefined;
    let enemy: ResolveSide | undefined;
    let favorTier = null as ReturnType<typeof favorTierFromValue> | null;
    if (opposed && foe) {
      enemyStrengthScore = strengthScoreFromBio(foe.bioStrength, lvFromRealm(foe.realm));
      const fchar = characters[foe.id];
      enemy = { attrs: effectiveAttrs(foe.attrs ?? DEFAULT_ATTRS, [], [], (foe.items ?? []).filter((it) => it.equipped) as any) as DiceAttrs, attrKey: enemyAttrKey, skills: fchar?.skills, talents: fchar?.traits, equipped: equippedOf(foe.items) };
      if (social) favorTier = favorTierFromValue(foe.favor);
    }
    return resolve({
      mode, attrs: effectiveAttrs(withAttrDelta(withAttrDelta(profile.attrs, playerTreeAttrBonus()), playerTeamAttrBonus()), [], [], items.filter((it) => it.equipped)) as DiceAttrs, attrKey, difficulty,
      skills: pskills, talents: ptalents, equipped: pEquipped,
      favorTier, extraMod, includeLuck: settings.includeLuck, advantage,
      opposed, myStrengthScore: strengthScoreFromBio(profile.bioStrength, profile.level),
      enemyStrengthScore, enemy, diffBase: diffOverride, tuning: settings.tuning,
    });
  }

  async function onRoll() {
    if (judging) return;
    const fe = computeFe();
    setResult(fe); setVerdict(null); setRollToken((t) => t + 1);
    let level = fe.level, success = fe.success;
    if (judgeMode === 'ai') {
      setJudging(true);
      const out = await aiJudge({
        mode, actorName: profile.name || '主角', action, attrLabel: ATTR_LABELS[attrKey],
        difficulty: opposed ? undefined : difficulty, opposed, opponentName,
        playerSheet: playerSheet(), opponentSheet: opponentSheet(), fe,
      });
      setVerdict(out); setJudging(false);
      level = out.level; success = out.success;
    }
    addHistory({
      actorName: profile.name || '主角', actionText: action, attrLabel: ATTR_LABELS[attrKey],
      difficulty: opposed ? undefined : difficulty, opposed, opponentName,
      mode: fe.mode, dice: fe.dice, chosen: fe.chosen, total: fe.total, dc: fe.dc, P: fe.P,
      level, success, multiplier: CRIT_MULT[level] ?? 1, backlash: level === '大失败',
    });
  }

  function injectToInput() {
    if (!result || judging) return;
    const block = verdict
      ? buildJudgeBlock({ actorName: profile.name || '主角', attrLabel: ATTR_LABELS[attrKey], difficulty: opposed ? undefined : difficulty, opposed, opponentName, fe: result, out: verdict })
      : buildCheckResultBlock({ actorName: profile.name || '主角', actionText: action, attrLabel: ATTR_LABELS[attrKey], difficulty: opposed ? undefined : difficulty, opposed, opponentName, res: result });
    const text = action.trim() ? `${action.trim()}\n${block}` : block;
    onInject(text);   // 注入主输入框，由玩家自己手动发送
    onClose();
  }

  const effLevel = verdict?.level ?? result?.level;
  const effSuccess = verdict ? verdict.success : result?.success;
  const outcome: RollOutcome = (!result || judging) ? 'none'
    : effLevel === '大成功' ? 'crit' : effLevel === '大失败' ? 'fumble' : effSuccess ? 'success' : 'fail';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl h-[90vh] flex flex-col rounded-2xl border border-edge bg-void shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-edge bg-panel">
          <span className="text-god/60 text-lg">🎲</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">ROLL 点 · 摇骰检定</div>
            <div className="text-[12px] font-mono text-dim/60">{mode === 'd20' ? 'DND d20（1d20+修正 ≥ DC）' : 'CoC 百分骰（1d100 ≤ 成功率）'}</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg transition-colors">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 判定方式开关 */}
          <div className="flex items-center gap-2 text-[12px] font-mono">
            <span className="text-dim/60">判定方式</span>
            {(['frontend', 'ai'] as const).map((m) => (
              <button key={m} onClick={() => setSettings({ judgeMode: m })}
                className={`px-2.5 py-1 rounded border transition-colors ${judgeMode === m ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                {m === 'frontend' ? '前端确定性' : 'AI 裁判'}
              </button>
            ))}
            <span className="text-dim/40 ml-auto">{judgeMode === 'ai' ? '骰子锚定·AI裁定·失败回退' : '本地计算·零调用'}</span>
          </div>

          <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={2}
            placeholder="本回合行动（如：我撬开这扇上锁的铁门）"
            className="w-full rounded-lg border border-edge bg-panel/60 px-3 py-2 text-sm text-slate-200 placeholder:text-dim/40 resize-none focus:border-god/50 outline-none" />
          <div className="flex items-center gap-2 -mt-1">
            <button onClick={onSuggest} disabled={suggesting}
              className="shrink-0 px-3 py-1 rounded-lg border border-god/40 text-god text-[12px] font-mono hover:bg-god/10 disabled:opacity-40 disabled:cursor-wait transition-colors">
              {suggesting ? '✨ 思考中…' : '✨ AI 建议属性/难度'}
            </button>
            {suggestNote && <span className="text-[11px] font-mono text-dim/60 truncate">{suggestNote}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="我方属性">
              <Select value={attrKey} onChange={(v) => setAttrKey(v as AttrKey)}
                options={ATTR_KEYS.map((k) => ({ value: k, label: `${ATTR_LABELS[k]} ${profile.attrs[k]}` }))} />
            </Field>
            <Field label="难度">
              <Select value={difficulty} disabled={opposed} onChange={(v) => setDifficulty(v as Difficulty)}
                options={DIFFICULTIES.map((d) => ({ value: d, label: d }))} />
            </Field>
            <Field label="优劣势">
              <Select value={advantage} onChange={(v) => setAdvantage(v as Advantage)}
                options={[{ value: 'norm', label: '正常' }, { value: 'adv', label: '优势' }, { value: 'dis', label: '劣势' }]} />
            </Field>
          </div>

          <div className="rounded-lg border border-edge bg-panel/40 px-3 py-2 text-[12px] font-mono text-dim/70">
            自动计入主角全部：技能 ×{pskills.length}　天赋 ×{ptalents.length}　装备 ×{pEquipped.length}
          </div>

          <Field label={`情境修正：${sgn(extraMod)}（环境/优劣形势）`}>
            <input type="range" min={-extraRange} max={extraRange} step={1} value={extraMod}
              onChange={(e) => setExtraMod(Number(e.target.value))} className="w-full accent-god" />
          </Field>

          <div className="rounded-lg border border-edge bg-panel/40 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={opposed} onChange={(e) => setOpposed(e.target.checked)} className="accent-god" />
              对抗 / 对战检定（算敌方全部属性/技能/天赋/装备）
            </label>
            {opposed && (
              <>
                <Field label={`对手（在场 NPC，自动读其面板全部数据${onSceneNpcs.length ? '' : '：当前无在场 NPC'}）`}>
                  <Select value={opponent} onChange={setOpponent}
                    options={[
                      { value: '', label: '— 选择在场 NPC —' },
                      ...onSceneNpcs.map((n) => ({ value: `c:${n.id}`, label: `${n.name || n.id}（${(n.realm || '在场').split('|')[0]}）` })),
                    ]} />
                </Field>
                {isNpcFoe && (
                  <Field label="敌方应对属性">
                    <Select value={enemyAttrKey} onChange={(v) => setEnemyAttrKey(v as AttrKey)}
                      options={ATTR_KEYS.map((k) => ({ value: k, label: `${ATTR_LABELS[k]} ${foe?.attrs?.[k] ?? '—'}` }))} />
                  </Field>
                )}
                <label className="flex items-center gap-2 text-[13px] text-dim cursor-pointer">
                  <input type="checkbox" checked={social} onChange={(e) => setSocial(e.target.checked)} className="accent-god" />
                  社交检定（计入对方好感度）
                </label>
                <p className="text-[11px] font-mono text-dim/50">对手读取其 NPC 面板全部数据（六维/技能/天赋/装备/好感）。多打一选最强的当代表。</p>
              </>
            )}
          </div>

          <DiceRoller mode={mode} finalValue={result?.chosen ?? (mode === 'd20' ? 20 : 50)} outcome={outcome} rollToken={rollToken} animMs={settings.animMs} />

          {judging && <div className="text-center text-sm font-mono text-god/80 animate-pulse">⚖ AI 裁判中…</div>}

          {result && !judging && (
            <div className="rounded-lg border border-edge bg-panel/60 p-3 text-center space-y-1">
              <div className={`text-lg font-bold ${LEVEL_COLOR[effLevel || ''] || 'text-slate-200'}`}>
                {effLevel}
                {(effLevel === '大失败') ? '（反噬己方）' : (CRIT_MULT[effLevel || '成功'] ?? 1) !== 1 ? `　后果×${CRIT_MULT[effLevel || '成功']}` : ''}
                {verdict ? (verdict.usedAI ? '　· AI裁定' : '　· 前端兜底') : ''}
              </div>
              <div className="text-[13px] font-mono text-dim">
                {mode === 'd20'
                  ? `d20:${result.chosen} ${sgn(result.mods.total)} = ${result.total} / DC${result.dc}`
                  : `d100:${result.chosen} / P${result.P}%`}
                　|　胜算 {result.P}%
              </div>
              {verdict?.reasoning && <div className="text-[12px] text-slate-300 leading-relaxed">裁定：{verdict.reasoning}</div>}
              {verdict?.consequences && verdict.consequences.length > 0 && (
                <div className="text-[11px] font-mono text-dim/70">后果：{verdict.consequences.join('；')}</div>
              )}
              {!verdict && (
                <div className="text-[11px] font-mono text-dim/50">
                  属性{sgn(result.mods.attr)} 技能{sgn(result.mods.skill)} 天赋{sgn(result.mods.talent)} 装备{sgn(result.mods.equip)}
                  {result.mods.favor ? ` 好感${sgn(result.mods.favor)}` : ''}
                  {settings.includeLuck ? ` 幸运${sgn(result.mods.luck)}` : ''}
                  {result.mods.extra ? ` 情境${sgn(result.mods.extra)}` : ''}
                  {opposed ? ` 强度差${sgn(result.mods.strength)}${result.mods.enemyRel ? ` 敌方-${result.mods.enemyRel}` : ''}` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="shrink-0 flex gap-2 px-4 py-3 border-t border-edge bg-panel">
          <button onClick={onRoll} disabled={judging}
            className="flex-1 rounded-lg border border-god/50 bg-god/10 text-god py-2 text-sm font-bold hover:bg-god/20 disabled:opacity-40 disabled:cursor-wait transition-colors">
            {judging ? '判定中…' : judgeMode === 'ai' ? '🎲 掷骰 + AI 裁判' : '🎲 掷骰'}
          </button>
          <button onClick={injectToInput} disabled={!result || judging}
            className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 py-2 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            📥 注入到输入框
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-mono text-dim/60 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-edge bg-panel px-2 py-1.5 text-sm text-slate-200 focus:border-god/50 outline-none disabled:opacity-40">
      {options.map((o) => <option key={o.value} value={o.value} className="bg-void">{o.label}</option>)}
    </select>
  );
}
