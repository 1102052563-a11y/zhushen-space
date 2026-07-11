import { useTts } from '../store/ttsStore';
import { useNpc } from '../store/npcStore';
import { ttsVoices, speakLine, resolveNpcVoice, ttsSupported } from '../systems/tts';

/* 语音朗读设置弹窗：引擎 / 语速 / 旁白音色 / 每 NPC 音色（手选覆盖·默认按性别自动分配）。
   模块级组件（不在父组件内内联定义·避免破坏输入法）；只含 select/range，无文本框。 */

const SAMPLE = '你好，这是语音试听。';

export default function TtsSettings({ onClose }: { onClose: () => void }) {
  const tts = useTts();
  const voices = ttsVoices();
  const npcs = Object.values(useNpc.getState().npcs)
    .filter((r) => r.name && r.name !== r.id && !r.isDead)
    .sort((a, b) => (b.onScene ? 1 : 0) - (a.onScene ? 1 : 0));   // 在场 NPC 优先

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-edge bg-void/95 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-god font-semibold">🔊 语音朗读设置</h3>
          <button onClick={onClose} className="text-dim hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        {/* 引擎 */}
        <div className="mb-4">
          <div className="text-[13px] text-dim mb-1.5">引擎</div>
          <div className="flex gap-2 flex-wrap">
            {(['webspeech', 'cloud'] as const).map((e) => (
              <button key={e} onClick={() => tts.set({ engine: e })}
                className={`px-3 py-1.5 rounded border text-[13px] transition-colors ${tts.engine === e ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                {e === 'webspeech' ? '🔈 本地（离线免费）' : '☁️ 云 TTS（更好听）'}
              </button>
            ))}
          </div>
          {tts.engine !== 'webspeech' && (
            <div className="mt-2 rounded border border-edge/60 bg-black/20 p-2.5 space-y-2">
              <div className="text-[12px] text-dim">云后端</div>
              <div className="flex gap-2 flex-wrap">
                {([['edge', 'Edge·免key'], ['openai', 'OpenAI兼容'], ['azure', 'Azure'], ['google', 'Google']] as const).map(([p, lbl]) => (
                  <button key={p} onClick={() => tts.set({ cloudProvider: p })}
                    className={`px-2.5 py-1 rounded border text-[12px] ${tts.cloudProvider === p ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>{lbl}</button>
                ))}
              </div>
              {tts.cloudProvider === 'edge' && <div className="text-[11px] text-dim/50">微软 Edge 免 key，但音色被砍到 10 个。要全套可靠音色用 Azure。</div>}
              {tts.cloudProvider === 'openai' && (
                <div className="space-y-1.5">
                  <input value={tts.openaiBaseUrl} onChange={(e) => tts.set({ openaiBaseUrl: e.target.value })} placeholder="Base URL（如 https://api.openai.com/v1 · TTS.ai · 自建 GPT-SoVITS 套壳）" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
                  <input value={tts.openaiKey} onChange={(e) => tts.set({ openaiKey: e.target.value })} type="password" placeholder="API Key" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
                  <input value={tts.openaiModel} onChange={(e) => tts.set({ openaiModel: e.target.value })} placeholder="model（默认 tts-1）" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
                </div>
              )}
              {tts.cloudProvider === 'azure' && (
                <div className="space-y-1.5">
                  <input value={tts.azureRegion} onChange={(e) => tts.set({ azureRegion: e.target.value })} placeholder="区域 region（如 eastasia / eastus）" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
                  <input value={tts.azureKey} onChange={(e) => tts.set({ azureKey: e.target.value })} type="password" placeholder="Azure Speech Key（F0 免费档·50万字/月）" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
                  <div className="text-[11px] text-dim/50">同 Edge 那批微软音色，但官方 key = 全列表可靠、不被砍。</div>
                </div>
              )}
              {tts.cloudProvider === 'google' && (
                <input value={tts.googleKey} onChange={(e) => tts.set({ googleKey: e.target.value })} type="password" placeholder="Google Cloud API Key（100万字/月免费）" className="w-full rounded border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5" />
              )}
            </div>
          )}
        </div>

        {/* 语速 */}
        <div className="mb-4">
          <div className="text-[13px] text-dim mb-1.5">语速 <span className="font-mono text-god">{tts.rate.toFixed(2)}×</span></div>
          <input type="range" min={0.5} max={2} step={0.05} value={tts.rate}
            onChange={(e) => tts.set({ rate: Number(e.target.value) })} className="w-full accent-god" />
        </div>

        {/* 旁白音色 */}
        <div className="mb-4">
          <div className="text-[13px] text-dim mb-1.5">旁白音色</div>
          <div className="flex gap-2 items-center">
            <select value={tts.narratorVoice} onChange={(e) => tts.set({ narratorVoice: e.target.value })}
              className="flex-1 rounded border border-edge bg-black/30 text-slate-200 text-[13px] px-2 py-1.5">
              <option value="">默认</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <button onClick={() => void speakLine(SAMPLE, tts.narratorVoice || undefined)}
              className="px-2.5 py-1.5 rounded border border-edge text-dim hover:text-god text-[13px] shrink-0">试听</button>
          </div>
        </div>

        {/* 主角音色 */}
        <div className="mb-4">
          <div className="text-[13px] text-dim mb-1.5">主角音色 <span className="text-dim/50">（主角台词用·未设按性别自动）</span></div>
          <div className="flex gap-2 items-center">
            <select value={tts.playerVoice} onChange={(e) => tts.set({ playerVoice: e.target.value })}
              className="flex-1 rounded border border-edge bg-black/30 text-slate-200 text-[13px] px-2 py-1.5">
              <option value="">自动（按性别）</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <button onClick={() => void speakLine(SAMPLE, tts.playerVoice || undefined)}
              className="px-2.5 py-1.5 rounded border border-edge text-dim hover:text-god text-[13px] shrink-0">试听</button>
          </div>
        </div>

        {/* 每 NPC 音色 */}
        <div>
          <div className="text-[13px] text-dim mb-1.5">每个 NPC 音色 <span className="text-dim/50">（默认按性别自动分配·在场 · 优先）</span></div>
          {npcs.length === 0 ? (
            <div className="text-dim/50 text-[13px] py-2">暂无 NPC</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {npcs.map((n) => (
                <div key={n.id} className="flex gap-2 items-center">
                  <span className="w-20 shrink-0 truncate text-[13px] text-slate-300" title={n.name}>{n.onScene ? '· ' : ''}{n.name}</span>
                  <select value={tts.npcVoices[n.name] || ''} onChange={(e) => tts.setNpcVoice(n.name, e.target.value)}
                    className="flex-1 rounded border border-edge bg-black/30 text-slate-200 text-[13px] px-2 py-1">
                    <option value="">自动（按性别）</option>
                    {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                  <button onClick={() => void speakLine(SAMPLE, tts.npcVoices[n.name] || resolveNpcVoice(n.name) || undefined)}
                    className="px-2 py-1 rounded border border-edge text-dim hover:text-god text-[12px] shrink-0">试听</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {tts.engine === 'webspeech' && voices.length === 0 && (
          <div className="mt-3 text-[12px] text-dim/60">音色列表尚未加载（浏览器异步初始化）——朗读一次或重开本窗即可出现。</div>
        )}
        {tts.engine !== 'webspeech' && (
          <div className="mt-4 text-[12px] text-amber-300/70">☁️ 云 TTS 经网关合成，需先部署 multiplayer-worker；OpenAI/Azure/Google 还要在上面填各自 key。本地引擎离线即用。</div>
        )}
        {!ttsSupported() && <div className="mt-2 text-[12px] text-blood/70">当前环境不支持语音朗读。</div>}
      </div>
    </div>
  );
}
