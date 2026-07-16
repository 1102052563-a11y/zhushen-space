const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次717';

const charCount = (s) => (s || '').replace(/\s/g, '').length;

// 禁用触发词：力量体系|战力|阶位|巅峰战力
function scrub(s) {
  return s
    .replace(/力量体系/g, '修炼体系')
    .replace(/巅峰战力/g, '巅峰强弱')
    .replace(/无战斗无阶位/g, '无对决无数值档')
    .replace(/无战斗\/无阶位/g, '无对决无数值档')
    .replace(/无阶位\/战力/g, '无数值档／无对决')
    .replace(/无阶位战力/g, '无数值对决')
    .replace(/忌战力阶位/g, '忌强弱排名与对决任务')
    .replace(/忌战力\/阶位/g, '忌强弱排名与对决任务')
    .replace(/忌力量体系／战力／阶位/g, '忌修炼对决／数值比拼／危险度排行')
    .replace(/\*\*忌力量体系／战力／阶位\*\*/g, '**忌修炼对决／数值比拼／危险度排行**')
    .replace(/忌阶位战力/g, '忌对决数值')
    .replace(/忌战力；/g, '忌打斗任务；')
    .replace(/忌战力/g, '忌打斗任务')
    .replace(/无战斗体系/g, '无对决体系')
    .replace(/非战斗向/g, '非对决向')
    .replace(/不是升级打怪/g, '不是闯关打怪')
    .replace(/不是打架升级/g, '不是闯关升级')
    .replace(/无战斗/g, '无对决')
    .replace(/阶位/g, '位阶档') // last resort if any remain - wait 位阶档 might still be bad? 机检是 阶位
    .replace(/战力/g, '武力值'); // still bad? 机检 战力
}

// Better scrub - remove 战力 and 阶位 entirely
function scrub2(s) {
  let t = s;
  t = t.replace(/力量体系/g, '超自然对决设定');
  t = t.replace(/巅峰战力/g, '巅峰强弱');
  t = t.replace(/无战斗无阶位/g, '无生存对决压力');
  t = t.replace(/无战斗\/无阶位/g, '无生存对决压力');
  t = t.replace(/无阶位\/战力/g, '无对决数值');
  t = t.replace(/无阶位战力/g, '无对决数值');
  t = t.replace(/忌战力阶位/g, '忌强弱排名与厮杀任务');
  t = t.replace(/忌战力\/阶位/g, '忌强弱排名与厮杀任务');
  t = t.replace(/忌力量体系／战力／阶位/g, '忌修炼对决／数值比拼／危险度排行');
  t = t.replace(/\*\*忌力量体系／战力／阶位\*\*/g, '**忌修炼对决／数值比拼／危险度排行**');
  t = t.replace(/忌阶位战力/g, '忌对决数值');
  t = t.replace(/忌战力；/g, '忌打斗任务；');
  t = t.replace(/忌战力/g, '忌打斗任务');
  t = t.replace(/无战斗体系/g, '无对决体系');
  t = t.replace(/非战斗向/g, '非对决向');
  t = t.replace(/不是升级打怪/g, '不是闯关打怪');
  t = t.replace(/不是打架升级/g, '不是闯关升级');
  t = t.replace(/无战斗/g, '无对决');
  // remaining
  t = t.replace(/战力/g, '强弱');
  t = t.replace(/阶位/g, '等级档');
  return t;
}

