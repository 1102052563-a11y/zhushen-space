/* ── 🎯 自定义注入（借鉴 ST-Prompt-Template 的 @INJECT 思想·AGPL 不抄码·实现全自写）────────
   玩家在「预设中心 → 自定义注入」配置的条目，作用于**最终 messages 数组**（App.callApi 组装完成后、
   发送前的最后一步），与预设内部的 injection_position/order 体系互不混算。
   规则：
   · 位置全部先解析成 index，再按 index **从后往前**插入（高位先插·互不位移）；
   · protectTail 保护末尾 prefill（<think> 预填等）恒居末位——插入点封顶在 length-protectTail；
   · activeWhen 条件不满足 / 内容展开后为空 / regex 无效或未命中 → 该条静默跳过，绝不阻断正文。 */

export interface PromptInject {
  id: string;
  label: string;           // 面板显示名
  content: string;         // 注入内容（应用时走 expandPromptText：宏 / <if var> / {{include}} 都可用）
  role: 'system' | 'user' | 'assistant';
  pos: 'start' | 'end' | 'depth' | 'regex';
  depth?: number;          // pos=depth：插到倒数第 N 楼之前（1=最后一楼前；0 等价 end）
  regex?: string;          // pos=regex：从**末尾往前**找第一条命中楼（不区分大小写）
  at?: 'before' | 'after'; // regex 命中楼的前 / 后（默认 before）
  activeWhen?: string;     // 可选激活条件（<if cond> 语法：var:/cell:/seed:/random: + &,|!()；空=总是）
  enabled: boolean;
}

export interface ApplyInjectOpts {
  expand: (t: string) => string;     // 内容展开（调用方传 expandPromptText 闭包）
  cond: (expr: string) => boolean;   // activeWhen 求值（调用方传 passActiveWhen 闭包）
  protectTail?: number;              // 末尾保护条数（prefill）：默认 0
}

/** 把启用的注入条目插进 messages（原地 splice）。单条任何异常都只跳过该条。 */
export function applyCustomInjects(
  messages: { role: string; content: string }[],
  injects: PromptInject[],
  opts: ApplyInjectOpts,
): void {
  const list = (injects ?? []).filter((j) => j && j.enabled);
  if (!list.length) return;
  const maxIdx = Math.max(0, messages.length - Math.max(0, Math.floor(opts.protectTail ?? 0)));
  const planned: { idx: number; ord: number; msg: { role: string; content: string } }[] = [];
  list.forEach((j, ord) => {
    try {
      const w = (j.activeWhen || '').trim();
      if (w && !opts.cond(w)) return;
      const content = (opts.expand(j.content || '') || '').trim();
      if (!content) return;
      let idx: number;
      if (j.pos === 'start') idx = 0;
      else if (j.pos === 'end') idx = maxIdx;
      else if (j.pos === 'depth') idx = maxIdx - Math.max(0, Math.floor(j.depth ?? 0));
      else {
        const src = (j.regex || '').trim();
        if (!src) return;
        let re: RegExp;
        try { re = new RegExp(src, 'i'); } catch { return; }   // 非法正则=跳过
        let hit = -1;
        for (let i = maxIdx - 1; i >= 0; i--) { if (re.test(messages[i]?.content || '')) { hit = i; break; } }
        if (hit === -1) return;                                 // 未命中=跳过（不兜底到末尾，避免"以为插进场景里其实贴在最后"）
        idx = j.at === 'after' ? hit + 1 : hit;
      }
      idx = Math.max(0, Math.min(idx, maxIdx));
      planned.push({ idx, ord, msg: { role: j.role || 'system', content } });
    } catch { /* 单条失败静默跳过 */ }
  });
  // 从后往前插：index 降序；同 index 按列表次序稳定（先定义的最终更靠前）
  planned.sort((a, b) => (b.idx - a.idx) || (b.ord - a.ord));
  for (const p of planned) messages.splice(p.idx, 0, p.msg);
}

/** 新条目工厂（面板「＋添加」用）。 */
export function newPromptInject(): PromptInject {
  return {
    id: 'inj_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    label: '新注入条目',
    content: '',
    role: 'system',
    pos: 'end',
    enabled: true,
  };
}
