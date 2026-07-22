import { describe, it, expect, beforeEach } from 'vitest';
import { useNpc } from './npcStore';

/* 🔒六维锁（attrsLocked）：治用户报「在 NPC 档案里改了召唤物/随从的六维，下回合又被改回去」。
   AI 侧的一切 attrs 写入（正文人物卡照抄 / character.<id>.attr 指令 / 机械补全 / 幸运重算）都走 upsertNpc，
   故在 upsertNpc 单点收口即可全拦；手动编辑面板传 { manual:true } 绕过。 */

const ATTRS = { str: 10, agi: 10, con: 10, int: 10, cha: 10, luck: 10 };
const AI_ATTRS = { str: 99, agi: 1, con: 1, int: 1, cha: 1, luck: 1 };

describe('六维锁 attrsLocked', () => {
  beforeEach(() => { useNpc.setState({ npcs: {} }); });

  it('未锁：AI 侧写入照常覆盖六维（保持原行为）', () => {
    useNpc.getState().upsertNpc('C1', { name: '小灵', attrs: { ...ATTRS } });
    useNpc.getState().upsertNpc('C1', { attrs: { ...AI_ATTRS } });          // 模拟正文人物卡照抄
    expect(useNpc.getState().npcs['C1'].attrs?.str).toBe(99);
  });

  it('锁上后：AI 侧 attrs 被剥掉，其余字段照常更新', () => {
    useNpc.getState().upsertNpc('C1', { name: '小灵', attrs: { ...ATTRS } });
    useNpc.getState().upsertNpc('C1', { attrsLocked: true }, { manual: true });
    useNpc.getState().upsertNpc('C1', { attrs: { ...AI_ATTRS }, status: '中毒' });   // AI 侧同时改六维+状态
    const r = useNpc.getState().npcs['C1'];
    expect(r.attrs?.str).toBe(10);     // 六维纹丝不动
    expect(r.status).toBe('中毒');      // 其余字段照常演化
  });

  it('锁上后：手动编辑(manual) 仍能改六维', () => {
    useNpc.getState().upsertNpc('C1', { name: '小灵', attrs: { ...ATTRS } });
    useNpc.getState().upsertNpc('C1', { attrsLocked: true }, { manual: true });
    useNpc.getState().upsertNpc('C1', { attrs: { ...ATTRS, str: 55 } }, { manual: true });
    expect(useNpc.getState().npcs['C1'].attrs?.str).toBe(55);
  });

  it('解锁后：AI 侧恢复可改', () => {
    useNpc.getState().upsertNpc('C1', { name: '小灵', attrs: { ...ATTRS } });
    useNpc.getState().upsertNpc('C1', { attrsLocked: true }, { manual: true });
    useNpc.getState().upsertNpc('C1', { attrs: { ...AI_ATTRS } });
    expect(useNpc.getState().npcs['C1'].attrs?.str).toBe(10);
    useNpc.getState().upsertNpc('C1', { attrsLocked: false }, { manual: true });
    useNpc.getState().upsertNpc('C1', { attrs: { ...AI_ATTRS } });
    expect(useNpc.getState().npcs['C1'].attrs?.str).toBe(99);
  });
});
