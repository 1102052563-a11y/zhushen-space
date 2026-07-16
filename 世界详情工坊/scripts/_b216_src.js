const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "产出", "批次216");

function fix(file, lines) {
  const p = path.join(dir, file);
  let t = fs.readFileSync(p, "utf8");
  const i = t.lastIndexOf("## 来源");
  if (i < 0) throw new Error("no source " + file);
  t = t.slice(0, i) + "## 来源\n\n" + lines.map((l) => "- " + l).join("\n") + "\n";
  fs.writeFileSync(p, t);
  console.log("fixed", file);
}

fix("尘白禁区.md", [
  "[尘白禁区 - 维基百科](https://zh.wikipedia.org/wiki/尘白禁区)",
  "[Snowbreak official](https://snowbreak.amazingseasun.com/)",
  "[TapTap 尘白禁区](https://www.taptap.cn/app/232254)",
]);

fix("少女前线.md", [
  "[少女前线 - 维基百科](https://zh.wikipedia.org/wiki/少女前线)",
  "[Girls' Frontline - Wikipedia](https://en.wikipedia.org/wiki/Girls%27_Frontline)",
  "[少女前线官网](https://gf.sunborngame.com/)",
]);
