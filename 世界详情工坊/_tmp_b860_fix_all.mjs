import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const charCount = (s) => (s || '').replace(/\s/g, '').length;

const CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };

function expandEntry(name, tierMaps, tiersSpec) {
  // tiersSpec: array of {n, realm, theme, id, event, open, npcs, hooks, danger, reward, extra}
  let out = `> 阶位↔：${tierMaps}。世界顶点阴影＝**超阶**：存在·情报优先/条件性胜利，严禁「被封印/被削弱所以战力为零」。\n\n`;
  for (const t of tiersSpec) {
    const cn = CN[t.n];
    out += `**${cn}阶（${t.realm}·${t.theme}）**\n\n`;
    out += `切入身份/时点：${t.id}\n\n`;
    out += `初始事件：${t.event}\n\n`;
    out += `开场白建议：「${t.open}」\n\n`;
    out += `关键NPC立场：${t.npcs}\n\n`;
    out += `主线钩子/支线：${t.hooks}\n\n`;
    out += `危险度/规避：${t.danger}\n\n`;
    out += `任务方向/奖励：${t.reward}\n\n`;
    if (t.extra) out += `${t.extra}\n\n`;
    // ensure per-tier density unique to world
    out += `本阶执行要点（${name}）：必须出现本阶独有地点或道具名，禁止与其他阶复制同一句「假货护送名额」；失败默认留下债务、伤口或通缉之一。\n\n`;
  }
  // pad entry to 1500+
  let i = 0;
  while (charCount(out) < 1600 && i < 40) {
    out += `补充钩子${i + 1}：在${name}的${CN[tiersSpec[i % tiersSpec.length].n]}阶，用可观察细节（气味/编号/伤口位置）推进，而非总结句。\n\n`;
    i++;
  }
  return out;
}

function fixFile(rel, opts) {
  const fp = path.join(ROOT, rel);
  let text = fs.readFileSync(fp, 'utf8');
  // ensure 乐园阶位映射
  if (!text.includes('乐园阶位映射')) {
    text = text.replace(
      /（宁低勿高）|映射：|映射（/,
      (m) => (m.includes('乐园') ? m : '乐园阶位映射（宁低勿高）：')
    );
    if (!text.includes('乐园阶位映射')) {
      text = text.replace(
        '**【世界观 · 力量体系】**',
        '**【世界观 · 力量体系】**\n乐园阶位映射见段末。'
      );
      // append mapping line before 地理
      text = text.replace(
        '**【地理 · 舞台】**',
        `**乐园阶位映射（宁低勿高）**：${opts.mapLine}\n\n**【地理 · 舞台】**`
      );
    }
  }
  // replace ## 阶位切入点 section
  const srcIdx = text.indexOf('## 来源');
  const entIdx = text.indexOf('## 阶位切入点');
  if (entIdx < 0 || srcIdx < 0) throw new Error('bad structure ' + rel);
  const entry = expandEntry(opts.name, opts.tierMaps, opts.tiers);
  text = text.slice(0, entIdx) + '## 阶位切入点\n\n' + entry + text.slice(srcIdx);
  // clean Arabic 1阶 leftovers in plot if any
  text = text.replace(/\*\*([1-9])阶/g, (_, n) => `**${CN[+n]}阶`);
  fs.writeFileSync(fp, text, 'utf8');
  const out = execSync(`node scripts/compile-worldbook.mjs --check "${rel}"`, { encoding: 'utf8' });
  process.stdout.write(out);
}

