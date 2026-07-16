const fs = require("fs");
const path = require("path");
const dir = "产出/批次49";
let md = fs.readFileSync(path.join(dir, "原神.md"), "utf8");
const extra = `
**【锚点夜的三条存活规则】**
第一，不要在漩涡半径内恋战；第二，不要把归终机零件当普通货卖；第三，不要在神之心交接现场亮出可被愚人众利用的真实姓名。活过这三条，你才有资格谈「见证历史」。
`;
if (!md.includes("锚点夜的三条存活规则")) {
  md = md.replace("\n## 阶位切入点", extra + "\n## 阶位切入点");
  fs.writeFileSync(path.join(dir, "原神.md"), md, "utf8");
}
console.log("plot", md.split("## 阶位切入点")[0].replace(/\s/g,"").length);
