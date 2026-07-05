import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCharacters, type Skill, type Talent } from './characterStore';

/* ════════════════════════════════════════════
   体系 / 流派（技能·天赋「装备栏 / loadout」）——主角 B1 专属
   ────────────────────────────────────────────
   模型：物理「替补席」。不在出战的技能真的从 characters['B1'] 挪进 bench，
   出战区 = characters['B1'].skills/traits（战斗·骰子·AI注入 全部只读这里，无需改任何消费方）。
   不变量：全部技能 = 出战区 ∪ 替补席（按名去重）。apply=分区、unapply=替补全回流，零丢失。
   - builds[]：保存的模板（含整份技能/天赋快照 → 可上传工坊 / 删了原技能也不丢）；像技能树定义一样跨新游戏保留。
   - bench + activeBuildId：进度域，随存档快照、随回退回滚、新游戏清空（clearBench）。
   持久化 key `drpg-loadout` 已在 saveManager.STORES 注册（clear 只清 bench、保留 builds）。
════════════════════════════════════════════ */

const B1 = 'B1';
/* 名称归一化匹配（与 characterStore.nameEq 同口径：去空白/标点/大小写）。characterStore 未导出，故本地复刻。 */
const norm = (s?: string) => (s ?? '').replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g, '').trim().toLowerCase();
const eq = (a?: string, b?: string) => { const x = norm(a), y = norm(b); return !!x && x === y; };

export interface Loadout {
  id: string;
  name: string;
  desc?: string;
  skills: Skill[];      // ★整份快照——才能上传工坊 / 删了原技能也不丢
  traits: Talent[];
  author?: string;
  version?: string;
  contentHash?: string;
  createdAt?: number;
}

interface LoadoutState {
  builds: Loadout[];
  activeBuildId: string | null;
  bench: { skills: Skill[]; traits: Talent[] };   // 从 B1 挪出来的收纳区

  addBuild: (b: Omit<Loadout, 'id'> & { id?: string }) => string;   // 工坊 install / 手动新建（只入库，不自动 apply）
  updateBuild: (id: string, patch: Partial<Loadout>) => void;
  removeBuild: (id: string) => void;
  saveBuildFromNames: (name: string, skillNames: string[], talentNames: string[], desc?: string) => string;  // 从「出战∪替补」勾选打包成模板

  applyBuild: (id: string) => void;         // 按模板分区
  unapplyBuild: () => void;                 // 卸载 = 替补全回流

  benchSkill: (name: string) => void;       // 出战 → 替补
  activateSkill: (name: string) => void;    // 替补 → 出战
  benchTalent: (name: string) => void;
  activateTalent: (name: string) => void;
  deleteEverywhere: (kind: 'skill' | 'talent', name: string) => void;  // 选择性永久删（出战/替补都删）

  clearBench: () => void;                   // 新游戏用（保留 builds）
}

const cs = () => useCharacters.getState();
const b1 = () => cs().characters[B1] ?? { id: B1, skills: [] as Skill[], traits: [] as Talent[] };
/* 整体替换 B1 的 skills/traits（一次写入，绕开 addSkill 的 upsert 合并，保证分区干净）。
   照 saveManager.extractPlayerFromSlot 的直接 setState 口径。 */
const writeB1 = (skills: Skill[], traits: Talent[]) => {
  const cur = b1();
  useCharacters.setState((s) => ({ characters: { ...s.characters, [B1]: { ...cur, id: B1, skills, traits } } }));
};
/* 按名去重合并两组（前者优先）*/
function unionByName<T extends { name?: string }>(a: T[], b: T[]): T[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => eq(y.name, x.name))) out.push(x);
  return out;
}

