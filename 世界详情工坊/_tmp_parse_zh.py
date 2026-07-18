# -*- coding: utf-8 -*-
import re, os
base = r"C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊"
for fn in os.listdir(base):
    if fn.startswith("_tmp_zh_") and fn.endswith(".txt"):
        path = os.path.join(base, fn)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            t = f.read()
        print("FILE", fn, "len", len(t))
        # print sections with keywords
        for k in ["角色经历", "悲惨童年", "初遇", "灵槐", "成王", "菩提", "风花", "天武", "群英", "王国纷争", "龙虎", "用语解说", "镇魂街与", "能力", "道具", "地狱道", "武神躯", "十殿", "唐流雨", "吕蒙", "北落", "项昆仑", "阿撒兹勒", "结局", "罗刹"]:
            i = t.find(k)
            if i >= 0:
                snip = t[i:i+600].replace("\n", " ")
                print(f"\n--- {fn} :: {k} ---")
                print(snip)
        print("\n=====\n")
