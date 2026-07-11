import { useEffect, useState } from 'react';
import HoloCard from './HoloCard';
import { type HoloFoil } from '../systems/holoFoils';

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

/** 点击放大检视：全屏暗底弹层 + 大号全息卡（拖动旋转）。 */
export default function HoloInspector({ open, onClose, img, name, badge, grade, tier, foil, power, rows }: Props) {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
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
  const cardW = Math.min(330, vw - 48);   // 窄屏（手机）时缩小，避免旋转时卡片出屏被裁
  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: 'radial-gradient(120% 90% at 50% 28%, rgba(20,6,14,.92) 0%, rgba(10,4,12,.95) 55%, rgba(2,1,4,.97) 100%)',
        backdropFilter: 'blur(3px)',
      }}>
      <div onClick={(e) => e.stopPropagation()}>
        <HoloCard img={img} name={name} badge={badge} grade={grade} tier={tier} foil={foil} power={power} rows={rows} width={cardW} mode="drag" />
      </div>
      <p style={{ margin: 0, fontSize: 13, color: '#c99a8f', textAlign: 'center', padding: '0 16px' }}>按住拖动旋转检视（手机可直接手指拖）· 松手回正 · 点空白/✕ 关闭</p>
      <button onClick={onClose} aria-label="关闭检视"
        style={{ position: 'fixed', top: 16, right: 16, width: 38, height: 38, borderRadius: 9, fontSize: 18, color: '#f4d78a', background: 'rgba(26,5,8,.8)', border: '0.5px solid #6a3a12', cursor: 'pointer' }}>✕</button>
    </div>
  );
}