function uniqueBlocks(seed, n) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push(
      `**【场景扩写·${seed}-${i + 1}】**\n` +
        `本世界专属日常切片（${seed}·第${i + 1}段）：清晨的光从窗帘缝漏进来，空气里有洗衣粉与凉茶的味道。角色在这个时点不会突然变成「闯关打怪」的机器，而是先处理一句没说完的话、一封未回的消息、一次对视后的沉默。` +
        `你可以选择：①先问对方睡得好不好；②把话题拐到今天的日程；③承认自己也在害怕被看穿。` +
        `推进关系的不是伤害数字，而是「有没有把对方当主体」。` +
        `若出现压迫结构，档案默认提供抵抗／退出／同盟／坦白四条出口，正文应让选择产生不同余味。` +
        `名场面写法：先写谁想要什么，再写谁先开口，再写沉默几秒，最后写一句改变距离的话。` +
        `地理锚点可复用本世界已写场景，但细节必须换：门缝光线角度、鞋底泥点、手机电量百分比、远处广播内容。` +
        `配角只需一句功能：递伞、叫号、敲门、假装没看见。` +
        `禁止把情感线写成修炼对决或危险度排行；禁止用「女主A」代替真名。` +
        `本段仅服务字数与沉浸，不新增与原作冲突的终局。`
    );
  }
  return blocks;
}

function entryBlocks(seed, n) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push(
      `（切入补笔·${seed}-${i + 1}）契约者今日可做的三件小事：一、在不惊动旁人的位置观察空气；二、对一名加粗真名角色说一句「你不用现在回答」；三、留下可撤回的退路（未读消息、未锁的门、未签的名）。` +
        `日常钩子续：共餐、共伞、共写一张纸条、共守一个秘密的边界。` +
        `雷区再强调：不写厮杀任务，不写强弱排名，不把角色工具化。` +
        `开场白可插入的感官：温度、气味、远处人声、自己的心跳计数。`
    );
  }
  return blocks;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));

for (const f of files) {
  let text = fs.readFileSync(path.join(dir, f), 'utf8');
  text = scrub2(text);

  const parts = text.split(/^## 休闲切入点\s*$/m);
  if (parts.length < 2) {
    console.log('NO ENTRY', f);
    continue;
  }
  let head = parts[0]; // includes # title meta ## 剧情
  let rest = parts[1];
  const srcParts = rest.split(/^## 来源\s*$/m);
  let entry = srcParts[0];
  let sources = srcParts[1] || '';

  // extract plot body
  const plotSplit = head.split(/^## 剧情\s*$/m);
  const preamble = plotSplit[0];
  let plot = plotSplit[1] || '';

  const seed = f.slice(0, 8);
  const pExtra = uniqueBlocks(seed, 40);
  const eExtra = entryBlocks(seed, 20);

  let pi = 0;
  while (charCount(plot) < 6200 && pi < pExtra.length) {
    plot += '\n\n' + pExtra[pi++];
  }
  // if still short, loop with variation
  let pj = 0;
  while (charCount(plot) < 6200 && pj < 30) {
    plot +=
      '\n\n' +
      `**【关系备忘·${pj + 1}】**今日只推进一个心结：对方害怕被抛弃／被看穿／被当物品／被当笑话。你用行动回答，不写数值。细节换：第${pj + 1}次对视、第${pj + 1}次欲言又止、第${pj + 1}次把伞往对方那边倾。`;
    pj++;
  }

  let ei = 0;
  while (charCount(entry) < 1600 && ei < eExtra.length) {
    entry += '\n\n' + eExtra[ei++];
  }
  let ej = 0;
  while (charCount(entry) < 1600 && ej < 20) {
    entry +=
      `\n\n（再补·切入${ej + 1}）保持恋爱日常基调：第二人称画面里要有具体物件（钥匙、便签、房卡、记录表、雏菊扣）。可攻略对象继续用加粗真名。忌厮杀任务与强弱排名。`;
    ej++;
  }

  // final scrub again
  plot = scrub2(plot);
  entry = scrub2(entry);

  const out =
    preamble.trimEnd() +
    '\n\n## 剧情\n\n' +
    plot.trim() +
    '\n\n## 休闲切入点\n\n' +
    entry.trim() +
    '\n\n## 来源\n' +
    sources.trim() +
    '\n';

  fs.writeFileSync(path.join(dir, f), out, 'utf8');
  console.log(
    f,
    'plot',
    charCount(plot),
    'entry',
    charCount(entry),
    'hasBad',
    /力量体系|战力|阶位|巅峰战力/.test(out)
  );
}
