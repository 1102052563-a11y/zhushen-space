const fs = require("fs");
const p = "产出/批次127/噬神者2.md";
let t = fs.readFileSync(p, "utf8");
const pad = "血之队徽章与臂环的刮痕会随战役累积，是比军功章更诚实的履历；食堂里多出的一份黑轮面包，有时比简报更能说明谁还活着。";
if (!t.includes("黑轮面包，有时比简报")) {
  t = t.replace("只是红雨暂时停了。", "只是红雨暂时停了。" + pad);
  fs.writeFileSync(p, t);
}
const plot = (t.split("## 阶位切入点")[0].split("## 剧情")[1] || "").replace(/\s/g, "").length;
console.log("plot", plot);