export const useLoadout = create<LoadoutState>()(
  persist(
    (set, get) => ({
      builds: [],
      activeBuildId: null,
      bench: { skills: [], traits: [] },

      addBuild: (b) => {
        const id = b.id ?? `bd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        set((s) => ({
          builds: [
            ...s.builds.filter((x) => x.id !== id),
            { ...b, id, skills: b.skills ?? [], traits: b.traits ?? [], createdAt: b.createdAt ?? Date.now() },
          ],
        }));
        return id;
      },

      updateBuild: (id, patch) =>
        set((s) => ({ builds: s.builds.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      removeBuild: (id) =>
        set((s) => ({
          builds: s.builds.filter((x) => x.id !== id),
          activeBuildId: s.activeBuildId === id ? null : s.activeBuildId,
        })),

      saveBuildFromNames: (name, skillNames, talentNames, desc) => {
        // 从「当前出战 ∪ 替补」里按名抓完整对象存进模板快照
        const poolS = unionByName(b1().skills, get().bench.skills);
        const poolT = unionByName(b1().traits, get().bench.traits);
        const skills = skillNames.map((n) => poolS.find((s) => eq(s.name, n))).filter(Boolean) as Skill[];
        const traits = talentNames.map((n) => poolT.find((t) => eq(t.name, n))).filter(Boolean) as Talent[];
        return get().addBuild({ name: name.trim() || '未命名体系', desc, skills, traits, version: '1.0.0' });
      },

      applyBuild: (id) => {
        const build = get().builds.find((x) => x.id === id);
        if (!build) return;
        const cur = b1();
        const { bench } = get();
        // 全部技能池 = 当前出战 ∪ 当前替补（出战优先）
        const poolS = unionByName(cur.skills, bench.skills);
        const poolT = unionByName(cur.traits, bench.traits);
        const isWantS = (n?: string) => build.skills.some((w) => eq(w.name, n));
        const isWantT = (n?: string) => build.traits.some((w) => eq(w.name, n));
        const actS = poolS.filter((s) => isWantS(s.name));
        const benS = poolS.filter((s) => !isWantS(s.name));
        const actT = poolT.filter((t) => isWantT(t.name));
        const benT = poolT.filter((t) => !isWantT(t.name));
        // 模板里我没有的（下载来的）→ 注入出战区
        for (const s of build.skills) if (!poolS.some((x) => eq(x.name, s.name))) actS.push(s);
        for (const t of build.traits) if (!poolT.some((x) => eq(x.name, t.name))) actT.push(t);
        writeB1(actS, actT);
        set({ bench: { skills: benS, traits: benT }, activeBuildId: id });
        try { cs().dedupeIds?.(); } catch { /* 注入可能撞历史技能 id，去重一次 */ }
      },

      unapplyBuild: () => {
        const cur = b1();
        const { bench } = get();
        writeB1(unionByName(cur.skills, bench.skills), unionByName(cur.traits, bench.traits));
        set({ bench: { skills: [], traits: [] }, activeBuildId: null });
        try { cs().dedupeIds?.(); } catch { /* */ }
      },

      benchSkill: (name) => {
        const sk = b1().skills.find((x) => eq(x.name, name));
        if (!sk) return;
        cs().removeSkill(B1, sk.id);
        set((s) => ({ bench: { ...s.bench, skills: s.bench.skills.some((x) => eq(x.name, name)) ? s.bench.skills : [...s.bench.skills, sk] } }));
      },
      activateSkill: (name) => {
        const sk = get().bench.skills.find((x) => eq(x.name, name));
        if (!sk) return;
        set((s) => ({ bench: { ...s.bench, skills: s.bench.skills.filter((x) => !eq(x.name, name)) } }));
        cs().addSkill(B1, sk);   // 整份对象回 B1（effect/numeric/tags/层级… 全保留）
        // addSkill 会把 addedAt 重置为 now → 回填原「习得时间」，保证进替补再上场信息零变化（含时间戳）
        if (sk.addedAt) { const added = b1().skills.find((x) => eq(x.name, sk.name)); if (added) cs().updateSkill(B1, added.id, { addedAt: sk.addedAt }); }
      },
      benchTalent: (name) => {
        const tr = b1().traits.find((x) => eq(x.name, name));
        if (!tr) return;
        cs().removeTrait(B1, tr.name);
        set((s) => ({ bench: { ...s.bench, traits: s.bench.traits.some((x) => eq(x.name, name)) ? s.bench.traits : [...s.bench.traits, tr] } }));
      },
      activateTalent: (name) => {
        const tr = get().bench.traits.find((x) => eq(x.name, name));
        if (!tr) return;
        set((s) => ({ bench: { ...s.bench, traits: s.bench.traits.filter((x) => !eq(x.name, name)) } }));
        cs().addTrait(B1, tr);   // 整份对象回 B1（effect/numeric/attrBonus… 全保留）
        if (tr.addedAt) cs().updateTrait(B1, tr.name, { addedAt: tr.addedAt });   // 回填原习得时间（addTrait 会重置为 now）
      },

      deleteEverywhere: (kind, name) => {
        if (kind === 'skill') {
          cs().removeSkill(B1, name);
          set((s) => ({ bench: { ...s.bench, skills: s.bench.skills.filter((x) => !eq(x.name, name)) } }));
        } else {
          cs().removeTrait(B1, name);
          set((s) => ({ bench: { ...s.bench, traits: s.bench.traits.filter((x) => !eq(x.name, name)) } }));
        }
      },

      clearBench: () => set({ bench: { skills: [], traits: [] }, activeBuildId: null }),
    }),
    {
      name: 'drpg-loadout',
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted ?? {}),
        builds: persisted?.builds ?? [],
        activeBuildId: persisted?.activeBuildId ?? null,
        bench: {
          skills: persisted?.bench?.skills ?? [],
          traits: persisted?.bench?.traits ?? [],
        },
      }),
    },
  ),
);
