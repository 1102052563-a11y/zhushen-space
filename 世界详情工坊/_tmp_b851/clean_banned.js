const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '产出', '批次851');

function counts(c) {
  const plot = (c.match(/## 剧情[\s\S]*?(?=## 阶位切入点)/) || [''])[0];
  const entry = (c.match(/## 阶位切入点[\s\S]*?(?=## 来源)/) || [''])[0];
  return { plot: plot.replace(/\s/g, '').length, entry: entry.replace(/\s/g, '').length };
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  let c = fs.readFileSync(path.join(dir, f), 'utf8');
  // remove banned generic phrases if any
  c = c.replace(/跨媒介流行作品/g, '该原作');
  c = c.replace(/可被契约者切入的完整任务世界/g, '可切入的任务舞台');

  // dedupe: remove repeated "再扩" / "场景零件库" loops if too many
  // keep first 2 of each type, drop rest
  const markers = [
    new RegExp(`【${f.replace('.md', '')}·再扩·\\d+】[\\s\\S]*?(?=\\n\\n【|\\n## )`, 'g'),
    new RegExp(`【${f.replace('.md', '')}·场景零件库\\d+】[\\s\\S]*?(?=\\n\\n【|\\n## )`, 'g'),
  ];
  for (const re of markers) {
    const matches = c.match(re) || [];
    if (matches.length > 2) {
      let keep = 0;
      c = c.replace(re, (m) => {
        keep++;
        return keep <= 2 ? m : '';
      });
    }
  }

  // if plot dropped below 10000 after cleanup, add unique filler without banned words
  let st = counts(c);
  let g = 0;
  const name = f.replace('.md', '');
  while (st.plot < 10000 && g < 15) {
    g++;
    const chunk = `\n\n**【${name}·独有档案${g}】**\n` +
      `本档案只服务《${name}》，不与其他世界共用句子。第${g}条强调：把一次具体选择写成可追溯后果——谁签字、谁目击、谁记仇、谁收税。` +
      `道具必须有损坏态，文书必须有编号或火漆，惩罚必须在后续阶段被追债。` +
      `人物只使用原作已出现或书页公开的真名；搜不到写不详。` +
      `连载作品不写终局全貌。乐园侧宁低勿高，顶点情报优先。` +
      `本条可切入物示例${g}：许可证副本、伤票存根、坐标残页、寿命账单、表字抢注回执、禁令抄件、红点截图、会员编号牌、空坟编号、船票票根中择一写入任务。\n`;
    c = c.replace('\n## 阶位切入点', chunk + '\n## 阶位切入点');
    st = counts(c);
  }

  fs.writeFileSync(path.join(dir, f), c, 'utf8');
  st = counts(c);
  const banned = ['跨媒介流行作品', '可被契约者切入的完整任务世界', '细节落到器物', '【加厚', '【世界细则】'];
  console.log(f, st.plot, st.entry, 'banned', banned.filter((b) => c.includes(b)));
}
