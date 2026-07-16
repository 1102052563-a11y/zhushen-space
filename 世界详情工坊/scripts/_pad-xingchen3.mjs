import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fp = path.join(ROOT, '产出', '批次02', '星辰变.md');
let t = fs.readFileSync(fp, 'utf8');

const block = `
**【神界城池】**
南部镜光城每日六时辰白昼之光，北部飘雪城每日六时辰黑暗夜幕，两者错开。城中神灵之气宁静可修炼；离城越远之气越狂暴。神之力狂暴负荷大，天神之力精纯温和。写神界场景必须有城籍与气之宁静与否。

**【宝物品质链】**
灵器、仙器、神器、天神器、鸿蒙灵宝、天尊灵宝逐级。材料与一元重水、鸿蒙灵气为高阶硬通货。低阶任务禁止发放鸿蒙与天尊级。

**【终局主题句】**
鸿蒙不是无敌皮肤，是规则席位与创造责任；秦羽与姜立共创万物，想护的人要有地站。

**【配角群像真名】**
端木云、端木茹凤、端木玉、端木风、皇甫御、皇甫雷、皇甫裂钧、皇甫静、羽刹、珐蓝、麻阗、淳于柔、周然、周青、禹璇、天狼殿主、风昕、云隐、侯杏等以原作层次登场，低阶只闻名号。
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
console.log('pad', (t.match(/【(加厚|细则|补段|扩段|再补|终卷|三轮|叙事执行)/g) || []).length);
