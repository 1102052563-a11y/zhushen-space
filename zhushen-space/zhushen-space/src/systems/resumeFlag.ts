/* 续玩标志（跨 location.reload 传递「重启后回到游戏」的信号）
   ─────────────────────────────────────────────────────────────
   读档 / 重新生成 / 仅重算变量 / 崩溃自愈，都是「写标志 → location.reload() → 重启读标志 setStarted(true)」。

   【为何从 sessionStorage 改用 localStorage】
   原实现把标志写进 sessionStorage，但在部分手机环境——微信/QQ 内置浏览器、iOS 隐私模式、
   以及「添加到主屏幕」的 PWA 独立窗口——sessionStorage 跨 location.reload() 会丢失，或 setItem
   直接抛 QuotaExceeded 被 catch 吞掉。结果重启后读不到标志 → started=false → 读档后弹回主界面
   （用户报「手机读存档读不了，点了直接回主界面」的根因；存档数据其实已落 localStorage/IndexedDB，
   丢的只是这个「回到游戏」的信号）。localStorage 跨 reload 在各端稳定存活。

   【为何加时间戳 + TTL】localStorage 不像 sessionStorage 在标签关闭时自动清除。若只写不清，下次
   重新打开 App 会误判为「有续玩标志」而自动跳进上一局、绕过主界面。故写入带 t=Date.now()，读取仅在
   TTL 内有效（只覆盖「reload 那一瞬」），过期即视为无并顺手清掉（含体积较大的 revar 载荷）。 */

const TTL = 60_000;   // 标志有效期（ms）：只需覆盖 reload 重启这一小段；超时即失效，防陈旧标志误触发续玩

interface Wrapped { __rf: 1; v: string; t: number }

function isWrapped(o: unknown): o is Wrapped {
  return !!o && typeof o === 'object' && (o as Wrapped).__rf === 1 && typeof (o as Wrapped).t === 'number';
}

/** 写续玩标志。value 可为任意字符串（如 revar 的 JSON 载荷），默认 '1'。 */
export function setResumeFlag(key: string, value = '1'): void {
  const payload = JSON.stringify({ __rf: 1, v: value, t: Date.now() } as Wrapped);
  try { localStorage.setItem(key, payload); return; }
  catch { /* localStorage 写失败（隐私模式/配额）→ 退回 sessionStorage 兜底，至少同标签内可用 */ }
  try { sessionStorage.setItem(key, value); } catch { /* 两处都写不了：无能为力，静默 */ }
}

/** 读续玩标志；TTL 内返回原值，过期/不存在返回 null。兼容历史 sessionStorage 里的裸值。 */
export function getResumeFlag(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) {
      try {
        const o = JSON.parse(raw);
        if (isWrapped(o)) {
          if (Date.now() - o.t < TTL) return o.v;
          try { localStorage.removeItem(key); } catch { /* */ }   // 过期即清
          return null;
        }
      } catch { /* 非本格式 JSON：按裸值处理 */ }
      return raw;   // 兼容历史直接写入的裸字符串
    }
  } catch { /* */ }
  try { return sessionStorage.getItem(key); } catch { /* */ }   // 兼容旧版遗留在 sessionStorage 的标志
  return null;
}

/** 消费（清除）续玩标志——localStorage 与 sessionStorage 两处都清，杜绝残留。 */
export function clearResumeFlag(key: string): void {
  try { localStorage.removeItem(key); } catch { /* */ }
  try { sessionStorage.removeItem(key); } catch { /* */ }
}
