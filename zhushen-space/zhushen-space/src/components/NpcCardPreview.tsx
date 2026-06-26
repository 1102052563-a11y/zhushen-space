import { useEffect, useMemo, type ReactNode } from 'react';
import NpcDetail from './NpcDetail';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';

/* 把一份「自包含 NPC 快照」（助战卡 / 聊天室分享 / systems/npcCard.ts buildNpcCardSnapshot）
   渲染成**和平时一模一样的 NpcDetail 大面板**，只读：
   - 记录不进 npcStore，靠 NpcDetail 的 `useNpc(s.npcs[id]) ?? npcProp` 回退用本地合成记录（零污染）；
   - 技能/天赋/称号/副职业注入 characterStore[PREVIEW_ID] 供对应栏目显示，关闭时清掉；
   - `preview` 让 NpcDetail 隐藏所有改 store / 调 API / 转移物品的控件（详见 NpcDetail.NpcPreviewContext）。 */

const PREVIEW_ID = '__cardpreview';

function snapshotToRecord(d: any): NpcRecord {
  const tier = d.tier || (d.realm ? String(d.realm).split('|')[0] : '');
  const identity = d.identity || (d.realm && String(d.realm).includes('|') ? String(d.realm).split('|').slice(1).join('|').trim() : '');
  const realm = d.realm || [tier, identity].filter(Boolean).join('|');
  const equip = (d.equipment || []).map((e: any, i: number) => ({
    ...e, id: e.id || `PE_${i}`, equipped: true,
    equipSlot: e.equipSlot || e.slot, category: e.category || e.slot || '装备',
    quantity: e.quantity || 1, name: e.name || '装备', gradeDesc: e.gradeDesc || '', effect: e.effect || '',
  }));
  const bag = (d.items || []).map((it: any, i: number) => ({
    ...it, id: it.id || `PB_${i}`, equipped: false, quantity: it.quantity || 1,
    name: it.name || '物品', category: it.category || '杂物', gradeDesc: it.gradeDesc || '', effect: it.effect || '',
  }));
  return {
    id: PREVIEW_ID,
    name: d.name || '（无名）',
    gender: d.gender === '男' || d.gender === '女' ? d.gender : '',
    realm,
    personality: d.personality || '',
    status: d.status || '一切正常',
    callPlayer: '',
    background: d.background || '',
    innerThought: d.personalityDetail || d.innerThought || '',
    relations: '',
    favor: 0,
    appearance5: '',
    motiveNow: '', shortGoal: '', longGoal: '',
    inCombat: false,
    appearanceDetail: d.appearance || d.appearanceDetail || '',
    title: d.title || '',
    hp: d.maxHp, maxHp: d.maxHp, mp: d.maxEp, maxMp: d.maxEp,
    profession: d.profession || '',
    bioStrength: d.bioStrength || '',
    age: d.age || '',
    contractorId: d.contractorId || '',
    affiliatedTeam: d.affiliatedTeam || '',
    npcTag: d.npcTag || '契约者',
    avatar: d.avatar || undefined,
    attrs: d.attrs || undefined,
    realAttrs: d.realAttrs || undefined,
    review: d.review || '',
    items: [...equip, ...bag],
    extra: {},
    onScene: false,
    deedLog: (d.deeds || d.deedLog || []) as any,
    updatedAt: Date.now(),
  } as NpcRecord;
}

export default function NpcCardPreview({ data, onClose, previewActions }: {
  data: any; onClose: () => void; previewActions?: ReactNode;
}) {
  const rec = useMemo(() => snapshotToRecord(data || {}), [data]);
  useEffect(() => {
    useCharacters.setState((s) => ({
      characters: {
        ...s.characters,
        [PREVIEW_ID]: {
          id: PREVIEW_ID,
          skills: (data?.skills || []) as any,
          traits: (data?.traits || []) as any,
          titles: (data?.titles || []) as any,
          subProfessions: (data?.subProfessions || []) as any,
        },
      },
    }));
    return () => {
      try { useCharacters.setState((s) => { const c = { ...s.characters }; delete c[PREVIEW_ID]; return { characters: c }; }); } catch { /* */ }
      try { if (useNpc.getState().npcs[PREVIEW_ID]) useNpc.getState().hardRemoveNpc(PREVIEW_ID); } catch { /* 清掉零星操作可能误建的临时记录 */ }
    };
  }, [data]);
  return <NpcDetail npc={rec} list={[rec]} preview previewActions={previewActions} onClose={onClose} onSelect={() => {}} />;
}