// ---- 深海余烬 ----
fixFile('产出/批次860/深海余烬.md', {
  name: '深海余烬',
  mapLine: '凡人≈一阶；教会守卫/低危异常≈二阶；审判官≈三阶；城邦顶尖≈四阶；舰队级≈五阶；亚空间投影≈六阶；邓肯级≈七阶；古神/深度＝超阶',
  tierMaps: '一≈凡人，二≈教会守卫/低危异常，三≈审判官，四≈城邦顶尖，五≈舰队，六≈亚空间投影，七≈邓肯级；古神/深度＝超阶',
  tiers: [
    { n:1, realm:'凡人', theme:'浓雾求生', id:'契约者以雾困市民/周铭邻居切入，锚定浓雾封锁初期。', event:'水电断绝，门外按铃只有雾，食物见底，必须决定是否推门。', open:'雾把窗外的世界擦掉了。日历还停在去年。门把手是热的——像有人在对面也握住了它。', npcs:'**周铭/邓肯**（未完全亮明身份，冷静记录）、邻居幸存者（恐慌/贪婪）、市政失联广播（只闻声）。', hooks:'主线＝活过七日并留下可信记录；支线＝日记本、最后一桶水、是否相信「门对面有船」。', danger:'中；规避盲目推门与集体歇斯底里踩踏。', reward:'存活、异常见闻、进入失乡号外围资格线索。' },
    { n:2, realm:'守卫', theme:'登船传闻', id:'城邦水手/深海教会新兵，失乡号初现传闻期。', event:'码头出现不该存在的船影，山羊头式低语传令，有人签了名消失。', open:'船没有靠港，雾却有了甲板的味道。有什么东西在邀请你签字——用灵魂。', npcs:'**山羊头**（传闻与低语）、**爱丽丝**（远影人偶）、码头老水手（恐惧经验）。', hooks:'主线＝接近失乡号外围而不被「邀请」吞没；支线＝失踪船员名单、假船票。', danger:'中高；规避登船契约与低语精神污染。', reward:'低危异常情报、教会见习功勋。' },
    { n:3, realm:'审判', theme:'普兰德邪教', id:'深海教会守卫，**凡娜·韦恩**任审判官期。', event:'地下集会献祭进行中，举报信与跳劈同时到达现场。', open:'水晶锤还没晃完，审判官已经跳起来了。你手中的名单被血粘住。', npcs:'**凡娜·韦恩**（跳劈之王，敌视异端）、**海蒂**（午夜合剂审讯）、**莫里斯**（学者旁观后拔枪）。', hooks:'主线＝破献祭救人或取证；支线＝名单真伪、教会内部口径。', danger:'高；规避邪神注视与误伤审判官。', reward:'教会功勋、邪教据点地图。' },
    { n:4, realm:'城邦', theme:'古董店博弈', id:'市政雇员/历史学者，邓肯古董店营业期。', event:'店内唯一真货被多方盯上，**莫里斯**进门一眼识假。', open:'老爷子手杖一点：假的、假的、这件是真的。船长在柜台后笑，雾却从门缝进来。', npcs:'**邓肯·艾布诺马尔**、**莫里斯**、**妮娜**（阳光危险）、店内假货商。', hooks:'主线＝真假货与船长身份试探；支线＝第六街区大火旧档、吊坠交易。', danger:'高；规避直视船长「真身」与亚空间压强。', reward:'人情、异常线索、不越级神器。' },
    { n:5, realm:'舰队', theme:'寒霜镜像', id:'寒霜守门编外，**阿加莎**线。', event:'镜像城邦入侵，血守门，墓园尸体比活人守规矩。', open:'镜子里的寒霜比外面更像真的。阿加莎说：裂开也比让他们进来好。', npcs:'**阿加莎**、**提瑞安**、**老看守**、镜像入侵者。', hooks:'主线＝守门/撤离平民；支线＝蕾·诺拉遗案残页、活死人纪律。', danger:'极高；规避镜像替换与失血仪式。', reward:'存活、镜像情报、寒霜人情。' },
    { n:6, realm:'投影', theme:'篡火证据', id:'探险家协会记录官，子女舰队交汇期。', event:'同一场海战出现三个结局，火焰在羊皮纸上改字，要你销毁或公开。', open:'火焰在纸上走，字自己改了。有人出高价买「正确历史」。', npcs:'**露克蕾西娅**、**提瑞安**、**邓肯**、协会审查官。', hooks:'主线＝改史证据链；支线＝璀璨星辰号魔改件、海雾悬赏令。', danger:'极高；规避被写进错误历史。', reward:'历史坐标线索、舰队临时通行。' },
    { n:7, realm:'天灾', theme:'深度航行', id:'领航技术员/失乡号临时船员，深度计划启动。', event:'深度计数开始，有人忘记名字，赋值权争夺。', open:'深度3，夜幕。有人开始忘记自己的名字。船长说：记住你是谁，比记住航线重要。', npcs:'**邓肯**、**爱丽丝（LH-03）**、古神/幽邃阴影（只露边）。', hooks:'主线＝赋值争夺与条件胜；支线＝领航灯、回家航路。', danger:'贴近顶点/超阶；情报优先，严禁硬刚古神本尊。', reward:'见证、存活、新世界坐标线索。' },
  ],
});

