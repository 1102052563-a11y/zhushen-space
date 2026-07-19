import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const root = "产出";
const cliche = [
  /跨媒介流行作品/,
  /可被契约者切入的完整任务世界/,
  /【扩写[·・]/,
  /【补密/,
  /【加厚[·・]/,
  /【补段/,
  /【扩段/,
  /【再补/,
  /【细目\d/,
  /【剧情补述/,
  /女主A/,
  /群像模板/,
  /核心道侣线/,
  /众人模板/,
  /本阶可刷/,
  /应转化为可观察细节/,
  /【关系执行备忘/,
  /【周常节律/,
  /【物证与记忆/,
  /【语言雷区自检/,
  /【扮演铁则/,
  /【长线交付/,
  /【对话与选择/,
  /【季节名场面/,
  /切入身份补充/,
  /切入时点补充/,
  /初始处境补充/,
  /开场白补充/,
  /日常玩法补充/,
  /氛围补充/,
  /关系进度：0初识/,
  /长线交付物：/,
  /周常：工作日公开脸/,
  /开场白备用：/,
];

const results = [];
for (let d = 821; d <= 830; d++) {
  const dir = path.join(root, `批次${d}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const full = path.join(dir, f);
    const t = fs.readFileSync(full, "utf8");
    const m = t.match(/## 剧情\s*([\s\S]*?)(?=\n## |$)/);
    const plot = m ? m[1] : "";
    const chars = [...plot].filter((c) => !/\s/.test(c)).length;
    const hits = cliche.filter((r) => r.test(t)).map((r) => r.source);
    // also run compile check
    const r = spawnSync(
      "node",
      ["scripts/compile-worldbook.mjs", "--check", full],
      { encoding: "utf8" }
    );
    const text = (r.stdout || "") + (r.stderr || "");
    let status = "UNK";
    if (text.includes("不过关")) status = "HARD";
    else if (text.includes("有警告")) status = "WARN";
    else if (text.includes("过关")) status = "OK";
    const short = chars < 7500;
    const need = short || hits.length > 0 || status === "HARD";
    results.push({
      batch: d,
      file: f,
      chars,
      hits,
      status,
      short,
      need,
      check: text.trim().split("\n").slice(-3).join(" | "),
    });
  }
}

const need = results.filter((r) => r.need);
const ok = results.filter((r) => !r.need);
console.log(`TOTAL ${results.length} NEED ${need.length} OK_SKIP ${ok.length}`);
console.log("---NEED---");
for (const r of need) {
  console.log(
    `b${r.batch}|${r.chars}|${r.status}|hits=${r.hits.length}|short=${r.short}|${r.file}`
  );
  if (r.hits.length) console.log("  " + r.hits.join(", "));
  console.log("  " + r.check);
}
console.log("---OK---");
for (const r of ok) {
  console.log(`b${r.batch}|${r.chars}|${r.status}|${r.file}`);
}
fs.writeFileSync(
  "_tmp_scan_821_830.json",
  JSON.stringify({ need, ok, all: results }, null, 2)
);
