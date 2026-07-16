import { describe, it, expect } from 'vitest';
import { cleanForTts, chunkSentences, parseSegments, attributeSpeaker, resolveNpcVoice, buildSovitsUrl } from './tts';
import { useTts, type SovitsVoice } from '../store/ttsStore';

describe('tts · cleanForTts 清洗成可朗读纯文', () => {
  it('剥掉成对机器指令块（连内文）', () => {
    const s = cleanForTts('卡尔拔剑。<state>hp.C1 = 50\nfavor += 3</state>他冲了上去。');
    expect(s).not.toContain('hp.C1');
    expect(s).not.toContain('state');
    expect(s).toContain('卡尔拔剑');
    expect(s).toContain('他冲了上去');
  });
  it('剥 markdown 与 HTML 标签，保留文字', () => {
    expect(cleanForTts('**重击**命中')).toBe('重击命中');
    expect(cleanForTts('# 标题\n正文')).toContain('正文');
    expect(cleanForTts('<div class="card">卡片</div>文字')).toBe('卡片文字');
  });
  it('删引用块 / 结算标题行', () => {
    const s = cleanForTts('正文一\n> 结算：+100 乐园币\n【世界结算】\n正文二');
    expect(s).toContain('正文一');
    expect(s).toContain('正文二');
    expect(s).not.toContain('乐园币');
    expect(s).not.toContain('世界结算');
  });
  it('图片删掉、链接留文字', () => {
    expect(cleanForTts('看这个![图](http://x/y.png)结束')).toBe('看这个结束');
    expect(cleanForTts('点[这里](http://x)看')).toBe('点这里看');
  });
  it('去装饰 emoji、压缩空白，保留中英文', () => {
    const s = cleanForTts('🔊 你好   world  🎉');
    expect(s).toContain('你好');
    expect(s).toContain('world');
    expect(/[🔊🎉]/u.test(s)).toBe(false);
  });
});

describe('tts · chunkSentences 切句', () => {
  it('空 → []', () => {
    expect(chunkSentences('')).toEqual([]);
    expect(chunkSentences('   ')).toEqual([]);
  });
  it('按句末标点切，短句合并到 maxLen 内', () => {
    const out = chunkSentences('甲。乙！丙？', 100);
    expect(out).toEqual(['甲。乙！丙？']);   // 都短 → 合并成一块
  });
  it('超过 maxLen 就分块', () => {
    const out = chunkSentences('一二三四五。六七八九十。', 6);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.length <= 6)).toBe(true);
  });
  it('单句超长 → 硬切', () => {
    const long = '啊'.repeat(50);
    const out = chunkSentences(long, 20);
    expect(out.length).toBe(3);          // 50 / 20 → 20+20+10
    expect(out[0].length).toBe(20);
  });
  it('保留句末标点', () => {
    expect(chunkSentences('他说话。', 100)[0]).toBe('他说话。');
  });
});

describe('tts · attributeSpeaker 台词归属', () => {
  const known = ['卡尔', '奥娜'];
  it('名字+说话动词 → 命中', () => {
    expect(attributeSpeaker('卡尔冷笑道：', known)).toBe('卡尔');
    expect(attributeSpeaker('奥娜轻声说：', known)).toBe('奥娜');
  });
  it('名字+： → 命中', () => {
    expect(attributeSpeaker('卡尔：', known)).toBe('卡尔');
  });
  it('无动词但有名字 → 兜底取最后出现的名字', () => {
    expect(attributeSpeaker('卡尔走上前，奥娜跟在后面。', known)).toBe('奥娜');
  });
  it('无已知名字 / 空 → undefined', () => {
    expect(attributeSpeaker('远处传来声音。', known)).toBeUndefined();
    expect(attributeSpeaker('', known)).toBeUndefined();
    expect(attributeSpeaker('卡尔说：', [])).toBeUndefined();
  });
});

describe('tts · parseSegments 旁白/台词切分', () => {
  it('旁白 + 台词 + 旁白，台词归属说话人', () => {
    const segs = parseSegments('卡尔说：「你好。」他笑了。', ['卡尔']);
    expect(segs.map((s) => s.kind)).toEqual(['narration', 'dialogue', 'narration']);
    expect(segs[1]).toMatchObject({ kind: 'dialogue', text: '你好。', speaker: '卡尔' });
    expect(segs[2].text).toBe('他笑了。');
  });
  it('纯旁白无引号 → 单段', () => {
    const segs = parseSegments('他走在熙攘的街道上。', ['卡尔']);
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe('narration');
  });
  it('多说话人各自归属；西文引号也切', () => {
    const segs = parseSegments('卡尔喊：「上！」奥娜回答："好。"', ['卡尔', '奥娜']);
    const dias = segs.filter((s) => s.kind === 'dialogue');
    expect(dias[0].speaker).toBe('卡尔');
    expect(dias[1].speaker).toBe('奥娜');
  });
  it('无法归属的台词 → speaker undefined', () => {
    const segs = parseSegments('「谁在那里？」', ['卡尔']);
    expect(segs[0]).toMatchObject({ kind: 'dialogue', speaker: undefined });
  });
});

