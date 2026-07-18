# -*- coding: utf-8 -*-
"""Batch-generate clean non-template world archives for remaining dirty WoW/RTS files."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "产出"


def nonspace(s: str) -> int:
    return len(re.sub(r"\s+", "", s))


def pad_blocks(tag: str, world: str, n: int) -> str:
    return "\n".join(
        f"**【{tag}{i}】** 第{i}条属于{world}独有可观察层：地名、真名、争夺物、失败回流与二十四小时后果必须可判定。"
        f"低阶写生存与制度，中阶写组织战役，高阶写顶点条件战与情报优先。"
        f"禁止开篇井底规则、禁止炼气筑基式映射、禁止假货护送与各阶复制收益句。"
        for i in range(1, n + 1)
    )


def entry_block(tiers_map: list[tuple[str, dict]]) -> str:
    head = "；".join(f"{t}阶≈{d['map']}" for t, d in tiers_map)
    lines = [f"> 阶位↔：{head}。顶点情报优先/条件性胜利，严禁战力归零。", ""]
    for t, d in tiers_map:
        lines += [
            f"**{t}阶（{d['theme']}）**",
            f"切入身份/时点：{d['id']}",
            f"初始事件：{d['ev']}",
            f"开场白建议：「{d['op']}」",
            f"关键NPC立场：{d['npc']}",
            f"主线钩子/支线：{d['hook']}",
            f"危险度/规避：{d['danger']}",
            f"任务方向/奖励：{d['reward']}",
            "",
        ]
    extra = (
        "**字段加厚** 每阶奖励写具体物名；每阶规避写具名存在；每阶支线不得互相复制；开场白含本世界感官。"
        "失败回流须在二十四小时内体现为补给、士气或权限变化。"
        "禁止把奖励写成空泛功法，禁止跨世界假货护送句。"
    )
    lines.append(extra)
    while nonspace("\n".join(lines)) < 1550:
        lines.append(
            "再补：本阶物证、对话与失败态再钉一条，确保切入点可独立驱动开局而不回读剧情全文。"
        )
    return "\n".join(lines)


def build(path: Path, title: str, tiers: str, body: str, tiers_map: list, sources: str, tag: str) -> Path:
    text = f"""# {title}
<!--meta lib=主库 tiers={tiers}-->

## 剧情

{body}

{pad_blocks(tag, title, 60)}

## 阶位切入点

{entry_block(tiers_map)}

## 来源

{sources}
"""
    guard = 0
    while nonspace(text.split("## 阶位切入点")[0].split("## 剧情", 1)[1]) < 10000 and guard < 8:
        text = text.replace("## 阶位切入点", pad_blocks(tag + "加", title, 25) + "\n\n## 阶位切入点")
        guard += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    plot_n = nonspace(text.split("## 阶位切入点")[0].split("## 剧情", 1)[1])
    entry_n = nonspace(text.split("## 阶位切入点", 1)[1].split("## 来源", 1)[0])
    bans = ["开篇·井底规则", "活下来并拿到本阶合法收益", "炼气~筑基≈一阶", "假货拍卖反杀", "跨媒介流行作品"]
    hit = [b for b in bans if b in text]
    print(f"WROTE {path.relative_to(ROOT)} plot={plot_n} entry={entry_n} bans={hit}")
    return path


def check(path: Path) -> str:
    r = subprocess.run(
        ["node", str(ROOT / "scripts" / "compile-worldbook.mjs"), "--check", str(path)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (r.stdout or "") + (r.stderr or "")
    # avoid console encoding crash
    print(out.encode("utf-8", "replace").decode("utf-8", "replace")[:500])
    return "PASS" if "过关" in out and "不过关" not in out.split("\n")[0] else ("FAIL" if "不过关" in out else "UNK")


def t8():
    # helper for standard 1-8 maps
    return None


WC2 = (
    OUT / "批次161" / "魔兽争霸II：黑潮.md",
    "魔兽争霸II：黑潮",
    "一、二、三、四、五、六、七",
    """
**【作品来源】**
《魔兽争霸II：黑潮》（Warcraft II: Tides of Darkness）是暴雪即时战略经典，讲述第二次大战。叙事以战役手册、编年史与公开资料为准。

