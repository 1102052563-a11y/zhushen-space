# 聊天室表情包·文件夹直投

把你自己的表情图丢进这里，刷新/构建后就自动出现在聊天室的 🖼 表情包选择器里（和内置的「表情 / 萌宠」两套并排）。

## 怎么加

1. 在本目录下新建一个子文件夹，**文件夹名 = 表情包名**（会显示成选择器里的标签页），例如：
   ```
   public/stickers/nailong/
   ```
2. 把图片丢进去，**每个文件 = 一张贴纸**，文件名（去掉扩展名）= 贴纸 id：
   ```
   public/stickers/nailong/开心.gif
   public/stickers/nailong/委屈.gif
   public/stickers/nailong/点赞.png
   ```
3. 跑 `npm run dev` 或构建（含 Cloudflare 部署）时会**自动生成 `manifest.json`**，无需手写。

## 支持格式

`gif` · `png` · `jpg/jpeg` · `webp` · `apng` · `avif`。
**动图（gif / 动态 webp / apng）会自动播放**——前端用 `<img>` 渲染，浏览器原生动起来。

## 建议

- 单张控制在 ~256px、几百 KB 以内，太大的图会拖慢加载（聊天里显示约 116px）。
- 发送时只在玩家之间广播 `{包名, id}` 引用，**图片本身由部署站点当静态资源分发**，不走聊天连接。

## 体积 / 压缩

动图 GIF 很容易几 MB 一张，**别把原图直接丢进来**（会撑爆仓库 + 拖慢加载）。建议先用 `gifsicle` 批量压：缩到 ~160px、降调色板、有损压缩，flat 卡通(如奶龙)能压掉 ~80%（实测 150 张 142MB → 26MB），116px 显示完全看不出差别。

```powershell
# 在临时目录装 gifsicle（别装进本项目，免污染 package.json）
mkdir _t; cd _t; npm init -y; npm i gifsicle
$bin = "$PWD\node_modules\gifsicle\vendor\gifsicle.exe"   # Windows
# 把原图所在目录里的 gif 压进表情包目录
Get-ChildItem "原图目录\*.gif" | ForEach-Object {
  & $bin --resize-fit 160x160 --colors 128 -O3 --lossy=110 -o "public\stickers\<包名>\$($_.Name)" $_.FullName
}
```

太大/太糊就调 `--lossy`（小=更清晰大体积，大=更小更糊）和 `--resize-fit`。

## ⚠️ 版权

这些文件会随仓库**公开部署**（任何人可访问），等于你在公开再分发它们。
请只放**你有权使用**的素材（自己的原创、已获授权、或明确可商用/CC0 的）。
放进来的素材版权与合规由放置者自负。
