import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const p = path.resolve(
  '产出/批次322/推得过火 (OshiRabu－ Waifus Over Husbandos).md',
);
let t = fs.readFileSync(p, 'utf8');

const extra = `
终章语气备忘：当あくる终于在便利店袋还没放下时先说「我回来了」而不是先点开ガチャ，恋的「欢迎回家」会比任何求婚句都重。正文应允许她们继续玩ソシャゲ，只是优先级从「推＞一切」改成「人＞推＞加班」。若写后日谈，可让志乃的新本封面画成两人背影走在公司灯下，标题故意起得很土，她们却笑着买下——那是被朋友见证的 HE。

再补一段生活密度：周日上午あくる想补觉，恋在厨房研究「推同款便当」失败成焦味；烟味报警器响起来时两人对视，忽然一起笑场，冷战自动结束。周一通勤あくる把耳机分一半给恋听推的角色歌，恋听完只说「声音好听，但还是你比较好看」——直球到让社畜想逃进车门缝。晚上志乃发消息：「今天别出轨卡池，出轨也要出轨现实。」配一张两人上周在居酒屋的偷拍照。这些碎屑堆起来，比任何长篇告白更接近本世界的「真结局」。
`;

const i1 = t.indexOf('\n## 休闲切入点');
if (i1 < 0) throw new Error('no entry');
t = t.slice(0, i1) + '\n' + extra + t.slice(i1);
fs.writeFileSync(p, t);
const r = spawnSync(
  'node',
  ['scripts/compile-worldbook.mjs', '--check', p],
  { encoding: 'utf8', cwd: path.resolve('.') },
);
console.log(r.stdout);
console.log('exit', r.status);
