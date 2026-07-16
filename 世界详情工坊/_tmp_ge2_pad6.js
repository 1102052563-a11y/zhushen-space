const fs=require("fs");
const p="产出/批次127/噬神者2.md";
let t=fs.readFileSync(p,"utf8");
t=t.replace("神机刃上。","神机刃上。队伍还在，故事未完。");
fs.writeFileSync(p,t);
console.log((t.split("## 阶位切入点")[0].split("## 剧情")[1]||"").replace(/\s/g,"").length);
