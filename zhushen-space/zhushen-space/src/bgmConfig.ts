/* 背景音乐（BGM）来源地址。
 *
 * 默认空字符串 = 同源 /audio/bgm/：
 *   - 线上：由 Pages Function functions/audio/bgm/[[path]].js 从 Cloudflare R2 桶提供
 *           （音乐用 tools/upload-r2 上传到 R2 的 audio/bgm/ 前缀；见 tools/upload-r2/R2部署说明.md）。
 *   - 本地 dev：往 public/audio/bgm/ 丢音乐文件即可（已 gitignore，vite 插件生成 manifest）。
 *   这是本项目采用的方案——同源、零 CORS、git 不膨胀，与 欢愉宫图片/强化立绘 走同一条 R2 轨。
 *
 * 若想把音乐放到「完全独立的站点」（另一个 Pages/R2/任意静态主机），填成它的地址即可，例如：
 *     export const BGM_SOURCE = 'https://zhushen-bgm.pages.dev';
 *   此时那个站点需自带 manifest.json + 音乐文件，且给 manifest.json 回 CORS 头
 *   （Access-Control-Allow-Origin: *；音频用 <audio> 跨源播放不需要 CORS）。
 */
export const BGM_SOURCE: string = '';   // 标注 string（非字面量 ''），否则 TS 把下面三元真值分支判成 never

/** 规范化后的 BGM 基址：空→同源 /audio/bgm；否则去掉结尾斜杠的外部地址。 */
export const bgmBase = (): string => (BGM_SOURCE ? BGM_SOURCE.replace(/\/+$/, '') : '/audio/bgm');
