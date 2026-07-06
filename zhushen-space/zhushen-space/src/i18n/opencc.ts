/* OpenCC 懒加载器：简体 → 繁體（台湾正体·含惯用词 s2twp）。
   仅在语言切到繁體时首次 import('opencc-js')，词典随包（离线/PWA 可用，非运行时网络请求），
   不进简体/英文用户的主 chunk。加载后缓存同步转换函数，供 DomI18n 遍历时同步调用。 */

type ConvFn = (s: string) => string;

let _conv: ConvFn | null = null;
let _loading: Promise<ConvFn> | null = null;

/** 取繁體转换函数（异步·懒加载）。切换到繁體时先 await 一次，之后走 twConverterSync。 */
export function getTwConverter(): Promise<ConvFn> {
  if (_conv) return Promise.resolve(_conv);
  if (_loading) return _loading;
  _loading = import('opencc-js')
    .then((mod: any) => {
      // full 包导出命名 Converter；防御性兼容 default 包裹
      const factory = mod.Converter ?? mod.default?.Converter ?? mod.default;
      // from:'cn'(简体) → to:'twp'(台湾正体+惯用词：软件→軟體 / 信息→資訊 / 默认→預設)
      const fn: ConvFn = factory({ from: 'cn', to: 'twp' });
      _conv = fn;
      return fn;
    })
    .catch((e) => {
      // 加载失败 → 退化为恒等函数（界面维持简体，不崩）
      console.warn('[i18n] opencc-js 加载失败，繁體回退简体：', e);
      const id: ConvFn = (s) => s;
      _conv = id;
      return id;
    });
  return _loading;
}

/** 已加载则返回同步转换函数，否则 null（MutationObserver 回调用：未就绪先跳过，加载完由全量遍历补上）。 */
export function twConverterSync(): ConvFn | null {
  return _conv;
}
