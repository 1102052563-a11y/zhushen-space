# NAI 批量生图

独立 Node 脚本：读 `jobs.json` → 逐个调 NovelAI → 解 ZIP → PNG 自动落地到 `public/<folder>/`。
接口与参数复用 App 的 `src/systems/imageGen.ts`（NAI v4 流程），零额外依赖；Node 直连，无需 CORS 代理。

## 一次性准备

1. 进内层目录：`zhushen-space/zhushen-space/`
2. 打开 `tools/nai-batch/config.json`，把 `apiToken` 填成你的 **NovelAI 持久化 Token**
   （NAI 网站 → 账号设置 → Get Persistent API Token）。
   或者临时用环境变量：`$env:NAI_TOKEN = "pst-xxxx"`。
   `config.json` 已 gitignore，不会进仓库。

## 用法

```powershell
npm run nai                 # 跑 jobs.json 所有任务；已存在的图自动跳过
npm run nai -- --list       # 只列任务清单，不生成
npm run nai -- --dry        # 演练：打印计划与 seed，不真调接口
npm run nai -- --force      # 重生，覆盖已存在的图
npm run nai -- --job=凯莉    # 只跑 folder/prefix 含「凯莉」的任务
```

> 直接 `node tools/nai-batch/nai-batch.mjs [flags]` 亦可（npm 脚本只是包装）。

## jobs.json 字段

| 字段 | 说明 |
|---|---|
| `outBase` | 输出根目录，相对脚本所在目录，默认 `../../public` |
| `jobs[].folder` | 输出子目录（`public` 下），如 `凯莉/一阶段` → `public/凯莉/一阶段/` |
| `jobs[].prefix` | 文件名前缀，输出 `prefix_01.png`、`prefix_02.png`… |
| `jobs[].count` | 张数 |
| `jobs[].prompt` | 正向提示词（英文 danbooru/NAI tags）。画师/质量串已在 `config.json` 的 `artistTags` 里自动前置 |
| `jobs[].negative` | （可选）负面词，覆盖默认 |
| `jobs[].size` | （可选）`宽x高`，如 `832x1216`（竖向立绘）、`1216x832`（横）、`1024x1024` |
| `jobs[].model` / `steps` / `scale` / `sampler` / `seed` | （可选）覆盖 `config.json > defaults` |

未给 `seed` 时每张随机；给了 `seed` 则第 N 张用 `seed+N-1`（可复现）。

## 工作流（和我配合）

1. 你在对话里说「给凯莉一阶段生 4 张，银发蓝眼轻甲」之类的要求；
2. 我把它翻成 NAI tags 写进 `jobs.json`；
3. 你跑 `npm run nai`（或让我跑——前提是 token 已在 config.json）；
4. 图自动出现在 `public/凯莉/一阶段/`。

## 注意

- 输出在 `public/` 下**会进 git、会随 Cloudflare 部署**。不想上线的练手图，放 `public/` 外或自行清理。
- 想让图能在 App 内当「肖像图库」选用，把 `folder` 设到 `portraits/<分类>`（图库会自动扫描 `public/portraits/`）。
- PowerShell 控制台若显示中文乱码，先 `chcp 65001`；**文件本身是 UTF-8、内容正常**，只是控制台编码问题。
- NAI 有频率限制，默认每张间隔 `config.json > gapSec`(6 秒)；批量很多时调大一点更稳。
