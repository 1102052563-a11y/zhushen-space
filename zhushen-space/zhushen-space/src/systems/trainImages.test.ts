import { describe, it, expect, beforeEach } from 'vitest';
import { trainImageKey, hydrateTrainImgs, trainImgGet, allTrainImgs, clearTrainImgCache } from './trainImages';
import { desireStage } from './trainingImage';
import { useChannel } from '../store/channelStore';

describe('🔗 trainImages 内存缓存', () => {
  beforeEach(() => clearTrainImgCache());
  it('key 单一权威格式', () => {
    expect(trainImageKey('C1', 'abc')).toBe('train:C1:abc');
  });
  it('hydrate 只灌 train: 前缀；get/all/clear', () => {
    hydrateTrainImgs({ 'train:C1:a': 'data:x', 'npc:C1': 'data:y', 'train:C2:b': 'data:z', 'outfit:B1:o': 'data:w' });
    expect(trainImgGet('train:C1:a')).toBe('data:x');
    expect(trainImgGet('npc:C1')).toBeUndefined();       // 非 train 前缀不灌（不越域）
    expect(trainImgGet('outfit:B1:o')).toBeUndefined();
    expect(allTrainImgs().size).toBe(2);
    clearTrainImgCache();
    expect(allTrainImgs().size).toBe(0);
  });
});

describe('🔗 desireStage 情欲阶段（与档案徽章同口径）', () => {
  it('分档 0~3，抠数字容忍文本', () => {
    expect(desireStage(0)).toBe(0);
    expect(desireStage('24')).toBe(0);
    expect(desireStage(25)).toBe(1);
    expect(desireStage(49)).toBe(1);
    expect(desireStage(50)).toBe(2);
    expect(desireStage(74)).toBe(2);
    expect(desireStage(75)).toBe(3);
    expect(desireStage('情欲值 88')).toBe(3);
    expect(desireStage(undefined)).toBe(0);
  });
});

describe('🖼 channelStore.addPlayerImage 分享带图帖', () => {
  beforeEach(() => useChannel.getState().clearChannel());
  it('立即上墙·byPlayer·speak·带 image 与 tier', () => {
    const id = useChannel.getState().addPlayerImage('general', '白夜', '看这张', 'data:img', '五阶·Lv.40');
    const m = useChannel.getState().messages.find((x) => x.id === id);
    expect(m).toBeTruthy();
    expect(m!.image).toBe('data:img');
    expect(m!.byPlayer).toBe(true);
    expect(m!.speak).toBe(true);
    expect(m!.authorTier).toBe('五阶·Lv.40');
    expect(m!.kind).toBe('chat');
  });
  it('speak 帖（含带图）总数限 10', () => {
    for (let i = 0; i < 15; i++) useChannel.getState().addPlayerImage('general', '白夜', 'p' + i, 'data:' + i);
    expect(useChannel.getState().messages.filter((m) => m.speak).length).toBeLessThanOrEqual(10);
  });
});
