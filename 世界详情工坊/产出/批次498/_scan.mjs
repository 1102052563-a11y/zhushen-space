import fs from "fs";
const files = [
  "女騎士エミリア-十度目覚醒.md",
  "淫魔郵便局-国際便.md",
  "聖女巡礼-最終試練.md",
  "魔法少女サクヤ-二重人格.md",
  "人妻料理教室-上級クラス.md",
];
const base = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次498/";
const re = /力量体系|战力|阶位|巅峰战力/g;
for (const f of files) {
  const text = fs.readFileSync(base + f, "utf8");
  const m = text.match(/^##\s+剧情\s*$/m);
  const e = text.match(/^##\s+(休闲切入点|阶位切入点|来源)\s*$/m);
  const plot = text.slice(m.index, e ? e.index : text.length);
  const hits = [...plot.matchAll(re)].map(x => x[0] + "@" + x.index);
  console.log(f, "hits", hits);
  // also search any 战
  const z = [...plot.matchAll(/战./g)].map(x => x[0]);
  const unique = [...new Set(z)];
  console.log("  战* samples:", unique.slice(0, 30).join(","));
  const j = [...plot.matchAll(/阶./g)].map(x => x[0]);
  console.log("  阶* samples:", [...new Set(j)].slice(0, 20).join(","));
}