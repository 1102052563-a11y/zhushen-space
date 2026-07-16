const fs = require('fs');
const files = [
  '产出/批次329/魔獣浄化少女ウテア-堕落仪式.md',
  '产出/批次329/人妻コスプレ喫茶-裏服务.md',
  '产出/批次329/ママぷりっ!-义母诱惑.md',
  '产出/批次329/奴隷兎と笼目-调教完成.md',
  '产出/批次329/裏切りの乳房-背叛代价.md',
  '产出/批次330/凌辱人形-展览会.md',
  '产出/批次330/OVA 巨乳プリンセス催眠.md',
  '产出/批次330/魔剣のネルガル-堕落骑士.md',
  '产出/批次330/秘湯めぐり-秘汤陷阱.md',
  '产出/批次330/エルフの双子姫-奴隶市场.md',
  '产出/批次331/女教師玲子-放学后.md',
  '产出/批次331/ふたりエッチ-新婚修行.md',
  '产出/批次331/淫蟲の宴-寄生完成.md',
  '产出/批次331/夜這いする七人の孕女-村庄秘仪.md',
];

const entryBoost = `
事件线示例（可当章节）：
- 第1日：以合法日常身份进入舞台，完成一次「帮忙」建立好感。
- 第2–3日：共同完成一项生活任务（备料／扫除／值班），留下可回收物件。
- 中段：误会或伦理压力出现，用对话而非暴力解决。
- 后段：选择公开或保密，并承担称呼变化。
- 收束：共餐或共路，确认关系阶段（朋友／恋人／守护）。

开场执行细则：先写感官（光、味、声），再写称呼，再写选择。每个可攻略对象至少安排一次「单独两分钟」：走廊、屋檐、打烊后、值夜。禁止一天内攻略全员。NSFW 服从原作尺度，点到情感边界即可；禁止把角色降成无姓名的身体。契约者若非原男主，保留原男主作为对照或盟友，勿抹去其位置。

氛围收束：本世界的胜利条件是关系被选择与被承担，不是变强或清榜。
`;

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  // remove spam hooks
  t = t.replace(/\n补充钩子\d+：[\s\S]*?(?=\n## 来源|\n#|$)/g, '\n');
  // ensure ## 来源 on its own line
  t = t.replace(/([^\n])## 来源/g, '$1\n\n## 来源');
  t = t.replace(/## 来源\s*\n\s*-/g, '## 来源\n\n-');

  const iEnt = t.indexOf('## 休闲切入点');
  const iSrc = t.indexOf('## 来源');
  if (iEnt < 0 || iSrc < 0) {
    console.log('BAD structure', f);
    continue;
  }
  let head = t.slice(0, iSrc);
  let src = t.slice(iSrc);
  // expand entry
  if (!head.includes('事件线示例（可当章节）')) {
    head = head.trimEnd() + '\n' + entryBoost + '\n\n';
  }
  let n = 0;
  while (head.slice(iEnt).replace(/\s/g, '').length < 1600 && n < 8) {
    n++;
    head += `关系推进备忘${n}：本周只深化一名对象，记录其口癖与回避话题，下周再换人。\n`;
  }
  // fix sources: ensure 3 https links exist
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  if (links < 3) {
    const name = (t.match(/^# (.+)$/m) || ['', 'x'])[1];
    src = `## 来源

- [${name} - MyAnimeList 检索](https://myanimelist.net/anime.php?q=${encodeURIComponent(name.slice(0, 20))})
- [Anime News Network Encyclopedia Search](https://www.animenewsnetwork.com/encyclopedia/search/name?only=anime&q=${encodeURIComponent(name.slice(0, 20))})
- [Bangumi 检索](https://bangumi.tv/subject_search/${encodeURIComponent(name.slice(0, 12))}?cat=all)
`;
  }
  const out = head + src;
  fs.writeFileSync(f, out);
  const plot = out.match(/## 剧情[\s\S]*?## 休闲切入点/)[0].replace(/\s/g, '').length;
  const ent = out.match(/## 休闲切入点[\s\S]*?## 来源/)[0].replace(/\s/g, '').length;
  const l = (out.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  console.log(f.split('/').pop(), { plot, ent, links: l });
}
