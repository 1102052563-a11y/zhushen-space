import { useTts, type CloudProvider } from '../store/ttsStore';
import { useNpc } from '../store/npcStore';
import { ttsVoices, speakLine, resolveNpcVoice, ttsSupported } from '../systems/tts';

/* 语音朗读设置页：引擎与后端 / 语速 / 音色分配（旁白·主角·每 NPC）。
   分区卡片、留白充足，取代原来挤在小按钮弹窗里的形态。模块级组件·只含 select/range/text，无内联子组件。 */

const SAMPLE = '你好，这是语音试听。';
const PROVIDERS: [CloudProvider, string][] = [['edge', 'Edge · 免 key'], ['openai', 'OpenAI 兼容'], ['azure', 'Azure'], ['google', 'Google']];
const inputCls = 'w-full rounded-lg border border-edge bg-black/30 text-slate-200 text-[13px] px-2.5 py-2 focus:border-god/50 outline-none';
const selCls = 'flex-1 rounded-lg border border-edge bg-black/30 text-slate-200 text-[13px] px-2.5 py-2';
const tryBtn = 'px-3 py-2 rounded-lg border border-edge text-dim hover:text-god hover:border-god/40 text-[13px] shrink-0 transition-colors';

export default function TtsSettings({ onClose }: { onClose: () => void }) {
  const tts = useTts();
  const voices = ttsVoices();
  const cloud = tts.engine !== 'webspeech';
  const npcs = Object.values(useNpc.getState().npcs)
    .filter((r) => r.name && r.name !== r.id && !r.isDead)
    .sort((a, b) => (b.onScene ? 1 : 0) - (a.onScene ? 1 : 0));

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 overflow-y-auto" onClick={onClose}>
      <div className="min-h-full flex items-start justify-center p-3 sm:p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-edge bg-void/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-edge/60 sticky top-0 bg-void/95 backdrop-blur rounded-t-2xl z-10">
            <h2 className="text-lg text-god font-semibold">🔊 语音朗读设置</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-dim hover:text-slate-100 hover:bg-white/5 text-lg">✕</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* 引擎与后端 */}
            <section className="rounded-xl border border-edge/50 bg-black/20 p-4">
              <h3 className="text-[13px] font-medium text-slate-300 mb-2.5">引擎</h3>
              <div className="flex gap-2 flex-wrap">
                {(['webspeech', 'cloud'] as const).map((e) => (
                  <button key={e} onClick={() => tts.set({ engine: e })}
                    className={`px-4 py-2 rounded-lg border text-[13px] transition-colors ${tts.engine === e ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                    {e === 'webspeech' ? '🔈 本地（离线免费）' : '☁️ 云 TTS（更好听）'}
                  </button>
                ))}
              </div>

              {cloud && (
                <div className="mt-4 pt-4 border-t border-edge/40 space-y-3">
                  <div>
                    <div className="text-[12px] text-dim mb-1.5">云后端</div>
                    <div className="flex gap-2 flex-wrap">
                      {PROVIDERS.map(([p, lbl]) => (
                        <button key={p} onClick={() => tts.set({ cloudProvider: p })}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${tts.cloudProvider === p ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>{lbl}</button>
                      ))}
                    </div>
                  </div>

                  {tts.cloudProvider === 'edge' && <p className="text-[12px] text-dim/60 leading-relaxed">微软 Edge，免 key、开箱即用；但被官方砍到只剩 10 个音色。要全套可靠音色改用 <b className="text-slate-300">Azure</b>。</p>}
                  {tts.cloudProvider === 'openai' && (
                    <div className="space-y-2">
                      <input value={tts.openaiBaseUrl} onChange={(e) => tts.set({ openaiBaseUrl: e.target.value })} placeholder="Base URL（api.openai.com/v1 · TTS.ai · 自建 GPT-SoVITS 套壳）" className={inputCls} />
                      <input value={tts.openaiKey} onChange={(e) => tts.set({ openaiKey: e.target.value })} type="password" placeholder="API Key" className={inputCls} />
                      <input value={tts.openaiModel} onChange={(e) => tts.set({ openaiModel: e.target.value })} placeholder="model（默认 tts-1）" className={inputCls} />
                      <p className="text-[12px] text-dim/60">任何说 OpenAI /v1/audio/speech 的服务都能接。</p>
                    </div>
                  )}
                  {tts.cloudProvider === 'azure' && (
                    <div className="space-y-2">
                      <input value={tts.azureRegion} onChange={(e) => tts.set({ azureRegion: e.target.value })} placeholder="区域 region（如 eastasia / eastus）" className={inputCls} />
                      <input value={tts.azureKey} onChange={(e) => tts.set({ azureKey: e.target.value })} type="password" placeholder="Azure Speech Key" className={inputCls} />
                      <p className="text-[12px] text-dim/60 leading-relaxed">同 Edge 那批微软音色，但官方 key = 全列表可靠、不被砍。F0 免费档 50 万字/月。</p>
                    </div>
                  )}
                  {tts.cloudProvider === 'google' && (
                    <div className="space-y-2">
                      <input value={tts.googleKey} onChange={(e) => tts.set({ googleKey: e.target.value })} type="password" placeholder="Google Cloud API Key" className={inputCls} />
                      <p className="text-[12px] text-dim/60">Cloud Text-to-Speech · 免费 100 万字/月。</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 语速 */}
            <section className="rounded-xl border border-edge/50 bg-black/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[13px] font-medium text-slate-300">语速</h3>
                <span className="font-mono text-god text-[13px]">{tts.rate.toFixed(2)}×</span>
              </div>
              <input type="range" min={0.5} max={2} step={0.05} value={tts.rate} onChange={(e) => tts.set({ rate: Number(e.target.value) })} className="w-full accent-god" />
            </section>

            {/* 音色分配 */}
            <section className="rounded-xl border border-edge/50 bg-black/20 p-4">
              <h3 className="text-[13px] font-medium text-slate-300 mb-3">音色分配</h3>

              <div className="space-y-3">
                <div>
                  <div className="text-[12px] text-dim mb-1.5">旁白音色</div>
                  <div className="flex gap-2 items-center">
                    <select value={tts.narratorVoice} onChange={(e) => tts.set({ narratorVoice: e.target.value })} className={selCls}>
                      <option value="">默认</option>
                      {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <button onClick={() => void speakLine(SAMPLE, tts.narratorVoice || undefined)} className={tryBtn}>试听</button>
                  </div>
                </div>

                <div>
                  <div className="text-[12px] text-dim mb-1.5">主角音色 <span className="text-dim/50">（主角台词用）</span></div>
                  <div className="flex gap-2 items-center">
                    <select value={tts.playerVoice} onChange={(e) => tts.set({ playerVoice: e.target.value })} className={selCls}>
                      <option value="">自动（按性别）</option>
                      {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <button onClick={() => void speakLine(SAMPLE, tts.playerVoice || undefined)} className={tryBtn}>试听</button>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-edge/40">
                <div className="text-[12px] text-dim mb-2">每个 NPC 音色 <span className="text-dim/50">（默认按性别自动 · 在场优先）</span></div>
                {npcs.length === 0 ? (
                  <div className="text-dim/50 text-[13px] py-2">暂无 NPC</div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {npcs.map((n) => (
                      <div key={n.id} className="flex gap-2 items-center">
                        <span className="w-24 shrink-0 truncate text-[13px] text-slate-300" title={n.name}>{n.onScene ? '· ' : ''}{n.name}</span>
                        <select value={tts.npcVoices[n.name] || ''} onChange={(e) => tts.setNpcVoice(n.name, e.target.value)} className={selCls}>
                          <option value="">自动（按性别）</option>
                          {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                        <button onClick={() => void speakLine(SAMPLE, tts.npcVoices[n.name] || resolveNpcVoice(n.name) || undefined)} className={tryBtn}>试听</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 提示 */}
            {tts.engine === 'webspeech' && voices.length === 0 && (
              <p className="text-[12px] text-dim/60">音色列表尚未加载（浏览器异步初始化）——朗读一次或重开本页即可出现。</p>
            )}
            {cloud && (
              <p className="text-[12px] text-amber-300/70 leading-relaxed">☁️ 云 TTS 经网关合成，需先部署 multiplayer-worker；OpenAI/Azure/Google 还要在上面填各自 key。本地引擎离线即用。</p>
            )}
            {!ttsSupported() && <p className="text-[12px] text-blood/70">当前环境不支持语音朗读。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
