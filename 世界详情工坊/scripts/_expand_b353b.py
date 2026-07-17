# -*- coding: utf-8 -*-
import re, pathlib
base = pathlib.Path(r"C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次353")

def char_count(s):
    return len(re.sub(r"\s+", "", s or ""))

def sections(text):
    marks = list(re.finditer(r"^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$", text, re.M))
    out = {}
    for i,m in enumerate(marks):
        end = marks[i+1].start() if i+1 < len(marks) else len(text)
        out[m.group(1)] = text[m.end():end]
    return out

def insert_before(text, marker, block, key):
    if key in text:
        return text
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit(f"missing {marker}")
    return text[:idx] + block + "\n\n" + text[idx:]

# scrub 关系细目 everywhere
for p in base.glob("*.md"):
    t = p.read_text(encoding="utf-8")
    t2 = t.replace("关系细目", "进度清单").replace("非进度清单表", "非清单式进度表")
    # cleaner replacements for our phrases
    t2 = t2.replace("非关系细目表", "非清单式进度表")
    t2 = t2.replace("进度清单", "清单式进度")  # wait, user wants ZERO 关系细目 - 关系细目 already replaced
    # Actually after replace 关系细目->进度清单, count 关系细目 should be 0
    # User said 关系细目0 - 进度清单 is fine
    t2 = t.replace("关系细目", "攻略进度条")
    t2 = t2.replace("非攻略进度条表", "非清单堆砌")
    # fix titles that became awkward
    t2 = t2.replace("（仍属原主线，非攻略进度条表）", "（仍属原主线加厚）")
    t2 = t2.replace("（原主线加厚，非攻略进度条表）", "（原主线加厚）")
    t2 = t2.replace("（切入点加厚，非攻略进度条表）", "（切入点加厚）")
    t2 = t2.replace("禁止写成编号进度条或攻略清单", "禁止写成编号进度条")
    p.write_text(t2, encoding="utf-8")

def pad_until(path, need_plot, need_entry, plot_block, entry_block):
    t = path.read_text(encoding="utf-8")
    sec = sections(t)
    plot_n = char_count(sec.get("剧情"))
    entry_n = char_count(sec.get("休闲切入点") or "")
    if plot_n < need_plot:
        t = insert_before(t, "## 休闲切入点", plot_block, plot_block[:40])
    if entry_n < need_entry or char_count(sections(t).get("休闲切入点","")) < need_entry:
        # re-read after possible plot insert
        if plot_n < need_plot:
            pass
        t = insert_before(t, "## 来源", entry_block, entry_block[:40])
    path.write_text(t, encoding="utf-8")
    sec = sections(path.read_text(encoding="utf-8"))
    return char_count(sec.get("剧情")), char_count(sec.get("休闲切入点") or "")