describe('tts · resolveNpcVoice 音色分配', () => {
  it('手动指定优先', () => {
    useTts.setState({ npcVoices: { 卡尔: 'voice-kal' } });
    expect(resolveNpcVoice('卡尔')).toBe('voice-kal');
  });
  it('无指定且 node 无音色池 → 空串（浏览器里才有音色）', () => {
    useTts.setState({ npcVoices: {} });
    expect(resolveNpcVoice('无名氏')).toBe('');
  });
});

describe('tts · buildSovitsUrl 拼 GPT-SoVITS api_v2 的 GET /tts', () => {
  const cfg = { url: 'http://127.0.0.1:9880', textLang: 'zh', streaming: false, extra: '' };
  const kar: SovitsVoice = { id: 'sv_1', label: '卡尔', gender: 'male', refAudioPath: 'D:\\gsv\\refs\\kar.wav', promptText: '这是一段参考音频。', promptLang: 'zh' };
  const q = (url: string) => new URL(url).searchParams;

  it('必填参数齐全、值正确', () => {
    const p = q(buildSovitsUrl(cfg, kar, '你好世界', 1));
    expect(p.get('text')).toBe('你好世界');
    expect(p.get('text_lang')).toBe('zh');
    expect(p.get('ref_audio_path')).toBe('D:\\gsv\\refs\\kar.wav');   // Windows 路径原样送达（编码解码后一致）
    expect(p.get('prompt_text')).toBe('这是一段参考音频。');
    expect(p.get('prompt_lang')).toBe('zh');
    expect(p.get('media_type')).toBe('wav');
    expect(p.get('streaming_mode')).toBe('false');
  });
  it('走 /tts 路径，末尾斜杠会被吃掉，空地址回退默认', () => {
    expect(buildSovitsUrl({ ...cfg, url: 'http://127.0.0.1:9880/' }, kar, 'x').startsWith('http://127.0.0.1:9880/tts?')).toBe(true);
    expect(buildSovitsUrl({ ...cfg, url: '  ' }, kar, 'x').startsWith('http://127.0.0.1:9880/tts?')).toBe(true);
  });
  it('语速映射到 speed_factor 并夹在 0.5–2', () => {
    expect(q(buildSovitsUrl(cfg, kar, 'x', 1.5)).get('speed_factor')).toBe('1.5');
    expect(q(buildSovitsUrl(cfg, kar, 'x', 9)).get('speed_factor')).toBe('2');
    expect(q(buildSovitsUrl(cfg, kar, 'x', 0.1)).get('speed_factor')).toBe('0.5');
    expect(q(buildSovitsUrl(cfg, kar, 'x', 0)).get('speed_factor')).toBe('1');    // 0/NaN → 默认 1，别退化成 0.5
  });
  it('流式开关 → streaming_mode', () => {
    expect(q(buildSovitsUrl({ ...cfg, streaming: true }, kar, 'x')).get('streaming_mode')).toBe('true');
  });
  it('extra 覆盖默认参数、且能加新参数', () => {
    const p = q(buildSovitsUrl({ ...cfg, extra: 'media_type=ogg&top_k=15' }, kar, 'x'));
    expect(p.get('media_type')).toBe('ogg');    // 覆盖掉默认 wav
    expect(p.get('top_k')).toBe('15');
  });
  it('没配音色 → 参考音频为空（引擎据此拦截并提示，不发请求）', () => {
    const p = q(buildSovitsUrl(cfg, undefined, 'x'));
    expect(p.get('ref_audio_path')).toBe('');
    expect(p.get('prompt_lang')).toBe('zh');
  });
  it('特殊字符（中文/空格/&）被正确编码，不会撕裂 query', () => {
    const p = q(buildSovitsUrl(cfg, kar, '他说：「A & B」，对吗？'));
    expect(p.get('text')).toBe('他说：「A & B」，对吗？');
  });
});
