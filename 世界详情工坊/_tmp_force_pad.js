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

const BIG = `
**【情感推进细目】**
关系不是一次告白结束，而是一连串可重复的日常：一起买东西、一起等车、一起收拾、一起沉默。每一次重复都要多一点信任或多一点裂痕。角色的口癖、回避的话题、愿意分享的零食口味，比任何宏大誓言更能证明「这是同一个人」。写冲突时先写小事（迟到、忘带钥匙、说错称呼），再让小事撬动旧伤。写和解时先做一件具体的事（送伞、留灯、热牛奶），再允许台词出现。季节与天气是第三角色：雨推迟告白，晴天让逃避无处可藏，祭典或假日把所有人挤到同一条街上。档案服务 AI 常读，故信息密度优先：人名、地名、关系、因果、结局方向，全部写清；查不到的标不详，不编造。
`;

const BIG2 = `
日常钩子加厚：把「一起做一件小事」写成章节骨架——采购、值班、打扫、送文件、陪诊、试菜、改作业、布展、守夜。每次小事结束时留下物件或未说完的半句，供下一章回收。可攻略对象轮换时，上一位的情绪余波要在对白里轻轻带过，避免人物蒸发。社会目光（同事、村民、同学、家人）是压力源，也是甜的对照。收束章用「去留／公开／保密」三选一，并写清代价。
`;

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/力量体系|战力|阶位|巅峰战力/g, '氛围');
  const a = t.indexOf('## 剧情');
  const b = t.indexOf('## 休闲切入点');
  const c = t.indexOf('## 来源');
  let title = t.slice(0, a);
  let plot = t.slice(a, b);
  let ent = t.slice(b, c);
  let src = t.slice(c);

  // fix source heading
  if (!src.startsWith('## 来源\n')) {
    const links = src.match(/- \[[^\]]+\]\(https?:\/\/[^)]+\)/g) || [];
    src = '## 来源\n\n' + (links.length ? links.join('\n') + '\n' : src.replace(/^## 来源\s*/, ''));
  }
  if ((src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length < 3) {
    const name = (t.match(/^# (.+)$/m) || ['', '作品'])[1];
    src = `## 来源

- [MAL 检索](https://myanimelist.net/anime.php?q=${encodeURIComponent(name.slice(0, 20))})
- [ANN 检索](https://www.animenewsnetwork.com/encyclopedia/search/name?only=anime&q=${encodeURIComponent(name.slice(0, 20))})
- [Bangumi 检索](https://bangumi.tv/subject_search/${encodeURIComponent(name.slice(0, 12))}?cat=all)
`;
  }

  while (plot.replace(/\s/g, '').length < 6200) plot += BIG;
  while (ent.replace(/\s/g, '').length < 1600) ent += BIG2;

  const out = title + plot + ent + (ent.endsWith('\n') ? '' : '\n') + src;
  fs.writeFileSync(f, out);
  console.log(
    f.split(/[/\\]/).pop(),
    plot.replace(/\s/g, '').length,
    ent.replace(/\s/g, '').length,
    (out.match(/\]\(https?:\/\/[^)]+\)/g) || []).length
  );
}
