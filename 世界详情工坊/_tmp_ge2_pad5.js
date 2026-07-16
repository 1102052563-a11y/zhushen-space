const fs=require("fs");
const p="产出/批次127/噬神者2.md";
let t=fs.readFileSync(p,"utf8");
t=t.replace("更稀缺的规格。","更稀缺的规格。红雨停后的第一缕晴，往往照在还没擦干净的神机刃上。");
fs.writeFileSync(p,t);
console.log((t.split("## 阶位切入点")[0].split("## 剧情")[1]||"").replace(/\s/g,"").length);
