const fs = require("fs");
let md = fs.readFileSync("产出/批次49/原神.md", "utf8");
md = md.replace("\n## 阶位切入点", "\n**【一句】**锚点副本的正确通关是护送与守阵，不是单挑魔神。\n\n## 阶位切入点");
fs.writeFileSync("产出/批次49/原神.md", md, "utf8");
console.log(md.split("## 阶位切入点")[0].replace(/\s/g,"").length);
