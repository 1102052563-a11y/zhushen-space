const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "../产出/批次219");
fs.mkdirSync(OUT, { recursive: true });
function W(name, body) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, body.replace(/\r\n/g, "\n"), "utf8");
  const t = fs.readFileSync(p, "utf8");
  const plot = (t.split("## 阶位切入点")[0] || "").replace(/\s/g, "").length;
  const entry = ((t.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "").replace(/\s/g, "").length;
  console.log(name, "plot", plot, "entry", entry, plot >= 10000 && entry >= 1500 ? "OK" : "NEED");
}
