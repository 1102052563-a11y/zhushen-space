const https=require('https');
const fs=require('fs');
function get(url){return new Promise((res,rej)=>{https.get(url,{headers:{'User-Agent':'Mozilla/5.0'}},r=>{let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async()=>{
  const html=await get('https://m.qidian.com/book/3249362/catalog/');
  const chs=[...html.matchAll(/"cN":"([^"]+)"/g)].map(m=>m[1]);
  const idx=[0,21,40,80,120,200,350,500,650,800,950,1100,1250,1400];
  let out='TOTAL='+chs.length+'\n';
  for(const i of idx){ if(i<chs.length) out+=i+': '+chs[i]+'\n'; }
  out+='\nKEY:\n';
  out+=chs.filter(c=>/卷|隐皇|六扇|轮回|传说|造化|法身|顾|江|少林|玉虚|九幽|如来|元始|截天|神掌|孟奇|真定|外景|内景/.test(c)).slice(0,100).join('\n');
  out+='\n\nLAST40:\n'+chs.slice(-40).join('\n');
  fs.writeFileSync('_tmp_b860_yishi_struct.txt', out, 'utf8');
  console.log('ok', chs.length);
})().catch(e=>{console.error(e);process.exit(1);});
