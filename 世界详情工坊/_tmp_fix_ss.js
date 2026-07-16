const fs=require("fs");
const p="产出/批次127/火焰之纹章：圣魔之光石.md";
let t=fs.readFileSync(p,"utf8");
if(!t.includes("乐园阶位映射")){
  t=t.replace("乐园阶位：","乐园阶位映射：");
  // if still missing exact phrase
  if(!t.includes("乐园阶位映射")){
    t=t.replace("**【地理 · 舞台】**","乐园阶位映射：民兵难民≈一阶；正规军≈二阶；英雄将军≈三阶；帝国顶将与魔王使徒≈六阶；弗莫提斯≈七阶。宁低勿高。\n\n**【地理 · 舞台】**");
  }
}
fs.writeFileSync(p,t);
console.log("has", t.includes("乐园阶位映射"));
