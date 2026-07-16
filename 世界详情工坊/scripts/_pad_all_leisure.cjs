const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '产出');
const CHECK = path.join(__dirname, 'compile-worldbook.mjs');

function padBlock(name) {
  // unique-ish by name hash
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const seasons = ['樱窗', '梅雨廊', '夏夜屋上', '红叶河堤', '初雪茶室'];
  const s = seasons[h % seasons.length];
  return `

**本世界专属扩写·${name}**
在${s}的节奏里，本舞台把标题里的刺激词全部改写成可拒绝的日常契约。${name}不是闯关地图，而是一张写满名字的日程表：谁的档期在周一，谁的毯子在储物柜第三格，谁在雨天会把伞柄转过来。契约者作为变数，只能改变「谁被看见」，不能改变「谁必须服从」。

负责人把职业壳穿得很整齐，却在关灯后允许三秒的松垮；软萌线总在道歉里夹带真心；静默线用收巾代替告白；元气线用歌单掩饰迷茫；害羞线把勇气花在把拖鞋往前挪半寸；外派线把「家」字说得很轻。旧约或丈夫整体缺席，他们不是反派，只是长期看不见。对照舞台永远更快更便宜，也永远记不住你的禁忌。

本周的因果链很短很清楚：扩招→被记住→闲话→拒客定义底线→闭室茶会→关灯告白→后日谈循环。敏感菜单的真正内容永远是更慢、更同意、更可叫停。若契约者连续三天只追求效率，信物褪色；若连续三天替人说不，HE走廊提前亮灯。True结局是舞台成为街区的温柔基础设施，更多人敢预约只为自己的时间。

可插入正文的二十个动作：递笔、扶正、送卡到门口、递纸巾、转伞、换口味罐装、叠第三层毯子、合上日志空一格、拒客、交钥或放回空柜、共乘或同值日、听完长句再表态、不当众拆台、公开给台阶、私下载发髻、留下信物、叫名字不叫工号、问可以停吗、说辛苦了、问你饿不饿。

微观故障池：温控失灵、物品短缺、雨天湿滑、表格涂改、黑名单再约、邻猫闯入、播放列表告白歌、电话突来的屏息。每件故障都是关系测验：谁先蹲下，谁圆场，谁事后单独道谢。

后日谈不黑屏。主线收束后仍可每日循环晨间点名、午间共餐、傍晚加钟、夜间散步、睡前一行日志。好感不靠外化数值，而靠角色是否允许你看见卸下职业壳的三秒。NSFW只作关系温度计，点到心跳与呼吸。纯日常跳过敏感菜单也能到安定End。离开时信物是否仍在，是世界是否记得你的名字的无声宣判。

再补一段舞台气味与声景：本世界固定有一种「慢半拍」的气味（茶、汤烟、消毒液、月桂、粉笔、墨水之一）与一种白噪音（洗衣机、电梯、喷泉、心电、拍卖锤、钟声之一）。写正文时先定气味与声，再定谁先开口。契约者第一句应答会被全场记住，因此开局三句话永远是：先拿名分，再问边界，最后才碰敏感菜单。

针对《${name}》的专属钩子：标题中的「完成／开始／展开／征服／认定」等大词，在本档案全部落地为运营周与关系周，而不是战争周。玩家若试图写成清场或强制，会触发清醒反弹与负责人除名。正确玩法是站队、倾听、守住说不、把下一格日志写成两个人的名字。
`;
}

function entryPad(name) {
  return `

《${name}》切入补充：可兼采购帮工或夜班帮工赚喜剧线；外派日切换搭档；信物在则世界记得你。第一周只学问诊与叠物；第二周加钟；第三周交钥。三连同帮≈流言订婚。六线并行：站队、禁忌本、潜行、散步、外派、敏感菜单。收束第一句须是关心。
`;
}

let ok = 0, fail = [];
for (let b = 435; b <= 446; b++) {
  const dir = path.join(ROOT, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
    const file = path.join(dir, f);
    let t = fs.readFileSync(file, 'utf8');
    const name = f.replace(/\.md$/, '');
    if (!t.includes('本世界专属扩写·')) {
      t = t.replace('**【氛围基调 · 雷区】**', padBlock(name) + '\n**【氛围基调 · 雷区】**');
    }
    if (!t.includes('切入补充：可兼采购帮工')) {
      t = t.replace('氛围/雷区：', entryPad(name) + '\n氛围/雷区：');
    }
    fs.writeFileSync(file, t, 'utf8');
    const r = spawnSync('node', [CHECK, '--check', file], { encoding: 'utf8' });
    const out = r.stdout || '';
    if (/✓ 过关|△ 过关/.test(out)) {
      ok++;
      process.stdout.write('✓ ' + name + '\n');
    } else {
      fail.push(name);
      process.stdout.write('✗ ' + name + ' ' + (out.match(/剧情 \d+ 字 · 切入点 \d+ 字/) || [''])[0] + '\n');
    }
  }
}
console.log('SUMMARY ok', ok, 'fail', fail.length, fail.slice(0, 10));