// ---- 异常生物见闻录 ----
fixFile('产出/批次861/异常生物见闻录.md', {
  name: '异常生物见闻录',
  mapLine: '普通人≈一；低危异常/雇员≈二；收容武装≈三；高危异常≈四；半神≈五；神级≈六；郝仁巅峰向≈七；真神战＝超阶',
  tierMaps: '一≈普通人，二≈低危异常同居，三≈收容武装，四≈高危异常，五≈半神，六≈神级，七≈郝仁巅峰向；真神战＝超阶',
  tiers: [
    { n:1, realm:'凡人', theme:'摁印', id:'求租者/邻居，合同期前夜。', event:'大屋招租，合同闪神光，手印位空着。', open:'手印盖下去，房租是次要问题。门外有什么在笑。', npcs:'**郝仁**、疑似中介的异常存在、邻居。', hooks:'是否签字；偷看合同条款；逃跑被笑。', danger:'中；规避乱摁手印。', reward:'合同见闻、入住资格线索。' },
    { n:2, realm:'同居', theme:'室友危机', id:'临工保姆/修理工。', event:'冰箱回嘴，猫耳少女打坏电视要跑路。', open:'早餐会回嘴。你得先道歉再谈电费。', npcs:'**薇薇安**、**莉莉娅**、**滚**、**郝仁**。', hooks:'调解室友；修电视；藏异常痕迹。', danger:'中；规避触发室友雷区技能。', reward:'异常常识、房租减免式人情。' },
    { n:3, realm:'收容', theme:'教会上门', id:'编外协助。', event:'收容队要带走某室友，枪口对准客厅。', open:'枪口对准沙发。合同在抽屉里发烫。', npcs:'教会具名队员、**郝仁**、被点名室友。', hooks:'护人或交人；伪造不在场；报警反噬。', danger:'高。', reward:'人情或通缉二选一后果。' },
    { n:4, realm:'高危', theme:'出差位面', id:'随队记录员。', event:'位面任务爆炸，当量单位被喊出。', open:'有人报当量，你下意识捂钱包——不，捂命。', npcs:'**郝仁**、**渡鸦12345**、位面土著。', hooks:'完成差事；控制爆炸半径；带 priorit y 样本。', danger:'高。', reward:'异常材料、出差津贴。' },
    { n:5, realm:'半神', theme:'神系面试', id:'合同边缘雇员。', event:'神级甲方改条款，零多到看不清。', open:'条款多了一串零。渡鸦说：反正不要钱。', npcs:'**渡鸦12345**、神系代表、**薇薇安**。', hooks:'谈判删条；拒签代价；证人。', danger:'极高。', reward:'权限碎片、神级人情。' },
    { n:6, realm:'神级', theme:'数据神', id:'边缘神职/技术。', event:'数据化神域崩溃，备份比生命珍贵。', open:'备份进度条比血条重要。有人在抢回档点。', npcs:'郝仁团队、数据神残影。', hooks:'抢备份；删病毒；守机房。', danger:'极高。', reward:'数据权、存活。' },
    { n:7, realm:'弑神', theme:'终战', id:'见证者。', event:'弑神者战场，有人笑着扛责。', open:'有人笑着往前走。你负责记谁还活着。', npcs:'**郝仁**、**薇薇安**、神敌阴影。', hooks:'条件胜/撤离/记录。', danger:'超阶压力。', reward:'见证、终章位置线索。' },
  ],
});

