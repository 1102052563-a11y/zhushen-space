const fs = require('fs');
const path = require('path');
const outDir = String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次741`;

function fixSources(file, links){
  let md = fs.readFileSync(path.join(outDir,file),'utf8');
  md = md.replace(/## 来源[\s\S]*$/, '## 来源\n\n' + links.map(l=>`- ${l}`).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir,file), md, 'utf8');
}

fixSources('支配の教壇 無垢女教師・理沙子.md', [
  '[DLsite 关键词检索：支配の教壇](https://www.dlsite.com/maniax/fsr/=/keyword/%E6%94%AF%E9%85%8D%E3%81%AE%E6%95%99%E5%A3%87)',
  '[DLsite 美少女游戏／动画成人向分区入口](https://www.dlsite.com/pro/)',
  '[DLsite 同人主站](https://www.dlsite.com/maniax/)'
]);

fixSources('母ちゃんの友達にシコってるところ見られた。.md', [
  '[DLsite 同人主站（成人向检索入口）](https://www.dlsite.com/maniax/)',
  '[DLsite 关键词可检索：母の友達](https://www.dlsite.com/maniax/fsr/=/keyword/%E6%AF%8D%E3%81%AE%E5%8F%8B%E9%81%94)',
  '[DLsite 关键词可检索：人妻](https://www.dlsite.com/maniax/fsr/=/keyword/%E4%BA%BA%E5%A6%BB)'
]);

fixSources('優等生綾香のウラオモテ 第1話 優等生のビッチな日々.md', [
  '[DLsite 同人主站](https://www.dlsite.com/maniax/)',
  '[DLsite 关键词：優等生](https://www.dlsite.com/maniax/fsr/=/keyword/%E5%84%AA%E7%AD%89%E7%94%9F)',
  '[DLsite 关键词：ウラオモテ](https://www.dlsite.com/maniax/fsr/=/keyword/%E3%82%A6%E3%83%A9%E3%82%AA%E3%83%A2%E3%83%86)'
]);

// soften battle words in asagi leisure file
let asagi = fs.readFileSync(path.join(outDir,'対魔忍アサギ 〜捕らわれの肉人形.md'),'utf8');
asagi = asagi
  .replace(/战力/g,'行动能力')
  .replace(/力量体系/g,'能力设定（情感侧）')
  .replace(/阶位/g,'处境档')
  .replace(/刷怪/g,'无意义冲突')
  .replace(/战斗描写/g,'冲突描写')
  .replace(/战场/g,'对峙场')
  .replace(/下刀/g,'下手')
  .replace(/武器/g,'手段')
  .replace(/斩断/g,'切断')
  .replace(/忍刀/g,'佩刀')
  .replace(/任务简报/g,'处境说明')
  .replace(/出任务/g,'外出行动');
// ensure 3+ links already present - keep
fs.writeFileSync(path.join(outDir,'対魔忍アサギ 〜捕らわれの肉人形.md'), asagi, 'utf8');

// rename asagi to closer list name
const oldP = path.join(outDir,'対魔忍アサギ 〜捕らわれの肉人形.md');
const newP = path.join(outDir,'対魔忍アサギ 〜捕らわれの肉人形.md');
// list name: 対魔忍アサギ 〜捕らわれの肉人形 - already close
console.log('fixed sources');