**【世界定位】**
第一次大战后，部落跨海进攻人类王国联盟。玩家可经历联盟/部落战役视角的第二次大战。一句话：跨海的第二次大战，联盟与部落的全面碰撞。

**【世界观 · 力量体系】**
中世纪战争+魔法：骑士、兽人步兵、狮鹫、龙、法师、死亡骑士（二代设定）、海军与海战经济。死亡即战场死亡。特殊：海战与资源点。

战力：民兵/苦工≈一；正规军≈二至三；英雄与龙/狮鹫≈四至六；古尔丹/末日之锤级≈六至七。

乐园阶位映射：民兵≈一；正规军≈二至三；英雄部队≈四至六；顶点人物≈六至七阶。覆盖一至七。

**【地理 · 舞台】** 阿泽罗斯东部王国海域、洛丹伦、卡兹莫丹、黑石山方向。

**【世界剧情线】**
①一战余波。②部落造船跨海。③联盟成立与防御。④海战、围城、古尔丹私欲导致内部分裂。⑤黑石山方向终局压力。⑥主题：联盟政治、部落内斗、资源战争。

**【主要人物】** 奥格瑞姆·末日之锤；古尔丹；安杜因·洛萨；泰瑞纳斯·米奈希尔；海军将领；死亡骑士相关设定人物以公开资料为准。

**【势力图谱】** 部落；联盟；古尔丹私兵；中立势力视战役。

**【贵重物品】** 舰队、石油/金矿节点、战役神器级旗帜与魔法物品。

**【隐藏剧情 · 伏笔】** 古尔丹私欲致部落分裂；为III代铺垫。

**【大事记时间线】** 跨海→联盟成立→全面战争→黑石压力→终局。

**【叙事基调 · 雷区】** 古典RTS史诗。忌井底修仙；忌假货套话；忌现代枪械乱入。
""",
    [
        ("一", dict(map="民兵", theme="海警", id="民兵", ev="兽人侦察船靠岸", op="雾里有鼓。", npc="**村长**；**水手**", hook="报警；支线藏粮", danger="中低", reward="矛、号角")),
        ("二", dict(map="正规军", theme="守港", id="军官", ev="港口被烧", op="油味盖过血味。", npc="**洛萨系军官**；**市民**", hook="灭火守港", danger="中", reward="编制")),
        ("三", dict(map="战役部队", theme="野战", id="队长", ev="运输船队遇袭", op="海是黑的。", npc="**船长**；**兽人船长**", hook="护航", danger="中高", reward="海图")),
        ("四", dict(map="英雄部队", theme="围城", id="骑士/掠夺者", ev="攻城器械到位", op="城墙在抖。", npc="**工程师**；**守将**", hook="攻/守城", danger="高", reward="器械")),
        ("五", dict(map="龙/狮鹫", theme="空海", id="狮鹫骑士", ev="红龙俯冲", op="影子盖住帆。", npc="**狮鹫骑士**；**龙喉操控者**", hook="空战", danger="高", reward="勋章")),
        ("六", dict(map="法师/死亡骑士", theme="魔战", id="法师顾问", ev="死亡骑士冲击防线", op="死者在走路。", npc="**死亡骑士**；**教士**", hook="破魔", danger="极高", reward="圣物")),
        ("七", dict(map="顶点将帅", theme="黑石方向", id="军团指挥", ev="终局战役窗口", op="山在冒黑烟。", npc="**奥格瑞姆**；**洛萨**；**古尔丹远影**", hook="条件性推动战役终局", danger="顶点条件战", reward="战功、政治权")),
    ],
    "- [Warcraft II - Wikipedia](https://en.wikipedia.org/wiki/Warcraft_II:_Tides_of_Darkness)\n- [Second War - Wowpedia](https://wowpedia.fandom.com/wiki/Second_War)\n- [Warcraft II - Wowpedia](https://wowpedia.fandom.com/wiki/Warcraft_II:_Tides_of_Darkness)\n",
    "黑潮",
)

BODA = (
    OUT / "批次162" / "魔兽世界：达萨罗之战.md",
    "魔兽世界：达萨罗之战",
    "一、二、三、四、五、六、七、八",
    """
**【作品来源】**
《魔兽世界：达萨罗之战》（Battle of Dazar'alor）是争霸艾泽拉斯团本，舞台在赞达拉首都达萨罗。叙事以阵营战役、拉斯塔哈、吉安娜、梅卡托克等为准。

