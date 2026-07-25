# -*- coding: utf-8 -*-
"""从 docs/ 目录重新生成 mkdocs.yml 的 nav 段（可重复运行）。

为什么要生成而不是手写
----------------------
本站 732 页，其中 剧情 302 页、人物 241 页。若不分组，Material 侧栏会摊出
一条 300 项的平铺列表，没法用；而手写 nav 在每批新增条目后都要人工补，必然漏。
于是按「目录 → 子分组」两层规则自动生成：

  剧情  按章号切块（正文梗概 / 原文回跳 两条序列各自按 200 章一组）
  人物  按正文篇幅分四档（核心 / 主要 / 次要 / 其他）——篇幅即重要度，
        与 _工作手册.md §3 的 S/A/B/C 字数配额同一把尺子
  其余  index.md 打头，其余按名称排序平铺

用法（在仓库根跑）::

    python 神秘复苏百科/scripts/gen-nav.py

脚本只重写 mkdocs.yml 中 NAV_MARKER 之后的内容，标记之前的手写配置原样保留。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOCS = os.path.join(ROOT, 'docs')
CFG = os.path.join(ROOT, 'mkdocs.yml')

NAV_MARKER = '# ===== 以下 nav 由 scripts/gen-nav.py 生成，勿手改 ====='

# 顶层分区顺序 + 侧栏 tab 图标
SECTIONS = [
    ('总览', '🌫'),
    ('剧情', '📖'),
    ('人物', '👤'),
    ('势力', '🏴'),
    ('地点', '📍'),
    ('物品', '🔮'),
    ('设定', '📜'),
]

# 人物分档：(组名, 去空白字数下限)，从高到低匹配
CHAR_TIERS = [
    ('核心人物', 3000),
    ('主要人物', 1500),
    ('次要人物', 600),
    ('其他人物', 0),
]

PLOT_BLOCK = 200        # 剧情按多少章一组


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def title_of(path, stem):
    """条目标题：front-matter title > 首个 H1 > 文件名。"""
    text = read(path)
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.S)
    if m:
        t = re.search(r'^title:\s*(.+?)\s*$', m.group(1), re.M)
        if t:
            return t.group(1).strip().strip('"\'')
        text = text[m.end():]
    h1 = re.search(r'^#\s+(.+?)\s*$', text, re.M)
    return h1.group(1).strip() if h1 else stem


def body_len(path):
    """去掉 front-matter 与所有空白后的字数——用作人物重要度。"""
    text = read(path)
    text = re.sub(r'^---\s*\n.*?\n---\s*\n', '', text, flags=re.S)
    return len(re.sub(r'\s', '', text))


def q(label):
    """nav 标签一律加引号：条目名里可能出现 : # 等 YAML 元字符。"""
    return '"%s"' % label.replace('\\', '\\\\').replace('"', '\\"')


def pages(section):
    """返回该分区下 [(stem, 相对 docs 的 posix 路径, 绝对路径)]，不含 index.md。"""
    d = os.path.join(DOCS, section)
    out = []
    for name in sorted(os.listdir(d)):
        if not name.endswith('.md') or name == 'index.md':
            continue
        out.append((name[:-3], '%s/%s' % (section, name), os.path.join(d, name)))
    return out


def emit(lines, indent, label, target):
    lines.append('%s- %s: %s' % ('  ' * indent, q(label), target))


def group(lines, indent, label, items):
    """items = [(标签, 路径)]；空组不输出。"""
    if not items:
        return
    lines.append('%s- %s:' % ('  ' * indent, q(label)))
    for lab, path in items:
        emit(lines, indent + 1, lab, path)


def build_plot(lines, indent):
    """剧情：正文梗概 / 原文回跳 两条序列，各按 PLOT_BLOCK 章切组。

    文件名两种形态：梗概-0101-0105章.md（正文）、梗概-回跳1540-1544章.md（原文回跳）。
    原文自第 500 余章起有一段「回跳」重编号，两条序列章号会重叠，故必须分开成组，
    否则同号两页会挤进同一区间、顺序错乱。
    """
    series = {'正文梗概': [], '原文回跳': []}
    for stem, rel, _abs in pages('剧情'):
        m = re.match(r'^梗概-(回跳)?(\d+)-(\d+)章$', stem)
        if not m:
            print('  [warn] 剧情文件名不合规，已跳过 nav：%s' % stem, file=sys.stderr)
            continue
        key = '原文回跳' if m.group(1) else '正文梗概'
        series[key].append((int(m.group(2)), int(m.group(3)), rel))

    for key in ('正文梗概', '原文回跳'):
        entries = sorted(series[key])
        if not entries:
            continue
        lines.append('%s- %s:' % ('  ' * indent, q(key)))
        blocks = {}
        for start, end, rel in entries:
            blocks.setdefault((start - 1) // PLOT_BLOCK, []).append((start, end, rel))
        for blk in sorted(blocks):
            chunk = blocks[blk]
            items = [('第%d-%d章' % (s, e), rel) for s, e, rel in chunk]
            # 组标签用该组「实际」首尾章号，而非 PLOT_BLOCK 的名义区间：
            # 原文存在缺章段（如 51-100 无梗概），名义区间会让侧栏显示并不存在的章节范围。
            group(lines, indent + 1, '第%d-%d章' % (chunk[0][0], chunk[-1][1]), items)


def build_chars(lines, indent):
    """人物：按去空白字数分四档，档内按字数降序（重要的排前面）。"""
    scored = []
    for stem, rel, path in pages('人物'):
        scored.append((body_len(path), title_of(path, stem), rel))
    scored.sort(key=lambda x: (-x[0], x[1]))

    for tier, floor in CHAR_TIERS:
        ceil = next((f for _t, f in CHAR_TIERS if f > floor), 10 ** 9)
        items = [(t, rel) for n, t, rel in scored if floor <= n < ceil]
        group(lines, indent, '%s（%d）' % (tier, len(items)), items)


def main():
    lines = ['nav:']
    lines.append('  - "🏠 首页": index.md')

    for section, icon in SECTIONS:
        if not os.path.isdir(os.path.join(DOCS, section)):
            print('  [warn] 缺分区目录：%s' % section, file=sys.stderr)
            continue
        lines.append('  - "%s %s":' % (icon, section))
        idx = os.path.join(DOCS, section, 'index.md')
        if os.path.exists(idx):
            lines.append('      - %s/index.md' % section)   # navigation.indexes：组首页
        if section == '剧情':
            build_plot(lines, 3)
        elif section == '人物':
            build_chars(lines, 3)
        else:
            for stem, rel, path in pages(section):
                emit(lines, 3, title_of(path, stem), rel)

    ref = os.path.join(DOCS, '参考', '编写规范.md')
    if os.path.exists(ref):
        lines.append('  - "📐 参考":')
        lines.append('      - 参考/编写规范.md')

    nav = '\n'.join(lines) + '\n'

    cfg = read(CFG)
    head = cfg.split(NAV_MARKER)[0].rstrip('\n')
    with open(CFG, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(head + '\n\n' + NAV_MARKER + '\n' + nav)

    total = sum(1 for _d, _s, fs in os.walk(DOCS) for f in fs if f.endswith('.md'))
    print('[gen-nav] nav 条目 %d 行，docs 共 %d 页 → %s' % (len(lines), total, CFG))


if __name__ == '__main__':
    main()
