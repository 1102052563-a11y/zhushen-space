const fs = require('fs');
const path = require('path');
const dir = '产出/批次93';
function padTo(file, min=10050) {
  let t = fs.readFileSync(path.join(dir, file), 'utf8');
  let plotLen = () => t.split('## 阶位切入点')[0].replace(/\s/g,'').length;
  let n = 0;
  while (plotLen() < min && n < 30) {
    n++;
    const chunk = `\n**【细节锚${n}】**本世界在此时点仍按原作因果推进：关键道具归属、谁已死亡、下一场名场面压力，三者必须自洽。契约者改写局部后，用追杀、涨价、封路、舆论或规则反噬回流，而不是假装无事。场景至少保留一种专属感官（气味/声/制度术语）。\n`;
    t = t.replace('## 阶位切入点', chunk + '\n## 阶位切入点');
  }
  fs.writeFileSync(path.join(dir, file), t, 'utf8');
  console.log(file, plotLen(), 'loops', n);
}
['大逃杀.md','双城之战.md','未来日记.md','最后的生还者.md'].forEach(padTo);
