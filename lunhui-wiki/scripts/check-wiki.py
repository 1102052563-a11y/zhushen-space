# -*- coding: utf-8 -*-
"""轮回乐园百科 · 机检门禁（师傅收批用）
检查：
  [E] 抢跑：docs 里出现超过 _必读须知 §0 进度指针（N卷N章）的出处引用 → 错误（退出码2）
  [W] 人物页 front-matter 缺关键字段（title/分类/所属世界/状态）
  [W] 人物页缺「关系」/「出处」小节
  [W] 段落紧贴列表（中间没空行 → 渲染成一坨，排版铁则）
  [W] docs 下 md 未挂进 mkdocs.yml nav
  [W] 人物页 nav 分组与 front-matter 所属世界不符（放错世界组）
用法：
  python scripts/check-wiki.py               # 全量
  python scripts/check-wiki.py <md文件>...   # 只查指定文件（nav 检查仍全局）
"""
import io, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # lunhui-wiki/
DOCS = os.path.join(ROOT, 'docs')
CAP = 20   # 每类最多列 CAP 条，其余汇总
REPORT = os.path.join(ROOT, '_机检报告.txt')

# Windows 控制台常为 GBK：stdout 强制 UTF-8 防崩，同时全文落盘 _机检报告.txt（读报告以文件为准）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
_report = io.open(REPORT, 'w', encoding='utf-8')
_orig_print = print
def print(*a, **kw):   # noqa: A001
    _orig_print(*a, **kw)
    _orig_print(*a, file=_report, **{k: v for k, v in kw.items() if k != 'file'})

CN = {'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100}
def cn2int(s):
    s = str(s).strip()
    if s.isdigit(): return int(s)
    total, num = 0, 0
    for ch in s:
        v = CN.get(ch)
        if v is None: return None
        if v >= 10:
            num = 1 if num == 0 else num
            total += num * v
            num = 0
        else:
            num = num * 10 + v if False else v   # 中文数字无连写个位叠加
    return total + num

def read(fp):
    for enc in ('utf-8-sig', 'utf-8'):
        try:
            with io.open(fp, 'r', encoding=enc) as f: return f.read()
        except UnicodeDecodeError: continue
    with io.open(fp, 'r', encoding='utf-8', errors='replace') as f: return f.read()

# ── 进度指针 ──
def progress_pointer():
    txt = read(os.path.join(ROOT, '_必读须知.md'))
    m = re.search(r'已读至：第([一二三四五六七八九十百零\d]{1,6})卷·?第?([一二三四五六七八九十百零\d]{1,6})章', txt)
    if not m: sys.exit('✗ 无法从 _必读须知.md §0 解析「已读至：第N卷·第N章」进度指针')
    return cn2int(m.group(1)), cn2int(m.group(2))

# ── front-matter（宽松手工解析，容忍非严格 YAML）──
def front_matter(text):
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.S)
    if not m: return None
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r'^([^:：#]+)[:：]\s*(.*)$', line.strip())
        if mm: fm[mm.group(1).strip()] = mm.group(2).strip()
    return fm

# ── nav 解析（容忍 !!python 等未知标签）──
def load_nav():
    import yaml
    class L(yaml.SafeLoader): pass
    L.add_multi_constructor('!', lambda l, s, n: None)
    L.add_multi_constructor('tag:', lambda l, s, n: None)
    with io.open(os.path.join(ROOT, 'mkdocs.yml'), 'r', encoding='utf-8') as f:
        cfg = yaml.load(f, Loader=L)
    nav = cfg.get('nav') or []
    path_groups = {}   # 'docs相对路径' → [祖先分组标签…]
    def walk(items, trail):
        for it in items:
            if isinstance(it, str):
                path_groups[it.replace('\\', '/')] = trail
            elif isinstance(it, dict):
                for label, val in it.items():
                    if isinstance(val, str):
                        # 叶子页：label 是页面自己的标题，不算分组——trail 才是所在分组链
                        path_groups[val.replace('\\', '/')] = trail
                    elif isinstance(val, list):
                        walk(val, trail + [str(label)])
    walk(nav, [])
    return path_groups

def norm(s):
    s = re.sub(r'（[^）]*）|\([^)]*\)', '', str(s or ''))   # 括号内容（副标题/卷号/身份注释）不参与匹配
    return re.sub(r'[\s·•✅🏠🏁\[\]「」*]|世界$', '', s)

