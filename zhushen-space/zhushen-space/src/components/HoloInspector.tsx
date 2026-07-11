import { useEffect, useState } from 'react';
import HoloCard from './HoloCard';
import { type HoloFoil } from '../systems/holoFoils';
import { useImageGen } from '../store/imageGenStore';
import { getDepthMap, getCachedDepth } from '../systems/depthMap';

interface Props {
  open: boolean;
  onClose: () => void;
  img?: string;
  name?: string;
  badge?: string;
  grade?: string;
  tier?: string;
  foil?: HoloFoil;
  power?: { label?: string; value: string };
  rows?: { label: string; value: string }[];
}

/** 点击放大检视：全屏暗底弹层 + 大号全息卡（拖动旋转）。可手动「2.5D 化」（本地/网关生成深度图后按深度视差）。 */
export default function HoloInspector({ open, onClose, img, name, badge, grade, tier, foil, power, rows }: Props) {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
  const holoParallax = useImageGen((s) => s.holoParallax);
  const [depthSrc, setDepthSrc] = useState<string | undefined>(undefined);
  const [flat, setFlat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');

  // 打开时只查缓存（生成过一次就直接 2.5D），不自动生成——生成由玩家手动点按钮
  useEffect(() => {
    setDepthSrc(undefined); setFlat(false); setBusy(false); setProg('');
    if (!open || !holoParallax || !img) return;
    let alive = true;
    getCachedDepth(img).then((d) => { if (alive && d) setDepthSrc(d); });
    return () => { alive = false; };
  }, [open, holoParallax, img]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onResize = () => setVw(window.innerWidth);
    setVw(window.innerWidth);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open, onClose]);

  if (!open) return null;
  const cardW = Math.min(330, vw - 48);
  const use2p5d = !!depthSrc && !flat;

  async function make2p5d() {
    if (!img || busy) return;
    setBusy(true); setProg('准备…');
    let errMsg = '';
    const d = await getDepthMap(img, (info) => {
      if (info.stage && info.stage.indexOf('错误') === 0) errMsg = info.stage;
      setProg(info.pct != null ? `${info.stage} ${info.pct}%` : info.stage);
    });
    setBusy(false);
    if (d) { setDepthSrc(d); setFlat(false); setProg(''); }
    else setProg(errMsg || '生成失败（模型下载失败？国内在 设置→生图 填 hf-mirror，或改用网关端点）');
  }

  const btnBase: React.CSSProperties = { fontSize: 13, fontWeight: 500, padding: '6px 14px', borderRadius: 9, cursor: 'pointer' };
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        background: 'radial-gradient(120% 90% at 50% 28%, rgba(20,6,14,.92) 0%, rgba(10,4,12,.95) 55%, rgba(2,1,4,.97) 100%)',
        backdropFilter: 'blur(3px)',
      }}>
      <div onClick={(e) => e.stopPropagation()}>
        <HoloCard img={img} name={name} badge={badge} grade={grade} tier={tier} foil={foil} power={power} rows={rows} depthSrc={use2p5d ? depthSrc : undefined} width={cardW} mode="drag" />
      </div>

      {holoParallax && img && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, flexWrap: 'wrap', justifyContent: 'center', padding: '0 16px' }}>
          {!depthSrc ? (
            <button onClick={make2p5d} disabled={busy}
              style={{ ...btnBase, color: '#f4d78a', background: 'rgba(26,5,8,.85)', border: '1px solid #7a4a12', opacity: busy ? 0.7 : 1 }}>
              {busy ? (prog || '生成中…') : '✨ 2.5D 化'}
            </button>
          ) : (
            <button onClick={() => setFlat((f) => !f)}
              style={{ ...btnBase, color: '#e7d9ff', background: 'rgba(26,5,20,.8)', border: '0.5px solid #6a3a52' }}>
              {flat ? '切到 2.5D 立体' : '切回平面'}
            </button>
          )}
          {!busy && prog && <span style={{ fontSize: 12, color: '#c99a8f' }}>{prog}</span>}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13, color: '#c99a8f', textAlign: 'center', padding: '0 16px' }}>
        {use2p5d ? '2.5D · 按住拖动旋转，立绘随深度凸起' : '按住拖动旋转检视 · 松手回正'} · 点空白 / ✕ 关闭
      </p>
      <button onClick={onClose} aria-label="关闭检视"
        style={{ position: 'fixed', top: 16, right: 16, width: 38, height: 38, borderRadius: 9, fontSize: 18, color: '#f4d78a', background: 'rgba(26,5,8,.8)', border: '0.5px solid #6a3a12', cursor: 'pointer' }}>✕</button>
    </div>
  );
}
