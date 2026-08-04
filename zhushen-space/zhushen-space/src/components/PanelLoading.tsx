/* 懒加载面板的 Suspense fallback（治「点了按钮很久才出面板、期间零反馈」）：
   此前弹窗层 fallback={null}——冷加载 chunk 的几百 ms~几秒里屏幕毫无动静，看起来像点击失灵。
   160ms 延迟出现（CSS animation-delay，见 index.css .panel-loading-fade）：
   热加载（chunk 已在内存/磁盘缓存）绝不闪烁，只有真慢时才浮现提示。常驻 eager、体积极小。 */
export default function PanelLoading() {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center pointer-events-none panel-loading-fade">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-god/30 bg-void/90 shadow-xl backdrop-blur text-sm text-god/90">
        <span className="inline-block w-4 h-4 border-2 border-god/30 border-t-god rounded-full animate-spin" />
        面板加载中…
      </div>
    </div>
  );
}