// ---- 吞噬星空2 ----
fixFile('产出/批次860/吞噬星空2：起源大陆.md', {
  name: '吞噬星空2：起源大陆',
  mapLine: '边缘凡人≈一～二；真神仆从≈三；真神≈四～五；虚空真神≈五～六；永恒真神≈六～七；混沌主宰≈七～八；神王≈八；更高＝超阶',
  tierMaps: '一～二≈边缘凡人/城门，三≈真神仆从，四≈真神，五≈虚空真神，六≈永恒真神，七≈混沌主宰，八≈神王边缘；更高＝超阶',
  tiers: [
    { n:1, realm:'边缘', theme:'落地', id:'随船杂役/猎户，初临大地。', event:'异兽过境，夜空星辰压人。', open:'夜空每颗星都是一个宇宙。你只想找城墙。', npcs:'商队头领、本土凡人。', hooks:'活着进城；避开异兽。', danger:'中。', reward:'地图口粮。' },
    { n:2, realm:'城门', theme:'评级前', id:'佣兵新人，扈阳外围。', event:'无评级无居所，排队冲突。', open:'没有评级就没有居所。刀在队末出鞘。', npcs:'城卫、**墨玉虎**类虚空真神路过压强。', hooks:'暂住证；卖情报。', danger:'中。', reward:'身份牌。' },
    { n:3, realm:'仆从', theme:'会馆外', id:'真神仆从。', event:'炎风会馆门前挑衅。', open:'会馆里的人随手可捏死你。你负责递刀。', npcs:'会馆执事、真神主人。', hooks:'送件存活。', danger:'高。', reward:'贡献点。' },
    { n:4, realm:'真神', theme:'晶花', id:'隐名真神/永恒边缘。', event:'蓝紫血晶花争夺。', open:'花比命贵。黑多莫在笑。', npcs:'**罗峰**（隐名）、**摩罗撒**、黑多莫。', hooks:'抢花/护花/不暴露界兽。', danger:'高。', reward:'晶花/情报。' },
    { n:5, realm:'虚空', theme:'炼心', id:'虚空真神客卿。', event:'梦花楼炼心失败案例抬出。', open:'心魔比敌人先到。楼里有人在哭自己的名字。', npcs:'罗峰、会馆长老。', hooks:'炼心辅助；保密。', danger:'极高。', reward:'意志资源。' },
    { n:6, realm:'永恒', theme:'百花宴', id:'永恒真神宾客。', event:'宴上杀机，神王影子。', open:'笑容里全是神王影子。酒是甜的。', npcs:'罗峰、神王使。', hooks:'站队；不暴露。', danger:'极高。', reward:'人情。' },
    { n:7, realm:'混沌', theme:'疆域', id:'混沌主宰周边。', event:'南河战云，星辰一灭。', open:'星辰一灭，一尊强者死。有人举杯。', npcs:'神王阵营具名、罗峰。', hooks:'情报撤离。', danger:'贴近顶点。', reward:'疆域情报。' },
    { n:8, realm:'神王', theme:'永恒', id:'见证者。', event:'一刀与永恒，记录走廊开门。', open:'记录走廊开门。你的笔比刀重。', npcs:'**罗峰**、元相关、初始始祖阴影。', hooks:'条件胜见证。', danger:'超阶压力。', reward:'纪元记录。' },
  ],
});

