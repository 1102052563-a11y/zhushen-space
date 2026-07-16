const fs=require('fs');
function s(f){const t=fs.readFileSync(f,'utf8').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');console.log(t.slice(0,3500));console.log('---TAIL---');console.log(t.slice(3500,6500));}
s('_s2full.html');
console.log('====ER====');
s('_egfull.html');
