// 宠物/召唤物 判定谓词（纯函数·可单测）。
// 宠物/召唤物 与 NPC 共用 NpcRecord 数据模型，仅靠 npcTag 区分——本谓词是"从 NPC 演化里分流出去"的唯一判据。
import type { NpcRecord } from '../store/npcStore';

/** 该记录是否属于「宠物 / 召唤物」——走独立的宠物演化阶段，而非 NPC 演化 / 轨道A 自治。 */
export function isPetLike(n: Pick<NpcRecord, 'npcTag'>): boolean {
  return n.npcTag === '宠物' || n.npcTag === '召唤物';
}
