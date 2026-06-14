import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';

/* ════════════════════════════════════════════
   生平压缩 / 记忆整理设置（drpg-memory）
   - 工作记忆存在 characterStore 的 CharacterData.memory
   - 本 store 只存触发阈值、范围与压缩提示词
════════════════════════════════════════════ */

export const DEFAULT_MEMORY_PROMPT = `你是轮回乐园的档案官兼记忆整理者，需要批量整理角色的生平与记忆。

文风与情感保留规则：
- 生平和记忆整理必须直白、生活化，基调积极轻快；像角色真实经历过、后来能想起来的事，不要写成公文通报、关系总结或主题升华。
- 保留角色情感细节、互动细节和能体现性格的小动作，例如停顿、递水、轻声提醒、拌嘴、收拾装备；但只保留对后续判断有用的内容。
- 禁止写极端情绪、夸张反应、比喻、象征化升华、支配欲、占有欲或掌控欲；涉及亲近、担忧、照拂、敌意时，只写可见行动和克制想法。

优先任务：
1. 压缩过长的生平事迹，保留关键转折、重大事件、长期影响。
2. 当短期/长期记忆达到阈值时，重写整个 shortTerm / longTerm 数组，执行合并、删除、提炼、迁移。
3. 记忆触发与目标：shortTerm 达到 25 条后压缩到不超过 5 条；longTerm 达到 50 条后压缩到不超过 20 条。
4. 记忆整理后应更紧凑；允许丢弃过时或不重要的信息，不要求把所有旧条目无损压缩进去，但不能丢失仍会影响角色判断的关键认知。
5. 已经沉淀或整合进 longTerm 的内容，必须从 shortTerm 移除；shortTerm 只保留仍有临场指导意义、尚未沉淀的近期信息。
6. 不可逆事实压缩自检：合并记忆时必须区分“提出/尝试/递出/展示/等待回应”与“已接受/已完成/已生效”。交付、契约、绑定、夺取、消耗、炼制、击杀、封印、身份归属等结果，只有存在明确完成证据才可写成既成事实；否则保留为未决、待回应或误读。
7. 若多条记忆冲突，优先采用时间更晚且正文明确的拒绝、退回、收回、未接收、失败或完成结果；不要把早期待处理信息压缩成长期既成事实。
8. 记忆 time 必须是游戏内时间锚点，禁止只写“当前、现在、刚才、方才、刚刚、近日、最近、此前、先前、昨日、今日、昨夜、当时”等相对时间词。
9. 合并多个不同时间的记忆时，不要伪造精确日时；改用更粗粒度但仍有锚点的时间，例如“第3日”“第一周”“第3日-第5日”或“开局前后”。
10. 每个目标载荷含 currentTime/currentLocation；若旧记忆写了相对时间，必须结合 currentTime 换算，无法精确换算则降级为带回合/天数/阶段范围的模糊时间。

【目标角色载荷】
\${characters_payload}

【输出格式】
只输出一个 JSON 对象，禁止输出多余文字、禁止用 \`\`\`json 包裹：
{
  "thinking": "简述每个角色的压缩取舍",
  "results": {
    "<角色ID>": {
      "shortTerm": [{"time":"游戏内时间","location":"地点","content":"记忆内容"}],
      "longTerm":  [{"time":"游戏内时间","location":"地点","content":"记忆内容"}],
      "bio": "可选：整理后的生平/背景；不更新则省略此字段"
    }
  }
}
- results 的 key 必须是载荷中给出的角色ID；shortTerm 不超过 5 条，longTerm 不超过 20 条。
- 只输出需要重写的角色；无需变更的角色不要出现在 results 中。`;

export interface MemorySettings {
  enabled: boolean;
  scope: 'both' | 'player' | 'npc';
  shortTermThreshold: number;  // shortTerm 达到该条数触发压缩
  shortTermKeep: number;       // 压缩后保留上限
  longTermThreshold: number;   // longTerm 达到该条数触发压缩
  longTermKeep: number;        // 压缩后保留上限
  prompt: string;
}

interface MemoryState {
  settings: MemorySettings;
  setSettings: (patch: Partial<MemorySettings>) => void;
  resetPrompt: () => void;

  memoryApi: ApiConfig;
  memoryUseSharedApi: boolean;
  memoryAvailableModels: string[];
  memoryModelsLoading: boolean;
  memoryModelsError: string;
  setMemoryApi: (patch: Partial<ApiConfig>) => void;
  setMemoryUseSharedApi: (v: boolean) => void;
  fetchMemoryModels: () => Promise<void>;
}

const DEFAULT_SETTINGS: MemorySettings = {
  enabled: false,
  scope: 'both',
  shortTermThreshold: 25,
  shortTermKeep: 5,
  longTermThreshold: 50,
  longTermKeep: 20,
  prompt: DEFAULT_MEMORY_PROMPT,
};

export const useMemory = create<MemoryState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetPrompt: () => set((s) => ({ settings: { ...s.settings, prompt: DEFAULT_MEMORY_PROMPT } })),

      memoryApi: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        modelId: 'gpt-4o',
        temperature: 0.6,
        maxTokens: 4096,
        topP: 1,
      },
      memoryUseSharedApi: true,
      memoryAvailableModels: [],
      memoryModelsLoading: false,
      memoryModelsError: '',

      setMemoryApi: (patch) => set((s) => ({ memoryApi: { ...s.memoryApi, ...patch } })),
      setMemoryUseSharedApi: (v) => set({ memoryUseSharedApi: v }),

      fetchMemoryModels: async () => {
        const s = useMemory.getState();
        let api: ApiConfig;
        if (s.memoryUseSharedApi) {
          const ss = useSettings.getState();
          api = ss.textUseSharedApi ? ss.api : ss.textApi;
        } else {
          api = s.memoryApi;
        }
        if (!api.baseUrl || !api.apiKey) {
          set({ memoryModelsError: '请先填写 API 地址和 Key' });
          return;
        }
        set({ memoryModelsLoading: true, memoryModelsError: '' });
        try {
          const res = await fetch(api.baseUrl.replace(/\/$/, '') + '/models', {
            headers: { Authorization: `Bearer ${api.apiKey}` },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const models = (json.data ?? json.models ?? [])
            .map((m: any) => m.id ?? m.name ?? '')
            .filter(Boolean)
            .sort();
          set({ memoryAvailableModels: models, memoryModelsLoading: false });
        } catch (e: any) {
          set({ memoryModelsError: e.message ?? '请求失败', memoryModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-memory',
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}) },
        memoryApi: { ...current.memoryApi, ...(persisted?.memoryApi ?? {}) },
        memoryUseSharedApi: persisted?.memoryUseSharedApi ?? current.memoryUseSharedApi,
        memoryAvailableModels: [],
        memoryModelsLoading: false,
        memoryModelsError: '',
      }),
    },
  ),
);