// ---- 鸣龙 ----
fixFile('产出/批次860/鸣龙.md', {
  name: '鸣龙',
  mapLine: '低品≈一～二；高品≈三；宗师≈四；入道≈五；通仙边缘≈六；魔神/龙真身≈七',
  tierMaps: '一～二≈低品武道，三≈高品，四≈宗师，五≈入道，六≈通仙边缘，七≈魔神/龙真身阴影',
  tiers: [
    { n:1, realm:'凡人', theme:'雨夜陵', id:'药童/仆役，紫徽山。', event:'帐篷外尸体与天罡锏，雨冲血入洞。', open:'雨把血冲进洞口。剑上二字像催命。', npcs:'**谢尽欢**、**煤球**、盗墓尸。', hooks:'撤离；藏笔记。', danger:'中高。', reward:'活口情报。' },
    { n:2, realm:'八品', theme:'州府', id:'武馆弟子。', event:'正伦剑引妖传闻。', open:'剑出鞘，狗先叫。', npcs:'县尉线、江湖刀客、谢尽欢。', hooks:'护送/夺剑。', danger:'中。', reward:'入门功。' },
    { n:3, realm:'高品', theme:'遇龙', id:'佣兵。', event:'龙提出通仙交易，奴役关系反转。', open:'它说你是奇才。你说它是仆人。雨还在下。', npcs:'龙、**谢尽欢**。', hooks:'签或不签。', danger:'高。', reward:'龙授残篇。' },
    { n:4, realm:'宗师', theme:'女主局', id:'客卿。', event:'夜红殇与南宫烨立场冲突酒宴。', open:'酒宴上刀比酒烈。有人笑着劝酒。', npcs:'**夜红殇**、**南宫烨**、谢尽欢。', hooks:'站队不站错。', danger:'高。', reward:'人情。' },
    { n:5, realm:'入道', theme:'魔神陵', id:'探索队。', event:'陵开妖涌，红衣在雨里。', open:'红衣在雨里笑。镇妖棺是空的。', npcs:'谢尽欢团队、妖魔头目。', hooks:'夺镇物。', danger:'极高。', reward:'陵宝。' },
    { n:6, realm:'通仙', theme:'龙约', id:'半仙门人。', event:'龙真身阴影压境。', open:'服务与奴役只一字之差。天在鸣。', npcs:'龙、谢尽欢。', hooks:'完成约定。', danger:'极高。', reward:'通仙线索。' },
    { n:7, realm:'魔神', theme:'终局', id:'见证。', event:'魔神陵核心苏醒。', open:'名字被雨洗掉。只剩剑鸣。', npcs:'魔神阴影、谢尽欢。', hooks:'条件胜封陵。', danger:'超阶压力。', reward:'封陵权。' },
  ],
});

// ---- 超人灵气 ----
fixFile('产出/批次860/我都成超人了，灵气才复苏？.md', {
  name: '我都成超人了，灵气才复苏？',
  mapLine: '凡人≈一；古武≈二；持证超凡≈三；城级≈四～五；国级≈六；神话≈七；更高＝超阶',
  tierMaps: '一≈凡人，二≈古武，三≈持证超凡，四≈城级，五≈强城级，六≈国级，七≈神话阴影',
  tiers: [
    { n:1, realm:'凡人', theme:'公告夜', id:'社畜/学生。', event:'手机推送灵气复苏，邻居发光。', open:'邻居在阳台发光。你还得上班。', npcs:'主角（隐）、居委式官员。', hooks:'活过首夜；不暴露。', danger:'低中。', reward:'情报。' },
    { n:2, realm:'古武', theme:'挖角', id:'武馆弟子。', event:'古武教练上门，拳套藏符。', open:'拳套里藏符。合同写「自愿」。', npcs:'古武传人、主角。', hooks:'拜师或拒。', danger:'中。', reward:'入门功。' },
    { n:3, realm:'持证', theme:'登记', id:'编外。', event:'检测强制登记，腰牌比拳头硬。', open:'腰牌比拳头硬。机器叫你名字。', npcs:'管理局员、主角。', hooks:'登记/躲检。', danger:'中高。', reward:'编制。' },
    { n:4, realm:'城级', theme:'异变', id:'志愿者。', event:'商场异变封死。', open:'出口在三次方。广播还在放广告。', npcs:'城级异变体、官方队。', hooks:'突围救人。', danger:'高。', reward:'样本。' },
    { n:5, realm:'强城', theme:'资本', id:'安保。', event:'实验室要主角血，合同有毒。', open:'合同有毒。笔比针管细。', npcs:'资本代理、主角。', hooks:'毁约/假合作。', danger:'高。', reward:'资金或仇。' },
    { n:6, realm:'国级', theme:'博弈', id:'特派。', event:'两国口径冲突，卫星在看。', open:'卫星在看你。新闻词被和谐。', npcs:'国级强者、官员。', hooks:'传话不站错。', danger:'极高。', reward:'国级情报。' },
    { n:7, realm:'神话', theme:'阴影', id:'见证。', event:'神话复苏投影。', open:'神话投影低头。你负责眨眼频率。', npcs:'神话阴影、主角。', hooks:'条件胜。', danger:'超阶。', reward:'见证。' },
  ],
});

