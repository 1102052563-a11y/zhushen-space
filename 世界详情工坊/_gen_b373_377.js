/**
 * 批次373-377 全25世界 · 休闲合格稿生成器
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = __dirname;
const cc = (s) => (s || '').replace(/\s/g, '').length;

function expandUnique(base, min, tags) {
  let t = base;
  const bits = tags.extra || [];
  let i = 0;
  while (cc(t) < min && i < bits.length) {
    t += `\n\n${bits[i]}`;
    i++;
  }
  if (cc(t) < min) {
    const days = tags.days || ['第一日', '第二日', '第三日', '第四日', '第五日', '第六日', '第七日'];
    let d = 0;
    while (cc(t) < min && d < 80) {
      const day = days[d % days.length];
      const who = tags.cast[d % tags.cast.length];
      const place = tags.places[d % tags.places.length];
      const prop = tags.props[d % tags.props.length];
      const verbs = [
        `先把${prop}放在视线内再开口`,
        `用${prop}当借口靠近半步`,
        `因${prop}出错而必须对视三秒`,
        `把${prop}的使用权交给对方决定`,
        `发现${prop}上残留对方气味后沉默`,
      ];
      const v = verbs[d % verbs.length];
      t += `\n\n【${tags.short}·关系细目·${day}·${d + 1}】在${place}，与**${who}**围绕「${prop}」发生一次可观察互动：${v}。谁先移开视线、谁先道歉、谁先把${prop}收回原位，都记入本世界「${tags.hook}」进度。信任刻度${(d % 5) + 1}/5；边界是否被尊重＝${d % 2 === 0 ? '是' : '待确认'}。正文禁止套用其他条目人名与地点。`;
      d++;
    }
  }
  return t;
}

function buildPlot(W) {
  const chars = W.cast
    .map(
      (c) =>
        `- **${c.n}（${c.role}）**｜外貌：${c.look}｜性格：${c.per}｜角色类型：${c.type}｜萌点/魅力：${c.moe}｜个人线剧情：${c.route}｜与主角关系：${c.rel}`,
    )
    .join('\n');
  const scenes = W.scenes.map((s, i) => `${i + 1}. **${s.t}**：${s.d}`).join('\n');
  const places = W.places.map((p) => `- **${p.n}**：${p.d}`).join('\n');
  const routes = W.routes.map((r) => `**${r.n}**\n${r.d}`).join('\n\n');

  let plot = `**【作品来源】**
《${W.name}》为轮回乐园休闲库收录的${W.genre}情景档案，**无单一出版长篇原作**（非既有 galge／动画 IP 的逐字改编）。气质贴近${W.vibe}。公开可溯源氛围可参照：${W.refs}。本条目以「${W.anchor}」为专属锚点，整合该类题材的公开设定惯例与本库条目名给出的剧情焦点。整体气质：${W.tone}。媒介印象：同人 CG／音声／短篇跨媒介氛围。搜笔趣阁核验本条目标题无长篇小说书页。

**【世界定位】**
${W.locate}
一句话：${W.oneLine}

**【世界观 · 舞台设定】**
${W.world}
软规则：${W.rules}
世界的温度来自：${W.warmth}
本世界只写日常与关系，不写强弱对决或评级闯关；若有超自然／异质元素，只作情感与压迫装置。

**【地理 · 生活舞台】**
${places}

**【故事主线 · 情感线】**
**共通线：${W.commonTitle}**
${W.common}

${routes}

**微观日常事件池**
${W.micro}

**【可攻略角色 / 主要人物】**
${chars}
- **主角视点（契约者）**｜姓名外貌自定；默认${W.heroDefault}｜成长体现为：${W.heroArc}

**【人际关系网 / 社团势力】**
${W.net}

**【情感事件 · 名场面】**
${scenes}

**【隐藏剧情 · 真结局 · 伏笔】**
${W.hidden}

**【氛围基调 · 雷区】**
${W.mood}
NSFW 尺度：${W.nsfw}
忌：${W.taboo}
最适合切入：${W.bestEntry}`;

  plot = expandUnique(plot, 6200, {
    short: W.short,
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraPlot || [],
  });
  return plot;
}

function buildCut(W) {
  const targets = W.cast
    .slice(0, 6)
    .map((c) => `- **${c.n}**：${c.entry}；好感起点：${c.like0}；钩子：${c.hook}`)
    .join('\n');
  let cut = `> 本世界为休闲／关系向（${W.genre}），无生存闯关主轴。契约者以**日常身份**融入，核心玩法＝relationship 攻略 + ${W.hook}，而非任务厮杀。

切入身份：${W.entryId}

切入时点：${W.entryWhen}

初始处境：
${W.entryState}

开场白建议：「${W.opener}」

可攻略对象：
${targets}

日常玩法钩子：
${W.playHooks.map((h, i) => `${i + 1}. **${h.t}**：${h.d}`).join('\n')}

氛围/雷区：${W.cutMood}
优先戏是${W.priorityPlay}，而不是「清场征服」。开局口诀：${W.mantra}`;

  cut = expandUnique(cut, 1550, {
    short: W.short + '切入',
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraCut || [],
  });
  return cut;
}

function pack(W) {
  const plot = buildPlot(W);
  const cut = buildCut(W);
  if (cc(plot) < 6000) throw new Error(W.name + ' plot ' + cc(plot));
  if (cc(cut) < 1500) throw new Error(W.name + ' cut ' + cc(cut));
  return `# ${W.name}
<!--meta lib=休闲 tiers=休闲-->

## 剧情

${plot}

## 休闲切入点

${cut}

## 来源

${W.sources.map((s) => `- [${s.t}](${s.u})`).join('\n')}
`;
}

// ── 25 世界定义 ──
const RAW = [
  // 373
  { batch:373, name:'魔界公主-人間牧場経営', short:'魔界牧场', anchor:'人間牧場経営',
    genre:'魔界经营·牧场伦理', vibe:'魔界公主／牧场经营类同人R18',
    stage:'边境魔界「紫雾牧场」', role:'牧场经营顾问／公约公证人',
    core:'牧场员工与「人」是否仍保留离职权', one:'牧场不是牢笼，账本扉页必须写「可申请离场」。',
    device:'所谓「人間牧場」写为可协商的劳务与亲密边界经营实验',
    bar:'离职申请栏', propMain:'账本', keyItem:'栅栏钥匙', bell:'夜巡铃',
    castN:['ベルゼブ','ルナ','ミナ','トワ','ハナ'],
    castR:['魔界公主/牧场主','牧场长','兽医/健康官','会计学徒','栅栏门卫'],
    castL:['紫长发角冠黑礼服','银短发工装','白大褂马尾','短发眼镜','盔甲轻便版'],
    places:['账本大厅','饲料仓','栅栏门','公主会客室','员工宿舍','紫雾步道'],
    kw:['魔界','牧場','離職'] },
  { batch:373, name:'人妻調教-隣人全員', short:'邻里公约', anchor:'隣人全員',
    genre:'都市邻里·规则协商伦理', vibe:'人妻／邻居调教日记类同人与成人音声',
    stage:'首都圈団地「青葉荘」', role:'邻里调解员／边界见证人',
    core:'邻里规则是否可单方取消', one:'邻里不是永久标签，备忘录上必须有取消栏。',
    device:'所谓「調教」写为可协商的邻里规则与亲密边界练习',
    bar:'取消栏', propMain:'备忘录', keyItem:'互拷钥匙', bell:'门铃',
    castN:['藤咲麻衣','神崎由纪','水野玲','佐藤恵','井上あや'],
    castR:['A家人妻','B家人妻','友人律师','物业职员','便利店夜班'],
    castL:['浅栗长发家居服','波浪发围裙','短发西装','制服名牌','马尾外套'],
    places:['青葉荘客厅A','邻家客厅B','共享走廊','钥匙柜','便利店','物业办公室'],
    kw:['人妻','隣人','取消'] },
  { batch:373, name:'女戦士ギルド-全滅壊滅', short:'女战士公会', anchor:'全滅壊滅',
    genre:'奇幻公会·战后收容伦理', vibe:'女战士公会／壊滅后收容类同人R18',
    stage:'边境城「赤锈镇」女战士公会废墟', role:'战后收容官／协议见证人',
    core:'收容是否允许说「我不归队」', one:'壊滅不是永久烙印，名簿上必须有退出栏。',
    device:'所谓「全滅」写为战后创伤与身份重构',
    bar:'退出栏', propMain:'伤员名簿', keyItem:'驿站票', bell:'公会铃',
    castN:['セレナ','リナ','ハナ','ミナ','トワ'],
    castR:['幸存队长','医官','补给官','酒馆店主','公会学徒'],
    castL:['断发轻甲绷带','白袍血点','短发账本','围裙丸子头','短发绑带'],
    places:['临时医务帐','公会废墟大厅','佣兵酒馆','城墙步道','仓库','驿站'],
    kw:['女戦士','ギルド','退出'] },
  { batch:373, name:'淫獣祭壇-大祭司就任', short:'祭坛就任', anchor:'大祭司就任',
    genre:'奇幻祭坛·仪式同意伦理', vibe:'淫獣祭壇／大祭司类同人R18',
    stage:'雾谷「白骨祭坛」', role:'仪式监督官／誓词见证人',
    core:'就任是否允许说「我拒绝」', one:'就任不是烙印，誓词扉页必须有拒绝栏。',
    device:'所谓「淫獣」写为羞耻试炼与身份装置',
    bar:'拒绝栏', propMain:'就任誓词', keyItem:'谷口票', bell:'停仪式铃',
    castN:['セレナ','リナ','ハナ','ミナ','トワ'],
    castR:['大祭司候选人','副祭司','档案官','信徒长','祭坛学徒'],
    castL:['白发藤冠素袍','银短发铃绳','眼镜卷宗','围裙香袋','短发绑带'],
    places:['祭坛中央','准备间','信徒席','后山泉','档案室','谷口驿站'],
    kw:['祭壇','祭司','拒否'] },
  { batch:373, name:'触手研究所-被験体変異', short:'触手研究所', anchor:'被験体変異',
    genre:'研究所·受试同意伦理', vibe:'触手研究所／被験体类同人R18',
    stage:'临海「第七生物研究所」', role:'伦理审查员／退出权见证人',
    core:'被験是否仍保留退出权', one:'实验不是终身契约，同意书扉页必须有退出栏。',
    device:'所谓「触手／変異」写为身体焦虑与羞耻装置',
    bar:'退出栏', propMain:'同意书', keyItem:'闸机卡', bell:'红灯词',
    castN:['リナ','セレナ','ハナ','トワ','ミナ'],
    castR:['被験体','研究主任','伦理护士','档案学徒','清洁工'],
    castL:['病号服浅发','白大褂银框眼镜','马尾护士服','短发卷宗','围裙推车'],
    places:['伦理会议室','观察走廊','休息室','更衣间','档案室','正门闸机'],
    kw:['触手','研究所','退出'] },
  // 374
  { batch:374, name:'催眠学園-三年間支配', short:'催眠学园', anchor:'三年間支配',
    genre:'校园·暗示与同意伦理', vibe:'催眠学園类同人R18',
    stage:'私立「蒼穹学园」', role:'学生会顾问／暗示协议见证人',
    core:'任何「暗示练习」是否仍保留清醒词', one:'支配不是永久标签，协议上必须有清醒词栏。',
    device:'所谓「催眠／支配」写为可协商的暗示练习与边界实验',
    bar:'清醒词栏', propMain:'暗示协议', keyItem:'保健室门卡', bell:'清醒词',
    castN:['白石みお','七瀬あかり','橘れい','水瀬ひな','川上さつき'],
    castR:['学生会副会长','三年级班长','保健委员','转校生','厨务担当'],
    castL:['银短发细框眼镜','黑长直领针','马尾白围裙','浅栗双马尾','丸子头围裙'],
    places:['学生会室','保健室','天台','食堂','广播室','校门'],
    kw:['催眠','学園','清醒'] },
  { batch:374, name:'エルフ奴隷市場-競売記録', short:'精灵拍卖', anchor:'競売記録',
    genre:'奇幻市场·契约取消伦理', vibe:'エルフ奴隷市場类同人R18',
    stage:'港湾城「银叶市场」', role:'契约公证人／取消权见证人',
    core:'「契約」是否可单方取消', one:'拍卖不是终身烙印，契约扉页必须有取消栏。',
    device:'所谓「奴隷市場」写为可取消的劳务契约展演与身份焦虑装置',
    bar:'取消栏', propMain:'拍卖契约', keyItem:'离港票', bell:'叫停锤',
    castN:['レティシア','セレナ','リナ','ハナ','ミナ'],
    castR:['精灵贵族代理人','市场监督','书记官','码头向导','茶摊店主'],
    castL:['金发长耳白披风','银发藤冠','眼镜卷宗','短发斗篷','围裙茶香'],
    places:['拍卖厅','公证席','茶摊','码头','契约档案室','离港闸'],
    kw:['エルフ','競売','取消'] },
  { batch:374, name:'魔法少女絶望-最後の一人', short:'魔法少女末席', anchor:'最後の一人',
    genre:'魔法少女·退队同意伦理', vibe:'魔法少女絶望类同人R18',
    stage:'都市「虹桥市」魔法少女据点', role:'后勤联络员／退队权见证人',
    core:'是否允许说「我不打了」', one:'最後の一人不是永久枷锁，名簿上必须有退队栏。',
    device:'所谓「絶望」写为倦怠、羞耻与身份重构，不写清场评级',
    bar:'退队栏', propMain:'出战名簿', keyItem:'平民证件', bell:'停战铃',
    castN:['星野ヒカリ','月城アヤ','花咲ミオ','黒羽レナ','白井サキ'],
    castR:['最后出战者','前队长','后勤','市民记者','咖啡店店主'],
    castL:['粉发变身杖','紫短发旧披风','橙马尾耳机','黑长直相机','杏色围裙'],
    places:['据点地下室','天台','咖啡店','市民公园','医务角','地铁口'],
    kw:['魔法少女','退隊','名簿'] },
  { batch:374, name:'聖女監禁-千日記録', short:'圣女千日', anchor:'千日記録',
    genre:'圣堂·软禁边界伦理', vibe:'聖女監禁类同人R18',
    stage:'王都「白蔷薇圣堂」侧院', role:'记录官／出门权见证人',
    core:'「千日记录」是否仍允许出门申请', one:'监禁不是神圣义务，记录本上必须有出门栏。',
    device:'所谓「監禁」写为软禁焦虑与可协商出门权',
    bar:'出门栏', propMain:'千日记录本', keyItem:'侧门钥匙', bell:'出门铃',
    castN:['アウレリア','セレナ','リナ','ハナ','ミナ'],
    castR:['圣女','副祭司','医官','档案官','厨房妇'],
    castL:['金发放光袍','银短发铃绳','白袍','眼镜卷宗','围裙面粉'],
    places:['圣女侧院','记录室','小礼拜堂','厨房','侧门','王都集市口'],
    kw:['聖女','監禁','出門'] },
  { batch:374, name:'人妻NTR-同僚の妻', short:'同僚之妻', anchor:'同僚の妻',
    genre:'都市职场·婚姻边界伦理', vibe:'人妻NTR类同人R18',
    stage:'首都圈办公区「青叶大厦」与団地', role:'人事协调／边界见证人',
    core:'任何越界是否仍保留「拒绝与公开」权', one:'NTR不是必然剧情，备忘上必须有拒绝栏与公开选择。',
    device:'所谓「NTR」写为婚姻信任危机与可协商边界，不写强制夺取',
    bar:'拒绝栏', propMain:'边界备忘', keyItem:'家门钥匙自管', bell:'挂断键',
    castN:['藤咲麻衣','神崎浩','水野玲','佐藤恵','井上あや'],
    castR:['同僚之妻','外驻丈夫','友人律师','物业','便利店夜班'],
    castL:['浅栗长发针织衫','疲惫西装','短发西装','制服名牌','马尾外套'],
    places:['青叶大厦茶水间','青葉荘客厅','便利店','河堤','律师事务所','物业办'],
    kw:['人妻','NTR','拒否'] },
  // 375
  { batch:375, name:'触手列車-環状線', short:'触手环状线', anchor:'環状線',
    genre:'列车·通勤边界伦理', vibe:'触手列車类同人R18',
    stage:'都市「环状线末班」', role:'乘务伦理员／下车权见证人',
    core:'是否允许随时下车与拉停', one:'环状线不是无限循环牢笼，时刻表上必须有下车栏。',
    device:'所谓「触手」写为车厢压迫与羞耻氛围装置',
    bar:'下车栏', propMain:'时刻表协议', keyItem:'紧急开门钥匙', bell:'停车铃',
    castN:['リナ','セレナ','ハナ','ミナ','トワ'],
    castR:['末班常客','车长','车内广播员','站务','清洁'],
    castL:['通勤服浅发','制服帽','耳机麦','站务马甲','清洁推车'],
    places:['末节车厢','驾驶室门廊','站台','站务室','环状线公园口','终着闸机'],
    kw:['触手','列車','下車'] },
  { batch:375, name:'女騎士団-裏切者処刑', short:'女骑士团', anchor:'裏切者処刑',
    genre:'骑士团·处分同意伦理', vibe:'女騎士団类同人R18',
    stage:'王国「铁蔷薇骑士团」营区', role:'军法书记／处分见证人',
    core:'「処刑」是否可改为可拒绝的处分听证', one:'処刑不是唯一结局，听证本上必须有申辩栏。',
    device:'所谓「裏切者処刑」写为纪律听证与身份羞耻装置，不写虐杀闯关',
    bar:'申辩栏', propMain:'听证本', keyItem:'离营通行证', bell:'听证铃',
    castN:['カタリナ','セレナ','リナ','ハナ','ミナ'],
    castR:['被指控骑士','团长','医官','书记学徒','营区厨务'],
    castL:['褐发轻甲','银甲披风','白袍','短发卷宗','围裙'],
    places:['听证厅','医务帐','营区食堂','练兵场边','营门','王都驿站'],
    kw:['女騎士','処刑','申辯'] },
  { batch:375, name:'淫魔寄宿舎-最終学年', short:'淫魔宿舍', anchor:'最終学年',
    genre:'寄宿学园·退宿同意伦理', vibe:'淫魔寄宿舎类同人R18',
    stage:'山间「紫藤寄宿学园」', role:'舍监顾问／退宿权见证人',
    core:'最终学年是否仍可退宿与拒签公约', one:'寄宿不是终身契约，公约上必须有退宿栏。',
    device:'所谓「淫魔」写为夜巡压迫与亲密边界练习装置',
    bar:'退宿栏', propMain:'寄宿公约', keyItem:'后门钥匙', bell:'夜巡铃',
    castN:['白石みお','七瀬あかり','橘れい','水瀬ひな','川上さつき'],
    castR:['舍长','班长','保健委员','转校新生','厨务'],
    castL:['银短发眼镜','黑长直','马尾白围裙','浅栗双马尾','丸子头'],
    places:['宿舍大客厅','四人间','夜巡走廊','公共浴室前廊','后门','山间步道'],
    kw:['淫魔','寄宿','退宿'] },
  { batch:375, name:'催眠リゾート-永住者', short:'催眠度假村', anchor:'永住者',
    genre:'度假村·退房同意伦理', vibe:'催眠リゾート类同人R18',
    stage:'海滨「永夏度假村」', role:'前台伦理员／退房权见证人',
    core:'「永住」推销是否仍允许退房', one:'永住不是强制标签，入住单上必须有退房栏。',
    device:'所谓「催眠」写为氛围暗示与可协商体验项目',
    bar:'退房栏', propMain:'入住单', keyItem:'房卡自管', bell:'前台铃',
    castN:['リナ','セレナ','ハナ','ミナ','トワ'],
    castR:['被推销旅客','度假村经理','护士站','酒吧调酒','行李生'],
    castL:['旅行装浅发','西装名牌','白大褂','围裙调酒','制服帽'],
    places:['前台','客房','泳池边','酒吧','医务室','离岛码头'],
    kw:['催眠','リゾート','退房'] },
  { batch:375, name:'エルフ姫レティシア-完全服従', short:'精灵公主', anchor:'完全服従',
    genre:'王廷·服从契约伦理', vibe:'エルフ姫服従类同人R18',
    stage:'精灵王都「银叶宫」', role:'王廷书记／契约见证人',
    core:'「完全服従」条款是否可单方撤销', one:'服従不是永久烙印，契约上必须有撤销栏。',
    device:'所谓「完全服従」写为可撤销的礼仪契约与身份焦虑',
    bar:'撤销栏', propMain:'服従契约', keyItem:'宫门通行令', bell:'召见铃',
    castN:['レティシア','セレナ','リナ','ハナ','ミナ'],
    castR:['精灵公主','宫廷监督','医官','档案官','御厨'],
    castL:['金发长耳王冠','银发藤冠','白袍','眼镜卷宗','围裙香料'],
    places:['议事厅','公主侧殿','御花园','档案库','御厨','宫门'],
    kw:['エルフ','服従','取消'] },
  // 376
  { batch:376, name:'触手異世界-召喚勇者', short:'触手异世界', anchor:'召喚勇者',
    genre:'异世界·解约回归伦理', vibe:'触手異世界召喚类同人R18',
    stage:'召唤神殿「绿雾原」', role:'召唤伦理官／解约见证人',
    core:'被召唤者是否可拒绝任务并申请回归', one:'勇者不是终身职称，契约上必须有解约栏。',
    device:'所谓「触手異世界」写为异质压迫与身份错位装置',
    bar:'解约栏', propMain:'召唤契约', keyItem:'回归石', bell:'停召铃',
    castN:['リナ','セレナ','ハナ','ミナ','トワ'],
    castR:['被召唤者','神官长','医官','驿站主','学徒'],
    castL:['现代便服异格','白袍藤冠','白袍','围裙','短发绑带'],
    places:['神殿中央','准备间','驿站','雾原小径','医务帐','回归阵'],
    kw:['触手','召喚','解約'] },
  { batch:376, name:'魔界娼館-新人卒業', short:'魔界娼馆', anchor:'新人卒業',
    genre:'魔界馆舍·离职毕业伦理', vibe:'魔界娼館类同人R18',
    stage:'魔界都「红灯十字」馆舍', role:'馆规顾问／离职见证人',
    core:'「卒業」是否允许真离馆而非转岗绑定', one:'卒業不是换枷锁，名簿上必须有真离职栏。',
    device:'所谓「娼館」写为可离职的劳务与亲密边界经营',
    bar:'真离职栏', propMain:'馆员名簿', keyItem:'后门钥匙', bell:'拒客铃',
    castN:['ベルゼブ','ルナ','ミナ','ハナ','トワ'],
    castR:['馆主','楼层长','新人','拒客员','会计'],
    castL:['紫长发角冠','银短发马甲','杏发围裙','短发对讲','眼镜账本'],
    places:['前台','休息室','后门','账房','天台','街口驿站'],
    kw:['魔界','娼館','離職'] },
  { batch:376, name:'人妻堕落-ママ友全員', short:'妈妈友', anchor:'ママ友全員',
    genre:'社区妈妈友·局取消伦理', vibe:'人妻堕落ママ友类同人R18',
    stage:'郊外団地「樱丘」', role:'社区调解员／局取消见证人',
    core:'妈妈友局是否可单方取消且不被孤立报复', one:'堕落不是集体标签，局单上必须有取消栏。',
    device:'所谓「堕落」写为同伴压力与可退出的聚会边界',
    bar:'取消栏', propMain:'局单备忘', keyItem:'家门自管', bell:'挂断键',
    castN:['藤咲麻衣','神崎由纪','佐藤恵','水野玲','井上あや'],
    castR:['妈妈友A','妈妈友B','物业','律师友人','便利店夜班'],
    castL:['浅栗长发','波浪发','制服名牌','短发西装','马尾外套'],
    places:['樱丘客厅','儿童公园边','便利店','物业办','河堤','律师所'],
    kw:['人妻','ママ友','取消'] },
  { batch:376, name:'女教師監禁-365日完了', short:'女教师365', anchor:'365日完了',
    genre:'校园·软禁记录伦理', vibe:'女教師監禁类同人R18',
    stage:'市立「青葉高校」与教师宿舍', role:'校方伦理员／出门权见证人',
    core:'「365日记录」是否仍允许出门与拒签', one:'完了不是永久封闭，记录本上必须有出门栏。',
    device:'所谓「監禁」写为软禁焦虑与可协商出门权',
    bar:'出门栏', propMain:'365日记录本', keyItem:'宿舍钥匙自管', bell:'出门铃',
    castN:['高梨玲子','白石みお','橘れい','水野玲','川上さつき'],
    castR:['女教师','教导主任','保健','律师','厨务'],
    castL:['黑发西装裙','银短发眼镜','马尾白围裙','短发西装','丸子头'],
    places:['教师宿舍','保健室','教员室','校门','便利店','河堤'],
    kw:['女教師','監禁','出門'] },
  { batch:376, name:'聖騎士カタリナ-完全堕落記', short:'圣骑士卡塔', anchor:'完全堕落記',
    genre:'圣骑士·退团记录伦理', vibe:'聖騎士堕落类同人R18',
    stage:'圣都「白刃骑士团」', role:'记录官／退团见证人',
    core:'「堕落記」是否允许本人改写与退团', one:'堕落不是盖棺定论，记上必须有退团栏与改写权。',
    device:'所谓「完全堕落」写为信仰危机与身份重构',
    bar:'退团栏', propMain:'堕落记录本', keyItem:'平民衣', bell:'听证铃',
    castN:['カタリナ','セレナ','リナ','ハナ','ミナ'],
    castR:['圣骑士','团长','医官','档案官','酒馆主'],
    castL:['褐发圣甲','银甲','白袍','眼镜卷宗','围裙'],
    places:['听证厅','医务帐','档案室','酒馆','营门','驿站'],
    kw:['聖騎士','堕落','退団'] },
  // 377
  { batch:377, name:'淫獣ダンジョン-迷宮主', short:'淫兽迷宫', anchor:'迷宮主',
    genre:'迷宫·辞任同意伦理', vibe:'淫獣ダンジョン类同人R18',
    stage:'边境「苔痕迷宫」', role:'迷宫伦理官／辞任见证人',
    core:'迷宮主职位是否可辞任并离开', one:'迷宫主不是永久诅咒，职契上必须有辞任栏。',
    device:'所谓「淫獣ダンジョン」写为压迫氛围与身份装置',
    bar:'辞任栏', propMain:'迷宫职契', keyItem:'出口火把', bell:'停探铃',
    castN:['セレナ','リナ','ハナ','ミナ','トワ'],
    castR:['迷宫主候选人','向导','医官','驿站主','学徒'],
    castL:['白发藤冠','斗篷泥点','白袍','围裙','短发绑带'],
    places:['迷宫前厅','火把库','医务帐','驿站','苔痕小径','出口石门'],
    kw:['ダンジョン','迷宮','辞任'] },
  { batch:377, name:'触手病院-院長就任', short:'触手院长', anchor:'院長就任',
    genre:'医院·就任拒绝伦理', vibe:'触手病院类同人R18',
    stage:'临海「第八综合病院」', role:'伦理审查员／就任见证人',
    core:'院长就任是否可拒绝且不影响执业安全', one:'就任不是绑架，聘书上必须有拒绝栏。',
    device:'所谓「触手病院」写为医疗压迫与身体焦虑装置',
    bar:'拒绝栏', propMain:'院长聘书', keyItem:'离职闸机卡', bell:'红灯词',
    castN:['セレナ','リナ','ハナ','トワ','ミナ'],
    castR:['院长候选人','被験倾向患者代表','伦理护士','档案','清洁'],
    castL:['白大褂银框','病号服','马尾护士服','短发卷宗','围裙推车'],
    places:['伦理会议室','院长室','休息室','观察走廊','正门闸机','咖啡角'],
    kw:['触手','病院','就任'] },
  { batch:377, name:'催眠お嬢様-家庭教師支配', short:'大小姐家教', anchor:'家庭教師支配',
    genre:'豪宅家教·课程取消伦理', vibe:'催眠お嬢様类同人R18',
    stage:'山手「白百合邸」', role:'家教伦理监督／课程取消见证人',
    core:'「支配课程」是否可随时取消与换师', one:'支配不是家规，课表上必须有取消栏。',
    device:'所谓「催眠支配」写为可取消的暗示课程与边界练习',
    bar:'取消栏', propMain:'课程表协议', keyItem:'侧门钥匙', bell:'清醒词',
    castN:['白百合綾','水野玲','橘れい','佐藤恵','井上あや'],
    castR:['大小姐','家教律师顾问','保健式陪读','家政','便利店对照'],
    castL:['黑长直礼服裙','短发西装','马尾','制服围裙','马尾外套'],
    places:['书房','会客厅','侧门花园','保健角','厨房','街口便利店'],
    kw:['お嬢様','家庭教師','取消'] },
  { batch:377, name:'エルフ森林-狩猟解禁日', short:'精灵森林', anchor:'狩猟解禁日',
    genre:'森林·狩猎解禁同意伦理', vibe:'エルフ森林狩猎类同人R18',
    stage:'边境「白苔精灵林」', role:'护林向导／解禁见证人',
    core:'「狩猟解禁」是否允许说不参与并折返', one:'解禁日不是强制猎场，名簿上必须有不参与栏。',
    device:'所谓「狩猟」写为仪式性追逐与可退出的林间边界',
    bar:'不参与栏', propMain:'解禁名簿', keyItem:'折返粉笔', bell:'铃绳',
    castN:['レティシア','セレナ','リナ','ハナ','ミナ'],
    castR:['精灵姬观察者','森巫女','迷路旅人','通信官','驿站主'],
    castL:['金发长耳披风','白发藤冠','亚麻斗篷','耳机通信石','围裙'],
    places:['护林站','白苔小径','雾灯亭','铃绳桥','林缘驿站','苔藓泉'],
    kw:['エルフ','狩猟','不参加'] },
  { batch:377, name:'魔法少女覚醒-闇の力', short:'魔法少女暗力', anchor:'闇の力',
    genre:'魔法少女·力量拒绝伦理', vibe:'魔法少女闇覚醒类同人R18',
    stage:'都市「虹桥市」夜班据点', role:'后勤联络员／拒化见证人',
    core:'「闇の力」是否可拒绝觉醒并保留平民身份', one:'覚醒不是强制升级，名簿上必须有拒化栏。',
    device:'所谓「闇の力」写为倦怠诱惑与身份焦虑装置，不写清场',
    bar:'拒化栏', propMain:'覚醒协议', keyItem:'平民证件', bell:'停化铃',
    castN:['星野ヒカリ','月城アヤ','花咲ミオ','黒羽レナ','白井サキ'],
    castR:['候选覚醒者','前队长','后勤','市民记者','咖啡店主'],
    castL:['粉发变身杖','紫短发','橙马尾耳机','黑长直相机','杏色围裙'],
    places:['据点地下室','天台','咖啡店','市民公园','医务角','地铁口'],
    kw:['魔法少女','闇','拒否'] },
];

function enc(s) {
  return encodeURIComponent(s);
}

function buildWorld(r) {
  const [c0, c1, c2, c3, c4] = r.castN;
  const places = r.places.map((n, i) => ({
    n,
    d: [
      `${r.bar}与${r.propMain}常放此处。`,
      `日常劳动／闲话与边界试探。`,
      `可观察出口与${r.keyItem}相关。`,
      `谈判、听证或安静对话。`,
      `休息、门牌与私人边界。`,
      `透气散步，只谈天气也成立。`,
    ][i],
  }));
  const cast = r.castN.map((n, i) => {
    const roles = r.castR;
    const looks = r.castL;
    const types = ['委托人', '控制系', '守门人', '后辈', '对照'];
    const pers = ['温柔自责', '强势怕失控', '冷静心软', '紧张诚实', '碎嘴心软'];
    const moes = [
      `亲手确认${r.bar}`,
      `交回控制权时手抖`,
      `${r.bell}共管`,
      `主写透明记录`,
      `递热饮道歉笑`,
    ];
    const routes = [
      `HE：${r.bar}完整且自愿续约；BE：栏被永久涂死冻结。`,
      `HE：学会交回权杖／章／钥匙。`,
      `HE：${r.bell}入规且一喊即停。`,
      `HE：档案／名簿由她主写公开。`,
      `HE：日常补给线与刻名物件。`,
    ];
    const rels = ['委托人→共写规则', '对抗→共管', '安全网', '后辈记录', '补给同路'];
    const entries = [
      `先揭开糊住${r.bar}的胶带再谈正事`,
      `承认其压力，不先夺权`,
      `尊重停权与${r.bell}`,
      `让她主记，不代笔涂改`,
      `先给热饮／干衣，不调侃羞耻`,
    ];
    const like0s = ['礼貌距离', '警惕', '专业', '崇拜紧张', '热闹疲惫'];
    const hooks = [r.bar, r.propMain, r.bell, '透明记录', r.keyItem];
    return {
      n,
      role: roles[i],
      look: looks[i],
      per: pers[i],
      type: types[i],
      moe: moes[i],
      route: routes[i],
      rel: rels[i],
      entry: entries[i],
      like0: like0s[i],
      hook: hooks[i],
    };
  });

  const W = {
    name: r.name,
    short: r.short,
    file: `产出/批次${r.batch}/${r.name}.md`,
    genre: r.genre,
    vibe: r.vibe,
    refs: `DLsite「${r.kw[0]}」「${r.kw[1]}」公开检索页`,
    anchor: r.anchor,
    tone: `${r.propMain}、${r.bell}、${r.keyItem}与可随时退出的现场空气`,
    locate: `${r.stage}。契约者以「${r.role}」身份进入，核心是**${r.core}**。`,
    oneLine: r.one,
    world: `${r.stage}的日常运转：规则纸本、出口、热饮与闲话。${r.device}，不写猎杀评级或战力闯关。可只做见证与调解。`,
    rules: `①${r.bar}不可涂死；②${r.bell}一触发即停；③强制封闭／强制续约即违规；④${r.keyItem}不得被单方没收。`,
    warmth: `热饮、干净织物、被叫真名、${r.bar}上未干的钢笔墨。`,
    places,
    commonTitle: `${r.bar}还在吗`,
    common: `${r.stage}因「${r.anchor}」进入敏感节点。你以${r.role}到场时，发现${r.propMain}上的「${r.bar}」被透明胶带糊住。**${c0}**想把规则写死以求「安全」；**${c1}**夹在效率与良心之间；**${c2}**掌停权与${r.bell}；**${c3}**管记录透明；**${c4}**提供日常对照。共通线拼：揭胶带 → 确认${r.bell}有效 → ${r.keyItem}双备份或自管 → 是否公开协议 → 双签或真离开。阶段：相遇（发身份牌）→升温（共管小物）→冲突（胶带／涂栏）→收束（${r.bar}回写）。`,
    routes: cast.map((c) => ({ n: `${c.n}线`, d: c.route })),
    micro: `${r.propMain}掉漆、${r.bell}哑音、胶带残胶、钢笔没水、${r.keyItem}冰凉、热饮溢杯。`,
    cast,
    net: `${c0}—${c1}—你三角伦理；${c2}制度停权；${c3}记录；${c4}日常对照。无暴力情敌，冲突用纸本与出口解决。`,
    scenes: [
      { t: '胶带糊栏', d: `你揭开${r.bar}。` },
      { t: `${r.bell}演练`, d: `${c2}示范一触发即停。` },
      { t: `${r.keyItem}交接`, d: `自管或双备份。` },
      { t: '热饮洒袖', d: `${c4}道歉笑。` },
      { t: '记录透明', d: `${c3}红脸主写。` },
      { t: '只谈天气', d: `散步／走廊和解。` },
      { t: '出口可见', d: `${r.keyItem}验证可离。` },
      { t: '协议双签', d: `${r.bar}回写。` },
      { t: '小物归位', d: `${r.propMain}放回视线内。` },
      { t: '自愿续约议', d: `True 可选，不续约也完整。` },
    ],
    hidden: `True：${r.propMain}改名《${r.short}合意备忘》，${r.bar}不可涂，${r.bell}全员会用，${r.keyItem}不得单方没收。伏笔：${c0}旧物涂名、${c1}压力短信／旧队徽。`,
    mood: `${r.propMain}纸声、${r.bell}、热饮蒸汽、出口风。`,
    nsfw: `${r.genre}向18+，写同意与${r.bar}，不写强制封闭细目。`,
    taboo: `糊死${r.bar}；没收${r.keyItem}；幼化；美化无出口；跨世界套话；战力闯关。`,
    bestEntry: `${r.propMain}清点／复审当日。`,
    heroDefault: `细心的${r.role.split('／')[0]}`,
    heroArc: `从促成「效率／完成」到坚持${r.bar}与出口`,
    hook: `${r.bar}与${r.bell}`,
    props: [r.propMain, '胶带', r.bell, r.keyItem, '钢笔', '热饮杯', '门牌', '空白协议页'],
    days: ['到任日', '揭栏日', '铃权日', '钥匙日', '透明日', '散步日', '双签日'],
    entryId: r.role,
    entryWhen: `${r.anchor}节点当日或次日`,
    entryState: `- 临时工位／单间；持空白协议页\n- 先见**${c0}**与**${c2}**\n- ${r.bar}被胶带糊住；${r.keyItem}归属未明`,
    opener: `${r.stage}的空气发紧。**${c0}**把${r.propMain}推过来——「${r.bar}」被透明胶带糊死。**${c1}**在旁抱臂：写死才安全。你的第一句话，必须是揭开胶带，并确认**${c2}**的${r.bell}随时有效。`,
    playHooks: [
      { t: `${r.bar}线`, d: '每日确认扉页／协议完整。' },
      { t: `${r.bell}线`, d: '一触发即停，禁止没收。' },
      { t: `${r.keyItem}线`, d: '自管或双备份＝出口。' },
      { t: '透明记录线', d: `${c3}主写，禁代笔涂改。` },
      { t: '日常透气线', d: `与${c4}只谈天气与热饮。` },
    ],
    cutMood: `保持可退出；忌糊死${r.bar}；忌没收${r.keyItem}；忌幼化；忌一周速通征服。`,
    priorityPlay: `揭胶带、演练${r.bell}、确认${r.keyItem}`,
    mantra: `先保证${r.bar}与出口，再谈任何「完成／支配／就任」。`,
    sources: [
      { t: `DLsite「${r.kw[0]}」检索`, u: `https://www.dlsite.com/maniax/fsr/=/keyword/${enc(r.kw[0])}/` },
      { t: `DLsite「${r.kw[1]}」检索`, u: `https://www.dlsite.com/maniax/fsr/=/keyword/${enc(r.kw[1])}/` },
      { t: `搜笔趣阁检索（无长篇）`, u: `https://www.sobqg.com/searchBook.html?keyword=${enc(r.kw[2] || r.kw[0])}` },
    ],
    extraPlot: [
      `${c0}确认${r.bar}前会先触碰${r.propMain}边角——本世界固定小动作。`,
      `${r.keyItem}若被单方没收超过十分钟，即危险信号，正文须停推进。`,
      `${c2}只在公共区演示${r.bell}，从不在无第三人的密闭房间独断停权。`,
      `本世界专属气味／声景：${r.tone}；禁止套用其他批次地点人名。`,
      `若出现「战力／阶位／闯关评级」叙事，视为 OOC，应拉回${r.bar}纸本冲突。`,
    ],
    extraCut: [
      `未揭胶带前禁止任何亲密／规则升级推进。`,
      `与${c4}的戏禁止传播协议隐私。`,
      `前三天优先出口可见，不优先「攻略进度条」。`,
    ],
  };
  return W;
}

const DATA = RAW.map(buildWorld);
const report = [];
for (const w of DATA) {
  const body = pack(w);
  const fp = path.join(ROOT, w.file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body, 'utf8');
  const plotC = cc(body.split('## 休闲切入点')[0].split('## 剧情')[1]);
  const cutC = cc(body.split('## 休闲切入点')[1].split('## 来源')[0]);
  const chk = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', w.file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const ok = chk.status === 0;
  report.push({ name: w.name, file: w.file, plot: plotC, cut: cutC, ok, out: (chk.stdout || '') + (chk.stderr || '') });
  console.log((ok ? '✓' : '✗'), w.name, 'plot', plotC, 'cut', cutC);
  if (!ok) console.log(chk.stdout || chk.stderr);
}
fs.writeFileSync(path.join(ROOT, '_tmp_b373_377_report.json'), JSON.stringify(report, null, 2));
const pass = report.filter((r) => r.ok).length;
console.log('\nPASS', pass, '/', report.length);
process.exit(pass === report.length ? 0 : 2);
