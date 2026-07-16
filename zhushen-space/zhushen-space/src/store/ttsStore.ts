import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// TTS 朗读设置（全局偏好，非存档进度——独立持久化，不进 saveManager 快照，与界面外观设置同类）。
// MVP 只用到 rate/voiceURI（🔊 手动朗读）；enabled/autoPlayLatest 供 V2「自动念最新回合」用。
export type TtsEngineId = 'webspeech' | 'cloud' | 'local';   // webspeech=浏览器本地(离线免费)；cloud=经网关的统一云 TTS；local=玩家自部署(浏览器直连)
export type CloudProvider = 'edge' | 'openai' | 'azure' | 'google';   // 云 TTS 后端：edge免key / openai兼容 / azure官方 / google
export type LocalProvider = 'gptsovits' | 'openai';   // 自部署后端：GPT-SoVITS 原生 api_v2 / 任意本地 OpenAI 兼容(/v1/audio/speech)

/** GPT-SoVITS 音色 = 一份参考音频（零样本克隆）。玩家自己配，NPC 挑一个即得专属声线。
 *  ⚠ refAudioPath 是 **GPT-SoVITS 服务端自己的磁盘路径**（它读本地文件，不是上传）。
 *  ⚠ promptText 必须与参考音频里**实际说的那句话**逐字对上，否则音色会崩。 */
export interface SovitsVoice {
  id: string;                        // 稳定 UID（npcVoices/narratorVoice 存的就是它，改名不影响绑定）
  label: string;
  gender?: 'male' | 'female';        // 供「按性别自动分配」用
  refAudioPath: string;
  promptText: string;
  promptLang: string;                // zh / en / ja / ko / yue
  gptWeights?: string;               // 可选：该角色专训权重路径（留空=用服务器当前已加载的，零样本克隆）
  sovitsWeights?: string;
}

interface TtsState {
  enabled: boolean;         // 总开关（V2 自动念用；MVP 手动 🔊 按钮不看它）
  engine: TtsEngineId;      // 当前引擎：webspeech(本地) / cloud(网关云 TTS) / local(自部署)
  cloudProvider: CloudProvider;   // cloud 引擎下的后端
  openaiBaseUrl: string;    // openai 兼容端 base（如 https://api.openai.com/v1 或你自建/TTS.ai）
  openaiKey: string;
  openaiModel: string;      // 默认 tts-1
  azureKey: string;
  azureRegion: string;      // 如 eastus / eastasia
  googleKey: string;
  // ── 自部署（local 引擎）：**浏览器直连玩家自己的机器**，网关够不着 127.0.0.1，故不走 /api/gw ──
  localProvider: LocalProvider;
  sovitsUrl: string;        // GPT-SoVITS api_v2.py 地址（默认 http://127.0.0.1:9880）
  sovitsTextLang: string;   // 正文语种：zh=中英混合 / all_zh=纯中文 / ja / en / auto
  sovitsStreaming: boolean; // 流式：更快开口，但个别浏览器不认 GPT-SoVITS 的流式 wav 头（默认关=稳）
  sovitsExtra: string;      // 高级：额外 query 覆盖（如 top_k=15&temperature=1&text_split_method=cut0）
  sovitsVoices: SovitsVoice[];
  localOpenaiUrl: string;   // 本地 OpenAI 兼容端（如 http://127.0.0.1:8880/v1）
  localOpenaiKey: string;
  localOpenaiModel: string;
  localOpenaiVoiceList: string;   // 逗号分隔音色名（自建服务音色各不相同，让玩家自己填）
  rate: number;             // 语速 0.5–2
  voiceURI: string;         // 单声模式指定音色 voiceURI（'' = 系统默认）
  autoPlayLatest: boolean;  // 新回合正文自动朗读（V2）
  dialogueSplit: boolean;   // 旁白/台词分离：旁白一个音色、每个 NPC 台词各自音色
  narratorVoice: string;    // 旁白音色 voiceURI（'' = 系统默认）
  playerVoice: string;      // 主角台词音色（'' = 按性别自动）
  npcVoices: Record<string, string>;   // NPC 名 → voiceURI 手动指定（未设则按性别自动分配）
  set: (patch: Partial<TtsState>) => void;
  setNpcVoice: (name: string, voiceURI: string) => void;
  addSovitsVoice: () => void;
  patchSovitsVoice: (id: string, patch: Partial<SovitsVoice>) => void;
  removeSovitsVoice: (id: string) => void;
}

let _svSeq = 0;
function newSovitsId(): string { return `sv_${Date.now().toString(36)}_${(_svSeq++).toString(36)}`; }

export const useTts = create<TtsState>()(
  persist(
    (set) => ({
      enabled: false,
      engine: 'webspeech',
      cloudProvider: 'edge',
      openaiBaseUrl: '',
      openaiKey: '',
      openaiModel: 'tts-1',
      azureKey: '',
      azureRegion: '',
      googleKey: '',
      localProvider: 'gptsovits',
      sovitsUrl: 'http://127.0.0.1:9880',
      sovitsTextLang: 'zh',
      sovitsStreaming: false,
      sovitsExtra: '',
      sovitsVoices: [],
      localOpenaiUrl: '',
      localOpenaiKey: '',
      localOpenaiModel: '',
      localOpenaiVoiceList: '',
      rate: 1,
      voiceURI: '',
      autoPlayLatest: false,
      dialogueSplit: true,
      narratorVoice: '',
      playerVoice: '',
      npcVoices: {},
      set: (patch) => set(patch),
      setNpcVoice: (name, voiceURI) => set((st) => ({ npcVoices: { ...st.npcVoices, [name]: voiceURI } })),
      addSovitsVoice: () => set((st) => ({
        sovitsVoices: [...st.sovitsVoices, { id: newSovitsId(), label: `音色 ${st.sovitsVoices.length + 1}`, refAudioPath: '', promptText: '', promptLang: 'zh' }],
      })),
      patchSovitsVoice: (id, patch) => set((st) => ({ sovitsVoices: st.sovitsVoices.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
      // 删音色顺带解绑引用它的 NPC/旁白/主角，免得留下指向空音色的死引用（→ 回退成"按性别自动"）
      removeSovitsVoice: (id) => set((st) => ({
        sovitsVoices: st.sovitsVoices.filter((v) => v.id !== id),
        npcVoices: Object.fromEntries(Object.entries(st.npcVoices).filter(([, v]) => v !== id)),
        narratorVoice: st.narratorVoice === id ? '' : st.narratorVoice,
        playerVoice: st.playerVoice === id ? '' : st.playerVoice,
        voiceURI: st.voiceURI === id ? '' : st.voiceURI,
      })),
    }),
    { name: 'drpg-tts' },
  ),
);
