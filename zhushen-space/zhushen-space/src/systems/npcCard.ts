// 把一名 NPC 序列化成「完整面板快照」——供 聊天室分享 / 助战 NPC 卡 共用，
// 让只读详情页（components/NpcCardDetail.tsx）能展示"和平时 NpcDetail 一样的大面板"（六维/技能/天赋/称号/副职业/装备/储存/经历…）。
// 自包含（不连 store，可上传/广播给他端渲染）。avatar 为原始串，调用方按需压缩/剥离。
import { useNpc } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import type { AssistSnapshot } from './assistProtocol';

// 剥掉物品大图（NPC 持有物的 image 字段），其余字段全留（让装备/储存详情显示完整）。
function stripItem(it: any) { const { image, ...rest } = it || {}; return rest; }

/** 从一名本地 NPC 构建完整面板快照。失败/无名返回 null。 */
export function buildNpcCardSnapshot(npcId: string): AssistSnapshot | null {
  const r = useNpc.getState().npcs[npcId];
  if (!r || !r.name) return null;
  const cd = useCharacters.getState().characters[npcId];
  const a: any = r.attrs || {};
  const hasAttrs = a && typeof a === 'object' && Object.keys(a).length > 0;
  const tier = (r.realm || '').split('|')[0] || '';
  const role = (r.realm || '').split('|').slice(1).join('|').trim();
  const head = [tier, r.profession].filter(Boolean).join('·');
  const stat = hasAttrs ? `力${a.str ?? '?'} 敏${a.agi ?? '?'} 体${a.con ?? '?'} 智${a.int ?? '?'} 魅${a.cha ?? '?'} 幸${a.luck ?? '?'}` : '';
  const equipment = (r.items || []).filter((it) => it.equipped).map(stripItem);
  const items = (r.items || []).filter((it) => !it.equipped).map(stripItem);
  return {
    name: r.name,
    tier,
    realm: r.realm || '',
    identity: role,
    profession: r.profession || '',
    npcTag: r.npcTag || '',
    gender: r.gender || '',
    personality: r.personality || '',
    personalityDetail: r.innerThought || '',
    appearance: r.appearanceDetail || r.appearance5 || '',
    title: r.title || '',
    bioStrength: r.bioStrength || '',
    age: r.age || '',
    contractorId: r.contractorId || '',
    affiliatedTeam: r.affiliatedTeam || '',
    background: r.background || '',
    status: r.status || '',
    review: r.review || '',
    attrs: hasAttrs ? { ...a } : undefined,
    realAttrs: r.realAttrs && Object.keys(r.realAttrs).length ? { ...(r.realAttrs as any) } : undefined,
    maxHp: r.maxHp,
    maxEp: r.maxMp,
    line: [head, stat].filter(Boolean).join(' '),
    skills: cd?.skills || [],
    traits: cd?.traits || [],
    titles: cd?.titles || [],
    subProfessions: cd?.subProfessions || [],
    equipment,
    items,
    deeds: (r.deedLog || []).slice(-50) as any[],   // 经历封顶最近 50 条，防超大档把助战卡顶破 200KB 上限被拒
    avatar: r.avatar || '',
  };
}