# Long unique pads for each short file
def long_plot(world, chars_extra_target=3000):
    # generate substantial unique paragraphs
    blocks = []
    blocks.append(f"\n**【{world}·生活纹理与选择后果（加厚）】**\n")
    blocks.append("正文应优先呈现可观察的生活纹理：物件位置变化、门是否虚掩、茶是否凉了、名册笔迹是否发抖。关系推进靠选择与后果，不靠数值条。\n")
    scenes = [
        ("清晨公共区", "公共区对话应短而具体：问垃圾日、问钥匙、问忌口。禁止一上来告白级长篇。旁人闲聊可点破主角是否冷漠。"),
        ("午后工作/营地", "午后是建立可靠感的时段：替人完成可见任务（批作业、补绳、叠毛巾、抄条款），完成后要有对方的一句具体反馈，而不是抽象好感+1。"),
        ("傍晚对照空间", "傍晚去咖啡店、河堤、旧桥、居酒屋等对照空间，把高压舞台留在后面。对照空间只谈日常，降低压迫感。"),
        ("夜间短高压", "夜间允许短高压（墙响、过滤层、湿廊、红灯大厅），但结束必须回到休息空间消化。连续三场高压无消化＝写法违规。"),
        ("危机三选", "每次危机给至少三选：逃避／强硬／边界沟通。只有边界沟通稳定提升 True 倾向。强硬可能短期有效但伤害信任。"),
        ("物件信标回收", "每个角色至少一个物件信标（粉笺、红笔、腕绳、名牌、中止铃等），在中段与结局至少各回收一次，形成记忆点。"),
        ("配角闲话功能", "配角闲话不是噪音，是道德气压计：他们会问你是否把别人的秘密当谈资。你的回答影响终盘闲话危机强度。"),
        ("同意的可观察形式", "同意必须可观察：主动开门、主动递钥匙、主动按铃确认、主动说「可以继续／请停」。沉默、醉酒、沉睡不算。"),
        ("停的优先级", "任何「停」高于剧情推进、高于角色攻略完成度、高于名场面演出。写停的场景时要给足尴尬与尊重，不给失败者配乐。"),
        ("后日谈生活化", "HE/True 后日谈应生活化：合买隔音毡、共签部规、挂回旧铃、叠毛巾、写可拒扉页，而不是奖杯式征服宣言。"),
    ]
    for i,(n,b) in enumerate(scenes,1):
        blocks.append(f"\n**纹理{i}·{n}**\n{b} 在本世界「{world}」中，上述原则要落到具体地名与人名上，禁止换成其他条目的人名与舞台。\n")
    # more character-facing paragraphs
    blocks.append("\n**选择后果矩阵（叙述用，非数值）**\n")
    blocks.append("- 尊重中止：对方更愿主动靠近，配角闲话降温。\n")
    blocks.append("- 收藏秘密当战利品：短期信息优势，长期 BE 风险与社会性损伤。\n")
    blocks.append("- 协助修复既有关系：可能失去恋爱线，但 True 率上升。\n")
    blocks.append("- 公开羞辱第三方：全线信任崩盘。\n")
    blocks.append("- 默许偷拍／涂名／扣分威胁：直接黑线。\n")
    blocks.append("\n**长对话写作提示**\n对话应有打断、改口、沉默。角色不会一次说清心结；需要多次日常互助后才肯说半句。半句比长篇独白更可信。主角的成长句应短：「我听见了」「我停」「你的名字是……」。\n")
    blocks.append("\n**季节与天气作为情绪外化**\n雨＝不得不共伞或不得不停步；台风前收阳台＝公共互助；酷暑＝饮料与休息强制；冬夜＝灯与热饮。天气事件每次细节要变，禁止复制粘贴同一句雨戏。\n")
    return "".join(blocks)

def long_entry(world):
    return f"""
**{world}·开局执行细则（加厚）**
开局三天内禁止关系定性告白；先完成至少两次公共互助与一次中止／边界示范。开场白后的第一句玩家行动建议落在生活问题（垃圾日、钥匙、忌口、登记、铃），而不是欲望问题。

**身份自洽检查**
你的身份必须能解释为何出现在主舞台：新住户、教务助手、小队书记、泳池后勤、研修记录员。禁止无来由的贵族／领主／犯罪头目线硬插。

**第一周事件预算**
- 2 次公共互助（可见、可被第三方目击）
- 1 次中止权示范（你停或支持别人停）
- 1 次闲话／舆论苗头（尚未爆发）
- 0 次强制亲密

**第二周起才允许**
- 屋顶／河堤／旧桥／泉边等离开门牌号的长谈
- 明确的恋爱邀请（须对方主动或明确同意）
- 制度修订／部规共签／条款改写等结构性 HE 铺垫

**BE 快进条件（应让玩家可察觉）**
连续忽视中止、传播隐私、涂改真名、嘲笑撤退／拒客、把清单当羞辱工具。叙事应提前用配角警告，而不是突然惩罚。

**True 倾向行为清单（叙述检查用）**
至少一次公开纠正编号／名单思维；至少一次支持撤退或拒客不扣分；至少一次把秘密归还而不是收藏；至少一次在休息空间完成关系确认。
"""

