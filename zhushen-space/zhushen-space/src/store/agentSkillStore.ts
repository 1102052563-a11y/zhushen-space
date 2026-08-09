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
  /** @deprecated 单作用域旧字段（仍读，用于老数据迁移）；新数据写 scopePresets */
  scopePresetName?: string;
  scopePresets?: string[];      // 预设作用域并集（同 AgentSkill.scopePresets）
  enabled?: boolean;            // 玩家开关（默认开）
  builtin?: boolean;
}

/** 作用域读取（兼容旧单字段）：空=全局可见 */
export function scopesOf(x: { scopePresets?: string[]; scopePresetName?: string }): string[] {
  if (x.scopePresets?.length) return x.scopePresets;
  return x.scopePresetName ? [x.scopePresetName] : [];
}
/** 当前预设是否可见该资产（空作用域=全局） */
export function inScope(x: { scopePresets?: string[]; scopePresetName?: string }, presetName: string): boolean {
  const s = scopesOf(x);
  return s.length === 0 || s.includes(presetName);
}
/** 合并作用域（并集·去空）——upsert 时**即使内容跳过也要合**，否则先前来源看不到它 */
function mergeScopes(cur: { scopePresets?: string[]; scopePresetName?: string } | undefined, next: { scopePresets?: string[]; scopePresetName?: string }): string[] {
  return [...new Set([...(cur ? scopesOf(cur) : []), ...scopesOf(next)])].filter(Boolean);
}

interface AgentSkillState {
  skills: AgentSkill[];
  subagents: SubAgentDef[];
  writerNotes: Record<string, string>;   // presetName → 主代理作者指令
  upsertSkill: (s: AgentSkill) => 'added' | 'updated' | 'skipped';
  upsertSubagent: (d: SubAgentDef) => 'added' | 'updated' | 'skipped';
  /** 只把某预设加进已有资产的作用域（内容不动）；返回是否真的新增了作用域 */
  addScope: (kind: 'skill' | 'subagent', key: string, presetName: string) => boolean;
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
      // ⚠ 「内容跳过」≠「作用域跳过」：同一份资产可能先被玩家手动导入、后随内置预设再来一次。
      //   旧实现整体 return 'skipped'，作用域就永远停在**首次**导入的预设名上 → 换个预设选中就看不见
      //   （Discord 实报：破晓选中后 2 个技能包 + 4 个子代理集体隐身）。故：内容可跳过，作用域必须并集。
      upsertSkill: (s) => {
        const cur = get().skills.find((x) => x.name === s.name);
        const scopePresets = mergeScopes(cur, s);
        const contentSkipped = !!cur && ((!!cur.sourceSha && cur.sourceSha === s.sourceSha) || (!cur.builtin && !!s.builtin));
        if (contentSkipped) {
          if (scopePresets.length !== scopesOf(cur!).length) {   // 仅作用域有新增 → 原地补
            set((st) => ({ skills: st.skills.map((x) => x.name === s.name ? { ...x, scopePresets, scopePresetName: undefined } : x) }));
            return 'updated';
          }
          return 'skipped';
        }
        set((st) => ({ skills: [...st.skills.filter((x) => x.name !== s.name), { ...s, scopePresets, scopePresetName: undefined }] }));
        return cur ? 'updated' : 'added';
      },
      upsertSubagent: (d) => {
        const cur = get().subagents.find((x) => x.id === d.id);
        const scopePresets = mergeScopes(cur, d);
        if (cur && !cur.builtin && d.builtin) {                   // 玩家版优先：内容不覆盖，但作用域照并
          if (scopePresets.length !== scopesOf(cur).length) {
            set((st) => ({ subagents: st.subagents.map((x) => x.id === d.id ? { ...x, scopePresets, scopePresetName: undefined } : x) }));
            return 'updated';
          }
          return 'skipped';
        }
        const keep = cur ? { enabled: cur.enabled } : {};        // 玩家开关状态在更新时保留
        set((st) => ({ subagents: [...st.subagents.filter((x) => x.id !== d.id), { ...d, ...keep, scopePresets, scopePresetName: undefined }] }));
        return cur ? 'updated' : 'added';
      },
      // 只补作用域、不碰内容：给「同 sha 已入库、连解包都省了」的早退路径用（否则作用域永远停在首次来源）
      addScope: (kind, key, presetName) => {
        if (!presetName) return false;
        const list = kind === 'skill' ? get().skills : get().subagents;
        const cur = (list as Array<{ name?: string; id?: string; scopePresets?: string[]; scopePresetName?: string }>)
          .find((x) => (kind === 'skill' ? x.name : x.id) === key);
        if (!cur || scopesOf(cur).includes(presetName)) return false;
        const scopePresets = mergeScopes(cur, { scopePresets: [presetName] });
        if (kind === 'skill') set((st) => ({ skills: st.skills.map((x) => x.name === key ? { ...x, scopePresets, scopePresetName: undefined } : x) }));
        else set((st) => ({ subagents: st.subagents.map((x) => x.id === key ? { ...x, scopePresets, scopePresetName: undefined } : x) }));
        return true;
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
  const inScopeList = useAgentSkills.getState().skills.filter((s) => inScope(s, presetName));
  if (!filter) return inScopeList;
  const deny = new Set(filter.deny ?? []);
  const vis = filter.visible ?? ['*'];
  const all = vis.includes('*');
  return inScopeList.filter((s) => !deny.has(s.name) && (all || vis.includes(s.name)));
}
