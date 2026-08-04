import { memo } from 'react';
import { useBookmarks } from '../store/bookmarkStore';
import { useMisc } from '../store/miscStore';

/* ⭐ 楼层收藏按钮（挂在每条正文右上角，与「编辑」并排）。
   ⚠ 自订阅：只订阅「本楼是否已收藏」这个**布尔值**——App 完全不碰 bookmarkStore，
     收藏/取消只重渲这一颗按钮，不波及聊天列表（同 StoryStrip 的零订阅思路）。
   ⚠ 模块级组件：绝不能定义在 MessageRow 内部（每次渲染重挂，见「IME 断字」教训）。
   收藏时把**当时的正文整段拷进快照**——楼层日后被编辑/重生成/挤出窗口都不影响收藏（见 bookmarkStore）。 */
const BookmarkButton = memo(function BookmarkButton({ msgId, content }: { msgId: number; content: string }) {
  const marked = useBookmarks((s) => s.marks.some((m) => m.msgId === msgId));

  const toggle = () => {
    const B = useBookmarks.getState();
    if (marked) { B.removeByMsg(msgId); return; }
    const M = useMisc.getState();
    B.add({
      msgId, text: content, note: '', tags: [],
      turn: M.turnCount ?? 0, worldName: M.worldName ?? '', worldTime: M.worldTime ?? '',
    });
  };

  return (
    <button
      onClick={toggle}
      title={marked ? '取消收藏这一楼' : '收藏这一楼（连正文快照一起存，之后在「坐标」里找得到）'}
      className={`w-7 h-7 flex items-center justify-center rounded-md border bg-void/85 transition-opacity transition-colors
        ${marked
          ? 'opacity-100 border-god/45 text-god'
          : 'opacity-0 group-hover:opacity-100 focus:opacity-100 max-lg:opacity-60 border-edge text-dim/60 hover:text-god hover:border-god/40'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={marked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5l2.9 5.9 6.6.95-4.75 4.63 1.12 6.52L12 17.6l-5.87 2.9 1.12-6.52L2.5 9.35l6.6-.95z" />
      </svg>
    </button>
  );
});

export default BookmarkButton;
