# -*- coding: utf-8 -*-
"""MkDocs 构建后处理：把 search/search_index.json 压到 Cloudflare Pages 的单文件上限之内。

背景
----
MkDocs 默认用带空格、且非 ASCII 一律转义（每个中文 6 字节，是 UTF-8 原字 3 字节的两倍）
的 JSON 写出索引。本站 730 余页、约 290 万字，原始索引体积虚高；而 Material 接管了
search 插件、不支持 mkdocs 内置 search 的 ``indexing`` 选项，没法在插件层调深度。

策略（按代价从小到大，够用就停）
--------------------------------
1. **紧凑序列化**：去分隔符空格 + 中文按原字存。纯序列化层变换，客户端 JSON.parse
   得到的对象逐字节等价、**搜索质量零损失**，通常到此即可。
2. **逐级截断**：只有在第 1 步之后仍超过 ``SAFE_MIB`` 时，才按 ``CAPS`` 从宽到严
   依次截断每条记录的正文，一旦达标立即停止。标题与跳转位置（title/location）
   任何情况下都保留，所以「按条目名搜索」永远是完整的。

索引记录是**按小节**切分的，所以即便触发截断，也是「每个小节的前 N 字」，而非「每页的前 N 字」。

⚠ 若日后内容继续增长、日志出现 WARNING，优先考虑给超长聚合页（总览/时间线 这类）
分页，而不是一味调小 ``CAPS``。
"""
import json
import os

LIMIT_MIB = 25          # Cloudflare Pages 单文件硬上限
SAFE_MIB = 22           # 留 3 MiB 余量，供后续内容增长
CAPS = (20000, 10000, 5000, 3000, 1600, 800)   # 逐级截断的候选上限（字）


def _write(path, data):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(path)


def on_post_build(config, **kwargs):
    path = os.path.join(config['site_dir'], 'search', 'search_index.json')
    if not os.path.exists(path):
        return

    before = os.path.getsize(path)
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    docs = data.get('docs') or []

    # ① 紧凑序列化（无损）
    size = _write(path, data)
    if size <= SAFE_MIB * 1048576:
        print('INFO    -  [shrink_search] %d 条记录 · 紧凑化（内容无损）:'
              ' %.2f MB -> %.2f MB' % (len(docs), before / 1048576.0, size / 1048576.0))
        return

    # ② 仍超标才逐级截断
    for cap in CAPS:
        for doc in docs:
            text = doc.get('text') or ''
            if len(text) > cap:
                doc['text'] = text[:cap]
        size = _write(path, data)
        print('INFO    -  [shrink_search] %d 条记录 · 正文截断至 %d 字:'
              ' %.2f MB -> %.2f MB' % (len(docs), cap, before / 1048576.0, size / 1048576.0))
        if size <= SAFE_MIB * 1048576:
            return

    if size > LIMIT_MIB * 1048576:
        print('WARNING -  [shrink_search] 索引仍达 %.2f MB，超过 Cloudflare Pages 单文件'
              ' %d MiB 上限 —— 建议拆分超长聚合页' % (size / 1048576.0, LIMIT_MIB))
