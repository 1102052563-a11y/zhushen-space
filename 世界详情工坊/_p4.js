const fs=require('fs');
const h=fs.readFileSync('_sall.html','utf8');
// extract title-id pairs from links
const re=/href="\/v(\d+)"[^>]*>\s*([^<]*Saimin[^<]*)/gi;
let m; const out=[];
while((m=re.exec(h)) && out.length<15) out.push(m[1]+' '+m[2]);
console.log(out.join('\n')||'none');
console.log(h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').match(/Saiminjutsu[\s\S]{0,800}/)?.[0]);
if(fs.existsSync('_s2full.html')) console.log('1604', fs.readFileSync('_s2full.html','utf8').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1500));
