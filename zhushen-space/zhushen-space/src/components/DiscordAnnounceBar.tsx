// 常驻公告栏：官方 Discord 频道邀请（中英双语）。整条即邀请链接，新标签打开。
// 单一数据源——改频道地址/文案只改这里。
export const DISCORD_INVITE = 'https://discord.gg/S2KUuk6Qq';

/* 仅在封面（主界面 / StartScreen）常驻显示——fixed 悬浮在屏幕顶部。
   进入游戏界面后不出现（用户要求：只在主界面常驻，不占用游戏内空间）。 */
export default function DiscordAnnounceBar() {
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      title="加入官方 Discord 频道 / Join our official Discord"
      className="group fixed top-0 inset-x-0 z-40 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5
        px-4 py-1.5 bg-black/70 backdrop-blur-sm border-b border-[#5865F2]/50
        text-[12px] max-lg:text-[11px] font-mono text-slate-200 hover:bg-[#5865F2]/25 transition-colors"
    >
      <span className="text-sm leading-none">📢</span>
      <span className="text-[#9db0ff] group-hover:text-white transition-colors">
        官方 Discord 频道 · Official Discord Channel
      </span>
      <span className="text-[#9db0ff] group-hover:text-white underline decoration-dotted underline-offset-2 transition-colors break-all">
        {DISCORD_INVITE}
      </span>
    </a>
  );
}
