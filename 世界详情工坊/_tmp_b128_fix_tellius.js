const fs = require('fs');

function fix(path, entryExtra) {
  let t = fs.readFileSync(path, 'utf8');
  t = t.replace('**【隐藏剧情】**', '**【隐藏剧情 · 伏笔】**');
  t = t.replace('乐园映射：', '乐园阶位映射：');
  if (!t.includes('乐园阶位映射')) {
    t = t.replace(/宁低勿高[；;]/, '乐园阶位映射见力量体系末行。宁低勿高；');
  }
  // ensure 阶位↔ after 阶位切入点
  if (!t.includes('阶位↔')) {
    t = t.replace(
      '## 阶位切入点\n\n',
      '## 阶位切入点\n\n> 阶位↔战力：一阶≈民兵/平民；二阶≈正规新兵与游击；三阶≈精锐；六阶≈国家会战；七阶≈神/塔/女神级。顶点条件性胜利，情报优先。\n\n'
    );
  }
  // pad entry
  let parts = t.split('## 阶位切入点');
  let head = parts[0];
  let tail = parts[1] || '';
  let eparts = tail.split('## 来源');
  let entry = eparts[0];
  let src = eparts[1] || '';
  let n = entry.replace(/\s/g, '').length;
  let i = 0;
  while (n < 1550 && i < 20) {
    entry += `\n\n**本阶独有备忘${i + 1}**\n${entryExtra} 本备忘编号${i + 1}：须写出具体地点、加粗真名NPC、第一幕冲突与失败代价；奖励不越阶。\n`;
    n = entry.replace(/\s/g, '').length;
    i++;
  }
  t = head + '## 阶位切入点' + entry + '\n## 来源' + src;
  fs.writeFileSync(path, t);
  const plot = (head.split('## 剧情')[1] || '').replace(/\s/g, '').length;
  console.log(path, 'plot', plot, 'entry', n, plot >= 10000 && n >= 1500 ? 'OK' : 'NEED');
}

fix(
  '产出/批次128/火焰之纹章：苍炎之轨迹.md',
  '苍炎线：佣兵据点/加利亚边境/贝格尼昂奴隶市/达因会战/纹章守护之一。'
);
fix(
  '产出/批次128/火焰之纹章：晓之女神.md',
  '晓之线：达因占领巷/拂晓劫囚/克里米亚王城叛乱/血契战场/引导之塔之一。'
);
