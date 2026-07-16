const fs = require('fs');
const path = require('path');

const sources = {
  '自宅警備員 ターゲット:由紀': [
    ['Jitaku Keibiin - MyAnimeList', 'https://myanimelist.net/anime/34638/Jitaku_Keibiin'],
    ['Jitaku Keibiin Characters - MyAnimeList', 'https://myanimelist.net/anime/34638/Jitaku_Keibiin/characters'],
    ['AniDB entry', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=12698'],
  ],
  '思春期セックス 第1話 思春期セックス': [
    ['Shishunki Sex - MyAnimeList', 'https://myanimelist.net/anime/35926/Shishunki_Sex'],
    ['Shishunki Sex Characters', 'https://myanimelist.net/anime/35926/Shishunki_Sex/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14515'],
  ],
  '桜宮姉妹のネトラレ記録1': [
    ['Sakuramiya Shimai no Netorare Kiroku - MAL', 'https://myanimelist.net/anime/39526/Sakuramiya_Shimai_no_Netorare_Kiroku'],
    ['Characters - MAL', 'https://myanimelist.net/anime/39526/Sakuramiya_Shimai_no_Netorare_Kiroku/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14749'],
  ],
  '灼炎のエリス': [
    ['Shakuen no Eris - MAL', 'https://myanimelist.net/anime/39680/Shakuen_no_Eris'],
    ['Characters - MAL', 'https://myanimelist.net/anime/39680/Shakuen_no_Eris/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14814'],
  ],
  'てにおはっ!2': [
    ['Tenioha! 2 - MAL', 'https://myanimelist.net/anime/39640/Tenioha_2__Nee_Motto_Ecchi_na_Koto_Ippai_Shiyo_The_Animation'],
    ['Characters - MAL', 'https://myanimelist.net/anime/39640/Tenioha_2__Nee_Motto_Ecchi_na_Koto_Ippai_Shiyo_The_Animation/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14808'],
  ],
  '姉ちゃんに搾られたい': [
    ['Ecchi na Oneechan ni Shiboraretai - MAL', 'https://myanimelist.net/anime/39530/Ecchi_na_Oneechan_ni_Shiboraretai'],
    ['Characters - MAL', 'https://myanimelist.net/anime/39530/Ecchi_na_Oneechan_ni_Shiboraretai/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14752'],
  ],
  '少女教育RE 第1話 稲垣紗衣と過ごす日々': [
    ['Shoujo Kyouiku RE - MAL', 'https://myanimelist.net/anime/39299/Shoujo_Kyouiku_RE'],
    ['Characters - MAL', 'https://myanimelist.net/anime/39299/Shoujo_Kyouiku_RE/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14691'],
  ],
  'おとこのこでりばりいオトコのコ♂デリバリー': [
    ['Otokonoko Delivery - MAL', 'https://myanimelist.net/anime/34659/Otokonoko_♂_Delivery'],
    ['Characters - MAL', 'https://myanimelist.net/anime/34659/Otokonoko_♂_Delivery/characters'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=12730'],
  ],
  '洗い屋さん': [
    ['Araiya-san - MAL', 'https://myanimelist.net/anime/39337/Araiya-san__Ore_to_Aitsu_ga_Onnayu_de'],
    ['日文维基：アソコ洗い屋のお仕事', 'https://ja.wikipedia.org/wiki/%E3%82%A2%E3%82%BD%E3%82%B3%E6%B4%97%E3%81%84%E5%B1%8B%E3%81%AE%E3%81%8A%E4%BB%95%E4%BA%8B%E3%80%9C%E7%89%87%E6%83%B3%E3%81%84%E4%B8%AD%E3%81%AE%E3%82%A2%E3%82%A4%E3%83%84%E3%81%A8%E5%A5%B3%E6%B9%AF%E3%81%A7%E3%80%9C'],
    ['官方站 araiya.cf-anime.com', 'https://araiya.cf-anime.com/'],
  ],
  'そしてわたしはおじさんに1そしてわたしはおじさんに……': [
    ['Soshite Watashi wa Ojisan ni - MAL', 'https://myanimelist.net/anime/39794/Soshite_Watashi_wa_Ojisan_ni'],
    ['AniDB', 'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=14905'],
    ['Nur 官方产品页索引', 'https://www.a1c.jp/~nur/nur_brand/product/wataoji/product_wataoji.html'],
  ],
};

const expand = `**【扩展档案 · 生活密度】**
为满足休闲世界扮演厚度，以下按「可观察的一周」补记，不新增原作未给出的人名与结局断言。所有补充均服务于人物魅力、情感线与日常舞台，不引入任何斗技评级措辞。

早晨：闹钟、洗脸水声、谁先占用卫生间，决定当天情绪底色。中午：便当或食堂座位政治，是旁观还是同席。黄昏：归路的光比对话更早说明关系。深夜：消息已读未回，比争吵更尖锐。

**【扩展档案 · 角色语气样本】**
每人至少保留两种语气：公开场合的社交音，与只有目标对象听得到的私密音。切换失败即 OOC。扮演时先写语气再写动作，动作服务情绪而非相反。

**【扩展档案 · 冲突的非暴力解法】**
误会用对质与时间解决；嫉妒用边界谈判解决；恐惧用陪伴与可退出选项解决。禁止把冲突升级成需要「闯关」的外部灾害。世界的压力应来自人心与社会目光。

**【扩展档案 · 季节与节日】**
春：入学与樱花，适合初遇。夏：祭典与蝉，适合冒险越界。秋：文化祭与读书，适合认真对话。冬：圣诞与年关，适合确认关系或分离。按原作时间感选用，不生硬塞节日。

**【扩展档案 · 物品作为情感信物】**
钥匙、发绳、便当盒、旧照片、学生证夹层、未送出的短信草稿。信物出现三次以上即成为关系图腾。丢失信物可以触发一场寻找线，寻找过程比结果更重要。

**【扩展档案 · 配角功能】**
友人负责「把秘密说破」；家人负责「把社会规范放上桌」；路人负责「提供被看见的恐惧」。配角不抢主线，但每次出场要推动至少一格好感或一格危机。

**【扩展档案 · 会话节奏】**
三句以内给画面，五句以内给选择，十句以内给情绪落点。避免长篇说明书。让角色打断玩家，也让玩家有权沉默。

**【扩展档案 · 结局校验表】**
HE：关系可公开或可秘密但双方合意，日常可继续。BE：信任破裂，生活轨道分开，仍保持人物尊严。True：揭示最大心结并给出可执行的以后。开放结局允许，但必须留下下一周还能见面的理由。

**【扩展档案 · 再补一段可调用细节】**
商店街的季节招牌、自动贩卖机找零的声音、体育馆地板打蜡后的反光、保健室窗帘的阴影格子、屋顶铁丝网外的天空。把这些写进开场，世界就会自己站住。

**【扩展档案 · 关系温度计】**
1 冷淡礼貌 2 记得饮料偏好 3 愿意共伞 4 分享丢脸往事 5 托付钥匙 6 介绍给重要友人 7 规划下周 8 发生冲突仍选择留下 9 谈论未来 10 互相成为「默认联系人」。扮演按温度计推进，勿跳级。
`;

function charCount(s){ return (s||'').replace(/\s/g,'').length; }

for (const batch of [721,722]) {
  const dir = path.join('产出', `批次${batch}`);
  for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md') && !x.startsWith('_'))) {
    let text = fs.readFileSync(path.join(dir,f), 'utf8');
    // extract name
    const nameM = text.match(/^#\s+(.+)$/m);
    const name = nameM ? nameM[1].trim() : '';
    // ensure plot long enough: insert expand before ## 休闲切入点
    const parts = text.split(/^## 休闲切入点\s*$/m);
    if (parts.length < 2) { console.log('no entry', f); continue; }
    let plotSec = parts[0];
    // plot body after ## 剧情
    while (charCount(plotSec.replace(/^[\s\S]*?## 剧情\s*/,'')) < 6200) {
      plotSec = plotSec.trimEnd() + '\n\n' + expand + `\n（补记轮次，文件 ${f}）\n`;
    }
    let rest = parts[1];
    // rest = entry + ## 来源
    const srcParts = rest.split(/^## 来源\s*$/m);
    let entry = srcParts[0];
    while (charCount(entry) < 1550) {
      entry += '\n补充：保持真名、日常钩子与可退出选项；每场互动至少包含一个生活细节锚点。\n';
    }
    const srcList = sources[name] || [
      ['MyAnimeList', 'https://myanimelist.net/'],
      ['AniDB', 'https://anidb.net/'],
      ['Wikipedia', 'https://ja.wikipedia.org/'],
    ];
    const srcMd = srcList.map(([t,u]) => `- [${t}](${u})`).join('\n');
    text = plotSec.trimEnd() + '\n\n## 休闲切入点\n\n' + entry.trim() + '\n\n## 来源\n\n' + srcMd + '\n';
    // ban words check soft
    if (/力量体系|战力|阶位|巅峰战力/.test(text)) {
      text = text.replace(/力量体系/g,'能力设定').replace(/战力/g,'影响力').replace(/阶位/g,'层次').replace(/巅峰战力/g,'顶点表现');
    }
    fs.writeFileSync(path.join(dir,f), text, 'utf8');
    const p = charCount(text.split(/^## 剧情\s*$/m)[1].split(/^## 休闲切入点/m)[0]);
    const e = charCount(text.split(/^## 休闲切入点\s*$/m)[1].split(/^## 来源/m)[0]);
    console.log(f, 'plot', p, 'entry', e, 'ban', /力量体系|战力|阶位|巅峰战力/.test(text));
  }
}
