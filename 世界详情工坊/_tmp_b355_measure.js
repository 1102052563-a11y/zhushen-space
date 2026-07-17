const fs = require('fs');
const path = require('path');
const base = String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次355`;

function measure(name, text) {
  const plot = (text.match(/## 剧情([\s\S]*?)## 休闲切入点/) || [])[1] || '';
  const entry = (text.match(/## 休闲切入点([\s\S]*?)## 来源/) || [])[1] || '';
  const strip = s => s.replace(/\s/g, '').length;
  const rel = (text.match(/关系细目/g) || []).length;
  const pad = (text.match(/可观察片段/g) || []).length;
  const pwr = (text.match(/力量体系|战力|阶位|巅峰战力/g) || []).length;
  const src = (text.match(/\]\(https?:\/\//g) || []).length;
  console.log(`${name} plot=${strip(plot)} entry=${strip(entry)} rel=${rel} pad=${pad} pwr=${pwr} src=${src}`);
}

// We'll read prebuilt content files from a generator below
const files = process.argv.slice(2);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  measure(path.basename(f), t);
}
