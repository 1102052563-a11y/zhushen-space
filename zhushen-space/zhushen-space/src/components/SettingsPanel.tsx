import { useRef, useState, useEffect } from 'react';
import { useSettings, endpointToConfig, type WorldBook, type WorldBookEntry, type TextGenPreset, type STPromptEntry, type RegexScript, type ApiEndpoint } from '../store/settingsStore';
import { apiChatFallback, fetchWithProxy, gwProxyBase } from '../systems/apiChat';
import { READING_FONTS, readingFontStack } from '../systems/readingFonts';
import { UI_THEMES } from '../systems/uiThemes';
import { toSTPreset } from '../systems/stPresetExport';
import { ADVANCE_PRESET_BUILTINS, PLOT_CHOICES_RULE } from '../promptRules';
import { useDbAdvance } from '../store/dbAdvanceStore';   // 数据库推进管线（Stitches 规划层）
import PromptCenterPanel from './PromptCenterPanel';   // 预设中心：各功能主提示词编辑页
import DbAdvancePresetEditor from './DbAdvancePresetEditor';   // 数据库推进预设编辑器（缝破限/改模块提示词）
import VariableManager from './VariableManager';
import ApiRoutePicker from './ApiRoutePicker';
import ApiSlotAudit from './ApiSlotAudit';
import DbAdvanceInspector from './DbAdvanceInspector';
import { exportGlossary, parseGlossaryImport } from '../i18n/glossaryIO';
import ItemManager from './ItemManager';
import PlayerManager from './PlayerManager';
import NpcManager from './NpcManager';
import PetManager from './PetManager';
import EntryJudgeManager from './EntryJudgeManager';
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
import CasinoManager from './CasinoManager';
import CraftManager from './CraftManager';
import AbyssManager from './AbyssManager';
import SkillTreeManager from './SkillTreeManager';
import SubProfTreeManager from './SubProfTreeManager';
import TableManager from './TableManager';
import JoyManager from './JoyManager';
import NovelVecManager from './NovelVecManager';
import WorldCodexManager from './WorldCodexManager';
import ChannelManager from './ChannelManager';
import ImageGenManager from './ImageGenManager';
import { useMisc } from '../store/miscStore';
import { useNovelVec } from '../store/novelVecStore';
import { buildMemPool, ensureVectors as factVecEnsure, vecStatus as factVecStatus, clearAllVectors as factVecClear, loadAll as factVecLoadAll } from '../systems/factVec';

interface SettingsPanelProps {
  onClose: () => void;
  onOpenSaveLoad: () => void;   // 打开存档管理面板（导出/导入/重置游戏数据；逻辑复用 SaveLoadPanel）
}

