const fs = require("fs");
const path = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次841/万生痴魔.md";
let raw = fs.readFileSync(path, "utf8");
const more = "目录早期章名可作时点锚：我看这人行、万生影视、手艺人、第一只碗、黑沙口、挂号伙计、老舵子、天成巧圣等。";
if (!raw.includes("目录早期章名可作时点锚")) {
  raw = raw.replace("**【叙事基调 · 雷区】**", more + "\n\n**【叙事基调 · 雷区】**");
  fs.writeFileSync(path, raw, "utf8");
}
function noWS(s){return s.replace(/\s/g,"").length}
const plot = raw.match(/## 剧情\s*([\s\S]*?)(?=## 阶位切入点)/)[1];
const entry = raw.match(/## 阶位切入点\s*([\s\S]*?)(?=## 来源)/)[1];
console.log("plot", noWS(plot), "entry", noWS(entry));