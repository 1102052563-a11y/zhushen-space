const fs = require("fs");
const path = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次622/镖人.md";
let t = fs.readFileSync(path, "utf8");
const extra = `\n\n**【终检补段】**大漠的风会抹平脚印，抹不平账。刀马护的是孩子与私义，裴世矩算的是西域与帝国，谛听追的是复职与教门，知世郎赌的是余命与颠覆。契约者插进任一缝，都要先问：这趟镖的下一站水源在谁手里。\n`;
t = t.replace("\n## 阶位切入点", extra + "\n## 阶位切入点");
fs.writeFileSync(path, t, "utf8");
console.log("plot", t.split("## 阶位切入点")[0].replace(/\s/g,"").length);