const fs=require('fs');
function s(f){if(!fs.existsSync(f))return;const t=fs.readFileSync(f,'utf8').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');console.log('===='+f);console.log(t.slice(0,2200));}
for(const f of ['_hd.html','_s2b.html','_yas2.html','_nu.html','_in.html','_kk2.html']) s(f);
