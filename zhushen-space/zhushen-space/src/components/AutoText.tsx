/* 跨玩家在线内容的自动机翻包装组件。把 useAutoText 封成组件，方便在 .map() 列表里逐条使用
   （每条消息/挂牌是独立组件实例，符合 hooks 规则）。见 i18n/autoTranslate.ts。 */
import { useAutoText } from '../i18n/autoTranslate';
import MessageText from './MessageText';

/** 纯文本：返回当前语言下的显示文本（卖家备注、简介等）。 */
export function AutoText({ text }: { text?: string | null }) {
  return <>{useAutoText(text)}</>;
}

/** 聊天消息：机翻后交给 MessageText 渲染（保留其表情/链接等处理）。 */
export function AutoMessageText({ text }: { text?: string | null }) {
  return <MessageText text={useAutoText(text) || ''} />;
}
