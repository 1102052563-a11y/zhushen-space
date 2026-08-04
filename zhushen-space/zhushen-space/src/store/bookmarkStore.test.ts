import { describe, it, expect, beforeEach } from 'vitest';
import { useBookmarks, BOOKMARK_CAP, SNAPSHOT_MAX, type Bookmark } from './bookmarkStore';

type NewMark = Omit<Bookmark, 'id' | 'ts'>;

const mk = (msgId: number, text = '正文内容', extra: Partial<NewMark> = {}): NewMark => ({
  msgId, text, note: '', tags: [], turn: 1, worldName: '斗罗大陆', worldTime: '2月17日', ...extra,
});

beforeEach(() => { useBookmarks.getState().clear(); });

describe('bookmarkStore（⭐ 坐标）', () => {
  it('收藏存的是**正文快照**，不是指针', () => {
    useBookmarks.getState().add(mk(7, '这一段很好看'));
    const m = useBookmarks.getState().marks[0];
    expect(m.text).toBe('这一段很好看');
    expect(m.msgId).toBe(7);
    expect(m.id).toMatch(/^bm_/);
    expect(m.ts).toBeGreaterThan(0);
  });

  it('同一楼只收藏一次（幂等）', () => {
    expect(useBookmarks.getState().add(mk(7, '甲'))).toBe(true);
    expect(useBookmarks.getState().add(mk(7, '乙'))).toBe(false);
    expect(useBookmarks.getState().marks).toHaveLength(1);
    expect(useBookmarks.getState().marks[0].text).toBe('甲');   // 不被第二次覆盖
  });

  it('空正文不收藏（避免留下读不到内容的空壳）', () => {
    expect(useBookmarks.getState().add(mk(1, '   '))).toBe(false);
    expect(useBookmarks.getState().add(mk(2, ''))).toBe(false);
    expect(useBookmarks.getState().marks).toHaveLength(0);
  });

  it('超长正文按 SNAPSHOT_MAX 截断，别撑爆存档', () => {
    useBookmarks.getState().add(mk(1, 'x'.repeat(SNAPSHOT_MAX + 500)));
    expect(useBookmarks.getState().marks[0].text).toHaveLength(SNAPSHOT_MAX);
  });

  it('标签最多 8 个、自动去空', () => {
    useBookmarks.getState().add(mk(1, '正文', { tags: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }));
    const tags = useBookmarks.getState().marks[0].tags;
    expect(tags).toHaveLength(8);
    expect(tags).not.toContain('');
  });

  it('标签去重（手输容易打重，重复标签会在卡上显示两遍）', () => {
    useBookmarks.getState().add(mk(1, '正文', { tags: ['伏笔', '名场面', '伏笔', ' 伏笔 '] }));
    expect(useBookmarks.getState().marks[0].tags).toEqual(['伏笔', '名场面']);
    const id = useBookmarks.getState().marks[0].id;
    useBookmarks.getState().update(id, { tags: ['高光', '高光', '想续写'] });
    expect(useBookmarks.getState().marks[0].tags).toEqual(['高光', '想续写']);
  });

  it('超过上限时新挤旧', () => {
    for (let i = 1; i <= BOOKMARK_CAP + 5; i++) useBookmarks.getState().add(mk(i, `第${i}段`));
    const marks = useBookmarks.getState().marks;
    expect(marks).toHaveLength(BOOKMARK_CAP);
    expect(marks[0].msgId).toBe(6);                       // 最早 5 条被挤掉
    expect(marks[marks.length - 1].msgId).toBe(BOOKMARK_CAP + 5);
  });

  it('update 只改备注/标签，不动快照', () => {
    useBookmarks.getState().add(mk(1, '原文不许动'));
    const id = useBookmarks.getState().marks[0].id;
    useBookmarks.getState().update(id, { note: '为什么留它', tags: ['名场面', '', '高光'] });
    const m = useBookmarks.getState().marks[0];
    expect(m.note).toBe('为什么留它');
    expect(m.tags).toEqual(['名场面', '高光']);
    expect(m.text).toBe('原文不许动');
  });

  it('removeByMsg 按楼层 id 取消收藏（楼上 ⭐ 再点一次）；remove 按收藏 id 删', () => {
    useBookmarks.getState().add(mk(1, '甲'));
    useBookmarks.getState().add(mk(2, '乙'));
    useBookmarks.getState().removeByMsg(1);
    expect(useBookmarks.getState().marks.map((m) => m.msgId)).toEqual([2]);
    const id = useBookmarks.getState().marks[0].id;
    useBookmarks.getState().remove(id);
    expect(useBookmarks.getState().marks).toHaveLength(0);
  });
});