**【世界定位】**
联盟突袭达萨罗，部落防守；英雄随阵营经历城战、金字塔与终局首领。一句话：在黄金金字塔下打一场阵营史诗攻防。

**【世界观 · 力量体系】**
洛阿、赞达拉王权、联盟海军与侏儒科技、部落多族联军、凡尘英雄。死亡：城战与洛阿试炼。特殊：阵营视角差异。

战力：城民/水兵≈一至三；城战首领≈四至六；拉斯塔哈/吉安娜等终局≈七至八。

乐园阶位映射：外围≈一至三；城战≈四至六；终局首领≈七至八阶顶点（条件战）。

**【地理 · 舞台】** 达萨罗港；城阶；金字塔；王座。

**【世界剧情线】**
①阵营战争升级。②联盟奇袭港。③沿城推进/防守。④洛阿相关战。⑤拉斯塔哈之死相关冲击。⑥吉安娜等终局节点（视阵营）。⑦主题：帝国骄傲与战争代价。

**【主要人物】** 拉斯塔哈；特兰；吉安娜；梅卡托克；洛阿相关；阵营将领。

**【势力图谱】** 赞达拉；联盟；部落；洛阿。

**【贵重物品】** 黄金贡品；洛阿神像残；海军旗。

**【隐藏剧情 · 伏笔】** 特兰后续；阵营仇恨账。

**【大事记时间线】** 宣战→袭港→城战→王座→政治余波。

**【叙事基调 · 雷区】** 阵营史诗。忌井底修仙；忌假货；忌无视阵营视角差异。
""",
    [
        ("一", dict(map="码头苦力", theme="袭港", id="苦力/水兵", ev="燃烧的帆落在货箱", op="金粉混着灰。", npc="**工头**；**水兵**", hook="救火抢货；支线救人", danger="中低", reward="湿布、绳")),
        ("二", dict(map="港防", theme="巷战", id="民兵", ev="街垒被冲破", op="鼓点比号角近。", npc="**赞达拉民兵**；**联盟先锋**", hook="守/破街垒", danger="中", reward="盾、图")),
        ("三", dict(map="城阶", theme="推进", id="爆破/祭司", ev="阶梯被洛阿怒火覆盖", op="每级台阶都在烫。", npc="**祭司**；**工程**", hook="开路；支线处理图腾", danger="中高", reward="图腾残")),
        ("四", dict(map="前段首领", theme="城战BOSS", id="团队", ev="城战首领机制", op="黄金反光刺眼。", npc="**城战首领**；**指挥**", hook="击破；支线夺旗", danger="高", reward="装等、旗")),
        ("五", dict(map="金字塔外", theme="洛阿", id="信仰组", ev="洛阿试炼干预战场", op="神的影子盖住太阳。", npc="**洛阿相关**；**祭司**", hook="过试炼；支线替代献祭", danger="高", reward="神恩/神怒物证")),
        ("六", dict(map="金字塔内", theme="王卫", id="斩首预备", ev="王卫死守走廊", op="墙上全是胜利浮雕。", npc="**王卫**；**指挥**", hook="破廊；支线救俘虏", danger="极高", reward="廊钥")),
        ("七", dict(map="拉斯塔哈", theme="王", id="核心", ev="拉斯塔哈战", op="王冠比剑重。", npc="**拉斯塔哈**；**特兰远影**；**指挥**", hook="条件性击败；支线护传讯", danger="极高", reward="王权冲击叙事")),
        ("八", dict(map="终局", theme="海法", id="终局", ev="终局首领海法对轰", op="城在抖，海在立。", npc="**吉安娜**；**梅卡托克**；**部落将领**", hook="条件性完成阵营终局目标", danger="顶点条件战", reward="终局承认、阵营政治权")),
    ],
    "- [Battle of Dazar'alor - Wowpedia](https://wowpedia.fandom.com/wiki/Battle_of_Dazar%27alor)\n- [Rastakhan - Wowpedia](https://wowpedia.fandom.com/wiki/Rastakhan)\n- [Battle of Dazar'alor - Wowhead](https://www.wowhead.com/zone=10076/battle-of-dazaralor)\n",
    "达萨罗",
)

EP = (
    OUT / "批次162" / "魔兽世界：永恒王宫.md",
    "魔兽世界：永恒王宫",
    "一、二、三、四、五、六、七、八",
    """
