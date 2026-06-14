import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GameVariable {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'string';
  value: number | boolean | string;
  min?: number;
  max?: number;
  showInStatusBar: boolean;
  desc?: string;
}

interface VariableState {
  variables: GameVariable[];
  setVariable: (key: string, value: GameVariable['value']) => void;
  upsertDefinition: (v: GameVariable) => void;
  removeVariable: (key: string) => void;
  resetAll: () => void;
}

function clampValue(def: GameVariable, value: GameVariable['value']): GameVariable['value'] {
  if (def.type !== 'number' || typeof value !== 'number') return value;
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}

export const useVariables = create<VariableState>()(
  persist(
    (set) => ({
      variables: [],

      setVariable: (key, value) =>
        set((s) => ({
          variables: s.variables.map((v) =>
            v.key !== key ? v : { ...v, value: clampValue(v, value) }
          ),
        })),

      upsertDefinition: (def) =>
        set((s) => {
          const exists = s.variables.find((v) => v.key === def.key);
          if (exists) {
            return { variables: s.variables.map((v) => v.key === def.key ? def : v) };
          }
          return { variables: [...s.variables, def] };
        }),

      removeVariable: (key) =>
        set((s) => ({ variables: s.variables.filter((v) => v.key !== key) })),

      resetAll: () =>
        set((s) => ({
          variables: s.variables.map((v) => ({
            ...v,
            value: v.type === 'number' ? (v.min ?? 0) : v.type === 'boolean' ? false : '',
          })),
        })),
    }),
    { name: 'drpg-variables' }
  )
);
