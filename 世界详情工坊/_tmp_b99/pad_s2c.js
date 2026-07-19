const fs = require('fs');
const p = '产出/批次99/美国恐怖故事S2.md';
let t = fs.readFileSync(p, 'utf8');
const needle = '最早可切入：1964 Kit 入院前后，或现代废院探险夜。';
if (!t.includes(needle)) {
  console.log('needle missing');
  const i = t.indexOf('最早可切入');
  console.log(JSON.stringify(t.slice(i, i + 80)));
} else {
  t = t.replace(
    needle,
    needle +
      '契约者记住：在荆棘崖，活着离开本身就是战绩，真相比拳头更贵；别用序列魔药逻辑硬套本季。'
  );
  fs.writeFileSync(p, t);
}
const strip = s => s.replace(/\s/g, '').length;
const m = t.match(/## 剧情([\s\S]*?)## 阶位切入点/);
console.log('plot', m ? strip(m[1]) : 'no', 'has sources', t.includes('## 来源'));
