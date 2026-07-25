// 宠物/召唤物 判定谓词（纯函数·可单测）。
// 宠物/召唤物 与 NPC 共用 NpcRecord 数据模型，仅靠 npcTag 区分——本谓词是"从 NPC 演化里分流出去"的唯一判据。
import type { NpcRecord } from '../store/npcStore';

/** 该记录是否属于「宠物 / 召唤物」——走独立的宠物演化阶段，而非 NPC 演化 / 轨道A 自治。 */
export function isPetLike(n: Pick<NpcRecord, 'npcTag'>): boolean {
  return n.npcTag === '宠物' || n.npcTag === '召唤物';
}

/** 随行伙伴标签（随从/宠物/召唤物）——跟着主角走、离场也随行的一类。
    随行物品清单/编号表注入等处统一走本谓词，别再散写 npcTag==='随从'||'宠物'（历史坑：漏掉召唤物）。 */
export function isCompanionTag(n: Pick<NpcRecord, 'npcTag'>): boolean {
  return n.npcTag === '随从' || isPetLike(n);
}

/** 随从/宠物/召唤物的主人编号：缺省视作主角 B1（本作的宠物默认由主角豢养；NPC 的宠物须显式登记 ownerId）。 */
export function ownerOf(n: Pick<NpcRecord, 'ownerId'>): string {
  return n.ownerId || 'B1';
}