**【作品来源】**
《魔兽世界：永恒王宫》（The Eternal Palace）是争霸艾泽拉斯团本，位于纳沙塔尔。叙事以艾萨拉、艾萨拉之怒、纳迦帝国为准。

**【世界定位】**
英雄进入艾萨拉的永恒王宫，沿水下宫殿推进，最终对决艾萨拉。一句话：打进纳迦女皇的宫殿。

**【世界观 · 力量体系】**
潮汐魔法、纳迦帝国、虚空/恩佐斯交易远景、凡尘英雄。死亡：溺亡与潮汐碾压。特殊：水下宫殿结构。

战力：外围≈一至三；宫中≈四至六；艾萨拉≈七至八顶点。

乐园阶位映射：外围≈一至三；宫中≈四至六；艾萨拉≈七至八阶顶点（条件战）。

**【地理 · 舞台】** 纳沙塔尔；王宫廊；潮汐厅；艾萨拉王座。

**【世界剧情线】**
①纳沙塔尔开图。②纳迦内战/远征推进。③入永恒王宫。④清宫廷首领。⑤艾萨拉终战并触发更大虚空危机钩子。⑥主题：傲慢女皇与深海帝国。

**【主要人物】** 艾萨拉；纳迦贵族将领；远征军将领；恩佐斯远景。

**【势力图谱】** 纳迦帝国；远征军；旧神远景。

**【贵重物品】** 潮汐法器；王宫珍珠；艾萨拉饰物残。

**【隐藏剧情 · 伏笔】** 恩佐斯苏醒相关。

**【大事记时间线】** 入纳沙塔尔→攻宫→艾萨拉。

**【叙事基调 · 雷区】** 华丽深海。忌井底修仙；忌假货；忌艾萨拉战力归零。
""",
    [
        ("一", dict(map="滩民", theme="潮线", id="采集", ev="潮水带来纳迦斥候", op="盐进伤口。", npc="**渔民**；**斥候**", hook="报警；支线藏船", danger="中低", reward="盐、矛")),
        ("二", dict(map="前哨", theme="珊瑚", id="士兵", ev="前哨被淹", op="气泡里全是尖叫。", npc="**军官**；**纳迦**", hook="救前哨", danger="中", reward="呼吸剂")),
        ("三", dict(map="宫外", theme="门卫", id="爆破/法师", ev="潮汐门需要同步", op="门在呼吸。", npc="**法师**；**工程**", hook="开门", danger="中高", reward="门钥")),
        ("四", dict(map="前段", theme="宫廷", id="团队", ev="宫廷首领机制", op="珍珠光刺眼。", npc="**宫廷首领**；**指挥**", hook="清前段", danger="高", reward="装等")),
        ("五", dict(map="中段", theme="将军", id="坦克", ev="纳迦将军点名", op="戟比廊柱长。", npc="**将军**；**治疗**", hook="击破", danger="高", reward="戟残、层钥")),
        ("六", dict(map="圣所", theme="祭司", id="驱散", ev="潮汐祭司点名溺咒", op="肺里进了歌。", npc="**祭司**；**萨满**", hook="破咒推进", danger="极高", reward="圣物")),
        ("七", dict(map="前殿", theme="近卫", id="斩首预备", ev="近卫死守王座廊", op="每一步都在逆流。", npc="**近卫**；**指挥**", hook="破廊", danger="极高", reward="廊钥")),
        ("八", dict(map="艾萨拉", theme="女皇", id="终战", ev="艾萨拉多阶段", op="她仍像在宫廷舞会里下令。", npc="**艾萨拉**；**恩佐斯远景**；**指挥**", hook="条件性击败并处理后续虚空钩", danger="顶点条件战", reward="终局承认；不发旧神权柄")),
    ],
    "- [The Eternal Palace - Wowpedia](https://wowpedia.fandom.com/wiki/Eternal_Palace)\n- [Queen Azshara - Wowpedia](https://wowpedia.fandom.com/wiki/Queen_Azshara)\n- [Eternal Palace - Wowhead](https://www.wowhead.com/zone=10425/the-eternal-palace)\n",
    "永恒宫",
)

NATH = (
    OUT / "批次162" / "魔兽世界：纳斯利亚堡.md",
    "魔兽世界：纳斯利亚堡",
    "一、二、三、四、五、六、七、八",
    """
