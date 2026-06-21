import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { emojiRegex, twemojiUrl } from '../systems/chatEmoji';

/* 聊天消息文本渲染：Markdown(react-markdown + GFM) 收敛为「行内」风格(粗体/斜体/删除线/行内代码/链接/列表)；
   不解析裸 HTML(默认·防 XSS)；自动把裸 URL 变链接(GFM)。
   再经 rehype 把文本里的 emoji 换成 Twemoji SVG 求跨平台一致，图挂了 onError 回退系统原生。 */

// rehype 插件：文本节点里的 emoji → <img class=chat-emoji>（Twemoji），其余文本保留。
function rehypeEmoji() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      const next: any[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string' && /\p{Extended_Pictographic}/u.test(child.value)) {
          next.push(...splitEmoji(child.value));
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}
function splitEmoji(text: string): any[] {
  const re = emojiRegex();
  const out: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    const e = m[0];
    out.push({ type: 'element', tagName: 'img', properties: { src: twemojiUrl(e), alt: e, className: ['chat-emoji'] }, children: [] });
    last = m.index + e.length;
    if (re.lastIndex === m.index) re.lastIndex++;   // 防零宽匹配死循环
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

function EmojiImg({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span>{alt}</span>;
  return <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)}
    style={{ display: 'inline-block', width: '1.3em', height: '1.3em', margin: '0 0.05em', verticalAlign: '-0.2em' }} />;
}

const ALLOWED = ['p', 'br', 'em', 'strong', 'del', 'code', 'a', 'ul', 'ol', 'li', 'img', 'span'];

export default function MessageText({ text }: { text: string }) {
  return (
    <span className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeEmoji]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          p: ({ children }: any) => <span>{children}</span>,
          a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-400 hover:underline break-all">{children}</a>,
          code: ({ children }: any) => <code className="px-1 py-0.5 rounded bg-black/30 text-amber-200/90 text-[0.9em] font-mono break-all">{children}</code>,
          img: (props: any) => (String(props.className || '').includes('chat-emoji') ? <EmojiImg src={props.src} alt={props.alt || ''} /> : null),
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}
