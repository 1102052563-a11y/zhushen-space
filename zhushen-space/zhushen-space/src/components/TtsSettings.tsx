import { useTts, type CloudProvider, type LocalProvider, type SovitsVoice } from '../store/ttsStore';
import { useNpc } from '../store/npcStore';
import { ttsVoices, speakLine, resolveNpcVoice, ttsSupported } from '../systems/tts';

/* 语音朗读设置页：引擎与后端 / 语速 / 音色分配（旁白·主角·每 NPC）。
   分区卡片、留白充足，取代原来挤在小按钮弹窗里的形态。
   ⚠ 铁则：受控输入面板**不准内联定义子组件**（每次按键都重挂 → 拼音打一个字就断）→ SovitsVoiceRow 提到模块级。 */

const SAMPLE = '你好，这是语音试听。';
const PROVIDERS: [CloudProvider, string][] = [['edge', 'Edge · 免 key'], ['openai', 'OpenAI 兼容'], ['azure', 'Azure'], ['google', 'Google']];
const LOCAL_PROVIDERS: [LocalProvider, string][] = [['gptsovits', 'GPT-SoVITS'], ['openai', '本地 OpenAI 兼容']];
const LANGS = ['zh', 'all_zh', 'en', 'ja', 'all_ja', 'yue', 'ko', 'auto'];
const inputCls = 'w-full rounded-lg border border-edge bg-black/30 text-slate-200 text-[13px] px-2.5 py-2 focus:border-god/50 outline-none';
const selCls = 'flex-1 rounded-lg border border-edge bg-black/30 text-slate-200 text-[13px] px-2.5 py-2';
const tryBtn = 'px-3 py-2 rounded-lg border border-edge text-dim hover:text-god hover:border-god/40 text-[13px] shrink-0 transition-colors';
const miniCls = 'rounded-lg border border-edge bg-black/30 text-slate-200 text-[12px] px-2 py-1.5';

/** 一个 GPT-SoVITS 音色 = 一份参考音频（零样本克隆）。模块级组件——别挪进父组件里（IME 铁则）。 */
function SovitsVoiceRow({ v, onPatch, onRemove, onTry }: {
  v: SovitsVoice;
  onPatch: (id: string, patch: Partial<SovitsVoice>) => void;
  onRemove: (id: string) => void;
  onTry: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-edge/50 bg-black/20 p-3 space-y-2">
      <div className="flex gap-2 items-center">
        <input value={v.label} onChange={(e) => onPatch(v.id, { label: e.target.value })} placeholder="音色名（如 卡尔·低沉男声）" className={`${inputCls} flex-1`} />
        <select value={v.gender || ''} onChange={(e) => onPatch(v.id, { gender: (e.target.value || undefined) as SovitsVoice['gender'] })} className={miniCls} title="供「按性别自动分配」用">
          <option value="">性别—</option>
          <option value="male">♂ 男</option>
          <option value="female">♀ 女</option>
        </select>
        <button onClick={() => onTry(v.id)} className={tryBtn}>试听</button>
        <button onClick={() => onRemove(v.id)} className="px-2.5 py-2 rounded-lg border border-edge text-dim hover:text-blood hover:border-blood/40 text-[13px] transition-colors" title="删除">🗑</button>
      </div>
      <input value={v.refAudioPath} onChange={(e) => onPatch(v.id, { refAudioPath: e.target.value })}
        placeholder="参考音频路径（GPT-SoVITS 服务端自己的磁盘路径，如 D:\GPT-SoVITS\refs\kar.wav）" className={inputCls} />
      <div className="flex gap-2">
        <input value={v.promptText} onChange={(e) => onPatch(v.id, { promptText: e.target.value })}
          placeholder="参考文本 = 这段音频里逐字说的那句话（对不上音色会崩）" className={`${inputCls} flex-1`} />
        <select value={v.promptLang} onChange={(e) => onPatch(v.id, { promptLang: e.target.value })} className={miniCls} title="参考音频的语种">
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <details>
        <summary className="text-[12px] text-dim/60 cursor-pointer select-none hover:text-dim">专训权重（可选 · 没练过就别填）</summary>
        <div className="mt-2 space-y-2">
          <input value={v.gptWeights || ''} onChange={(e) => onPatch(v.id, { gptWeights: e.target.value })} placeholder="GPT 权重路径 .ckpt" className={inputCls} />
          <input value={v.sovitsWeights || ''} onChange={(e) => onPatch(v.id, { sovitsWeights: e.target.value })} placeholder="SoVITS 权重路径 .pth" className={inputCls} />
          <p className="text-[12px] text-dim/50 leading-relaxed">填了就在念这个角色前自动切模型。⚠ 切换是<b className="text-slate-400">全局且慢</b>的，还会关掉预读（句间会卡顿）——只给真练过专属模型的角色填。留空 = 用服务器当前模型做零样本克隆，多数人用这个。</p>
        </div>
      </details>
    </div>
  );
}

