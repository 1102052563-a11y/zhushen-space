const fs=require("fs");
const p="产出/批次127/噬神者2.md";
let t=fs.readFileSync(p,"utf8");
t=t.replace("故事未完。","故事未完。前路仍长。");
fs.writeFileSync(p,t);
console.log((t.split("## 阶位切入点")[0].split("## 剧情")[1]||"").replace(/\s/g,"").length);
