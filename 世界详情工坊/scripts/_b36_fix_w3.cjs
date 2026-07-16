const fs = require("fs");
const p = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次36/金刚狼3.md";
let t = fs.readFileSync(p, "utf8");
const add = `
**三阶补强** 礼车靴印、工厂义肢刮痕、药瓶与漫画并存；出卖坐标即失败。
**七阶补强** 罗根死后禁止神秘复活；劳拉扳十字为X是终局旗标；可替她装填艾德曼子弹或断后，皆属代价胜利。
`;
if (!t.includes("三阶补强")) {
  t = t.replace("## 来源", add + "\n## 来源");
  fs.writeFileSync(p, t);
}
const entry = (t.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "";
console.log("entry", entry.replace(/\s/g, "").length);
