import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  GuildRank, GuildPerk, GuildMember, WeeklyTasks, ChronicleEntry, GuildMe,
} from '../systems/guildProtocol';

/* ════════════════════════════════════════════
   家族 store（drpg-guild）—— **账号级·跨存档**（同 joyStore/monument 口径·不进 saveManager 快照）。
   - my：唯一持久化字段 = 家族摘要（id/名/徽记/我的军衔/等级/已解锁 perks）。
       供单机侧**离线也能**应用家族增益 buff（guildPerkValue）+ 注入正文（buildGuildInjection）。
   - live 态（roster/chest/weekTasks/chronicle/applicants/base/status/online）由 systems/guildClient.ts
       在连 GuildDO 收到 WS 事件时填；断开即 resetLive，不持久化。
   - 见 指导/家族系统-设计.md。
════════════════════════════════════════════ */

export type { GuildRank };
export type GuildMpStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

/** 家族摘要（持久化）。 */
export interface GuildSummary {
  id: string;
  name: string;
  tag: string;
  emblem?: string;
  role: GuildRank;
  level: number;
  perks: GuildPerk[];
  joinedAt: number;
}

interface GuildState {
  my: GuildSummary | null;      // ← 唯一持久化字段（账号级）

  // ── live 态·连 GuildDO 时填·不持久化 ──
  status: GuildMpStatus;
  me: GuildMe | null;
  online: number;
  exp: number;                  // 家族当前总 exp（进度条用·live）
  error: string | null;
  roster: GuildMember[];
  chest: any[];
  weekTasks: WeeklyTasks | null;
  chronicle: ChronicleEntry[];
  applicants: { pid: string; name: string; at: number }[];
  base: any;
  chain: { count: number; lastAt: number; best: number } | null;

  setMy: (s: GuildSummary | null) => void;
  _set: (p: Partial<GuildState>) => void;
  resetLive: () => void;
}

const LIVE_INIT = {
  status: 'idle' as GuildMpStatus,
  me: null as GuildMe | null,
  online: 0,
  exp: 0,
  error: null as string | null,
  roster: [] as GuildMember[],
  chest: [] as any[],
  weekTasks: null as WeeklyTasks | null,
  chronicle: [] as ChronicleEntry[],
  applicants: [] as { pid: string; name: string; at: number }[],
  base: null as any,
  chain: null as { count: number; lastAt: number; best: number } | null,
};

export const useGuild = create<GuildState>()(
  persist(
    (set): GuildState => ({
      my: null,
      ...LIVE_INIT,
      setMy: (s) => set({ my: s }),
      _set: (p) => set(p),
      resetLive: () => set({ ...LIVE_INIT }),
    }),
    {
      name: 'drpg-guild',
      partialize: (s: any) => ({ my: s.my }),   // 只持久化家族摘要（跨存档·账号级）
      merge: (persisted: any, current) => ({ ...current, my: persisted?.my ?? null }),
    },
  ),
);

/** 取某个已解锁家族增益的数值（没有则 0）。供结算/正文注入按 key 读，如 guildPerkValue('expBoost')。 */
export function guildPerkValue(key: string): number {
  const my = useGuild.getState().my;
  if (!my || !Array.isArray(my.perks)) return 0;
  const p = my.perks.find((x) => x.key === key);
  return p ? (Number(p.value) || 0) : 0;
}
