import { useRef, useState } from 'react';
import { useSettings, type WorldBook, type WorldBookEntry, type TextGenPreset, type STPromptEntry, type RegexScript } from '../store/settingsStore';
import VariableManager from './VariableManager';
import ApiRoutePicker from './ApiRoutePicker';
import ItemManager from './ItemManager';
import PlayerManager from './PlayerManager';
import NpcManager from './NpcManager';
import FactionManager from './FactionManager';
import TerritoryManager from './TerritoryManager';
import AdventureTeamManager from './AdventureTeamManager';
import CosmosManager from './CosmosManager';
import MemoryManager from './MemoryManager';
import MiscManager from './MiscManager';
import DiceManager from './DiceManager';
import CombatManager from './CombatManager';
import ArenaManager from './ArenaManager';
import EnhanceManager from './EnhanceManager';
import JoyManager from './JoyManager';
import NovelVecManager from './NovelVecManager';
import WorldCodexManager from './WorldCodexManager';
import ChannelManager from './ChannelManager';
import ImageGenManager from './ImageGenManager';
import { useMisc } from '../store/miscStore';
import { useNovelVec } from '../store/novelVecStore';
import { buildMemPool, ensureVectors as factVecEnsure, vecStatus as factVecStatus, clearAllVectors as factVecClear } from '../systems/factVec';

interface SettingsPanelProps {
  onClose: () => void;
  onOpenSaveLoad: () => void;   // 打开存档管理面板（导出/导入/重置游戏数据；逻辑复用 SaveLoadPanel）
}

type Page = 'home' | 'world-detail' | 'textgen-detail' | 'regex-detail' | 'general' | 'variables' | 'item-manager' | 'player-manager' | 'npc-manager' | 'faction-manager' | 'territory-manager' | 'team-manager' | 'cosmos-manager' | 'memory-manager' | 'misc-manager' | 'channel-manager' | 'novelvec-manager' | 'codex-manager' | 'dice-manager' | 'combat-manager' | 'arena-manager' | 'enhance-manager' | 'joy-manager' | 'narrative-memory' | 'vector-memory' | 'image-gen';
type Tab = 'worldbook' | 'api' | 'prompt' | 'preset' | 'global-regex' | 'preset-regex';

function DetailLayout({ title, onBack, tabs, activeTab, onTab, children }: {
  title: string;
  onBack: () => void;
  tabs: { key: Tab; label: string; icon: string }[];
  activeTab: Tab;
  onTab: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen flex flex-col bg-void text-slate-300">
      <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
          ← 系统设置
        </button>
        <span className="text-sm font-mono text-dim">{title}</span>
        <div className="w-20" />
      </header>
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <nav className="shrink-0 w-40 max-lg:w-full max-lg:flex max-lg:overflow-x-auto border-r max-lg:border-r-0 max-lg:border-b border-edge bg-panel py-4 max-lg:py-2 space-y-1 max-lg:space-y-0 max-lg:gap-1 px-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => onTab(item.key)}
              className={`w-full max-lg:w-auto max-lg:shrink-0 max-lg:whitespace-nowrap flex items-center gap-2 px-3 py-2.5 rounded text-sm transition-colors text-left ${
                activeTab === item.key ? 'bg-god/10 text-god border border-god/30' : 'text-dim hover:text-slate-200 hover:bg-panel2'
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">{children}</div>
      </div>
    </div>
  );
}

export default function SettingsPanel({ onClose, onOpenSaveLoad }: SettingsPanelProps) {
  const [page, setPage] = useState<Page>('home');
  const [tab, setTab] = useState<Tab>('worldbook');

  if (page === 'general') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">综合设置</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <div className="max-w-xl mx-auto">
            <GeneralSettingsSection />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'narrative-memory') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">叙事记忆</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <div className="max-w-2xl mx-auto">
            <NarrativeMemorySettings />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'vector-memory') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">向量记忆</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <div className="max-w-2xl mx-auto">
            <VectorMemorySettings />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'image-gen') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">生图设置</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <div className="max-w-3xl mx-auto">
            <ImageGenManager />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'variables') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">变量管理</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <VariableManager
            onOpenItemManager={() => setPage('item-manager')}
            onOpenPlayerManager={() => setPage('player-manager')}
            onOpenNpcManager={() => setPage('npc-manager')}
            onOpenFactionManager={() => setPage('faction-manager')}
            onOpenTerritoryManager={() => setPage('territory-manager')}
            onOpenTeamManager={() => setPage('team-manager')}
            onOpenCosmosManager={() => setPage('cosmos-manager')}
            onOpenMemoryManager={() => setPage('memory-manager')}
            onOpenMiscManager={() => setPage('misc-manager')}
            onOpenDiceManager={() => setPage('dice-manager')}
            onOpenCombatManager={() => setPage('combat-manager')}
            onOpenArenaManager={() => setPage('arena-manager')}
            onOpenEnhanceManager={() => setPage('enhance-manager')}
            onOpenJoyManager={() => setPage('joy-manager')}
            onOpenChannelManager={() => setPage('channel-manager')}
            onOpenNovelVecManager={() => setPage('novelvec-manager')}
            onOpenWorldCodexManager={() => setPage('codex-manager')}
          />
        </div>
      </div>
    );
  }

  if (page === 'item-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">物品管理</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <ItemManager />
        </div>
      </div>
    );
  }

  if (page === 'player-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">主角演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <PlayerManager />
        </div>
      </div>
    );
  }

  if (page === 'npc-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">NPC 演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <NpcManager />
        </div>
      </div>
    );
  }

  if (page === 'faction-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">势力演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <FactionManager />
        </div>
      </div>
    );
  }

  if (page === 'territory-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">领地演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <TerritoryManager />
        </div>
      </div>
    );
  }

  if (page === 'team-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">冒险团演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <AdventureTeamManager />
        </div>
      </div>
    );
  }

  if (page === 'cosmos-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">万族演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <CosmosManager />
        </div>
      </div>
    );
  }

  if (page === 'codex-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">世界百科</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <WorldCodexManager />
        </div>
      </div>
    );
  }

  if (page === 'memory-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">生平压缩</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <MemoryManager />
        </div>
      </div>
    );
  }

  if (page === 'misc-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">杂项演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <MiscManager />
        </div>
      </div>
    );
  }

  if (page === 'dice-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">ROLL 点设置</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <DiceManager />
        </div>
      </div>
    );
  }

  if (page === 'combat-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">战斗系统</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <CombatManager />
        </div>
      </div>
    );
  }

  if (page === 'arena-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">竞技场</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <ArenaManager />
        </div>
      </div>
    );
  }

  if (page === 'enhance-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">装备强化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <EnhanceManager />
        </div>
      </div>
    );
  }

  if (page === 'joy-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">欢愉宫</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <JoyManager />
        </div>
      </div>
    );
  }

  if (page === 'channel-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">公共频道</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <ChannelManager />
        </div>
      </div>
    );
  }

  if (page === 'novelvec-manager') {
    return (
      <div className="h-screen flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">向量资料库</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <NovelVecManager />
        </div>
      </div>
    );
  }

  if (page === 'world-detail') {
    return (
      <DetailLayout
        title="世界选择"
        onBack={() => { setPage('home'); setTab('worldbook'); }}
        tabs={[
          { key: 'worldbook', label: '世界书',  icon: '📚' },
          { key: 'api',       label: 'API 配置', icon: '⚡' },
          { key: 'prompt',    label: '提示词',   icon: '📝' },
        ]}
        activeTab={tab}
        onTab={setTab}
      >
        {tab === 'worldbook' && <WorldSection />}
        {tab === 'api'       && <ApiSection />}
        {tab === 'prompt'    && <PromptSection />}
      </DetailLayout>
    );
  }

  if (page === 'regex-detail') {
    return (
      <DetailLayout
        title="正则"
        onBack={() => { setPage('home'); setTab('global-regex'); }}
        tabs={[
          { key: 'global-regex', label: '全局正则', icon: '🌐' },
          { key: 'preset-regex', label: '预设正则', icon: '📌' },
        ]}
        activeTab={tab}
        onTab={setTab}
      >
        {tab === 'global-regex' && <GlobalRegexSection />}
        {tab === 'preset-regex' && <PresetRegexSection />}
      </DetailLayout>
    );
  }

  if (page === 'textgen-detail') {
    return (
      <DetailLayout
        title="正文生成"
        onBack={() => { setPage('home'); setTab('worldbook'); }}
        tabs={[
          { key: 'worldbook', label: '世界书',  icon: '📚' },
          { key: 'api',       label: 'API 配置', icon: '⚡' },
          { key: 'preset',    label: '预设',     icon: '🗂' },
        ]}
        activeTab={tab}
        onTab={setTab}
      >
        {tab === 'worldbook' && <TextWorldSection />}
        {tab === 'api'       && <TextApiSection />}
        {tab === 'preset'    && <TextPresetSection />}
      </DetailLayout>
    );
  }

  // 设置主页
  return (
    <div className="h-screen flex flex-col bg-void text-slate-300">
      <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
        <button onClick={onClose} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
          ← 返回主界面
        </button>
        <span className="text-sm font-mono text-dim">系统设置</span>
        <div className="w-20" />
      </header>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-md mx-auto space-y-3 pt-8">
          <SettingsMenuItem icon="⚙️" title="综合设置"  desc="历史楼层限制、全局显示与行为偏好"  onClick={() => setPage('general')} />
          <SettingsMenuItem icon="🌍" title="世界选择"  desc="配置 API、提示词与世界书"        onClick={() => { setPage('world-detail');  setTab('worldbook'); }} />
          <SettingsMenuItem icon="📖" title="正文生成"  desc="配置正文 API、世界书与生成预设"  onClick={() => { setPage('textgen-detail'); setTab('worldbook'); }} />
          <SettingsMenuItem icon="🔤" title="正则"      desc="全局正则与预设绑定正则脚本"      onClick={() => { setPage('regex-detail');  setTab('global-regex'); }} />
          <SettingsMenuItem icon="📈" title="变量管理"  desc="自定义 AI 可读写的游戏变量，配置 &lt;state&gt; 更新系统" onClick={() => setPage('variables')} />
          <SettingsMenuItem icon="🧠" title="叙事记忆"  desc="关键词召回长期剧情记忆，按相关性注入正文（无需向量）" onClick={() => setPage('narrative-memory')} />
          <SettingsMenuItem icon="🧭" title="向量记忆"  desc="语义向量召回长期记忆（更快·需 embedding 接口）；开启后接管召回" onClick={() => setPage('vector-memory')} />
          <SettingsMenuItem icon="🖼" title="生图设置"  desc="NAI/OpenAI/Gemini/ComfyUI 多服务 · 肖像/装备/正文配图" onClick={() => setPage('image-gen')} />
          <SettingsMenuItem icon="🎨" title="界面外观"  desc="主题、字体与显示偏好"            onClick={() => {}} disabled />
          <SettingsMenuItem icon="🔊" title="音效设置"  desc="背景音乐与音效音量"              onClick={() => {}} disabled />
          <SettingsMenuItem icon="💾" title="存档管理"  desc="导出、导入与重置游戏数据"        onClick={onOpenSaveLoad} />
        </div>
      </div>
    </div>
  );
}

function SettingsMenuItem({
  icon, title, desc, onClick, disabled,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-4 px-5 py-4 rounded-lg border text-left transition-colors
        ${disabled
          ? 'border-edge/30 text-dim/40 cursor-not-allowed'
          : 'border-edge bg-panel hover:bg-panel2 hover:border-god/40 group'
        }`}
    >
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <div className={`text-sm font-semibold ${disabled ? 'text-dim/40' : 'text-slate-200 group-hover:text-god transition-colors'}`}>
          {title}
          {disabled && <span className="ml-2 text-[12px] font-mono text-dim/40">即将开放</span>}
        </div>
        <div className="text-sm text-dim mt-0.5">{desc}</div>
      </div>
      {!disabled && <span className="text-dim group-hover:text-god transition-colors text-sm">›</span>}
    </button>
  );
}

