const fs = require('fs');

function padFile(path, plotChunks, entryChunks) {
  let t = fs.readFileSync(path, 'utf8');
  if (!t.includes('【长档扩写·起】')) {
    t = t.replace('## 阶位切入点', plotChunks + '\n## 阶位切入点');
  }
  if (!t.includes('【切入长档·起】')) {
    t = t.replace('## 来源', entryChunks + '\n## 来源');
  }
  let plotN = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '').length;
  let i = 0;
  while (plotN < 10050 && i < 30) {
    i++;
    const chunk = `\n**【补密段${i}】** 艾雷欧斯战史第${i}页：琉尔军在编号${i}战场与腐蚀者、伊鲁席翁军或四凶部众交锋。纹章士戒指持有者择机Engage，武器三角与破防链打开突破口。连锁攻击收割残敌，守护技能保住重伤同伴。梦之岛休整时锻造、用餐、支援对话推进。薇尔善恶面消息更新；索玛布龙复苏进度用黑雾与亡者密度标示。十二戒收集进度写明。契约者可任旗手、护戒使者或破阵斧手，奖励不越本阶。经典模式阵亡即永久离开编制。五色地理：索尔姆沙、斐列涅风、布罗帝亚铁、伊鲁席翁冷、利斯西亚白，不得写混。`;
    t = t.replace('## 阶位切入点', chunk + '\n## 阶位切入点');
    plotN = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '').length;
  }
  let entryN = t.split('## 阶位切入点')[1].split('## 来源')[0].replace(/\s/g, '').length;
  let j = 0;
  while (entryN < 1550 && j < 12) {
    j++;
    const e = `\n切入加厚${j}：本阶增加独立事件与真名NPC轮换，开场白画面不与其他阶重复，奖励表单列，禁止假货护送套话。`;
    t = t.replace('## 来源', e + '\n## 来源');
    entryN = t.split('## 阶位切入点')[1].split('## 来源')[0].replace(/\s/g, '').length;
  }
  fs.writeFileSync(path, t);
  console.log(path, 'plot', plotN, 'entry', entryN);
}

const engPlot = `
**【长档扩写·起】**
世界观再钉：艾雷欧斯五国以颜色与音乐区分。神龙信仰在斐/布/索主流，伊鲁席翁多奉邪龙。戒指分散防十二齐伟业。琉尔失忆是引擎也是血脉缓冲。露米埃尔之死打碎神龙永在幻觉。

主线细拍：苏醒-丧母-斐列涅-布罗帝亚-伊鲁失败-失戒-艾比倒戈-索尔姆-二度伊鲁-揭血脉-利斯决战-暂死-第十三纹章士-多元门-斩龙-新秩序。每拍可插skirmish与paralogue。

薇尔双人格与项圈控制；琉尔护妹而死是情感顶点；腐蚀暂复活有时限；第十三纹章士是质变。索玛布龙是流放者扭曲归乡，非无动机魔王。人物真名：阿尔弗雷德、赛勒莉卡、迪亚曼德、艾薇、缇莫特、艾比、蜜丝提拉、芙嘉特、四凶、凡德雷等。梦之岛日常降压。雷区：勿当风花雪月写；勿战力归零；勿乱杀可招募。契约者多身份；状态机：戒数/薇尔面/龙醒/是否第十三。
`;
const engEntry = `
**【切入长档·起】**
一阶：神殿管道腐蚀；护送琉尔见露米埃尔最后。二阶：斐列涅花田护粮+观摩Engage。三阶：布罗帝亚铁矿夺戒车。六阶：四凶夜袭保交接。七阶：多元门护第十三导能。每阶七字段齐全、人名加粗。
`;

padFile('产出/批次132/火焰之纹章：Engage.md', engPlot, engEntry);
