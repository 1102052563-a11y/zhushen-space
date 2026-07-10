// 常驻公告栏：官方 Discord 频道邀请（中英双语）。整条即邀请链接，新标签打开。
// 单一数据源——改频道地址/文案只改这里，封面与游戏内主界面同步生效。
export const DISCORD_INVITE = 'https://discord.gg/S2KUuk6Qq';

/* 用法：
   - <DiscordAnnounceBar />        封面（StartScreen）：fixed 悬浮在屏幕顶部。
   - <DiscordAnnounceBar inline /> 游戏内主界面：普通流内条，占位排在顶栏下方。 */
export default function DiscordAnnounceBar({ inline = false }: { inline?: boolean }) {
  const pos = inline
    ? 'shrink-0 relative'                 // 游戏内：随布局占位（不遮挡内容）
    : 'fixed top-0 inset-x-0 z-40';       // 封面：悬浮顶部
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      title="加入官方 Discord 频道 / Join our official Discord"
      className={`group ${pos} flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5
        px-4 py-1.5 bg-black/70 backdrop-blur-sm border-b border-[#5865F2]/50
        text-[12px] max-lg:text-[11px] font-mono text-slate-200 hover:bg-[#5865F2]/25 transition-colors`}
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
