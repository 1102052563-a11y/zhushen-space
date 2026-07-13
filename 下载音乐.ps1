<#
  下载音乐.ps1 — 从 YouTube / 哔哩哔哩 等 1000+ 站点提取 MP3
  依赖: yt-dlp + ffmpeg (已用 scoop 装好)

  用法:
    .\下载音乐.ps1 "<单曲URL>"                    # 下到当前目录
    .\下载音乐.ps1 "<单曲URL>" "BGM\鸣潮"         # 下到指定文件夹
    .\下载音乐.ps1 "<歌单/合集URL>" "BGM\鸣潮"    # 整个列表批量，自动编号
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Url,
  [Parameter(Position = 1)][string]$Out = "."
)

# 中文控制台正确显示 UTF-8（曲名/进度）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not (Test-Path -LiteralPath $Out)) {
  New-Item -ItemType Directory -Path $Out -Force | Out-Null
}

# 播放列表 → "序号 - 标题.mp3"；单曲 → "标题.mp3"
$template = "$Out\%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s"

yt-dlp `
  --extract-audio --audio-format mp3 --audio-quality 0 `
  --embed-metadata --embed-thumbnail --convert-thumbnails jpg `
  --ignore-errors --no-overwrites --concurrent-fragments 4 `
  --output $template `
  -- $Url

Write-Host "`n[完成] 文件已保存到: $Out" -ForegroundColor Green
