import { useState, useRef, useEffect, useMemo } from 'react';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from '../systems/apiChat';
import { WORLD_GEN_PROMPT } from '../worldGenPrompt';
import { findJoyBook, quickInsertTitles } from '../systems/joyWorldBook';   // 通用：按书名(姿势/BDSM)定位 + 取条目标题，复用于正文世界书

export interface WorldOption {
  name: string;
  desc: string;
  tier: string;
  worldType: string;
  dangerLevel: string;
  entryPoint: string;
  mainMission: string;
  sideMission: string;
  warning: string;
  reward: string;
  peakPower: string;
  contractorDist: string;
  region: string;
  entryComment: string;
  entryContent: string;
  entryKeys: string[];
}

interface Props {
  onSelect: (text: string) => void;
  onRawResponse: (raw: string) => void;
  onPromptSent: (prompt: string) => void;
  onWorlds: (worlds: WorldOption[]) => void;
  onSettle?: () => void;   // 点「结算任务」：把【结算任务】塞进输入框，由正文 AI 按结算规则结算回归
  onInsertText?: (text: string) => void;   // 点姿势/BDSM条目标题：把标题追加进输入框（绿灯关键词，发送后触发正文世界书注入）
  expanded?: boolean;      // 收起时（idle 阶段）不渲染「选择世界/结算任务」按钮行，省空间；点状态栏展开
}

type Stage = 'idle' | 'config' | 'loading' | 'results' | 'error';

// 点名生成：从「当前阶世界库」里随机点名 N 个不重复的世界编号（1~max）。世界数不足则全取并打乱。
const WORLD_PICK_COUNT = 10;
function rollPicks(max: number, n = WORLD_PICK_COUNT): number[] {
  if (max <= 0) return [];
  if (max <= n) {
    const all = Array.from({ length: max }, (_, i) => i + 1);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all;
  }
  const s = new Set<number>();
  while (s.size < n) s.add(1 + Math.floor(Math.random() * max));
  return [...s];
}

// 解析「世界选择 / 休闲」世界书条目，按文档顺序抽出世界名列表（序号即 index+1）。
// 兼容四种格式：带引号 "id|name"、九阶 bold **id|name**、裸行 id|name、休闲 YAML id:/name:。
export function parseWorldList(content: string): string[] {
  const items: { name: string; pos: number }[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string, pos: number) => {
    const nm = String(name).replace(/\*+/g, '').replace(/^["「\s]+|["」\s]+$/g, '').trim();
    if (!nm) return;
    const key = id + '|' + nm;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name: nm, pos });
  };
  const patterns = [
    /"(\d+)\|([^"|]+)"/g,
    /\*\*(\d+)\|([^*|]+)\*\*/g,
    /(?:^|[\r\n])[ \t>*-]*(\d+)\|([^"\n\r*|]+)/g,
    /id:\s*(\d+)\s*[\r\n]+\s*name:\s*"?([^"\n\r]+?)"?\s*(?=[\r\n]|$)/g,
  ];
  for (const re of patterns) { let m: RegExpExecArray | null; while ((m = re.exec(content)) !== null) add(m[1], m[2], m.index); }
  items.sort((a, b) => a.pos - b.pos);
  return items.map((x) => x.name);
}

function extractJson(raw: string): any[] {
  // 剥掉 markdown 代码块
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 尝试直接找 JSON 数组
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }

  // 尝试找 JSON 对象，取其中第一个数组字段
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]);
      const arr = Object.values(obj).find((v) => Array.isArray(v)) as any[];
      if (arr && arr.length > 0) return arr;
    } catch {}
  }

  // 最后兜底：逐行找 {"name":...,"desc":...} 对象
  const items: any[] = [];
  const lineReg = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"desc"\s*:\s*"([^"]+)"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = lineReg.exec(text)) !== null) {
    items.push({ name: m[1], desc: m[2] });
  }
  if (items.length > 0) return items;

  throw new Error('模型未返回有效 JSON，请点击「查看返回」查看原始内容');
}