export default function TtsSettings({ onClose }: { onClose: () => void }) {
  const tts = useTts();
  const voices = ttsVoices();
  const local = tts.engine === 'local';
  const cloud = tts.engine !== 'webspeech' && !local;   // 'edge' 是旧持久化值 → 仍当云（见 tts.ts getEngine）
  const npcs = Object.values(useNpc.getState().npcs)
    .filter((r) => r.name && r.name !== r.id && !r.isDead)
    .sort((a, b) => (b.onScene ? 1 : 0) - (a.onScene ? 1 : 0));
  const trySovits = (id: string) => { void speakLine(SAMPLE, id); };

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
                {([['webspeech', '🔈 浏览器内置（免费·离线）'], ['cloud', '☁️ 云 TTS（好听·要联网）'], ['local', '🖥️ 自部署（可克隆音色）']] as const).map(([e, lbl]) => (
                  <button key={e} onClick={() => tts.set({ engine: e })}
                    className={`px-4 py-2 rounded-lg border text-[13px] transition-colors ${tts.engine === e ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>
                    {lbl}
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

              {local && (
                <div className="mt-4 pt-4 border-t border-edge/40 space-y-3">
                  <div>
                    <div className="text-[12px] text-dim mb-1.5">自部署后端 <span className="text-dim/50">（跑在你自己电脑上 · 浏览器直连，不经网关）</span></div>
                    <div className="flex gap-2 flex-wrap">
                      {LOCAL_PROVIDERS.map(([p, lbl]) => (
                        <button key={p} onClick={() => tts.set({ localProvider: p })}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${tts.localProvider === p ? 'border-god text-god bg-god/10' : 'border-edge text-dim hover:text-slate-200'}`}>{lbl}</button>
                      ))}
                    </div>
                  </div>

                  {tts.localProvider === 'gptsovits' && (
                    <div className="space-y-2">
                      <input value={tts.sovitsUrl} onChange={(e) => tts.set({ sovitsUrl: e.target.value })} placeholder="GPT-SoVITS 地址（默认 http://127.0.0.1:9880）" className={inputCls} />
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="text-[12px] text-dim shrink-0">正文语种</span>
                        <select value={tts.sovitsTextLang} onChange={(e) => tts.set({ sovitsTextLang: e.target.value })} className={miniCls} title="zh = 中英混合（推荐）；all_zh = 纯中文">
                          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-[12px] text-dim cursor-pointer ml-auto">
                          <input type="checkbox" checked={tts.sovitsStreaming} onChange={(e) => tts.set({ sovitsStreaming: e.target.checked })} className="accent-god" />
                          流式（开口更快，但个别浏览器不认流式 wav 头）
                        </label>
                      </div>
                      <input value={tts.sovitsExtra} onChange={(e) => tts.set({ sovitsExtra: e.target.value })} placeholder="高级：额外参数覆盖（top_k=15&temperature=1&text_split_method=cut0）" className={inputCls} />

                      <div className="pt-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[12px] text-dim">音色 <span className="text-dim/50">（一个音色 = 一段参考音频；下面「音色分配」里给每个 NPC 挑）</span></div>
                          <button onClick={tts.addSovitsVoice} className={tryBtn}>＋ 加音色</button>
                        </div>
                        {tts.sovitsVoices.length === 0 ? (
                          <div className="text-dim/50 text-[13px] py-2 leading-relaxed">还没有音色。点「＋ 加音色」，填一段 <b className="text-slate-400">3–10 秒、干净无背景音</b>的参考音频路径，以及它逐字说的那句话 —— 每个 NPC 就能有自己的专属声线。</div>
                        ) : (
                          <div className="space-y-2">
                            {tts.sovitsVoices.map((v) => (
                              <SovitsVoiceRow key={v.id} v={v} onPatch={tts.patchSovitsVoice} onRemove={tts.removeSovitsVoice} onTry={trySovits} />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="text-[12px] text-dim/60 leading-relaxed space-y-1 pt-1">
                        <p>① 在 GPT-SoVITS 目录跑 <code className="text-slate-300">python api_v2.py -a 127.0.0.1 -p 9880</code>，保持它开着。</p>
                        <p>② <b className="text-slate-400">不用给它改任何代码</b>：本引擎用 <code className="text-slate-300">&lt;audio&gt;</code> 直接播 <code className="text-slate-300">GET /tts</code>，不受 CORS 限制。</p>
                        <p>③ 本站是 HTTPS，Chrome 142+ 首次连本地会弹「允许访问本地网络」→ 点<b className="text-slate-400">允许</b>。</p>
                        <p>④ 没声音时按 F12 看 Console，本引擎会打出失败原因和完整请求 URL（直接贴浏览器地址栏就能验）。</p>
                      </div>
                    </div>
                  )}

                  {tts.localProvider === 'openai' && (
                    <div className="space-y-2">
                      <input value={tts.localOpenaiUrl} onChange={(e) => tts.set({ localOpenaiUrl: e.target.value })} placeholder="Base URL（如 http://127.0.0.1:8880/v1）" className={inputCls} />
                      <input value={tts.localOpenaiKey} onChange={(e) => tts.set({ localOpenaiKey: e.target.value })} type="password" placeholder="API Key（本地服务多半不用，留空）" className={inputCls} />
                      <input value={tts.localOpenaiModel} onChange={(e) => tts.set({ localOpenaiModel: e.target.value })} placeholder="model（如 tts-1 / kokoro）" className={inputCls} />
                      <input value={tts.localOpenaiVoiceList} onChange={(e) => tts.set({ localOpenaiVoiceList: e.target.value })} placeholder="音色名，逗号分隔（如 zf_xiaobei,zm_yunxi）" className={inputCls} />
                      <p className="text-[12px] text-dim/60 leading-relaxed">任何在本机说 OpenAI <code className="text-slate-300">/v1/audio/speech</code> 的服务都能接（kokoro-fastapi / openedai-speech / GPT-SoVITS 的套壳…）。⚠ 这条是 POST，<b className="text-slate-400">绕不开 CORS</b> —— 服务端必须允许本站来源，否则只会看到「Failed to fetch」。要零配置就用上面的 GPT-SoVITS 原生。</p>
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
              <p className="text-[12px] text-amber-300/70 leading-relaxed">☁️ 云 TTS 经网关合成，需先部署 multiplayer-worker；OpenAI/Azure/Google 还要在上面填各自 key。浏览器内置引擎离线即用。</p>
            )}
            {local && tts.localProvider === 'gptsovits' && tts.sovitsVoices.length === 0 && (
              <p className="text-[12px] text-amber-300/70 leading-relaxed">🖥️ 还没配音色 —— 自部署引擎至少要一个参考音频才能出声（在上面「＋ 加音色」）。</p>
            )}
            {!ttsSupported() && <p className="text-[12px] text-blood/70">当前环境不支持语音朗读。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