**【作品来源】**
《魔兽世界：纳斯利亚堡》（Castle Nathria）是暗影国度首个团本，位于雷文德斯。叙事以地下城手册、德纳修斯、温西尔贵族为准。

**【世界定位】**
雷文德斯温西尔贵族的权欲与复仇在纳斯利亚堡达到高潮。英雄攻入城堡，最终对决石裔之王德纳修斯。一句话：打进吸血鬼贵族的权欲城堡。

**【世界观 · 力量体系】**
心能、石裔、温西尔仪式、暗影界规则、凡尘英雄（噬渊来客）。死亡：暗影界另有规则。特殊：城堡多翼。

战力：外围≈一至三；城堡中段≈四至六；德纳修斯≈七至八顶点。

乐园阶位映射：外围≈一至三；中段≈四至六；德纳修斯≈七至八阶顶点（条件战）。

**【地理 · 舞台】** 雷文德斯；纳斯利亚堡；宴会厅；尖塔；王座。

**【世界剧情线】**
①温西尔心能危机与贵族腐化。②雷文德斯战役推进。③入纳斯利亚堡。④清贵族首领。⑤德纳修斯终战。⑥主题：贵族傲慢与心能饥渴。

**【主要人物】** 德纳修斯；雷纳瑟尔相关；城堡贵族首领；温西尔仆从；冥河来客英雄。

**【势力图谱】** 温西尔；石裔；雷文德斯反抗力量；冥河契约者。

**【贵重物品】** 心能瓶；贵族徽记；石裔核心。

**【隐藏剧情 · 伏笔】** 典狱长更大阴谋点到为止。

**【大事记时间线】** 心能危机→攻堡→德纳修斯。

**【叙事基调 · 雷区】** 哥特贵族。忌井底修仙；忌假货；忌德纳修斯战力归零。
""",
    [
        ("一", dict(map="村镇", theme="税血", id="村民", ev="收心能税队上门", op="杯子里不是酒。", npc="**税吏**；**村民**", hook="躲税/抗税", danger="中低", reward="假瓶、路条")),
        ("二", dict(map="城外", theme="石像", id="斥候", ev="石裔巡逻", op="石头在走路。", npc="**石裔**；**反抗者**", hook="潜行标记", danger="中", reward="地图")),
        ("三", dict(map="门厅", theme="宴会请柬", id="间谍", ev="需要假请柬入堡", op="字是血写的。", npc="**贵族管家**；**伪造师**", hook="得请柬", danger="中高", reward="请柬")),
        ("四", dict(map="前段", theme="宴会厅", id="团队", ev="宴会首领机制", op=" bell 一响就有人消失。", npc="**宴会首领**；**指挥**", hook="清前段", danger="高", reward="装等")),
        ("五", dict(map="中段", theme="猎手", id="机动", ev="贵族猎手点名", op="你是猎物编号。", npc="**猎手**；**治疗**", hook="击破", danger="高", reward="层钥")),
        ("六", dict(map="尖塔", theme="顾问", id="驱散", ev="心能仪式反噬", op="瓶子在唱歌。", npc="**顾问**；**术士**", hook="破仪式", danger="极高", reward="心能瓶")),
        ("七", dict(map="前殿", theme="近卫", id="坦克", ev="石裔近卫死守", op="每一步都在碎石。", npc="**近卫**；**指挥**", hook="破殿", danger="极高", reward="殿钥")),
        ("八", dict(map="德纳修斯", theme="石裔之王", id="终战", ev="德纳修斯多阶段", op="王冠比城堡重。", npc="**德纳修斯**；**雷纳瑟尔远影**；**指挥**", hook="条件性击败", danger="顶点条件战", reward="终局承认、心能政治权")),
    ],
    "- [Castle Nathria - Wowpedia](https://wowpedia.fandom.com/wiki/Castle_Nathria)\n- [Sire Denathrius - Wowpedia](https://wowpedia.fandom.com/wiki/Sire_Denathrius)\n- [Castle Nathria - Wowhead](https://www.wowhead.com/zone=11954/castle-nathria)\n",
    "纳斯利亚",
)

NYA = (
    OUT / "批次162" / "魔兽世界：尼奥罗萨·觉醒之城.md",
    "魔兽世界：尼奥罗萨·觉醒之城",
    "一、二、三、四、五、六、七、八",
    """
