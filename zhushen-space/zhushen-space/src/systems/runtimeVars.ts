/* ── 运行时变量桥（透明引用）─────────────────────────────────────────────
   把「核心游戏态」+「玩家自定义变量」采集成一份 name→value 的快照，喂给 ST 宏引擎
   (stMacros.makeMacroCtx 的 runtimeVars)，于是**任意正文预设/世界书都能直接引用**：
       {{getvar::主角.HP}}   ${世界.名}   {{getvar::好感度}}
   设计要点：
   · 核心态用「分组.字段」命名（主角./货币./世界.），与作者自定义的扁平变量名天然不撞，且自带出处、便于二创查阅。
   · 自定义变量用原始 key（作者在变量管理里定义，正文 AI 经 <state> 的 `key = 值`/`key += 值` 更新）。
   · runtimeVars 只是「种子/默认值」：预设内若再 {{setvar::同名::x}} 会就地覆盖，不冲突。
   · 一份 runtimeVarCatalog() 同时驱动「宏注入」与「变量管理页的实时目录」，单一真相、零漂移。
   无宏的预设(轮回乐园三本多数块)走 processMacros 快速返回，零开销。 */
import { usePlayer, type PlayerAttrs } from '../store/playerStore';
import { useGame } from '../store/gameStore';
import { useItems } from '../store/itemStore';
import { useMisc } from '../store/miscStore';
import { useVariables } from '../store/variableStore';

export interface RuntimeVarRow {
  name: string;     // 引用名：{{getvar::name}} / ${name}
  value: string;    // 当前值（已字符串化）
  group: '核心游戏态' | '自定义变量';
  desc?: string;    // 说明（目录展示用）
  custom?: boolean; // 自定义变量（目录里可编辑/删除）
}

const ATTR_LABEL: Record<keyof PlayerAttrs, string> = {
  str: '力量', agi: '敏捷', con: '体质', int: '智力', cha: '魅力', luck: '幸运',
};

/** 采集全部可被预设宏引用的运行时变量（核心游戏态 + 自定义变量）。读 store 当前态，非响应式。 */
export function runtimeVarCatalog(): RuntimeVarRow[] {
  const rows: RuntimeVarRow[] = [];
  const p = usePlayer.getState().profile;
  const g = useGame.getState().player;
  const cur = useItems.getState().currency;
  const m = useMisc.getState();

  const core = (name: string, value: unknown, desc?: string) =>
    rows.push({ name, value: value == null ? '' : String(value), group: '核心游戏态', desc });

  // 主角身份
  core('主角.名', p?.name, '主角姓名');
  core('主角.等级', p?.level, '主角等级');
  core('主角.阶位', p?.tier, '主角阶位');
  core('主角.称号', p?.title, '当前称号');
  core('主角.身份', p?.identity, '主角身份');
  core('主角.位置', p?.location, '当前所处位置');
  core('主角.世界之源', p?.worldSource, '当前任务世界累计世界之源');
  core('主角.属性点', p?.attrPoints, '可用属性点余额');
  // 基础六维
  for (const k of Object.keys(ATTR_LABEL) as (keyof PlayerAttrs)[]) {
    core(`主角.${ATTR_LABEL[k]}`, p?.attrs?.[k], `主角基础${ATTR_LABEL[k]}`);
  }
  // HP / EP / 理智
  core('主角.HP', g?.hp, '当前生命'); core('主角.HP上限', g?.maxHp, '生命上限');
  core('主角.EP', g?.mp, '当前能量'); core('主角.EP上限', g?.maxMp, '能量上限');
  core('主角.理智', g?.san, '当前理智'); core('主角.理智上限', g?.maxSan, '理智上限');
  // 货币（按钱包动态展开）
  for (const [k, v] of Object.entries(cur ?? {})) core(`货币.${k}`, v, '货币余额');
  // 世界 / 时间
  core('世界.名', m.worldName, '当前所在世界');
  core('世界.乐园时间', m.paradiseTime, '主神空间时间');
  core('世界.世界时间', m.worldTime, '任务世界时间');
  core('世界.天气', m.weather, '当前天气');
  core('世界.回合数', m.turnCount, '本存档累计总回合');

  // 自定义变量（作者定义、AI 经 <state> 更新）
  for (const v of useVariables.getState().variables) {
    rows.push({
      name: v.key,
      value: v.type === 'boolean' ? (v.value ? '是' : '否') : String(v.value ?? ''),
      group: '自定义变量',
      desc: v.label || v.desc,
      custom: true,
    });
  }
  return rows;
}

/** 拍平成 makeMacroCtx 需要的 Record<string,string>（供 {{getvar::名}} / ${名} 解析）。 */
export function buildRuntimeVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of runtimeVarCatalog()) {
    if (r.name) out[r.name] = r.value;
  }
  return out;
}
