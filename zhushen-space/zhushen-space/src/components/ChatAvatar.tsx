import { useEffect, useState } from 'react';
import { pixelPalDataUri } from '../systems/pixelPals';
import { fetchAvatar, cachedAvatar } from '../systems/chatAvatarCache';
import { dicebearPixelDataUri } from '../systems/dicebearAvatar';

/* 聊天头像，优先级 DiceBear(ds) > 上传(avv) > 像素动物(默认)：
   - ds 非空 → 本地由种子生成的 DiceBear pixel-art（零外部请求）；
   - avv>0   → 按 uid+ver 拉取的自定义上传头像（缓存）；
   - 否则    → 该 UID 的确定性像素小动物。
   加载/无自定义时回退像素动物，绝不空白。 */
export default function ChatAvatar({ uid, avv = 0, ds = '', size = 22, ring }: { uid: number; avv?: number; ds?: string; size?: number; ring?: string }) {
  const fallback = pixelPalDataUri(uid);
  const [src, setSrc] = useState<string>(() => (ds ? dicebearPixelDataUri(ds) : avv ? (cachedAvatar(uid, avv) || fallback) : fallback));

  useEffect(() => {
    let on = true;
    if (ds) {
      setSrc(dicebearPixelDataUri(ds));
    } else if (avv && uid) {
      const c = cachedAvatar(uid, avv);
      if (c !== undefined) setSrc(c || fallback);
      else fetchAvatar(uid, avv).then((a) => { if (on) setSrc(a || fallback); });
    } else {
      setSrc(fallback);
    }
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, avv, ds]);

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className="rounded-md shrink-0 align-middle object-cover bg-panel"
      style={{ imageRendering: 'pixelated', width: size, height: size, ...(ring ? { boxShadow: `0 0 0 1.5px ${ring}` } : {}) }}
    />
  );
}