def main():
    args = [os.path.abspath(a) for a in sys.argv[1:]]
    all_md = [p for p in glob.glob(os.path.join(DOCS, '**', '*.md'), recursive=True)]
    targets = args if args else all_md
    cur_vol, cur_ch = progress_pointer()
    print(f'进度指针：第{cur_vol}卷·第{cur_ch}章 · 检查 {len(targets)} 个文件\n')

    errors, warns = [], {}
    def warn(cat, msg): warns.setdefault(cat, []).append(msg)
    args_mode = bool(args)   # 指定文件=本批产出 → 额外查内容深度
    sizes = []               # (rel, 正文去空白字数)
    GROUP_PAGE = re.compile(r'配角|群像|合集')

    # 逐文件检查
    cite_re = re.compile(r'第?([一二三四五六七八九十百零\d]{1,6})\s*卷(?:\s*[·、]?\s*第?([一二三四五六七八九十百零\d]{1,6})\s*章)?')
    for fp in targets:
        rel = os.path.relpath(fp, ROOT).replace('\\', '/')
        text = read(fp)
        body = re.sub(r'^---\s*\n.*?\n---\s*\n', '', text, count=1, flags=re.S)   # 去 front-matter
        body_n = len(re.sub(r'\s', '', body))
        sizes.append((rel, body_n))
        # 抢跑
        for m in cite_re.finditer(text):
            vol, ch = cn2int(m.group(1)), cn2int(m.group(2)) if m.group(2) else None
            if vol is None or vol > 200: continue   # 非卷号误匹配
            if vol > cur_vol or (vol == cur_vol and ch is not None and ch > cur_ch):
                errors.append(f'{rel} → 引用「{m.group(0)}」超过进度指针（抢跑/笔误）')
        # 段落紧贴列表（嵌套/缩进的列表行、表格、admonition、front-matter 均不算段落）
        lines = text.splitlines(); fence = False; fm_end = 0
        if lines and lines[0].strip() == '---':
            for j in range(1, len(lines)):
                if lines[j].strip() == '---': fm_end = j; break
        for i in range(fm_end, len(lines) - 1):
            s = lines[i].strip()
            if s.startswith('```'): fence = not fence
            if fence or not s: continue
            nxt = lines[i + 1].lstrip()
            if re.match(r'^[-*+]\s|^\d+\.\s', nxt) and not re.match(r'^(#{1,6}\s|[-*+]\s|\d+\.\s|\||!!!|>|```|---|<)', s):
                warn('段落紧贴列表（须空行）', f'{rel}:{i + 1}')
        # 人物页专项
        if '/人物/' in rel and not rel.endswith('index.md'):
            fm = front_matter(text)
            if not fm:
                warn('人物页缺 front-matter', rel)
            else:
                for k in ('title', '分类'):
                    if k not in fm: warn('人物页 front-matter 缺字段', f'{rel} 缺 {k}')
                if '所属世界' not in fm and '所属' not in fm: warn('人物页 front-matter 缺字段', f'{rel} 缺 所属世界')
                if '状态' not in fm and '身份' in fm: warn('人物页 front-matter 缺字段', f'{rel} 缺 状态')
            if not re.search(r'^#{2,3}\s*.*关系', text, re.M): warn('人物页缺「关系」节', rel)
            if not re.search(r'^#{2,3}\s*.*出处', text, re.M): warn('人物页缺「出处」节', rel)
            # 内容深度（仅本批指定文件模式；配额详见 _廉价模型工作流.md §2：A≥800/B≥400/C≥150）
            if args_mode and not GROUP_PAGE.search(rel):
                if body_n < 150: warn('人物页不足 C 级下限（<150字·过薄=返工）', f'{rel}（{body_n} 字）')
                # 叙事/经历内容判定：有「经历/历程」节、或标题带卷章、或存在任一「非样板」小节
                # （事件式小标题如「## 被斩」「## 直觉与刀术宗师」也算叙事，避免误伤好页）
                BOILER = ('简介', '关系', '出处', '外貌', '性格', '身份', '能力', '属性', '战力', '定位', '制造')
                heads = re.findall(r'^#{2,4}\s*(.+?)\s*$', text, re.M)
                narrative = any('经历' in h or '历程' in h or re.search(r'[一二三四五六七八九十百\d]+卷', h)
                               or not any(b in h for b in BOILER) for h in heads)
                if not narrative: warn('人物页缺叙事/经历内容（仅样板小节·像空壳）', rel)

    # nav 全局检查
    try:
        nav_map = load_nav()
        in_nav = set(nav_map.keys())
        for fp in all_md:
            rel_doc = os.path.relpath(fp, DOCS).replace('\\', '/')
            if rel_doc == 'index.md': continue   # 站点首页不需要挂 nav
            if rel_doc not in in_nav:
                warn('未挂 nav 的页面', rel_doc)
        # 人物分组 vs 所属世界
        SKIP_GROUPS = {'主角与随从', '人物'}
        for fp in all_md:
            rel_doc = os.path.relpath(fp, DOCS).replace('\\', '/')
            if not rel_doc.startswith('人物/') or rel_doc.endswith('index.md'): continue
            trail = nav_map.get(rel_doc)
            if not trail: continue
            group = trail[-1]
            if group in SKIP_GROUPS: continue
            fm = front_matter(read(fp)) or {}
            world = fm.get('所属世界') or ''   # 只认「所属世界」；旧页「所属」多为组织/势力，不能当世界比对
            if not world: continue
            nw, ng = norm(world), norm(group)
            if not nw or '乐园' in nw or '虚空' in nw: continue   # 跨世界者（轮回乐园/各乐园/虚空籍）nav 组无法机械推断，交人工
            if ng and nw not in ng and ng not in nw:
                warn('人物 nav 分组疑与所属世界不符', f'{rel_doc}：front-matter「{world}」 vs nav 组「{group}」')
    except Exception as e:
        warn('nav 解析失败（人工检查 mkdocs.yml）', str(e))

    # ── 汇报 ──
    if args_mode:
        print('📏 本批文件字数（正文去空白·对照交接单 A≥800/B≥400/C≥150）：')
        for rel, n in sorted(sizes, key=lambda x: x[1]):
            print(f'   {n:>6} 字  {rel}')
        print()
    for cat, items in warns.items():
        print(f'△ {cat}：{len(items)} 处')
        for it in items[:CAP]: print(f'   {it}')
        if len(items) > CAP: print(f'   …另 {len(items) - CAP} 处')
    if errors:
        print(f'\n✗ 抢跑/越进度引用：{len(errors)} 处（错误）')
        for e in errors[:CAP]: print(f'   {e}')
        if len(errors) > CAP: print(f'   …另 {len(errors) - CAP} 处')
        sys.exit(2)
    print('\n✓ 无越进度引用' + ('，无警告' if not warns else f'（警告 {sum(len(v) for v in warns.values())} 处，人工酌情处理）'))

if __name__ == '__main__':
    main()