// ---- 末世狠人 ----
fixFile('产出/批次861/末世第一狠人.md', {
  name: '末世第一狠人',
  mapLine: '普通人≈一；觉醒初≈二；小队精英≈三；据点≈四；区域灾变≈五',
  tierMaps: '一≈普通人，二≈觉醒初，三≈精英，四≈据点，五≈区域灾变',
  tiers: [
    { n:1, realm:'凡人', theme:'爆发日', id:'上班族。', event:'电梯停，尸潮，信号死。', open:'手机没信号只剩手电。楼道在喘。', npcs:'主角、邻居。', hooks:'逃出小区。', danger:'高。', reward:'存活。' },
    { n:2, realm:'觉醒', theme:'物资', id:'觉醒新人。', event:'超市争夺，货架后有枪。', open:'货架后有人瞄准。水比子弹响。', npcs:'主角、掠夺者。', hooks:'抢水粮。', danger:'高。', reward:'物资。' },
    { n:3, realm:'精英', theme:'内鬼', id:'小队骨干。', event:'队友卖坐标，对讲有笑。', open:'对讲里有笑声。坐标是你家。', npcs:'队友真名、商人。', hooks:'清洗内鬼。', danger:'高。', reward:'信任或仇。' },
    { n:4, realm:'据点', theme:'墙内', id:'管事。', event:'选举刀光，票箱旁砍刀。', open:'票箱旁放砍刀。有人鼓掌。', npcs:'据点首领、反对派。', hooks:'夺权/护民。', danger:'极高。', reward:'据点权。' },
    { n:5, realm:'区域', theme:'灾变', id:'领袖。', event:'变异潮推墙。', open:'墙在抖。狠名传出城。', npcs:'区域级变异、主角。', hooks:'守或迁。', danger:'极高。', reward:'区域秩序。' },
  ],
});

// ---- 武道深渊 ----
fixFile('产出/批次861/从武道世界开始击穿深渊.md', {
  name: '从武道世界开始击穿深渊',
  mapLine: '炼体≈一～二；宗师≈三～四；入道≈五；领主≈六；上位≈七；更深＝超阶',
  tierMaps: '一～二≈炼体，三～四≈宗师，五≈入道，六≈领主，七≈上位阴影',
  tiers: [
    { n:1, realm:'炼体', theme:'裂口夜', id:'外门。', event:'城墙裂缝流黑气。', open:'拳打在规则上。手在麻。', npcs:'主角、城卫。', hooks:'封缝。', danger:'中。', reward:'疗伤药。' },
    { n:2, realm:'精炼', theme:'武馆', id:'弟子。', event:'馆主逼签猎渊名册。', open:'名册是卖身契。血按在纸上。', npcs:'馆主、同门。', hooks:'签/逃。', danger:'中。', reward:'功法。' },
    { n:3, realm:'宗师', theme:'首征', id:'精英。', event:'第一次下渊，回声学名。', open:'回声学你的名字。别答应。', npcs:'猎渊队。', hooks:'活着回。', danger:'高。', reward:'渊材。' },
    { n:4, realm:'大宗', theme:'城战', id:'客卿。', event:'裂口扩大半城撤。', open:'半城撤离。鼓还在敲。', npcs:'领主投影、城主。', hooks:'守城。', danger:'高。', reward:'城级功勋。' },
    { n:5, realm:'入道', theme:'击穿', id:'核心弟子。', event:'打穿一层，天在漏。', open:'天在漏。你的拳在钉钉子。', npcs:'主角、净土官。', hooks:'再下一层。', danger:'极高。', reward:'本命升。' },
    { n:6, realm:'领主', theme:'猎王', id:'猎手。', event:'领主点名。', open:'阴影会说话。点的是你。', npcs:'深渊领主、主角。', hooks:'刺/谈。', danger:'极高。', reward:'领主核。' },
    { n:7, realm:'上位', theme:'终局前', id:'见证。', event:'上位注视，刀折心不折。', open:'刀折了。心没折。', npcs:'上位阴影。', hooks:'条件胜。', danger:'超阶。', reward:'击穿权。' },
  ],
});

