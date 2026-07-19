const fs = require('fs');
const path = require('path');
const base = __dirname;
const out = path.join(base, '产出');
const pad = [
  '【扩写', '【补密', '【加厚', '【细目', '【补段', '【扩段', '【再补',
  '【终卷补强', '【叙事执行细则', '跨媒介流行作品', '可被契约者切入的完整任务世界',
  '本阶可刷', '相关存在', '代行者', '假货、护送', '【阶段档案', '【剧情补述',
  '【可介入事件', '众人模板', '路人强者群像', '核心道侣线', '女主线之一'
];
const fails = [];
const ok = [];
for (let b = 301; b <= 400; b++) {
  const dir = path.join(out, '批次' + b);
  if (!fs.existsSync(dir)) {
    fails.push({ b, f: '(dir missing)', reasons: ['MISSING_DIR'] });
    continue;
  }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    const leisure = /lib\s*[:=]\s*休闲/.test(c) || c.includes('## 休闲切入点');
    const m = c.match(/## 剧情([\s\S]*?)(?=## (?:阶位切入点|休闲切入点|来源))/);
    const plot = (m ? m[1] : '').replace(/\s/g, '');
    const entryM = c.match(/## (?:阶位切入点|休闲切入点)([\s\S]*?)(?=## 来源|$)/);
    const entry = (entryM ? entryM[1] : '').replace(/\s/g, '');
    const minP = leisure ? 6000 : 10000;
    const minE = 1500;
    const junk = pad.filter((j) => c.includes(j));
    const lines = c.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 50);
    const cnt = {};
    for (const l of lines) cnt[l] = (cnt[l] || 0) + 1;
    const dups = Object.entries(cnt).filter(([, n]) => n >= 3);
    const src = (c.match(/https?:\/\//g) || []).length;
    const hasSrc = c.includes('## 来源');
    const hasEntry = c.includes('## 阶位切入点') || c.includes('## 休闲切入点');
    const reasons = [];
    if (!m) reasons.push('no_plot_section');
    if (plot.length < minP) reasons.push('short_plot:' + plot.length + '<' + minP);
    if (entry.length < minE) reasons.push('short_entry:' + entry.length + '<' + minE);
    if (junk.length) reasons.push('junk:' + junk.join('|'));
    if (dups.length) reasons.push('dups:' + dups.length);
    if (src < 3) reasons.push('src:' + src);
    if (!hasSrc) reasons.push('no_src_header');
    if (!hasEntry) reasons.push('no_entry');
    // thin unique content: low unique proper-noun density heuristic
    if (leisure && !c.includes('【可攻略角色') && !c.includes('【可攻略角色 / 主要人物】')) {
      reasons.push('no_char_section');
    }
    if (!leisure && !c.includes('【主要人物】')) reasons.push('no_char_section');
    const row = { b, f, leisure, plot: plot.length, entry: entry.length, src, reasons };
    if (reasons.length) fails.push(row);
    else ok.push(row);
  }
}
const report = {
  total: fails.length + ok.length,
  ok: ok.length,
  fail: fails.length,
  fails,
};
fs.writeFileSync(path.join(base, '_tmp_qa_301_400.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, ok: report.ok, fail: report.fail }, null, 2));
// group reasons
const rc = {};
for (const x of fails) for (const r of x.reasons) {
  const k = r.split(':')[0];
  rc[k] = (rc[k] || 0) + 1;
}
console.log('reason counts', rc);
console.log('first 25 fails:');
for (const x of fails.slice(0, 25)) console.log(x.b, x.f, x.plot, x.reasons.join('; '));
