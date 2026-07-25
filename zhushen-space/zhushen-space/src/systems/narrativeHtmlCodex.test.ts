/* 正文关键词悬浮图鉴 · 渲染层接线（标注只落在散文文本上，绝不切坏标签/占位符/结算卡） */
import { describe, it, expect, beforeEach } from 'vitest';
import { toHtmlWithImages, toHtmlWithImagesCached } from './narrativeHtml';
import { resetCodexIndex } from './codexIndex';
import { useSettings } from '../store/settingsStore';
import { useNpc } from '../store/npcStore';
import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useFaction } from '../store/factionStore';
import { useCosmos } from '../store/cosmosStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';

const READING_ON = { fontSize: 17, letterSpacing: 0, lineHeight: 1.8, paraSpacing: 0.45, fontFamily: 'default', dialogueHl: true, innerDim: true, codexHl: true, codexWiki: false } as const;

function setup(codexHl = true) {
  useNpc.setState({ npcs: { C1: { id: 'C1', name: '苏晓', realm: '绝强·Lv.95' } } } as any);
  useItems.setState({ items: [] } as any);
  useCharacters.setState({ characters: {} } as any);
  useFaction.setState({ factions: {} } as any);
  useCosmos.setState({ entities: [] } as any);
  useTerritory.setState({ unlocked: false, name: '', buildings: [], effects: [] } as any);
  useTeam.setState({ perks: [] } as any);
  useSettings.setState({ reading: { ...READING_ON, codexHl } } as any);
  resetCodexIndex();
}

describe('正文实体标注', () => {
  beforeEach(() => setup(true));

  it('散文里的 NPC 名套上 .zs-ent，data-ek 带类型短码', () => {
    const html = toHtmlWithImages('苏晓推开了门。');
    expect(html).toContain('<span class="zs-ent" data-ek="n:C1">苏晓</span>');
  });

  it('阶位这类常驻词条也标（新玩家最需要）', () => {
    expect(toHtmlWithImages('他早已是绝强。')).toContain('data-ek="r:绝强"');
  });

  it('开关关掉 → 一个 span 都不吐（不是靠 CSS 藏，是压根不算）', () => {
    setup(false);
    const html = toHtmlWithImages('苏晓推开了门。');
    expect(html).not.toContain('zs-ent');
    expect(html).toContain('苏晓');
  });

  it('整条消息只标首次——正文里主角名出现二十次不会变成二十条下划线', () => {
    const html = toHtmlWithImages('苏晓走了。\n苏晓又回来了。\n苏晓真忙。');
    expect(html.match(/zs-ent/g) ?? []).toHaveLength(1);
  });

  it('不插进对话高亮 span 的标签里，且与 narr-dialogue 正确嵌套', () => {
    const html = toHtmlWithImages('「苏晓来了」他说。');
    expect(html).toContain('<span class="narr-dialogue">');
    expect(html).toContain('<span class="zs-ent" data-ek="n:C1">苏晓</span>');
    expect(html).not.toMatch(/<span class="narr-<span/);        // 标签名没被切开
  });

  it('小喇叭占位符不被切断，且 data-line 里不混进 span（图标是标注之后才注入的）', () => {
    const html = toHtmlWithImages('「苏晓来了」', undefined, { speakable: true, npcNames: ['苏晓'] });
    expect(html).toContain('class="dialogue-play"');
    expect(html).toContain('data-line="苏晓来了"');            // 原样，无 span 污染
    expect(html).not.toContain('@@ZSDLG');                      // 占位符已被完整替换掉
  });

  it('配图占位符完整存活', () => {
    const img = { anchor: '推开了门', url: 'blob:x', prompt: '', nsfw: '', ts: 1 };
    const html = toHtmlWithImages('苏晓推开了门。', [img]);
    expect(html).toContain('class="story-illust"');
    expect(html).not.toContain('@@ZSIMG');
    expect(html).toContain('data-ek="n:C1"');
  });

  it('结算块（琥珀格子）里不标——那是数值面板，不该长下划线', () => {
    const html = toHtmlWithImages('> 【动作日志】苏晓出手了');
    expect(html).toContain('border-amber-700/40');
    expect(html).not.toContain('zs-ent');
  });

  it('HTML 透传行（ST 正则输出的卡片）原样透传，不被标注改写', () => {
    const raw = '<div class="x" title="苏晓">苏晓</div>';
    const html = toHtmlWithImages(raw);
    expect(html).toContain('title="苏晓"');                     // 属性里的名字没被塞 span
    expect(html).toContain(raw);
  });

  it('转义实体不被切开（&amp; 整体透传）', () => {
    const html = toHtmlWithImages('A & B，苏晓在场。');
    expect(html).toContain('&amp;');
    expect(html).toContain('data-ek="n:C1"');
  });
});

describe('渲染缓存签名 · 词典变了旧楼层不会停在旧标注', () => {
  beforeEach(() => setup(true));

  it('实体新增后同一楼层重渲会重新标（签名带 codex 版本）', () => {
    const before = toHtmlWithImagesCached(1, '苏晓与莫甘娜同行。');
    expect(before).toContain('data-ek="n:C1"');
    expect(before).not.toContain('莫甘娜</span>');

    useNpc.setState({ npcs: {
      C1: { id: 'C1', name: '苏晓', realm: '绝强·Lv.95' },
      C2: { id: 'C2', name: '莫甘娜', realm: '九阶·Lv.85' },
    } } as any);

    const after = toHtmlWithImagesCached(1, '苏晓与莫甘娜同行。');
    expect(after).toContain('data-ek="n:C2"');
  });

  it('开关翻转后同一楼层重渲会清掉标注', () => {
    expect(toHtmlWithImagesCached(2, '苏晓推门。')).toContain('zs-ent');
    useSettings.setState({ reading: { ...READING_ON, codexHl: false } } as any);
    expect(toHtmlWithImagesCached(2, '苏晓推门。')).not.toContain('zs-ent');
  });

  it('什么都没变时命中缓存，返回同一个字符串实例', () => {
    const a = toHtmlWithImagesCached(3, '苏晓推门。');
    const b = toHtmlWithImagesCached(3, '苏晓推门。');
    expect(b).toBe(a);
  });
});

describe('data-ek 转义 · 名字里的引号不能从属性里逃逸', () => {
  beforeEach(() => setup(true));

  /* key 由「角色 id + 实体名」拼成，名字是 AI 写的、可能带引号。
     注：& < > 在正文里已被 escapeHtml 转义，含这些字符的名字根本匹配不到；
     唯一能原样进属性的危险字符就是双引号，故专测它。 */
  it('技能名带双引号时 key 被转义，属性没被提前闭合', () => {
    useCharacters.setState({ characters: { B1: {
      id: 'B1', skills: [{ name: '恶魔之刃"', rarity: '天级' }], traits: [],   // 无 id → key 回退成「角色id-名字」，名字里的引号直接进 key
    } } } as any);
    resetCodexIndex();
    const html = toHtmlWithImages('他握着恶魔之刃"往前走。');       // 只有一个引号 → 不会被对话高亮吃掉
    expect(html).toContain('data-ek="k:B1-恶魔之刃&quot;"');
    expect(html).not.toContain('恶魔之刃""');                       // 未转义时会长这样（属性被提前闭合）
    expect(html).not.toMatch(/data-ek="[^"]*"[^>]*=/);              // 属性里没能再插出第二个属性
  });
});
