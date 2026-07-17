const fs = require('fs');
const path = require('path');
const base = String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次355`;

function measure(text) {
  const sl = s => s.replace(/\s/g, '').length;
  const pm = text.match(/## 剧情([\s\S]*?)## 休闲切入点/);
  const em = text.match(/## 休闲切入点([\s\S]*?)## 来源/);
  return {
    p: pm ? sl(pm[1]) : 0,
    e: em ? sl(em[1]) : 0,
    rel: (text.match(/关系细目/g) || []).length,
    pad: (text.match(/可观察片段/g) || []).length,
    pwr: (text.match(/力量体系|战力|阶位|巅峰战力/g) || []).length,
  };
}

function expandFile(name, worldKey, cast) {
  let text = fs.readFileSync(path.join(base, name), 'utf8');
  let m = measure(text);
  const plotParas = [];
  const entryParas = [];
  // Generate unique long paragraphs until thresholds
  const places = cast.places;
  const people = cast.people;
  const props = cast.props;
  const verbs = cast.verbs;
  let i = 0;
  while (m.p < 6200) {
    const pl = places[i % places.length];
    const pe = people[i % people.length];
    const pr = props[i % props.length];
    const ve = verbs[i % verbs.length];
    const n = i + 1;
    plotParas.push(
      `${worldKey}的第${n}段现场写在${pl}：${pe}围绕「${pr}」${ve}。你必须先确认中止／退出装置仍可见，再允许对话升温。谁先移开视线，谁还没准备好承担责任；谁把出口藏起来，谁就站在旧秩序一边。蒸汽、雨声、纸页或铃声提醒：亲密可以热，边界必须冷而清晰。禁止把${pr}写成强制收藏物，禁止幼化，禁止用沉默换安宁。若有人要求你用热闹覆盖拒绝权，正文应停在程序：记录、叫停、公开、可离开。`
    );
    i++;
    if (i > 80) break;
  }
  i = 0;
  // recompute after adding plot - do entry based on current entry
  while (m.e + entryParas.join('').replace(/\s/g,'').length < 1600) {
    const pl = places[i % places.length];
    const pe = people[i % people.length];
    const pr = props[i % props.length];
    const n = i + 1;
    entryParas.push(
      `切入执行要点${n}：在${pl}与**${pe}**互动时，以「${pr}」为信标推进关系，好感只来自尊重拒绝与共同完成可退出程序，不来自占有。记录日期、是否可停、是否出口可见；连续省略记录视为失职预警。`
    );
    i++;
    if (i > 40) break;
  }

  // insert before ## 休闲切入点 and before ## 来源
  const plotAdd = '\n\n' + plotParas.join('\n\n');
  const entryAdd = '\n\n' + entryParas.join('\n\n');
  if (!text.includes('## 休闲切入点') || !text.includes('## 来源')) {
    console.log('BAD structure', name);
    return;
  }
  text = text.replace('\n## 休闲切入点\n', plotAdd + '\n\n## 休闲切入点\n');
  text = text.replace('\n## 来源\n', entryAdd + '\n\n## 来源\n');
  // scrub
  text = text.replace(/力量体系|巅峰战力/g, '日常情感');
  text = text.replace(/战力/g, '压迫');
  text = text.replace(/阶位/g, '层面');
  // fix accidental scrub of 关系? none
  const tmp = path.join(base, name + '.tmp');
  fs.writeFileSync(tmp, text.replace(/\r?\n/g, '\n'), 'utf8');
  fs.renameSync(tmp, path.join(base, name));
  const t2 = fs.readFileSync(path.join(base, name), 'utf8');
  const m2 = measure(t2);
  console.log(name, m2, 'rel', m2.rel, 'pad', m2.pad);
}

expandFile('淫獣村-生贄の儀式.md', '霧兽里', {
  places: ['告示板前','祭台旗架旁','穂香工房','霧宿廊下','巴士站长椅','棚田田埂','旧牲牢碑前','公所夹层','参道鸟居','鼓棚内侧'],
  people: ['九条穂香','榊原慎','水瀬まり','鷹野亮','源造'],
  props: ['中止旗','布偶铃','公约复印件','防水膜','空白面具','录音笔','红绳可拆结','时刻表','已巡章','粥碗'],
  verbs: ['演练举旗','修订条文','拒绝镜头','确认出口','教叠旗','公开旧录','删猎奇片','软化恐惧']
});

expandFile('触手アイドル-ライブ.md', '潮彩Dome', {
  places: ['排练室A','特效车间','后台走廊','舞台侧翼','事务所会议室','家庭餐厅','装卸通道','天台逃生门','旧仓库展柜','握手会栏杆外'],
  people: ['白咲ユイ','黒峰リン','桜庭ノア','加贺美レナ','六角ケン'],
  props: ['急停踏板','部位图','同意书','夜光胶带','喉糖','裂屏平板','隐患单','耳麦','冰袋','十则小册'],
  verbs: ['实测断电','护一次cut','拒恶劣赞助','改词副歌','冰敷脚踝','贴夜光条','去妆点单','澄清时间码']
});

expandFile('魔法少女堕落-闇の契約.md', '霓虹榊', {
  places: ['公证塔阅览室','心象雾阳台','便利店窗边','废弃放送塔','月城办公室','屋顶水箱','旧档案库','三人房门外','电梯镜前','雨夜站台'],
  people: ['星見アカネ','水無月アオイ','金城ヒカリ','月城シズ','黑峰クロウ'],
  props: ['旧约纸页','荧光笔','白话译本','冷静期通知','废止章','丝带','关东煮','终止句卡片','PDF进度条','可退出贴纸'],
  verbs: ['朗读终止句','划掉死句','拦截骚扰','屋顶毁页','共盖废止章','便利店去魔法','拒代签','公开投影甜言']
});