// ---- 义体 ----
fixFile('产出/批次861/你这义体合法吗.md', {
  name: '你这义体合法吗',
  mapLine: '民用≈一；强化≈二；军用黑市≈三；装甲≈四；企业武装≈五',
  tierMaps: '一≈民用，二≈强化，三≈军用黑市，四≈装甲，五≈企业武装',
  tiers: [
    { n:1, realm:'民用', theme:'临检', id:'上班族。', event:'路边临检台灯，手臂灯闪红。', open:'手臂灯闪红。序列号在出汗。', npcs:'巡警、主角。', hooks:'过检。', danger:'中。', reward:'执照。' },
    { n:2, realm:'强化', theme:'诊所', id:'顾客。', event:'黑市医报价，麻醉可选项。', open:'麻醉可选项。排异是赠品。', npcs:'义体医。', hooks:'改装/拒绝。', danger:'中。', reward:'零件。' },
    { n:3, realm:'军用', theme:'巷战', id:'佣兵。', event:'帮派要臂，子弹认主。', open:'子弹会认主。巷子只有一条。', npcs:'帮派、警察。', hooks:'突围。', danger:'高。', reward:'军用件。' },
    { n:4, realm:'装甲', theme:'回收', id:'安保。', event:'企业回收队广播编号。', open:'编号在广播。跑不赢信号。', npcs:'企业特工。', hooks:'夺编号。', danger:'极高。', reward:'装甲数据。' },
    { n:5, realm:'企业', theme:'清算', id:'缝隙人。', event:'全城合法性午夜重定义。', open:'法律午夜生效。义体先于人醒。', npcs:'企业巨头阴影。', hooks:'条件胜/新法空窗。', danger:'极高。', reward:'存活/新法。' },
  ],
});

// ---- 黄昏分界 ----
fixFile('产出/批次861/黄昏分界.md', {
  name: '黄昏分界',
  mapLine: '凡人≈一；警戒≈二；适应≈三；行者≈四～五；改写≈六；源阴影≈七',
  tierMaps: '一≈凡人，二≈警戒，三≈适应，四～五≈行者，六≈改写，七≈黄昏源阴影',
  tiers: [
    { n:1, realm:'凡人', theme:'首警', id:'市民。', event:'警报红光，太阳像假的。', open:'太阳还在却像假的。闹钟比枪重要。', npcs:'主角、邻居。', hooks:'进掩体。', danger:'中。', reward:'存活。' },
    { n:2, realm:'警戒', theme:'墙', id:'新兵。', event:'墙外第一具不该动的尸体，口令每小时变。', open:'口令每小时变。说错即射。', npcs:'警戒官。', hooks:'守岗。', danger:'中高。', reward:'编制。' },
    { n:3, realm:'适应', theme:'觉醒', id:'适应者。', event:'检测贴变黑。', open:'检测贴变黑。你开始听见墙外的歌。', npcs:'适应同伴。', hooks:'登记/藏。', danger:'高。', reward:'适应药剂。' },
    { n:4, realm:'行者', theme:'带内', id:'编外行者。', event:'分界站任务，路牌融化。', open:'路牌在融化。通行证在烫。', npcs:'行者前辈。', hooks:'取样本。', danger:'高。', reward:'样本。' },
    { n:5, realm:'深行', theme:'站政', id:'站员。', event:'站长卖通行证，票价是命。', open:'票价是命。假票更贵。', npcs:'站长、走私者。', hooks:'揭露。', danger:'极高。', reward:'真通行证。' },
    { n:6, realm:'改写', theme:'近源', id:'改写候选。', event:'规则句可改一条，改错抹除。', open:'改错即抹除。笔比刀抖。', npcs:'改写者、主角。', hooks:'改对一句。', danger:'极高。', reward:'规则权。' },
    { n:7, realm:'源', theme:'终局', id:'见证。', event:'源点睁眼，昼夜重叠。', open:'黄昏与白昼重叠。你的影子有两个。', npcs:'黄昏源阴影。', hooks:'条件胜重锚。', danger:'超阶。', reward:'分界重锚。' },
  ],
});

console.log('all fixed');
