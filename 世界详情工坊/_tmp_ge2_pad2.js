const fs = require("fs");
const p = "产出/批次127/噬神者2.md";
let t = fs.readFileSync(p, "utf8");
const pad = `
**【结局状态锚定】**
原版《噬神者2》主线收束时：黑疫危机解除，螺旋树成为远东新地标；朱利乌斯在意识层面完成自我遏止（是否肉身回归以扩展作描写为准，本条目不强制统一）；罗密欧之死的重量仍留在队伍里；血之队编制稳定并与Cradle建立联合讨伐默契；雷切尔路线崩解但芬里尔上层对圣地与神机兵技术的兴趣未灭。契约者若在此节点离场，世界处于「喘息而非太平」：荒神仍在，组织仍在，只是红雨暂时停了。
`;
if (!t.includes("结局状态锚定")) {
  t = t.replace("## 阶位切入点", pad + "\n## 阶位切入点");
  // wait that puts it outside 剧情 - need inside 剧情
}
// fix: put before ## 阶位切入点 but the plot section ends before that - charCount is of 剧情 section only
// so insert before end of 剧情 i.e. before ## 阶位切入点 is correct - sections['剧情'] is between ##剧情 and ##阶位切入点
// so content before ## 阶位切入点 IS the plot. Good.
t = fs.readFileSync(p, "utf8");
if (!t.includes("结局状态锚定")) {
  t = t.replace("\n## 阶位切入点", pad + "\n## 阶位切入点");
  fs.writeFileSync(p, t);
}
const plot = (t.split("## 阶位切入点")[0].split("## 剧情")[1] || "").replace(/\s/g, "").length;
console.log("plot", plot);
