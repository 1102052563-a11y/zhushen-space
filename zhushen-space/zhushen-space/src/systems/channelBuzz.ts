/* 📡 <广场舆论> 公共频道热帖回注正文（借鉴Zsd网游论坛「论坛内容注入对话」思想）：
   抽热度最高的 N 条 AI 生成帖给正文当舆论背景，让 NPC 能自然提起"广场上在传什么"。
   - N = channelStore.settings.injectBuzzCount（0=关）；频道功能关闭 / 无帖 = 零块。
   - 只取 AI 生成的帖子：排除 system 频道（公告非舆论）、主角发言线（speak 已有一次性场外通报，
     再常驻注入会让模型过度围着主角的发言转）、玩家挂单（byPlayer）。
   - 双护栏：仅氛围参考声明 + 禁止正文出现论坛格式/续写论坛内容。 */
import { useChannel, CHANNEL_DEFS } from '../store/channelStore';
import { usePlayer } from '../store/playerStore';

export function buildChannelBuzzInjection(): { role: 'system'; content: string }[] {
  const C = useChannel.getState();
  const n = C.settings.injectBuzzCount ?? 4;
  if (!C.settings.enabled || n <= 0) return [];
  const posts = C.messages
    .filter((m) => m.channel !== 'system' && !m.speak && !m.byPlayer && m.content && m.content.trim())
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0) || b.postedAt - a.postedAt)
    .slice(0, n);
  if (posts.length === 0) return [];
  const label = (k: string) => CHANNEL_DEFS.find((d) => d.key === k)?.label ?? k;
  const lines = posts.map((m) => {
    const who = `${m.authorName}${m.authorTier ? `(${m.authorTier})` : ''}`;
    const body = String(m.content).replace(/\s+/g, ' ').slice(0, 90);
    return `- [${label(m.channel)}] ${who}：「${body}」${m.heat != null ? `（🔥${m.heat}）` : ''}`;
  });
  const home = usePlayer.getState().profile.homeParadise || '轮回乐园';
  return [{
    role: 'system' as const,
    content: `<广场舆论·仅氛围参考>（${home}公共频道近期热帖，由世界系统自动抓取，供你了解契约者圈子当下的舆论风向；**主角不一定看过这些帖子**）\n${lines.join('\n')}\n（以上仅作世界观氛围底色：可以让消息灵通的 NPC 自然地提起相关传闻/行情/招募，但正文中**禁止出现论坛帖子格式**、禁止把以上内容当作需要回应或续写的对话）\n</广场舆论·仅氛围参考>`,
  }];
}
