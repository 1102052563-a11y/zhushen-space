import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// TTS 朗读设置（全局偏好，非存档进度——独立持久化，不进 saveManager 快照，与界面外观设置同类）。
// MVP 只用到 rate/voiceURI（🔊 手动朗读）；enabled/autoPlayLatest 供 V2「自动念最新回合」用。
export type TtsEngineId = 'webspeech' | 'edge';   // webspeech=浏览器本地(离线免费·质量一般)；edge=微软Edge神经语音(经网关·免key·20+中文音色·质量好)

interface TtsState {
  enabled: boolean;         // 总开关（V2 自动念用；MVP 手动 🔊 按钮不看它）
  engine: TtsEngineId;      // 当前引擎：webspeech(本地) / edge(网关·微软神经语音)
  rate: number;             // 语速 0.5–2
  voiceURI: string;         // 单声模式指定音色 voiceURI（'' = 系统默认）
  autoPlayLatest: boolean;  // 新回合正文自动朗读（V2）
  dialogueSplit: boolean;   // 旁白/台词分离：旁白一个音色、每个 NPC 台词各自音色
  narratorVoice: string;    // 旁白音色 voiceURI（'' = 系统默认）
  npcVoices: Record<string, string>;   // NPC 名 → voiceURI 手动指定（未设则按性别自动分配）
  set: (patch: Partial<TtsState>) => void;
  setNpcVoice: (name: string, voiceURI: string) => void;
}

export const useTts = create<TtsState>()(
  persist(
    (set) => ({
      enabled: false,
      engine: 'webspeech',
      rate: 1,
      voiceURI: '',
      autoPlayLatest: false,
      dialogueSplit: true,
      narratorVoice: '',
      npcVoices: {},
      set: (patch) => set(patch),
      setNpcVoice: (name, voiceURI) => set((st) => ({ npcVoices: { ...st.npcVoices, [name]: voiceURI } })),
    }),
    { name: 'drpg-tts' },
  ),
);
