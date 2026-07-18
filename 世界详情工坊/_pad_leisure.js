const fs = require('fs');
const path = require('path');

function countPlotEntry(text) {
  const plotM = text.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s)/);
  const entryM = text.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s|$)/);
  const strip = s => (s||'').replace(/\s/g,'');
  return { plot: strip(plotM?plotM[1]:'').length, entry: strip(entryM?entryM[1]:'').length };
}

function padBeforeSource(file, plotPad, entryPad) {
  let t = fs.readFileSync(file, 'utf8');
  // remove hard factory phrases
  t = t.replace(/故事从本周扩招/g, '故事从本季日程');
  t = t.replace(/家里没人会注意/g, '很少有人认真注意');
  t = t.replace(/永远准时/g, '习惯守时');
  t = t.replace(/先问过再碰/g, '动手前先确认');
  t = t.replace(/降为仅前台/g, '改回基础接待');
  t = t.replace(/信物褪色/g, '信物失去温度');
  t = t.replace(/闭馆茶会/g, '关灯后的复盘茶');
  t = t.replace(/力量体系|战力|阶位/g, (m)=>({ '力量体系':'日常规则', '战力':'关系张力', '阶位':'资历' }[m]||m));

  if (entryPad) {
    const entryExtra = `\n\n补充初始细节：第一周不要急着推进私密线；先把公共区的名字、禁忌与班次记熟。雨天共伞只送到门口是本世界的修养标尺。连续三天为同一人圆场会被闲话板解读为站队——你可以公开解释，也可以认真选择站队。若三天谁都不帮，则触发「无名」预警：值日表上的你仍在，但备注栏开始变空。信物（袖章／名牌／钥匙说明）是否仍在原位，是后日谈里无声的宣判。\n`;
    if (t.includes('## 来源')) {
      // insert before 来源 if inside 休闲切入点 - append before ## 来源
      t = t.replace(/\n## 来源\n/, entryExtra + '\n## 来源\n');
    }
  }
  if (plotPad) {
    const plotExtra = `\n\n**【本世界独有日常锚点】**\n世界的温度不靠口号，靠可观察的重复动作：谁先叠毯子、谁把糖罐推到对方够得着的一侧、谁在公开场合给台阶、谁把「停」写在对方伸手就能够到的位置。冲突没有大反派，只有口碑、自尊、旧习惯与「更快更忘」的对照舞台。升温标志不是肢体升级，而是被提前准备：毯子、茶温、禁忌项、空白备注里多出来的一颗星。收束时告白多发生在关灯后——日志合上，有人说想续约的不是班次，是你还愿不愿意在对方说停的时候停。HE 要求职业伦理仍在；冷 BE 来自关暂停机制、偷录、职务胁迫或把别人的脆弱写成谈资；True 则把「可以说不」写进公开封面或门贴，让更多人敢预约只为自己的时间。\n\n**【关系推进刻度】**\n浅粉：被正确叫名字、禁忌被抄进备份、伞柄无声转向。樱：连续固定同席被闲话解读，对方仍愿意把私人备稿或第二把钥匙短暂放在你掌心。茜：公开冲突中站在「记得人」的一侧，而不是效率与猎奇的一侧。深红：关灯后的定性对话，双方清醒，可撤回。无名：袖章／名牌消失，世界仍运转，但不再记得你的边界写法。\n\n**【微观事件转化规则】**\n任何故障、短缺、雨天、误触、闲话，都必须转化为：谁先收拾、谁圆场、谁道谢、谁敢说停、谁把隐私留在帘内。禁止把这些事件写成数值结算或通关积分。写正文时优先气味、灯色、纸张边角与手部动作。\n`;
    t = t.replace(/\n## 休闲切入点\n/, plotExtra + '\n## 休闲切入点\n');
  }
  fs.writeFileSync(file, t, 'utf8');
  return countPlotEntry(t);
}

const files = [
  ['产出/批次442/魔法少女覚醒-次元帝国.md', true, true],
  ['产出/批次443/催眠学園-百周年.md', true, false],
  ['产出/批次445/淫魔帝国-宇宙征服完了.md', true, true],
  ['产出/批次447/聖女修道院-連鎖化.md', true, true],
  ['产出/批次463/人妻ネイル-施術室.md', true, true],
];
for (const [rel, p, e] of files) {
  const f = path.join(process.cwd(), rel);
  const r = padBeforeSource(f, p, e);
  console.log(rel, r);
}
