const fs=require("fs");
const p="产出/批次127/噬神者2.md";
let t=fs.readFileSync(p,"utf8");
const pad="契约者应记住：在这片废墟里，活着本身就是战绩，而「不丢下队友」是比任何神机型号更稀缺的规格。";
if(!t.includes("不丢下队友」是比任何神机")){
  t=t.replace("谁还活着。","谁还活着。"+pad);
  fs.writeFileSync(p,t);
}
console.log((t.split("## 阶位切入点")[0].split("## 剧情")[1]||"").replace(/\s/g,"").length);
