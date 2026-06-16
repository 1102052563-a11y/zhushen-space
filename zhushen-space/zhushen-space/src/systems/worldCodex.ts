import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { CODEX_GLOBAL_RULE, type CodexModule } from '../worldCodexModules';

/* 世界百科生成：每个模块各一次调用，强制原著锁定 + Google Search（由全局规则在 system 里要求）。
   走 resolveApiChain('codex', …)——可在「设置→变量管理→世界百科」给该功能单独路由到
   支持联网搜索的接口；未配置则回退到正文共享/独立 API。 */
export async function genCodexSection(mod: CodexModule, ipName: string): Promise<string> {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('codex', legacy);
  const user = `【目标作品 / 世界】${ipName || '（未指定，请根据上下文判断这是哪部作品）'}\n\n${mod.prompt}`;
  const { content } = await apiChatFallback(
    chain,
    [
      { role: 'system', content: CODEX_GLOBAL_RULE },
      { role: 'user', content: user },
    ],
    { timeoutMs: 180000 },
  );
  return (content ?? '').trim();
}
