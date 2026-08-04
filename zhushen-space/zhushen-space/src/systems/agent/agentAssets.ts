/* TauriTavern 预设内嵌 Agent 资产导入（extensions.tauritavern → 本地 skill/子代理库）。
   资产结构（V14.7 实测）：
     extensions.tauritavern.skills.items[]        {skillName, bundleFormat:'ttskill-archive-base64-v1', contentBase64(zip), sha256, sourceScope}
     extensions.tauritavern.agentProfiles.items[] {profile: TT AgentProfile schemaVersion 2}
   映射：
     - skill 包解 zip → AgentSkill{files}，作用域统一挂到「导入时的预设名」（TT 里 sourceScope 指向历史版本名，无意义）
     - allowAsSubagent && !directRunnable 的档案 → SubAgentDef（人设=instructions.agentSystemPrompt·预算夹取）
     - directRunnable 的主档案 → writerNotes[预设名]（作者工作流指令，选中该预设时追加进系统提示词）
   幂等：skill 按 name+sha 判重；玩家改过的同名不覆盖。失败不抛（单条坏资产跳过）。 */
import { unzipTextFiles } from './miniZip';
import { useAgentSkills, type SubAgentDef } from '../../store/agentSkillStore';

export interface AgentAssetImportReport { skills: number; subagents: number; writerNotes: boolean; errors: string[] }

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** 从（已 JSON.parse 的）ST 预设对象导入内嵌 Agent 资产。presetName=本地导入名（作用域锚点）。 */
export async function importEmbeddedAgentAssets(data: unknown, presetName: string, builtin: boolean): Promise<AgentAssetImportReport> {
  const report: AgentAssetImportReport = { skills: 0, subagents: 0, writerNotes: false, errors: [] };
  const tt = (data as { extensions?: { tauritavern?: Record<string, any> } })?.extensions?.tauritavern;
  if (!tt || typeof tt !== 'object') return report;
  const S = useAgentSkills.getState();

  /* ── skills：zip 包 → 文本文件 ── */
  for (const it of (tt.skills?.items ?? []) as Array<Record<string, any>>) {
    try {
      const name = String(it?.skillName ?? '').trim();
      if (!name || it?.bundleFormat !== 'ttskill-archive-base64-v1' || typeof it?.contentBase64 !== 'string') continue;
      const cur = useAgentSkills.getState().skills.find((x) => x.name === name);
      if (cur?.sourceSha && cur.sourceSha === it.sha256) { continue; }   // 同包已入库：解压都省了
      const files = await unzipTextFiles(it.contentBase64);
      if (!files.some((f) => /(^|\/)SKILL\.md$/i.test(f.path))) { report.errors.push(`${name}: 包内缺 SKILL.md`); continue; }
      const r = S.upsertSkill({ name, files, scopePresetName: presetName, sourceSha: String(it.sha256 ?? ''), builtin });
      if (r !== 'skipped') report.skills++;
    } catch (e) { report.errors.push(`skill 解包失败: ${String((e as Error)?.message ?? e)}`); }
  }

  /* ── agent 档案 → 子代理定义 / 主代理作者指令 ── */
  for (const it of (tt.agentProfiles?.items ?? []) as Array<Record<string, any>>) {
    try {
      const p = it?.profile as Record<string, any>;
      if (!p || typeof p !== 'object') continue;
      const deleg = p.delegation ?? {};
      const run = p.run ?? {};
      const instructions = typeof p?.instructions?.agentSystemPrompt === 'string' ? p.instructions.agentSystemPrompt : '';
      if (run.directRunnable !== false) {
        // 主代理档案：作者自定义工作流指令挂到预设名下（选中该预设时追加注入）
        if (instructions.trim()) { S.setWriterNotes(presetName, instructions.trim()); report.writerNotes = true; }
        continue;
      }
      if (!(deleg.allowAsSubagent && deleg.callable !== false)) continue;
      const def: SubAgentDef = {
        id: String(p.id ?? '').trim() || `sub_${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: String(p.displayName ?? p.id ?? '子代理'),
        desc: String(deleg.descriptionForAgents ?? p.description ?? '').slice(0, 300),
        instructions: instructions || undefined,
        skillsVisible: Array.isArray(p?.skills?.visible) ? p.skills.visible.map(String) : undefined,
        skillsDeny: Array.isArray(p?.skills?.deny) ? p.skills.deny.map(String) : undefined,
        maxRounds: clampInt(p?.tools?.maxRounds, 1, 12, 8),   // TT 常给 999，夹到本前端的子代理上限
        maxInvocationsPerRun: clampInt(deleg?.maxInvocationsPerRun, 1, 8, 2),
        scopePresetName: presetName,
        enabled: true,
        builtin,
      };
      const r = S.upsertSubagent(def);
      if (r !== 'skipped') report.subagents++;
    } catch (e) { report.errors.push(`档案解析失败: ${String((e as Error)?.message ?? e)}`); }
  }
  return report;
}
