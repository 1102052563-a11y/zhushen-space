import { describe, it, expect, beforeEach } from 'vitest';
import { useSettings, type WorldBook } from '../store/settingsStore';
import { KINDS, packWorldBookFile, WB_CAT_TEXT, WB_CAT_AUX } from './workshop';

/* 工坊世界书·两个书架（正文世界书 / 辅助世界书）：
   pack 记下书架 → install 放回同一栏；老条目（没 shelf）落「正文世界书」。
   另锁：本地 .json 直传（packWorldBookFile）不必先导进设置页。 */

const wb = KINDS.worldbook;
const book = (id: string, name: string): WorldBook => ({
  id, name, enabled: true, createdAt: 1,
  entries: [{ uid: 0, key: ['甲'], keysecondary: [], comment: '条目甲', content: '正文', constant: false, selective: true, enabled: true, order: 100, position: 0 }],
});
const reset = () => useSettings.setState({ worldBooks: [], textWorldBooks: [] });

describe('工坊世界书·书架路由', () => {
  beforeEach(reset);

  it('listLocal 同时列出两栏，并标出各自书架', () => {
    useSettings.setState({ textWorldBooks: [book('twb_1', '正文书')], worldBooks: [book('wb_1', '辅助书')] });
    expect(wb.listLocal()).toEqual([
      { id: 'twb_1', name: '正文书', category: WB_CAT_TEXT },
      { id: 'wb_1', name: '辅助书', category: WB_CAT_AUX },
    ]);
  });

  it('正文世界书：pack → install 回到正文世界书那一栏', () => {
    useSettings.setState({ textWorldBooks: [book('twb_1', '正文书')] });
    const packed = wb.pack('twb_1')!;
    expect(packed.category).toBe(WB_CAT_TEXT);
    expect(packed.payload.shelf).toBe('text');

    reset();   // 模拟别人的空库
    wb.install(packed.payload);
    const s = useSettings.getState();
    expect(s.textWorldBooks.map((b) => b.name)).toEqual(['正文书']);
    expect(s.worldBooks).toHaveLength(0);
    expect(s.textWorldBooks[0].entries).toHaveLength(1);
  });

  it('辅助世界书：pack → install 回到辅助世界书那一栏', () => {
    useSettings.setState({ worldBooks: [book('wb_1', '辅助书')] });
    const packed = wb.pack('wb_1')!;
    expect(packed.category).toBe(WB_CAT_AUX);
    expect(packed.payload.shelf).toBe('aux');

    reset();
    wb.install(packed.payload);
    expect(useSettings.getState().worldBooks.map((b) => b.name)).toEqual(['辅助书']);
    expect(useSettings.getState().textWorldBooks).toHaveLength(0);
  });

  it('老条目（payload 没有 shelf）→ 落正文世界书', () => {
    wb.install({ name: '老工坊书', entries: book('x', 'x').entries, enabled: true });
    expect(useSettings.getState().textWorldBooks.map((b) => b.name)).toEqual(['老工坊书']);
    expect(useSettings.getState().worldBooks).toHaveLength(0);
  });

  it('内置书可分享，但安装后是玩家自己的书（不带 builtin 标记）', () => {
    useSettings.setState({ textWorldBooks: [{ ...book('twb_b', '内置书'), builtin: true, builtinKey: 'k', removedBuiltinUids: [7] }] });
    const packed = wb.pack('twb_b')!;
    expect(packed.payload.builtin).toBeUndefined();
    expect(packed.payload.builtinKey).toBeUndefined();

    reset();
    wb.install(packed.payload);
    const got = useSettings.getState().textWorldBooks[0];
    expect(got.builtin).toBe(false);
    expect(got.builtinKey).toBeUndefined();
    expect(got.removedBuiltinUids).toBeUndefined();
    expect(got.id.startsWith('twb_')).toBe(true);
  });

  it('同名覆盖不堆叠', () => {
    wb.install({ name: '同名书', shelf: 'text', entries: book('x', 'x').entries });
    wb.install({ name: '同名书', shelf: 'text', entries: [] });
    expect(useSettings.getState().textWorldBooks).toHaveLength(1);
    expect(useSettings.getState().textWorldBooks[0].entries).toHaveLength(0);
  });
});

describe('工坊世界书·本地 .json 直传', () => {
  beforeEach(reset);

  const raw = JSON.stringify({
    entries: {
      '0': { uid: 0, key: ['测试'], comment: '条目A', content: '内容A', constant: false, selective: true, order: 100, position: 0, disable: false },
      '1': { uid: 1, key: [], comment: '条目B', content: '内容B', constant: true, selective: false, order: 101, position: 4, depth: 2, disable: false },
    },
  });

  it('解析文件 → 打包（默认正文世界书）→ 安装进正文世界书栏', () => {
    const packed = packWorldBookFile(raw, '本地导入测试书');
    expect(packed.name).toBe('本地导入测试书');
    expect(packed.category).toBe(WB_CAT_TEXT);
    expect(packed.payload.entries).toHaveLength(2);

    wb.install(packed.payload);
    const s = useSettings.getState();
    expect(s.textWorldBooks[0].name).toBe('本地导入测试书');
    expect(s.textWorldBooks[0].entries.map((e) => e.comment)).toEqual(['条目A', '条目B']);
    expect(s.worldBooks).toHaveLength(0);
    // 只是「打包上传」，本地库不该被写入（导入设置页才写）
  });

  it('指定辅助世界书 → 安装进辅助栏', () => {
    wb.install(packWorldBookFile(raw, '本地导入测试书', 'aux').payload);
    expect(useSettings.getState().worldBooks).toHaveLength(1);
    expect(useSettings.getState().textWorldBooks).toHaveLength(0);
  });

  it('空/坏文件直接报错，不上传空书', () => {
    expect(() => packWorldBookFile('{"entries":{}}', '空书')).toThrow(/没有解析出任何条目/);
    expect(() => packWorldBookFile('不是 json', '坏书')).toThrow();
  });
});
