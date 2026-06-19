import { saveDb } from './saveDb';
import { useCharacters } from '../store/characterStore';
import { useSettings } from '../store/settingsStore';

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

  return L.join('\n');
}