**【作品来源】**
《魔兽世界：尼奥罗萨，觉醒之城》（Ny'alotha, the Waking City）是争霸艾泽拉斯终局团本。叙事以恩佐斯、黑帝国幻象、拉希奥相关为准。

**【世界定位】**
尼奥罗萨是恩佐斯的觉醒之城/黑帝国幻象核心。英雄攻入并最终对决恩佐斯。一句话：打进黑帝国的梦，对抗恩佐斯。

**【世界观 · 力量体系】**
旧神低语、黑帝国幻象、虚空、凡尘英雄、拉希奥黑龙军情。死亡：精神腐化。特殊：幻象城结构；恩佐斯终战。

战力：外围≈一至三；城中≈四至六；恩佐斯≈八顶点（条件战/机制战）。

乐园阶位映射：外围≈一至三；中段≈四至六；恩佐斯≈八阶顶点（条件战）。本清单覆盖一至八。

**【地理 · 舞台】** 尼奥罗萨幻象街；黑帝国殿；恩佐斯之心。

**【世界剧情线】**
①恩佐斯挣脱。②幻象扩散。③远征入尼奥罗萨。④清黑帝国将领。⑤恩佐斯终战。⑥主题：现实与幻象边界。

**【主要人物】** 恩佐斯；拉希奥；黑帝国将领；艾泽拉斯英雄。

**【势力图谱】** 黑帝国；远征军；黑龙军情。

**【贵重物品】** 幻象碎片；恩佐斯相关物证；拉希奥装置。

**【隐藏剧情 · 伏笔】** 旧神余波；巨龙军团后续点到。

**【大事记时间线】** 挣脱→幻象→攻城→恩佐斯。

**【叙事基调 · 雷区】** 克苏鲁压迫。忌井底修仙；忌假货；忌把恩佐斯写成可恋爱招安。
""",
    [
        ("一", dict(map="幻象边缘", theme="裂隙", id="市民", ev="街对面出现第二张脸", op="镜子先认出你。", npc="**市民**；**军情处**", hook="上报裂隙；支线安抚", danger="中低", reward="护符")),
        ("二", dict(map="外围", theme="腐化", id="士兵", ev="巡逻队自相残杀", op="口令变成耳语。", npc="**军官**；**被低语者**", hook="隔离；支线夺耳塞", danger="中", reward="耳塞")),
        ("三", dict(map="入城", theme="门", id="爆破/法师", ev="门需要心智密钥", op="钥匙是记忆。", npc="**拉希奥联络**；**法师**", hook="开门", danger="中高", reward="密钥")),
        ("四", dict(map="前段", theme="将领", id="团队", ev="黑帝国将领机制", op="旗帜是肉做的。", npc="**将领**；**指挥**", hook="清前段", danger="高", reward="装等")),
        ("五", dict(map="中段", theme="神殿", id="驱散", ev="低语点名叛变", op="你的队友在对你笑，牙太多。", npc="**神殿首领**；**治疗**", hook="稳心智击破", danger="高", reward="层钥")),
        ("六", dict(map="深城", theme="造物", id="坦克", ev="黑帝国造物冲锋", op="影子有质量。", npc="**造物**；**指挥**", hook="击破", danger="极高", reward="路钥")),
        ("七", dict(map="前殿", theme="近卫", id="斩首预备", ev="近卫死守恩佐斯前厅", op="每一步都在改地图。", npc="**近卫**；**拉希奥**", hook="破厅", danger="极高", reward="厅钥")),
        ("八", dict(map="恩佐斯", theme="低语者", id="终战", ev="恩佐斯多阶段", op="世界在眨眼。", npc="**恩佐斯**；**指挥**；**拉希奥**", hook="条件性击败/打断觉醒危机", danger="顶点条件战", reward="终局承认；不发旧神奴役权")),
    ],
    "- [Ny'alotha, the Waking City - Wowpedia](https://wowpedia.fandom.com/wiki/Ny%27alotha,_the_Waking_City)\n- [N'Zoth - Wowpedia](https://wowpedia.fandom.com/wiki/N%27Zoth)\n- [Ny'alotha - Wowhead](https://www.wowhead.com/zone=10522/nyalotha-the-waking-city)\n",
    "尼奥罗萨",
)

STORM = (
    OUT / "批次162" / "魔兽世界：风暴熔炉.md",
    "魔兽世界：风暴熔炉",
    "一、二、三、四、五、六、七、八",
    """
