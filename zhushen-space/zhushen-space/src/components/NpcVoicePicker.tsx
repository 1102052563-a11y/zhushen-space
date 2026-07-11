import { useTts } from '../store/ttsStore';
import { ttsVoices, speakLine, resolveNpcVoice, ttsSupported } from '../systems/tts';

/* NPC 详情内嵌的音色选择：写全局 ttsStore.npcVoices[name]（未设 = 自动按性别）。
   模块级组件（不在父组件内定义·避免破坏输入法）；只含 select，无文本框。 */

export default function NpcVoicePicker({ name }: { name: string }) {
  const npcVoices = useTts((s) => s.npcVoices);
  const engine = useTts((s) => s.engine);   // 订阅引擎：切引擎后音色列表随之刷新
  if (!ttsSupported() || !name) return null;
  const voices = ttsVoices();
  const cur = npcVoices[name] || '';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={cur} onChange={(e) => useTts.getState().setNpcVoice(name, e.target.value)}
        className="flex-1 min-w-[180px] rounded border border-edge bg-black/30 text-slate-200 text-[13px] px-2 py-1.5">
        <option value="">自动（按性别 · {engine === 'edge' ? 'Edge 云端' : '本地'}）</option>
        {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select>
      <button onClick={() => void speakLine('你好，这是语音试听。', cur || resolveNpcVoice(name) || undefined)}
        className="px-2.5 py-1.5 rounded border border-edge text-dim hover:text-god text-[13px] shrink-0">试听</button>
      {engine === 'webspeech' && voices.length === 0 && (
        <span className="text-[11px] text-dim/50 w-full">音色列表尚未加载——朗读一次或稍候即可出现。</span>
      )}
    </div>
  );
}
