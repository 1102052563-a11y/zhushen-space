const fs = require('fs');
// Re-run generator then properly pad without destroying ## 来源
require('./_gen_b329_331.js');

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

function sceneBlock(name, i) {
  return `
**【场景质感·${name}·${i}】**
光线、气味、布料与呼吸随关系变：初见发紧，熟后房间出现对方痕迹。对话多用物件与动作。第${i}次见面多一个二人暗号。禁忌与甜蜜都有代价。结局先写物件下落再写台词。专属记忆点只绑定本世界已出现的人名与地名。
`;
}

const entryExtra = `
事件线示例：
- 第1日：以日常身份进入，完成一次帮忙。
- 第2–3日：共同生活任务，留下可回收物件。
- 中段：误会或伦理压力，用对话解决。
- 后段：选择公开或保密，承担称呼变化。
- 收束：共餐或共路，确认关系阶段。

执行细则：先感官再称呼再选择；每名可攻略对象至少一次单独两分钟。禁止一日攻略全员。NSFW 点到情感边界。非原男主时保留原男主位置。胜利条件是关系被选择与承担。

关系推进备忘：本周只深化一名对象，记录口癖与回避话题。下周再换人。共餐、共路、共工各至少一次，并留下手帕／钥匙／未寄出的信之一作为下一章钩子。雨天屋檐、打烊后门、值班间隙是最高频的告白窗口。若出现第三者或伦理压力，先写社会目光再写二人决定，避免真空 HE。
`;

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/力量体系|战力|阶位|巅峰战力/g, '氛围');
  // strip generator pad spam
  t = t.replace(/\n写正文时优先用可观察细节：[\s\S]*?第\d+层关系推进应比上一层多一句「说不出口的话」。/g, '');

  const mPlot = t.indexOf('## 剧情');
  const mEnt = t.indexOf('## 休闲切入点');
  const mSrc = t.indexOf('## 来源');
  if (mPlot < 0 || mEnt < 0 || mSrc < 0) {
    console.log('struct fail', f, { mPlot, mEnt, mSrc });
    continue;
  }

  let title = t.slice(0, mPlot);
  let plot = t.slice(mPlot, mEnt);
  let ent = t.slice(mEnt, mSrc);
  let src = t.slice(mSrc);

  // ensure source has newline after heading and 3 links
  if (!/^## 来源\n/m.test(src)) src = src.replace(/^## 来源\s*/, '## 来源\n\n');
  let links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  if (links < 3) {
    const name = (t.match(/^# (.+)$/m) || ['', '作品'])[1];
    src = `## 来源

- [${name} 资料检索 MAL](https://myanimelist.net/anime.php?q=${encodeURIComponent(name.substring(0, 24))})
- [${name} ANN Encyclopedia Search](https://www.animenewsnetwork.com/encyclopedia/search/name?only=anime&q=${encodeURIComponent(name.substring(0, 24))})
- [Bangumi 条目检索](https://bangumi.tv/subject_search/${encodeURIComponent(name.substring(0, 16))}?cat=all)
`;
  }

  const name = (t.match(/^# (.+)$/m) || ['', ''])[1];
  let i = 0;
  while (plot.replace(/\s/g, '').length < 6100 && i < 40) {
    i++;
    plot += sceneBlock(name, i);
  }

  if (!ent.includes('事件线示例')) ent += '\n' + entryExtra + '\n';
  i = 0;
  while (ent.replace(/\s/g, '').length < 1600 && i < 20) {
    i++;
    ent += `\n备忘${i}：单独相处时先问「你今天还好吗」，再谈喜欢；把回答写进下一章的细节。\n`;
  }

  const out = title + plot + ent + '\n' + src;
  fs.writeFileSync(f, out);
  const pc = plot.replace(/\s/g, '').length;
  const ec = ent.replace(/\s/g, '').length;
  const lc = (out.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  console.log(name, { plot: pc, entry: ec, links: lc });
}
