import { useState, useRef, useEffect } from 'react';
import { useSettings } from '../store/settingsStore';

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
}

type Stage = 'idle' | 'config' | 'loading' | 'results' | 'error';

function rollDice(): number[] {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 1501));
}

function extractJson(raw: string): WorldOption[] {
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
  const items: WorldOption[] = [];
  const lineReg = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"desc"\s*:\s*"([^"]+)"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = lineReg.exec(text)) !== null) {
    items.push({ name: m[1], desc: m[2] });
  }
  if (items.length > 0) return items;

  throw new Error('模型未返回有效 JSON，请点击「查看返回」查看原始内容');
}

export default function WorldSelector({ onSelect, onRawResponse, onPromptSent, onWorlds }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [rank, setRank] = useState('');
  const [rolls, setRolls] = useState<number[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const rankRef = useRef<HTMLInputElement>(null);

  const api = useSettings((s) => s.api);
  const systemPrompt = useSettings((s) => s.systemPrompt);
  const worldBooks = useSettings((s) => s.worldBooks);

  useEffect(() => {
    if (stage === 'config') rankRef.current?.focus();
  }, [stage]);

  function pickEntries() {
    // 蓝灯（constant）：常驻，始终纳入
    // 绿灯（selective）：关键词触发，rank 或 systemPrompt 中命中任一主关键词则纳入
    const ctx = (rank + ' ' + systemPrompt).toLowerCase();
    return worldBooks
      .filter((b) => b.enabled)
      .flatMap((b) =>
        b.entries.filter((e) => {
          if (!e.enabled) return false;
          if (e.constant) return true;
          if (e.selective) {
            return e.key.length > 0 && e.key.some((k) => k && ctx.includes(k.toLowerCase()));
          }
          return false;
        })
      );
  }

  async function generate() {
    setStage('loading');
    setErrorMsg('');

    if (!api.baseUrl || !api.apiKey) {
      setErrorMsg('请先在系统设置中配置 API 地址和 Key');
      setStage('error');
      return;
    }

    const picked = pickEntries();
    const sysContent = systemPrompt || '你是一个沉浸式文字RPG的游戏主持人（GM）。';

    const rankPart = rank.trim() ? `【选择${rank.trim()}阶世界】` : '【选择世界】';
    const rollPart = rolls.length > 0
      ? `Roll点（12次 0-1500）：${rolls.join('、')}\n请根据Roll点高低体现世界的稀有度与难度。\n`
      : '';

    const entriesText = picked.length > 0
      ? picked.map((e, i) => {
          const lamp = e.constant ? '【常驻】' : e.selective ? '【触发】' : '';
          return `世界${i + 1}${lamp}【${e.comment || `条目${e.uid}`}】\n${e.content}`;
        }).join('\n\n')
      : '（世界书为空）';

    const userMessage =
      `${rankPart}\n${rollPart}\n` +
      `以下是世界书内容，供你参考：\n\n${entriesText}`;

    // 发送前记录完整提示词
    const fullPrompt =
      `=== SYSTEM ===\n${sysContent}\n\n=== USER ===\n${userMessage}`;
    onPromptSent(fullPrompt);

    try {
      const url = api.baseUrl.replace(/\/$/, '') + '/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({
          model: api.modelId,
          messages: [
            { role: 'system', content: sysContent },
            { role: 'user', content: userMessage },
          ],
          temperature: api.temperature,
          max_tokens: api.maxTokens,
          top_p: api.topP,
        }),
      });
      const rawText = await res.text();
      onRawResponse(rawText || '（响应为空）');

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}${rawText ? ': ' + rawText.slice(0, 200) : ''}`);
      }

      const data = JSON.parse(rawText);
      const content: string =
        data.choices?.[0]?.message?.content ??
        data.choices?.[0]?.text ??
        data.content ??
        JSON.stringify(data);

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
    setRawResponse('');
    setShowRaw(false);
  }

  /* ── idle ── */
  if (stage === 'idle') {
    return (
      <div className="shrink-0 border-t border-edge bg-panel px-3 py-2 flex items-center">
        <button
          onClick={() => setStage('config')}
          className="flex items-center gap-2 px-3 py-1.5 border border-god/30 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono"
        >
          🌍 选择世界
        </button>
      </div>
    );
  }

  /* ── config ── */
  if (stage === 'config') {
    return (
      <div className="shrink-0 border-t border-god/20 bg-panel px-4 py-3 space-y-3">
        {/* 阶位 + 操作按钮 */}
        <div className="flex items-center gap-0 text-sm">
          <span className="text-god/80 font-mono shrink-0">【选择</span>
          <input
            ref={rankRef}
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') reset(); }}
            placeholder="X"
            className="w-20 bg-void border-b border-god/40 px-1 py-0.5 text-sm text-slate-200 placeholder:text-dim/60 outline-none focus:border-god text-center font-mono"
          />
          <span className="text-god/80 font-mono shrink-0">阶世界】</span>
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

        {/* Roll点 */}
        <div className="flex items-start gap-3">
          <button
            onClick={() => setRolls(rollDice())}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-amber-500/40 text-amber-400 text-sm rounded hover:bg-amber-900/20 font-mono transition-colors"
          >
            🎲 随机Roll点
          </button>
          {rolls.length > 0 ? (
            <div className="flex-1 flex flex-wrap gap-1 items-center">
              {rolls.map((v, i) => (
                <span key={i} className={`text-[13px] font-mono px-1.5 py-0.5 rounded border ${
                  v >= 1200 ? 'text-amber-300 border-amber-500/50 bg-amber-900/20' :
                  v >= 800  ? 'text-god border-god/30 bg-god/5' :
                  v >= 400  ? 'text-slate-300 border-edge bg-panel2' :
                              'text-dim border-edge/50'
                }`}>{v}</span>
              ))}
              <button onClick={() => setRolls(rollDice())} className="text-[12px] text-dim hover:text-god font-mono ml-1">↺</button>
            </div>
          ) : (
            <span className="text-sm text-dim/50 font-mono self-center">点击可Roll 12 个点（范围 0–1500）</span>
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
