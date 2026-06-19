/* 轻量日志助手：给原本被「空 catch」静默吞掉的异常一个可见出口（带作用域上下文）。
   warn 级——可见但不打断；想静音/上报某类，集中在这里改即可。
   背景：存档/读档层一堆空 catch 把失败吞了，HP/EP「刷新就残血」那类 bug 就藏在这种静默里。 */
export function logWarn(scope: string, err: unknown, ...extra: unknown[]): void {
  console.warn(`[${scope}]`, err, ...extra);
}
