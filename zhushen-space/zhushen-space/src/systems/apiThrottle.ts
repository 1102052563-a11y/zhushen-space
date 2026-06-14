/* 全局 API 请求节流闸门：限制「同时在飞的请求数」+ 强制「两次请求开始之间的最小间隔」。
   缓解中转站 429（请求过于频繁）——每回合正文后物品/主角/NPC/势力/领地/冒险团/杂项/记忆等阶段
   会并发发起大量请求，若都打向同一中转站极易触发限流。所有走 apiChatFallback 的调用共用此闸门。
   （主正文流式调用是单条、不在此列；NAI 生图另有自己的串行队列 naiGate。）*/

let active = 0;          // 当前在飞的请求数
let lastStart = 0;       // 上一次「获得名额并准备发起」的时间戳
const queue: (() => void)[] = [];

function pump(maxConcurrent: number) {
  const cap = Math.max(1, maxConcurrent || 1);
  while (active < cap && queue.length > 0) {
    const next = queue.shift()!;
    active++;
    next();
  }
}

/* 取得一个请求名额；返回 release 回调，请求结束后务必调用以释放名额。
   maxConcurrent：最大并发；minGapMs：两次请求开始之间的最小间隔（毫秒，0=不强制）。 */
export async function acquireApiSlot(maxConcurrent: number, minGapMs: number): Promise<() => void> {
  await new Promise<void>((resolve) => {
    queue.push(resolve);
    pump(maxConcurrent);
  });
  // 已占用一个并发名额，再按最小间隔错峰
  const gap = Math.max(0, minGapMs || 0);
  if (gap > 0) {
    const wait = lastStart + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastStart = Date.now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
    pump(maxConcurrent);
  };
}
