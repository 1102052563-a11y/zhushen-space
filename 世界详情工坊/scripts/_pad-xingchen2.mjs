import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fp = path.join(ROOT, '产出', '批次02', '星辰变.md');
let t = fs.readFileSync(fp, 'utf8');

const block = `
**【神界飞升义务与战争】**
飞升者必须去神灵石矿场为圣皇无偿开矿千年，不得反抗外逃，违者神界追杀；每百年缴纳三千六百块下品神灵石，期满分入村落。神界约六十亿年发生一次遍及全界的大战以减少人口：一方端木一族、汤氏一族、木氏一族，另一方姜家与申屠一族，皇甫与浦台中立。白云殿处于祥云深处，掌管神界与无数高等空间及凡人界核心。写九阶政治须用这些制度，而不是只写个人修为数字。

**【暗星界史】**
仙魔妖界本名暗星界。无传承之宝时期混乱争斗；三件传承之宝出现后步入相对和平，金刑君为主、黑焱君与白玄君为辅世代传承。飞升者数量与繁衍使原住民没落。仙界青帝禹皇玄帝，妖界龙皇大猿皇鹏魔皇。写七阶舞台用地图与君主名，不写跨世界套话。

**【星辰变功法观感补】**
星云期体外巨大星云循环吸星辰力；流星期九星精华颗粒；星核九星合一；行星期行星表面天地灵气由荒到绿；恒星期行星皆太阳真核；暗星期攻击力跨阶但灵魂门槛高；黑洞原点吸鸿蒙灵气；乾坤之境白净火与玄黄气；宇宙之境平行空间时间加速与创造生命。写战斗先写负担与环境，再写胜负。

**【凡人界政治补】**
潜龙大陆曾秦统一后分崩，项氏建楚，后三分楚明汉；秦德灭楚复秦；天网分内网外网。非人类东部为无边洪荒。写一阶任务用军功、内鬼、粮草，不用修真货币。

**【逆央与九剑经济】**
第九玉剑所在、拍卖破天图、三方协定、真亦假假亦真，构成钥匙经济。逆央仙帝礼物与死之谜是高阶伏笔。使者下凡改变凡人界定价：你的命突然变贵或变不值钱。契约者止损式收获，不当众举宝。
`;

t = t.replace('## 阶位切入点', block.trim() + '\n\n## 阶位切入点');
fs.writeFileSync(fp, t, 'utf8');
const a = t.indexOf('## 剧情');
const b = t.indexOf('## 阶位切入点');
console.log('plot', t.slice(a, b).replace(/\s/g, '').length);

const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', fp], {
  encoding: 'utf8',
  cwd: ROOT,
});
process.stdout.write(r.stdout || '');