type Page = 'home' | 'world-detail' | 'textgen-detail' | 'regex-detail' | 'general' | 'variables' | 'table-manager' | 'item-manager' | 'player-manager' | 'npc-manager' | 'pet-manager' | 'entry-judge-manager' | 'faction-manager' | 'territory-manager' | 'team-manager' | 'cosmos-manager' | 'memory-manager' | 'misc-manager' | 'channel-manager' | 'novelvec-manager' | 'codex-manager' | 'dice-manager' | 'combat-manager' | 'arena-manager' | 'enhance-manager' | 'skilltree-manager' | 'subprof-manager' | 'joy-manager' | 'casino-manager' | 'abyss-manager' | 'craft-manager' | 'narrative-memory' | 'vector-memory' | 'image-gen' | 'appearance' | 'prompt-center';
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
    <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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

  if (page === 'prompt-center') { return <PromptCenterPanel onClose={() => setPage('home')} />; }

  if (page === 'general') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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

  if (page === 'appearance') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">界面外观</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <div className="max-w-xl mx-auto">
            <AppearanceSettingsSection />
          </div>
        </div>
      </div>
    );
  }

  if (page === 'narrative-memory') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('home')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 系统设置
          </button>
          <span className="text-sm font-mono text-dim">变量管理</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <VariableManager
            onOpenTableManager={() => setPage('table-manager')}
            onOpenItemManager={() => setPage('item-manager')}
            onOpenPlayerManager={() => setPage('player-manager')}
            onOpenNpcManager={() => setPage('npc-manager')}
            onOpenPetManager={() => setPage('pet-manager')}
            onOpenEntryJudgeManager={() => setPage('entry-judge-manager')}
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
            onOpenCasinoManager={() => setPage('casino-manager')}
            onOpenAbyssManager={() => setPage('abyss-manager')}
            onOpenSkillTreeManager={() => setPage('skilltree-manager')}
            onOpenSubProfManager={() => setPage('subprof-manager')}
            onOpenCraftManager={() => setPage('craft-manager')}
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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

  if (page === 'pet-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">宠物/召唤物演化</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <PetManager />
        </div>
      </div>
    );
  }

  if (page === 'entry-judge-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">登场判断</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <EntryJudgeManager />
        </div>
      </div>
    );
  }

  if (page === 'faction-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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

  if (page === 'casino-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">赌场</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <CasinoManager />
        </div>
      </div>
    );
  }

  if (page === 'craft-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">合成工坊</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <CraftManager />
        </div>
      </div>
    );
  }

  if (page === 'abyss-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">深渊地牢</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <AbyssManager />
        </div>
      </div>
    );
  }

  if (page === 'skilltree-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">技能树</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <SkillTreeManager />
        </div>
      </div>
    );
  }

  if (page === 'table-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">表格数据库</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <TableManager />
        </div>
      </div>
    );
  }

  if (page === 'subprof-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
        <header className="shrink-0 h-10 flex items-center justify-between px-4 border-b border-edge bg-panel">
          <button onClick={() => setPage('variables')} className="flex items-center gap-2 text-sm font-mono text-dim hover:text-slate-200 transition-colors">
            ← 变量管理
          </button>
          <span className="text-sm font-mono text-dim">副职业设置</span>
          <div className="w-20" />
        </header>
        <div className="flex-1 overflow-y-auto p-6 max-lg:p-3">
          <SubProfTreeManager />
        </div>
      </div>
    );
  }

  if (page === 'joy-manager') {
    return (
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
      <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
    <div className="h-[100dvh] flex flex-col bg-void text-slate-300">
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
          <SettingsMenuItem icon="🎛️" title="预设中心"  desc="各功能主提示词一站编辑 · 恢复默认 / 导入 / 导出" onClick={() => setPage('prompt-center')} />
          <SettingsMenuItem icon="🔤" title="正则"      desc="全局正则与预设绑定正则脚本"      onClick={() => { setPage('regex-detail');  setTab('global-regex'); }} />
          <SettingsMenuItem icon="📈" title="变量管理"  desc="自定义 AI 可读写的游戏变量，配置 &lt;state&gt; 更新系统" onClick={() => setPage('variables')} />
          <SettingsMenuItem icon="🧠" title="叙事记忆"  desc="关键词召回长期剧情记忆，按相关性注入正文（无需向量）" onClick={() => setPage('narrative-memory')} />
          <SettingsMenuItem icon="🧭" title="向量记忆"  desc="语义向量召回长期记忆（更快·需 embedding 接口）；开启后接管召回" onClick={() => setPage('vector-memory')} />
          <SettingsMenuItem icon="🖼" title="生图设置"  desc="NAI/OpenAI/Gemini/ComfyUI 多服务 · 肖像/装备/正文配图" onClick={() => setPage('image-gen')} />
          <SettingsMenuItem icon="🎨" title="界面外观美化"  desc="护眼色调 / 暗角 / 正文字体 / 字号·行距"      onClick={() => setPage('appearance')} />
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
  const dedupeWorldBooks = useSettings((s) => s.dedupeWorldBooks);

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
        <button
          onClick={() => { const n = dedupeWorldBooks(); setMsg(n > 0 ? `已清理 ${n} 本重复世界书` : '没有发现重复世界书'); setTimeout(() => setMsg(''), 4000); }}
          className="px-3 py-2 border border-edge text-dim text-sm rounded hover:border-god/40 hover:text-god transition-colors font-mono"
          title="同名世界书只保留一本（优先保留内置），清掉重复堆叠"
        >
          🧹 清理重复
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

      {/* 注入位置 / 优先级（深度注入 / 排序） */}
      <div className="space-y-1.5 border-t border-edge/30 pt-3">
        <label className="text-[12px] font-mono text-dim">注入位置（优先级 / 深度）</label>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={entry.position === 4 ? '4' : '0'} onChange={(e) => onChange({ position: Number(e.target.value) })} className="input-base text-sm w-auto">
            <option value="0">普通（拼进 system 顶部）</option>
            <option value="4">⚡深度注入（@D 贴近用户输入＝优先级高）</option>
          </select>
          {entry.position === 4 ? (
            <label className="flex items-center gap-1.5 text-sm text-slate-300">
              深度
              <input type="number" min={0} max={50} value={entry.depth ?? 4} onChange={(e) => onChange({ depth: Number(e.target.value) })} className="input-base text-sm w-16" />
              <span className="text-[11px] text-dim/60">越小越贴近输入＝优先级越高</span>
            </label>
          ) : (
            <label className="flex items-center gap-1.5 text-sm text-slate-300">
              排序
              <input type="number" value={entry.order ?? 100} onChange={(e) => onChange({ order: Number(e.target.value) })} className="input-base text-sm w-20" />
              <span className="text-[11px] text-dim/60">system 块内越大越靠后＝越贴近对话</span>
            </label>
          )}
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
  return (
    <div className="space-y-6 max-w-xl">
      <SectionTitle title="API 配置" desc="从下方「接口路由」勾选「API 接口库」里的接口，按优先级轮流调用（失败自动切下一条）；接口在「综合设置 → API 接口库」里新增 / 编辑" />

      <ApiRoutePicker routeKey="world" />
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
  const dedupeTextWorldBooks = useSettings((s) => s.dedupeTextWorldBooks);

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
        <button
          onClick={() => { const n = dedupeTextWorldBooks(); setMsg(n > 0 ? `已清理 ${n} 本重复世界书` : '没有发现重复世界书'); setTimeout(() => setMsg(''), 4000); }}
          className="px-3 py-2 border border-edge text-dim text-sm rounded hover:border-god/40 hover:text-god transition-colors font-mono"
          title="同名世界书只保留一本（优先保留内置），清掉重复堆叠"
        >
          🧹 清理重复
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
  const textStream         = useSettings((s) => s.textStream);
  const skipNarrativeThinking = useSettings((s) => s.skipNarrativeThinking);
  const forceNarrativeThinking = useSettings((s) => s.forceNarrativeThinking);
  const plotGuidance       = useSettings((s) => s.plotGuidance);
  const guidancePrompt     = useSettings((s) => s.guidancePrompt);
  const setTextStream      = useSettings((s) => s.setTextStream);
  const setSkipNarrativeThinking = useSettings((s) => s.setSkipNarrativeThinking);
  const setForceNarrativeThinking = useSettings((s) => s.setForceNarrativeThinking);
  const setPlotGuidance    = useSettings((s) => s.setPlotGuidance);
  const planningReview     = useSettings((s) => s.planningReview);
  const setPlanningReview  = useSettings((s) => s.setPlanningReview);
  const setGuidancePrompt  = useSettings((s) => s.setGuidancePrompt);
  const outlineEnabled     = useSettings((s) => s.outlineEnabled);
  const outlinePrompt      = useSettings((s) => s.outlinePrompt);
  const outlineBias        = useSettings((s) => s.outlineBias);
  const outlineWordTarget  = useSettings((s) => s.outlineWordTarget);
  const setOutlineEnabled  = useSettings((s) => s.setOutlineEnabled);
  const setOutlinePrompt   = useSettings((s) => s.setOutlinePrompt);
  const setOutlineBias     = useSettings((s) => s.setOutlineBias);
  const setOutlineWordTarget = useSettings((s) => s.setOutlineWordTarget);
  const plotChoices        = useSettings((s) => s.plotChoices);
  const setPlotChoices     = useSettings((s) => s.setPlotChoices);
  const fanficMode         = useSettings((s) => s.fanficMode);
  const setFanficMode      = useSettings((s) => s.setFanficMode);
  const factCheck          = useSettings((s) => s.factCheck);
  const setFactCheck       = useSettings((s) => s.setFactCheck);
  const miniTheater        = useSettings((s) => s.miniTheater);
  const setMiniTheater     = useSettings((s) => s.setMiniTheater);
  const choicesPrompt      = useSettings((s) => s.choicesPrompt);
  const setChoicesPrompt   = useSettings((s) => s.setChoicesPrompt);
  const narrativePov       = useSettings((s) => s.narrativePov);
  const setNarrativePov    = useSettings((s) => s.setNarrativePov);

  return (
    <div className="space-y-6 max-w-xl">
      <SectionTitle title="正文 API 配置" desc="用于正文生成请求的语言模型接口" />

      {/* 生成相关开关 */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={textStream} onChange={() => setTextStream(!textStream)} />
          <div>
            <div className="text-sm text-slate-200">流式输出（Streaming）</div>
            <div className="text-sm text-dim mt-0.5">开启后正文逐字生成，关闭则等待完整响应后一次性显示</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={skipNarrativeThinking} onChange={() => setSkipNarrativeThinking(!skipNarrativeThinking)} />
          <div>
            <div className="text-sm text-slate-200">跳过正文思维链（提速·思考模型）</div>
            <div className="text-sm text-dim mt-0.5">在正文请求末尾预填充 <code>&lt;/think&gt;</code>，让思考模型跳过原生思维链直接出正文——更快首字节、更省 token。只影响正文渲染，不碰各演化阶段的推理；并自动剥除泄漏进正文的思维链。默认关；若你的接口不支持「助手预填充」可关掉。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={forceNarrativeThinking} onChange={() => setForceNarrativeThinking(!forceNarrativeThinking)} />
          <div>
            <div className="text-sm text-slate-200">强制正文思维链（预填充 <code>&lt;think&gt;</code>·根治时有时无）</div>
            <div className="text-sm text-dim mt-0.5">在正文请求末尾以 assistant 身份预填充一个 <code>&lt;think&gt;</code> 开标签，让模型只能从思维链续写——把「十次只出五次思维链」变成基本每次都出（与 SillyTavern 的「继续预填充 / assistant 预填充」同一机制）。<b className="text-slate-300">流式期间会自动隐藏思考、只把正文逐字显示给你</b>（思考中显示「💭 思考中……」占位），最终也不会残留在正文里。与上面「跳过正文思维链」互斥（开一个自动关另一个）。<b className="text-emerald-400/90">默认开</b>；若接口不支持「助手预填充」（如部分 Gemini 端点拒绝以 assistant 结尾）请关掉。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={plotGuidance} onChange={() => { const v = !plotGuidance; setPlotGuidance(v); if (v) { setOutlineEnabled(false); useDbAdvance.getState().setEnabled(false); } }} />
          <div>
            <div className="text-sm text-slate-200">剧情指导（实验 · 先出建议再写正文）<span className="text-xs text-amber-400/80 ml-1">· 与「数据库推进 / 细纲」三选一</span></div>
            <div className="text-sm text-dim mt-0.5">开启后：正文生成<b>前</b>先<b>单独跑一遍「剧情指导」</b>——据「最近 5 楼 + 你这步输入 + 当前任务/场景」产出本回合的<b>剧情优化建议</b>（要点式、不写正文），再像<b>叙事回忆</b>那样注入正文，由正文据此写。<b className="text-amber-400/90">每回合 +1 次调用</b>（可在下方挂独立 guidance 路由/便宜模型）。提示词允许它<b>联网搜原作剧情</b>让切入更合理。失败/超时自动跳过、正文照常生成。默认关。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={outlineEnabled} onChange={() => { const v = !outlineEnabled; setOutlineEnabled(v); if (v) { setPlotGuidance(false); useDbAdvance.getState().setEnabled(false); } }} />
          <div>
            <div className="text-sm text-slate-200">细纲（先出细纲 · 编辑后再写正文）<span className="text-xs text-amber-400/80 ml-1">· 与「剧情指导 / 数据库推进」三选一</span></div>
            <div className="text-sm text-dim mt-0.5">开启后：你每次发送，正文生成<b>前</b>先<b>单独跑一遍「细纲师」</b>——用<b>与正文完全一致的上下文</b>（世界书/记忆/角色档案/最近正文/你这步输入）产出<b>本回合细纲</b>（核心事件/情绪/情节点序列/钩子…），弹窗给你<b>编辑</b>；点「确认并生成正文」后，正文会被要求<b>严格遵循这份细纲</b>来写。<b className="text-amber-400/90">每回合 +1 次调用</b>（可在下方挂独立接口）。<b>重新生成</b>正文时不再弹细纲。默认关。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={planningReview} onChange={() => setPlanningReview(!planningReview)} />
          <div>
            <div className="text-sm text-slate-200">正文前审核（剧情指导 / 数据库推进）</div>
            <div className="text-sm text-dim mt-0.5">开启后：<b>剧情指导</b>或<b>数据库推进</b>的产出会先<b>弹窗</b>给你——可<b>编辑</b>或<b>重新生成</b>，确认后才写正文（清空文本框＝本回合不注入该规划，取消＝作废本回合）。像「细纲」那样把这两个也变成可审核；<b>只对剧情指导 / 数据库推进生效</b>（细纲本就有弹窗）。重新生成正文时不弹。默认关。</div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={plotChoices} onChange={() => setPlotChoices(!plotChoices)} />
          <div>
            <div className="text-sm text-slate-200">剧情选项（8 选项）</div>
            <div className="text-sm text-dim mt-0.5">每段正文后额外生成 8 个「主角视角」行动选项，点击填入输入框；八个方向各异（最后 1 个 H 为限制级 18+），至少 5 个会调用主角的技能/天赋/装备/物品；原著世界时还会联网搜原著剧情、让选项接入原著剧情线。</div>
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
        <div className="flex items-center gap-3 p-3 bg-panel border border-edge rounded-lg">
          <Toggle checked={miniTheater} onChange={() => setMiniTheater(!miniTheater)} />
          <div>
            <div className="text-sm text-slate-200">小剧场（番外彩蛋）</div>
            <div className="text-sm text-dim mt-0.5">每段正文后让 AI 读取<b>内置「小剧场世界书」</b>（已内嵌，无需在世界书里管理）→ 生成 1~3 则与主线无关的<b>番外彩蛋</b>，用 HTML/内联 CSS 美化排版，折叠展示在正文末尾。纯趣味、不影响主线与数值。</div>
          </div>
        </div>
        <div className="p-3 bg-panel border border-edge rounded-lg">
          <div className="text-sm text-slate-200">叙事人称</div>
          <div className="text-sm text-dim mt-0.5 mb-2">强制正文以指定人称叙述主角，最高优先（压过预设文风块与历史惯性，无需依赖预设里的人称块）。「跟随预设」=不干预，由预设/模型决定。仅作用于主角，NPC 始终第三人称；对白不受影响。</div>
          <div className="flex flex-wrap gap-1.5">
            {([['off', '跟随预设'], ['first', '第一人称（我）'], ['second', '第二人称（你）'], ['third', '第三人称（他/她）']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setNarrativePov(val)}
                className={`px-3 py-1.5 rounded-md text-sm border transition ${narrativePov === val ? 'bg-sky-900/40 text-sky-300 border-sky-600/50' : 'bg-black/20 text-dim border-edge hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(plotChoices || fanficMode || factCheck || miniTheater) && (
        <div className="p-3 bg-panel border border-edge rounded-lg space-y-2">
          <div className="text-sm text-slate-200">选项 / 同人 / 事实 / 小剧场 · 共用 API 路由</div>
          <div className="text-xs text-dim">四者共用同一接口、正文生成后只调用一次。留空则复用上面的「正文 API」。</div>
          <ApiRoutePicker routeKey="plot" />
        </div>
      )}

      {plotChoices && (
        <div className="p-3 bg-panel border border-fuchsia-700/40 rounded-lg space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-slate-200">🎭 剧情选项提示词（自定义 · 完全覆盖）</div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setChoicesPrompt(PLOT_CHOICES_RULE)}
                className="text-[11px] font-mono px-2 py-1 rounded-md border border-fuchsia-600/40 text-fuchsia-200/90 hover:bg-fuchsia-600/15 transition-colors">
                载入内置默认
              </button>
              {choicesPrompt.trim() && (
                <button
                  onClick={() => setChoicesPrompt('')}
                  className="text-[11px] font-mono px-2 py-1 rounded-md border border-edge text-dim hover:text-slate-200 transition-colors">
                  清空/恢复默认
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-dim">
            <b>留空 = 用内置默认规则</b>（人设一致性 / 能力运用 / 原著接轨 / 8 选项分工 / H 为 18+ 等）。想自己改选项的口味、数量口径、方向分工、NSFW 尺度就写在这里——<b>填了则整段替换掉内置规则</b>。点「载入内置默认」可先把内置规则填进来再改。
            <br /><span className="text-fuchsia-300/70">注意：自定义时请保留结尾输出 <code>&lt;choices&gt;</code> 块、A~H 逐行的格式，否则前端解析不到选项。</span>
          </div>
          <textarea
            value={choicesPrompt}
            onChange={(e) => setChoicesPrompt(e.target.value)}
            rows={8}
            placeholder="（留空 = 用内置默认剧情选项提示词；点上方「载入内置默认」可载入后再改）"
            className="w-full px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 font-mono resize-y focus:border-fuchsia-600/50 focus:outline-none"
          />
        </div>
      )}

      {plotGuidance && (
        <div className="p-3 bg-panel border border-violet-700/40 rounded-lg space-y-3">
          <div className="text-sm text-slate-200">剧情指导 · 配置</div>
          <div className="text-xs text-dim">正文生成<b>前</b>先据「最近 5 楼 + 你这步输入 + 当前任务/场景」跑一次，产出本回合的<b>剧情优化建议</b>（要点式、不写正文），再像叙事回忆一样注入正文，由正文据此写。世界书/记忆/角色档案仍由正文那遍照常注入。</div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-violet-200">🧭 剧情指导 · 接口路由</div>
            <div className="text-xs text-dim">跑剧情指导用的模型——建议挂一条<b>能联网搜索（Google）</b>的模型，让它据原作剧情给更合理的切入/推进；只出建议、不写正文，挂便宜模型即可。<b>留空则复用上面的正文 API</b>。</div>
            <ApiRoutePicker routeKey="guidance" />
          </div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-slate-200">剧情指导提示词（自定义）</div>
            <div className="text-xs text-dim">留空 = 用内置默认（要点式建议 + 允许联网搜原作剧情 + 禁写正文/对白）。想自己调指导口吻/侧重就写在这里。</div>
            <textarea
              value={guidancePrompt}
              onChange={(e) => setGuidancePrompt(e.target.value)}
              rows={4}
              placeholder="（留空用内置默认剧情指导提示词）"
              className="w-full px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 font-mono resize-y focus:border-violet-600/50 focus:outline-none"
            />
          </div>
        </div>
      )}

      {outlineEnabled && (
        <div className="p-3 bg-panel border border-violet-700/40 rounded-lg space-y-3">
          <div className="text-sm text-slate-200">细纲 · 配置</div>
          <div className="text-xs text-dim">正文<b>前</b>先用<b>与正文一致的上下文</b>跑一遍「职业编剧」，产出本回合细纲弹窗给你编辑；确认后正文严格遵循。内置提示词把 AI 设为<b>资深网文编剧</b>：先做一遍<b>专注剧情合理性</b>的 <code className="text-violet-300">&lt;剧情推演&gt;</code> 思维链（推演不进弹窗、只用来把细纲做扎实），再产出结构化细纲。世界书/记忆/角色档案与正文那遍一致（<b>不带正文预设</b>的写正文/排版指令，产出更干净）。</div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-violet-200">📝 细纲 · 接口路由（独立）</div>
            <div className="text-xs text-dim">跑细纲用的模型。建议挂一条<b>能联网搜索（Google）</b>的模型——提示词会让编剧搜原作剧情/设定/时间线来校准合理性；<b>留空则复用上面的正文 API</b>。</div>
            <ApiRoutePicker routeKey="outline" />
          </div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-slate-200">字数目标</div>
            <div className="text-xs text-dim">写进细纲的「字数目标」，并要求正文贴合。<b>0 = 不限定</b>，由 AI 按本回合体量把握。</div>
            <input
              type="number" min={0} step={100} value={outlineWordTarget}
              onChange={(e) => setOutlineWordTarget(Number(e.target.value) || 0)}
              className="w-32 px-3 py-1.5 bg-black/30 border border-edge rounded-md text-sm text-slate-200 focus:border-violet-600/50 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-emerald-200">🎯 细纲偏好 / 倾向（追加 · 保持格式）</div>
            <div className="text-xs text-dim">在<b>不改变内置格式 / 结构</b>的前提下，指定这一拍的<b>创作倾向</b>——例如"整体调性阴郁压抑""多给感情线笔墨""战斗细写、日常快带过""偏慢热""每回合埋个小伏笔""主角克制隐忍"。它会<b>追加</b>在内置编剧提示词之后，只影响"写什么、往哪偏、什么调性"，<b>不动</b>核心事件 / 情节点序列 / 钩子那套结构。<b className="text-emerald-300/90">想调偏向、优先用这里。</b></div>
            <textarea
              value={outlineBias}
              onChange={(e) => setOutlineBias(e.target.value)}
              rows={3}
              placeholder="例：整体调性偏阴郁；多给主角与 XX 的关系线笔墨；战斗细写、日常快带过；每回合埋一个小伏笔…"
              className="w-full px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 resize-y focus:border-emerald-600/50 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5 pt-1 border-t border-violet-700/20">
            <div className="text-sm text-slate-200">细纲提示词 · <b className="text-amber-400/90">完全覆盖</b>（高级）</div>
            <div className="text-xs text-dim">留空 = 用内置默认（职业编剧人设 + 剧情推演 COT + 对齐示例的固定结构）。<b>一旦填写就整段替换内置提示词</b>——人设 / COT / 输出格式全以你写的为准（只想微调倾向请用上面的「偏好」，别写这里）。<b>{'{{wordTarget}}'}</b> 占位会替换成字数目标。</div>
            <textarea
              value={outlinePrompt}
              onChange={(e) => setOutlinePrompt(e.target.value)}
              rows={4}
              placeholder="（留空用内置默认细纲提示词；填了=整段覆盖内置人设 / COT / 格式）"
              className="w-full px-3 py-2 bg-black/30 border border-edge rounded-md text-sm text-slate-200 placeholder:text-dim/40 font-mono resize-y focus:border-violet-600/50 focus:outline-none"
            />
          </div>
        </div>
      )}

      <ApiRoutePicker routeKey="text" />
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
  const reorderEntry     = useSettings((s) => s.reorderTextPresetEntry);
  const renamePreset     = useSettings((s) => s.renameTextPreset);
  const updatePreset     = useSettings((s) => s.updateTextPreset);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal]         = useState(preset.name);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [pPage, setPPage]             = useState(0);
  const [dragId, setDragId]           = useState<string | null>(null);

  const entries = preset.entries ?? [];
  const pagedEntries = entries.slice(pPage * PAGE_SIZE, (pPage + 1) * PAGE_SIZE);
  const tokenCount = (s: string) => Math.round(s.length / 3.5);

  function commitName() {
    if (nameVal.trim()) renamePreset(preset.id, nameVal.trim());
    else setNameVal(preset.name);
    setEditingName(false);
  }

  function handleExport() {
    // 导出为 SillyTavern 可导入格式（entries→prompts+prompt_order+补齐标准 marker），而非 zhushen 内部 entries 格式
    const blob = new Blob([JSON.stringify(toSTPreset(preset), null, 2)], { type: 'application/json' });
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
                <div
                  key={entry.identifier}
                  draggable
                  onDragStart={(e) => { setDragId(entry.identifier); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== entry.identifier) reorderEntry(preset.id, dragId, idx_real); setDragId(null); }}
                  onDragEnd={() => setDragId(null)}
                  className={dragId === entry.identifier ? 'opacity-50' : ''}
                >
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
                    {entry.injection_position === 1 && (
                      <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-900/30 border border-emerald-500/40 text-emerald-400" title="深度注入：贴近当前生成＝高优先级（depth 越小越高）">⚡深{entry.injection_depth ?? 4}</span>
                    )}
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
      {/* 注入位置 / 优先级 */}
      <div className="space-y-1.5 border-t border-edge/30 pt-3">
        <label className="text-[12px] font-mono text-dim">注入位置（优先级）</label>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={entry.injection_position === 1 ? '1' : '0'} onChange={(e) => onChange({ injection_position: Number(e.target.value) })} className="input-base text-sm w-auto">
            <option value="0">普通（拼进 system 顶部，按数组顺序）</option>
            <option value="1">⚡深度注入（插到对话末尾、贴近当前生成＝优先级高）</option>
          </select>
          {entry.injection_position === 1 && (
            <label className="flex items-center gap-1.5 text-sm text-slate-300">
              深度
              <input type="number" min={0} max={50} value={entry.injection_depth ?? 4} onChange={(e) => onChange({ injection_depth: Number(e.target.value) })} className="input-base text-sm w-16" />
              <span className="text-[11px] text-dim/60">越小越贴近输入＝优先级越高</span>
            </label>
          )}
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
        {script.markdownOnly && <span className="text-[12px] font-mono px-1.5 py-0.5 border border-sky-700/50 text-sky-300 rounded" title="仅格式化显示：只改屏幕渲染，不进发给AI/演化的文本">仅显示</span>}
        {script.promptOnly && <span className="text-[12px] font-mono px-1.5 py-0.5 border border-amber-700/50 text-amber-300 rounded" title="仅格式化提示词：只作用于发给AI的文本，不影响显示">仅AI</span>}
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
          {/* ST 视图作用域：美化框务必选「仅显示」，否则「对AI隐藏(删空)」类正则会把正文从屏幕删掉 */}
          <div className="space-y-1">
            <label className="text-[12px] font-mono text-dim">视图作用域（SillyTavern）· 二选一或都不选</label>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Toggle checked={!!script.markdownOnly} onChange={() => onUpdate({ markdownOnly: !script.markdownOnly, ...(!script.markdownOnly ? { promptOnly: false } : {}) })} small />
                <span className="text-sm text-slate-300">仅格式化显示<span className="text-dim text-[12px] ml-1">美化框，不进AI/演化</span></span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Toggle checked={!!script.promptOnly} onChange={() => onUpdate({ promptOnly: !script.promptOnly, ...(!script.promptOnly ? { markdownOnly: false } : {}) })} small />
                <span className="text-sm text-slate-300">仅格式化提示词<span className="text-dim text-[12px] ml-1">对AI隐藏，不影响显示</span></span>
              </label>
            </div>
            <div className="text-[12px] text-dim">都不选 = 显示与发给AI都替换（旧行为）。<span className="text-sky-300">美化/包裹框（如 &lt;htm1fenge&gt;→&lt;div&gt;）务必选「仅格式化显示」</span>，否则配套的「对AI隐藏(删空)」正则会把正文从屏幕删空。</div>
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
/* AI Studio 网关接口的多 key 编辑器：一行一个，可加可删；内部以逗号拼回单串存储（HTTP header 安全，网关按逗号/空格拆分轮换） */
function ApiKeyEditor({ value, onChange, inputCls }: { value: string; onChange: (v: string) => void; inputCls: string }) {
  const [rows, setRows] = useState<string[]>(() => {
    const p = (value || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return p.length ? p : [''];
  });
  const commit = (next: string[]) => {
    setRows(next);
    onChange(next.map((r) => r.trim()).filter(Boolean).join(','));
  };
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-dim/30 w-3.5 text-right shrink-0">{i + 1}</span>
          <input type="password" value={row} placeholder={`第 ${i + 1} 个 key（AIza…）`}
            onChange={(e) => { const r = [...rows]; r[i] = e.target.value; commit(r); }}
            className={inputCls + ' flex-1'} />
          {rows.length > 1 && (
            <button onClick={() => { const r = rows.filter((_, idx) => idx !== i); commit(r.length ? r : ['']); }}
              title="删除这个 key" className="text-dim/40 hover:text-blood px-1 shrink-0 text-base leading-none">×</button>
          )}
        </div>
      ))}
      <button onClick={() => commit([...rows, ''])}
        className="text-[12px] font-mono text-god/80 hover:text-god transition-colors">+ 添加 key</button>
    </div>
  );
}

/* API 接口库：统一维护多条 LLM 接口，各功能可在其 API 设置里「快捷填入」 */
function ApiLibrarySection() {
  const library = useSettings((s) => s.apiLibrary);
  const add     = useSettings((s) => s.addApiEndpoint);
  const update  = useSettings((s) => s.updateApiEndpoint);
  const remove  = useSettings((s) => s.removeApiEndpoint);
  const move    = useSettings((s) => s.moveApiEndpoint);
  const addGw   = useSettings((s) => s.addGatewayEndpoints);
  const [gwHint, setGwHint] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});   // 每条接口的可用模型列表
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errById, setErrById] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testById, setTestById] = useState<Record<string, { ok: boolean; msg: string } | undefined>>({});
  const [vImport, setVImport] = useState<Record<string, { ok: boolean; msg: string } | undefined>>({});
  const [gwUrl, setGwUrl] = useState(() => { try { return localStorage.getItem('drpg-gateway-url') || ''; } catch { return ''; } });

  const inputCls = 'w-full bg-void border border-edge rounded px-2 py-1 text-[13px] font-mono text-slate-200 outline-none focus:border-god';

  // Vertex：直接导入服务账号 JSON 文件 → 校验 → 转 base64 存进 apiKey（HTTP header 安全；worker 本地解码用）
  function importVertexJson(epId: string, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ''));
        if (!obj.private_key || !obj.client_email) throw new Error('不像服务账号 JSON（缺 private_key / client_email）');
        update(epId, { apiKey: btoa(JSON.stringify(obj)) });
        setVImport((p) => ({ ...p, [epId]: { ok: true, msg: '已导入：' + obj.client_email } }));
      } catch (e: any) {
        setVImport((p) => ({ ...p, [epId]: { ok: false, msg: '导入失败：' + String(e?.message || e) } }));
      }
    };
    reader.onerror = () => setVImport((p) => ({ ...p, [epId]: { ok: false, msg: '读取文件失败' } }));
    reader.readAsText(file);
  }

  // 测试连接：走与正文/演化完全一致的 apiChatFallback（含流式解析），发一条极短请求，验证 CORS+鉴权+模型+上游全链路
  async function testEndpoint(ep: ApiEndpoint) {
    if (!ep.baseUrl || !ep.apiKey) { setTestById((p) => ({ ...p, [ep.id]: { ok: false, msg: '请先填地址和 Key' } })); return; }
    setTestingId(ep.id); setTestById((p) => ({ ...p, [ep.id]: undefined }));
    try {
      const { content } = await apiChatFallback(
        [endpointToConfig(ep)],
        [{ role: 'user', content: '连接测试，请只回复两个字：在的' }],
        { timeoutMs: 60000, extra: { max_tokens: 256 } },   // 短输出够测连通(2xx 兜底覆盖思考模型)；放宽超时给慢中转/推理模型留时间
      );
      setTestById((p) => ({ ...p, [ep.id]: { ok: true, msg: (content || '').trim().slice(0, 40) || '(通了，空回复)' } }));
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/HTTP\s*2\d\d/.test(msg)) {
        // 上游已 2xx（连接/鉴权/模型都通），只是没解析出文本（常见于思考模型）→ 仍算连接成功
        setTestById((p) => ({ ...p, [ep.id]: { ok: true, msg: '连接成功（本次无文本输出，思考模型所致，正文不受影响）' } }));
      } else if (e?.name === 'AbortError' || /abort/i.test(msg)) {
        // 超时被中止：多为推理模型/中转太慢，接口本身大概率可用
        setTestById((p) => ({ ...p, [ep.id]: { ok: false, msg: '超时（>60s，模型或中转响应太慢）；接口可能可用，正文用大上下文/换更快模型再试' } }));
      } else if (/localhost|127\.0\.0\.1/.test(ep.baseUrl || '') && /failed to fetch|load failed|networkerror|connection refused/i.test(msg)) {
        setTestById((p) => ({ ...p, [ep.id]: { ok: false, msg: '连不上本地 worker：先在 multiplayer-worker 跑 `npx wrangler dev`（Vertex 仅本地可用）' } }));
      } else {
        setTestById((p) => ({ ...p, [ep.id]: { ok: false, msg: msg.slice(0, 180) } }));
      }
    } finally { setTestingId(null); }
  }

  // 一键把接口「套进网关后端代理」：http 裸 IP / 无 CORS / 无 HTTPS 的中转，经 worker 服务端转发即可用（仿 SillyTavern 后端）。再点一次取消。
  // 用 gwProxyBase()：填了「本地网关地址」就走你本地 worker（你家 IP，可救 IP 锁定的中转），否则走云端。
  function toggleProxy(ep: ApiEndpoint) {
    if ((ep.baseUrl || '').includes('/api/gw/proxy')) {
      try { const orig = new URL(ep.baseUrl).searchParams.get('url'); if (orig) update(ep.id, { baseUrl: orig }); } catch { /* 解析失败就不动 */ }
    } else {
      update(ep.id, { baseUrl: `${gwProxyBase()}?url=${encodeURIComponent((ep.baseUrl || '').replace(/\/+$/, ''))}` });
    }
  }

  async function fetchModels(ep: { id: string; baseUrl: string; apiKey: string }) {
    if (!ep.baseUrl || !ep.apiKey) { setErrById((p) => ({ ...p, [ep.id]: '请先填写地址和 Key' })); return; }
    setLoadingId(ep.id); setErrById((p) => ({ ...p, [ep.id]: '' }));
    try {
      const res = await fetchWithProxy(ep.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${ep.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
      setModels((p) => ({ ...p, [ep.id]: list }));
      if (list.length === 0) setErrById((p) => ({ ...p, [ep.id]: '该接口未返回模型列表' }));
    } catch (e: any) {
      const localDown = /localhost|127\.0\.0\.1/.test(ep.baseUrl || '') && /failed to fetch|load failed|networkerror|connection refused/i.test(String(e?.message || ''));
      setErrById((p) => ({ ...p, [ep.id]: localDown ? '连不上本地 worker：先在 multiplayer-worker 跑 `npx wrangler dev`（Vertex 仅本地可用）' : (e.message ?? '获取失败') }));
    } finally { setLoadingId(null); }
  }

  return (
    <div className="space-y-3">
      <SectionTitle title="API 接口库" desc="统一填写并管理 LLM 接口（可多条）。各功能的 API 设置页可「⚡ 接口库快捷填入」，不必逐个手填。Key 仅存本地浏览器。" />
      <div className="rounded-lg border border-edge/60 bg-panel px-3 py-2 space-y-1">
        <div className="text-[12px] font-mono text-dim/60">本地网关地址<span className="text-dim/40">（选填 · 解决「本地能用、线上 403」的 IP 锁定中转，仿 SillyTavern 本地后端）</span></div>
        <input value={gwUrl}
          onChange={(e) => { const v = e.target.value; setGwUrl(v); try { v.trim() ? localStorage.setItem('drpg-gateway-url', v.trim()) : localStorage.removeItem('drpg-gateway-url'); } catch { /* ignore */ } }}
          placeholder="留空=云端网关；本机填 http://localhost:8787；手机填 http://电脑局域网IP:8787" className={inputCls} />
        <div className="text-[11px] text-dim/40 font-mono">填了之后，中转经「你本地跑的 worker（你家 IP）」转发，中转看到的是你家 IP（和本地直连一样）。需先在 multiplayer-worker 跑 <code className="text-god">npx wrangler dev</code>。</div>
      </div>
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
                {(ep.baseUrl || '').includes('/api/gw/aistudio') ? (
                  <div className="space-y-1">
                    <span className="text-[12px] font-mono text-dim/50 block">API Key<span className="text-dim/30"> · 一行一个，网关自动轮换 + 限额(429)自动切换</span></span>
                    <ApiKeyEditor value={ep.apiKey} onChange={(v) => update(ep.id, { apiKey: v })} inputCls={inputCls} />
                  </div>
                ) : (ep.baseUrl || '').includes('/api/gw/vertex') ? (
                  <div className="space-y-1">
                    <span className="text-[12px] font-mono text-dim/50 block">API Key<span className="text-dim/30"> · 线上：填 VERTEX_GATE 口令；本地：「📁 导入 JSON」或 base64</span></span>
                    <div className="flex gap-2 items-center">
                      <input type="password" value={ep.apiKey} onChange={(e) => update(ep.id, { apiKey: e.target.value })} placeholder="线上填口令 / 本地导入服务账号" className={inputCls + ' flex-1'} />
                      {/(localhost|127\.0\.0\.1)/.test(ep.baseUrl || '') && (
                        <label className="shrink-0 px-2.5 py-1 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 cursor-pointer transition-colors whitespace-nowrap">
                          📁 导入 JSON
                          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importVertexJson(ep.id, f); e.currentTarget.value = ''; }} />
                        </label>
                      )}
                    </div>
                    {vImport[ep.id] && <div className={`text-[11px] font-mono ${vImport[ep.id]!.ok ? 'text-god' : 'text-blood'}`}>{vImport[ep.id]!.ok ? '✅ ' : '❌ '}{vImport[ep.id]!.msg}</div>}
                  </div>
                ) : (
                  <label className="space-y-1 block"><span className="text-[12px] font-mono text-dim/50">API Key</span><input type="password" value={ep.apiKey} onChange={(e) => update(ep.id, { apiKey: e.target.value })} placeholder="sk-..." className={inputCls} /></label>
                )}
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
                <div className="flex items-center gap-2 pt-0.5">
                  <button onClick={() => testEndpoint(ep)} disabled={testingId === ep.id}
                    className="shrink-0 px-2.5 py-1 text-[12px] font-mono border border-god/40 text-god rounded hover:bg-god/10 disabled:opacity-40 transition-colors">
                    {testingId === ep.id ? '测试中…' : '🔌 测试连接'}
                  </button>
                  {!/\/api\/gw\/(aistudio|vertex)/.test(ep.baseUrl || '') && (
                    <button onClick={() => toggleProxy(ep)} title="http裸IP / 无CORS / 无HTTPS 的中转，套上网关后端转发即可用（仿 SillyTavern 后端）"
                      className="shrink-0 px-2.5 py-1 text-[12px] font-mono border border-edge text-dim hover:text-god hover:border-god/40 rounded transition-colors">
                      {(ep.baseUrl || '').includes('/api/gw/proxy') ? '↩ 取消代理' : '🛡 经网关代理'}
                    </button>
                  )}
                  {testById[ep.id] && (
                    <span className={`text-[11px] font-mono truncate ${testById[ep.id]!.ok ? 'text-god' : 'text-blood'}`}>
                      {testById[ep.id]!.ok ? '✅ ' : '❌ '}{testById[ep.id]!.msg}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="flex divide-x divide-edge/50">
          <button onClick={add} className="flex-1 px-3 py-2.5 text-sm font-mono text-god hover:bg-god/5 transition-colors">+ 添加接口</button>
          <button onClick={() => { addGw(); setGwHint(true); }} title="一键添加指向你 Cloudflare 反代网关的 AI Studio + Vertex 两条接口"
            className="flex-1 px-3 py-2.5 text-sm font-mono text-god/90 hover:bg-god/5 transition-colors">⚡ 一键填入 AI Studio / Vertex 网关</button>
        </div>
      </div>
      {gwHint && (
        <div className="text-[12px] font-mono text-god/80 bg-god/5 border border-god/30 rounded px-2.5 py-2 leading-relaxed space-y-1">
          <div>✅ 已加入 <b>AI Studio (网关)</b> + <b>Vertex (网关·本地)</b> 两条接口：</div>
          <div>· <b>AI Studio (网关)</b> → 线上网关，API Key 填你的 <b>AI Studio key</b>（aistudio.google.com/apikey）；点「刷新模型」可拉全量。</div>
          <div>· <b>Vertex (网关)</b> → 线上免本地：worker 设 <code className="text-god">VERTEX_SA_JSON</code> + <code className="text-god">VERTEX_GATE</code> 两个密钥再 deploy，本接口 API Key 填那个口令即可（手机也能用）。</div>
          <div className="text-dim/50">填好点「🔌 测试连接」自检。</div>
        </div>
      )}
      <div className="text-[12px] text-dim/40 font-mono px-1">在各功能的「API 设置」页选「⚡ 接口库快捷填入」即可一键套用此处接口，无需重复填写。</div>
      <ApiSlotAudit />
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
  const disableEnterSend    = useSettings((s) => s.disableEnterSend);
  const setDisableEnterSend = useSettings((s) => s.setDisableEnterSend);
  const showNewlineButton    = useSettings((s) => s.showNewlineButton);
  const setShowNewlineButton = useSettings((s) => s.setShowNewlineButton);
  const advancePresets       = useSettings((s) => s.advancePresets);
  const advanceSelected      = useSettings((s) => s.advanceSelected);
  const autoAdvance          = useSettings((s) => s.autoAdvance);
  const setAdvancePresets    = useSettings((s) => s.setAdvancePresets);
  const setAdvanceSelected   = useSettings((s) => s.setAdvanceSelected);
  const setAutoAdvance       = useSettings((s) => s.setAutoAdvance);
  // 数据库推进管线（Stitches 规划层）
  const dbAdvEnabled     = useDbAdvance((s) => s.enabled);
  const dbAdvUseRecall   = useDbAdvance((s) => s.useRecall);
  const dbAdvPresetName  = useDbAdvance((s) => s.presetName);
  const dbAdvHasPreset   = useDbAdvance((s) => !!s.preset);
  const [dbAdvMsg, setDbAdvMsg] = useState('');
  const [dbEditorOpen, setDbEditorOpen] = useState(false);   // 数据库推进预设编辑器
  const weatherFx            = useSettings((s) => s.weatherFx);
  const setWeatherFx         = useSettings((s) => s.setWeatherFx);
  const audio                = useSettings((s) => s.audio);
  const setAudio             = useSettings((s) => s.setAudio);
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

      {/* 输入行为 */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">输入行为</div>
        <div className="flex items-start gap-3 border border-edge rounded-lg p-4 bg-panel">
          <Toggle checked={disableEnterSend} onChange={() => setDisableEnterSend(!disableEnterSend)} />
          <div>
            <div className="text-sm font-semibold text-slate-200">禁用回车发送</div>
            <div className="text-sm text-dim mt-1 leading-relaxed">开启后，输入框按回车（Enter）不再发送消息，只能点击发送按钮 ▶，防止打字时误触发送。</div>
          </div>
        </div>
        <div className="flex items-start gap-3 border border-edge rounded-lg p-4 bg-panel">
          <Toggle checked={showNewlineButton} onChange={() => setShowNewlineButton(!showNewlineButton)} />
          <div>
            <div className="text-sm font-semibold text-slate-200">显示换行键</div>
            <div className="text-sm text-dim mt-1 leading-relaxed">在正文输入框旁显示「↵ 换行」按钮，点击即可在光标处插入换行。关闭后仍可用 <span className="font-mono text-god/70">Shift+Enter</span> 换行。</div>
          </div>
        </div>
      </div>

      {/* ⏩ 推进 / 循环自动推进 */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">⏩ 推进 / 循环自动推进</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">
            输入框旁的 <span className="text-emerald-300">⏩</span> ＝不打字也让剧情自然推进一拍；<span className="text-emerald-300">🔁</span> ＝自动连推数拍（下面设次数/间隔，你一发送就停）。
          </div>

          {/* 推进语预设 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-300">推进语预设（选中的一条被 ⏩/🔁 使用）</span>
              <button onClick={() => setAdvancePresets([...(advancePresets ?? []), { name: '新预设', text: '' }])}
                className="text-[11px] px-2 py-0.5 rounded border border-god/40 text-god hover:bg-god/10">+ 加一条</button>
              <button onClick={() => { setAdvancePresets(ADVANCE_PRESET_BUILTINS.map((p) => ({ ...p }))); setAdvanceSelected(0); }}
                className="text-[11px] px-2 py-0.5 rounded border border-edge text-dim hover:text-god hover:border-god/40">↺ 载入内置</button>
              {(!advancePresets || advancePresets.length === 0) && <span className="text-[11px] text-dim/60">（空＝用内置默认推进语）</span>}
            </div>
            {(advancePresets ?? []).map((p, i) => (
              <div key={i} className="flex gap-2 items-start border border-edge rounded p-2 bg-panel2/40">
                <input type="radio" name="advSel" checked={advanceSelected === i} onChange={() => setAdvanceSelected(i)}
                  className="mt-2 accent-god shrink-0" title="设为 ⏩/🔁 使用的推进语" />
                <div className="flex-1 space-y-1 min-w-0">
                  <input value={p.name} onChange={(e) => setAdvancePresets((advancePresets ?? []).map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                    placeholder="预设名" className="w-full bg-panel2 border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god/50" />
                  <textarea value={p.text} onChange={(e) => setAdvancePresets((advancePresets ?? []).map((x, idx) => idx === i ? { ...x, text: e.target.value } : x))}
                    rows={2} placeholder="推进语（作为 OOC 指令随本回合发给正文 AI）"
                    className="w-full bg-panel2 border border-edge rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-god/50 resize-y" />
                </div>
                <button onClick={() => { setAdvancePresets((advancePresets ?? []).filter((_, idx) => idx !== i)); if (advanceSelected >= i && advanceSelected > 0) setAdvanceSelected(advanceSelected - 1); }}
                  className="text-blood/70 hover:text-blood px-1 pt-1.5 shrink-0" title="删除">✕</button>
              </div>
            ))}
          </div>

          {/* 自动推进参数 */}
          <div className="flex items-center gap-4 flex-wrap text-sm text-dim border-t border-edge/60 pt-3">
            <span className="text-xs font-semibold text-slate-300">🔁 循环自动推进：</span>
            <label className="flex items-center gap-1.5">连推
              <input type="number" min={1} value={autoAdvance?.maxLoops ?? 3}
                onChange={(e) => setAutoAdvance({ maxLoops: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                className="w-16 bg-panel2 border border-edge rounded px-1.5 py-0.5 text-center text-slate-200 outline-none focus:border-god/50" /> 拍</label>
            <label className="flex items-center gap-1.5">每拍间隔
              <input type="number" min={0} step={100} value={autoAdvance?.delayMs ?? 1500}
                onChange={(e) => setAutoAdvance({ delayMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                className="w-20 bg-panel2 border border-edge rounded px-1.5 py-0.5 text-center text-slate-200 outline-none focus:border-god/50" /> ms</label>
          </div>
        </div>
      </div>

      {/* 🎬 数据库推进管线（Stitches 规划层） */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">🎬 数据库推进管线（导演规划层）</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">
            导入数据库「推进预设」（如 Stitches 东方风神录）。开启后，**每回合正文前**先跑它的「召回→推进」规划：产出这一拍的角色行动/场景/跟踪表，注入你的**正文预设**去写散文——<b>预设只做规划，正文仍由你的正文预设生成</b>。（会多 1~2 次 AI 调用，走下方<b>独立「数据库推进」接口路由</b>；未单独指定则回退正文 API；有墙钟超时，绝不卡正文。）
          </div>

          <div className="flex items-start gap-3">
            <Toggle checked={dbAdvEnabled} onChange={() => { const v = !dbAdvEnabled; useDbAdvance.getState().setEnabled(v); if (v) { useSettings.getState().setPlotGuidance(false); useSettings.getState().setOutlineEnabled(false); } }} />
            <div>
              <div className="text-sm font-semibold text-slate-200">启用数据库推进管线<span className="text-xs text-amber-400/80 ml-1">· 与「剧情指导 / 细纲」三选一</span></div>
              <div className="text-sm text-dim mt-1 leading-relaxed">{dbAdvHasPreset ? <>当前预设：<span className="text-god/80 font-mono">{dbAdvPresetName || '（未命名）'}</span></> : <span className="text-amber-300/80">尚未导入推进预设 —— 先「载入内置」或「导入 JSON」。</span>}</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Toggle checked={dbAdvUseRecall} onChange={() => useDbAdvance.getState().setUseRecall(!dbAdvUseRecall)} />
            <div>
              <div className="text-sm font-semibold text-slate-200">跑「召回」子调用</div>
              <div className="text-sm text-dim mt-1 leading-relaxed">开：先让预设的「召回」模块找相关历史记忆喂给推进（更连贯，多一次调用）。关：跳过召回、只跑「推进」，省一次调用（<span className="font-mono">{'{{recall}}'}</span> 留空）。</div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setDbAdvMsg('载入中…');
                fetch('db-presets/stitches-mof.json').then((r) => r.json()).then((j) => {
                  const ok = useDbAdvance.getState().importPreset(j);
                  setDbAdvMsg(ok ? '✓ 已载入内置 Stitches（东方风神录）' : '✗ 内置预设解析失败');
                }).catch(() => setDbAdvMsg('✗ 载入失败（缺 public/db-presets/stitches-mof.json？）'));
                setTimeout(() => setDbAdvMsg(''), 6000);
              }}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-god/40 text-god hover:bg-god/10 font-mono"
            >↺ 载入内置 Stitches</button>
            <label className="text-[12px] px-3 py-1.5 rounded-lg border border-edge text-dim hover:text-god hover:border-god/40 font-mono cursor-pointer">
              📥 导入 JSON
              <input type="file" accept=".json,application/json" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  f.text().then((t) => {
                    try { const ok = useDbAdvance.getState().importPreset(JSON.parse(t), f.name.replace(/\.json$/i, '')); setDbAdvMsg(ok ? `✓ 已导入 ${f.name}` : '✗ 该 JSON 非有效推进预设（缺 plotTasks）'); }
                    catch { setDbAdvMsg('✗ JSON 解析失败'); }
                    setTimeout(() => setDbAdvMsg(''), 6000);
                  });
                  e.target.value = '';
                }} />
            </label>
            <button onClick={() => setDbEditorOpen(true)} disabled={!dbAdvHasPreset}
              title={dbAdvHasPreset ? '在应用内改预设模块的提示词——给召回/推进缝破限，治 AI 拒答→空回' : '先载入/导入预设'}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-god/40 text-god hover:bg-god/10 font-mono disabled:opacity-40">✏️ 编辑预设 · 缝破限</button>
            <button onClick={() => { useDbAdvance.getState().clearRuntime(); setDbAdvMsg('✓ 已清空上轮跟踪表'); setTimeout(() => setDbAdvMsg(''), 4000); }}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-edge text-dim hover:text-slate-200 font-mono">🧹 清上轮记录</button>
            {dbAdvMsg && <span className="text-[12px] text-god/80">{dbAdvMsg}</span>}
          </div>
          {dbEditorOpen && <DbAdvancePresetEditor onClose={() => setDbEditorOpen(false)} />}

          {/* 独立接口路由：数据库推进的「召回/推进」子调用单独指定接口；留空则回退正文 API（不再蹭剧情指导的 guidance 路由） */}
          <div className="pt-2 space-y-1.5 border-t border-edge/60">
            <div className="text-[12px] font-mono text-god/70">🎬 数据库推进 · 接口路由</div>
            <ApiRoutePicker routeKey="dbadvance" />
          </div>

          <DbAdvanceInspector />
        </div>
      </div>

      {/* 界面显示 */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">界面显示</div>
        <div className="flex items-start gap-3 border border-edge rounded-lg p-4 bg-panel">
          <Toggle checked={weatherFx} onChange={() => setWeatherFx(!weatherFx)} />
          <div>
            <div className="text-sm font-semibold text-slate-200">顶栏天气特效（天启）</div>
            <div className="text-sm text-dim mt-1 leading-relaxed">任务世界有天气时，顶栏铺一层动态天空背景：雨丝 / 飘雪 / 雾烟 / 雷闪 / 风卷落叶 + 太阳·流云等粒子动画。关闭后顶栏维持原暗色、零性能开销，适合低配设备或想专注阅读时。回归乐园本就无此效果。</div>
          </div>
        </div>
      </div>

      {/* 音效 */}
      <div className="space-y-4">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">音效</div>
        <div className="flex items-start gap-3 border border-edge rounded-lg p-4 bg-panel">
          <Toggle checked={audio.enabled} onChange={() => setAudio({ enabled: !audio.enabled })} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-200">游戏音效</div>
            <div className="text-sm text-dim mt-1 leading-relaxed">开启后：掷骰 / 战斗命中·暴击·格挡 / 世界结算 / 升级 / 赌坊 / 聊天室新消息 等播放音效；随天气放环境音（雨·雷·雪·风·雾）；并循环播放 <span className="font-mono text-god/70">public/audio/bgm/</span> 里的背景音乐。音频文件放在 <span className="font-mono text-god/70">public/audio/</span> 下，<span className="text-dim/60">缺文件不报错、自动跳过</span>；引擎懒加载（Howler），不进主包。</div>
            {audio.enabled && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-dim/70 w-14 shrink-0">总音量</span>
                  <input type="range" min={0} max={100} step={1} value={Math.round(audio.volume * 100)} onChange={(e) => setAudio({ volume: (parseInt(e.target.value) || 0) / 100 })} className="flex-1" />
                  <span className="text-[12px] font-mono text-god/80 w-10 text-right">{Math.round(audio.volume * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Toggle checked={audio.ambient} onChange={() => setAudio({ ambient: !audio.ambient })} />
                  <span className="text-[12px] text-dim/70 w-14 shrink-0">环境音</span>
                  <input type="range" min={0} max={100} step={1} value={Math.round(audio.ambientVolume * 100)} disabled={!audio.ambient} onChange={(e) => setAudio({ ambientVolume: (parseInt(e.target.value) || 0) / 100 })} className="flex-1 disabled:opacity-40" />
                  <span className="text-[12px] font-mono text-god/80 w-10 text-right">{Math.round(audio.ambientVolume * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <Toggle checked={audio.music} onChange={() => setAudio({ music: !audio.music })} />
                  <span className="text-[12px] text-dim/70 w-14 shrink-0">背景音乐</span>
                  <input type="range" min={0} max={100} step={1} value={Math.round(audio.musicVolume * 100)} disabled={!audio.music} onChange={(e) => setAudio({ musicVolume: (parseInt(e.target.value) || 0) / 100 })} className="flex-1 disabled:opacity-40" />
                  <span className="text-[12px] font-mono text-god/80 w-10 text-right">{Math.round(audio.musicVolume * 100)}%</span>
                </div>
                {audio.music && (
                  <div className="flex items-center gap-2 pl-[52px]">
                    <label className="flex items-center gap-2 cursor-pointer text-[12px] text-dim/70">
                      <input type="checkbox" checked={audio.musicShuffle} onChange={(e) => setAudio({ musicShuffle: e.target.checked })} className="accent-god" />
                      随机播放
                    </label>
                    <span className="text-[11px] text-dim/50">· 把音乐文件丢进 <span className="font-mono text-god/60">public/audio/bgm/</span>（多首自动组成播放列表，左下角出现迷你播放器）</span>
                  </div>
                )}
              </div>
            )}
          </div>
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
            <span className="font-mono text-god/70"> {'${主角名}'} {'${年龄}'} {'${性格}'} {'${性格描述}'} {'${入园前职业}'} {'${乐园}'} {'${难度}'} {'${性别}'} {'${种族}'} {'${种族详情}'} {'${外观}'} {'${天赋名}'} {'${天赋效果}'} {'${契约者ID}'}</span>
            <div className="mt-1 text-dim/60">天赋（固定格式）：<span className="font-mono text-god/70">{'${天赋全文}'}</span> = 整行固定格式（含评级/类型/等级/来源/效果/属性加成/简描）；也可单取 <span className="font-mono text-god/70">{'${天赋评级}'} {'${天赋类型}'} {'${天赋等级}'} {'${天赋来源}'} {'${天赋属性加成}'} {'${天赋描述}'}</span>。</div>
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

/* ─── 界面外观：正文阅读区字体排版（字号/字间距/行距），写入 settings.reading，正文楼层与此处预览共用 .narrative-content + CSS 变量 ─── */
const READ_FONT_SIZES    = [{ label: '小', v: 15 }, { label: '标准', v: 17 }, { label: '大', v: 19 }, { label: '特大', v: 22 }];
const READ_LETTER_SPACES = [{ label: '标准', v: 0 }, { label: '适中', v: 0.5 }, { label: '宽松', v: 1 }, { label: '超宽', v: 2 }];
const READ_LINE_HEIGHTS  = [{ label: '紧凑', v: 1.6 }, { label: '标准', v: 1.8 }, { label: '宽松', v: 2.1 }, { label: '超宽', v: 2.4 }];

function ReadingOptionRow({ title, desc, opts, cur, onPick, fmt }: {
  title: string; desc: string; opts: { label: string; v: number }[]; cur: number; onPick: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-mono text-god/70 uppercase tracking-widest">{title}</div>
      <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
        <div className="text-sm text-dim leading-relaxed">{desc}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {opts.map((o) => (
            <button key={o.v} onClick={() => onPick(o.v)}
              className={`px-2 py-2.5 rounded-lg border text-sm font-mono transition-colors ${
                cur === o.v ? 'border-god/60 bg-god/15 text-god' : 'border-edge bg-void/40 text-dim hover:border-god/30 hover:text-slate-300'}`}>
              <div className="font-semibold">{o.label}</div>
              <div className="text-[11px] opacity-60 mt-0.5">{fmt(o.v)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const APPEARANCE_TINTS: { key: 'classic' | 'eyecare' | 'warm'; label: string; desc: string; sw: string }[] = [
  { key: 'classic', label: '经典',     desc: '原版青光黑底',   sw: 'linear-gradient(135deg,#070a10,#0e141d)' },
  { key: 'eyecare', label: '柔光护眼', desc: '暖白·弱化光晕',   sw: 'linear-gradient(135deg,#11161f,#f4efe6)' },
  { key: 'warm',    label: '夜读暖光', desc: '滤蓝光·暖色调',   sw: 'linear-gradient(135deg,#11161f,#f2e1bb)' },
];

function AppearanceSettingsSection() {
  const reading    = useSettings((s) => s.reading);
  const setReading = useSettings((s) => s.setReading);
  const appearance    = useSettings((s) => s.appearance);
  const setAppearance = useSettings((s) => s.setAppearance);
  const uiVignette    = useSettings((s) => s.uiVignette);
  const setUiVignette = useSettings((s) => s.setUiVignette);
  const holoCardFx    = useSettings((s) => s.holoCardFx);
  const setHoloCardFx = useSettings((s) => s.setHoloCardFx);
  const uiTheme    = useSettings((s) => s.uiTheme);
  const setUiTheme = useSettings((s) => s.setUiTheme);
  const language    = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const autoTranslateOnline    = useSettings((s) => s.autoTranslateOnline);
  const setAutoTranslateOnline = useSettings((s) => s.setAutoTranslateOnline);
  const autoTranslateEngine    = useSettings((s) => s.autoTranslateEngine);
  const setAutoTranslateEngine = useSettings((s) => s.setAutoTranslateEngine);
  const autoTranslateManual    = useSettings((s) => s.autoTranslateManual);
  const setAutoTranslateManual = useSettings((s) => s.setAutoTranslateManual);
  const setUserGlossary        = useSettings((s) => s.setUserGlossary);
  const evolveOutputLang       = useSettings((s) => s.evolveOutputLang);
  const setEvolveOutputLang    = useSettings((s) => s.setEvolveOutputLang);
  const ff = reading.fontFamily || 'default';
  return (
    <div className="space-y-8">
      <SectionTitle title="界面外观美化" desc="主题配色 / 护眼色调 / 暗角 / 正文字体与排版，实时生效（不改变存档、也不发送给 AI）。" />

      {/* 界面语言：简体（源码原样）/ 繁體（OpenCC 运行时转换·台湾正体）/ English（人工词库·核心界面）。
          只译界面 chrome，AI 生成的剧情正文始终保持原语言、不受影响。 */}
      <div className="space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">界面语言</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">
            切换界面显示语言。<b className="text-slate-300">繁體中文</b>自动转换全部界面（台湾正体·惯用词）；<b className="text-slate-300">English</b> / <b className="text-slate-300">Tiếng Việt</b> 为人工本地化、覆盖核心界面，未翻译处暂显中文，后续补齐。AI 生成的剧情正文不受影响，始终保持原语言。
          </div>
          {/* data-no-i18n：语言名恒以本语言原文呈现（标准语言选择器惯例），不被翻译层改写 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-no-i18n>
            {[
              { key: 'zh-Hans', label: '简体中文',   desc: '源码原样' },
              { key: 'zh-Hant', label: '繁體中文',   desc: '台灣正體' },
              { key: 'en',      label: 'English',    desc: 'Core UI' },
              { key: 'vi',      label: 'Tiếng Việt', desc: 'Bản địa hoá' },
            ].map((o) => (
              <button key={o.key} onClick={() => setLanguage(o.key as 'zh-Hans' | 'zh-Hant' | 'en' | 'vi')}
                className={`px-2 py-2.5 rounded-lg border text-sm font-mono transition-colors ${
                  language === o.key ? 'border-god/60 bg-god/15 text-god' : 'border-edge bg-void/40 text-dim hover:border-god/30 hover:text-slate-300'}`}>
                <div className="font-semibold">{o.label}</div>
                <div className="text-[11px] opacity-60 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
          {/* 演化内容直接用当前语言生成：在各演化提示词注入「输出语言」指令 */}
          {(language === 'en' || language === 'vi') && (
            <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
              <input type="checkbox" checked={evolveOutputLang} onChange={(e) => setEvolveOutputLang(e.target.checked)} className="accent-god w-4 h-4 mt-0.5" />
              <span>
                <span className="text-sm text-slate-300">内容用当前语言生成{language === 'vi' ? '（正文＋演化）' : '（演化）'}</span>
                <span className="block text-[12px] text-dim/60 leading-relaxed">开：让 AI 直接用{language === 'en' ? '英文' : '越南语'}生成演化内容（物品/NPC/势力等名称＋描述），省机翻。{language === 'vi' ? '越南语下还会让正文 API 一起输出越南语 → 正文与数据名称对齐、无脱节。' : '英文下仅演化用英文、正文仍中文 → 名称可能对不上、偶发重复条目；在意剧情-数据一致就关掉、改用「显示层机翻」。'}结构/字段/枚举/数字始终保持中文以防解析出错。</span>
              </span>
            </label>
          )}
          {/* 在线内容自动机翻：交易行/聊天室等跨玩家 UGC 用玩家自己的 AI 接口译成当前语言（缓存·简体基本不触发） */}
          <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
            <input type="checkbox" checked={autoTranslateOnline} onChange={(e) => setAutoTranslateOnline(e.target.checked)} className="accent-god w-4 h-4 mt-0.5" />
            <span>
              <span className="text-sm text-slate-300">自动机翻补全（界面 + 在线内容）</span>
              <span className="block text-[12px] text-dim/60 leading-relaxed">词库没收录的界面文字、以及交易行/聊天室等跨玩家内容，自动机翻成当前语言（英/越生效 · 结果永久缓存 · 中文→繁體走本地转换不耗额度）</span>
            </span>
          </label>
          {autoTranslateOnline && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              {[
                { key: 'ai',   label: 'AI 翻译',  desc: '最地道 · 耗 API 额度' },
                { key: 'free', label: '免费机翻', desc: '不耗额度 · MyMemory' },
              ].map((o) => (
                <button key={o.key} onClick={() => setAutoTranslateEngine(o.key as 'ai' | 'free')}
                  className={`px-2 py-2 rounded-lg border text-sm font-mono transition-colors ${autoTranslateEngine === o.key ? 'border-god/60 bg-god/15 text-god' : 'border-edge bg-void/40 text-dim hover:border-god/30 hover:text-slate-300'}`}>
                  <div className="font-semibold">{o.label}</div>
                  <div className="text-[11px] opacity-60 mt-0.5">{o.desc}</div>
                </button>
              ))}
            </div>
          )}
          {/* 手动触发：机翻不自动跑，靠右下角悬浮「🌐 译」按钮点触，省额度 */}
          {autoTranslateOnline && (
            <label className="flex items-start gap-2.5 pl-6 cursor-pointer select-none">
              <input type="checkbox" checked={autoTranslateManual} onChange={(e) => setAutoTranslateManual(e.target.checked)} className="accent-god w-4 h-4 mt-0.5" />
              <span>
                <span className="text-sm text-slate-300">仅 AI 翻译手动触发（省额度）</span>
                <span className="block text-[12px] text-dim/60 leading-relaxed">开：只有 <b>AI 引擎</b>不自动跑（省 API 额度）；<b>免费机翻(MyMemory)仍自动补全</b>、零额度——所以界面基本全自动译好。想要更地道的 AI 译文时点右下角「🌐」。关：所选引擎（含 AI）全自动跑。</span>
              </span>
            </label>
          )}
          {/* AI 翻译专用接口路由：不填=复用正文/世界 API；填了就用这条独立接口做机翻，跟游戏正文互不抢额度 */}
          {autoTranslateOnline && autoTranslateEngine === 'ai' && (
            <div className="pl-6 space-y-1">
              <div className="text-[11px] text-dim/50 leading-relaxed">翻译专用接口（从「综合设置 → API 接口库」里选一条；留空=复用正文/世界 API）：</div>
              <ApiRoutePicker routeKey="autotranslate" />
            </div>
          )}
          {/* 翻译映射表 导出/导入：导出「全站界面中文→当前语言」表（已译预填、未译留空）→ 线下编辑优化 → 导入覆盖（你的译文优先） */}
          {(language === 'en' || language === 'vi') && (
            <div className="pl-6 space-y-1.5">
              <div className="text-[11px] text-dim/50 leading-relaxed">翻译映射表：导出「中文 → {language === 'en' ? 'English' : 'Tiếng Việt'}」表(已译预填/未译留空)，线下编辑后导入,你的译文优先于内置词库与机翻。</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => { try { const n = await exportGlossary(language); window.alert(`已导出 ${n} 条翻译表（zhushen-translation-${language}.json）。编辑后从「导入」传回。`); } catch (e: any) { window.alert('导出失败：' + (e?.message || e)); } }}
                  className="px-3 py-1.5 rounded-lg border border-edge text-[12px] font-mono text-slate-300 hover:border-god/40 hover:text-god transition-colors">⬇ 导出翻译表</button>
                <label className="px-3 py-1.5 rounded-lg border border-edge text-[12px] font-mono text-slate-300 hover:border-god/40 hover:text-god transition-colors cursor-pointer">
                  ⬆ 导入翻译表
                  <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; e.currentTarget.value = ''; if (!f) return;
                    const rd = new FileReader();
                    rd.onload = () => {
                      try {
                        const map = parseGlossaryImport(String(rd.result));
                        if (!Object.keys(map).length) { window.alert('没解析到有效条目（需 {中文:译文} 对象或 [[中文,译文]] 数组，空译文会跳过）。'); return; }
                        setUserGlossary(language, map);
                        window.alert(`已导入 ${Object.keys(map).length} 条译文，即将刷新生效。`);
                        setTimeout(() => location.reload(), 300);
                      } catch (err: any) { window.alert('导入失败：' + (err?.message || err)); }
                    };
                    rd.readAsText(f);
                  }} />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 主题配色：整体界面色 + 文字色，多套开源配色（Solarized / Gruvbox / Nord / Dracula / Tokyo Night）*/}
      <div className="space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">主题配色</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">一键切换整体界面色与文字色。含浅色「羊皮纸 / 暖阳」（暖黄底、深色字，久看更柔和）与多套暗色主题，取材自知名开源配色。</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {UI_THEMES.map((t) => (
              <button key={t.key} onClick={() => setUiTheme(t.key)}
                className={`rounded-lg border p-2 text-left transition-colors ${uiTheme === t.key ? 'border-god/70 ring-1 ring-god/40' : 'border-edge hover:border-god/40'}`}>
                <div className="h-10 rounded-md mb-1.5 flex items-center gap-1.5 px-2 overflow-hidden border border-black/10" style={{ background: t.swatch.bg }}>
                  <span className="text-base font-bold leading-none" style={{ color: t.swatch.ink }}>永</span>
                  <span className="text-[11px] leading-none" style={{ color: t.swatch.ink, opacity: 0.65 }}>Aa</span>
                  <span className="flex-1" />
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: t.swatch.accent }} />
                </div>
                <div className="text-[13px] font-semibold font-mono text-slate-200">{t.label}</div>
                <div className="text-[10px] text-dim/60 leading-tight truncate">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 护眼色调（全局滤镜）+ 暗角 */}
      <div className="space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">护眼色调</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">全局柔化滤镜：把刺眼的纯白高亮压成暖白、降低「光晕」并滤蓝光，深色背景几乎不变——长时间阅读更不易疲劳。「经典」=关闭、零开销。</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {APPEARANCE_TINTS.map((o) => (
              <button key={o.key} onClick={() => setAppearance(o.key)}
                className={`px-2 py-2.5 rounded-lg border text-sm font-mono transition-colors ${
                  appearance === o.key ? 'border-god/60 bg-god/15 text-god' : 'border-edge bg-void/40 text-dim hover:border-god/30 hover:text-slate-300'}`}>
                <div className="h-5 rounded mb-1.5 border border-edge/60" style={{ background: o.sw }} />
                <div className="font-semibold">{o.label}</div>
                <div className="text-[11px] opacity-60 mt-0.5">{o.desc}</div>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input type="checkbox" checked={uiVignette} onChange={(e) => setUiVignette(e.target.checked)} className="accent-god w-4 h-4" />
            <span className="text-sm text-slate-300">背景暗角</span>
            <span className="text-[12px] text-dim/60">四周轻微压暗、聚焦中央正文（纯视觉氛围）</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={holoCardFx} onChange={(e) => setHoloCardFx(e.target.checked)} className="accent-god w-4 h-4" />
            <span className="text-sm text-slate-300">全息卡片特效</span>
            <span className="text-[12px] text-dim/60">立绘 / 物品 / 装备放大检视显示全息卡（箔纸 · 旋转 · 2.5D）；关=普通图片</span>
          </label>
        </div>
      </div>

      {/* 正文字体 */}
      <div className="space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">正文字体</div>
        <div className="border border-edge rounded-lg p-4 bg-panel space-y-3">
          <div className="text-sm text-dim leading-relaxed">AI 正文楼层的字体。「霞鹜文楷」已内置（按需加载用到的字形、无需联网）；「宋体」用系统字体。</div>
          <div className="grid grid-cols-3 gap-2">
            {(['default', 'kai', 'song'] as const).map((k) => (
              <button key={k} onClick={() => setReading({ fontFamily: k })}
                className={`px-2 py-3 rounded-lg border transition-colors ${
                  ff === k ? 'border-god/60 bg-god/15 text-god' : 'border-edge bg-void/40 text-dim hover:border-god/30 hover:text-slate-300'}`}>
                <div className="text-xl leading-none mb-2" style={{ fontFamily: readingFontStack(k) }}>永恒契约</div>
                <div className="font-semibold text-sm font-mono">{READING_FONTS[k].label}</div>
                <div className="text-[11px] opacity-60 mt-0.5">{READING_FONTS[k].desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ReadingOptionRow title="字体大小" desc="正文文字的字号大小。" opts={READ_FONT_SIZES} cur={reading.fontSize} onPick={(v) => setReading({ fontSize: v })} fmt={(v) => `${v}px`} />
      <ReadingOptionRow title="字间距" desc="文字之间的横向间隔。" opts={READ_LETTER_SPACES} cur={reading.letterSpacing} onPick={(v) => setReading({ letterSpacing: v })} fmt={(v) => v === 0 ? 'normal' : `${v}px`} />
      <ReadingOptionRow title="行间距" desc="正文段落内行与行的高度。" opts={READ_LINE_HEIGHTS} cur={reading.lineHeight} onPick={(v) => setReading({ lineHeight: v })} fmt={(v) => `${v}×`} />
      <div className="space-y-3">
        <div className="text-sm font-mono text-god/70 uppercase tracking-widest">实时预览</div>
        <div className="border border-edge rounded-lg p-5 bg-void/40">
          <div className="text-slate-300 narrative-content"
            style={{ fontSize: `${reading.fontSize}px`, letterSpacing: `${reading.letterSpacing}px`, fontFamily: readingFontStack(ff), '--narr-lh': String(reading.lineHeight) } as any}>
            <p>淡金色的文字在你面前浮现——它们不是光，而是直接烙进灵魂的讯息。【乐园】正在校验你的灵魂，适配判定：通过。</p>
            <p>“欢迎加入，契约者。”冰冷的提示音在空旷的大厅里回响，你能感觉到黑暗深处有无数双眼睛正注视着你。</p>
          </div>
        </div>
        <button onClick={() => setReading({ fontSize: 17, letterSpacing: 0, lineHeight: 1.8, fontFamily: 'default' })}
          className="text-[13px] font-mono text-dim/50 hover:text-blood transition-colors">↺ 恢复默认排版（17px / normal / 1.8× / 默认字体）</button>
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

  // 刷新后内存缓存为空 → factVecStatus() 返回 -1 显示"未加载"，让人误以为向量库丢了。
  // 实际数据一直在 IndexedDB(drpg-factvec)；进设置页就从库里加载一次，显示真实条数。
  useEffect(() => {
    let alive = true;
    factVecLoadAll().then(() => { if (alive) setIndexed(factVecStatus().indexed); }).catch(() => {});
    return () => { alive = false; };
  }, []);

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
      const pool = buildMemPool(M, cfg.maxItems ?? 1000, !!cfg.factsOnly);   // factsOnly：只索引长期事实
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

        {/* 只召回长期事实：小结/大结/世界大事都不进池 */}
        <div className="flex items-start justify-between gap-4 border-t border-edge pt-4">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-200">只召回长期事实</div>
            <div className="text-sm text-dim mt-1">开启后向量池<span className="text-god/70">只放长期事实</span>，小结/大结/世界大事都不进池、也不索引（召回与 rerank 精排都只针对长期事实）。切换后建议点一次「重建索引」清掉不再用的向量。</div>
          </div>
          <Toggle checked={!!cfg.factsOnly} onChange={() => set({ factsOnly: !cfg.factsOnly })} />
        </div>

        {/* ── rerank 精排（可选·默认关）：余弦粗召回 → 交叉编码器精排 → 取 Top-K，比纯余弦更准 ── */}
        <div className="border-t border-edge pt-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">启用 rerank 精排 <span className="text-[11px] font-normal text-god/60">可选·更准</span></div>
              <div className="text-sm text-dim mt-1">先按余弦粗召回一批候选，再用交叉编码器 rerank 精排、取最相关的 Top-K（＝上方「召回条数」）。需下方 rerank 接口；未配/失败自动回退纯余弦，绝不卡回合。</div>
            </div>
            <Toggle checked={!!cfg.rerankEnabled} onChange={() => set({ rerankEnabled: !cfg.rerankEnabled })} />
          </div>
          {cfg.rerankEnabled && (<>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-200">rerank 接口地址</div>
              <input type="text" value={cfg.rerankBase ?? ''} onChange={(e) => set({ rerankBase: e.target.value })} placeholder="https://api.siliconflow.cn/v1" className="input-base w-full font-mono" />
              <div className="text-sm text-dim/60">Cohere/Jina/SiliconFlow 兼容 <span className="font-mono">/rerank</span> 端点。</div>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-200">rerank API 密钥</div>
              <input type="password" value={cfg.rerankKey ?? ''} onChange={(e) => set({ rerankKey: e.target.value })} placeholder="sk-..." className="input-base w-full font-mono" />
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-200">rerank 模型</div>
              <input type="text" value={cfg.rerankModel ?? ''} onChange={(e) => set({ rerankModel: e.target.value })} placeholder="BAAI/bge-reranker-v2-m3" className="input-base w-full font-mono" />
            </div>
            <button
              onClick={() => set({ rerankBase: cfg.apiBase || cfg.rerankBase, rerankKey: cfg.apiKey || cfg.rerankKey })}
              className="self-start text-[13px] font-mono text-god/75 hover:text-god border border-god/30 hover:bg-god/10 rounded px-2.5 py-1.5 transition-colors">
              ↙ 从上方 embedding 接口复用 Key（同一硅基流动账号）
            </button>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-200">候选宽度</div>
              <input type="number" min={5} max={100} step={5} value={cfg.rerankCandidates ?? 40}
                onChange={(e) => set({ rerankCandidates: Math.min(100, Math.max(1, parseInt(e.target.value) || 40)) })}
                className="input-base w-full font-mono" />
              <div className="text-sm text-dim/60">精排前先按余弦取这么多条候选喂给 rerank（越大越准越慢，常用 30~50；应 ≥ 召回条数）。</div>
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-200">精排最低相关分</div>
              <input type="number" min={0} max={1} step={0.05} value={cfg.rerankThreshold ?? 0}
                onChange={(e) => set({ rerankThreshold: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
                className="input-base w-full font-mono" />
              <div className="text-sm text-dim/60">rerank 后相关分低于此值不注入（0~1，0=不筛）。</div>
            </div>
          </>)}
        </div>

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
  const effApi = nmUseShared ? (textUseShared ? api0 : textApi) : nmApi;
  const modelOpts = nmModels.length > 0 ? nmModels : [effApi.modelId].filter(Boolean);

  const num = (label: string, key: 'recentFullTextCount' | 'distantKeywordThreshold' | 'recallTopK' | 'recallMinScore' | 'requestTimeout' | 'structMaxNpcs' | 'structMaxSkills' | 'structMaxItems' | 'structMaxNpcSkills' | 'structMaxNpcTalents' | 'structMaxNpcItems' | 'structMaxSubProfs' | 'structMaxFactions',
               min: number, max: number, hint: string, def?: number) => (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-slate-200">{label}</div>
      <input type="number" min={min} max={max} value={(cfg as any)[key] ?? def ?? min}
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

          <div className="flex items-start justify-between gap-4 border-t border-edge/40 pt-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">用 API 判定注入哪些条目 <span className="text-[11px] font-mono text-amber-400/70">（每轮 +1 次 API 调用）</span></div>
              <div className="text-sm text-dim mt-1">开：每轮发送前**调一次 API**（走「叙事记忆」接口路由），按「你这轮的输入 + 最近正文」判断该注入哪些 **相关 NPC** + **主角此刻相关的技能 / 装备**（更贴合当下剧情，要打架就调战斗技/武器、要交涉就调社交技…）。关：用本地排序兜底（NPC 在场&gt;好感&gt;最近；技能/装备按品阶，零 API）。**副职业不走 API、始终机械取**。叙事记忆接口未配置时自动回退本地。</div>
            </div>
            <Toggle checked={cfg.structApiSelect ?? false} onChange={() => set({ structApiSelect: !(cfg.structApiSelect ?? false) })} />
          </div>

          {num('注入 NPC 数量上限', 'structMaxNpcs', 0, 10, '每轮注入的相关 NPC 数量（主角不占此额度）。默认 2。')}
          {num('主角技能数量上限', 'structMaxSkills', 0, 12, '仅限主角：注入的技能条数（按品阶/新近优先）。默认 3。')}
          {num('主角装备数量上限', 'structMaxItems', 0, 12, '仅限主角：注入的装备条数（已装备优先，再按品阶）。材料/消耗品全部显示(名称+效果)、其它物品不注入。默认 2。')}
          {num('每个 NPC 技能上限', 'structMaxNpcSkills', 0, 30, '每个被选中 NPC 注入的技能条数（按品阶/新近优先）；超出的只列名称、不带效果说明。默认 8。设 0 = 全量（旧行为；NPC 几十个技能满装备时会撑爆上下文、AI 流口水）。')}
          {num('每个 NPC 天赋上限', 'structMaxNpcTalents', 0, 30, '每个被选中 NPC 注入的天赋条数（按品阶/新近优先）；超出的只列名称。默认 8。设 0 = 全量。之前天赋是跟着「技能上限」走的，现在可单独控制。', 8)}
          {num('每个 NPC 装备/物品上限', 'structMaxNpcItems', 0, 30, '每个被选中 NPC 注入的物品条数（已装备/高品优先）；超出的只列名称。默认 8。设 0 = 全量。')}
          {num('主角副职业数量上限', 'structMaxSubProfs', 0, 12, '仅限主角：注入的副职业条数（含其配方名）。默认 4。')}
          {num('当前世界势力数量上限', 'structMaxFactions', 0, 12, '注入的当前世界势力条数（按对主角态度强弱+近况排序）。默认 4。')}

          <div className={`text-sm font-mono px-3 py-2 rounded border ${(cfg.structEnabled ?? true) && recallOn ? 'border-god/30 text-god/80 bg-god/5' : 'border-edge text-dim bg-void/40'}`}>
            {!recallOn
              ? '● 需先启用叙事记忆 或 向量记忆'
              : (cfg.structEnabled ?? true)
                ? `● 当前：主角(技能≤${cfg.structMaxSkills ?? 3}/装备≤${cfg.structMaxItems ?? 2}) + 最多 ${cfg.structMaxNpcs ?? 2} 个NPC(技能≤${(cfg.structMaxNpcSkills ?? 8) || '全量'}/天赋≤${(cfg.structMaxNpcTalents ?? 8) || '全量'}/装备≤${(cfg.structMaxNpcItems ?? 8) || '全量'})　条目选取:${cfg.structApiSelect ? 'API判定NPC+技能+装备(+1调用)' : '本地排序'}${vmEnabled && !cfg.enabled ? '　[向量记忆模式]' : ''}`
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

          <ApiRoutePicker routeKey="nm" className="mb-2" />

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
