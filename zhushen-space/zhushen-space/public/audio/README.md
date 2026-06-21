# 游戏音效素材放这里

把 `.mp3` 文件按下面的**文件名**丢进本目录（`public/audio/`）即生效——缺文件不报错、自动跳过。
引擎 `src/systems/audio.ts` 懒加载 Howler（独立 chunk，约 10KB gzip，不进主包）。
设置在「设置 → 综合设置 → 音效」：总开关 / 总音量 / 环境音开关+音量。

## 一次性音效（文件名 → 触发时机）

| 文件 | 触发 | 现已接线 |
|---|---|---|
| `dice.mp3` | 掷骰判定（ROLL 面板掷骰） | ✅ |
| `hit.mp3` | 战斗·普通命中 | ✅ |
| `crit.mp3` | 战斗·暴击/斩首 | ✅ |
| `fanfare.mp3` | 世界结算（出现 `<世界结算>`） | ✅ |
| `msg.mp3` | 聊天室新消息（未读+1） | ✅ |
| `block.mp3` | 战斗·格挡/防御 | ⏳ 引擎就绪，待接线 |
| `heal.mp3` | 治疗/回血 | ⏳ |
| `levelup.mp3` | 升级/突破 | ⏳ |
| `coin.mp3` | 获得货币/奖励 | ⏳ |
| `slot.mp3` | 赌坊转动 | ⏳ |
| `win.mp3` | 赌坊中奖 | ⏳ |
| `open.mp3` | 开箱/开面板 | ⏳ |

## 环境循环音（随顶栏天气 weatherFx 自动切换）

| 文件 | 天气 |
|---|---|
| `amb-rain.mp3` | 雨 |
| `amb-thunder.mp3` | 雷 |
| `amb-snow.mp3` | 雪 |
| `amb-wind.mp3` | 风 |
| `amb-fog.mp3` | 雾 |

（晴/阴/无天气/回归乐园 → 无环境音）

## 免费素材来源（注意各自许可证）
- Kenney.nl（CC0·完全免费可商用）
- OpenGameArt.org
- Freesound.org
- Pixabay 音频

建议：SFX 短促（<1s）、环境音做成无缝循环（loop）的 10~30s 片段。
