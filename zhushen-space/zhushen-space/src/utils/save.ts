import type { Player } from '../types';

const KEY = 'zhushen-save-v1';

export interface SaveData {
  version: number;
  player: Player;
  enhanceLevels: Record<string, number>;
}

const VERSION = 1;

export function writeSave(player: Player, enhanceLevels: Record<string, number>) {
  const data: SaveData = { version: VERSION, player, enhanceLevels };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // localStorage 不可用时静默忽略（如隐私模式）
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== VERSION) return null; // 版本不匹配时可在此做迁移
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

// 导出为可复制的字符串（base64），方便玩家备份或跨设备转移。
export function encodeSave(data: SaveData): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function decodeSave(text: string): SaveData | null {
  try {
    const json = decodeURIComponent(escape(atob(text.trim())));
    const data = JSON.parse(json) as SaveData;
    if (typeof data.version !== 'number' || !data.player) return null;
    return data;
  } catch {
    return null;
  }
}
