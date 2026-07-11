/* 用户导入的翻译覆盖表（运行时镜像）。
   settingsStore 在 set/hydrate 时把 settings.userGlossary 同步进来；translate.ts 读取，
   优先于内置 en.ts/vi.ts 词库——玩家自己编辑优化的翻译永远赢。 */
let UD: Record<string, Record<string, string>> = {};

export function setUserDict(d: Record<string, Record<string, string>> | undefined | null): void {
  UD = d || {};
}

/** 取某语言的用户覆盖表（空则返回 undefined，dictTranslate 直接跳过）。 */
export function userMap(lang: string): Record<string, string> | undefined {
  const m = UD[lang];
  return m && Object.keys(m).length ? m : undefined;
}