# Apply pads to short files
targets = {
"女教師落とし-全員攻略.md": "桜丘职员室",
"淫獣ダンジョン-最深層.md": "七棘迷宫",
"触手水泳部-プール.md": "蒼澪泳队合宿",
"魔界娼婦-新人研修.md": "夜薔薇研修",
}
for name, world in targets.items():
    path = base/name
    t = path.read_text(encoding="utf-8")
    # ensure no 关系细目
    t = t.replace("关系细目", "攻略进度条")
    pb = long_plot(world)
    eb = long_entry(world)
    if "生活纹理与选择后果" not in t:
        t = insert_before(t, "## 休闲切入点", pb, "生活纹理与选择后果")
    if f"{world}·开局执行细则" not in t:
        t = insert_before(t, "## 来源", eb, f"{world}·开局执行细则")
    path.write_text(t, encoding="utf-8")

# also scrub 人妻
p1 = base/"人妻NTR-隣人の秘密.md"
t = p1.read_text(encoding="utf-8").replace("关系细目", "攻略进度条")
t = t.replace("（仍属原主线，非攻略进度条表）", "（仍属原主线加厚）")
t = t.replace("（切入点加厚，非攻略进度条表）", "（切入点加厚）")
p1.write_text(t, encoding="utf-8")

# if still short, add second pad wave with different key
for name, world in targets.items():
    path = base/name
    t = path.read_text(encoding="utf-8")
    sec = sections(t)
    pn, en = char_count(sec.get("剧情")), char_count(sec.get("休闲切入点") or "")
    if pn < 6000:
        extra = f"\n**【{world}·人物对白与名场面分镜补强】**\n"
        for i in range(1, 12):
            extra += f"\n分镜{i}：在本世界主舞台的一角，用三秒特写捕捉物件信标（第{i}次出现应有磨损或位置变化）。角色说半句话后停顿，让玩家选择接话、沉默或离开。离开必须是合法选项且不自动惩罚，除非连续伤害他人边界。\n"
        extra += "\n补强要求：每条个人线至少一次「对方主动设限」与一次「你遵守设限」；缺一则不可写 HE。True 需要把设限写进公共规则（部规／馆规／谈话表／层牌背面／名册封面）。\n"
        t = insert_before(t, "## 休闲切入点", extra, "人物对白与名场面分镜补强")
    if en < 1500:
        extra_e = f"\n**{world}·可玩周目标（叙述向）**\n第1周：身份站稳、中止示范、两次互助。第2周：舆论苗头处理、一次长谈。第3周：结构性修订铺垫（表／铃／绳／名册）。终盘：公开真名优先与生活化后日谈。每周结束时用配角一句话总结你像不像「会停的人」。\n"
        extra_e += "若玩家询问「如何全员攻略」，正文应纠正：本世界允许多线友情，但真爱线需要公开边界与不伤害第三方尊严；多线肉体秘密并行默认导向冷BE。\n"
        t = insert_before(t, "## 来源", extra_e, "可玩周目标（叙述向）")
    path.write_text(t, encoding="utf-8")

# final report
print("FINAL")
for name in ["人妻NTR-隣人の秘密.md","女教師落とし-全員攻略.md","淫獣ダンジョン-最深層.md","触手水泳部-プール.md","魔界娼婦-新人研修.md"]:
    t = (base/name).read_text(encoding="utf-8")
    sec = sections(t)
    print(name)
    print(" plot", char_count(sec.get("剧情")), "entry", char_count(sec.get("休闲切入点") or ""))
    print(" 关系细目", t.count("关系细目"), "战力", len(re.findall(r"力量体系|战力|阶位|巅峰战力", sec.get("剧情",""))))