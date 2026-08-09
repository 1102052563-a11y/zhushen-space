/* Agent 技能 / 子代理资产库（drpg-agentskills）——TauriTavern 预设内嵌资产的本地承接。
   来源：ST 预设 JSON 的 extensions.tauritavern（agentProfiles.items + skills.items·zip 包 base64），
   导入链 systems/agent/agentAssets.ts。配置类 store：新游戏保留（不给 clear）、随存档快照。
   - skills：Agent 按需读的本地知识包（SKILL.md + references/*），skill_list/search/read 工具消费
   - subagents：可被 agent_delegate 委派的子代理定义（人设指令+技能可见性+预算+可选独立接口路由）
   - writerNotes：主代理（directRunnable 档案）的作者自定义工作流指令，按预设名挂载、选中该预设时追加进系统提示词 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AgentSkillFile { path: string; content: string }
export interface AgentSkill {
  name: string;                 // 唯一名（fox-banword-rules）
  files: AgentSkillFile[];      // 至少含 SKILL.md
  /** @deprecated 单作用域旧字段（仍读，用于老数据迁移）；新数据写 scopePresets */
  scopePresetName?: string;
  /** 预设作用域**并集**：同一份资产可被多个预设内嵌/多次导入（同名不同来源、玩家先手动导入过）。
      空数组/缺省=全局可见。⚠ 必须是并集——只记最后一次会让先前来源的预设看不到它（Discord 实报） */
  scopePresets?: string[];
  sourceSha?: string;           // 包 sha256（判重）
  builtin?: boolean;            // 随内置预设导入
}
export interface SubAgentDef {
  id: string;                   // fox-banword-checker
  name: string;                 // 显示名
  desc: string;                 // 给主代理看的能力描述（agent_list 输出）
  instructions?: string;        // 子代理人设/工作流（作者自定义，作系统提示词主体）
  skillsVisible?: string[];     // 技能可见白名单（'*'=全部）；deny 优先
  skillsDeny?: string[];
  maxRounds?: number;           // 已夹取（≤12）
  maxInvocationsPerRun?: number;
  scopePresetName?: string;     // 随预设走：仅选中该预设时可被列出/委派
  enabled?: boolean;            // 玩家开关（默认开）
  builtin?: boolean;
}

interface AgentSkillState {
  skills: AgentSkill[];
  subagents: SubAgentDef[];
  writerNotes: Record<string, string>;   // presetName → 主代理作者指令
  upsertSkill: (s: AgentSkill) => 'added' | 'updated' | 'skipped';
  upsertSubagent: (d: SubAgentDef) => 'added' | 'updated' | 'skipped';
  setWriterNotes: (presetName: string, notes: string) => void;
  setSubagentEnabled: (id: string, enabled: boolean) => void;
  removeSkill: (name: string) => void;
  removeSubagent: (id: string) => void;
}

export const useAgentSkills = create<AgentSkillState>()(
  persist(
    (set, get): AgentSkillState => ({
      skills: [],
      subagents: [],
      writerNotes: {},
      upsertSkill: (s) => {
        const cur = get().skills.find((x) => x.name === s.name);
        if (cur && cur.sourceSha && cur.sourceSha === s.sourceSha) return 'skipped';
        if (cur && !cur.builtin && s.builtin) return 'skipped';   // 玩家自建/改过的同名优先，内置不覆盖
        set((st) => ({ skills: [...st.skills.filter((x) => x.name !== s.name), s] }));
        return cur ? 'updated' : 'added';
      },
      upsertSubagent: (d) => {
        const cur = get().subagents.find((x) => x.id === d.id);
        if (cur && !cur.builtin && d.builtin) return 'skipped';
        const keep = cur ? { enabled: cur.enabled } : {};        // 玩家开关状态在更新时保留
        set((st) => ({ subagents: [...st.subagents.filter((x) => x.id !== d.id), { ...d, ...keep }] }));
        return cur ? 'updated' : 'added';
      },
      setWriterNotes: (presetName, notes) => set((st) => ({ writerNotes: { ...st.writerNotes, [presetName]: notes } })),
      setSubagentEnabled: (id, enabled) => set((st) => ({ subagents: st.subagents.map((x) => x.id === id ? { ...x, enabled } : x) })),
      removeSkill: (name) => set((st) => ({ skills: st.skills.filter((x) => x.name !== name) })),
      removeSubagent: (id) => set((st) => ({ subagents: st.subagents.filter((x) => x.id !== id) })),
    }),
    { name: 'drpg-agentskills' },
  ),
);

/** 当前预设作用域下可见的技能（deny 优先；visible 支持 '*'；不传过滤=作用域内全部） */
export function visibleSkills(presetName: string, filter?: { visible?: string[]; deny?: string[] }): AgentSkill[] {
  const inScope = useAgentSkills.getState().skills.filter((s) => !s.scopePresetName || s.scopePresetName === presetName);
  if (!filter) return inScope;
  const deny = new Set(filter.deny ?? []);
  const vis = filter.visible ?? ['*'];
  const all = vis.includes('*');
  return inScope.filter((s) => !deny.has(s.name) && (all || vis.includes(s.name)));
}
