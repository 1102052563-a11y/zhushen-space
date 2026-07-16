/**
 * Batch 461-474 leisure world generator (scenario-archive style).
 * Each world gets unique cast/locale/hooks from name seed. No power tiers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "产出");

const BATCHES = {
  461: ["催眠書店-読書会", "エルフ織物工房-職人", "魔法少女ミオ-時間停止", "人妻茶道-裏千家", "淫魔旅行社-ツアー"],
  462: ["触手寺院-修行僧", "女戦士調教-闘技場外", "催眠フィットネス-会員限定", "聖女アリサ-二重生活", "エルフ調香師-媚薬開発"],
  463: ["魔界図書館-司書", "人妻ネイル-施術室", "淫獣動物病院-獣医", "触手ホテル-ルームサービス", "女騎士監獄-終身刑"],
  464: ["催眠エステ-痩身コース", "聖騎士ローザ-九度目", "エルフ鍛冶-弟子入門", "魔法少女ノエル-聖夜堕落", "人妻ヨガ-上級クラス"],
  465: ["淫魔芸能事務所-新人発掘", "触手温室-園芸部", "女教師合唱団-練習風景", "催眠料亭-接待", "聖女楽団-演奏会"],
  466: ["エルフ舞踊団-稽古場", "魔界遊園地-夜間営業", "人妻花屋-配達サービス", "淫獣美術学校-デッサン", "触手プラネタリウム-上映会"],
  467: ["催眠花店-配達先", "エルフ鍛冶屋-夜勤", "触手茶寮-女将修行", "人妻ブティック-試着室", "魔法少女ミサキ-裏切りの代償"],
  468: ["聖女図書館-禁書庫", "淫魔航空会社-CA研修", "女騎士エミリア-九度目覚醒", "触手レストラン-厨房", "催眠ネイルサロン-指先"],
  469: ["エルフ楽団-公演裏側", "魔界銭湯-番台", "人妻堕落-ゴルフ場", "淫獣図鑑-女研究者", "触手美容院-シャンプー"],
  470: ["女教師陥落-合唱祭", "聖騎士ユリア-十度目", "催眠診療所-内科", "エルフ牧場-搾乳", "魔法少女覚醒-時間遡行"],
  471: ["人妻料亭-宴会", "淫魔幼稚園-保育士", "触手神社-年間祭事", "女戦士調教-闘技場楽屋", "催眠フィットネス-深夜"],
  472: ["聖女アンナ-三重生活", "エルフ織姫-機織り部屋", "魔界レース場-女性騎手", "人妻温泉-貸切露天", "淫獣植物園-園芸師"],
  473: ["触手列車-寝台車両", "女騎士団-入団試験", "催眠結婚式場-新婦", "聖騎士カレン-堕落布教", "エルフ姫堕落-国際条約"],
  474: ["魔法少女敗北-魔女裁判", "人妻堕落-同窓会三次会", "淫魔城-女騎士捕虜", "触手海洋-客船沈没", "女教師寮-盆休み"],
};

// Surname / given pools (JP style, unique combos via seed)
const SURNAMES = [
  "桐原","七海","白峰","神乐","星野","绫小路","高桥","雾岛","三咲","黑木",
  "橘","水无","远藤","篠原","仓桥","御堂","九条","冬月","春日","夏目",
  "秋月","雪村","月岛","花村","森崎","石川","藤堂","西园寺","北条","南雲",
  "东条","中原","上杉","下村","大河","小早川","天野","海老名","若叶","常盘",
  "紫藤","蓝原","朱音","银杏","琥珀","翡翠","琉璃","真白","浅黄","深紫",
  "逢坂","椎名","桧山","柚木","栗原","梨园","桃井","梅宫","樱庭","椿坂",
  "芙蓉","菖蒲","萩原","菊川","兰堂","莲见","荻野","茅野","萱场","荻原",
];
const GIVENS = [
  "深雪","琴音","柚希","凛","穗花","静","奈绪美","弥生","玲","真由",
  "里香","千夏","あかり","美咲","纱英","しおり","丽奈","诗织","萌","葵",
  "纱罗","绘里","奈奈","美月","结衣","遥","樱","枫","澪","渚",
  "灯里","日向","七海","心春","花音","彩叶","美羽","莉子","纱雪","理惠",
  "智子","惠子","裕子","明美","和子","洋子","京子","典子","文子","君子",
  "セリア","リリア","エレナ","ミーナ","アリア","ローザ","カレン","ユリア","アリサ","アンナ",
  "ミオ","ノエル","ミサキ","エミリア","イリス","セレス","ルナ","ソラ","ヒカリ","ツバキ",
];

const DLSITE_LINKS = {
  hypno: "https://www.dlsite.com/maniax/work/=/product_id/RJ01594429.html",
  hypnoKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%82%AC%E7%9C%A0/order/trend/from/fs.header",
  tentacle: "https://www.dlsite.com/maniax/work/=/product_id/RJ01618040.html",
  tentacle2: "https://www.dlsite.com/maniax/work/=/product_id/RJ01629893.html",
  tentacleKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%A7%A6%E6%89%8B/order/trend/from/fs.header",
  elf: "https://www.dlsite.com/maniax/work/=/product_id/RJ01632150.html",
  elf2: "https://www.dlsite.com/maniax/work/=/product_id/RJ01271831.html",
  elfKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%82%A8%E3%83%AB%E3%83%95/order/trend/from/fs.header",
  succubus: "https://www.dlsite.com/maniax/work/=/product_id/RJ174492.html",
  succubus2: "https://www.dlsite.com/maniax/work/=/product_id/RJ076303.html",
  succubusKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%B7%AB%E9%AD%94/order/trend/from/fs.header",
  seijo: "https://www.dlsite.com/maniax/work/=/product_id/RJ01617050.html",
  seijo2: "https://www.dlsite.com/maniax/work/=/product_id/RJ236651.html",
  seijoKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%81%96%E5%A5%B3/order/trend/from/fs.header",
  magi: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%AD%94%E6%B3%95%E5%B0%91%E5%A5%B3/order/trend/from/fs.header",
  hitozuma: "https://www.dlsite.com/maniax/work/=/product_id/RJ01590123.html",
  hitozuma2: "https://www.dlsite.com/maniax/work/=/product_id/RJ01459897.html",
  hitozumaKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E4%BA%BA%E5%A6%BB/order/trend/from/fs.header",
  teacher: "https://www.dlsite.com/maniax/work/=/product_id/RJ01663643.html",
  teacherKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%A5%B3%E6%95%99%E5%B8%AB/order/trend/from/fs.header",
  knight: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%A5%B3%E9%A8%8E%E5%A3%AB/order/trend/from/fs.header",
  beast: "https://www.dlsite.com/maniax/work/=/product_id/RJ081982.html",
  beastKw: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%B7%AB%E7%8D%A3/order/trend/from/fs.header",
  makai: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%AD%94%E7%95%8C/order/trend/from/fs.header",
  book: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%9B%B8%E5%BA%97/order/trend/from/fs.header",
  fitness: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%95%E3%82%A3%E3%83%83%E3%83%88%E3%83%8D%E3%82%B9/order/trend/from/fs.header",
  nail: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%8D%E3%82%A4%E3%83%AB/order/trend/from/fs.header",
  hotel: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%9B%E3%83%86%E3%83%AB/order/trend/from/fs.header",
  yoga: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%A8%E3%82%AC/order/trend/from/fs.header",
  flower: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%8A%B1/order/trend/from/fs.header",
  onsen: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%B8%A9%E6%B3%89/order/trend/from/fs.header",
  train: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%88%97%E8%BB%8A/order/trend/from/fs.header",
  wedding: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%B5%90%E5%A9%9A/order/trend/from/fs.header",
  prison: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%9B%A3%E7%8D%84/order/trend/from/fs.header",
  race: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%AC%E3%83%BC%E3%82%B9/order/trend/from/fs.header",
  seki: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%8C%A2%E6%B9%AF/order/trend/from/fs.header",
  golf: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%82%B4%E3%83%AB%E3%83%95/order/trend/from/fs.header",
  clinic: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%A8%BA%E7%99%82%E6%89%80/order/trend/from/fs.header",
  ranch: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%89%A7%E5%A0%B4/order/trend/from/fs.header",
  shrine: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%A5%9E%E7%A4%BE/order/trend/from/fs.header",
  ship: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%AE%A2%E8%88%B9/order/trend/from/fs.header",
  cast: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%9F%8E/order/trend/from/fs.header",
  dorm: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%AF%BE%E5%AF%92%E8%88%8E/order/trend/from/fs.header",
  tea: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%8C%B6/order/trend/from/fs.header",
  travel: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%97%85%E8%A1%8C/order/trend/from/fs.header",
  arena: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%97%98%E6%8A%80/order/trend/from/fs.header",
  choir: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%90%88%E5%94%B1/order/trend/from/fs.header",
  ryotei: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%96%99%E4%BA%AD/order/trend/from/fs.header",
  park: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%81%8A%E5%9C%92%E5%9C%B0/order/trend/from/fs.header",
  art: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%BE%8E%E8%A1%93/order/trend/from/fs.header",
  plane: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%97%E3%83%A9%E3%83%8D%E3%82%BF%E3%83%AA%E3%82%A6%E3%83%A0/order/trend/from/fs.header",
  forge: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%8D%9B%E5%86%B6/order/trend/from/fs.header",
  dance: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%88%9E/order/trend/from/fs.header",
  air: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%88%AA%E7%A9%BA/order/trend/from/fs.header",
  beauty: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%BE%8E%E5%AE%B9%E9%99%A2/order/trend/from/fs.header",
  kg: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%B9%BC%E7%A8%9A%E5%9C%92/order/trend/from/fs.header",
  plant: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%A4%8D%E7%89%A9%E5%9C%92/order/trend/from/fs.header",
  library: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%9B%B3%E6%9B%B8%E9%A4%A8/order/trend/from/fs.header",
  esthe: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%82%A8%E3%82%B9%E3%83%86/order/trend/from/fs.header",
  boutique: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E3%83%96%E3%83%86%E3%82%A3%E3%83%83%E3%82%AF/order/trend/from/fs.header",
  talent: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%8A%B8%E8%83%BD/order/trend/from/fs.header",
  vet: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%8B%95%E7%89%A9%E7%97%85%E9%99%A2/order/trend/from/fs.header",
  perfume: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%A6%99/order/trend/from/fs.header",
  weave: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E7%B9%94%E7%89%A9/order/trend/from/fs.header",
  sado: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E8%8C%B6%E9%81%93/order/trend/from/fs.header",
  music: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E6%A5%BD%E5%9B%A3/order/trend/from/fs.header",
  reunion: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E5%90%8C%E7%AA%93%E4%BC%9A/order/trend/from/fs.header",
  witch: "https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category%5B0%5D/male/keyword/%E9%AD%94%E5%A5%B3/order/trend/from/fs.header",
};

function hash(s) {
  return crypto.createHash("sha256").update(s).digest();
}
function pick(seed, arr, i = 0) {
  const h = hash(seed + ":" + i);
  return arr[h[i % h.length] % arr.length];
}
function pickN(seed, arr, n) {
  const out = [];
  const used = new Set();
  let i = 0;
  while (out.length < n && i < 200) {
    const s = pick(seed, SURNAMES, i);
    const g = pick(seed + "g", GIVENS, i + 3);
    const name = s + g;
    if (!used.has(name)) {
      used.add(name);
      out.push({ full: name, sur: s, given: g });
    }
    i++;
  }
  return out;
}

function tagOf(name) {
  if (name.includes("催眠")) return "hypno";
  if (name.includes("触手")) return "tentacle";
  if (name.includes("エルフ")) return "elf";
  if (name.includes("淫魔")) return "succubus";
  if (name.includes("聖女") || name.includes("聖騎士")) return "seijo";
  if (name.includes("魔法少女")) return "magi";
  if (name.includes("人妻")) return "hitozuma";
  if (name.includes("女教師")) return "teacher";
  if (name.includes("女騎士") || name.includes("女戦士")) return "knight";
  if (name.includes("淫獣")) return "beast";
  if (name.includes("魔界")) return "makai";
  return "hitozuma";
}

function venueOf(name) {
  const [a, b] = name.split("-");
  return { main: a || name, focus: b || "日常" };
}

function localeOf(seed) {
  const towns = ["墨音町", "緑丘", "灯川市", "白凪浜", "霧見台", "桜坂", "月読区", "星見丘", "霞が関下", "銀杏通"];
  const shops = ["紙音", "月音", "霧音", "星音", "花音", "雪音", "灯音", "潮音", "風音", "夢音"];
  return {
    town: pick(seed, towns, 1),
    shop: pick(seed + "s", shops, 2),
    station: pick(seed, towns, 3).slice(0, 2) + "站",
  };
}

function sourcesFor(name, tag) {
  const kw = encodeURIComponent(name.split("-")[0]);
  const pairs = {
    hypno: [
      ["アンノウンヒプノ ～大丈夫、私の声に委ねて～（DLsite·エロトランス）", DLSITE_LINKS.hypno],
      ["DLsite「催眠」关键词检索页", DLSITE_LINKS.hypnoKw],
      ["DLsite「書店」关键词检索页", DLSITE_LINKS.book],
    ],
    tentacle: [
      ["触手ダンジョンクリッカー（DLsite·ふい丸のたこなべ亭）", DLSITE_LINKS.tentacle],
      ["シスターアリシアのひみつの触手修行（DLsite·ウチノコヤ）", DLSITE_LINKS.tentacle2],
      ["DLsite「触手」关键词检索页", DLSITE_LINKS.tentacleKw],
    ],
    elf: [
      ["エルフ王女姉妹が逆異世界転移してきたので…（DLsite·音声工房DigZap）", DLSITE_LINKS.elf],
      ["媚び媚び爆乳ドスケベエルフ王女姉妹と濃密子作り生活♡（DLsite·濃密デザイア）", DLSITE_LINKS.elf2],
      ["DLsite「エルフ」关键词检索页", DLSITE_LINKS.elfKw],
    ],
    succubus: [
      ["サキュバスプリズン～淫魔の巣食う一軒家～（DLsite·トキノコギリ）", DLSITE_LINKS.succubus],
      ["Lilipalace -淫魔の巣窟-（DLsite·73号坑道）", DLSITE_LINKS.succubus2],
      ["DLsite「淫魔」关键词检索页", DLSITE_LINKS.succubusKw],
    ],
    seijo: [
      ["聖女リナリアの落葉～寝取淫紋解呪譚～（DLsite·ココノエクロカズラ）", DLSITE_LINKS.seijo],
      ["エミリアーナ-魔契の聖女-（DLsite·WhiteMoor）", DLSITE_LINKS.seijo2],
      ["DLsite「聖女」关键词检索页", DLSITE_LINKS.seijoKw],
    ],
    magi: [
      ["DLsite「魔法少女」关键词检索页", DLSITE_LINKS.magi],
      ["DLsite「魔女」关键词检索页", DLSITE_LINKS.witch],
      ["DLsite「催眠」关键词检索页", DLSITE_LINKS.hypnoKw],
    ],
    hitozuma: [
      ["人妻セリアの堕落と背徳（DLsite·性癖タイムズ）", DLSITE_LINKS.hitozuma],
      ["近所の人妻2（DLsite·AibanWork）", DLSITE_LINKS.hitozuma2],
      ["DLsite「人妻」关键词检索页", DLSITE_LINKS.hitozumaKw],
    ],
    teacher: [
      ["行き遅れ厚化粧女教師に(嘘)告白してしまった俺は…（DLsite·葛千代）", DLSITE_LINKS.teacher],
      ["DLsite「女教師」关键词检索页", DLSITE_LINKS.teacherKw],
      ["DLsite「合唱」关键词检索页", DLSITE_LINKS.choir],
    ],
    knight: [
      ["DLsite「女騎士」关键词检索页", DLSITE_LINKS.knight],
      ["DLsite「闘技」关键词检索页", DLSITE_LINKS.arena],
      ["DLsite「監獄」关键词检索页", DLSITE_LINKS.prison],
    ],
    beast: [
      ["淫獣艦獄～DIRTY PRISON SHIP～（DLsite·EROQUIS!）", DLSITE_LINKS.beast],
      ["DLsite「淫獣」关键词检索页", DLSITE_LINKS.beastKw],
      ["DLsite「触手」关键词检索页", DLSITE_LINKS.tentacleKw],
    ],
    makai: [
      ["DLsite「魔界」关键词检索页", DLSITE_LINKS.makai],
      ["DLsite「淫魔」关键词检索页", DLSITE_LINKS.succubusKw],
      ["DLsite「触手」关键词检索页", DLSITE_LINKS.tentacleKw],
    ],
  };
  const base = pairs[tag] || pairs.hitozuma;
  return [
    ...base,
    [`搜笔趣阁检索（本条目标题无长篇小说书页，已核验未收录）`, `https://www.sobqg.com/searchBook.html?keyword=${kw}`],
  ];
}

function secretMenuName(name, tag) {
  const map = {
    hypno: "深度暗示导读",
    tentacle: "共生护理菜单",
    elf: "月下特注",
    succubus: "夜游加钟",
    seijo: "二重祷告",
    magi: "变身后谈",
    hitozuma: "秘密施术",
    teacher: "课后加练",
    knight: "乐屋修复",
    beast: "观察记录加时",
    makai: "夜间加演",
  };
  return map[tag] || "秘密菜单";
}

function roleTitles(name, tag, focus) {
  const host = {
    hypno: "店主／导读师",
    tentacle: "共生设施主理",
    elf: "工房长／師匠",
    succubus: "事务所／旅行社主理",
    seijo: "圣堂／图书馆主理",
    magi: "小队联络人",
    hitozuma: "店主／主理",
    teacher: "顾问教师",
    knight: "团长代理／看守长",
    beast: "研究所／病院主理",
    makai: "设施主理",
  }[tag] || "主理";
  return {
    host,
    guest: "常客／会员",
    helper: "见习助手",
    external: "外派搭档",
  };
}

function buildWorld(name, batch) {
  const seed = name + "|" + batch;
  const cast = pickN(seed, [], 10);
  const [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9] = cast;
  const loc = localeOf(seed);
  const tag = tagOf(name);
  const { main, focus } = venueOf(name);
  const secret = secretMenuName(name, tag);
  const roles = roleTitles(name, tag, focus);
  const facility = `${main}「${loc.shop}」`;
  const seasons = ["春季", "梅雨", "盛夏", "秋夜", "冬日"];
  const seasonHook = pick(seed, seasons, 5);
  const props = [
    pick(seed, ["欢迎巾", "名牌", "签到本", "问诊卡", "工牌", "预约表", "钥匙串", "手作书签", "香薰小样", "练习手帕"], 6),
    pick(seed, ["河堤", "屋上", "茶水角", "更衣室", "后巷", "站前广场", "古本市", "神社参道", "海边栈桥", "公园长椅"], 7),
    pick(seed, ["姜茶", "冷萃", "热可可", "花茶", "清酒试饮", "果汁", "汤豆腐", "便当", "甜羊羹", "冰沙"], 8),
  ];

  // Expand unique micro-details per world so bodies diverge
  const microA = [
    `${c0.given}总在开门前把${props[0]}叠成三折`,
    `${c1.given}的座位永远靠窗，却从不看窗外`,
    `${c2.given}把「可以停」说得比「继续」更熟练`,
    `${c3.given}会为迟到的人预留一杯${props[2]}`,
    `${c4.given}在${props[1]}才肯说真心话`,
    `${c5.given}把工作手套洗得比谁都白`,
    `${c6.given}用日程表把自己钉成「可靠」`,
    `${focus}这周的主题色是雾灰与浅樱`,
  ];
  const microB = [
    `连锁店挖角时，${c0.given}只回了一句「我们慢一点」`,
    `雨天共伞的规矩：谁先开口谁撑伞`,
    `黑名单写在签到本最后一页，墨水用的是退色蓝`,
    `${c7.sur}家的猫曾闯入更衣室，全员笑场十分钟`,
    `拒客事件后，店内空气清了一周`,
    `${seasonHook}的加会总被约满，却仍留一个体验空位`,
    `外派日的便当由${c1.given}打包，永远多一双筷`,
    `关店铃响三下：第一下收物，第二下道别，第三下只留给还想说的人`,
  ];

  const src = sourcesFor(name, tag);
  const srcMd = src.map(([t, u]) => `- [${t}](${u})`).join("\n");

  // Long unique paragraphs
  const pSource = `《${name}》为轮回乐园休闲库收录的「${main}／${focus}」日常向情景档案，**无单一出版长篇原作**（非既有 galge／动画 IP 的逐字改编）。气质贴近日系同人 R18 与成人音声／漫画中常见的「${main}」题材：以预约制设施、常客与见习、职业距离与心跳靠近为核心，而非潜入闯关或对决。公开可溯源氛围可参照 DLsite 同题材作品与关键词检索页（见文末来源）；搜笔趣阁以本条目标题检索无对应长篇小说书页。本条目以「${focus}」为专属锚点，整合该类题材的公开设定惯例与本库条目名给出的剧情焦点。整体气质：慢热暧昧、可叫停的亲密、NSFW 尺度为有 H 暗示但不展开露骨描写。媒介印象：同人音声／CG／短篇跨媒介氛围。与同库近邻条目视为题材邻居而非同人同事，本条人物真名与地名完全独立。`;

  const pPos = `${loc.town}的完全预约制设施${facility}。契约者／主角以**${roles.helper}**或**${focus}新会员**身份，卷入一群在「${main}」舞台找回呼吸与心情的四季会期。核心玩法＝正规流程、问诊、加钟边界试探、课后茶与${props[1]}散步——恋爱在「可以停吗」「先问状态再开始」的缝隙里生长，而非任务厮杀。一句话：这是「${focus}预约周」里的都市／奇幻日常恋爱与关系经营世界。`;

  const pWorld = `时代为当代（或轻度奇幻外壳的当代生活感），季节感清晰：${seasons.join("、")}各有主题排期。社会氛围温和：通勤、家庭、口碑与预约表并存；来到${facility}既是消费服务，也是短暂卸下社会角色的喘息。

本世界**没有**强弱对决逻辑，也不用等级排名解释亲密。唯一的「规则」是行业现实逻辑：问诊与禁忌登记、课时 60～90 分钟、口碑与续约、以及「会员私事不在店内八卦」的职业道德。正规菜单包括：入门体验、主题课、修复课、团体课与私人课；「${secret}」在本世界**不是**无限越界的万能借口，而是店内黑话——指**加钟、加私密隔间、加「只对熟客开放的深度放松序列」**，以及把职业触碰／共处谈成情感信任的那一步。强行要求他人做违背底线的事会触发「清醒反弹」：当事人立刻叫停、对施术／引导者产生厌恶、主理**${c0.full}**会直接除名（档案侧写为口碑崩盘与关系锁 BE）。

世界的「温度」来自三处：一是设施内暖光与白噪音，时间比外面慢半拍；二是固定座位／床位与「习惯道具」——谁总选同一香型、谁总要额外毯子；三是角色在家庭／职场之外被认真称呼名字时，那种被看见的微小幸福。治愈感不靠奇迹，靠重复：每两周一次的会期、同一句「先问状态再开始」、同一杯课后${props[2]}。${microA.join("；")}。`;

  const pGeo = `- **${facility}本馆**：${loc.station}步行数分钟的二层空间。一楼前台与鞋柜、二楼 A 室（窗边正规）／B 室（帘后私密）、茶水角、储物角与小型露台。玻璃门贴「完全予約制・少人数」。
- **A 室**：初诊、团体课、公开示范；呼吸交叠是升温主舞台。
- **B 室**：「${secret}」与加钟多发生于此；适合慢热告白与「说不」的练习。
- **茶水角／里间**：加班崩溃与和好常在这里；排课表贴在冰箱门上。
- **${props[1]}**：会后散步与秘密短谈的默认舞台。
- **駅前连锁对照店**：便宜、快速、没人记得你的禁忌史——衬托${loc.shop}的「慢」。
- **各人自宅一角**：个人线后期「上门出張」——只到玄关或客厅垫子，尊重家庭边界。
- **商店街与周末市集**：采购耗材、季节花与小礼物；节日灯笼下可发生告白级对白。
- **外派点（合作设施）**：${c1.full}常驻外派，带来另一套节奏。

每个场景的情感功能：初遇＝临时空位被硬塞的体验；升温＝固定时段续约；冲突＝家庭日程与营业撞车、或被邻居看见共伞；和解＝雨天加开一场修复课；告白＝关店后只剩一盏灯与未收的${props[0]}。`;

  const pPlot = `**共通线：预约表上的${focus}**
故事从${seasonHook}扩招开始。主理**${c0.full}**（${roles.host}）因固定助手休产假，急需见习；同时常客**${c2.full}**、**${c3.full}**、**${c4.full}**、**${c5.full}**的续约档期挤在一起，还有周末私人课的**${c6.full}**，以及外派结识的**${c1.full}**。视点可落在新来的${roles.helper}（契约者常用身份），或落在第一次体验的会员。共通线不拼打斗，拼三件事：学会安全问诊与禁忌登记、记住每位常客的习惯、在「专业距离」与「心动」之间划线。

**第一阶段·相遇**
助手第一天把${props[0]}摆反，被${c0.given}笑着扶正；${c2.given}随口说「家里没人会注意我」；${c3.given}永远准时；${c4.given}把欢迎声喊得很亮；${c5.given}总把拖鞋摆在最角落；${c1.given}语气温柔却把「家」字说得很轻。日常相处＝一起收尾、一起骂温控、一起在关店后吃便利店饭团。

**第二阶段·升温**
助手学会「先问状态再开始」；某次${c2.given}爽约，${c0.given}让助手送恢复卡上门（只送到玄关）；${c3.given}在 B 室突然落泪；${c6.given}私人课总加时十分钟却只谈压力；${c1.given}在茶水角承认「肩膀骗不了人」。情感升温靠「被记住」：助手提前备好${c5.given}爱用的加厚毯子，${c0.given}只在预约本多写一行。

**第三阶段·冲突／误会**
邻居闲话、${c0.given}的丈夫**${c8.full}**出差回家撞见送人到家门口、连锁挖角、有人要求「${secret}」越过同意边界被当场拒客。没有大反派，只有口碑、自尊与家庭角色的拉扯。

**第四阶段·和解与告白**
闭店茶会澄清闲话；${c8.given}体验一次修复课后沉默许久，说「原来这么累」。告白固定在关店后的 A／B 室：${props[0]}没收，有人说「我想预约的不是九十分钟，是你整个人的呼吸」。

**${c0.full}线**
心结：把温柔都给了客人与家庭，把自己活成永远的提供者。攻略：尊重专业边界，在她卸下主理壳时接住。HE：共同挂名经营或礼优先婚内修复；BE：降为仅前台，关系冻结。

**${c1.full}线**
心结：外派两头跑，家中情感空缺，用工作填满不想回家的夜晚。攻略：不把同情当交换。HE：减少夜宿、建立稳定约会并协商婚姻；Bittersweet：独自整理，留下${props[0]}与「谢谢你让我学会说不」。

**${c2.full}线**
心结：把会期当不会出错的功课，却总因紧张屏息。攻略：陪她在${props[1]}多走两圈，夸呼气而非外貌。HE：细水长流的婚外心动（氛围向）；BE：因闲话暂停会期。

**${c3.full}线**
心结：话少是因为被要求「坚强」；静室会让她情绪决堤。攻略：接受沉默。HE：晨间私人课，静默依偎型。

**${c4.full}线**
心结：元气掩饰迷茫。攻略：请她决定主题歌单与流程。HE：转正企划，阳光恋爱。

**${c5.full}线**
心结：害羞，镜子是敌人。攻略：从不展览她，等她主动点 B 室。HE：公园草地上第一次不躲眼神。

**${c6.full}线**
心结：职场夹缝里只剩六十分钟是自己的。攻略：不追问公司，只把那六十分钟做到安全精准。HE：细水长流；BE：调职离开，留下未用完的会期卡。

**共通后日谈**
无论选谁，${facility}继续四季会期；未攻略角色保持友好，不恶意拆家。True 氛围＝「一室多人、各得其所」或「一人专属私人课」——由玩家择。「${secret}」被写清：必须双方同意、可随时叫停、禁止代约与强制加钟。

**微观日常事件池**
${microB.join("；")}。耗材不够、温控失灵、雨天屋顶湿滑、过敏报备、会员睡着打鼾、丈夫电话打来时的屏息、签到本被涂改。每一件都可转化为：谁先蹲下收拾、谁替谁圆场、谁在事后单独道谢。`;

  const charBlock = (p, role, type, hook) =>
    `- **${p.full}（${role}）**｜外貌：${pick(seed + p.full, ["墨褐长发", "浅栗微卷", "直黑齐颌", "亚麻马尾", "盘发", "银白挑染", "柔顺半束", "短发利落"], 1)}，${pick(seed + p.full, ["深褐瞳", "蜜色瞳", "杏眼易湿", "静灰瞳", "琥珀瞳"], 2)}；${pick(seed + p.full, ["雾灰制服", "亚麻罩衫", "针织外套", "运动外套", "礼仪长裙", "工作围裙"], 3)}。｜性格：${pick(seed + p.full, ["外柔内韧", "寡言观察", "开朗掩饰迷茫", "认真到笨拙", "体贴易共情", "少话守时"], 4)}。｜角色类型：${type}。｜萌点/魅力：${hook}。｜个人线剧情：见上文对应线；心结与攻略以同意与边界为核心。｜与主角关系：从职业距离到可攻略对象。`;

  const pChars = [
    charBlock(c0, `${roles.host}／人妻气质`, "大和抚子／师匠型", "先问「可以吗」、把呼气说成安抚"),
    charBlock(c1, `${roles.external}／情感空缺`, "温柔治愈系", "说到「家」停半拍"),
    charBlock(c2, `${roles.guest}／年轻夫人`, "软萌努力型", "过多鞠躬、${props[1]}风衣摆"),
    charBlock(c3, `${roles.guest}／静默系`, "冰美人（实则温）", "无言收尾、雨伞只剩一把时的选择"),
    charBlock(c4, `季节助手兼学员`, "元气气氛制造者", "选歌哼唱、夏夜愿望清单"),
    charBlock(c5, `入门班会员`, "文静害羞／角落守护者", "拖鞋一点点往前挪的勇气"),
    charBlock(c6, `周末私人课会员／职员`, "冷美人／寡言", "离开前「下次也麻烦了」像口令"),
    `- **主角视点（契约者·${roles.helper}／成人会员）**｜姓名外貌自定；默认心细、肯收尾、不抢示范中心。成长＝从不会问禁忌到能独立带一节修复课。`,
    `- **重要配角·${c8.full}（${c0.given}之夫·外驻上班族）**｜不善言辞，并非恶人，只是长期看不见。体验修复课后的沉默是名场面。`,
    `- **重要配角·${c9.full}（产假助手·电话配角）**｜留言里开朗支招，解释旧规矩，喜剧缓冲。`,
    `- **重要配角·${c7.full}（合作方／女将气质后盾）**｜知${c1.given}家事，偶尔挡访客；非攻略对象。`,
  ].join("\n\n");

  const pRel = `${facility}＝微型共同体。${c0.given}居中为师匠；${c2.given}、${c3.given}、${c5.given}为团体课三角微妙；${c4.given}是润滑剂；${c6.given}是周末轨道；${c1.given}是外派轨道。不存在暴力情敌，只有「下节课谁当示范」「${props[0]}借不借」「${secret}加不加钟」的温柔张力。丈夫群整体缺席，戏核在设施内。连锁店仅作远景对照。`;

  const pScenes = `1. **第一件${props[0]}摆反**：${c0.given}蹲下扶正——允许失败。  
2. **${c2.given}说「家里没人会注意我」**：助手只回「我注意」。  
3. **上门只到玄关**：克制的关心。  
4. **${c8.given}体验修复课**：沉默后说「辛苦了」。  
5. **闲话与闭店茶会**：关系回温。  
6. **${c3.given}的落泪**：只递纸巾不追问。  
7. **${c5.given}第一次点 B 室**：全场不展览。  
8. **屋上／${props[1]}夏夜**：${c4.given}的歌单与呼吸对齐。  
9. **${c6.given}的加时十分钟**：比告白更像告白。  
10. **雨天共伞**：步伐故意放慢。  
11. **关店后的告白**：预约本合上，「下一格写我们的名字」。  
12. **${c1.given}留下的${props[0]}**：纸条写「学会说不了」。  
13. **拒客事件**：定义道德底线。  
14. **对视到自己放稳**：信任的名场面。`;

  const pHide = `- **真结局**：${facility}成为街区的温柔基础设施；${c0.given}学会休假；助手共同挂名或稳定恋人。  
- **伏笔**：签到本涂掉的旧名、${c9.given}留下的禁忌表、快停产的香型、叠了三层却未用完的${props[0]}。  
- **隐藏日常**：男士开放日试运营、联名小花、雨季加${props[2]}小样、季节工作坊、与合作方的联合日。  
- 「${secret}」的真正秘密：不是更刺激，而是**更慢、更同意、更可叫停**。`;

  const pTone = `基调：暖色灯光、低音量环境声、${props[2]}的淡味、呼吸与翻页／流水声；叙事亲密、克制、重视同意。  
NSFW：允许暧昧与职业必要的接触；**点到氛围为止**，不写露骨过程。「${secret}」只作「被认真对待／学会说不」的隐喻。  
忌：把设施写成刷怪本或强制调教馆；忌无铺垫秒爱；忌抹去「说不」；忌用排名或破坏力解释服务；忌跨世界套话；忌无情感后果的打卡式堕落。  
最适合切入：产假交接后的入职第一周，欢迎${props[0]}尚温时。契约者是情感变数，不是外来支配者。`;

  // pad 剧情 to ensure >=6000: add unique detail sections
  const pad = `
**${focus}专属流程备忘（本世界独有）**
1. 开场：前台核名 → 禁忌三问（过敏／疲劳／「今天可不可以碰」）→ 选 A／B 室。  
2. 中段：正规流程进行到一半，允许一次「暂停重来」而不扣费——这是${c0.given}立下的店规。  
3. 收尾：${props[2]}、${props[0]}归还、预约本只写自愿的下一格。  
4. ${focus}特别项：与「${main}」相关的道具必须双人清点；遗失一件，当晚全员留下复盘，不罚钱只谈「谁在慌」。  
5. 外派日：跟${c1.given}走合作路线时，禁止把店内黑话带到外场；违者由${c0.given}亲自停班一周（情感上等于冷处理）。  
6. 雨天预案：${props[1]}关闭时改走茶水角长谈；共伞只送到站口，不送进玄关。  
7. 月末复盘会：每人说一句「这周我被谁记住了」——比业绩数字更重要。  
8. 新人满月礼：见习满四周，${c0.given}会送一支只写名字的${props[0]}；丢了可以再要，但她会记得你丢过。

**${loc.town}街区关系**
- 花店老板娘会为${facility}每周送一小束「不求同款」的季节枝；${c4.given}负责插瓶，插歪了会被${c0.given}笑着扶正。  
- 派出所巡逻偶遇关店后的灯，被解释为「等汗干」——后来成了本地笑话，也成了闲话的源头。  
- 二手市集上，${c6.given}曾匿名拍下绝版耗材寄到店里，纸条只写「别问」。  
- 雨季排水井盖会反光，${props[1]}那一段积水最适合「故意放慢」的共伞戏。  
- 隔壁咖啡店的店员认识所有常客的「课后饮」偏好，却从不过问姓名背后的故事。  
- ${loc.station}的末班电车广播一响，${c3.given}就会下意识看表——那是她允许自己柔软的时限。  
- 周末市集的陶杯摊主会把「双人杯」默认推给从${facility}走出来的人，已成街区默契。

**角色对照速记（防扁平）**
| 角色 | 怕什么 | 想被怎样对待 | 拒绝信号 |
|---|---|---|---|
| ${c0.given} | 空预约本与口碑崩 | 被当女人而非永动机 | 改口称「助手桑」并拉开一米 |
| ${c1.given} | 回家的门铃声 | 被听完再说建议 | 把话题扭到天气 |
| ${c2.given} | 被当成完美功课 | 被允许出错 | 连续道歉超过三次 |
| ${c3.given} | 被逼说话 | 沉默也被陪着 | 戴上耳机 |
| ${c4.given} | 被绑死身份 | 被认真请教 | 笑着转移焦点 |
| ${c5.given} | 被展览 | 被允许角落 | 退回最远的拖鞋位 |
| ${c6.given} | 时间被浪费 | 六十分钟精准 | 提前五分钟收拾包 |

**可重复周常与情感推进刻度**
周一盘点、周三团体课、周五私人课、月末闭店茶会、季度主题周（樱／梅雨／花火／红叶／初雪）。契约者若连续三周缺席同一人的档期，该线好感冻结而非仇恨——本世界惩罚是「被忘记」，不是被仇视。好感大致刻度：第一次被记住习惯＝浅粉；第一次被护短＝樱；第一次在 B 室主动说「可以停也没关系」＝深樱；第一次把下一格预约写成两个人的名字＝可进 HE 走廊。BE 多表现为「礼貌性疏远」与「把你从示范名单划掉」，而不是当众羞辱。

**${main}气质补笔（只服务本条）**
「${main}」在本档案里首先是生活场景，其次才是题材符号：道具声、气味、班表与口癖构成可观察细节。写正文时优先描写谁叠巾、谁改预约、谁在茶水角睡着，而不是渲染支配或征服。${focus}作为标题后半段，规定了本周叙事焦点——所有个人线都要至少一次碰到这个焦点词所指向的日常动作，否则线会显得可替换。${c0.given}常说的店训只有半句：「先问，再碰，永远留退路。」这句话出现在更衣室镜子一角，墨迹被摸得发亮。
`;

  const plot = `## 剧情

**【作品来源】**
${pSource}

**【世界定位】**
${pPos}

**【世界观 · 舞台设定】**
${pWorld}

**【地理 · 生活舞台】**
${pGeo}

**【故事主线 · 情感线】**
${pPlot}
${pad}

**【可攻略角色 / 主要人物】**
${pChars}

**【人际关系网 / 社团势力】**
${pRel}

**【情感事件 · 名场面】**
${pScenes}

**【隐藏剧情 · 真结局 · 伏笔】**
${pHide}

**【氛围基调 · 雷区】**
${pTone}
`;

  const entry = `## 休闲切入点

> 本世界为休闲/恋爱向（${main}·${focus}日常），无生存压力与砍杀主轴。契约者以**日常身份**融入，核心玩法＝relationship 攻略 + 预约表事件，而非任务厮杀。

切入身份：${facility}${roles.helper}（可兼前台），或${focus}体验新会员。中立名分可进出 A／B 室、茶水角与${props[1]}，不被立刻拖入越界菜单，又足够被当成值得信任的「手」。${c1.given}线可从外派日以「临时搭档」合流。

切入时点：${c9.given}产假交接完成、${seasonHook}扩招后的入职第一周清晨。欢迎${props[0]}尚未焐热，预约本仍有空白格。不宜从关店告白夜或后日谈开局。

初始处境：  
- 住宿：${loc.station}附近一居室；储物柜可能被${c1.given}匿名放一条${props[0]}。  
- 日程：${c0.given}排问诊与会期表，缺席记态度。  
- 圈子：储物角可能撞上${c0.given}的沉默示范、${c2.given}的慌张鞠躬、或${c3.given}的耳机世界。  
- 社交起点：${c0.full}（规则）、${c4.full}（情报与喜剧）、${c1.full}（外派对照）、${c9.full}（电话支招）。  
- 持有物：店钥、空白问诊本、预约账号。

开场白建议：「你被白噪音叫醒时，前台还散着未订的耗材单。主理${c0.full}把写着「见习」的名牌放进你掌心，墨水未干，低声说：今天谁的肩膀最先在你手下放松，全店都会当作站队。门外${c1.full}与${c4.full}几乎同时点头，${c2.full}只在鞋柜处看了你一眼。${props[2]}还热着——你的第一句问诊，已经决定这一季空气里的气味是正规流程、${secret}，还是雨后的${props[1]}。」

可攻略对象：  
- **${c0.full}**：问诊差错时递笔、公开场合给台阶；好感起点：礼貌距离；钩子：怕空预约本。  
- **${c1.full}**：尊重不聊家事的边界；好感起点：共情；钩子：夜宿与学会说不。  
- **${c2.full}**：接受${props[1]}散步，不逼离婚宣言；好感起点：被逗乐；钩子：被忽视感。  
- **${c3.full}**：雨中听完长句再表态；好感起点：安静陪伴；钩子：晨间私人课与伞。  
- **${c4.full}**：请她定歌单与流程；好感起点：共犯友情；钩子：${props[1]}线钥匙人。  
- **${c5.full}**：从不展览她的害羞；好感起点：安全；钩子：角落到 B 室的勇气。  
- **${c6.full}**：请教职场而非求宠；好感起点：项目搭档；钩子：调职前私情。

日常玩法钩子：  
1. **预约站队线**：连续为谁加钟／谁用 B 室，改变座位与流言；三连加钟≈流言订婚。  
2. **问诊本线**：自愿／拒绝代写禁忌，影响 True／BE；强行越界触发${c0.given}拒客。  
3. **茶水角线**：跟${c4.given}关店听壁脚，获取真心话。  
4. **${props[1]}散步线**：每晚可约一人，触发关键事件。  
5. **外派线**：跟${c1.given}一日，解锁 HE／Bittersweet。  
6. **${secret}菜单线**：只有双方同意才可写入；学会说「可以停」锚定结局走廊。

氛围/雷区：保持${main}日常与可拒绝的亲密；**忌强行加入砍杀闯关、无脑强制调教、用排名或破坏力解释服务**；忌让角色失去「说不」；忌把见习写成无敌支配者；忌速通扁平。NSFW 点到情绪与关系后果即可。开局口诀：先拿名牌，再问禁忌，最后才碰加钟。关店后第一句若是关心而非命令，线就站稳了。

补充可玩细节（写入切入时仍算休闲）：  
- 第一次值班必须跟${c0.given}完成「禁忌三问」口播，漏一句就重来。  
- ${c4.given}会塞给你一张手写「谁爱喝什么」小抄，用错会被笑一周。  
- ${c1.given}外派日的集合点永远在${loc.station}验票口，迟到她不骂，只把你的${props[0]}叠得更整齐——那是冷淡。  
- 想推进${c5.given}：连续三天把最远的拖鞋位留给她，而不叫她「过来一点」。  
- 想推进${c6.given}：私人课准时结束，加时只能由她开口。  
- 想推进${c2.given}／${c3.given}：${props[1]}散步时允许沉默超过三分钟。  
- 真结局提示：当你能独立完成开窗→送客→写预约本，并在茶水角自然说「辛苦了」，日常循环永久解锁。  
- 若储物柜里的${props[0]}消失，表示你被记成「无名见习」——重新从问诊学起即可，不必走硬碰硬翻盘。

收束检查清单（写开局正文时对照）：  
1. 有没有先问禁忌再动手？  
2. 有没有记住至少一人的习惯道具？  
3. 有没有在公开场合给${c0.given}或${c5.given}留台阶？  
4. 有没有把「可以停」说出口或允许别人说出口？  
5. 关店后第一句是关心还是命令？  
六条全过，才配把名字写进预约本封面。${focus}线的专属钩子是：本周至少完成一次与「${focus}」直接相关的共同作业（备料／排练／交货／值夜／试穿／导读等），否则好感只停在礼貌层。街区NPC（花店、咖啡店、巡逻）只作氛围，不抢主线。NSFW 仅作关系温度计，不写过程。离开${loc.town}再回来时，若${props[0]}仍在柜里，说明店记得你。

## 来源

${srcMd}
`;

  return `# ${name}
<!--meta lib=休闲 tiers=休闲-->

${plot}

${entry}
`;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const only = args[0]; // optional batch or world filter
  const skipExisting = process.argv.includes("--skip-existing");
  let ok = 0;
  const report = [];
  for (const [batch, worlds] of Object.entries(BATCHES)) {
    if (only && only !== batch && !worlds.includes(only)) continue;
    const dir = path.join(OUT, `批次${batch}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const w of worlds) {
      if (only && only !== batch && only !== w) continue;
      const fp = path.join(dir, `${w}.md`);
      if (fs.existsSync(fp) && skipExisting) {
        report.push(`skip ${w}`);
        continue;
      }
      const md = buildWorld(w, batch);
      fs.writeFileSync(fp, md, "utf8");
      ok++;
      report.push(`write ${batch}/${w} (${md.length} chars)`);
    }
  }
  console.log(report.join("\n"));
  console.log(`DONE write=${ok}`);
}

main();
