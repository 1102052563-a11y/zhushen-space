import { useHoloViewer } from '../store/holoViewerStore';
import HoloInspector from './HoloInspector';

/* 全局挂载一次（App 根部）：任意面板调用 useHoloViewer.getState().showItem/showNpc 即弹出全息卡检视。 */
export default function HoloViewer() {
  const open = useHoloViewer((s) => s.open);
  const props = useHoloViewer((s) => s.props);
  const hide = useHoloViewer((s) => s.hide);
  return <HoloInspector open={open} onClose={hide} {...props} />;
}
