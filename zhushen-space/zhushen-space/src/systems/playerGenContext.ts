import { usePlayer } from '../store/playerStore';
import { useMisc } from '../store/miscStore';

/* 汇总主角当前处境，作「称号 / 成就」等手动生成按钮的 AI 上下文。
   纯函数、只读各 store 快照；忠于档案里的真实信息（身份/阶位/六维/所在世界/经历时间线），
   不含近期正文（面板取不到 App 的 messagesRef，故以 deedLog 经历时间线为主要事迹来源）。 */
export function buildPlayerGenContext(): string {
  const p = usePlayer.getState().profile;
  const m = useMisc.getState();
  const lines: string[] = [];
  lines.push(`姓名：${p.name || '契约者'}`);
  if (p.tier) lines.push(`阶位：${p.tier}${p.level ? `（等级 ${p.level}）` : ''}`);
  if (p.bioStrength) lines.push(`生物强度：${p.bioStrength}`);
  if (p.identity) lines.push(`身份：${p.identity}`);
  if (p.profession) lines.push(`职业：${p.profession}`);
  if (p.homeParadise) lines.push(`所属乐园：${p.homeParadise}`);
  if (p.preParadiseJob) lines.push(`入园前背景：${p.preParadiseJob}`);
  const a = p.attrs;
  if (a) lines.push(`六维：力${a.str} 敏${a.agi} 体${a.con} 智${a.int} 魅${a.cha} 运${a.luck}`);
  if (p.personality) lines.push(`性格：${p.personality}`);
  const world = m.worldName ? `${m.worldName}${m.worldTier ? `（${m.worldTier}）` : ''}` : '';
  if (world) lines.push(`当前所在世界：${world}`);
  if (m.worldTime) lines.push(`当前时间：${m.worldTime}`);
  if (p.location) lines.push(`所处位置：${p.location}`);
  if (p.background) lines.push(`出身背景：${String(p.background).slice(0, 500)}`);
  const deeds = Array.isArray(p.deedLog) ? p.deedLog.slice(-10) : [];
  if (deeds.length) {
    lines.push('近期经历（时间线）：');
    for (const d of deeds) {
      const anchor = [d.time, d.location].filter(Boolean).join('·');
      const line = `· ${anchor ? `〔${anchor}〕` : ''}${d.description ?? ''}`.trim();
      if (line !== '·') lines.push(line);
    }
  }
  return lines.filter(Boolean).join('\n');
}
