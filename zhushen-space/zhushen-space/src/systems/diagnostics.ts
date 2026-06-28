import { saveDb } from './saveDb';
import { useCharacters } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';
import { useItems, getItemLog } from '../store/itemStore';
import { useLedger } from './ledger/ledgerStore';

/* ── 一键诊断包 ───────────────────────────────────────────────────────────
   导出排查「丢东西 / 内存与存档对不上」所需的**精简信息**：纯文本、不含图片/对话，
   体积很小、可直接粘贴。覆盖：
   - localStorage 各 drpg-/zhushen- 键体积 + 总占用（贴近 5MB 上限会预警）；
   - 主角每个角色的 技能/天赋/副职业/称号 计数——**内存（界面看到的）vs 本地存储（刷新后加载的）**对照，
     不一致会标注（这正是「面板里有、刷新就没」类 bug 的指纹）；
   - 每个存档槽里 B1 的同样计数 + 槽体积/图片数/回合；
   - 关键记忆/演化开关。
   只读、无副作用。*/

type AnySlot = {
  id: string; name: string; appVersion?: string; updatedAt: number;
  preview?: { turn?: number; playerName?: string; location?: string };
  data?: { stores?: Record<string, string>; messages?: any[]; images?: Record<string, string> };
};

/** 一个角色对象 → 「技能N 天赋N 副职业N 称号N」 */
const cnt = (c: any) =>
  `技能${(c?.skills || []).length} 天赋${(c?.traits || []).length} 副职业${(c?.subProfessions || []).length} 称号${(c?.titles || []).length}`;

/** 取名字列表（兼容字符串数组 / 对象数组） */
const names = (arr: any[] | undefined) =>
  (arr || []).map((x) => (typeof x === 'string' ? x : (x?.name ?? x?.title))).filter(Boolean).join('、') || '（无）';

/** 从一份 drpg-characters 的原始 JSON 串里取出 characters 映射（持久化格式 {state:{characters}}） */
function charsFromRaw(raw: string | undefined | null): Record<string, any> {
  try { return JSON.parse(raw || '{}')?.state?.characters || {}; } catch { return {}; }
}

/** 统计 localStorage 各 drpg-/zhushen- 键体积与全局总占用 */
function lsSizes(): { lines: string[]; totalBytes: number } {
  let total = 0;
  const rows: { kb: number; line: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k) continue;
      const v = localStorage.getItem(k) || '';
      total += v.length + k.length;
      if (/^(drpg-|zhushen-)/.test(k)) {
        const kb = v.length / 1024;
        rows.push({ kb, line: `  ${kb.toFixed(1).padStart(8)} KB  ${k}` });
      }
    }
  } catch { /* localStorage 不可用：忽略，下方会显示 0 */ }
  rows.sort((a, b) => b.kb - a.kb);   // 大的在前
  return { lines: rows.map((r) => r.line), totalBytes: total };
}

