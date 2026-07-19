import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.resolve('产出');
let ok=0, warn=0, hard=0;
const hardList=[];
for (let d=801; d<=870; d++) {
  const dir = path.join(root, `批次${d}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md'))) {
    const full = path.join(dir, f);
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], {encoding:'utf8'});
    const text = (r.stdout||'') + (r.stderr||'');
    if (text.includes('不过关')) { hard++; hardList.push(`b${d}/${f}`); }
    else if (text.includes('有警告')) warn++;
    else if (text.includes('过关')) ok++;
    else { hard++; hardList.push(`UNK b${d}/${f}`); }
  }
}
console.log(`OK=${ok} WARN=${warn} HARD=${hard}`);
hardList.forEach(x=>console.log(x));
