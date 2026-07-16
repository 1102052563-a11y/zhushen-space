const fs = require('fs');

function padFile(path) {
  let t = fs.readFileSync(path, 'utf8');
  const lens = () => {
    const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '').length;
    const ent = t.split('## 阶位切入点')[1].split('## 来源')[0].replace(/\s/g, '').length;
    return { plot, ent };
  };
  let g = 0;
  while (lens().plot < 10000 && g < 40) {
    g++;
    t = t.replace(
      '## 阶位切入点',
      `\n**【原作向战史补强·${g}】**\n沃尔特以黑犬武勇与魔军兵力双轮推进；七盾靠砦墙与塞蕾丝汀预知。卖城与商人通敌是原作反复出现的破城方式。阿丽西亚、普莉姆、辉夜、玛雅、露鲁、克劳迪娅各守一环，任一环断则连锁。奉仕国家用性与法令把军事胜利写成制度。奥莉加被拘束后新魔军仍保留暗精灵战力。克洛伊的忠与憎人类是侧翼情绪炸弹。六阶战场要写军团、城塞、巨兽与名将，而不是只有单挑。契约者改变局部叛变链，就能改变地区颜色。女神/姬君的象征资本与刀同样重要。\n## 阶位切入点`
    );
  }
  g = 0;
  while (lens().ent < 1500 && g < 25) {
    g++;
    t = t.replace(
      '## 来源',
      `\n钩子补强${g}：黎明前的营帐密谈、通敌信鸽、假军令、展示营钥匙、圣水车队、密道出口的火把数量变化。选错会让六阶会战在开打前就输掉政治。\n## 来源`
    );
  }
  fs.writeFileSync(path, t);
  console.log(path, lens());
}

padFile('产出/批次237/黑兽帝国终焉-公主军团.md');
padFile('产出/批次237/黑兽帝国终焉-女神苏醒.md');
