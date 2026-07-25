/* 技能「品级 / 等级」归一化 —— 独立小模块，**刻意不 import 任何东西**。
   stateParser（写入边界）和 skillUpgrade（升级回写）都要用它，而 skillUpgrade 已经
   import 了 stateParser 的 lenientJsonParse ——常量与工具放这边才不会绕出循环依赖
   （同 dispatchPrompts.ts / abyssPrompts.ts 的处理）。 */

// 技能品级 7 档 / 天赋评级 D~SSS（与世界书一致）
export const SKILL_RARITIES = ['普通', '精良', '稀有', '史诗', '传说', '奥义', '极境'];
export const TALENT_RARITIES = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

const SEP = '·・･•\\s|/,，、';   // level 串里常见的分隔符

/* AI 写 addSkill 时常把品级塞进 level（`{level:"传说·Lv.1"}`）。两个后果：
   ① 面板渲染的是 `{rarity}·{level}` → 显示成「传说·传说·Lv.1」，品级出现两次；
   ② 黄金质变把 rarity 升到「奥义」之后，level 里那个「传说」原地不动 → 越用越对不上；
      而 withLevelNum 的语义是「保留前缀、只换数字」，会把这个陈旧前缀一路带下去。
   所以在写入边界就把品级从 level 里剥出来；rarity 没给的话正好用它补上，信息不丢。

   ⚠ 只处理**技能**：天赋的 level 写成「SSS·觉醒」是 skillUpgrade 有意为之（黄金质变分支），
     跟着一起剥会把人家的设计剥掉。 */
export function normalizeSkillLevel(
  level: unknown,
  rarity: unknown,
): { level: string; rarity: string | undefined } {
  const raw = String(level ?? '').trim();
  const rar = String(rarity ?? '').trim();
  if (!raw) return { level: '', rarity: rar || undefined };

  for (const w of SKILL_RARITIES) {
    // 只认「整段」：串首或分隔符之后 + 品级词 + 可选的「级」 + 分隔符或串尾。
    // 加这层边界是为了别误伤名字/前缀里恰好含品级字的串（如「传说之刃·Lv.3」的「传说之刃」）。
    const re = new RegExp(`(^|[${SEP}])${w}级?(?=$|[${SEP}])`);
    if (!re.test(raw)) continue;
    const cleaned = raw.replace(re, '$1').replace(new RegExp(`^[${SEP}]+|[${SEP}]+$`, 'g'), '').trim();
    return { level: cleaned, rarity: rar || w };   // rarity 缺失 → 用剥出来的这个补上
  }
  return { level: raw, rarity: rar || undefined };
}