export default function WorldSelector({ onRawResponse, onPromptSent, onWorlds, onSettle, onInsertText, expanded }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [quickKind, setQuickKind] = useState<'pose' | 'bdsm' | null>(null);  // 展开的快捷条目类别（姿势/BDSM）
  const [rank, setRank] = useState('');
  const [rolls, setRolls] = useState<number[]>([]);   // 点名的世界编号列表（1~worldList.length）
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [leisure, setLeisure] = useState(false);   // 休闲世界模式：忽略阶位，按「休闲世界」世界书生成休闲/恋爱向世界
  const rankRef = useRef<HTMLInputElement>(null);

  const api = useSettings((s) => s.api);
  const systemPrompt = useSettings((s) => s.systemPrompt);
  const worldBooks = useSettings((s) => s.worldBooks);
  const textWorldBooks = useSettings((s) => s.textWorldBooks);

  // 姿势 / BDSM 快捷按钮：从正文世界书里按书名定位两本，提取可插入的条目标题（参考欢愉宫包间快捷按钮）
  const poseTitles = useMemo(() => quickInsertTitles(findJoyBook(textWorldBooks, 'pose')), [textWorldBooks]);
  const bdsmTitles = useMemo(() => quickInsertTitles(findJoyBook(textWorldBooks, 'bdsm')), [textWorldBooks]);
  const quickTitles = quickKind === 'pose' ? poseTitles : quickKind === 'bdsm' ? bdsmTitles : [];
  const insertQuick = (title: string) => { onInsertText?.(title); };

  // 当前阶位归一成中文数字（一/二…），供世界库定位与提示展示。输入支持「一 / 1 / 三阶」。
  const cn = useMemo(() => {
    const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const t = rank.trim().replace(/[阶世界\s]/g, '');
    return /^[1-9]$/.test(t) ? CN[Number(t)] : t;
  }, [rank]);

  // 当前「点名世界库」：休闲取休闲世界书；否则按阶位键【选择N阶世界】定位该阶条目，解析成有序世界名列表（序号=index+1）。
  const worldList = useMemo<string[]>(() => {
    const books = worldBooks.filter((b) => b.enabled);
    if (leisure) {
      return books
        .filter((b) => b.builtinKey === 'wb-leisure' || b.name === '休闲世界')
        .flatMap((b) => b.entries.filter((e) => e.enabled))
        .flatMap((e) => parseWorldList(e.content || ''));
    }
    const tierKey = cn ? `选择${cn}阶世界` : '';
    if (!tierKey) return [];
    return books
      .flatMap((b) => b.entries.filter((e) => e.enabled && (e.key || []).some((k) => k.includes(tierKey))))
      .flatMap((e) => parseWorldList(e.content || ''));
  }, [worldBooks, leisure, cn]);

  const nameOf = (v: number) => worldList[v - 1] || '';
  const doRoll = () => { if (worldList.length > 0) setRolls(rollPicks(worldList.length)); };
  const updatePick = (i: number, raw: string) => {
    const n = parseInt(raw, 10);
    setRolls((prev) => prev.map((x, idx) => (idx === i ? (Number.isFinite(n) ? Math.max(1, n) : x) : x)));
  };

  useEffect(() => {
    if (stage === 'config') rankRef.current?.focus();
  }, [stage]);

  function pickEntries() {
    // 休闲模式：直接取「休闲世界」世界书的全部启用条目（忽略阶位/关键词匹配）
    if (leisure) {
      return worldBooks
        .filter((b) => b.enabled && (b.builtinKey === 'wb-leisure' || b.name === '休闲世界'))
        .flatMap((b) => b.entries.filter((e) => e.enabled));
    }
    // 蓝灯（constant）：常驻，始终纳入
    // 绿灯（selective）：关键词触发
    const ctx = (rank + ' ' + systemPrompt).toLowerCase();
    // 适配「世界选择世界书」：键名形如【选择三阶世界】。把输入(三/3/三阶)归一成中文数字，拼出目标键去匹配。
    const cn = (() => {
      const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
      const t = rank.trim().replace(/[阶世界\s]/g, '');
      return /^[1-9]$/.test(t) ? CN[Number(t)] : t;
    })();
    const tierKey = cn ? `选择${cn}阶世界` : '';
    return worldBooks
      .filter((b) => b.enabled)
      .flatMap((b) =>
        b.entries.filter((e) => {
          if (!e.enabled) return false;
          if (e.constant) return true;
          if (e.selective) {
            const keys = (e.key || []).filter(Boolean);
            if (keys.length === 0) return false;
            return keys.some((k) =>
              ctx.includes(k.toLowerCase()) ||      // 原：上下文含关键词
              (tierKey && k.includes(tierKey))      // 新：键含【选择N阶世界】(世界选择书按阶位命中)
            );
          }
          return false;
        })
      );
  }

  async function generate() {
    setStage('loading');
    setErrorMsg('');

    // 接口路由优先：world 路由有启用接口则走路由链（多接口轮流+fallback），否则回退到全局 API
    const chain = resolveApiChain('world', api).filter((a) => a.baseUrl && a.apiKey);
    if (chain.length === 0) {
      setErrorMsg('请先配置 API：在「世界选择」的接口路由里选接口库接口，或在系统设置填写全局 API 地址和 Key');
      setStage('error');
      return;
    }

    const picked = pickEntries();
    // 世界生成用内置专用提示词（含字段与字数规范），不再依赖全局 systemPrompt
    const sysContent = WORLD_GEN_PROMPT;

    // 点名生成：把「点名编号」映射成世界库里的世界名清单（去重、去空）。为空则自动 Roll 一批。
    if (worldList.length === 0) {
      setErrorMsg('请先在上方填阶位（一 / 二 / 3…）以载入该阶世界库，再 Roll / 编辑点名世界');
      setStage('config');
      return;
    }
    let cur = rolls;
    if (cur.length === 0) { cur = rollPicks(worldList.length); setRolls(cur); }
    const pickedNames = [...new Set(cur.map((v) => worldList[v - 1]).filter(Boolean))];
    if (pickedNames.length === 0) {
      setErrorMsg(`点名编号都不在世界库范围内（应为 1~${worldList.length}）；请重新 Roll 或修改编号`);
      setStage('config');
      return;
    }

    const rankPart = leisure
      ? '生成休闲世界（休闲 / 恋爱向的轻松日常世界，无生存压力；阶位固定一阶）'
      : (cn ? `目标阶位：${cn}阶` : '目标阶位：未指定（按通用难度生成）');
    const listPart =
      `【指定世界清单】请严格为以下 ${pickedNames.length} 个世界逐一生成卡片（逐一对应、不得替换 / 增减 / 另选）：\n` +
      pickedNames.map((n, i) => `${i + 1}. ${n}`).join('\n');

    const entriesText = picked.length > 0
      ? picked.map((e, i) => {
          const lamp = e.constant ? '【常驻】' : e.selective ? '【绿灯/触发】' : '';
          return `条目${i + 1}${lamp}【${e.comment || `#${e.uid}`}】\n${e.content}`;
        }).join('\n\n')
      : '（无匹配世界书条目；请基于上述指定世界清单与目标阶位合理生成）';

    const userMessage =
      `${rankPart}\n\n${listPart}\n\n` +
      (leisure
        ? `以下是「休闲世界」世界书条目（含规则 / 铁则与世界库），供取材与设定参考：\n\n${entriesText}`
        : `以下是该阶世界书条目（含规则 / 铁则与世界库），供取材与设定参考：\n\n${entriesText}`);

    // 发送前记录完整提示词
    const fullPrompt =
      `=== SYSTEM ===\n${sysContent}\n\n=== USER ===\n${userMessage}`;
    onPromptSent(fullPrompt);

    try {
      const { content } = await apiChatFallback(chain, [
        { role: 'system', content: sysContent },
        { role: 'user', content: userMessage },
      ], { timeoutMs: 180000 });
      onRawResponse(content || '（响应为空）');

      const raw = extractJson(content);
      const s = (v: any) => (v != null ? String(v) : '');
      const merged: WorldOption[] = raw.map((w) => ({
        name:        s(w.name ?? w.worldName ?? w['世界名称'] ?? w.title),
        desc:        s(w.desc ?? w.shortIntro ?? w['世界简介'] ?? w.description ?? w.intro),
        tier:        s(w.tier ?? w['阶位']),
        worldType:   s(w.type ?? w['类型']),
        dangerLevel: s(w.dangerLevel ?? w['难度预估']),
        entryPoint:  s(w.entryPoint ?? w['切入点']),
        mainMission: s(w.mainMission ?? w['主线任务']),
        sideMission: s(w.sideMission ?? w['支线任务']),
        warning:     s(w.warning ?? w['警告与提示']),
        reward:      s(w.reward ?? w.rewardPreview ?? w['奖励预览']),
        peakPower:   s(w.peakPower ?? w['世界巅峰战力']),
        contractorDist: s(w.contractorDist ?? w['契约者分布'] ?? w.contractor),
        region:      s(w.region ?? w['主要任务限定区域']),
        entryComment: '',
        entryContent: '',
        entryKeys: [],
      }));
      setWorlds(merged);
      onWorlds(merged);
      setStage('results');
    } catch (e: any) {
      setErrorMsg(e.message ?? '未知错误');
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setRank('');
    setRolls([]);
    setWorlds([]);
    setErrorMsg('');
    setLeisure(false);
  }

  /* ── idle ── */
  if (stage === 'idle') {
    if (!expanded) return null;   // 默认收起，由状态命令栏点击展开（按钮不常用，省空间）
    return (
      <div className="shrink-0 border-t border-edge bg-panel px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStage('config')}
            className="flex items-center gap-2 px-3 py-1.5 border border-god/30 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono"
          >
            🌍 选择世界
          </button>
          {onSettle && (
            <button
              onClick={onSettle}
              title="结算本世界任务：在输入框插入【结算任务】，发送后由正文 AI 按结算规则回归专属房间并发放奖励"
              className="flex items-center gap-2 px-3 py-1.5 border border-amber-500/40 text-amber-300 text-sm rounded hover:bg-amber-500/10 transition-colors font-mono"
            >
              📊 结算任务
            </button>
          )}
          {/* 姿势 / BDSM 快捷按钮（参考欢愉宫包间）：展开正文世界书条目标题→点一下填进输入框，发送后绿灯关键词触发对应描写注入 */}
          {onInsertText && poseTitles.length > 0 && (
            <button
              onClick={() => setQuickKind(quickKind === 'pose' ? null : 'pose')}
              title="性爱姿势世界书：点选体位标题填入输入框（绿灯关键词，发送后正文世界书自动注入对应描写）"
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-sm rounded font-mono transition-colors ${quickKind === 'pose' ? 'border-pink-400/60 text-pink-100 bg-pink-500/15' : 'border-pink-500/30 text-pink-300/90 hover:bg-pink-500/10'}`}
            >
              🤸 姿势 <span className="text-pink-300/40">{poseTitles.length}</span>
            </button>
          )}
          {onInsertText && bdsmTitles.length > 0 && (
            <button
              onClick={() => setQuickKind(quickKind === 'bdsm' ? null : 'bdsm')}
              title="BDSM 世界书：点选道具/调教标题填入输入框（绿灯关键词，发送后正文世界书自动注入对应描写）"
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-sm rounded font-mono transition-colors ${quickKind === 'bdsm' ? 'border-pink-400/60 text-pink-100 bg-pink-500/15' : 'border-pink-500/30 text-pink-300/90 hover:bg-pink-500/10'}`}
            >
              ⛓ BDSM <span className="text-pink-300/40">{bdsmTitles.length}</span>
            </button>
          )}
          {quickKind && <span className="text-[11px] font-mono text-dim/45">点选填入输入框 · 可多选</span>}
          {quickKind && <button onClick={() => setQuickKind(null)} className="ml-auto text-dim/40 hover:text-pink-200 text-[12px] font-mono">收起 ✕</button>}
        </div>
        {quickKind && (
          <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5 rounded-lg border border-pink-500/15 bg-void/50 p-2">
            {quickTitles.map((t) => (
              <button key={t} onClick={() => insertQuick(t)}
                className="text-[12px] px-2 py-0.5 rounded-full border border-pink-500/25 text-pink-100/90 bg-pink-500/5 hover:bg-pink-500/20 hover:border-pink-400/50 transition-colors">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ── config ── */
  if (stage === 'config') {
    return (
      <div className="shrink-0 border-t border-god/20 bg-panel px-4 py-3 space-y-3">
        {/* 阶位 / 休闲 + 操作按钮 */}
        <div className="flex items-center gap-0 text-sm">
          <span className={`text-god/80 font-mono shrink-0 ${leisure ? 'opacity-30' : ''}`}>【选择</span>
          <input
            ref={rankRef}
            value={rank}
            disabled={leisure}
            onChange={(e) => setRank(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') reset(); }}
            placeholder="X"
            className={`w-20 bg-void border-b border-god/40 px-1 py-0.5 text-sm text-slate-200 placeholder:text-dim/60 outline-none focus:border-god text-center font-mono ${leisure ? 'opacity-30' : ''}`}
          />
          <span className={`text-god/80 font-mono shrink-0 ${leisure ? 'opacity-30' : ''}`}>阶世界】</span>
          <button
            onClick={() => setLeisure((v) => !v)}
            title="休闲世界：忽略阶位，按内置「休闲世界」世界书生成休闲 / 恋爱向轻松世界"
            className={`ml-2 px-2.5 py-1.5 text-sm border rounded font-mono transition-colors ${leisure ? 'border-emerald-400/70 bg-emerald-900/30 text-emerald-200' : 'border-emerald-500/30 text-emerald-300/80 hover:bg-emerald-900/20'}`}
          >
            🌴 休闲世界{leisure ? ' ✓' : ''}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={generate}
              className="px-4 py-1.5 text-sm border border-god/50 text-god rounded hover:bg-god/10 font-mono transition-colors"
            >
              生成
            </button>
            <button onClick={reset} className="text-dim hover:text-blood text-sm font-mono w-5 text-center">✕</button>
          </div>
        </div>

        {leisure && (
          <div className="text-[12px] font-mono text-emerald-300/70">🌴 休闲模式：忽略阶位，从休闲世界库点名世界（可 🎲 Roll 或手改编号），点「生成」即生成你点名的休闲 / 恋爱向世界。</div>
        )}

        {/* 点名世界：Roll / 编辑「世界编号」，每个编号对应该阶世界库里的一个世界；改编号即点名想要的世界，下方实时显示对应世界名 */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={doRoll}
              disabled={worldList.length === 0}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-amber-500/40 text-amber-400 text-sm rounded hover:bg-amber-900/20 font-mono transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              🎲 随机点名 {WORLD_PICK_COUNT} 个
            </button>
            {worldList.length > 0 ? (
              <span className="text-[12px] font-mono text-dim/60">
                {leisure ? '休闲' : cn ? `${cn}阶` : ''}世界库共 <span className="text-god/80">{worldList.length}</span> 个世界 · 编号 1~{worldList.length}（点编号可改，点名想要的世界）
              </span>
            ) : (
              <span className="text-[12px] font-mono text-amber-300/70">先在上方填阶位（一 / 二 / 3…）{leisure ? '' : ' 或勾选 🌴 休闲'}，载入世界库后再点名</span>
            )}
            {rolls.length > 0 && worldList.length > 0 && (
              <button onClick={doRoll} className="text-[12px] text-dim hover:text-god font-mono">↺ 重roll</button>
            )}
          </div>
          {rolls.length > 0 && worldList.length > 0 && (
            <div className="grid grid-cols-5 max-lg:grid-cols-2 gap-2">
              {rolls.map((v, i) => {
                const nm = nameOf(v);
                return (
                  <div key={i} className="flex flex-col gap-0.5 border border-edge rounded-lg px-2 py-1.5 bg-void/40">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-dim/40 font-mono shrink-0">{i + 1}.</span>
                      <input
                        type="number" min={1} max={worldList.length} value={v}
                        onChange={(e) => updatePick(i, e.target.value)}
                        className="w-full bg-void border-b border-god/30 px-1 py-0.5 text-[13px] text-amber-300 font-mono text-center outline-none focus:border-god"
                      />
                    </div>
                    <span className={`text-[11px] font-mono leading-tight truncate ${nm ? 'text-god/80' : 'text-blood/70'}`} title={nm || '无此编号'}>
                      {nm || '— 无此编号'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    );
  }

  /* ── loading ── */
  if (stage === 'loading') {
    return (
      <div className="shrink-0 border-t border-god/20 bg-panel px-4 py-3 flex items-center gap-3 text-sm font-mono text-god/70">
        <span className="animate-spin inline-block">◌</span>
        <span>正在生成世界列表，请稍候…</span>
        <button onClick={reset} className="ml-auto text-dim hover:text-blood">取消</button>
      </div>
    );
  }

  /* ── error ── */
  if (stage === 'error') {
    return (
      <div className="shrink-0 border-t border-blood/30 bg-panel">
        <div className="px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-blood font-mono">⚠ {errorMsg}</span>
          <button onClick={() => setStage('config')} className="ml-auto px-3 py-1 border border-edge text-dim rounded hover:text-god hover:border-god/40 font-mono transition-colors">重试</button>
          <button onClick={reset} className="text-dim hover:text-blood font-mono">✕</button>
        </div>
      </div>
    );
  }

  /* ── results ── */
  return (
    <div className="shrink-0 border-t border-god/20 bg-panel px-4 py-2 flex items-center gap-3 text-sm font-mono">
      <span className="text-god/80">🌍 已生成 {worlds.length} 个世界，请在上方选择</span>
      {rolls.length > 0 && (
        <span className="text-amber-400/60">🎲 {rolls.slice(0, 4).join(' · ')}…</span>
      )}
      <button onClick={() => setStage('config')} className="ml-auto text-dim hover:text-god border border-edge px-2 py-0.5 rounded hover:border-god/40 transition-colors">重新生成</button>
      <button onClick={reset} className="text-dim hover:text-blood font-mono">✕</button>
    </div>
  );
}
