/* 四轴对主角态度·限速护栏（代码增量封顶 + 沉沦棘轮 + 阶段映射）——治"性爱速堕 / 关系速升 / 无剧情就沦陷"。
 *
 * 设计对齐 driftGuard 的"就近关键词判定放行"思路：AI 每回合提议的态度增量**默认被封顶**（普通调情/示好只准小涨），
 * 只有正文在该 NPC 名附近出现【强事件关键词】（媚药/洗脑/救命之恩/生死与共/背叛…）时才准大跳；
 * 沉沦(corruption)是**只增难减的棘轮**——除非就近出现救赎/决裂类事件，否则不许下降。
 *
 * 全部纯函数、无副作用：供 App.tsx applyNpcShortCommands 汇总每 NPC+轴 的提议增量后夹逼一次，再落 store.applyDisposition；亦供单测。
 */

export type DispAxis = 'trust' | 'respect' | 'lust' | 'corruption';

export const DISP_AXES: readonly DispAxis[] = ['trust', 'respect', 'lust', 'corruption'] as const;

/** 轴 → 中文名（注入/展示用）。*/
export const DISP_ZH: Record<DispAxis, string> = { trust: '信任', respect: '尊重', lust: '情欲', corruption: '沉沦' };

/** 轴的默认初值（与 npcStore.defaultNpcRecord 一致；旧档缺字段时读时回退）。*/
export const DISP_DEFAULT: Record<DispAxis, number> = { trust: 10, respect: 10, lust: 0, corruption: 0 };

/** 常规每回合净增量封顶（无强事件时）。信任/尊重/情欲同档，沉沦更慢。*/
export const DISP_TURN_CAP: Record<DispAxis, number> = { trust: 8, respect: 8, lust: 8, corruption: 5 };

/** 出现强事件时放宽到的每回合净增量封顶。*/
export const DISP_TURN_CAP_STRONG: Record<DispAxis, number> = { trust: 30, respect: 30, lust: 30, corruption: 30 };

/** 强事件关键词：出现在该 NPC 名附近(±win)才把该轮增量上限放宽到 STRONG。
 *  涵盖：药物/精神控制、性胁迫、恩义/救命、契约羁绊、背叛/交心等能"合理地让态度骤变"的剧情。*/
const STRONG_EVENT_KW =
  /媚药|春药|媚毒|催情|情蛊|情花|洗脑|夺舍|摄魂|催眠|蛊惑|魅惑术|奴印|烙印|调教|驯服|胁迫|要挟|逼迫|强暴|凌辱|下药|救命之恩|舍命|救[了下]|生死与共|同生共死|出生入死|以身相许|结契|血誓|灵魂契约|主仆契约|铭刻|背叛|叛变|出卖|欺骗|真心|交心|托付终身|恩重如山|恩将仇报|舍身/;

/** 沉沦棘轮例外：仅当就近出现救赎/决裂类事件，才准让 corruption 下降。*/
const REDEMPTION_KW =
  /救赎|幡然醒悟|迷途知返|挣脱|清醒过来|决裂|恩断义绝|反目|翻脸|解除契约|净化|疗愈|走出阴影|重获自我|斩断情丝|悔悟|回头是岸|摆脱控制|解毒|破除/;

/** 就近判定：narrative 中 name 附近 ±win 字内是否出现给定正则（同 driftGuard.itemChangeJustified 口径）。*/
export function nearName(name: string, narrative: string, re: RegExp, win = 40): boolean {
  const nm = (name || '').trim();
  if (!narrative || nm.length < 2) return false;
  for (let i = narrative.indexOf(nm); i >= 0; i = narrative.indexOf(nm, i + nm.length)) {
    if (re.test(narrative.slice(Math.max(0, i - win), i + nm.length + win))) return true;
  }
  return false;
}

/** 本轮该 NPC 是否发生了"强事件"（决定增量上限用 STRONG 还是常规）。*/
export function hasStrongEvent(name: string, narrative: string): boolean {
  return nearName(name, narrative, STRONG_EVENT_KW);
}

/** 把 AI 提议的某轴【净增量】按护栏夹逼成"实际可落地的增量"。
 *  - 常规增量按绝对值封顶到 DISP_TURN_CAP；该 NPC 名附近有强事件则放宽到 DISP_TURN_CAP_STRONG。
 *  - 沉沦(corruption)棘轮：默认禁止下降（负增量归 0）；仅当就近出现救赎类关键词才准降（降幅同样受封顶约束）。
 *  - 返回夹逼后的增量（可能为 0）。strong 可选传入以复用 hasStrongEvent 结果，省重复扫描。*/
export function clampDispositionDelta(
  axis: DispAxis,
  desiredDelta: number,
  name: string,
  narrative: string,
  strong?: boolean,
): number {
  if (!Number.isFinite(desiredDelta) || desiredDelta === 0) return 0;

  // 沉沦棘轮：无救赎事件不许降
  if (axis === 'corruption' && desiredDelta < 0 && !nearName(name, narrative, REDEMPTION_KW)) return 0;

  const isStrong = strong ?? hasStrongEvent(name, narrative);
  const cap = (isStrong ? DISP_TURN_CAP_STRONG : DISP_TURN_CAP)[axis];
  const sign = desiredDelta < 0 ? -1 : 1;
  return sign * Math.min(Math.abs(desiredDelta), cap);
}

/** 单档阶段（禁跳级注入用）。信任/尊重/情欲四档；沉沦五档(0=守身)。*/
export function stageOf(axis: DispAxis, value: number): { stage: number; label: string } {
  const v = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  if (axis === 'corruption') {
    if (v <= 0) return { stage: 0, label: '守身' };
    if (v <= 25) return { stage: 1, label: '动摇' };
    if (v <= 50) return { stage: 2, label: '沾染' };
    if (v <= 75) return { stage: 3, label: '沉溺' };
    return { stage: 4, label: '沦陷' };
  }
  const bands: Record<Exclude<DispAxis, 'corruption'>, [string, string, string, string]> = {
    trust: ['戒备', '将信将疑', '信赖', '托付'],
    respect: ['轻视', '平视', '认可', '敬服'],
    lust: ['无感', '微热', '情动', '欲炽'],
  };
  const stage = v <= 25 ? 1 : v <= 50 ? 2 : v <= 75 ? 3 : 4;
  return { stage, label: bands[axis][stage - 1] };
}

/** 组装某 NPC 四轴的注入行（供正文/演化锚定"当前阶段·禁跳级"）。
 *  例："信任48·将信将疑 | 尊重60·认可 | 情欲12·微热 | 沉沦0·守身"。*/
export function dispositionLine(r: Partial<Record<DispAxis, number>>): string {
  return DISP_AXES.map((a) => {
    const v = r[a] ?? DISP_DEFAULT[a];
    const s = stageOf(a, v);
    return `${DISP_ZH[a]}${v}·${s.label}`;
  }).join(' | ');
}