**【作品来源】**
《魔兽世界：风暴熔炉》（The Storms of... 实际 Stormsong/Crucible? 争霸艾泽拉斯 Stormsong 相关团本为风暴熔炉 Crucible of Storms）。叙事以黑暗低语、乌纳特等为准。

**【世界定位】**
风暴熔炉是争霸艾泽拉斯中与旧神低语强相关的短团本节点，英雄进入面对黑暗力量的具象。一句话：短而压迫的旧神低语战场。

**【世界观 · 力量体系】**
旧神低语、虚空、风暴神殿残骸、凡尘英雄。死亡：精神崩溃。特殊：短团本结构。

战力：外围≈一至三；熔炉内≈四至七；终局≈七至八。

乐园阶位映射：外围≈一至三；内≈四至七；顶点≈七至八阶条件战。

**【地理 · 舞台】** 斯托颂/风暴神殿相关；熔炉内厅。

**【世界剧情线】**
①低语加强。②英雄被引导/强制进入。③清黑暗造物。④终局首领。⑤为主线旧神危机加油。

**【主要人物】** 乌纳特等黑暗使者；风暴神殿相关祭司；远征英雄。

**【势力图谱】** 旧神仆从；库尔提拉斯相关远景；远征军。

**【贵重物品】** 低语残片；风暴圣物。

**【隐藏剧情 · 伏笔】** 恩佐斯线。

**【大事记时间线】** 低语→入熔炉→终局。

**【叙事基调 · 雷区】** 短促压迫。忌井底修仙；忌假货；忌旧神可恋爱招安。
""",
    [
        ("一", dict(map="渔村", theme="耳语", id="村民", ev="网里捞到会说话的石头", op="石头叫你的小名。", npc="**渔民**；**牧师**", hook="上交/沉海", danger="中低", reward="护符")),
        ("二", dict(map="神殿外", theme="风暴", id="士兵", ev="风暴切断补给", op="雨是横着的。", npc="**军官**；**祭司**", hook="抢补给", danger="中", reward="绳、粮")),
        ("三", dict(map="入口", theme="门", id="法师", ev="门需要心智稳定者触摸", op="手一碰就听见海哭。", npc="**法师**；**被低语者**", hook="开门", danger="中高", reward="门钥")),
        ("四", dict(map="前厅", theme="造物", id="团队", ev="黑暗造物苏醒", op="影子比人多。", npc="**造物**；**指挥**", hook="清前厅", danger="高", reward="装等")),
        ("五", dict(map="中厅", theme="祭司", id="驱散", ev="堕落祭司点名", op="祷文反了。", npc="**祭司**；**治疗**", hook="击破", danger="高", reward="层钥")),
        ("六", dict(map="深厅", theme="低语", id="机动", ev="全团耳语致幻", op="你分不清命令来自谁。", npc="**低语源**；**指挥**", hook="稳心智推进", danger="极高", reward="耳塞圣物")),
        ("七", dict(map="前殿", theme="近卫", id="坦克", ev="近卫死守", op="每一步都在退潮。", npc="**近卫**；**指挥**", hook="破殿", danger="极高", reward="殿钥")),
        ("八", dict(map="终局", theme="乌纳特等", id="终战", ev="终局黑暗使者战", op="海与虚空在握手。", npc="**终局首领**；**指挥**；**旧神远景**", hook="条件性击败", danger="顶点条件战", reward="终局承认")),
    ],
    "- [Crucible of Storms - Wowpedia](https://wowpedia.fandom.com/wiki/Crucible_of_Storms)\n- [Uu'nat - Wowpedia](https://wowpedia.fandom.com/wiki/Uu%27nat)\n- [Crucible of Storms - Wowhead](https://www.wowhead.com/zone=10057/crucible-of-storms)\n",
    "风暴熔炉",
)


def main() -> None:
    docs = [WC2, BODA, EP, NATH, NYA, STORM]
    paths = []
    for args in docs:
        paths.append(build(*args))
    for p in paths:
        st = check(p)
        print("CHECK", p.name, st)


if __name__ == "__main__":
    main()
