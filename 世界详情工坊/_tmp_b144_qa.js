const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "产出", "批次144");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const md = fs.readFileSync(path.join(dir, f), "utf8");
  const pad = (md.match(/【补密|【加厚|【扩写|【细目|群像|红颜(?!线)|牙人/g) || []).length;
  const src = md.split("## 来源")[1] || "";
  const https = (src.match(/https:\/\//g) || []).length;
  const sobqg = /sobqg/.test(src);
  const plot = (md.split("## 阶位切入点")[0].split("## 剧情")[1] || "").replace(/\s/g, "").length;
  const entry = ((md.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "").replace(/\s/g, "").length;
  console.log(JSON.stringify({ f, plot, entry, pad, https, sobqg }));
}
