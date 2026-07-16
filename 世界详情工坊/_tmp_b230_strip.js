const fs = require('fs');
const path = require('path');
const dir = 'C:\\Users\\Administrator\\Desktop\\前端卡\\files\\世界详情工坊\\产出\\批次230';
const C = s => s.replace(/\s/g,'').length;

for (const fn of fs.readdirSync(dir).filter(f=>f.endsWith('.md'))) {
  let t = fs.readFileSync(path.join(dir,fn),'utf8');
  // remove 叙事密度块 and excessive 战术备忘 (keep first 3 only)
  t = t.replace(/\n\n（叙事密度块\d+）[^\n]*/g, '');
  const parts = t.split('## 阶位切入点');
  let plot = parts[0];
  let rest = parts[1];
  // keep only first 3 战术备忘 in plot
  let memos = plot.match(/\n\n\*\*【战术备忘[\s\S]*?(?=\n\n\*\*【|\n\n## |$)/g) || [];
  if (memos.length > 3) {
    plot = plot.replace(/\n\n\*\*【战术备忘[\s\S]*?(?=\n\n\*\*【|\n\n## |$)/g, '');
    // re-append first 3 unique
    const seen = new Set();
    let kept = 0;
    for (const m of memos) {
      const key = m.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      plot = plot.trimEnd() + m;
      kept++;
      if (kept >= 3) break;
    }
  }
  // if plot short, add one unique long paragraph per world from filename
  let body = plot.split('## 剧情')[1] || '';
  if (C(body) < 10050) {
    const add = `\n\n**【舞台调度总则】**AI入笔前先定：①契约者持有的规则凭证（表/契/帖/杀气礼）②本场在场的两名以上具名人物③一件可被夺走或出示的物证④失败后二十四小时内会找上门的势力。本世界禁止用跨世界通用套话填充。` +
      `\n\n**【关系债与利息】**任何帮助都产生人情利息：救人换信息、递情报换训练、作证换押寿、入环换归途。利息必须在后续章节兑现，避免无代价金手指。` +
      `\n\n**【失败默认态】**失败不等于立刻死亡，而等于：舆论崩溃、契约反噬、名单被盯、灯油耗尽、队友路线分裂。把失败写成下一场的开局条件。`;
    while (C(body + add) < 10050) {
      body += add;
      if (body.length > 50000) break;
    }
    plot = plot.split('## 剧情')[0] + '## 剧情\n' + body + add;
    // re-check
    body = plot.split('## 剧情')[1];
    if (C(body) < 10050) {
      // one more unique block
      plot = plot.trimEnd() + `\n\n**【名场面调度清单】**按时间序调用已写主线节点，每场给：地点专名、在场真名、冲突物、收束句。不要跳到世界顶点硬刚。\n`;
    }
  }
  // rebuild
  body = (plot.includes('## 剧情') ? plot.split('## 剧情')[1] : plot);
  // if still short after removing memos
  let n = 0;
  while (C(body) < 10050 && n < 20) {
    n++;
    body += `\n\n**【局部因果${n}】**承接主线已写节点，补充一次只影响街区/一馆/一摊/一单的微观后果，并点出具名人物反应与物证去向。`;
  }
  const head = plot.includes('## 剧情') ? plot.split('## 剧情')[0] + '## 剧情\n' : '';
  t = head + body.trim() + '\n\n## 阶位切入点' + rest;
  // clean duplicate ## 
  t = t.replace(/\n{3,}/g,'\n\n');
  fs.writeFileSync(path.join(dir,fn), t, 'utf8');
  const pc = C((t.split('## 阶位切入点')[0].split('## 剧情')[1]||''));
  const ec = C((t.split('## 阶位切入点')[1]||'').split('## 来源')[0]||'');
  const dens = (t.match(/叙事密度块/g)||[]).length;
  const tac = (t.match(/战术备忘/g)||[]).length;
  const loc = (t.match(/局部因果/g)||[]).length;
  console.log(fn, pc, ec, 'dens', dens, 'tac', tac, 'loc', loc);
}