/* ─── 选择世界 ─── */
function WorldSection() {
  const worldBooks = useSettings((s) => s.worldBooks);
  const importWorldBook = useSettings((s) => s.importWorldBook);
  const toggleWorldBook = useSettings((s) => s.toggleWorldBook);
  const removeWorldBook = useSettings((s) => s.removeWorldBook);

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name.replace(/\.json$/i, '');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      const result = importWorldBook(raw, fileName);
      setMsg(result.message);
      setTimeout(() => setMsg(''), 4000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="世界书" desc="兼容 SillyTavern 世界书 JSON 格式，支持导入与编辑" />

      <div className="flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono"
        >
          + 导入世界书 (.json)
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
        {msg && (
          <span className={`text-sm font-mono ${msg.includes('失败') ? 'text-blood' : 'text-god'}`}>
            {msg}
          </span>
        )}
      </div>

      {worldBooks.length === 0 ? (
        <div className="text-dim text-sm font-mono py-8 text-center border border-dashed border-edge rounded-lg">
          暂无世界书，导入 JSON 文件后在此显示
        </div>
      ) : (
        <div className="space-y-3">
          {worldBooks.map((book) => (
            <WorldBookCard
              key={book.id}
              book={book}
              expanded={expanded === book.id}
              onToggleExpand={() => setExpanded(expanded === book.id ? null : book.id)}
              onToggleBook={() => toggleWorldBook(book.id)}
              onRemove={() => removeWorldBook(book.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const POSITION_LABELS: Record<number, string> = {
  0: '角色前', 1: '角色后', 2: '注释上', 3: '注释下', 4: '主提示前', 5: '主提示后',
};
const POSITION_OPTIONS = Object.entries(POSITION_LABELS);

function EntryLamp({ constant, selective, enabled }: { constant: boolean; selective: boolean; enabled: boolean }) {
  if (!enabled) return <span className="w-2 h-2 rounded-full bg-dim/30 shrink-0 mt-1.5" title="已禁用" />;
  if (constant)  return <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 mt-1.5 shadow-[0_0_4px_#38bdf8]" title="蓝灯：常驻，始终插入" />;
  if (selective) return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-1.5 shadow-[0_0_4px_#34d399]" title="绿灯：关键词触发" />;
  return <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0 mt-1.5" title="普通：关键词触发" />;
}

// 导出世界书为 SillyTavern 兼容 JSON（entries 为数字键对象，可被本应用或酒馆再导入）
function downloadWorldBook(book: { name: string; entries: any[] }) {
  const entries: Record<string, any> = {};
  book.entries.forEach((e, i) => {
    entries[i] = {
      uid: e.uid ?? i, key: e.key ?? [], keysecondary: e.keysecondary ?? [],
      comment: e.comment ?? '', content: e.content ?? '',
      constant: !!e.constant, selective: !!e.selective, disable: e.enabled === false,
      order: e.order ?? 100, position: e.position ?? 0,
    };
  });
  const blob = new Blob([JSON.stringify({ name: book.name, entries }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(book.name || '世界书').replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WorldBookCard({ book, expanded, onToggleExpand, onToggleBook, onRemove, bookIdPrefix = 'wb' }: {
  book: WorldBook;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleBook: () => void;
  onRemove: () => void;
  bookIdPrefix?: string;
}) {
  const isText = bookIdPrefix === 'twb';
  const renameWorldBook    = useSettings((s) => isText ? s.renameTextWorldBook    : s.renameWorldBook);
  const toggleEntry        = useSettings((s) => isText ? s.toggleTextWorldBookEntry  : s.toggleWorldBookEntry);
  const updateEntry        = useSettings((s) => isText ? s.updateTextWorldBookEntry  : s.updateWorldBookEntry);
  const addEntry           = useSettings((s) => isText ? s.addTextWorldBookEntry     : s.addWorldBookEntry);
  const removeEntry        = useSettings((s) => isText ? s.removeTextWorldBookEntry  : s.removeWorldBookEntry);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(book.name);
  const [editingUid, setEditingUid] = useState<number | null>(null);
  const [wbPage, setWbPage] = useState(0);
  const [searchQ, setSearchQ] = useState('');

  const enabledCount = book.entries.filter((e) => e.enabled).length;
  const sorted = [...book.entries].sort((a, b) => a.order - b.order);
  const filtered = searchQ.trim()
    ? sorted.filter((e) => {
        const q = searchQ.toLowerCase();
        return (
          e.comment.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.key.some((k) => k.toLowerCase().includes(q)) ||
          e.keysecondary.some((k) => k.toLowerCase().includes(q))
        );
      })
    : sorted;
  const pagedSorted = filtered.slice(wbPage * PAGE_SIZE, (wbPage + 1) * PAGE_SIZE);

  function commitName() {
    if (nameVal.trim()) renameWorldBook(book.id, nameVal.trim());
    else setNameVal(book.name);
    setEditingName(false);
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${book.enabled ? 'border-edge' : 'border-edge/40 opacity-60'}`}>
      {/* 书头 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-panel">
        <Toggle checked={book.enabled} onChange={onToggleBook} />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameVal(book.name); setEditingName(false); } }}
              className="input-base py-0.5 text-sm font-semibold"
            />
          ) : (
            <button className="text-left group" onClick={() => setEditingName(true)} title="点击重命名">
              <div className="text-sm font-semibold text-slate-200 group-hover:text-god transition-colors">
                {book.name} <span className="text-dim/40 text-[12px]">✎</span>
              </div>
              <div className="text-sm text-dim font-mono mt-0.5">{enabledCount} / {book.entries.length} 条启用</div>
            </button>
          )}
        </div>
        <button onClick={onToggleExpand} className="text-dim hover:text-slate-200 text-sm font-mono px-2">
          {expanded ? '收起 ∧' : '展开 ∨'}
        </button>
        <button onClick={() => downloadWorldBook(book)} className="text-dim hover:text-god text-sm px-2 transition-colors" title="导出为 JSON（可再导入）">导出</button>
        <button onClick={onRemove} className="text-blood/60 hover:text-blood text-sm px-2 transition-colors">删除</button>
      </div>

      {/* 条目列表 */}
      {expanded && (
        <div className="border-t border-edge">
          {/* 工具栏 */}
          <div className="flex items-center gap-3 px-3 py-1.5 bg-void/60 text-[12px] font-mono text-dim border-b border-edge/50">
            <span className="flex items-center gap-1.5 shrink-0"><span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />蓝</span>
            <span className="flex items-center gap-1.5 shrink-0"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />绿</span>
            <span className="flex items-center gap-1.5 shrink-0"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />普</span>
            {/* 搜索框 */}
            <div className="flex-1 flex items-center gap-1 bg-void border border-edge/60 rounded px-2 py-0.5 focus-within:border-god/40">
              <span className="text-dim/50">🔍</span>
              <input
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setWbPage(0); setEditingUid(null); }}
                placeholder="搜索标题 / 内容 / 关键词…"
                className="flex-1 bg-transparent text-[13px] text-slate-300 outline-none placeholder:text-dim/40 font-mono"
              />
              {searchQ && (
                <button onClick={() => { setSearchQ(''); setWbPage(0); }} className="text-dim/50 hover:text-blood text-[12px]">✕</button>
              )}
            </div>
            <button
              onClick={() => { addEntry(book.id); }}
              className="shrink-0 text-god hover:text-god/80 font-mono text-[13px] border border-god/30 px-2 py-0.5 rounded hover:bg-god/10 transition-colors"
            >
              + 新建
            </button>
          </div>

          {sorted.length === 0 && <div className="px-4 py-3 text-sm text-dim">无条目</div>}
          {sorted.length > 0 && filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-dim">无匹配条目</div>
          )}

          <div className="divide-y divide-edge/50">
            {pagedSorted.map((entry) => (
              <div key={entry.uid}>
                {/* 条目行 */}
                <div className={`flex items-start gap-2.5 px-3 py-2 bg-panel2 ${!entry.enabled ? 'opacity-50' : ''}`}>
                  <EntryLamp constant={entry.constant} selective={entry.selective} enabled={entry.enabled} />
                  <Toggle checked={entry.enabled} onChange={() => toggleEntry(book.id, entry.uid)} small />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-300 truncate flex-1">{entry.comment || '(无标题)'}</span>
                      <span className="text-[12px] font-mono text-dim shrink-0">#{entry.order}</span>
                      <span className="text-[12px] font-mono text-dim/60 shrink-0">{POSITION_LABELS[entry.position] ?? `pos${entry.position}`}</span>
                    </div>
                    {entry.key.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {entry.key.map((k, i) => (
                          <span key={i} className="text-[12px] font-mono px-1.5 py-0.5 bg-god/10 text-god/80 rounded border border-god/20">{k}</span>
                        ))}
                        {entry.selective && entry.keysecondary.map((k, i) => (
                          <span key={`s${i}`} className="text-[12px] font-mono px-1.5 py-0.5 bg-sky-900/30 text-sky-400/80 rounded border border-sky-700/30">{k}</span>
                        ))}
                      </div>
                    )}
                    {editingUid !== entry.uid && (
                      <div className="text-[13px] text-dim mt-1 line-clamp-2 leading-relaxed">{entry.content}</div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setEditingUid(editingUid === entry.uid ? null : entry.uid)}
                      className={`text-[12px] px-2 py-0.5 rounded border transition-colors font-mono ${editingUid === entry.uid ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'}`}
                    >
                      {editingUid === entry.uid ? '收起' : '编辑'}
                    </button>
                    <button
                      onClick={() => removeEntry(book.id, entry.uid)}
                      className="text-[12px] px-2 py-0.5 rounded border border-edge text-dim hover:border-blood/40 hover:text-blood transition-colors font-mono"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* 内联编辑面板 */}
                {editingUid === entry.uid && (
                  <EntryEditor
                    entry={entry}
                    onChange={(patch) => updateEntry(book.id, entry.uid, patch)}
                    onClose={() => setEditingUid(null)}
                  />
                )}
              </div>
            ))}
          </div>
          <Pagination page={wbPage} total={filtered.length} onChange={(p) => { setWbPage(p); setEditingUid(null); }} />
        </div>
      )}
    </div>
  );
}

function TagInput({ values, onChange, placeholder, color = 'god' }: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  color?: 'god' | 'sky';
}) {
  const [input, setInput] = useState('');
  const colorCls = color === 'sky'
    ? 'bg-sky-900/30 text-sky-400/80 border-sky-700/30'
    : 'bg-god/10 text-god/80 border-god/20';

  function add() {
    const val = input.trim();
    if (val && !values.includes(val)) onChange([...values, val]);
    setInput('');
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {values.map((v, i) => (
          <span key={i} className={`flex items-center gap-1 text-[13px] font-mono px-1.5 py-0.5 rounded border ${colorCls}`}>
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? '输入后按 Enter 添加'}
          className="input-base text-sm py-1.5 flex-1"
        />
        <button onClick={add} className="px-2 py-1 text-sm border border-edge rounded text-dim hover:text-god hover:border-god/40 transition-colors">+</button>
      </div>
    </div>
  );
}

function EntryEditor({ entry, onChange, onClose }: {
  entry: WorldBookEntry;
  onChange: (patch: Partial<WorldBookEntry>) => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-void border-t border-b border-god/20 px-4 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* 标题 */}
        <div className="col-span-2 space-y-1">
          <label className="text-[12px] font-mono text-dim">条目标题（备注）</label>
          <input
            value={entry.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            className="input-base text-sm"
          />
        </div>

        {/* 主关键词 */}
        <div className="col-span-2 space-y-1">
          <label className="text-[12px] font-mono text-dim">主关键词（触发词，Enter 或逗号分隔）</label>
          <TagInput values={entry.key} onChange={(v) => onChange({ key: v })} color="god" />
        </div>

        {/* 二级关键词 */}
        {entry.selective && (
          <div className="col-span-2 space-y-1">
            <label className="text-[12px] font-mono text-emerald-400/80">二级关键词（绿灯触发的附加条件）</label>
            <TagInput values={entry.keysecondary} onChange={(v) => onChange({ keysecondary: v })} color="sky" placeholder="输入后按 Enter 添加" />
          </div>
        )}

        {/* 排序 */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">排序权重（数字越小越靠前）</label>
          <input
            type="number"
            value={entry.order}
            onChange={(e) => onChange({ order: parseInt(e.target.value) || 0 })}
            className="input-base"
          />
        </div>

        {/* 插入位置 */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">插入位置</label>
          <select
            value={entry.position}
            onChange={(e) => onChange({ position: parseInt(e.target.value) })}
            className="input-base"
          >
            {POSITION_OPTIONS.map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        {/* 灯状态 */}
        <div className="col-span-2 flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Toggle checked={entry.constant} onChange={() => onChange({ constant: !entry.constant })} />
            <span className="text-sm text-slate-300">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block mr-1" />
              蓝灯 · 常驻，始终插入
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Toggle checked={entry.selective} onChange={() => onChange({ selective: !entry.selective })} />
            <span className="text-sm text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1" />
              绿灯 · 关键词触发
            </span>
          </label>
        </div>
      </div>

      {/* 内容编辑 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-mono text-dim">内容</label>
          <span className="text-[12px] font-mono text-dim/60">{entry.content.length} 字符</span>
        </div>
        <textarea
          value={entry.content}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={8}
          className="w-full bg-panel border border-edge rounded-lg p-3 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:border-god outline-none"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm border border-god/40 text-god rounded hover:bg-god/10 transition-colors font-mono"
        >
          完成
        </button>
      </div>
    </div>
  );
}

/* ─── API 配置 ─── */
function ApiSection() {
  const api = useSettings((s) => s.api);
  const setApi = useSettings((s) => s.setApi);
  const availableModels = useSettings((s) => s.availableModels);
  const modelsLoading = useSettings((s) => s.modelsLoading);
  const modelsError = useSettings((s) => s.modelsError);
  const fetchModels = useSettings((s) => s.fetchModels);

  return (
    <div className="space-y-6 max-w-xl">
      <SectionTitle title="API 配置" desc="配置用于世界运行的语言模型接口" />

      <ApiRoutePicker routeKey="world" />
      <div className="space-y-4">
        <Field label="API 地址">
          <input
            type="text"
            value={api.baseUrl}
            onChange={(e) => setApi({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="input-base"
          />
        </Field>

        <Field label="API Key">
          <input
            type="password"
            value={api.apiKey}
            onChange={(e) => setApi({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="input-base font-mono"
          />
        </Field>

        <Field label="模型">
          <div className="flex gap-2">
            {availableModels.length > 0 ? (
              <select
                value={api.modelId}
                onChange={(e) => setApi({ modelId: e.target.value })}
                className="input-base flex-1"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={api.modelId}
                onChange={(e) => setApi({ modelId: e.target.value })}
                placeholder="gpt-4o"
                className="input-base flex-1 font-mono"
              />
            )}
            <button
              onClick={fetchModels}
              disabled={modelsLoading}
              className="shrink-0 px-3 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 disabled:opacity-40 font-mono transition-colors"
            >
              {modelsLoading ? '获取中…' : '刷新模型'}
            </button>
          </div>
          {modelsError && (
            <div className="text-sm text-blood mt-1 font-mono">{modelsError}</div>
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={`温度 (${api.temperature})`}>
            <input
              type="range"
              min={0} max={2} step={0.05}
              value={api.temperature}
              onChange={(e) => setApi({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-god mt-1"
            />
          </Field>
          <Field label={`Top-P (${api.topP})`}>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={api.topP}
              onChange={(e) => setApi({ topP: parseFloat(e.target.value) })}
              className="w-full accent-god mt-1"
            />
          </Field>
          <Field label="Max Tokens">
            <input
              type="number"
              value={api.maxTokens}
              onChange={(e) => setApi({ maxTokens: parseInt(e.target.value) || 512 })}
              min={128} max={16384} step={128}
              className="input-base"
            />
          </Field>
        </div>
      </div>

      {/* 测试连接预览 */}
      <div className="border border-edge rounded-lg p-3 bg-panel text-sm font-mono text-dim space-y-1">
        <div><span className="text-god/60">URL ·</span> {api.baseUrl || '—'}</div>
        <div><span className="text-god/60">MODEL ·</span> {api.modelId || '—'}</div>
        <div><span className="text-god/60">TEMP ·</span> {api.temperature} &nbsp; <span className="text-god/60">TOP-P ·</span> {api.topP} &nbsp; <span className="text-god/60">MAX ·</span> {api.maxTokens}</div>
      </div>
    </div>
  );
}

/* ─── 提示词 ─── */
function PromptSection() {
  const systemPrompt = useSettings((s) => s.systemPrompt);
  const setSystemPrompt = useSettings((s) => s.setSystemPrompt);
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <SectionTitle title="系统提示词" desc="发送给 API 的 system prompt，用于设定世界规则和 AI 行为" />

      <div className="space-y-3">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={`你是一个沉浸式文字RPG的游戏主持人（GM）。\n\n世界背景：...\n\n规则：\n- 每次回复控制在200字以内\n- 根据玩家行动推进剧情\n- 保持世界观一致性`}
          rows={18}
          className="w-full bg-panel border border-edge rounded-lg p-4 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:border-god outline-none placeholder:text-dim/40"
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-dim font-mono">
            {systemPrompt.length} 字符
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSystemPrompt('')}
              className="px-3 py-1.5 text-sm border border-edge text-dim rounded hover:border-blood/40 hover:text-blood transition-colors"
            >
              清空
            </button>
            <button
              onClick={save}
              className="px-4 py-1.5 text-sm border border-god/40 text-god rounded hover:bg-god/10 transition-colors font-mono"
            >
              {saved ? '✓ 已保存' : '保存'}
            </button>
          </div>
        </div>
      </div>

      <div className="border border-edge/50 rounded-lg p-3 bg-panel text-sm text-dim space-y-1 leading-relaxed">
        <div className="text-god/60 font-mono mb-1">可用变量（将在运行时替换）</div>
        <div><code className="text-god/80">{'{{char_name}}'}</code> — 角色名称</div>
        <div><code className="text-god/80">{'{{world_info}}'}</code> — 激活的世界书条目</div>
        <div><code className="text-god/80">{'{{player_stats}}'}</code> — 当前角色属性</div>
      </div>
    </div>
  );
}

/* ─── 通用组件 ─── */

const PAGE_SIZE = 15;

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-edge/50 bg-void/40 text-[13px] font-mono text-dim">
      <button
        onClick={() => onChange(page - 1)} disabled={page === 0}
        className="px-2 py-0.5 rounded border border-edge hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
      >← 上一页</button>
      <span className="text-dim/70">
        {page + 1} / {pages}
        <span className="ml-2 text-dim/40">共 {total} 条</span>
      </span>
      <button
        onClick={() => onChange(page + 1)} disabled={page >= pages - 1}
        className="px-2 py-0.5 rounded border border-edge hover:border-god/40 hover:text-god disabled:opacity-30 transition-colors"
      >下一页 →</button>
    </div>
  );
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-b border-edge pb-3">
      <h2 className="text-base font-bold text-slate-100">{title}</h2>
      <p className="text-sm text-dim mt-0.5">{desc}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-dim font-mono">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, small }: { checked: boolean; onChange: () => void; small?: boolean }) {
  return (
    <button
      onClick={onChange}
      className={`shrink-0 rounded-full border transition-colors ${
        small ? 'w-7 h-4' : 'w-9 h-5'
      } ${checked ? 'bg-god/30 border-god/50' : 'bg-void border-edge'}`}
    >
      <div
        className={`rounded-full bg-white transition-all ${
          small
            ? `w-2.5 h-2.5 mx-0.5 ${checked ? 'translate-x-3' : ''}`
            : `w-3 h-3 mx-1 ${checked ? 'translate-x-4' : ''}`
        }`}
        style={{ transform: checked ? `translateX(${small ? '12px' : '16px'})` : 'none' }}
      />
    </button>
  );
}

/* ════════════════════════════════════════════
   正文生成 — 世界书
════════════════════════════════════════════ */
function TextWorldSection() {
  const textWorldBooks      = useSettings((s) => s.textWorldBooks);
  const importTextWorldBook = useSettings((s) => s.importTextWorldBook);
  const toggleTextWorldBook = useSettings((s) => s.toggleTextWorldBook);
  const removeTextWorldBook = useSettings((s) => s.removeTextWorldBook);

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg]         = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fileName = file.name.replace(/\.json$/i, '');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importTextWorldBook(ev.target?.result as string, fileName);
      setMsg(result.message);
      setTimeout(() => setMsg(''), 4000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="正文世界书" desc="兼容 SillyTavern 世界书 JSON，独立于世界选择模块" />
      <div className="flex items-center gap-3">
        <button onClick={() => fileRef.current?.click()} className="px-4 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono">
          + 导入世界书 (.json)
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
        {msg && <span className={`text-sm font-mono ${msg.includes('失败') ? 'text-blood' : 'text-god'}`}>{msg}</span>}
      </div>
      {textWorldBooks.length === 0 ? (
        <div className="text-dim text-sm font-mono py-8 text-center border border-dashed border-edge rounded-lg">暂无世界书，导入 JSON 文件后在此显示</div>
      ) : (
        <div className="space-y-3">
          {textWorldBooks.map((book) => (
            <WorldBookCard
              key={book.id}
              book={book}
              expanded={expanded === book.id}
              onToggleExpand={() => setExpanded(expanded === book.id ? null : book.id)}
              onToggleBook={() => toggleTextWorldBook(book.id)}
              onRemove={() => removeTextWorldBook(book.id)}
              bookIdPrefix="twb"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   正文生成 — API 配置
════════════════════════════════════════════ */
function TextApiSection() {
  const api                = useSettings((s) => s.api);
  const textApi            = useSettings((s) => s.textApi);
  const textUseSharedApi   = useSettings((s) => s.textUseSharedApi);
  const textStream         = useSettings((s) => s.textStream);
  const textAvailableModels= useSettings((s) => s.textAvailableModels);
  const textModelsLoading  = useSettings((s) => s.textModelsLoading);
  const textModelsError    = useSettings((s) => s.textModelsError);
  const setTextApi         = useSettings((s) => s.setTextApi);
  const setTextUseSharedApi= useSettings((s) => s.setTextUseSharedApi);
  const setTextStream      = useSettings((s) => s.setTextStream);
  const fetchTextModels    = useSettings((s) => s.fetchTextModels);
  const plotChoices        = useSettings((s) => s.plotChoices);
  const setPlotChoices     = useSettings((s) => s.setPlotChoices);
  const fanficMode         = useSettings((s) => s.fanficMode);
  const setFanficMode      = useSettings((s) => s.setFanficMode);
  const factCheck          = useSettings((s) => s.factCheck);
  const setFactCheck       = useSettings((s) => s.setFactCheck);

  const effective = textUseSharedApi ? api : textApi;

  return (
    <div className="space-y-6 max-w-xl">
      <SectionTitle title="正文 API 配置" desc="用于正文生成请求的语言模型接口" />

      {/* 共用开关 + 流式开关 */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={textUseSharedApi} onChange={() => setTextUseSharedApi(!textUseSharedApi)} />
          <div>
            <div className="text-sm text-slate-200">与世界选择共用 API</div>
            <div className="text-sm text-dim mt-0.5">开启时直接复用世界选择的 API 地址、Key 和模型</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={textStream} onChange={() => setTextStream(!textStream)} />
          <div>
            <div className="text-sm text-slate-200">流式输出（Streaming）</div>
            <div className="text-sm text-dim mt-0.5">开启后正文逐字生成，关闭则等待完整响应后一次性显示</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={plotChoices} onChange={() => setPlotChoices(!plotChoices)} />
          <div>
            <div className="text-sm text-slate-200">剧情选项（8 选项）</div>
            <div className="text-sm text-dim mt-0.5">每段正文后额外生成 8 个「主角视角」行动选项，点击填入输入框；八个方向各异，最后 1 个为限制级(18+)。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={fanficMode} onChange={() => setFanficMode(!fanficMode)} />
          <div>
            <div className="text-sm text-slate-200">同人增强（防 OOC）</div>
            <div className="text-sm text-dim mt-0.5">识别正文里的已知作品角色 → 输出并锁定其设定/口癖 → 下回合注入正文保持一致。能否「联网搜索」取决于你的模型，否则按模型记忆回忆。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={factCheck} onChange={() => setFactCheck(!factCheck)} />
          <div>
            <div className="text-sm text-slate-200">事实增强（防穿帮）</div>
            <div className="text-sm text-dim mt-0.5">核实正文里的现实可查证元素（年代/真实地名/品牌价格/专业内容）→ 锁定时代与事实锚点 → 下回合注入正文保持一致、不穿帮。同样能否联网取决于你的模型。</div>
          </div>
        </div>
      </div>

      {(plotChoices || fanficMode || factCheck) && (
        <div className="p-3 bg-panel border border-edge rounded-lg space-y-2">
          <div className="text-sm text-slate-200">选项 / 同人 / 事实 · 共用 API 路由</div>
          <div className="text-xs text-dim">三者共用同一接口、正文生成后只调用一次。留空则复用上面的「正文 API」。</div>
          <ApiRoutePicker routeKey="plot" />
        </div>
      )}

      <ApiRoutePicker routeKey="text" />
      {!textUseSharedApi && (
        <div className="space-y-4">
          <Field label="API 地址">
            <input type="text" value={textApi.baseUrl} onChange={(e) => setTextApi({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className="input-base" />
          </Field>
          <Field label="API Key">
            <input type="password" value={textApi.apiKey} onChange={(e) => setTextApi({ apiKey: e.target.value })} placeholder="sk-..." className="input-base font-mono" />
          </Field>
          <Field label="模型">
            <div className="flex gap-2">
              {textAvailableModels.length > 0 ? (
                <select value={textApi.modelId} onChange={(e) => setTextApi({ modelId: e.target.value })} className="input-base flex-1">
                  {textAvailableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input type="text" value={textApi.modelId} onChange={(e) => setTextApi({ modelId: e.target.value })} placeholder="gpt-4o" className="input-base flex-1 font-mono" />
              )}
              <button onClick={fetchTextModels} disabled={textModelsLoading} className="shrink-0 px-3 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 disabled:opacity-40 font-mono transition-colors">
                {textModelsLoading ? '获取中…' : '刷新模型'}
              </button>
            </div>
            {textModelsError && <div className="text-sm text-blood mt-1 font-mono">{textModelsError}</div>}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={`温度 (${textApi.temperature})`}>
              <input type="range" min={0} max={2} step={0.05} value={textApi.temperature} onChange={(e) => setTextApi({ temperature: parseFloat(e.target.value) })} className="w-full accent-god mt-1" />
            </Field>
            <Field label={`Top-P (${textApi.topP})`}>
              <input type="range" min={0} max={1} step={0.05} value={textApi.topP} onChange={(e) => setTextApi({ topP: parseFloat(e.target.value) })} className="w-full accent-god mt-1" />
            </Field>
            <Field label="Max Tokens">
              <input type="number" value={textApi.maxTokens} onChange={(e) => setTextApi({ maxTokens: parseInt(e.target.value) || 512 })} min={128} max={16384} step={128} className="input-base" />
            </Field>
          </div>
        </div>
      )}

      <div className="border border-edge rounded-lg p-3 bg-panel text-sm font-mono text-dim space-y-1">
        <div><span className="text-god/60">URL ·</span> {effective.baseUrl || '—'}</div>
        <div><span className="text-god/60">MODEL ·</span> {effective.modelId || '—'}</div>
        <div><span className="text-god/60">TEMP ·</span> {effective.temperature} &nbsp;<span className="text-god/60">TOP-P ·</span> {effective.topP} &nbsp;<span className="text-god/60">MAX ·</span> {effective.maxTokens}</div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   正文生成 — 预设（SillyTavern 风格 JSON）
════════════════════════════════════════════ */
function TextPresetSection() {
  const presets            = useSettings((s) => s.textPresets);
  const activeId           = useSettings((s) => s.activeTextPresetId);
  const importTextPreset   = useSettings((s) => s.importTextPreset);
  const removeTextPreset   = useSettings((s) => s.removeTextPreset);
  const setActiveTextPreset= useSettings((s) => s.setActiveTextPreset);

  const [msg, setMsg]       = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fileName = file.name.replace(/\.json$/i, '');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importTextPreset(ev.target?.result as string, fileName);
      setMsg(result.message);
      setTimeout(() => setMsg(''), 3000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="正文预设" desc="SillyTavern 风格角色卡 / 生成配置，支持导入多个预设" />

      <div className="flex items-center gap-3">
        <button onClick={() => importRef.current?.click()} className="px-4 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono">
          + 导入预设 (.json)
        </button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        {msg && <span className={`text-sm font-mono ${msg.includes('失败') ? 'text-blood' : 'text-god'}`}>{msg}</span>}
      </div>

      {presets.length === 0 ? (
        <div className="text-dim text-sm font-mono py-8 text-center border border-dashed border-edge rounded-lg">
          暂无预设，导入 JSON 文件后在此显示
        </div>
      ) : (
        <div className="space-y-3">
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              active={activeId === p.id}
              expanded={expanded === p.id}
              onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)}
              onActivate={() => setActiveTextPreset(activeId === p.id ? null : p.id)}
              onRemove={() => removeTextPreset(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetCard({ preset, active, expanded, onToggleExpand, onActivate, onRemove }: {
  preset: TextGenPreset;
  active: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onActivate: () => void;
  onRemove: () => void;
}) {
  const toggleEntry      = useSettings((s) => s.toggleTextPresetEntry);
  const updateEntry      = useSettings((s) => s.updateTextPresetEntry);
  const addEntry         = useSettings((s) => s.addTextPresetEntry);
  const removeEntry      = useSettings((s) => s.removeTextPresetEntry);
  const moveEntry        = useSettings((s) => s.moveTextPresetEntry);
  const renamePreset     = useSettings((s) => s.renameTextPreset);
  const updatePreset     = useSettings((s) => s.updateTextPreset);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal]         = useState(preset.name);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [pPage, setPPage]             = useState(0);

  const entries = preset.entries ?? [];
  const pagedEntries = entries.slice(pPage * PAGE_SIZE, (pPage + 1) * PAGE_SIZE);
  const tokenCount = (s: string) => Math.round(s.length / 3.5);

  function commitName() {
    if (nameVal.trim()) renamePreset(preset.id, nameVal.trim());
    else setNameVal(preset.name);
    setEditingName(false);
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${preset.name || 'preset'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${active ? 'border-god/50' : 'border-edge'}`}>

      {/* ── 预设头部 ── */}
      <div className={`flex items-center gap-3 px-4 py-3 ${active ? 'bg-god/5' : 'bg-panel'}`}>
        <button onClick={onActivate} title={active ? '点击关闭（停用此预设，恢复内置默认）' : '点击启用此预设（会自动停用其它预设）'}
          className={`shrink-0 px-2.5 py-1 rounded text-[12px] font-mono border transition-colors ${active ? 'bg-god/15 border-god/50 text-god' : 'border-dim/40 text-dim hover:border-god/50 hover:text-god'}`}
        >
          {active ? '✓ 启用中' : '启用'}
        </button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input autoFocus value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameVal(preset.name); setEditingName(false); } }}
              className="input-base py-0.5 text-sm font-semibold w-full"
            />
          ) : (
            <button className="text-left group w-full" onClick={() => setEditingName(true)} title="点击重命名">
              <div className="text-sm font-semibold text-slate-200 group-hover:text-god transition-colors truncate">
                {preset.name} <span className="text-dim/40 text-[12px]">✎</span>
              </div>
            </button>
          )}
          <div className="text-sm text-dim font-mono mt-0.5">
            {entries.length} 条 prompt
            {preset.temperature != null && ` · temp ${preset.temperature}`}
            {preset.top_p != null && ` · top_p ${preset.top_p}`}
          </div>
        </div>
        <button onClick={handleExport} className="text-dim hover:text-god text-sm font-mono px-2 transition-colors">导出</button>
        <button onClick={onToggleExpand} className="text-dim hover:text-slate-200 text-sm font-mono px-2">
          {expanded ? '收起 ∧' : '展开 ∨'}
        </button>
        <button onClick={onRemove} className="text-blood/60 hover:text-blood text-sm px-2 transition-colors">删除</button>
      </div>

      {/* ── 展开：ST 风格 prompt 列表 ── */}
      {expanded && (
        <div className="border-t border-edge">

          {/* 工具栏 */}
          <div className="flex items-center gap-4 px-4 py-1.5 bg-void/60 border-b border-edge/50 text-[12px] font-mono text-dim">
            <span className="flex-1">名称</span>
            <span className="w-10 text-right">词符</span>
            <button
              onClick={() => { addEntry(preset.id); }}
              className="ml-2 text-god hover:text-god/80 border border-god/30 px-2 py-0.5 rounded hover:bg-god/10 transition-colors text-[13px]"
            >+ 新建</button>
          </div>

          {entries.length === 0 && (
            <div className="px-4 py-3 text-sm text-dim">无 prompt 条目，点击「新建」添加</div>
          )}

          <div className="divide-y divide-edge/30">
            {pagedEntries.map((entry, idx) => {
              const idx_real = pPage * PAGE_SIZE + idx;
              const tokens = tokenCount(entry.content);
              const isEditing = editingId === entry.identifier;
              return (
                <div key={entry.identifier}>
                  {/* 条目行 */}
                  <div className={`flex items-center gap-2 px-3 py-2 hover:bg-panel2 transition-colors ${!entry.enabled ? 'opacity-40' : ''}`}>
                    <Toggle checked={entry.enabled} onChange={() => toggleEntry(preset.id, entry.identifier)} small />
                    {/* 类型图标 */}
                    {entry.marker ? (
                      <span className="text-[12px] text-dim/60 w-3 shrink-0">▸</span>
                    ) : entry.system_prompt ? (
                      <span className="text-[12px] text-sky-400/60 w-3 shrink-0">S</span>
                    ) : (
                      <span className="text-[12px] text-god/40 w-3 shrink-0">✦</span>
                    )}
                    {/* 名称 */}
                    <span className="flex-1 text-sm text-slate-300 truncate">{entry.name}</span>
                    {/* 词符 */}
                    <span className="w-10 text-right text-[12px] font-mono text-dim shrink-0">
                      {tokens > 0 ? tokens : '—'}
                    </span>
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button onClick={() => moveEntry(preset.id, entry.identifier, -1)} disabled={idx_real === 0}
                        className="text-[12px] px-1 text-dim hover:text-god disabled:opacity-20 transition-colors">↑</button>
                      <button onClick={() => moveEntry(preset.id, entry.identifier, 1)} disabled={idx_real === entries.length - 1}
                        className="text-[12px] px-1 text-dim hover:text-god disabled:opacity-20 transition-colors">↓</button>
                      <button
                        onClick={() => setEditingId(isEditing ? null : entry.identifier)}
                        className={`text-[12px] px-2 py-0.5 rounded border transition-colors font-mono ${isEditing ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'}`}
                      >{isEditing ? '收起' : '编辑'}</button>
                      <button onClick={() => removeEntry(preset.id, entry.identifier)}
                        className="text-[12px] px-2 py-0.5 rounded border border-edge text-dim hover:border-blood/40 hover:text-blood transition-colors font-mono">删除</button>
                    </div>
                  </div>

                  {/* 内联编辑面板 */}
                  {isEditing && (
                    <PresetEntryEditor
                      entry={entry}
                      onChange={(patch) => updateEntry(preset.id, entry.identifier, patch)}
                      onClose={() => setEditingId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <Pagination page={pPage} total={entries.length} onChange={(p) => { setPPage(p); setEditingId(null); }} />

          {/* 参数行 */}
          <div className="px-4 py-3 border-t border-edge/50 bg-void/30 space-y-3">
            <span className="text-[12px] font-mono text-dim block">生成参数</span>

            {/* 滑块组 */}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {([
                { label: 'temperature',       key: 'temperature',       min: 0,  max: 2,    step: 0.01, def: 1 },
                { label: 'top_p',             key: 'top_p',             min: 0,  max: 1,    step: 0.01, def: 1 },
                { label: 'frequency_penalty', key: 'frequency_penalty', min: -2, max: 2,    step: 0.01, def: 0 },
                { label: 'presence_penalty',  key: 'presence_penalty',  min: -2, max: 2,    step: 0.01, def: 0 },
              ] as const).map(({ label, key, min, max, step, def }) => (
                <label key={key} className="flex items-center gap-2 text-[12px] font-mono text-dim">
                  <span className="w-32 shrink-0">{label}</span>
                  <input type="range" min={min} max={max} step={step}
                    value={preset[key] ?? def}
                    onChange={(e) => updatePreset(preset.id, { [key]: parseFloat(e.target.value) })}
                    className="w-24 accent-god"
                  />
                  <span className="w-10 text-right text-slate-400">{(preset[key] ?? def).toFixed(2)}</span>
                </label>
              ))}
            </div>

            {/* 数字输入组 */}
            <div className="flex flex-wrap gap-4">
              {([
                { label: '最大回复长度 (max_tokens)',  key: 'max_tokens',     min: 128,  max: 200000, step: 128,  def: 2048 },
                { label: '上下文长度 (context_length)',key: 'context_length', min: 1024, max: 200000, step: 1024, def: 4096 },
                { label: '种子 (seed, -1=随机)',        key: 'seed',           min: -1,   max: 999999, step: 1,    def: -1   },
                { label: '备选数 (n)',                  key: 'n',              min: 1,    max: 10,     step: 1,    def: 1    },
              ] as const).map(({ label, key, min, max, step, def }) => (
                <label key={key} className="flex flex-col gap-1 text-[12px] font-mono text-dim">
                  <span>{label}</span>
                  <input type="number" min={min} max={max} step={step}
                    value={preset[key] ?? def}
                    onChange={(e) => updatePreset(preset.id, { [key]: parseInt(e.target.value) })}
                    className="input-base w-28 py-0.5 text-sm"
                  />
                </label>
              ))}
            </div>

            {/* 布尔开关 */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Toggle
                checked={preset.stream ?? true}
                onChange={() => updatePreset(preset.id, { stream: !(preset.stream ?? true) })}
              />
              <span className="text-sm text-slate-300">流式传输（stream）</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function PresetEntryEditor({ entry, onChange, onClose }: {
  entry: STPromptEntry;
  onChange: (patch: Partial<STPromptEntry>) => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-void border-t border-b border-god/20 px-4 py-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* 名称 */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">名称</label>
          <input value={entry.name} onChange={(e) => onChange({ name: e.target.value })} className="input-base text-sm" />
        </div>
        {/* Role */}
        <div className="space-y-1">
          <label className="text-[12px] font-mono text-dim">role</label>
          <select value={entry.role} onChange={(e) => onChange({ role: e.target.value })} className="input-base text-sm">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </div>
        {/* 标志位 */}
        <div className="col-span-2 flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Toggle checked={entry.system_prompt} onChange={() => onChange({ system_prompt: !entry.system_prompt })} />
            <span className="text-sm text-slate-300"><span className="text-sky-400/80 mr-1">S</span>system_prompt</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Toggle checked={entry.marker} onChange={() => onChange({ marker: !entry.marker })} />
            <span className="text-sm text-slate-300"><span className="text-dim/60 mr-1">▸</span>marker（占位符）</span>
          </label>
        </div>
      </div>
      {/* 内容 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-mono text-dim">content</label>
          <span className="text-[12px] font-mono text-dim/60">{entry.content.length} 字符 · ~{Math.round(entry.content.length / 3.5)} 词符</span>
        </div>
        <textarea
          value={entry.content}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={8}
          className="w-full bg-panel border border-edge rounded-lg p-3 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:border-god outline-none"
        />
      </div>
      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-1.5 text-sm border border-god/40 text-god rounded hover:bg-god/10 transition-colors font-mono">完成</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   正则 — 公共组件
════════════════════════════════════════════ */
const PLACEMENT_LABELS: Record<number, string> = { 0: '用户输入', 1: 'AI输出' };

function RegexScriptCard({ script, onToggle, onUpdate, onRemove, onMoveUp, onMoveDown, isFirst, isLast }: {
  script: RegexScript;
  onToggle: () => void;
  onUpdate: (patch: Partial<RegexScript>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  function togglePlacement(p: number) {
    const cur = script.placement;
    onUpdate({ placement: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${script.disabled ? 'border-edge/40 opacity-50' : 'border-edge'}`}>
      {/* 行头 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-panel">
        <Toggle checked={!script.disabled} onChange={onToggle} small />
        <span className="flex-1 text-sm text-slate-300 truncate font-mono">{script.scriptName || '(未命名)'}</span>
        {script.placement.map((p) => (
          <span key={p} className="text-[12px] font-mono px-1.5 py-0.5 border border-edge text-dim rounded">{PLACEMENT_LABELS[p] ?? p}</span>
        ))}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onMoveUp} disabled={isFirst} className="text-[12px] px-1 text-dim hover:text-god disabled:opacity-20 transition-colors">↑</button>
          <button onClick={onMoveDown} disabled={isLast} className="text-[12px] px-1 text-dim hover:text-god disabled:opacity-20 transition-colors">↓</button>
          <button onClick={() => setExpanded(!expanded)} className={`text-[12px] px-2 py-0.5 rounded border font-mono transition-colors ${expanded ? 'border-god/50 text-god bg-god/10' : 'border-edge text-dim hover:border-god/40 hover:text-god'}`}>{expanded ? '收起' : '编辑'}</button>
          <button onClick={onRemove} className="text-[12px] px-2 py-0.5 rounded border border-edge text-dim hover:border-blood/40 hover:text-blood transition-colors font-mono">删除</button>
        </div>
      </div>

      {/* 编辑面板 */}
      {expanded && (
        <div className="border-t border-edge bg-void px-4 py-4 space-y-3">
          <Field label="脚本名称">
            <input value={script.scriptName} onChange={(e) => onUpdate({ scriptName: e.target.value })} className="input-base text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="查找正则（findRegex）">
              <input value={script.findRegex} onChange={(e) => onUpdate({ findRegex: e.target.value })}
                placeholder="/pattern/" className="input-base text-sm font-mono" />
            </Field>
            <Field label={`标志位（flags）`}>
              <input value={script.flags} onChange={(e) => onUpdate({ flags: e.target.value })}
                placeholder="g / gi / gim" className="input-base text-sm font-mono" />
            </Field>
          </div>
          <Field label="替换内容（replaceString，$1 $2 引用捕获组）">
            <textarea value={script.replaceString} onChange={(e) => onUpdate({ replaceString: e.target.value })}
              rows={3} className="w-full bg-panel border border-edge rounded-lg p-3 text-sm text-slate-200 font-mono leading-relaxed resize-y focus:border-god outline-none" />
          </Field>
          <div className="space-y-1">
            <label className="text-[12px] font-mono text-dim">应用位置（placement）</label>
            <div className="flex gap-4">
              {([0, 1] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer select-none">
                  <Toggle checked={script.placement.includes(p)} onChange={() => togglePlacement(p)} small />
                  <span className="text-sm text-slate-300">{PLACEMENT_LABELS[p]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setExpanded(false)} className="px-4 py-1.5 text-sm border border-god/40 text-god rounded hover:bg-god/10 transition-colors font-mono">完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RegexList({ scripts, onToggle, onUpdate, onRemove, onMove, onAdd, onImport, title, desc }: {
  scripts: RegexScript[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Partial<RegexScript>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onAdd: () => void;
  onImport?: (raw: string, fileName: string) => { ok: boolean; message: string };
  title: string;
  desc: string;
}) {
  const [msg, setMsg] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!onImport) return;
      const result = onImport(ev.target?.result as string, file.name.replace(/\.json$/i, ''));
      setMsg(result.message);
      setTimeout(() => setMsg(''), 3000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  return (
    <div className="space-y-4">
      <SectionTitle title={title} desc={desc} />
      <div className="flex items-center gap-3">
        <button onClick={onAdd} className="px-4 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 transition-colors font-mono">+ 新建脚本</button>
        {onImport && (
          <>
            <button onClick={() => importRef.current?.click()} className="px-4 py-2 border border-edge text-dim text-sm rounded hover:border-god/40 hover:text-god transition-colors font-mono">导入 (.json)</button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
          </>
        )}
        {msg && <span className={`text-sm font-mono ${msg.includes('失败') ? 'text-blood' : 'text-god'}`}>{msg}</span>}
      </div>
      {scripts.length === 0 ? (
        <div className="text-dim text-sm font-mono py-8 text-center border border-dashed border-edge rounded-lg">暂无正则脚本</div>
      ) : (
        <div className="space-y-2">
          {scripts.map((s, idx) => (
            <RegexScriptCard
              key={s.id} script={s}
              onToggle={() => onToggle(s.id)}
              onUpdate={(patch) => onUpdate(s.id, patch)}
              onRemove={() => onRemove(s.id)}
              onMoveUp={() => onMove(s.id, -1)}
              onMoveDown={() => onMove(s.id, 1)}
              isFirst={idx === 0} isLast={idx === scripts.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 全局正则 ── */
function GlobalRegexSection() {
  const scripts  = useSettings((s) => s.globalRegexScripts);
  const toggle   = useSettings((s) => s.toggleGlobalRegexScript);
  const update   = useSettings((s) => s.updateGlobalRegexScript);
  const remove   = useSettings((s) => s.removeGlobalRegexScript);
  const move     = useSettings((s) => s.moveGlobalRegexScript);
  const add      = useSettings((s) => s.addGlobalRegexScript);
  const importFn = useSettings((s) => s.importGlobalRegex);
  return <RegexList scripts={scripts} onToggle={toggle} onUpdate={update} onRemove={remove} onMove={move} onAdd={add} onImport={importFn} title="全局正则" desc="对所有预设的 AI 输出生效，不区分场景" />;
}

/* ════════════════════════════════════════════
   综合设置
════════════════════════════════════════════ */
/* API 接口库：统一维护多条 LLM 接口，各功能可在其 API 设置里「快捷填入」 */
function ApiLibrarySection() {
  const library = useSettings((s) => s.apiLibrary);
  const add     = useSettings((s) => s.addApiEndpoint);
  const update  = useSettings((s) => s.updateApiEndpoint);
  const remove  = useSettings((s) => s.removeApiEndpoint);
  const move    = useSettings((s) => s.moveApiEndpoint);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});   // 每条接口的可用模型列表
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errById, setErrById] = useState<Record<string, string>>({});

  const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono text-slate-200 outline-none focus:border-god';

  async function fetchModels(ep: { id: string; baseUrl: string; apiKey: string }) {
    if (!ep.baseUrl || !ep.apiKey) { setErrById((p) => ({ ...p, [ep.id]: '请先填写地址和 Key' })); return; }
    setLoadingId(ep.id); setErrById((p) => ({ ...p, [ep.id]: '' }));
    try {
      const res = await fetch(ep.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${ep.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
      setModels((p) => ({ ...p, [ep.id]: list }));
      if (list.length === 0) setErrById((p) => ({ ...p, [ep.id]: '该接口未返回模型列表' }));
    } catch (e: any) {
      setErrById((p) => ({ ...p, [ep.id]: e.message ?? '获取失败' }));
    } finally { setLoadingId(null); }
  }

  return (
    <div className="space-y-3">
      <SectionTitle title="API 接口库" desc="统一填写并管理 LLM 接口（可多条）。各功能的 API 设置页可「⚡ 接口库快捷填入」，不必逐个手填。Key 仅存本地浏览器。" />
      <div className="border border-edge rounded-lg bg-panel divide-y divide-edge/50">
        {(library ?? []).length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-dim/40 font-mono">接口库为空，点下方「+ 添加接口」</div>
        )}
        {(library ?? []).map((ep, i) => (
          <div key={ep.id} className={`px-3 py-2.5 ${!ep.enabled ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2">
              <button onClick={() => setOpenId(openId === ep.id ? null : ep.id)} className="text-[11px] text-dim/50 hover:text-god w-4 shrink-0">{openId === ep.id ? '▾' : '▸'}</button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setOpenId(openId === ep.id ? null : ep.id)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100 truncate">{ep.name || '未命名'}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${ep.enabled ? 'border-god/40 text-god/80' : 'border-edge text-dim/40'}`}>{ep.enabled ? '已启用' : '已禁用'}</span>
                </div>
                <div className="text-[12px] font-mono text-dim/50 truncate mt-0.5">{ep.modelId || '未设模型'} · {ep.baseUrl || '未设地址'}</div>
              </div>
              <button onClick={() => update(ep.id, { enabled: !ep.enabled })} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40 transition-colors shrink-0">{ep.enabled ? '禁用' : '启用'}</button>
              <button onClick={() => move(ep.id, -1)} disabled={i === 0} className="text-dim/50 hover:text-god disabled:opacity-20 px-1 shrink-0">↑</button>
              <button onClick={() => move(ep.id, 1)} disabled={i === (library.length - 1)} className="text-dim/50 hover:text-god disabled:opacity-20 px-1 shrink-0">↓</button>
              <button
                onClick={() => { if (confirmDel === ep.id) { remove(ep.id); setConfirmDel(null); } else setConfirmDel(ep.id); }}
                onBlur={() => setConfirmDel(null)}
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded border shrink-0 transition-colors ${confirmDel === ep.id ? 'border-blood/60 text-blood' : 'border-edge text-dim/40 hover:text-blood hover:border-blood/40'}`}
              >{confirmDel === ep.id ? '确认删' : '🗑'}</button>
            </div>
            {openId === ep.id && (
              <div className="mt-2 pl-6 space-y-2">
                <label className="space-y-1 block"><span className="text-[12px] font-mono text-dim/50">名称</span><input value={ep.name} onChange={(e) => update(ep.id, { name: e.target.value })} className={inputCls} /></label>
                <label className="space-y-1 block"><span className="text-[12px] font-mono text-dim/50">接口地址</span><input value={ep.baseUrl} onChange={(e) => update(ep.id, { baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className={inputCls} /></label>
                <label className="space-y-1 block"><span className="text-[12px] font-mono text-dim/50">API Key</span><input type="password" value={ep.apiKey} onChange={(e) => update(ep.id, { apiKey: e.target.value })} placeholder="sk-..." className={inputCls} /></label>
                <div className="space-y-1">
                  <span className="text-[12px] font-mono text-dim/50">模型 ID</span>
                  <div className="flex gap-2">
                    {(models[ep.id]?.length ?? 0) > 0 ? (
                      <select value={ep.modelId} onChange={(e) => update(ep.id, { modelId: e.target.value })} className={inputCls + ' flex-1'}>
                        {!models[ep.id].includes(ep.modelId) && ep.modelId && <option value={ep.modelId}>{ep.modelId}（当前）</option>}
                        {models[ep.id].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input value={ep.modelId} onChange={(e) => update(ep.id, { modelId: e.target.value })} placeholder="gpt-4o / gemini-..." className={inputCls + ' flex-1'} />
                    )}
                    <button onClick={() => fetchModels(ep)} disabled={loadingId === ep.id}
                      className="shrink-0 px-2.5 py-1 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
                      {loadingId === ep.id ? '获取中…' : '刷新模型'}
                    </button>
                  </div>
                  {errById[ep.id] && <div className="text-[11px] font-mono text-blood">{errById[ep.id]}</div>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1"><span className="text-[12px] font-mono text-dim/50">温度</span><input type="number" step={0.05} min={0} max={2} value={ep.temperature} onChange={(e) => update(ep.id, { temperature: parseFloat(e.target.value) || 0 })} className={inputCls} /></label>
                  <label className="space-y-1"><span className="text-[12px] font-mono text-dim/50">Top-P</span><input type="number" step={0.05} min={0} max={1} value={ep.topP} onChange={(e) => update(ep.id, { topP: parseFloat(e.target.value) || 0 })} className={inputCls} /></label>
                  <label className="space-y-1"><span className="text-[12px] font-mono text-dim/50">Max Tokens</span><input type="number" step={128} min={128} value={ep.maxTokens} onChange={(e) => update(ep.id, { maxTokens: parseInt(e.target.value) || 512 })} className={inputCls} /></label>
                </div>
              </div>
            )}
          </div>
        ))}
        <button onClick={add} className="w-full px-3 py-2.5 text-sm font-mono text-god hover:bg-god/5 transition-colors">+ 添加接口</button>
      </div>
      <div className="text-[12px] text-dim/40 font-mono px-1">在各功能的「API 设置」页选「⚡ 接口库快捷填入」即可一键套用此处接口，无需重复填写。</div>
    </div>
  );
}

/* API 请求节流：缓解中转站 429（请求过于频繁）*/
function ApiThrottleSection() {
  const th = useSettings((s) => s.apiThrottle);
  const setTh = useSettings((s) => s.setApiThrottle);
  const numRow = (label: string, key: 'maxConcurrent' | 'minGapMs', hint: string, min: number, fallback: number) => (
    <label className="flex items-center justify-between gap-2 text-sm text-dim">
      <span>{label}<span className="text-dim/40 ml-1 text-[12px]">{hint}</span></span>
      <input type="number" min={min} value={th?.[key] ?? fallback}
        onChange={(e) => setTh({ [key]: Math.max(min, Number(e.target.value) || min) })}
        className="w-24 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
    </label>
  );
  return (
    <div className="space-y-3">
      <SectionTitle title="API 请求节流（缓解 429）" desc="每回合正文后会并发触发多个演化阶段，若都打向同一中转站易触发 429（请求过于频繁）。下面限制全局并发与最小间隔来削峰。中转站限流严→调小并发 / 调大间隔；接口快→可放宽。仅作用于各演化/记忆/频道阶段，不影响主正文流式生成。" />
      <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 space-y-2">
        {numRow('最大并发请求数', 'maxConcurrent', '（同时在飞的请求上限，建议 2~4）', 1, 3)}
        {numRow('请求最小间隔(ms)', 'minGapMs', '（两次请求开始的最小间隔；429 多就调大，如 500~1500）', 0, 250)}
      </div>
    </div>
  );
}

/* 演化调度：每个演化阶段 每N回合调用一次 + 读取最近N回合正文 */
const SCHED_PHASES: { key: string; label: string }[] = [
  { key: 'item', label: '物品演化' },
  { key: 'player', label: '主角演化' },
  { key: 'npc', label: 'NPC 演化' },
  { key: 'faction', label: '势力演化' },
  { key: 'territory', label: '领地演化' },
  { key: 'team', label: '冒险团演化' },
  { key: 'misc', label: '杂项演化' },
  { key: 'nm', label: '叙事记忆抽取' },
];
function PhaseSchedSection() {
  const sched = useSettings((s) => s.phaseSched);
  const setSched = useSettings((s) => s.setPhaseSched);
  return (
    <div className="space-y-3">
      <SectionTitle title="演化调度（频率 + 读取正文回合）" desc="每个演化阶段可设：①「每N回合」调用一次；②每次「读取最近N回合」的正文。例：设 每3回合 + 读3回合 → 三回合跑一次、刚好把这三回合正文一起送进去不漏。默认 1/1（每回合、只读当回合）。也能顺带降并发缓解 429。" />
      <div className="rounded-lg border border-edge bg-panel divide-y divide-edge/50">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono text-dim/50">
          <span className="flex-1">演化阶段</span><span className="w-20 text-right">每N回合</span><span className="w-20 text-right">读N回合</span>
        </div>
        {SCHED_PHASES.map(({ key, label }) => {
          const cfg = sched?.[key] ?? {};
          return (
            <div key={key} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 text-slate-300">{label}</span>
              <input type="number" min={1} value={cfg.every ?? 1}
                onChange={(e) => setSched(key, { every: Math.max(1, Number(e.target.value) || 1) })}
                className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
              <input type="number" min={1} value={cfg.read ?? 1}
                onChange={(e) => setSched(key, { read: Math.max(1, Number(e.target.value) || 1) })}
                className="w-20 bg-void border border-edge rounded px-2 py-1 text-sm font-mono text-slate-200 outline-none focus:border-god text-right" />
            </div>
          );
        })}
      </div>
      <div className="text-[12px] text-dim/40 px-1 leading-snug">注：这里的「每N回合」会与各演化页内原有的频率叠加取更稀疏者；建议统一在此处调。读取多回合正文会增大单次请求体积。</div>
    </div>
  );
}

function GeneralSettingsSection() {
  const historyLimit    = useSettings((s) => s.historyLimit);
  const setHistoryLimit = useSettings((s) => s.setHistoryLimit);
  const customOpening    = useSettings((s) => s.customOpening);
  const setCustomOpening = useSettings((s) => s.setCustomOpening);
  const [input, setInput] = useState(String(historyLimit));

  function commit(val: string) {
    const n = parseInt(val);
    setHistoryLimit(isNaN(n) ? 0 : n);
    setInput(String(isNaN(n) ? 0 : Math.max(0, n)));
  }

  return (
    <div className="space-y-8">
      <SectionTitle title="综合设置" desc="全局显示与行为偏好，对所有场景生效" />

      {/* 历史楼层限制 */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">聊天历史</div>

        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">历史楼层限制</div>
              <div className="text-sm text-dim mt-1 leading-relaxed">
                聊天窗口仅显示最近 N 条消息，正文 API 也只读取这些楼层作为上下文。
                <br />设为 <span className="text-god/80 font-mono">0</span> 表示不限制（显示并发送全部历史）。
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <input
                type="number"
                value={input}
                min={0}
                max={500}
                step={1}
                onChange={(e) => setInput(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(input); }}
                className="input-base w-24 text-center font-mono"
              />
              <span className="text-sm text-dim font-mono shrink-0">条</span>
            </div>
          </div>

          {/* 状态提示 */}
          <div className={`text-sm font-mono px-3 py-2 rounded border ${
            historyLimit === 0
              ? 'border-edge text-dim bg-void/40'
              : 'border-god/30 text-god/80 bg-god/5'
          }`}>
            {historyLimit === 0
              ? '● 当前：不限制，显示并发送全部历史楼层'
              : `● 当前：仅显示最近 ${historyLimit} 条消息，正文 API 上下文同步截断`}
          </div>
        </div>

        <div className="text-sm text-dim/50 font-mono leading-relaxed px-1">
          提示：聊天窗口超出限制的旧楼层将隐藏显示，但不会被删除。调低此值可减少 API 的 token 消耗。
        </div>
      </div>

      {/* API 接口库 */}
      <ApiLibrarySection />
      {/* API 请求节流（缓解 429）*/}
      <ApiThrottleSection />
      {/* 演化调度：频率 + 读取正文回合 */}
      <PhaseSchedSection />

      {/* 自定义开场白 */}
      <div className="space-y-3">
        <SectionTitle title="自定义开场白" desc="角色创建确认后自动发送的第一条消息模板；留空用内置默认" />
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-[13px] text-dim/70 leading-relaxed">
            支持占位符（发送时按角色创建数据替换，<span className="text-god/70">中英文名均可</span>）：
            <span className="font-mono text-god/70"> {'${主角名}'} {'${年龄}'} {'${性格}'} {'${入园前职业}'} {'${乐园}'} {'${难度}'} {'${外观}'} {'${天赋名}'} {'${天赋效果}'} {'${契约者ID}'}</span>
            <div className="mt-1 text-dim/60">六维：合并 <span className="font-mono text-god/70">{'${六维}'}</span> 或单项 <span className="font-mono text-god/70">{'${力}${敏}${体}${智}${魅}${幸}'}</span>（英文 {'${name}/${str}/${attrs}'} 等同义）。写错的占位符会原样保留。</div>
          </div>
          <textarea
            value={customOpening}
            onChange={(e) => setCustomOpening(e.target.value)}
            rows={6}
            placeholder={'留空＝使用内置默认开场白（会自动结合姓名/年龄/性格/职业/乐园/天赋/属性，并给主角约一小时熟悉环境的时间）。\n\n示例：\n（角色导入）我是${name}，${age}岁的${prevProfession}，性格${personality}。初入${paradise}，天赋「${talentName}」（${talentEffect}）。请先给我一小时熟悉环境，再缓缓展开剧情。'}
            className="w-full bg-void border border-edge rounded px-3 py-2 text-[14px] text-slate-200 outline-none focus:border-god/50 leading-relaxed resize-y font-mono"
          />
          <div className="flex items-center justify-between">
            <span className={`text-sm font-mono ${customOpening.trim() ? 'text-god/70' : 'text-dim/50'}`}>
              {customOpening.trim() ? '● 已启用自定义开场白' : '● 使用内置默认开场白'}
            </span>
            {customOpening.trim() && (
              <button onClick={() => setCustomOpening('')} className="text-[13px] font-mono text-dim/50 hover:text-blood transition-colors">恢复默认</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 向量记忆（语义向量召回，与关键词叙事记忆并行的另一套引擎）─── */
function VectorMemorySettings() {
  const cfg = useSettings((s) => s.vectorMemory);
  const set = useSettings((s) => s.setVectorMemory);
  const kwEnabled = useSettings((s) => s.narrativeMemory.enabled);
  const [building, setBuilding] = useState(false);
  const [status, setStatus] = useState('');
  const [indexed, setIndexed] = useState<number>(() => factVecStatus().indexed);
  const [confirmClear, setConfirmClear] = useState(false);

  const num = (label: string, key: 'topK' | 'recentFullTextCount' | 'maxItems', min: number, max: number, hint: string) => (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-slate-200">{label}</div>
      <input type="number" min={min} max={max} value={(cfg as any)[key] ?? min}
        onChange={(e) => set({ [key]: Math.min(max, Math.max(min, parseInt(e.target.value) || 0)) } as any)}
        className="input-base w-full font-mono" />
      <div className="text-sm text-dim/60 leading-relaxed">合法范围：{min} - {max}。{hint}</div>
    </div>
  );

  const rebuild = async () => {
    if (building) return;
    if (!cfg.apiBase || !cfg.apiKey) { setStatus('请先填写 embedding 接口地址与密钥'); return; }
    setBuilding(true); setStatus('正在构建向量索引…');
    try {
      const M = useMisc.getState();
      const pool = buildMemPool(M, cfg.maxItems ?? 1000);
      const r = await factVecEnsure(pool, cfg, { onProgress: (d, t) => setStatus(`嵌入中… ${d}/${t}`) });
      setIndexed(factVecStatus().indexed);
      setStatus(`完成：本次嵌入 ${r.embedded} 条，索引共 ${factVecStatus().indexed} 条（记忆池 ${pool.length} 条）`);
    } catch (e: any) {
      setStatus('失败：' + (e?.message ?? e));
    } finally {
      setBuilding(false);
    }
  };

  // 清空向量库：全局缓存（含所有存档的向量），二次确认后执行
  const doClear = async () => {
    if (building) return;
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
    setConfirmClear(false);
    try {
      await factVecClear();
      setIndexed(factVecStatus().indexed);
      setStatus('已清空向量库（所有存档的向量都被删除）；当前档下次召回会自动增量重嵌，或点「重建向量索引」。');
    } catch (e: any) {
      setStatus('清空失败：' + (e?.message ?? e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">向量记忆（语义召回）</h2>
        <p className="text-sm text-dim mt-0.5">与「叙事记忆（关键词）」并行的另一套召回引擎。把长期事实/总结/世界大事随时向量化，召回时只 embed 当前情境一次→cosine 取最相关，<span className="text-god/80">无 LLM 调用、耗时近乎恒定</span>，适合长局提速。</p>
      </div>

      <div className="border border-amber-700/40 bg-amber-900/10 rounded-lg p-3 text-sm text-amber-200/80 leading-relaxed">
        启用本项后将<span className="font-semibold text-amber-200">接管召回（优先于关键词叙事记忆）</span>；两套配置各自独立、互不影响，可随时切换。长期事实仍由「叙事记忆」的 LLM 接口（NM 接口）抽取，本页只负责向量化与检索。
        {kwEnabled && <span className="block mt-1 text-amber-200/70">· 关键词叙事记忆当前也开着——本向量引擎将优先生效。</span>}
      </div>

      <div className="border border-edge rounded-lg p-4 bg-panel space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-200">启用向量记忆</div>
            <div className="text-sm text-dim mt-1">开启后用语义向量召回；关闭则回到关键词叙事记忆（若其启用）。</div>
          </div>
          <Toggle checked={cfg.enabled} onChange={() => set({ enabled: !cfg.enabled })} />
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-200">Embedding 接口地址</div>
          <input type="text" value={cfg.apiBase} onChange={(e) => set({ apiBase: e.target.value })} placeholder="https://api.openai.com/v1" className="input-base w-full font-mono" />
          <div className="text-sm text-dim/60">OpenAI 兼容 /embeddings 端点；可与「向量资料库」用同一接口。</div>
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-200">API 密钥</div>
          <input type="password" value={cfg.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-..." className="input-base w-full font-mono" />
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-200">Embedding 模型</div>
          <input type="text" value={cfg.model} onChange={(e) => set({ model: e.target.value })} placeholder="Pro/BAAI/bge-m3" className="input-base w-full font-mono" />
          <div className="text-sm text-dim/60">默认硅基流动 <span className="font-mono">Pro/BAAI/bge-m3</span>；所有事实须用同一模型嵌入，换模型后请点「重建索引」。</div>
        </div>

        <button
          onClick={() => { const nv = useNovelVec.getState().settings; set({ apiBase: nv.apiBase || cfg.apiBase, apiKey: nv.apiKey || cfg.apiKey, model: nv.model || cfg.model }); }}
          className="self-start text-[13px] font-mono text-god/75 hover:text-god border border-god/30 hover:bg-god/10 rounded px-2.5 py-1.5 transition-colors">
          ↙ 从「向量资料库」导入接口（复用同一硅基流动 Key/模型）
        </button>

        {num('召回条数 Top-K', 'topK', 1, 30, '每轮 cosine 取最相关的记忆条数。')}
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-slate-200">最低相似度阈值</div>
          <input type="number" min={0} max={1} step={0.05} value={cfg.threshold ?? 0.3}
            onChange={(e) => set({ threshold: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
            className="input-base w-full font-mono" />
          <div className="text-sm text-dim/60">cosine 相似度低于此值不召回（0~1，常用 0.25~0.4）。</div>
        </div>
        {num('最近正文全文保留条数', 'recentFullTextCount', 0, 10, '召回的同时额外注入最近 X 楼正文原文。')}
        {num('索引条目上限', 'maxItems', 50, 5000, '向量索引的记忆条目上限（可远大于关键词模式的事实上限，长期记忆留更多）。')}

        <div className="border-t border-edge pt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-dim">已索引向量：<span className="font-mono text-god/80">{indexed < 0 ? '未加载' : indexed}</span> 条</div>
            <div className="flex items-center gap-2">
              <button onClick={doClear} disabled={building}
                className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${confirmClear ? 'border-blood/60 text-blood bg-blood/10' : 'border-edge text-dim/70 hover:text-blood hover:border-blood/40'}`}>
                {confirmClear ? '确认清空？(含所有存档)' : '清空向量库'}
              </button>
              <button onClick={rebuild} disabled={building}
                className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${building ? 'border-edge text-dim/50' : 'border-god/40 text-god hover:bg-god/10'}`}>
                {building ? '构建中…' : '重建向量索引'}
              </button>
            </div>
          </div>
          {status && <div className="text-sm font-mono text-dim/70">{status}</div>}
          <div className="text-[13px] text-dim/55 leading-relaxed">首次启用或大量积压时点一次「重建索引」做全量嵌入；之后每回合召回会自动增量补缺（每次最多 48 条）。<span className="text-dim/45">向量库是全局缓存、跨存档共享：新开/读档都不会清掉它，老档的向量一直留着；「清空向量库」会删除所有存档的向量（慎用，需重建）。</span></div>
        </div>
      </div>
    </div>
  );
}

/* ─── 叙事记忆（关键词召回）─── */
function NarrativeMemorySettings() {
  const cfg = useSettings((s) => s.narrativeMemory);
  const set = useSettings((s) => s.setNarrativeMemory);
  const vmEnabled = useSettings((s) => s.vectorMemory.enabled);   // 结构化档案召回在向量记忆模式下同样生效
  const recallOn = cfg.enabled || vmEnabled;                       // 任一召回引擎启用 → 结构化档案召回即生效
  const api0 = useSettings((s) => s.api);
  const textApi = useSettings((s) => s.textApi);
  const textUseShared = useSettings((s) => s.textUseSharedApi);
  const nmApi = useSettings((s) => s.nmApi);
  const nmUseShared = useSettings((s) => s.nmUseSharedApi);
  const nmModels = useSettings((s) => s.nmAvailableModels);
  const nmLoading = useSettings((s) => s.nmModelsLoading);
  const nmError = useSettings((s) => s.nmModelsError);
  const setNmApi = useSettings((s) => s.setNmApi);
  const setNmUseShared = useSettings((s) => s.setNmUseSharedApi);
  const fetchNmModels = useSettings((s) => s.fetchNmModels);
  const effApi = nmUseShared ? (textUseShared ? api0 : textApi) : nmApi;
  const modelOpts = nmModels.length > 0 ? nmModels : [effApi.modelId].filter(Boolean);

  const num = (label: string, key: 'recentFullTextCount' | 'distantKeywordThreshold' | 'recallTopK' | 'recallMinScore' | 'requestTimeout' | 'structMaxNpcs' | 'structMaxSkills' | 'structMaxItems' | 'structMaxSubProfs' | 'structMaxFactions',
               min: number, max: number, hint: string) => (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-slate-200">{label}</div>
      <input type="number" min={min} max={max} value={(cfg as any)[key] ?? min}
        onChange={(e) => set({ [key]: Math.min(max, Math.max(min, parseInt(e.target.value) || 0)) } as any)}
        className="input-base w-full font-mono" />
      <div className="text-sm text-dim/60 leading-relaxed">合法范围：{min} - {max}。{hint}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-edge pb-3">
        <h2 className="text-base font-bold text-slate-100">叙事记忆设置</h2>
        <p className="text-sm text-dim mt-0.5">管理当前存档的剧情记忆；按关键词命中召回最相关的长期记忆注入正文（无需向量/embedding）。</p>
      </div>

      {/* 三张说明卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { t: '当前长期上下文', s: '叙事记忆', d: '主聊天优先用召回到的长期记忆作为上下文。' },
          { t: '最近全文注入', s: `最近 ${cfg.recentFullTextCount ?? 5} 条`, d: '叙事记忆开启时，按这里的窗口保留最近正文原文。' },
          { t: '召回方式', s: '标题关键词', d: '无向量时，长期记忆按标题与关键词命中度召回。' },
        ].map((c) => (
          <div key={c.t} className="border border-edge rounded-lg p-3 bg-panel">
            <div className="text-[12px] font-mono text-dim/50">{c.t}</div>
            <div className="text-sm font-semibold text-god/90 mt-0.5">{c.s}</div>
            <div className="text-[13px] text-dim/70 mt-1 leading-relaxed">{c.d}</div>
          </div>
        ))}
      </div>

      <div className="border border-amber-700/40 bg-amber-900/10 rounded-lg p-3 text-sm text-amber-200/80 leading-relaxed">
        当前为<span className="font-semibold text-amber-200"> 标题关键词模式</span>（无 embedding）。召回源为「🧩 杂项演化」产出的小总结 / 大总结 / 世界大事；需同时启用杂项演化才有素材可召回。
      </div>

      {/* 基础配置 */}
      <div className="space-y-4">
        <div>
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">基础配置</div>
          <div className="text-sm text-dim mt-1">叙事记忆和（按楼层切片的）历史限制互补；开启后按关键词召回相关长期记忆，并保留最近若干楼正文。</div>
        </div>

        <div className="border border-edge rounded-lg p-4 bg-panel space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">启用叙事记忆</div>
              <div className="text-sm text-dim mt-1">未配置向量时也可启用；长期记忆使用标题关键词召回。</div>
            </div>
            <Toggle checked={cfg.enabled} onChange={() => set({ enabled: !cfg.enabled })} />
          </div>

          {num('最近正文全文保留条数', 'recentFullTextCount', 0, 10, '叙事记忆开启时，主聊天仍额外注入最近 X 条正文全文；设为 0 则只依赖召回的记忆与其他上下文。')}
          {num('关键词召回条数 Top-K', 'recallTopK', 1, 30, '每轮按相关性召回的长期记忆条数。')}
          {num('召回最低命中分', 'recallMinScore', 1, 20, '关键词命中数低于此值的记忆不召回；越大越严格。')}
          {num('远层记忆标题关键词阈值', 'distantKeywordThreshold', 0, 5000, '超过这个名次距离的长期记忆只注入标题/关键词；设为 0 则不压缩。')}
          {num('请求超时（秒）', 'requestTimeout', 30, 300, '叙事记忆相关 LLM 请求超时（预留，关键词模式当前不调用 LLM）；默认 90 秒。')}

          <div className={`text-sm font-mono px-3 py-2 rounded border ${cfg.enabled ? 'border-god/30 text-god/80 bg-god/5' : 'border-edge text-dim bg-void/40'}`}>
            {cfg.enabled
              ? `● 当前：最近 ${cfg.recentFullTextCount ?? 5} 楼原文 + 关键词召回 Top-${cfg.recallTopK ?? 6}（命中≥${cfg.recallMinScore ?? 1}）注入 <相关记忆>`
              : '● 当前：未启用，按「综合设置 · 历史楼层限制」切片'}
          </div>
        </div>
      </div>

      {/* 结构化档案召回 */}
      <div className="space-y-4">
        <div>
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">结构化档案召回</div>
          <div className="text-sm text-dim mt-1 leading-relaxed">
            把<span className="text-god/70">主角</span>与<span className="text-god/70">相关 NPC</span> 的完整档案（身份/属性/状态/技能/装备等）整理成 <span className="font-mono text-god/70">{'<在场与相关档案>'}</span> 注入正文，让主叙事"看得见"结构化设定，保持人物/数值/装备一致。主角档案始终包含。开启 LLM 两步法时，由 LLM 预测下回合最可能登场的 NPC；否则按"在场优先"本地挑选。<span className="text-amber-200/80">技能/装备上限仅作用于主角；被选中的 NPC 给全量信息（所有技能/天赋/装备）。</span>
          </div>
        </div>

        <div className="border border-edge rounded-lg p-4 bg-panel space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">启用结构化档案召回</div>
              <div className="text-sm text-dim mt-1"><span className="text-god/70">叙事记忆或向量记忆任一启用即生效</span>（装备/技能/NPC 档案就靠这里注入，与用哪套召回引擎无关）。注入的档案是只读参考，不会让 AI 照搬复述。</div>
            </div>
            <Toggle checked={cfg.structEnabled ?? true} onChange={() => set({ structEnabled: !(cfg.structEnabled ?? true) })} />
          </div>

          {num('注入 NPC 数量上限', 'structMaxNpcs', 0, 10, '每轮注入的相关 NPC 数量（主角不占此额度）。默认 2。')}
          {num('主角技能数量上限', 'structMaxSkills', 0, 12, '仅限主角：注入的技能条数（按品阶/新近优先）。默认 3。NPC 不受此限，被选中即全量。')}
          {num('主角装备数量上限', 'structMaxItems', 0, 12, '仅限主角：注入的装备条数（已装备优先，再按品阶）。材料/消耗品全部显示(名称+效果)、其它物品不注入。默认 2。NPC 不受此限，被选中即全量。')}
          {num('主角副职业数量上限', 'structMaxSubProfs', 0, 12, '仅限主角：注入的副职业条数（含其配方名）。默认 4。')}
          {num('当前世界势力数量上限', 'structMaxFactions', 0, 12, '注入的当前世界势力条数（按对主角态度强弱+近况排序）。默认 4。')}

          <div className={`text-sm font-mono px-3 py-2 rounded border ${(cfg.structEnabled ?? true) && recallOn ? 'border-god/30 text-god/80 bg-god/5' : 'border-edge text-dim bg-void/40'}`}>
            {!recallOn
              ? '● 需先启用叙事记忆 或 向量记忆'
              : (cfg.structEnabled ?? true)
                ? `● 当前：主角(技能≤${cfg.structMaxSkills ?? 3}/装备≤${cfg.structMaxItems ?? 2}) + 最多 ${cfg.structMaxNpcs ?? 2} 个NPC(全量)${vmEnabled && !cfg.enabled ? '　[向量记忆模式]' : ''}`
                : '● 未启用结构化档案召回'}
          </div>
        </div>
      </div>

      {/* 使用的模型 / LLM 两步法 */}
      <div className="space-y-4">
        <div>
          <div className="text-sm font-mono text-god/70 uppercase tracking-widest">使用的模型（LLM 两步法）</div>
          <div className="text-sm text-dim mt-1 leading-relaxed">
            开启后用 LLM 把召回做"准"：<span className="text-god/70">发送前整理</span>（按情境改写检索关键词，避免只召回最新记忆）+ <span className="text-god/70">回复后写入</span>（从正文抽取长期事实存库）。关闭则纯关键词召回、零额外调用。
          </div>
        </div>

        <div className="border border-edge rounded-lg p-4 bg-panel space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">启用 LLM 整理 / 抽取</div>
              <div className="text-sm text-dim mt-1">需要叙事记忆已启用；会在发送前和回复后各发一次轻量 LLM 请求。</div>
            </div>
            <Toggle checked={cfg.llmMode} onChange={() => set({ llmMode: !cfg.llmMode })} />
          </div>

          <div className="flex items-center gap-3 p-3 bg-void/40 border border-edge rounded-lg">
            <Toggle checked={nmUseShared} onChange={() => setNmUseShared(!nmUseShared)} />
            <div>
              <div className="text-sm text-slate-200">与正文生成共用 API</div>
              <div className="text-sm text-dim mt-0.5">关闭则为叙事记忆单独配置接口</div>
            </div>
          </div>

          <ApiRoutePicker routeKey="nm" className="mb-2" />
          {!nmUseShared && (
            <div className="space-y-3">
              <Field label="API 地址">
                <input type="text" value={nmApi.baseUrl} onChange={(e) => setNmApi({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" className="input-base" />
              </Field>
              <Field label="API Key">
                <input type="password" value={nmApi.apiKey} onChange={(e) => setNmApi({ apiKey: e.target.value })} placeholder="sk-..." className="input-base font-mono" />
              </Field>
              <Field label="默认模型">
                <div className="flex gap-2">
                  {nmModels.length > 0 ? (
                    <select value={nmApi.modelId} onChange={(e) => setNmApi({ modelId: e.target.value })} className="input-base flex-1">
                      {nmModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={nmApi.modelId} onChange={(e) => setNmApi({ modelId: e.target.value })} placeholder="gpt-4o-mini" className="input-base flex-1 font-mono" />
                  )}
                  <button onClick={fetchNmModels} disabled={nmLoading} className="shrink-0 px-3 py-2 border border-god/40 text-god text-sm rounded hover:bg-god/10 disabled:opacity-40 font-mono transition-colors">
                    {nmLoading ? '获取中…' : '刷新模型'}
                  </button>
                </div>
                {nmError && <div className="text-sm text-blood mt-1 font-mono">{nmError}</div>}
              </Field>
            </div>
          )}

          {/* 两步分别选模型 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="发送前整理模型（查询改写，推荐更快）">
              {modelOpts.length > 1 ? (
                <select value={cfg.compileModelId} onChange={(e) => set({ compileModelId: e.target.value })} className="input-base">
                  <option value="">（用默认：{effApi.modelId || '—'}）</option>
                  {modelOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input type="text" value={cfg.compileModelId} onChange={(e) => set({ compileModelId: e.target.value })} placeholder={`默认：${effApi.modelId || ''}`} className="input-base font-mono" />
              )}
            </Field>
            <Field label="回复后写入模型（事实抽取，推荐稳一点）">
              {modelOpts.length > 1 ? (
                <select value={cfg.ingestModelId} onChange={(e) => set({ ingestModelId: e.target.value })} className="input-base">
                  <option value="">（用默认：{effApi.modelId || '—'}）</option>
                  {modelOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input type="text" value={cfg.ingestModelId} onChange={(e) => set({ ingestModelId: e.target.value })} placeholder={`默认：${effApi.modelId || ''}`} className="input-base font-mono" />
              )}
            </Field>
          </div>

          <div className="text-[12px] text-dim/50 font-mono">两步留空则用上面的默认模型。关闭「启用 LLM 整理/抽取」时这一节不生效。</div>
        </div>
      </div>
    </div>
  );
}

/* ── 预设正则 ── */
function PresetRegexSection() {
  const presets        = useSettings((s) => s.textPresets);
  const activeId       = useSettings((s) => s.activeTextPresetId);
  const toggle         = useSettings((s) => s.togglePresetRegexScript);
  const update         = useSettings((s) => s.updatePresetRegexScript);
  const remove         = useSettings((s) => s.removePresetRegexScript);
  const move           = useSettings((s) => s.movePresetRegexScript);
  const add            = useSettings((s) => s.addPresetRegexScript);
  const importPreset   = useSettings((s) => s.importPresetRegex);

  const [openId, setOpenId] = useState<string | null>(activeId ?? presets[0]?.id ?? null);

  if (presets.length === 0) {
    return (
      <div className="space-y-4">
        <SectionTitle title="预设正则" desc="每个预设可绑定独立的正则脚本，仅在该预设激活时生效" />
        <div className="text-dim text-sm font-mono py-8 text-center border border-dashed border-edge rounded-lg">
          暂无预设，请先在「正文生成→预设」中导入
        </div>
      </div>
    );
  }

  const open = presets.find((p) => p.id === openId);

  return (
    <div className="space-y-4">
      <SectionTitle title="预设正则" desc="每个预设可绑定独立的正则脚本，仅在该预设激活时生效" />

      {/* 预设列表 */}
      <div className="space-y-1">
        {presets.map((p) => {
          const count = (p.regexScripts ?? []).length;
          const isOpen = openId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setOpenId(isOpen ? null : p.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-colors ${
                isOpen ? 'border-god/40 bg-god/5 text-god' : 'border-edge bg-panel text-slate-300 hover:border-god/30 hover:bg-panel2'
              }`}
            >
              <span className="flex-1 text-sm font-semibold truncate">{p.name}</span>
              {p.id === activeId && <span className="text-[12px] font-mono text-god">● 启用中</span>}
              <span className="text-sm font-mono text-dim">{count} 条脚本</span>
              <span className="text-dim text-sm">{isOpen ? '∧' : '∨'}</span>
            </button>
          );
        })}
      </div>

      {/* 展开的预设正则列表 */}
      {open && (
        <div className="border border-god/20 rounded-xl p-4 bg-void/40">
          <RegexList
            scripts={open.regexScripts ?? []}
            onToggle={(id) => toggle(open.id, id)}
            onUpdate={(id, patch) => update(open.id, id, patch)}
            onRemove={(id) => remove(open.id, id)}
            onMove={(id, dir) => move(open.id, id, dir)}
            onAdd={() => add(open.id)}
            onImport={(raw, fn) => importPreset(open.id, raw, fn)}
            title={`${open.name} · 正则脚本`}
            desc="仅当此预设激活时对 AI 输出生效"
          />
        </div>
      )}
    </div>
  );
}
