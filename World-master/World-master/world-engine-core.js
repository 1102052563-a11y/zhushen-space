// world-engine-core.js — 核心数据结构与存储（按聊天ID隔离）
window.WORLD_ENGINE_CORE = (function() {
  const STORAGE_PREFIX = 'world_engine_';
  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['萌芽', '发酵', '逼近'],
    progress: ['筹备', '执行', '关键']
  };
  const EVENT_STAGE_MAP = {
    conflict: ['萌芽', '发酵', '逼近', '已爆发', '已消散'],
    progress: ['筹备', '执行', '关键', '已完成', '已失败']
  };
  const EVENT_SUCCESS_STAGE = {
    conflict: '已爆发',
    progress: '已完成'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['已爆发', '已消散'],
    progress: ['已完成', '已失败']
  };

  function getDefaultState() {
    return {
      round: 0,
      worldDigest: '世界正在苏醒，一切尚未可知。',
      events: [],
      factions: [],
      winds: [],
      worldTrends: [],
      reputation: {
        authority: '默默无闻',
        common: '默默无闻',
        shadow: '默默无闻',
        circuit: '默默无闻',
        lastChange: ''
      },
      economy: {
        climate: '平稳',
        signals: []
      },
      memories: [],
      enemies: [],
      influenceChain: [],
      regionalIncident: {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        cooldown: 0,
        _retry: false,
        _retryType: ''
      },
      blackbox: {
        secretActions: [],
        secretAssets: []
      },
      lastEvolveResult: null,
      lastInjection: null,
      lastUpdated: {}
    };
  }

  /** 获取当前扮演的角色名 */
  function getUserName() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx?.name1) return ctx.name1;
      if (ctx?.name2) return ctx.name2;
      const character = ctx?.characters?.[ctx?.characterId];
      if (character?.name) return character.name;
    } catch(e) {}
    return '用户';
  }

  /** UI 渲染：替换文本中的 {{user}} 为当前角色名 */
  function renderUserName(text) {
    if (!text || typeof text !== 'string') return text;
    const name = getUserName();
    return text.replace(/\{\{user\}\}/g, name);
  }

  function getChatId() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return 'default';
  }

  function ensureArrays(state) {
    state.memories = state.memories || [];
    state.events = state.events || [];
    if (state.events) {
      for (const ev of state.events) {
        if (ev.stageRound === undefined) ev.stageRound = 1;
        if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
        if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
        if (ev.stall === undefined) ev.stall = false;
        // 修复 stageRound>=9 未晋级的问题
        const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
        const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
        if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
          const STAGES = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
          const idx = STAGES.indexOf(ev.stage);
          if (idx !== -1 && idx < STAGES.length - 1) {
            ev.stage = STAGES[idx + 1];
            ev.stageRound = ev.stageRound - 9 || 1;
          } else {
            ev.stage = successStage;
            ev.stageRound = 9;
          }
        }
        if (terminalStages.includes(ev.stage)) {
          ev.stageRound = 9;
          ev.stall = false;
        }
      }
    }
    state.factions = state.factions || [];
    const FACTION_RELATIONS = ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'];
    const FACTION_STATUSES = ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'];
    for (const f of state.factions) {
      f.status = FACTION_STATUSES.includes(f.status) ? f.status : '稳固';
      // 八级→七级迁移：旧存档的"紧张"归并到"冷淡"
      if (f.relation === '紧张') f.relation = '冷淡';
      f.relation = FACTION_RELATIONS.includes(f.relation) ? f.relation : '中立';
      f.scope = f.scope || '';
      if (!Array.isArray(f.powerPillars)) f.powerPillars = [];
      else f.powerPillars = f.powerPillars.map(p => {
        const name = typeof p === 'string' ? p : (p.name || '');
        return name.length > 4 ? name.slice(0, 4) : name;
      }).filter(Boolean);
      if (f.powerPillars.length > 3) f.powerPillars.length = 3;
    }
    state.worldTrends = state.worldTrends || [];
    if (state.worldTrends.length > 4) state.worldTrends.length = 4;
    state.winds = state.winds || [];
    state.winds = state.winds.map((wind, index) => {
      wind.topic = wind.topic || wind.content || `风声${index + 1}`;
      if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
      wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.content = wind.content || '';
      wind.scope = wind.scope || '来源地';
      wind.source = wind.source || '来源不明';
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0);
      return wind;
    });
    state.reputation = state.reputation || { authority: '默默无闻', common: '默默无闻', shadow: '默默无闻', circuit: '默默无闻' };
    // 六级→五级迁移：旧存档的"小有名气"归并到"受人尊敬"
    for (const _dim of ['authority', 'common', 'shadow', 'circuit']) {
      if (state.reputation[_dim] === '小有名气') state.reputation[_dim] = '受人尊敬';
    }
    if (!state.reputation.lastChange) state.reputation.lastChange = '';
    state.economy = state.economy || { climate: '平稳', signals: [] };
    if (!state.economy.signals) state.economy.signals = [];
    state.enemies = state.enemies || [];
    state.influenceChain = Array.isArray(state.influenceChain) ? state.influenceChain : [];
    if (!state.regionalIncident) {
      state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: 0, _retry: false, _retryType: '' };
    }
    state.regionalIncident.active = state.regionalIncident.active === true || state.regionalIncident.active === 'true';
    if (state.regionalIncident.cooldown === undefined) state.regionalIncident.cooldown = 0;
    if (state.regionalIncident._retry === undefined) state.regionalIncident._retry = false;
    if (state.regionalIncident._retryType === undefined) state.regionalIncident._retryType = '';
    if (!state.blackbox) {
      state.blackbox = { secretActions: [], secretAssets: [] };
    } else {
      state.blackbox.secretActions = state.blackbox.secretActions || [];
      state.blackbox.secretAssets = state.blackbox.secretAssets || [];
    }
    state.lastInjection = state.lastInjection || null;
    return state;
  }

  function loadState() {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        const def = getDefaultState();
        const merged = { ...def, ...saved };
        merged.memories = saved.memories || [];
        merged.lastInjection = saved.lastInjection || null;
        return ensureArrays(merged);
      } catch(e) { console.warn('[世界引擎] 加载状态失败', e); }
    }
    return ensureArrays(getDefaultState());
  }

  function saveState(state) {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    ensureArrays(state);
    state.lastUpdated = { chatId, timestamp: Date.now() };
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(state));
  }

  /** 保存状态并记录当前对话层数（evolve 完成后调用） */
  function saveStateWithLayer(state) {
    state.chatLayer = getChatLayer();
    saveState(state);
  }

  // ========== 存档点系统（a/b 双状态） ==========
  // a = 存档点，每次新对话轮次时复制 b
  // b = 工作区，UI 显示这个

  function getCheckpointKey() {
    return STORAGE_PREFIX + getChatId() + '_checkpoint';
  }

  function getAnchorLayerKey() {
    return STORAGE_PREFIX + getChatId() + '_anchorLayer';
  }

  function getFingerprintKey() {
    return STORAGE_PREFIX + getChatId() + '_fingerprint';
  }

  /** 保存存档点 a（完整复制当前 state） */
  function saveCheckpoint(state) {
    const key = getCheckpointKey();
    const cp = JSON.parse(JSON.stringify(state));
    ensureArrays(cp);
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(cp));
  }

  /** 从存档点 a 恢复状态 */
  function restoreCheckpoint() {
    const key = getCheckpointKey();
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const cp = JSON.parse(raw);
        return ensureArrays(cp);
      } catch(e) { console.warn('[世界引擎] 存档点读取失败', e); }
    }
    return null;
  }

  /** 删除存档点 */
  function clearCheckpoint() {
    window.WORLD_ENGINE_STORE.removeItem(getCheckpointKey());
  }

  /** 获取计数锚点（chat.length，每 2X 轮推演后重置） */
  function getAnchorLayer() {
    const saved = window.WORLD_ENGINE_STORE.getItem(getAnchorLayerKey());
    return saved !== null ? Number(saved) : null;
  }

  /** 设置计数锚点 */
  function setAnchorLayer(l) {
    window.WORLD_ENGINE_STORE.setItem(getAnchorLayerKey(), String(l));
  }

  /** 获取当前对话层数（从 0 开始计数） */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return 0; }
  }

  /** 获取当前对话的指纹（对话层数，用于判断是否重roll） */
  function getChatFingerprint() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return String(chat.length);
    } catch(e) {}
    return 'unknown';
  }

  /** 保存指纹到 localStorage */
  function saveFingerprint(fp) {
    window.WORLD_ENGINE_STORE.setItem(getFingerprintKey(), fp);
  }

  /** 读取上次保存的指纹 */
  function loadFingerprint() {
    return window.WORLD_ENGINE_STORE.getItem(getFingerprintKey()) || '';
  }

  /** 判断是否为新对话轮次（指纹变了 → 新轮次；没变 → 重roll） */
  function isNewRound() {
    const oldFp = loadFingerprint();
    const newFp = getChatFingerprint();
    if (!oldFp) return true;
    return oldFp !== newFp;
  }

  function addMemory(state, memory) {
    if (!state) return;
    state.memories.unshift(memory);
    if (state.memories.length > 200) state.memories.pop();
    saveState(state);
  }

  function ensureEventFields(ev) {
    if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
    if (ev.stageRound === undefined) ev.stageRound = 1;
    if (ev.level === undefined) ev.level = 1;
    if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
    if (ev.stall === undefined) ev.stall = false;
    // 阶段常量
    const STAGES = EVENT_STAGE_MAP[ev.type] || EVENT_STAGE_MAP.conflict;
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
    const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
    if (!ev.stage || !STAGES.includes(ev.stage)) ev.stage = STAGES[0];
    // stageRound >= 9 自动晋级
    if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = ev.stageRound - 9 || 1;
      } else {
        ev.stage = successStage;
        ev.stageRound = 9;
      }
    }
    // 终局阶段锁定 9/9
    if (terminalStages.includes(ev.stage)) {
      ev.stageRound = 9;
      ev.stall = false;
    }
    return ev;
  }

  function addEvent(state, event) {
    if (!state.events) state.events = [];
    ensureEventFields(event);
    const idx = state.events.findIndex(e => e.name === event.name);
    if (idx !== -1) {
      state.events[idx] = { ...state.events[idx], ...event };
      ensureEventFields(state.events[idx]);
    } else {
      state.events.unshift(event);
    }
    if (state.events.length > 16) state.events.pop();
    saveState(state);
  }

  function addFaction(state, faction) {
    if (!state.factions) state.factions = [];
    const FACTION_RELATIONS = ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'];
    const FACTION_STATUSES = ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'];
    if (!FACTION_STATUSES.includes(faction.status)) faction.status = '稳固';
    if (faction.relation === '紧张') faction.relation = '冷淡';
    if (!FACTION_RELATIONS.includes(faction.relation)) faction.relation = '中立';
    faction.scope = faction.scope || '';
    if (!Array.isArray(faction.powerPillars)) faction.powerPillars = [];
    else faction.powerPillars = faction.powerPillars.map(p => {
      const name = typeof p === 'string' ? p : (p.name || '');
      return name.length > 4 ? name.slice(0, 4) : name;
    }).filter(Boolean);
    if (faction.powerPillars.length > 3) faction.powerPillars.length = 3;
    const idx = state.factions.findIndex(f => f.name === faction.name);
    if (idx !== -1) {
      state.factions[idx] = { ...state.factions[idx], ...faction };
    } else {
      state.factions.unshift(faction);
    }
    if (state.factions.length > 15) state.factions.pop();
    saveState(state);
  }

  function addWorldTrend(state, trend) {
    if (!state.worldTrends) state.worldTrends = [];
    if (!trend || !trend.name) return;
    trend.status = trend.status === '已结束' ? '已结束' : '持续中';
    trend.scope = trend.scope || '天下';
    trend.description = trend.description || '';
    trend.source = trend.source || '';
    const idx = state.worldTrends.findIndex(existing => existing.name === trend.name);
    if (idx !== -1) {
      if (state.worldTrends[idx].status === '已结束') trend.status = '已结束';
      state.worldTrends[idx] = { ...state.worldTrends[idx], ...trend };
    } else {
      state.worldTrends.unshift(trend);
      if (state.worldTrends.length > 4) state.worldTrends.length = 4;
    }
    saveState(state);
  }

  function addWind(state, wind) {
    if (!state.winds) state.winds = [];
    delete wind.quietRounds;
    wind.topic = wind.topic || wind.content || `风声${Date.now()}`;
    if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
    wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
    wind.scope = wind.scope || '来源地';
    wind.source = wind.source || '来源不明';
    wind.quietRounds = 0;
    const idx = state.winds.findIndex(existing => existing.topic === wind.topic);
    if (idx !== -1) state.winds[idx] = { ...state.winds[idx], ...wind };
    else state.winds.unshift(wind);
    if (state.winds.length > 12) state.winds.pop();
    saveState(state);
  }

  // ========== 导出/导入清理 ==========

  /** 清理后的导出数据（去掉调试/内部字段） */
  function getCleanExport(state) {
    const s = JSON.parse(JSON.stringify(state));

    // 去掉调试/内部字段
    delete s.lastEvolveResult;
    delete s.lastInjection;
    delete s.lastUpdated;
    delete s._terminalEventsThisRound;

    // 修复事件 stageRound>=9
    if (s.events) {
      for (const ev of s.events) {
        ensureEventFields(ev);
      }
    }

    return ensureArrays(s);
  }

  /** 导入时合并到当前状态 */
  function importState(importedState) {
    const clean = JSON.parse(JSON.stringify(importedState));
    // 去掉导入数据里的内部字段
    delete clean.lastEvolveResult;
    delete clean.lastInjection;
    delete clean.lastUpdated;
    delete clean._terminalEventsThisRound;
    // 修复事件
    if (clean.events) {
      for (const ev of clean.events) ensureEventFields(ev);
    }
    // 确保必要字段
    clean.memories = clean.memories || [];
    clean.lastEvolveResult = null;
    clean.lastInjection = null;
    const chatId = getChatId();
    clean.lastUpdated = { chatId, timestamp: Date.now() };
    ensureArrays(clean);
    saveState(clean);
    return clean;
  }

  return {
    getDefaultState, getChatId, loadState, saveState, saveStateWithLayer,
    addMemory, addEvent, addFaction, addWorldTrend, addWind,
    ensureEventFields, getUserName, renderUserName,
    saveCheckpoint, restoreCheckpoint, clearCheckpoint, getAnchorLayer, setAnchorLayer,
    getChatLayer, getChatFingerprint, saveFingerprint, loadFingerprint, isNewRound,
    getCleanExport, importState
  };
})();