export async function buildDiagnosticBundle(): Promise<string> {
  const L: string[] = [];
  L.push('# 主神空间 · 诊断包');
  L.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);

  // ── localStorage 体积 ──
  const { lines, totalBytes } = lsSizes();
  const mb = totalBytes / 1024 / 1024;
  L.push(`\n## localStorage 占用：${mb.toFixed(2)} MB / ~5 MB${mb > 4.3 ? '   ⚠ 已接近上限，持久化写入可能失败！' : ''}`);
  L.push(lines.length ? lines.join('\n') : '  （无 drpg-/zhushen- 键）');

  // ── 存储持久化 / IndexedDB 配额 ── 直接回答「存档为什么会整批消失」（存档在 IndexedDB，与上面 5MB 的 localStorage 是两回事）──
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.storage) {
      const persisted = nav.storage.persisted ? await nav.storage.persisted() : false;
      let usage = '', quota = '';
      try {
        if (nav.storage.estimate) {
          const est = await nav.storage.estimate();
          if (est.usage != null) usage = `${(est.usage / 1048576).toFixed(0)} MB`;
          if (est.quota != null) quota = `${(est.quota / 1048576).toFixed(0)} MB`;
        }
      } catch { /* estimate 不支持 */ }
      L.push('\n## 存储持久化（存档=IndexedDB，与上面 localStorage 不同库）');
      L.push(`  持久化状态：${persisted ? '✓ 已授予（浏览器不会随意清除存档）' : '✗ 未授予 ⚠ — best-effort，存储紧张时浏览器可能整批清掉全部存档（手动档先没→只剩自动档→最后全没的根因）'}`);
      L.push(`  IndexedDB 占用：${usage || '?'} / 配额 ${quota || '?'}`);
      if (!persisted) L.push('  建议：① 存档面板点「🔒 申请持久化保护」；② 把本站加书签/常访问以提高授予率；③ 重要进度用 ☁️云存档 或「导出」备份（最稳）。');
    } else {
      L.push('\n## 存储持久化：浏览器不支持 navigator.storage（隐私/无痕模式？存档可能关闭即丢）');
    }
  } catch (e: any) { L.push(`\n## 存储持久化：检测失败 — ${e?.message || e}`); }

  // ── 主角：内存 vs 本地存储 ──
  L.push('\n## 主角角色  （内存 = 界面现在看到的；本地 = 刷新/读档后会加载的）');
  const memChars = (() => { try { return useCharacters.getState().characters || {}; } catch { return {}; } })();
  const lsChars = charsFromRaw(localStorage.getItem('drpg-characters'));
  const ids = Array.from(new Set([...Object.keys(memChars), ...Object.keys(lsChars)])).sort();
  if (ids.length === 0) {
    L.push('  ⚠ characterStore 为空（内存和本地都没有任何角色）');
  } else for (const id of ids) {
    const m = memChars[id], s = lsChars[id];
    const memC = cnt(m), lsC = cnt(s);
    L.push(`  ${id}${memC !== lsC ? '   ⚠ 内存 ≠ 本地（界面有但没落盘 / 或反之）' : ''}`);
    L.push(`     内存：${memC}`);
    L.push(`     本地：${lsC}`);
    if (id === 'B1') {
      L.push(`     技能名(内存)：${names(m?.skills)}`);
      L.push(`     天赋名(内存)：${names(m?.traits)}`);
      L.push(`     副职业(内存)：${names(m?.subProfessions)}`);
    }
  }

  // ── 存档槽 ──
  try {
    const slots = await saveDb.all<AnySlot>();
    slots.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    L.push(`\n## 存档槽（${slots.length} 个，按时间倒序）`);
    if (slots.length === 0) L.push('  （无存档）');
    for (const s of slots) {
      const b1 = charsFromRaw(s.data?.stores?.['drpg-characters'])['B1'];
      const sizeMB = (JSON.stringify(s).length / 1024 / 1024).toFixed(2);
      const imgN = s.data?.images ? Object.keys(s.data.images).length : 0;
      L.push(`  ${s.id}`);
      L.push(`     ${s.name}  |  ${new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}  |  ${sizeMB} MB  |  图片 ${imgN}  |  回合 ${s.preview?.turn ?? '?'}`);
      L.push(`     B1：${cnt(b1)}`);
    }
  } catch (e: any) {
    L.push(`\n## 存档槽：读取失败 — ${e?.message || e}`);
  }

  // ── 关键开关 ──
  try {
    const ss: any = useSettings.getState();
    const nm = ss.narrativeMemory || {}, vm = ss.vectorMemory || {};
    L.push('\n## 关键开关');
    L.push(`  叙事记忆 ${nm.enabled ? '开' : '关'} · LLM整理抽取 ${nm.llmMode ? '开' : '关'} · 结构化召回 ${nm.structEnabled !== false ? '开' : '关'} · API选取条目 ${nm.structApiSelect ? '开' : '关'}`);
    L.push(`  向量记忆 ${vm.enabled ? '开' : '关'}`);
  } catch { /* 设置读取失败：跳过开关段 */ }

  // ── 正文预设（注入诊断）── 直接回答「预设到底注没注入正文」 ──
  try {
    const ss: any = useSettings.getState();
    const tp: any[] = ss.textPresets || [];
    const aid = ss.activeTextPresetId;
    const aname = ss.activeTextPresetName;
    // 复刻 App.tsx 的解析顺序：id → 名 → 第一个
    const resolved = tp.find((p) => p.id === aid) || tp.find((p) => p.name === aname) || tp[0];
    L.push('\n## 正文预设（注入诊断）');
    L.push(`  激活 id：${aid ?? '(null)'}　激活名(记忆)：${aname ?? '(无)'}`);
    if (!tp.length) {
      L.push('  ⚠ 预设库为空！补种没跑或被回退 → 正文必然无预设注入（只剩最简默认，约几百词符）。');
    } else if (!resolved) {
      L.push('  ⚠ 解析不到任何预设 → 正文无预设注入！');
    } else {
      const entries: any[] = resolved.entries || [];
      const enCount = entries.filter((e) => e.enabled !== false).length;
      const depthCount = entries.filter((e) => e.enabled !== false && (e.injection_position === 1 || e.injection_position === '1')).length;
      const idHit = tp.some((p) => p.id === aid);
      const nameHit = tp.some((p) => p.name === aname);
      L.push(`  实际解析到：「${resolved.name}」　条目 ${entries.length}（启用 ${enCount}，其中深度注入 ${depthCount}）　正则 ${(resolved.regexScripts || []).length}`);
      L.push(`  解析途径：${idHit ? 'id 命中 ✓' : aid == null ? 'activeId=null → 回落库内第一个' : nameHit ? 'id 失配 → 按名找回 ✓' : 'id 失配且无同名 → 回落第一个'}`);
      if (!idHit && aid != null) L.push('  ⚠ activeId 不在库中（内置预设旧版每次启动换 id 的指纹）——已被「稳定 id + 按名兜底」修复救回。');
      if (enCount === 0) L.push('  ⚠ 该预设没有任何启用条目 → 系统提示词会极短，等于没注入！');
    }
    L.push(`  预设库（${tp.length}）：`);
    for (const p of tp) {
      const mark = p.id === aid ? '  ← 激活(id)' : p.name === aname ? '  ← 激活(名)' : '';
      L.push(`    ${p.builtin ? '[内置]' : '[用户]'} ${p.name}　id=${p.id}　条目=${(p.entries || []).length}${mark}`);
    }
  } catch (e: any) {
    L.push(`\n## 正文预设：读取失败 — ${e?.message || e}`);
  }

  // ── 物品流水审计（回答「东西到底去哪了」）──
  try {
    const log = getItemLog();
    L.push(`\n## 物品离场流水（最近 ${Math.min(log.length, 50)} 条 / 共 ${log.length}）  —— 销毁/消耗/转出/合并/守护捞回 全记录`);
    if (log.length === 0) L.push('  （本次会话暂无物品离场事件）');
    else for (const e of log.slice(-50)) L.push(`  [回合${e.turn}] ${e.op}：${e.name}${e.detail ? ` —— ${e.detail}` : ''}`);
    const bin = useItems.getState().recentlyDeleted ?? [];
    L.push(`\n## 最近删除回收站（${bin.length}，可恢复）`);
    for (const d of bin.slice(0, 30)) L.push(`  [回合${(d as any).deletedTurn ?? '?'}] ${d.name}${(d as any).deleteReason ? ` —— ${(d as any).deleteReason}` : ''}`);
  } catch (e: any) {
    L.push(`\n## 物品流水：读取失败 — ${e?.message || e}`);
  }

  // ── 演化账本（跨域：物品/NPC/角色/势力/领地/团/杂项 的单一闸门裁决审计）──
  try {
    const evs = useLedger.getState().recent(80);
    L.push(`\n## 演化账本（最近 ${evs.length} 条 / 闸门裁决）  —— 回合·写入方 | entity.op ref → 结果`);
    if (evs.length === 0) L.push('  （暂无账本事件）');
    else for (const e of evs) L.push(`  [回合${e.turn}·${e.source}] ${e.entity}.${e.op} ${e.ref ?? ''} → ${e.outcome}${e.detail ? `（${e.detail}）` : ''}`);
  } catch (e: any) {
    L.push(`\n## 演化账本：读取失败 — ${e?.message || e}`);
  }

  return L.join('\n');
}
