const fs = require("fs");
let md = fs.readFileSync("产出/批次49/原神.md", "utf8");
const extra = "\n**【补记】**群玉阁落地的冲击波会掀翻未系缆的民船，救护优先级高于拾取魔神残渣；残渣归属七星与仙家共管，私藏等同叛国。\n";
md = md.replace("\n## 阶位切入点", extra + "\n## 阶位切入点");
fs.writeFileSync("产出/批次49/原神.md", md, "utf8");
// match compiler
const text = md.replace(/\r\n/g,"\n");
const secRe = /^##\s+(剧情|阶位切入点|来源)\s*$/gm;
const marks=[]; let m;
while((m=secRe.exec(text))!==null) marks.push({name:m[1], bodyStart:m.index+m[0].length, start:m.index});
for(let i=0;i<marks.length;i++){
  const end=i+1<marks.length?marks[i+1].start:text.length;
  const body=text.slice(marks[i].bodyStart,end).trim();
  console.log(marks[i].name, body.replace(/\s/g,"").length);
}
