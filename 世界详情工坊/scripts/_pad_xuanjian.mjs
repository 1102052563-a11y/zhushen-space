import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(ROOT, '产出', '批次03', '玄鉴仙族.md');
let t = fs.readFileSync(p, 'utf8');

const pad = `

**【世界剧情线·族法与祭祀】**
望月李氏家法写的是田亩、过继、奸细与临阵脱逃，不是飞升鸡汤。牲祭法、祭萃夺元、族正院刑罚与白首叩庭等情节，把「族运」压成可执行的恐惧。渊修祭祀、山越血祭与李家灵稻税并存，显示修真文明底层仍是人口与粮食。契约者若在祭祀夜介入，冲突应是：替死鬼名单、假祭品、箓巫反噬、谁有权读铜镜下的族誓。写祭祀先写谁主祭、谁监刑、谁得灵气配额，再写神异异象。

**【世界剧情线·联姻与望姓网络】**
田守水、任平安与李木田同袍奠基；柳林云、柳柔绚泾阳/黎泾柳家入谱；安家骅玉派安鹧言—安思危线与李妃若联姻；丁家浮南派丁威锃、丁予菁入遂还系；萧归鸾嫁李渊蛟，突破筑基失败身死，仍绑萧家。联姻是资源管道也是人质管道。写婚礼先写聘礼灵石、质子与功法交换条款，再写喜宴上的刺客。
`;

if (!t.includes('族法与祭祀')) {
  t = t.replace('## 阶位切入点', pad + '\n## 阶位切入点');
  fs.writeFileSync(p, t.replace(/\n/g, '\r\n'), 'utf8');
}

const doc = fs.readFileSync(p, 'utf8');
const plot = doc.split('## 剧情')[1].split('## 阶位切入点')[0];
const entry = doc.split('## 阶位切入点')[1].split('## 来源')[0];
console.log('plot', plot.replace(/\s/g, '').length);
console.log('entry', entry.replace(/\s/g, '').length);

const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', p], {
  encoding: 'utf8',
  cwd: ROOT,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
