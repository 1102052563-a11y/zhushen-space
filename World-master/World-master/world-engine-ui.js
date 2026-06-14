// world-engine-ui.js — 完整 UI 面板
window.WORLD_ENGINE_UI = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const evolution = window.WORLD_ENGINE_EVOLUTION;

  let panelElement = null;
  let panelVisible = false;
  let isEvolving = false;
  let editingEvent = null;
  let editingFaction = null;
  let editingWind = null;
  let editingTrend = null;
  let editingEnemy = null;
  let editingInfluence = null;
  let editingRI = null;
  let editingBBAction = null;
  let editingBBAsset = null;
  let listPagerCounter = 0;
  const listPageState = {};
  const sectionCollapsed = {};
  const expandedWorldbookGroups = new Set();
  // 世界书缓存（模块级，跨 refresh() 存活）
  let _wbCachedEntries = null;
  let _wbCachedSelectedIds = null;
  let _wbCachedChatId = null;
  let _wbScrollTop = 0;

  function h(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m] || m));
  }

  /** 渲染用户可见文本：将 {{user}} 替换为当前角色名，并转义 HTML */
  function u(text) {
    return h(core.renderUserName(text));
  }

  function showToast(msg, isError, duration) {
    const id = 'we-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'we-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    if (duration !== 0) setTimeout(() => el.remove(), duration || 3000);
  }

  function sectionHeader(title, sectionId) {
    const collapsed = sectionCollapsed[sectionId] || false;
    return `<span class="we-section-toggle" data-section="${sectionId}">
      <span class="we-section-arrow" id="we-section-arrow-${sectionId}">${collapsed ? '▶' : '▼'}</span>${title}
    </span>`;
  }

  function sectionBody(sectionId, content) {
    const collapsed = sectionCollapsed[sectionId] || false;
    return `<div class="we-section-body" id="we-section-body-${sectionId}" style="${collapsed ? 'display:none' : ''}">${content}</div>`;
  }

  function buildPanel() {
    if (document.getElementById('we-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'we-panel';
    panel.innerHTML = `
      <div class="we-panel-header">
        <span class="we-panel-title">🌍 世界引擎</span>
        <button class="we-panel-close">✕</button>
      </div>
      <div class="we-panel-body" id="we-panel-body">
        <div class="we-loading">加载中...</div>
      </div>
    `;
    document.body.appendChild(panel);
    panelElement = panel;

    panel.querySelector('.we-panel-close').onclick = () => hidePanel();
    initDrag(panel, panel.querySelector('.we-panel-header'));

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelVisible) hidePanel();
    });
  }

  let _activeTab = 'current';

  function refresh(auto) {
    if (!panelElement || !panelVisible) return;
    // 后台自动刷新（30s 定时、推演完成）时，若正停留在设置页则跳过：
    // 设置页是静态表单，重建会清掉正在输入的 API 信息和刚获取到的模型列表
    if (auto && _activeTab === 'settings') return;
    const body = document.getElementById('we-panel-body');
    if (!body) return;
    listPagerCounter = 0;

    const state = core.loadState();
    const checkpoint = core.restoreCheckpoint();

    const curLayer = state.chatLayer || getChatLayer();
    const cpLayer = getCheckpointLayer(checkpoint);

    // 保存世界书列表滚动位置，渲染后恢复
    const _wbListEl = document.getElementById('we-worldbook-list');
    if (_wbListEl) _wbScrollTop = _wbListEl.scrollTop;

    body.innerHTML = `
      <div class="we-tabs">
        <button class="we-tab ${_activeTab === 'current' ? 'we-tab-active' : ''}" data-tab="current">📌 当前状态</button>
        <button class="we-tab ${_activeTab === 'checkpoint' ? 'we-tab-active' : ''}" data-tab="checkpoint">💾 存档点</button>
        <button class="we-tab ${_activeTab === 'settings' ? 'we-tab-active' : ''}" data-tab="settings">⚙️ 设置</button>
      </div>
      <div class="we-tab-content" id="we-tab-current" style="${_activeTab === 'current' ? 'display:block' : 'display:none'}">
        <div class="we-actions-bar" style="margin-bottom:8px;">
          <button class="we-btn we-btn-primary" id="we-btn-evolve">🌀 手动推演</button>
          <button class="we-btn we-btn-danger" id="we-btn-abort" style="background:var(--we-danger);color:#fff;" disabled>⏹ 停止推演</button>
          <button class="we-btn" id="we-btn-refresh">🔄 刷新</button>
        </div>
        ${renderFullState(state, curLayer, 'state')}
      </div>
      <div class="we-tab-content" id="we-tab-checkpoint" style="${_activeTab === 'checkpoint' ? 'display:block' : 'display:none'}">
        ${checkpoint ? renderFullState(checkpoint, cpLayer, 'checkpoint') : '<div class="we-empty">暂无存档点</div>'}
      </div>
      <div class="we-tab-content" id="we-tab-settings" style="${_activeTab === 'settings' ? 'display:block' : 'display:none'}">
        ${renderSettingsForm()}
        <div class="we-section" style="margin-top:16px;">
          <div class="we-section-title">🔍 调试</div>
          <div>${renderDebug()}</div>
        </div>
      </div>
    `;

    // Tab 切换逻辑
    const tabs = body.querySelectorAll('.we-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        _activeTab = tab.dataset.tab;
        refresh();
      };
    });

    bindEvents(state);
  }

  /** 渲染单个状态的概览区块 */
  function renderStatusBlock(s, layer) {
    return `
      <div class="we-section">
        <div class="we-section-title">📊 基本信息 <span class="we-badge" style="background:#6662;color:var(--we-text2);font-size:11px;">第${layer}层</span></div>
        <div class="we-info-grid">
          <div class="we-info-item"><span class="we-label">轮次</span><span class="we-val">${s.round}</span></div>
          <div class="we-info-item"><span class="we-label">账本</span><span class="we-val">${(s.memories||[]).filter(m=>m.type==='ledger').length}轮</span></div>
          <div class="we-info-item"><span class="we-label">事件链</span><span class="we-val">${(s.events||[]).length}个</span></div>
          <div class="we-info-item"><span class="we-label">势力</span><span class="we-val">${(s.factions||[]).length}个</span></div>
          <div class="we-info-item"><span class="we-label">天下大势</span><span class="we-val">${(s.worldTrends||[]).length}条</span></div>
          <div class="we-info-item"><span class="we-label">风声</span><span class="we-val">${(s.winds||[]).length}条</span></div>
          <div class="we-info-item"><span class="we-label">仇敌</span><span class="we-val">${(s.enemies||[]).length}个</span></div>
        </div>
      </div>
      <div class="we-section">
        <div class="we-section-title">📝 世界摘要</div>
        <div class="we-digest">${u(s.worldDigest)}</div>
      </div>
    `;
  }

  function renderFullState(s, layer, scope) {
    return renderStatusBlock(s, layer) +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🌐 天下大势', 'trends') + '</div>' + sectionBody('trends', renderWorldTrends(s.worldTrends, scope)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🔥 事件链', 'events') + '</div>' + sectionBody('events', renderEventList(s.events, scope)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🏛️ 势力', 'factions') + '</div>' + sectionBody('factions', renderFactionList(s.factions)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🗣️ 风声', 'winds') + '</div>' + sectionBody('winds', renderWindList(s.winds)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('⭐ 声誉', 'reputation') + '</div>' + sectionBody('reputation', renderReputation(s.reputation)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('💰 经济', 'economy') + '</div>' + sectionBody('economy', renderEconomy(s.economy)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('⚔️ 仇敌录', 'enemies') + '</div>' + sectionBody('enemies', renderEnemies(s.enemies)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🔗 影响链', 'influence') + '</div>' + sectionBody('influence', renderInfluenceChain(s.influenceChain)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('⚠️ 区域突发事件', 'regional') + '</div>' + sectionBody('regional', renderRegionalIncident(s.regionalIncident)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('🕶️ 信息黑盒', 'blackbox') + '</div>' + sectionBody('blackbox', renderBlackbox(s.blackbox)) + '</div>' +
      '<div class="we-section"><div class="we-section-title">' + sectionHeader('📖 近期重大事件账本', 'ledger') + '</div>' + sectionBody('ledger', renderLedger(s.memories)) + '</div>';
  }

  /** 获取存档点的对话层数 */
  function getCheckpointLayer(cp) {
    if (!cp) return '-';
    return cp.chatLayer || '-';
  }

  function renderPagedList(items, key, renderItem, perPage = 4) {
    const rid = `we-list-${key}-${++listPagerCounter}`;
    const totalPages = Math.ceil(items.length / perPage);
    const currentPage = Math.min(totalPages, Math.max(1, listPageState[rid] || 1));
    listPageState[rid] = currentPage;
    const pager = totalPages > 1
      ? `<div class="we-list-pager">
          <span class="we-list-arrow" data-rid="${rid}" data-dir="-1">◀</span>
          <span class="we-list-page"><span class="we-list-cur">${currentPage}</span>/${totalPages}</span>
          <span class="we-list-arrow" data-rid="${rid}" data-dir="1">▶</span>
        </div>`
      : '';
    return pager + `<div class="we-paged-list" data-rid="${rid}">` + items.map((item, index) => {
      const page = Math.floor(index / perPage) + 1;
      return `<div class="we-page-item" data-page="${page}" style="${page !== currentPage ? 'display:none;' : ''}">${renderItem(item, index)}</div>`;
    }).join('') + '</div>';
  }

  function renderEventList(events, scope) {
    if (!events || !events.length) return '<div class="we-empty">暂无事件链</div>';
    const curRound = (core.loadState() || {}).round || 0;
    return renderPagedList(events, 'events-' + scope, (e, eventIndex) => {
      const stageColors = {
        萌芽:'#d6b85a',
        发酵:'#d98a3d',
        逼近:'#cf5f3f',
        已爆发:'#b93f3f',
        已消散:'#888888',
        筹备:'#57b7a8',
        执行:'#3fae86',
        关键:'#2f9b68',
        已完成:'#237a4d',
        已失败:'#888888',
        停滞:'#6688aa'
      };
      const levelColors = {
        1: '#c0c0c0',
        2: '#f2f2f2',
        3: '#c9a45c',
        4: '#df7cff'
      };
      const color = stageColors[e.stage] || '#888';
      const levelColor = levelColors[e.level] || '#9aa6b2';
      let extras = '';
      const terminalStages = e.type === 'progress' ? ['已完成', '已失败'] : ['已爆发', '已消散'];
      const isTerminal = terminalStages.includes(e.stage);
      if (e.consecutiveFails > 0 && !isTerminal) {
        const maxFails = e.type === 'progress' ? 2 + (e.level || 1) : 6 - (e.level || 1);
        extras += ` <span class="we-badge" style="background:#6662;color:#888;">⌛${e.consecutiveFails}/${maxFails}</span>`;
      }
      if (e.stall && !isTerminal) {
        extras += ' <span class="we-badge" style="background:#6688aa22;color:#6688aa;">停滞</span>';
      }
      let metaExtra = '';
      if (e.evolveResult && !isTerminal) {
        const resultColors = { '成功':'#7a9a7a', '保持':'#b8a070', '受挫':'#c46a6a' };
        const color = resultColors[e.evolveResult] || '#888';
        metaExtra = ` <span class="we-badge" style="background:${color}22;color:${color};">${e.evolveResult}</span>`;
      }
      // 阶段进度条
      let progressHtml = '';
      if (!isTerminal) {
        const pct = Math.round((e.stageRound / 9) * 100);
        progressHtml = `<div class="we-event-progress">
          <div style="width:${pct}%;background:${color};"></div>
        </div>`;
      }
      const typeName = e.type === 'progress' ? '推进型' : '冲突型';
      const typeColor = e.type === 'progress' ? '#57b7a8' : '#cf5f3f';
      // 正面终局倒计时徽标（已爆发/已完成，保留 2+level*2 轮后自动清退）
      let countdownHtml = '';
      const POSITIVE_TERMINALS = ['已爆发', '已完成'];
      if (POSITIVE_TERMINALS.includes(e.stage) && e._terminalSince !== undefined) {
        const keepRounds = 2 + (e.level || 1) * 2;
        const left = keepRounds - (curRound - e._terminalSince) + 1;
        if (left >= 1) {
          const cdColor = e.stage === '已完成' ? '#6fc28a' : '#e07465';
          countdownHtml = ` <span class="we-badge we-event-countdown" style="color:${cdColor};" title="该事件在 ${left} 轮后自动清退"><i class="fa-regular fa-clock"></i>剩余${left}轮</span>`;
        }
      }
      const terminalStamp = {
        已完成: { text: '完成', color: '#6fc28a' },
        已爆发: { text: '爆发', color: '#e07465' },
        已消散: { text: '消散', color: '#a6a6ad' },
        已失败: { text: '失败', color: '#c08aaa' }
      }[e.stage];
      const isEditing = editingEvent?.scope === scope && editingEvent?.index === eventIndex;
      // 颜色作为 CSS 变量下放，描边/底色/光效全交由样式层处理（不再内联左色条）
      const itemStyle = `--event-accent:${color};--event-type:${typeColor};--event-level:${levelColor};`;
      const stageClassMap = {
        萌芽: 'we-stage-sprout', 发酵: 'we-stage-ferment', 逼近: 'we-stage-loom',
        已爆发: 'we-stage-erupt', 已消散: 'we-stage-fade',
        已完成: 'we-stage-done', 已失败: 'we-stage-failed',
      };
      const stageClass = stageClassMap[e.stage] || '';
      const itemClass = (isTerminal ? 'we-event-item we-event-item-terminal' : 'we-event-item') + (stageClass ? ' ' + stageClass : '');
      const metaStyle = isTerminal
        ? 'style="color:var(--we-text2);"'
        : '';
      const stageBadge = isTerminal ? '' : ` <span class="we-badge" style="background:${color}22;color:${color};">${e.stage}</span>`;
      const metaText = isTerminal
        ? (e.desc ? u(e.desc) : '')
        : `${e.stageRound||1}/9 ${e.desc ? '— '+u(e.desc) : ''}${metaExtra}`;
      const stampHtml = isTerminal && terminalStamp
        ? `<div class="we-event-stamp" style="border-color:${terminalStamp.color};color:${terminalStamp.color};">${terminalStamp.text}</div>`
        : '';
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-event-delete" data-event-scope="${scope}" data-event-index="${eventIndex}" title="删除事件"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-event-copy" data-event-scope="${scope}" data-event-index="${eventIndex}" title="复制事件"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-event-edit" data-event-scope="${scope}" data-event-index="${eventIndex}" title="修改事件"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEventEditor(e, scope, eventIndex) : '';
      return `<div class="${itemClass}" style="${itemStyle}">
        ${stampHtml}
        <div class="we-event-name"><span style="color:${levelColor};">${u(e.name)}</span> <span class="we-badge" style="background:${levelColor}22;color:${levelColor};">Lv.${e.level||'?'}</span> <span class="we-badge" style="background:${typeColor}22;color:${typeColor};">${typeName}</span>${countdownHtml}${stageBadge}${extras}</div>
        ${metaText ? `<div class="we-event-meta" ${metaStyle}>${metaText}</div>` : ''}
        ${editHtml}
        ${actionHtml}
        ${progressHtml}
      </div>`;
    });
  }

  function renderEventEditor(event, scope, eventIndex) {
    const stages = event.type === 'progress'
      ? ['筹备', '执行', '关键', '已完成', '已失败']
      : ['萌芽', '发酵', '逼近', '已爆发', '已消散'];
    const levelOptions = [1, 2, 3, 4].map(level =>
      `<option value="${level}" ${Number(event.level) === level ? 'selected' : ''}>Lv.${level}</option>`
    ).join('');
    const typeOptions = [
      ['conflict', '冲突型'],
      ['progress', '推进型']
    ].map(([type, label]) =>
      `<option value="${type}" ${event.type === type ? 'selected' : ''}>${label}</option>`
    ).join('');
    const stageOptions = stages.map(stage =>
      `<option value="${stage}" ${event.stage === stage ? 'selected' : ''}>${stage}</option>`
    ).join('');

    // 正面终局倒计时：默认值取当前剩余，非终局事件留空
    const POSITIVE_TERMINALS = ['已爆发', '已完成'];
    const keepRounds = 2 + (Number(event.level) || 1) * 2;
    let leftValue = '';
    if (POSITIVE_TERMINALS.includes(event.stage)) {
      const curRound = (core.loadState() || {}).round || 0;
      const left = event._terminalSince !== undefined
        ? keepRounds - (curRound - event._terminalSince) + 1
        : keepRounds;
      leftValue = Math.min(keepRounds, Math.max(1, left));
    }

    return `
      <div class="we-event-editor" data-event-scope="${scope}" data-event-index="${eventIndex}">
        <button class="we-event-editor-close" title="取消修改"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">事件名字<input class="we-event-edit-name" type="text" value="${u(event.name || '')}"></label>
          <label>等级<select class="we-event-edit-level">${levelOptions}</select></label>
          <label>类型<select class="we-event-edit-type">${typeOptions}</select></label>
          <label>阶段<select class="we-event-edit-stage">${stageOptions}</select></label>
          <label>阶段进度<input class="we-event-edit-round" type="number" min="1" max="9" value="${event.stageRound || 1}"></label>
          <label title="仅正面终局（已爆发/已完成）生效，到期自动清退；非终局留空">剩余轮数<input class="we-event-edit-left" type="number" min="1" placeholder="终局专用" value="${leftValue}"></label>
          <label class="we-event-editor-wide">描述<textarea class="we-event-edit-desc" rows="3">${u(event.desc || '')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-event-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderFactionList(factions) {
    if (!factions || !factions.length) return '<div class="we-empty">暂无势力</div>';
    return renderPagedList(factions, 'factions', (f, factionIndex) => {
      const relationColors = {
        血盟:'#2563eb', 盟友:'#0ea5e9', 友好:'#06b6d4', 中立:'#94a3b8',
        冷淡:'#f59e0b', 紧张:'#f59e0b', 敌对:'#ef4444', 世仇:'#991b1b'
      };
      const statusIcons = { 鼎盛:'🔥', 稳固:'⚖️', 倾轧:'⚔️', 困顿:'💧', 衰落:'🍂', 瓦解:'💀' };
      const statusColors = { 鼎盛:'#d0aa58', 稳固:'#69b68e', 倾轧:'#cf5f3f', 困顿:'#70a8d2', 衰落:'#a6a6ad', 瓦解:'#888888' };
      const relColor = relationColors[f.relation] || '#888';
      const stColor = statusColors[f.status] || '#888';
      const stIcon = statusIcons[f.status] || '';

      const isEditing = editingFaction && editingFaction.index === factionIndex;

      let pillarsHtml = '';
      if (f.powerPillars && f.powerPillars.length) {
        pillarsHtml = '<div class="we-faction-meta">权力支柱: ' + f.powerPillars.map(p => '<span class="we-pillar-tag">' + u(p) + '</span>').join('') + '</div>';
      }

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-faction-delete" data-faction-index="${factionIndex}" title="删除势力"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-faction-copy" data-faction-index="${factionIndex}" title="复制势力"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-faction-edit" data-faction-index="${factionIndex}" title="编辑势力"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderFactionEditor(f, factionIndex) : '';

      return `<div class="we-faction-item">
        <div class="we-faction-name">${u(f.name)}</div>
        <div class="we-faction-tags">
          <span class="we-tag" style="border-color:${stColor};color:${stColor};">${stIcon} ${f.status||'稳固'}</span>
          <span class="we-tag" style="border-color:${relColor};color:${relColor};">${f.relation||'中立'}</span>
          ${f.scope ? '<span class="we-tag">' + u(f.scope) + '</span>' : ''}
        </div>
        ${f.currentGoal ? `<div class="we-faction-goal">🎯 ${u(f.currentGoal)}</div>` : ''}
        ${f.core_person ? `<div class="we-faction-meta">核心人物: ${u(f.core_person)}</div>` : ''}
        ${pillarsHtml}
        ${actionHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderFactionEditor(f, index) {
    const statusOptions = ['鼎盛','稳固','倾轧','困顿','衰落','瓦解'].map(s =>
      `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const relationOptions = ['血盟','盟友','友好','中立','冷淡','敌对','世仇'].map(r =>
      `<option value="${r}" ${f.relation === r ? 'selected' : ''}>${r}</option>`).join('');
    const pillars = [];
    for (let i = 0; i < 3; i++) pillars.push(f.powerPillars?.[i] || '');

    return `
      <div class="we-event-editor" data-faction-index="${index}">
        <button class="we-event-editor-close we-faction-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">势力名称<input class="we-faction-edit-name" type="text" value="${u(f.name||'')}"></label>
          <label>运势<select class="we-faction-edit-status">${statusOptions}</select></label>
          <label>关系<select class="we-faction-edit-relation">${relationOptions}</select></label>
          <label>范围<input class="we-faction-edit-scope" type="text" value="${u(f.scope||'')}"></label>
          <label>目标<input class="we-faction-edit-goal" type="text" value="${u(f.currentGoal||'')}"></label>
          <label>核心人物<input class="we-faction-edit-core" type="text" value="${u(f.core_person||'')}"></label>
          ${[0,1,2].map(i => `<label>权力支柱${i+1}<input class="we-faction-edit-pillar" data-pillar-idx="${i}" type="text" value="${u(pillars[i])}" maxlength="4" placeholder="最多4字"></label>`).join('')}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-faction-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderWorldTrends(trends, scope) {
    if (!trends || !trends.length) return '<div class="we-empty">暂无天下大势</div>';
    return renderPagedList(trends, 'world-trends', (trend, trendIndex) => {
      const ended = trend.status === '已结束';
      const color = ended ? '#888888' : '#c9a45c';
      const isEditing = editingTrend?.scope === scope && editingTrend?.index === trendIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-trend-delete" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="删除天下大势"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-trend-copy" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="复制天下大势"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-trend-edit" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="编辑天下大势"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderTrendEditor(trend, scope, trendIndex) : '';
      return `<div class="we-trend-item${ended ? ' we-trend-ended' : ''}" style="border-left-color:${color};">
        ${actionHtml}
        <div class="we-trend-header">
          <span class="we-trend-name">${u(trend.name)}</span>
          <span class="we-badge" style="background:${color}22;color:${color};">${u(trend.status || '持续中')}</span>
        </div>
        <div class="we-trend-scope">${u(trend.scope || '天下')}</div>
        <div class="we-trend-description">${u(trend.description || '?')}</div>
        <div class="we-trend-source"><span>来源</span>${u(trend.source || '?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderTrendEditor(trend, scope, index) {
    const statusOptions = ['持续中', '已结束'].map(s =>
      `<option value="${s}" ${trend.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-trend-scope="${scope}" data-trend-index="${index}">
        <button class="we-event-editor-close we-trend-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">大势名称<input class="we-trend-edit-name" type="text" value="${u(trend.name||'')}"></label>
          <label>状态<select class="we-trend-edit-status">${statusOptions}</select></label>
          <label>范围<input class="we-trend-edit-scope" type="text" value="${u(trend.scope||'')}"></label>
          <label>来源<input class="we-trend-edit-source" type="text" value="${u(trend.source||'')}"></label>
          <label class="we-event-editor-wide">描述<textarea class="we-trend-edit-desc" rows="3">${u(trend.description||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-trend-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderWindList(winds) {
    if (!winds || !winds.length) return '<div class="we-empty">暂无风声</div>';
    const typeNames = { announcement:'公告', report:'消息', rumor:'流言', sentiment:'舆情' };
    const typeColors = { announcement:'#6f9fd8', report:'#57b7a8', rumor:'#d98a3d', sentiment:'#a880c4' };
    const levelColors = { 1:'#c0c0c0', 2:'#f2f2f2', 3:'#c9a45c', 4:'#df7cff' };
    return renderPagedList(winds, 'winds', (w, windIndex) => {
      const typeColor = typeColors[w.type] || '#888';
      const levelColor = levelColors[w.level] || '#9aa6b2';
      const isEditing = editingWind && editingWind.index === windIndex;

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-wind-delete" data-wind-index="${windIndex}" title="删除风声"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-wind-copy" data-wind-index="${windIndex}" title="复制风声"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-wind-edit" data-wind-index="${windIndex}" title="编辑风声"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderWindEditor(w, windIndex) : '';

      const windTypeClass = { announcement:'we-wind-announcement', report:'we-wind-report', rumor:'we-wind-rumor', sentiment:'we-wind-sentiment' }[w.type] || '';
      const windLvClass = 'we-wind-lv' + (w.level || 1);
      let html = '<div class="we-wind-item ' + windTypeClass + ' ' + windLvClass + '" style="--wind-accent:' + typeColor + ';--wind-level-color:' + levelColor + ';">';
      html += '<div class="we-wind-header">';
      html += '<span class="we-wind-topic">' + u(w.topic || '未命名风声') + '</span>';
      html += '<span class="we-badge" style="background:' + typeColor + '22;color:' + typeColor + ';">' + (typeNames[w.type] || '风声') + '</span>';
      html += '<span class="we-badge" style="background:' + levelColor + '22;color:' + levelColor + ';">Lv.' + (w.level || 1) + '</span>';
      html += '</div>';
      html += '<div class="we-wind-field we-wind-content"><span class="we-wind-label">内容</span><span>' + u(w.content || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">范围</span><span>' + u(w.scope || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">来源</span><span>' + u(w.source || '?') + '</span></div>';
      html += editHtml;
      html += actionHtml;
      html += '</div>';
      return html;
    });
  }

  function renderWindEditor(w, index) {
    const typeOptions = [['announcement','公告'],['report','消息'],['rumor','流言'],['sentiment','舆情']].map(([v,label]) =>
      `<option value="${v}" ${w.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const levelOptions = [1,2,3,4].map(l =>
      `<option value="${l}" ${w.level === l ? 'selected' : ''}>Lv.${l}</option>`).join('');

    return `
      <div class="we-event-editor" data-wind-index="${index}">
        <button class="we-event-editor-close we-wind-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">主题<input class="we-wind-edit-topic" type="text" value="${u(w.topic||'')}"></label>
          <label>类型<select class="we-wind-edit-type">${typeOptions}</select></label>
          <label>等级<select class="we-wind-edit-level">${levelOptions}</select></label>
          <label>范围<input class="we-wind-edit-scope" type="text" value="${u(w.scope||'')}"></label>
          <label>来源<input class="we-wind-edit-source" type="text" value="${u(w.source||'')}"></label>
          <label class="we-event-editor-wide">内容<textarea class="we-wind-edit-content" rows="3">${u(w.content||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-wind-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderReputation(rep) {
    if (!rep) return '<div class="we-empty">暂无声誉数据</div>';
    const levels = ['天怒人怨','声名狼藉','默默无闻','受人尊敬','万众敬仰'];
    const levelColors = { '天怒人怨':'#e05555', '声名狼藉':'#d97a5a', '默默无闻':'#7a8a9a', '受人尊敬':'#6cae8e', '万众敬仰':'#c9a45c' };
    const legacyMap = { '小有名气':'受人尊敬' };
    const dimLabels = { authority:'朝堂', common:'市井', shadow:'草莽', circuit:'同道' };
    const dimIcons = { authority:'🏛️', common:'🌾', shadow:'🌑', circuit:'⚒️' };
    return '<div class="we-rep-grid">' + Object.entries(rep).filter(([k]) => k !== 'lastChange').map(([key, rawVal]) => {
      const val = legacyMap[rawVal] || rawVal;
      const cn = dimLabels[key] || key;
      const icon = dimIcons[key] || '';
      const idx = levels.indexOf(val);
      const color = levelColors[val] || '#888';
      return `<div class="we-rep-card" style="border-left:3px solid ${color};">
        <span class="we-rep-icon">${icon}</span>
        <span class="we-rep-dim">${cn}</span>
        <div class="we-rep-dots">${levels.map((l, i) => {
          const active = i <= idx ? ' we-rep-dot-active' : '';
          const dotColor = i <= idx ? color : '#444';
          return `<span class="we-rep-dot${active}" style="background:${dotColor};" data-dim="${key}" data-level="${l}" title="${l}"></span>`;
        }).join('')}</div>
        <span class="we-rep-val" style="color:${color}">${val}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderEconomy(econ) {
    if (!econ) return '<div class="we-empty">暂无经济数据</div>';
    const climates = ['繁荣','平稳','衰退','动荡'];
    const climateColors = { '繁荣': '#3ecf8e', '平稳': '#7a8a9a', '衰退': '#d9a34a', '动荡': '#e05555' };
    const climateIcons = { '繁荣': '☀️', '平稳': '🌤️', '衰退': '🌧️', '动荡': '⛈️' };
    const climateBg = { '繁荣': 'rgba(62,207,142,0.08)', '平稳': 'rgba(122,138,154,0.06)', '衰退': 'rgba(217,163,74,0.08)', '动荡': 'rgba(224,85,85,0.08)' };
    const climate = econ.climate || '平稳';
    let html = '<div class="we-climate-bar" style="background:' + (climateBg[climate]||'rgba(122,138,154,0.06)') + ';border-left-color:' + (climateColors[climate]||'#7a8a9a') + '">';
    html += '<span class="we-climate-icon">' + (climateIcons[climate]||'🌤️') + '</span>';
    html += '<span class="we-climate-label" style="color:' + (climateColors[climate]||'#7a8a9a') + '">' + climate + '</span>';
    html += '<div class="we-climate-btns">';
    for (const c of climates) {
      html += '<span class="we-climate-btn' + (c === climate ? ' we-climate-btn-on' : '') + '" style="' + (c === climate ? ('color:'+(climateColors[c]||'#7a8a9a')+';border-color:'+(climateColors[c]||'#7a8a9a')) : '') + '" data-climate="' + c + '">' + c + '</span>';
    }
    html += '</div></div>';
    if (econ.signals?.length) {
      html += renderPagedList(econ.signals, 'economy-signals', (s, i) =>
        '<div class="we-signal-item">' +
        '<span class="we-signal-del" data-sigidx="' + i + '">✕</span>' +
        '<span class="we-signal-summary">' + u(s.summary||s) + '</span>' +
        '<span class="we-signal-scope">' + u(s.scope||'?') + '</span>' +
        '</div>'
      );
    } else {
      html += '<div class="we-empty" style="margin-top:4px;">暂无市场信号</div>';
    }
    html += '<div class="we-signal-item we-signal-add">➕ 添加信号</div>';
    return html;
  }

  function renderEnemies(enemiesList) {
    if (!enemiesList || !enemiesList.length) return '<div class="we-empty">暂无仇敌</div>';
    return renderPagedList(enemiesList, 'enemies', (en, enemyIndex) => {
      const isEditing = editingEnemy?.index === enemyIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-enemy-delete" data-enemy-index="${enemyIndex}" title="删除仇敌"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-enemy-copy" data-enemy-index="${enemyIndex}" title="复制仇敌"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-enemy-edit" data-enemy-index="${enemyIndex}" title="编辑仇敌"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEnemyEditor(en, enemyIndex) : '';
      return `<div class="we-blood-item">
        ${actionHtml}
        <div class="we-blood-title">${en.type==='blood'?'🩸':'💢'} ${u(en.name)} <span class="we-badge we-badge-danger">${en.status||'追踪中'}</span><span class="we-badge" style="background:var(--we-purple);font-size:10px;">${en.type==='blood'?'血仇':'恩怨'}</span></div>
        <div class="we-blood-meta">原因: ${u(en.reason||'?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderEnemyEditor(en, index) {
    const typeOptions = [['blood','血仇'],['grudge','恩怨']].map(([v,label]) =>
      `<option value="${v}" ${en.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const statusOptions = ['追踪中','策划中','执行中','已终结'].map(s =>
      `<option value="${s}" ${en.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-enemy-index="${index}">
        <button class="we-event-editor-close we-enemy-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">仇敌名称<input class="we-enemy-edit-name" type="text" value="${u(en.name||'')}"></label>
          <label>类型<select class="we-enemy-edit-type">${typeOptions}</select></label>
          <label>状态<select class="we-enemy-edit-status">${statusOptions}</select></label>
          <label class="we-event-editor-wide">原因<textarea class="we-enemy-edit-reason" rows="2">${u(en.reason||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-enemy-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderInfluenceChain(chain) {
    if (!chain || !chain.length) return '<div class="we-empty">暂无影响链</div>';
    return renderPagedList(chain, 'influence', (item, infIndex) => {
      const isEditing = editingInfluence?.index === infIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-influence-delete" data-influence-index="${infIndex}" title="删除影响链"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-influence-copy" data-influence-index="${infIndex}" title="复制影响链"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-influence-edit" data-influence-index="${infIndex}" title="编辑影响链"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderInfluenceEditor(item, infIndex) : '';
      return `<div class="we-influence-item">
        ${actionHtml}
        <div class="we-influence-step we-influence-trigger">
          <span class="we-influence-label">触发源</span>
          <span class="we-influence-text">${u(item.trigger)}</span>
        </div>
        <div class="we-influence-step we-influence-impact">
          <span class="we-influence-label">直接影响</span>
          <span class="we-influence-text">${u(item.impact)}</span>
        </div>
        ${item.fallout ? `<div class="we-influence-step we-influence-fallout">
          <span class="we-influence-label">后续余波</span>
          <span class="we-influence-text">${u(item.fallout)}</span>
        </div>` : ''}
        ${editHtml}
      </div>`;
    });
  }

  function renderInfluenceEditor(item, index) {
    return `
      <div class="we-event-editor" data-influence-index="${index}">
        <button class="we-event-editor-close we-influence-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">触发源<textarea class="we-influence-edit-trigger" rows="2">${u(item.trigger||'')}</textarea></label>
          <label class="we-event-editor-wide">直接影响<textarea class="we-influence-edit-impact" rows="2">${u(item.impact||'')}</textarea></label>
          <label class="we-event-editor-wide">后续余波<textarea class="we-influence-edit-fallout" rows="2">${u(item.fallout||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-influence-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function getRegionalIncidentTypeLabel(type) {
    const labels = {
      banditry: '盗匪劫掠',
      fire: '大火',
      massacre: '恶性凶案',
      flood: '洪涝',
      infrastructure: '道路水利崩坏',
      plague: '疫病',
      famine: '饥荒粮荒',
      riot: '骚乱暴动',
      rebellion: '民变叛乱',
      military: '军务突变',
      earthquake: '地震山崩',
      storm: '风暴雪灾',
      other: '其他'
    };
    return labels[type] || '其他';
  }

  function renderRegionalIncident(ri) {
    if (!ri) return '<div class="we-empty">尚未进行区域突发事件判定</div>';
    const isEditing = editingRI?.active === true;
    const actionHtml = isEditing ? '' : `
      <div class="we-event-actions">
        <button class="we-icon-btn we-ri-delete" title="清除区域突发事件"><i class="fa-solid fa-trash-can"></i></button>
        <button class="we-icon-btn we-ri-copy" title="复制区域突发事件"><i class="fa-solid fa-copy"></i></button>
        <button class="we-icon-btn we-ri-edit" title="编辑区域突发事件"><i class="fa-solid fa-pen"></i></button>
      </div>`;
    const editHtml = isEditing ? renderRIEditor(ri) : '';

    if (ri.active) {
      return `<div class="we-accident-item we-regional-incident-item we-accident-triggered">
        ${actionHtml}
        ⚠️ ${u(ri.title)}<br>
        <span style="font-size:11px;color:var(--we-text3);">类型: ${u(getRegionalIncidentTypeLabel(ri.type))} | 范围: ${u(ri.scope||'?')} | 冷却: ${ri.cooldown||0}轮</span><br>
        <span style="font-size:11px;color:var(--we-text2);">${u(ri.impact||'')}</span>
        ${editHtml}
      </div>`;
    }
    if (ri.title && ri.title.includes('重试')) {
      return `<div class="we-accident-item we-regional-incident-item" style="border-left:3px solid var(--we-gold);">
        ${actionHtml}
        ⚠️ ${u(ri.title)}（类型: ${u(getRegionalIncidentTypeLabel(ri.type))}）
        ${editHtml}
      </div>`;
    }
    if (ri.cooldown > 0) {
      return `<div class="we-accident-item we-regional-incident-item">${actionHtml}✅ 本轮无区域突发事件（剩余冷却 ${ri.cooldown} 轮）${editHtml}</div>`;
    }
    return `<div class="we-accident-item we-regional-incident-item">${actionHtml}✅ 本轮无区域突发事件${editHtml}</div>`;
  }

  function renderRIEditor(ri) {
    const types = ['banditry','fire','massacre','flood','infrastructure','plague','famine','riot','rebellion','military','earthquake','storm'];
    if (ri.type && !types.includes(ri.type)) types.push(ri.type);
    const typeOptions = types.map(t =>
      `<option value="${t}" ${ri.type === t ? 'selected' : ''}>${u(getRegionalIncidentTypeLabel(t))}</option>`).join('');
    return `
      <div class="we-event-editor" data-ri-edit="1">
        <button class="we-event-editor-close we-ri-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label>状态<select class="we-ri-edit-active">
            <option value="true" ${ri.active ? 'selected' : ''}>激活并显示事件</option>
            <option value="false" ${!ri.active ? 'selected' : ''}>未激活</option>
          </select></label>
          <label class="we-event-editor-wide">标题<input class="we-ri-edit-title" type="text" value="${u(ri.title||'')}"></label>
          <label>类型<select class="we-ri-edit-type">${typeOptions}</select></label>
          <label>范围<input class="we-ri-edit-scope" type="text" value="${u(ri.scope||'')}"></label>
          <label>冷却<input class="we-ri-edit-cooldown" type="number" min="0" max="99" value="${ri.cooldown||0}"></label>
          <label class="we-event-editor-wide">影响<textarea class="we-ri-edit-impact" rows="3">${u(ri.impact||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-ri-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderBlackbox(blackbox) {
    if (!blackbox) return '<div class="we-empty">暂无黑盒信息</div>';
    let html = '';
    if (blackbox.secretActions?.length) {
      html += '<div class="we-accident-item" style="border-left-color:var(--we-purple);"><strong>隐秘行为:</strong></div>';
      html += renderPagedList(blackbox.secretActions, 'secret-actions', (a, actIndex) => {
        const isEditing = editingBBAction?.index === actIndex;
        const actionHtml = isEditing ? '' : `
          <div class="we-event-actions">
            <button class="we-icon-btn we-bba-delete" data-bba-index="${actIndex}" title="删除隐秘行为"><i class="fa-solid fa-trash-can"></i></button>
            <button class="we-icon-btn we-bba-copy" data-bba-index="${actIndex}" title="复制隐秘行为"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-bba-edit" data-bba-index="${actIndex}" title="编辑隐秘行为"><i class="fa-solid fa-pen"></i></button>
          </div>`;
        const editHtml = isEditing ? renderBBActionEditor(a, actIndex) : '';
        return `<div class="we-accident-item we-blackbox-item" style="margin:2px 0;font-size:12px;position:relative;">
          ${actionHtml}
          🔒 ${u(a.action||a)} — 知情者: ${u(a.witnesses||'无')}
          ${editHtml}
        </div>`;
      });
    }
    if (blackbox.secretAssets?.length) {
      html += '<div class="we-accident-item" style="border-left-color:var(--we-gold);margin-top:4px;"><strong>隐秘资产:</strong></div>';
      html += renderPagedList(blackbox.secretAssets, 'secret-assets', (a, astIndex) => {
        const statusColor = { '有效': 'var(--we-green)', '过期': 'var(--we-text3)', '暴露': 'var(--we-red)', '失效': 'var(--we-text3)' };
        const sc = statusColor[a.status] || 'var(--we-text3)';
        const isEditing = editingBBAsset?.index === astIndex;
        const actionHtml = isEditing ? '' : `
          <div class="we-event-actions">
            <button class="we-icon-btn we-bbs-delete" data-bbs-index="${astIndex}" title="删除隐秘资产"><i class="fa-solid fa-trash-can"></i></button>
            <button class="we-icon-btn we-bbs-copy" data-bbs-index="${astIndex}" title="复制隐秘资产"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-bbs-edit" data-bbs-index="${astIndex}" title="编辑隐秘资产"><i class="fa-solid fa-pen"></i></button>
          </div>`;
        const editHtml = isEditing ? renderBBAssetEditor(a, astIndex) : '';
        return `<div class="we-accident-item we-blackbox-item" style="margin:2px 0;font-size:12px;position:relative;">
          ${actionHtml}
          📦 ${u(a.name||a)} — 暴露度: ${a.exposure||0}%, <span style="color:${sc}">${u(a.status||'有效')}</span>
          ${editHtml}
        </div>`;
      });
    }
    if (!html) html = '<div class="we-empty">无暗面信息</div>';
    return html;
  }

  function renderBBActionEditor(a, index) {
    return `
      <div class="we-event-editor" data-bba-index="${index}">
        <button class="we-event-editor-close we-bba-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">行为描述<textarea class="we-bba-edit-action" rows="2">${u(a.action||'')}</textarea></label>
          <label class="we-event-editor-wide">目击者<input class="we-bba-edit-witnesses" type="text" value="${u(a.witnesses||'无')}"></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-bba-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderBBAssetEditor(a, index) {
    const statusOptions = ['有效','过期','暴露','失效'].map(s =>
      `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-bbs-index="${index}">
        <button class="we-event-editor-close we-bbs-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">资产名称<input class="we-bbs-edit-name" type="text" value="${u(a.name||'')}"></label>
          <label>暴露度<input class="we-bbs-edit-exposure" type="number" min="0" max="100" value="${a.exposure||0}"></label>
          <label>状态<select class="we-bbs-edit-status">${statusOptions}</select></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-bbs-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderLedger(memories) {
    const entries = (memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return '<div class="we-empty">暂无重大事件记录</div>';
    return renderPagedList(entries, 'ledger', entry => {
      const lines = [];
      for (const c of (entry.changes || [])) {
        if (c.type === 'event_new') {
          const tn = { conflict: '冲突型', progress: '推进型' }[c.eventType] || c.eventType;
          lines.push(`[新增Lv${c.level}${tn}] ${u(c.name)} - ${u(c.stage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_advance') {
          lines.push(`[推进] ${u(c.name)}(Lv${c.level}) ${u(c.fromStage)}->${u(c.toStage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_terminal') {
          const transition = c.fromStage ? `${u(c.fromStage)}->${u(c.stage||c.toStage)}` : u(c.stage||c.toStage);
          lines.push(`[终局] ${u(c.name)}(Lv${c.level}) ${transition} - ${u(c.desc||'')}`);
        } else if (c.type === 'wind_new') {
          lines.push(`[新增Lv${c.level}风声] ${u(c.topic)} - ${u(c.content||'')}`);
        }
      }
      return `<div class="we-ledger-item">
        <span class="we-ledger-round">第${entry.round}轮</span>
        <div class="we-ledger-changes">${lines.map(l => `<div class="we-ledger-line">${l}</div>`).join('')}</div>
      </div>`;
    });
  }

  function renderDebug() {
    const evo = window.WORLD_ENGINE_EVOLUTION;
    if (!evo || !evo.getLastDebug) return '<div class="we-empty">调试数据不可用</div>';
    const dbg = evo.getLastDebug();
    if (!dbg.prompt) return '<div class="we-empty">尚未推演，暂无调试数据</div>';
    const truncPrompt = dbg.prompt.length > 3000 ? dbg.prompt.substring(0, 3000) + '\n\n...(截断，点击下方按钮导出完整文件)' : dbg.prompt;
    const truncResult = dbg.rawResult.length > 3000 ? dbg.rawResult.substring(0, 3000) + '\n\n...(截断，点击下方按钮导出完整文件)' : dbg.rawResult;
    return `
      <div style="margin-bottom:8px;">
        <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">📤 发送给 API 的 Prompt（前3000字预览）</div>
        <pre style="font-size:11px;background:var(--we-bg2);padding:6px;border-radius:4px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;">${u(truncPrompt)}</pre>
      </div>
      <div>
        <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">📥 API 原始返回（前3000字预览）</div>
        <pre style="font-size:11px;background:var(--we-bg2);padding:6px;border-radius:4px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;">${u(truncResult)}</pre>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="we-btn" id="we-export-prompt" style="flex:1;">📤 导出 Prompt</button>
        <button class="we-btn" id="we-export-raw-result" style="flex:1;">📤 导出 API 返回</button>
      </div>
    `;
  }

  function renderSettingsForm() {
    const settings = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings(true)
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    const mode = settings.evolveMode === 'manual' ? 'manual' : 'auto';
    const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);

    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';

    const apiBody = `
      <div class="we-input-group">
        <label>API URL（OpenAI 兼容）</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl||'')}" placeholder="https://api.openai.com/v1">
      </div>
      <div class="we-input-group">
        <label>API Key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey||'')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>模型</label>
          <input type="text" id="we-model" value="${u(settings.model||'gpt-3.5-turbo')}" placeholder="模型名称" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">📋 获取列表</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;">
          <option value="">-- 选择模型 --</option>
        </select>
      </div>`;

    const evolveBody = `
      <div class="we-input-group">
        <label>推演模式</label>
        <select id="we-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>自动（每 X 轮推演一次）</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>手动（仅点「手动推演」才触发）</option>
        </select>
      </div>
      <div class="we-input-group" id="we-evolve-everyx-group" style="${mode === 'manual' ? 'display:none;' : ''}">
        <label>每几轮推演一次（X）</label>
        <input type="number" id="we-evolve-everyx" min="1" step="1" value="${everyX}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">填 1 = 每轮推演；填 3 = 每向前 3 轮推演一次。重 roll 不计入轮数。</div>
      </div>`;

    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-into-prompt" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          注入正文
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭后不会将当前状态或存档点注入聊天正文。</div>
      </div>`;

    const worldbookBody = `
      <div class="we-worldbook-settings">
        <div class="we-worldbook-header">
          <div>
            <div class="we-worldbook-summary" id="we-worldbook-summary">正在读取当前聊天世界书...</div>
          </div>
          <button class="we-icon-btn" id="we-worldbook-reload" title="重新读取当前聊天世界书"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <div class="we-worldbook-toolbar">
          <button class="we-btn" id="we-worldbook-select-all">全选</button>
          <button class="we-btn" id="we-worldbook-clear-all">取消全选</button>
          <button class="we-btn we-btn-primary" id="we-worldbook-save">保存世界书选择</button>
        </div>
        <div class="we-worldbook-list" id="we-worldbook-list">
          <div class="we-empty">正在读取...</div>
        </div>
      </div>`;

    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-export-data">📤 导出 JSON</button>
        <button class="we-btn" id="we-import-data">📥 导入 JSON</button>
        <input type="file" id="we-import-file" accept=".json" style="display:none;">
      </div>`;

    return sec('set-api', '🔌 API 配置', apiBody)
      + sec('set-evolve', '⚙️ 推演模式', evolveBody)
      + sec('set-inject', '💉 正文注入', injectBody)
      + `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">
           <button class="we-btn" id="we-save-settings">💾 保存设置</button>
           <button class="we-btn we-btn-danger" id="we-reset-world" style="margin-left:0;">🗑️ 重置世界</button>
         </div>`
      + sec('set-worldbook', '📚 后台推演世界书', worldbookBody)
      + sec('set-data', '📦 数据导入/导出', dataBody);
  }

  function bindEvents(state) {
    const evolveBtn = document.getElementById('we-btn-evolve');

    function loadScopedState(scope) {
      return scope === 'checkpoint' ? core.restoreCheckpoint() : core.loadState();
    }

    function saveScopedState(scope, scopedState) {
      if (scope === 'checkpoint') core.saveCheckpoint(scopedState);
      else core.saveState(scopedState);
    }

    document.querySelectorAll('.we-event-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event || !confirm(`删除事件“${event.name}”？`)) return;
        scopedState.events.splice(index, 1);
        editingEvent = null;
        saveScopedState(scope, scopedState);
        showToast('事件已删除');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;
        const copy = JSON.parse(JSON.stringify(event));
        delete copy.evolveResult;
        core.ensureEventFields(copy);
        scopedState.events.push(copy);
        saveScopedState(scope, scopedState);
        showToast('事件已复制到列表末尾');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit').forEach(button => {
      button.onclick = () => {
        editingEvent = {
          scope: button.dataset.eventScope,
          index: Number(button.dataset.eventIndex)
        };
        refresh();
      };
    });

    document.querySelectorAll('.we-event-editor-close').forEach(button => {
      button.onclick = () => {
        editingEvent = null;
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit-type').forEach(select => {
      select.onchange = () => {
        const stageSelect = select.closest('.we-event-editor').querySelector('.we-event-edit-stage');
        const stages = select.value === 'progress'
          ? ['筹备', '执行', '关键', '已完成', '已失败']
          : ['萌芽', '发酵', '逼近', '已爆发', '已消散'];
        stageSelect.innerHTML = stages.map(stage => `<option value="${stage}">${stage}</option>`).join('');
      };
    });

    document.querySelectorAll('.we-event-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.eventScope;
        const index = Number(editor.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;

        const name = editor.querySelector('.we-event-edit-name').value.trim();
        if (!name) {
          showToast('事件名字不能为空', true);
          return;
        }
        event.name = name;
        event.level = Number(editor.querySelector('.we-event-edit-level').value);
        event.type = editor.querySelector('.we-event-edit-type').value;
        event.stage = editor.querySelector('.we-event-edit-stage').value;
        event.stageRound = Math.min(9, Math.max(1, Number(editor.querySelector('.we-event-edit-round').value) || 1));
        event.desc = editor.querySelector('.we-event-edit-desc').value.trim();
        event.consecutiveFails = 0;
        delete event.evolveResult;

        // 剩余轮数 → 反推 _terminalSince（仅正面终局）
        const POSITIVE_TERMINALS = ['已爆发', '已完成'];
        if (POSITIVE_TERMINALS.includes(event.stage)) {
          const K = 2 + (event.level || 1) * 2;
          const curRound = scopedState.round || 0;
          let left = Number(editor.querySelector('.we-event-edit-left').value);
          left = Number.isFinite(left) && left >= 1 ? Math.min(K, left) : K;
          event._terminalSince = curRound - K + left - 1;
        } else {
          delete event._terminalSince;
        }
        core.ensureEventFields(event);
        saveScopedState(scope, scopedState);
        editingEvent = null;
        showToast('事件修改已保存');
        refresh();
      };
    });

    // 势力编辑器事件
    document.querySelectorAll('.we-faction-edit').forEach(button => {
      button.onclick = () => {
        editingFaction = { index: Number(button.dataset.factionIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-editor-close').forEach(button => {
      button.onclick = () => { editingFaction = null; refresh(); };
    });
    document.querySelectorAll('.we-faction-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.factionIndex);
        const state = core.loadState();
        const faction = state.factions?.[index];
        if (!faction) return;
        const name = editor.querySelector('.we-faction-edit-name').value.trim();
        if (!name) { showToast('势力名称不能为空', true); return; }
        faction.name = name;
        faction.status = editor.querySelector('.we-faction-edit-status').value;
        faction.relation = editor.querySelector('.we-faction-edit-relation').value;
        faction.scope = editor.querySelector('.we-faction-edit-scope').value.trim();
        faction.currentGoal = editor.querySelector('.we-faction-edit-goal').value.trim();
        faction.core_person = editor.querySelector('.we-faction-edit-core').value.trim();
        const pillars = [];
        editor.querySelectorAll('.we-faction-edit-pillar').forEach(input => {
          const v = input.value.trim().slice(0, 4);
          if (v) pillars.push(v);
        });
        faction.powerPillars = pillars;
        core.saveState(state);
        editingFaction = null;
        showToast('势力修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.factionIndex);
        const state = core.loadState();
        const faction = state.factions?.[index];
        if (!faction || !confirm(`删除势力"${faction.name}"？`)) return;
        state.factions.splice(index, 1);
        core.saveState(state);
        showToast('势力已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.factionIndex);
        const state = core.loadState();
        const faction = state.factions?.[index];
        if (!faction) return;
        const copy = JSON.parse(JSON.stringify(faction));
        state.factions.push(copy);
        core.saveState(state);
        showToast('势力已复制');
        refresh();
      };
    });

    // 风声编辑器事件
    document.querySelectorAll('.we-wind-edit').forEach(button => {
      button.onclick = () => {
        editingWind = { index: Number(button.dataset.windIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-editor-close').forEach(button => {
      button.onclick = () => { editingWind = null; refresh(); };
    });
    document.querySelectorAll('.we-wind-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.windIndex);
        const state = core.loadState();
        const wind = state.winds?.[index];
        if (!wind) return;
        const topic = editor.querySelector('.we-wind-edit-topic').value.trim();
        if (!topic) { showToast('风声主题不能为空', true); return; }
        wind.topic = topic;
        wind.type = editor.querySelector('.we-wind-edit-type').value;
        wind.level = Number(editor.querySelector('.we-wind-edit-level').value);
        wind.scope = editor.querySelector('.we-wind-edit-scope').value.trim();
        wind.source = editor.querySelector('.we-wind-edit-source').value.trim();
        wind.content = editor.querySelector('.we-wind-edit-content').value.trim();
        wind.quietRounds = 0;
        core.saveState(state);
        editingWind = null;
        showToast('风声修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.windIndex);
        const state = core.loadState();
        const wind = state.winds?.[index];
        if (!wind || !confirm(`删除风声"${wind.topic}"？`)) return;
        state.winds.splice(index, 1);
        core.saveState(state);
        showToast('风声已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.windIndex);
        const state = core.loadState();
        const wind = state.winds?.[index];
        if (!wind) return;
        const copy = JSON.parse(JSON.stringify(wind));
        copy.quietRounds = 0;
        state.winds.push(copy);
        core.saveState(state);
        showToast('风声已复制');
        refresh();
      };
    });

    // ===== 天下大势编辑器事件 =====
    document.querySelectorAll('.we-trend-edit').forEach(button => {
      button.onclick = () => {
        editingTrend = { scope: button.dataset.trendScope, index: Number(button.dataset.trendIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-editor-close').forEach(button => {
      button.onclick = () => { editingTrend = null; refresh(); };
    });
    document.querySelectorAll('.we-trend-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.trendScope;
        const index = Number(editor.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const name = editor.querySelector('.we-trend-edit-name').value.trim();
        if (!name) { showToast('大势名称不能为空', true); return; }
        trend.name = name;
        trend.status = editor.querySelector('.we-trend-edit-status').value;
        trend.scope = editor.querySelector('.we-trend-edit-scope').value.trim();
        trend.source = editor.querySelector('.we-trend-edit-source').value.trim();
        trend.description = editor.querySelector('.we-trend-edit-desc').value.trim();
        saveScopedState(scope, scopedState);
        editingTrend = null;
        showToast('天下大势修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend || !confirm(`删除大势"${trend.name}"？`)) return;
        scopedState.worldTrends.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('天下大势已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const copy = JSON.parse(JSON.stringify(trend));
        scopedState.worldTrends.push(copy);
        saveScopedState(scope, scopedState);
        showToast('天下大势已复制');
        refresh();
      };
    });

    // ===== 仇敌编辑器事件 =====
    document.querySelectorAll('.we-enemy-edit').forEach(button => {
      button.onclick = () => {
        editingEnemy = { index: Number(button.dataset.enemyIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-editor-close').forEach(button => {
      button.onclick = () => { editingEnemy = null; refresh(); };
    });
    document.querySelectorAll('.we-enemy-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.enemyIndex);
        const state = core.loadState();
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const name = editor.querySelector('.we-enemy-edit-name').value.trim();
        if (!name) { showToast('仇敌名称不能为空', true); return; }
        enemy.name = name;
        enemy.type = editor.querySelector('.we-enemy-edit-type').value;
        enemy.status = editor.querySelector('.we-enemy-edit-status').value;
        enemy.reason = editor.querySelector('.we-enemy-edit-reason').value.trim();
        core.saveState(state);
        editingEnemy = null;
        showToast('仇敌修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.enemyIndex);
        const state = core.loadState();
        const enemy = state.enemies?.[index];
        if (!enemy || !confirm(`删除仇敌"${enemy.name}"？`)) return;
        state.enemies.splice(index, 1);
        core.saveState(state);
        showToast('仇敌已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.enemyIndex);
        const state = core.loadState();
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const copy = JSON.parse(JSON.stringify(enemy));
        state.enemies.push(copy);
        core.saveState(state);
        showToast('仇敌已复制');
        refresh();
      };
    });

    // ===== 影响链编辑器事件 =====
    document.querySelectorAll('.we-influence-edit').forEach(button => {
      button.onclick = () => {
        editingInfluence = { index: Number(button.dataset.influenceIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-editor-close').forEach(button => {
      button.onclick = () => { editingInfluence = null; refresh(); };
    });
    document.querySelectorAll('.we-influence-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.influenceIndex);
        const state = core.loadState();
        const inf = state.influenceChain?.[index];
        if (!inf) return;
        const trigger = editor.querySelector('.we-influence-edit-trigger').value.trim();
        const impact = editor.querySelector('.we-influence-edit-impact').value.trim();
        if (!trigger || !impact) { showToast('触发源和直接影响不能为空', true); return; }
        inf.trigger = trigger;
        inf.impact = impact;
        inf.fallout = editor.querySelector('.we-influence-edit-fallout').value.trim();
        core.saveState(state);
        editingInfluence = null;
        showToast('影响链修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.influenceIndex);
        const state = core.loadState();
        const inf = state.influenceChain?.[index];
        if (!inf || !confirm(`删除影响链"${inf.trigger}"？`)) return;
        state.influenceChain.splice(index, 1);
        core.saveState(state);
        showToast('影响链已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.influenceIndex);
        const state = core.loadState();
        const inf = state.influenceChain?.[index];
        if (!inf) return;
        const copy = JSON.parse(JSON.stringify(inf));
        state.influenceChain.push(copy);
        core.saveState(state);
        showToast('影响链已复制');
        refresh();
      };
    });

    // ===== 区域突发事件编辑器事件 =====
    document.querySelectorAll('.we-ri-edit').forEach(button => {
      button.onclick = () => {
        editingRI = { active: true };
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-editor-close').forEach(button => {
      button.onclick = () => { editingRI = null; refresh(); };
    });
    document.querySelectorAll('.we-ri-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const state = core.loadState();
        if (!state.regionalIncident) {
          state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: 0, _retry: false, _retryType: '' };
        }
        const ri = state.regionalIncident;
        ri.active = editor.querySelector('.we-ri-edit-active').value === 'true';
        ri.title = editor.querySelector('.we-ri-edit-title').value.trim();
        ri.type = editor.querySelector('.we-ri-edit-type').value;
        ri.scope = editor.querySelector('.we-ri-edit-scope').value.trim();
        ri.cooldown = Math.max(0, Number(editor.querySelector('.we-ri-edit-cooldown').value) || 0);
        ri.impact = editor.querySelector('.we-ri-edit-impact').value.trim();
        core.saveState(state);
        editingRI = null;
        showToast('区域突发事件修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-delete').forEach(button => {
      button.onclick = () => {
        const state = core.loadState();
        if (!state.regionalIncident) return;
        if (!confirm('清除区域突发事件？')) return;
        state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: state.regionalIncident.cooldown || 0, _retry: false, _retryType: '' };
        core.saveState(state);
        showToast('区域突发事件已清除');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-copy').forEach(button => {
      button.onclick = () => {
        const state = core.loadState();
        if (!state.regionalIncident) return;
        const copy = JSON.parse(JSON.stringify(state.regionalIncident));
        copy._retry = false;
        copy._retryType = '';
        copy.cooldown = 0;
        state.regionalIncident = copy;
        core.saveState(state);
        showToast('区域突发事件已复制（冷却已重置）');
        refresh();
      };
    });

    // ===== 黑盒隐秘行为编辑器事件 =====
    document.querySelectorAll('.we-bba-edit').forEach(button => {
      button.onclick = () => {
        editingBBAction = { index: Number(button.dataset.bbaIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-bba-editor-close').forEach(button => {
      button.onclick = () => { editingBBAction = null; refresh(); };
    });
    document.querySelectorAll('.we-bba-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.bbaIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretActions?.[index];
        if (!a) return;
        const action = editor.querySelector('.we-bba-edit-action').value.trim();
        if (!action) { showToast('行为描述不能为空', true); return; }
        a.action = action;
        a.witnesses = editor.querySelector('.we-bba-edit-witnesses').value.trim() || '无';
        core.saveState(state);
        editingBBAction = null;
        showToast('隐秘行为修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-bba-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.bbaIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretActions?.[index];
        if (!a || !confirm(`删除隐秘行为？`)) return;
        state.blackbox.secretActions.splice(index, 1);
        core.saveState(state);
        showToast('隐秘行为已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-bba-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.bbaIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretActions?.[index];
        if (!a) return;
        const copy = JSON.parse(JSON.stringify(a));
        state.blackbox.secretActions.push(copy);
        core.saveState(state);
        showToast('隐秘行为已复制');
        refresh();
      };
    });

    // ===== 黑盒隐秘资产编辑器事件 =====
    document.querySelectorAll('.we-bbs-edit').forEach(button => {
      button.onclick = () => {
        editingBBAsset = { index: Number(button.dataset.bbsIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-bbs-editor-close').forEach(button => {
      button.onclick = () => { editingBBAsset = null; refresh(); };
    });
    document.querySelectorAll('.we-bbs-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const index = Number(editor.dataset.bbsIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretAssets?.[index];
        if (!a) return;
        const name = editor.querySelector('.we-bbs-edit-name').value.trim();
        if (!name) { showToast('资产名称不能为空', true); return; }
        a.name = name;
        a.exposure = Math.min(100, Math.max(0, Number(editor.querySelector('.we-bbs-edit-exposure').value) || 0));
        a.status = editor.querySelector('.we-bbs-edit-status').value;
        core.saveState(state);
        editingBBAsset = null;
        showToast('隐秘资产修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-bbs-delete').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.bbsIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretAssets?.[index];
        if (!a || !confirm(`删除隐秘资产"${a.name}"？`)) return;
        state.blackbox.secretAssets.splice(index, 1);
        core.saveState(state);
        showToast('隐秘资产已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-bbs-copy').forEach(button => {
      button.onclick = () => {
        const index = Number(button.dataset.bbsIndex);
        const state = core.loadState();
        const a = state.blackbox?.secretAssets?.[index];
        if (!a) return;
        const copy = JSON.parse(JSON.stringify(a));
        state.blackbox.secretAssets.push(copy);
        core.saveState(state);
        showToast('隐秘资产已复制');
        refresh();
      };
    });

    // ===== 区块折叠/展开事件 =====
    document.querySelectorAll('.we-section-toggle').forEach(toggle => {
      toggle.onclick = () => {
        const sectionId = toggle.dataset.section;
        sectionCollapsed[sectionId] = !sectionCollapsed[sectionId];
        const body = document.getElementById('we-section-body-' + sectionId);
        const arrow = document.getElementById('we-section-arrow-' + sectionId);
        if (body) body.style.display = sectionCollapsed[sectionId] ? 'none' : '';
        if (arrow) arrow.textContent = sectionCollapsed[sectionId] ? '▶' : '▼';
      };
    });

    if (evolveBtn) {
      const abortBtn = document.getElementById('we-btn-abort');

      evolveBtn.onclick = async () => {
        if (isEvolving) return;
        // 后台已有推演（如自动推演）在跑：提示而非触发，避免 busy 被当成「推演失败」
        if (evolution.isRunning?.()) {
          if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('⏳ 已有推演进行中...');
          showToast('⏳ 已有推演进行中，请稍候');
          return;
        }
        isEvolving = true;
        setEvolvingUI(true);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('⏳ 推演中...');
        try {
          const ctx = SillyTavern.getContext();
          const s = core.loadState();
          const chat = ctx?.chat || [];
          const lastMsg = chat[chat.length - 1];
          const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
          const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '') : '';
          const ok = await evolution.evolve(s, userMsg, aiMsg);
          if (ok && window.WORLD_ENGINE_LEDGER) window.WORLD_ENGINE_LEDGER.recordChanges(s);
          if (ok && window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
          if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(ok ? '✅ 推演完成' : '❌ 推演失败', !ok);
          if (ok) showToast('✅ 推演完成');
        } catch(e) {
          if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('❌ 推演失败: ' + e.message, true);
          showToast('❌ ' + e.message, true);
        }
        isEvolving = false;
        setEvolvingUI(false);
        refresh();
      };

      if (abortBtn) {
        abortBtn.onclick = () => {
          evolution.abort();
          showToast('已发送停止信号');
        };
      }
      setEvolvingUI(isEvolving || Boolean(evolution.isRunning?.()));
    }

    const refreshBtn = document.getElementById('we-btn-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refresh();

    const saveBtn = document.getElementById('we-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const ns = {
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || 'gpt-3.5-turbo',
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          evolveMode: document.getElementById('we-evolve-mode')?.value === 'manual' ? 'manual' : 'auto',
          evolveEveryX: Math.max(1, parseInt(document.getElementById('we-evolve-everyx')?.value) || 1)
        };
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(ns));
        if (window.WORLD_ENGINE_API) window.WORLD_ENGINE_API.getSettings(true);
        window.WORLD_ENGINE?.applyInjection?.();
        showToast('✅ 设置已保存');
      };
    }

    // 推演模式切换：手动时隐藏 X 输入
    const evolveModeSel = document.getElementById('we-evolve-mode');
    if (evolveModeSel) {
      evolveModeSel.onchange = () => {
        const group = document.getElementById('we-evolve-everyx-group');
        if (group) group.style.display = evolveModeSel.value === 'manual' ? 'none' : '';
      };
    }

    const worldbookList = document.getElementById('we-worldbook-list');
    if (worldbookList) {
      const worldbook = window.WORLD_ENGINE_WORLDBOOK;
      const summary = document.getElementById('we-worldbook-summary');
      const reloadBtn = document.getElementById('we-worldbook-reload');
      const selectAllBtn = document.getElementById('we-worldbook-select-all');
      const clearAllBtn = document.getElementById('we-worldbook-clear-all');
      const saveWorldbookBtn = document.getElementById('we-worldbook-save');

      function updateWorldbookSummary() {
        const checkboxes = [...worldbookList.querySelectorAll('.we-worldbook-entry-check')];
        const selected = checkboxes.filter(checkbox => checkbox.checked);
        const chars = selected.reduce((total, checkbox) => total + Number(checkbox.dataset.chars || 0), 0);
        if (summary) summary.textContent = `${selected.length}/${checkboxes.length} 条已选，约 ${chars} 字符`;
      }

      async function loadWorldbookEntries() {
        if (!worldbook) {
          worldbookList.innerHTML = '<div class="we-empty">世界书模块未加载</div>';
          return;
        }
        worldbookList.innerHTML = '<div class="we-empty">正在读取当前聊天世界书...</div>';
        if (reloadBtn) reloadBtn.disabled = true;
        try {
          const entries = await worldbook.loadCurrentEntries();
          const currentChatId = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
          const savedIds = worldbook.getSelectedIds();
          _wbCachedEntries = entries;
          _wbCachedChatId = currentChatId;
          // 首次进入该聊天（无历史保存记录）则自动全选启用条目
          if (!savedIds.length && entries.length) {
            const allIds = entries.filter(e => !e.disabled).map(e => e.id);
            worldbook.saveSelectedIds(allIds);
            _wbCachedSelectedIds = new Set(allIds);
            showToast(`✅ 已自动全选 ${allIds.length} 条世界书条目`);
          } else {
            const enabledIds = new Set(entries.filter(e => !e.disabled).map(e => e.id));
            const validSavedIds = savedIds.filter(id => enabledIds.has(id));
            _wbCachedSelectedIds = new Set(validSavedIds);
            if (validSavedIds.length !== savedIds.length) {
              worldbook.saveSelectedIds(validSavedIds);
            }
          }
          renderWorldbookList();
        } catch(error) {
          worldbookList.innerHTML = `<div class="we-empty">读取失败：${u(error.message)}</div>`;
          if (summary) summary.textContent = '读取失败';
          _wbCachedEntries = null;
          _wbCachedSelectedIds = null;
          _wbCachedChatId = null;
        } finally {
          if (reloadBtn) reloadBtn.disabled = false;
        }
      }

      function renderWorldbookList() {
        const entries = _wbCachedEntries;
        const selectedIds = _wbCachedSelectedIds || new Set();
        if (!entries || !entries.length) {
          worldbookList.innerHTML = '<div class="we-empty">当前聊天未关联可读取的世界书条目</div>';
          if (summary) summary.textContent = '0 条可选';
          return;
        }
        const groups = new Map();
        for (const entry of entries) {
          if (!groups.has(entry.world)) groups.set(entry.world, []);
          groups.get(entry.world).push(entry);
        }
        worldbookList.innerHTML = [...groups.entries()].map(([world, worldEntries]) => {
          const expanded = expandedWorldbookGroups.has(world);
          return `
          <div class="we-worldbook-group" data-worldbook-group="${u(world)}">
            <div class="we-worldbook-group-header">
              <span>${expanded ? '▼' : '▶'}</span>
              <div class="we-worldbook-group-title">
                <div>${u(world)} <span>${worldEntries.length}条</span></div>
              </div>
              <div class="we-worldbook-group-actions">
                <button type="button" data-worldbook-group-action="select">全选</button>
                <button type="button" data-worldbook-group-action="clear">取消全选</button>
              </div>
            </div>
            <div class="we-worldbook-group-body" style="${expanded ? '' : 'display:none;'}">
            ${worldEntries.map(entry => `
              <label class="we-worldbook-entry${entry.disabled ? ' is-disabled' : ''}">
                <input class="we-worldbook-entry-check" type="checkbox" value="${u(entry.id)}" data-chars="${entry.content.length}" ${selectedIds.has(entry.id) && !entry.disabled ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                <span>
                  <strong>${u(entry.title)}</strong>
                  <small>${entry.content.length} 字符${entry.disabled ? ' · 世界书内已停用' : ''}</small>
                </span>
              </label>`).join('')}
            </div>
          </div>`;
        }).join('');
          worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
            checkbox.onchange = () => {
              _wbCachedSelectedIds = new Set([...worldbookList.querySelectorAll('.we-worldbook-entry-check:checked')].map(cb => cb.value));
              updateWorldbookSummary();
            };
          });
          worldbookList.querySelectorAll('.we-worldbook-group-header').forEach(header => {
            header.onclick = () => {
              const body = header.nextElementSibling;
              const arrow = header.querySelector('span');
              if (body) {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
                const world = header.closest('.we-worldbook-group')?.dataset.worldbookGroup;
                if (world) {
                  if (isHidden) expandedWorldbookGroups.add(world);
                  else expandedWorldbookGroups.delete(world);
                }
              }
            };
          });
          worldbookList.querySelectorAll('[data-worldbook-group-action]').forEach(button => {
            button.onclick = (e) => {
              e.stopPropagation();
              const group = button.closest('.we-worldbook-group');
              if (!group) return;
              const checked = button.dataset.worldbookGroupAction === 'select';
              group.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
                checkbox.checked = checked;
                checkbox.onchange();
              });
            };
          });
          updateWorldbookSummary();
          // 恢复滚动位置（refresh() 重建 DOM 后补回）
          if (_wbScrollTop) worldbookList.scrollTop = _wbScrollTop;
      }

      if (reloadBtn) reloadBtn.onclick = () => { _wbCachedEntries = null; _wbCachedChatId = null; loadWorldbookEntries(); };
      if (selectAllBtn) selectAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
          checkbox.checked = true;
          checkbox.onchange();
        });
      };
      if (clearAllBtn) clearAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
          checkbox.checked = false;
          checkbox.onchange();
        });
      };
      if (saveWorldbookBtn) saveWorldbookBtn.onclick = () => {
        worldbook.saveSelectedIds([..._wbCachedSelectedIds]);
        showToast(`✅ 已保存 ${_wbCachedSelectedIds.size} 条后台世界书条目`);
        updateWorldbookSummary();
      };
      // refresh() 重建 DOM 时，如果 chatId 未变且已有缓存，直接渲染，避免勾选丢失
      const currentChatIdNow = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
      if (_wbCachedEntries && _wbCachedChatId === currentChatIdNow) {
        renderWorldbookList();
      } else {
        loadWorldbookEntries();
      }
    }

    const resetBtn = document.getElementById('we-reset-world');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('重置当前聊天所有世界状态和记忆？不可恢复！')) {
          const ns = core.getDefaultState();
          core.saveState(ns);
          showToast('🔄 世界已重置');
          refresh();
        }
      };
    }

    const settingsToggle = document.querySelector('.we-settings-toggle');
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        const body = document.getElementById('we-settings-body');
        const arrow = settingsToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
        }
      };
    }

    const debugToggle = document.querySelector('.we-debug-toggle');
    if (debugToggle) {
      debugToggle.onclick = () => {
        const body = document.getElementById('we-debug-body');
        const arrow = debugToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
          if (!isHidden) refresh();
        }
      };
    }

    const fetchBtn = document.getElementById('we-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const api = window.WORLD_ENGINE_API;
        if (!api) { showToast('❌ API 模块未加载', true); return; }
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({
          ...(api.getSettings ? api.getSettings(true) : {}),
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || '',
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false
        }));
        if (api.getSettings) api.getSettings(true);
        fetchBtn.disabled = true;
        fetchBtn.textContent = '⏳ 获取中...';
        try {
          const models = await api.fetchModelList();
          const select = document.getElementById('we-model-list');
          if (select) {
            select.innerHTML = '<option value="">-- 选择模型 --</option>' +
              models.map(m => '<option value="' + u(m) + '">' + u(m) + '</option>').join('');
            select.style.display = 'block';
            select.onchange = () => {
              const modelInput = document.getElementById('we-model');
              if (modelInput) modelInput.value = select.value;
            };
          }
          showToast('✅ 获取到 ' + models.length + ' 个模型');
        } catch(e) {
          showToast('❌ ' + e.message, true);
        }
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '📋 获取列表';
      };
    }

    const exportBtn = document.getElementById('we-export-data');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const s = core.loadState();
        const checkpoint = core.restoreCheckpoint();
        const clean = core.getCleanExport(s);
        const cleanCheckpoint = checkpoint ? core.getCleanExport(checkpoint) : null;
        const exportData = {
          version: '1.2',
          exportedAt: new Date().toISOString(),
          chatId: core.getChatId(),
          state: clean,
          checkpoint: cleanCheckpoint,
          fingerprint: core.loadFingerprint()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-' + core.getChatId() + '-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ 已导出');
      };
    }

    const importBtn = document.getElementById('we-import-data');
    const importFile = document.getElementById('we-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            const isRegionalIncident = data && typeof data === 'object' &&
              Object.prototype.hasOwnProperty.call(data, 'active') &&
              Object.prototype.hasOwnProperty.call(data, 'title') &&
              Object.prototype.hasOwnProperty.call(data, 'impact');
            if (isRegionalIncident) {
              const state = core.loadState();
              state.regionalIncident = {
                active: data.active === true || data.active === 'true',
                title: String(data.title || ''),
                type: String(data.type || 'other'),
                scope: String(data.scope || ''),
                impact: String(data.impact || ''),
                cooldown: Math.max(0, Number(data.cooldown) || 0),
                _retry: data._retry === true || data._retry === 'true',
                _retryType: String(data._retryType || '')
              };
              core.saveState(state);
              showToast('✅ 区域突发事件导入成功');
              refresh();
              return;
            }
            if (data.version !== '1.2') { showToast('❌ 不支持的存档格式版本', true); return; }
            if (!data.state) { showToast('❌ 无效的导入文件', true); return; }
            const s = data.state;
            if (s.round === undefined) { showToast('❌ 缺少 round 字段', true); return; }
            core.importState(s);
            if (Object.prototype.hasOwnProperty.call(data, 'checkpoint')) {
              if (data.checkpoint) core.saveCheckpoint(data.checkpoint);
              else core.clearCheckpoint();
            }
            if (Object.prototype.hasOwnProperty.call(data, 'fingerprint')) {
              core.saveFingerprint(data.fingerprint || '');
            }
            showToast('✅ 导入成功！第' + s.round + '轮，' + (s.memories||[]).filter(m=>m.type==='ledger').length + '轮账本');
            refresh();
          } catch(err) {
            showToast('❌ 解析失败: ' + err.message, true);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      };
    }

    // 调试区导出按钮
    function setupDownload(content, filename) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('❌ 无 Prompt 可导出', true); return; }
        setupDownload(dbg.prompt, 'prompt-' + Date.now() + '.txt');
        showToast('✅ Prompt 已导出');
      };
    }

    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('❌ 无 API 返回可导出', true); return; }
        setupDownload(dbg.rawResult, 'api-raw-' + Date.now() + '.txt');
        showToast('✅ API 返回已导出');
      };
    }
  }

  function showPanel() {
    if (!panelElement) buildPanel();
    panelElement.style.display = 'flex';
    panelVisible = true;
    refresh();
  }

  function hidePanel() {
    if (!panelElement) return;
    panelElement.style.display = 'none';
    panelVisible = false;
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  function initDrag(panel, handle) {
    let dragging = false, startX, startY, startLeft, startTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.we-panel-close') || e.target.closest('.we-panel-header-actions')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      panel.style.cursor = '';
    });
  }

  /** 获取当前对话层数 */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return chat.length || 0;
    } catch(e) { return '?'; }
  }

  /** 设置面板状态条 */
  function setStatus(text, isError) {
    const statusBar = document.getElementById('we-status-bar');
    if (!statusBar) return;
    statusBar.textContent = text;
    statusBar.className = 'we-status-bar' + (isError ? ' error' : '');
  }

  // ========== 全局事件委托：声誉点击 + economy 编辑 ==========
  document.addEventListener('click', function(e) {
    // 声誉方块点击
    var dot = e.target.closest('.we-rep-dot');
    if (dot) {
      var dim = dot.getAttribute('data-dim');
      var level = dot.getAttribute('data-level');
      if (dim && level) {
        var s = window.WORLD_ENGINE_CORE.loadState();
        s.reputation[dim] = level;
        window.WORLD_ENGINE_CORE.saveState(s);
        refresh();
      }
      return;
    }
    // climate 按钮点击
    var cb = e.target.closest('.we-climate-btn');
    if (cb) {
      var c = cb.getAttribute('data-climate');
      if (c) {
        var s = window.WORLD_ENGINE_CORE.loadState();
        s.economy.climate = c;
        window.WORLD_ENGINE_CORE.saveState(s);
        refresh();
      }
      return;
    }
    // 通用列表翻页
    var arr = e.target.closest('.we-list-arrow');
    if (arr) {
      var rid = arr.getAttribute('data-rid');
      var dir = parseInt(arr.getAttribute('data-dir'));
      if (!rid || isNaN(dir)) return;
      // 找到对应的翻页器
      var pager = arr.parentNode;
      var curSpan = pager.querySelector('.we-list-cur');
      if (!curSpan) return;
      var curPage = parseInt(curSpan.textContent);
      var list = document.querySelector('.we-paged-list[data-rid="' + rid + '"]');
      if (!list) return;
      var items = list.querySelectorAll('.we-page-item');
      var pages = Array.from(items).map(function(el) {
        return { el: el, page: parseInt(el.getAttribute('data-page')) };
      });
      if (!pages.length) return;
      var maxPage = Math.max.apply(null, pages.map(function(p){return p.page;}));
      var newPage = ((curPage - 1 + dir) % maxPage + maxPage) % maxPage + 1;
      pages.forEach(function(p) { p.el.style.display = p.page === newPage ? '' : 'none'; });
      curSpan.textContent = newPage;
      listPageState[rid] = newPage;
      return;
    }
    // 删除 signal
    var sd = e.target.closest('.we-signal-del');
    if (sd) {
      var idx = parseInt(sd.getAttribute('data-sigidx'));
      if (!isNaN(idx)) {
        var s = window.WORLD_ENGINE_CORE.loadState();
        if (s.economy.signals && s.economy.signals[idx] !== undefined) {
          s.economy.signals.splice(idx, 1);
          window.WORLD_ENGINE_CORE.saveState(s);
          refresh();
        }
      }
      return;
    }
    // 添加 signal
    if (e.target.closest('.we-signal-add')) {
      var s = window.WORLD_ENGINE_CORE.loadState();
      if (!s.economy.signals) s.economy.signals = [];
      if (s.economy.signals.length < 5) {
        s.economy.signals.push({ summary: '新信号', scope: '区域' });
        window.WORLD_ENGINE_CORE.saveState(s);
        refresh();
      }
      return;
    }
  });

  // 全局事件委托：signal 双击编辑
  document.addEventListener('dblclick', function(e) {
    var sum = e.target.closest('.we-signal-summary');
    var sc = e.target.closest('.we-signal-scope');
    if (!sum && !sc) return;
    e.preventDefault();
    var item = sum || sc;
    var isScope = !!sc;
    var parent = item.closest('.we-signal-item');
    if (!parent) return;
    var del = parent.querySelector('.we-signal-del');
    var idx = del ? parseInt(del.getAttribute('data-sigidx')) : -1;
    if (isNaN(idx)) return;
    var oldText = item.textContent;
    item.contentEditable = 'true';
    item.focus();
    // select all text
    var range = document.createRange();
    range.selectNodeContents(item);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    item.onblur = function() {
      item.contentEditable = 'false';
      var s = window.WORLD_ENGINE_CORE.loadState();
      if (s.economy.signals && s.economy.signals[idx]) {
        if (isScope) s.economy.signals[idx].scope = item.textContent;
        else s.economy.signals[idx].summary = item.textContent;
        window.WORLD_ENGINE_CORE.saveState(s);
      }
    };
    item.onkeydown = function(ke) {
      if (ke.key === 'Enter') { ke.preventDefault(); item.blur(); }
    };
  });

  // ========== 推演 UI 状态切换 ==========
  function setEvolvingUI(active) {
    const abortBtn = document.getElementById('we-btn-abort');
    const evolveBtn = document.getElementById('we-btn-evolve');
    if (abortBtn) abortBtn.disabled = !active;
    if (evolveBtn) {
      evolveBtn.disabled = active;
      evolveBtn.textContent = active ? '⏳ 推演中...' : '🌀 手动推演';
    }
    const ball = document.getElementById('we-input-btn');
    if (ball && active) {
      ball.classList.add('we-ball-evolving');
      ball.classList.remove('we-ball-success', 'we-ball-fail');
    } else if (ball && !active) {
      ball.classList.remove('we-ball-evolving');
    }
  }

  // ========== 世界引擎悬浮球 ==========
  let inputButtonObserver = null;
  let inputButtonRetryTimer = null;
  const WE_BALL_POS_KEY = 'we-ball-pos';
  let _ballStatusTimer = null;

  function loadBallPos() {
    try {
      const raw = localStorage.getItem(WE_BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') return p;
      }
    } catch (_) {}
    return null;
  }

  function saveBallPos(left, top) {
    try { localStorage.setItem(WE_BALL_POS_KEY, JSON.stringify({ left, top })); } catch (_) {}
  }

  function applyBallPos(ball) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = ball.offsetWidth || 52;
    let pos = loadBallPos();
    if (!pos) pos = { left: vw - size - 18, top: vh - size - 90 };
    // 钳制进可视区域，避免拖出屏幕后找不到
    pos.left = Math.max(4, Math.min(pos.left, vw - size - 4));
    pos.top = Math.max(4, Math.min(pos.top, vh - size - 4));
    ball.style.left = pos.left + 'px';
    ball.style.top = pos.top + 'px';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
  }

  function makeBallDraggable(ball) {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      dragging = true; moved = false;
      sx = pt.clientX; sy = pt.clientY;
      const rect = ball.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      ball.classList.add('we-ball-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - sx, dy = pt.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (e.cancelable) e.preventDefault();
      const size = ball.offsetWidth || 52;
      let left = Math.max(4, Math.min(ox + dx, window.innerWidth - size - 4));
      let top = Math.max(4, Math.min(oy + dy, window.innerHeight - size - 4));
      ball.style.left = left + 'px';
      ball.style.top = top + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      ball.classList.remove('we-ball-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (moved) saveBallPos(parseFloat(ball.style.left), parseFloat(ball.style.top));
    };
    ball.addEventListener('mousedown', onDown);
    ball.addEventListener('touchstart', onDown, { passive: true });
    // 仅在没拖动时才视为点击
    ball.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; }
    }, true);
  }

  function observeInputButton() {
    if (inputButtonObserver || !document.body) return;
    inputButtonObserver = new MutationObserver(() => {
      if (!document.getElementById('we-input-btn')) {
        clearTimeout(inputButtonRetryTimer);
        inputButtonRetryTimer = setTimeout(buildInputButton, 50);
      }
    });
    inputButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 解析推演状态文本 → 切换地球形态 + 进度环
  function setBallState(text, isError) {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const tip = ball.querySelector('.we-ball-tip');
    const ring = ball.querySelector('.we-ball-ring');
    const badge = ball.querySelector('.we-ball-badge');
    if (tip) tip.textContent = text || '';

    ball.classList.remove('we-ball-evolving', 'we-ball-success', 'we-ball-fail');
    clearTimeout(_ballStatusTimer);

    const count = ball.querySelector('.we-ball-count');
    const clearCount = () => {
      ball.classList.remove('we-ball-counting');
      if (count) count.textContent = '';
      if (ring) ring.style.setProperty('--we-ring-pct', '0deg');
    };

    if (/推演中|⏳/.test(text)) {
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      clearCount(); // 推演进行中不展示轮次计数，避免残留旧的 N/X
    } else if (isError || /失败|异常|❌/.test(text)) {
      ball.classList.add('we-ball-fail');
      if (badge) badge.textContent = '✕';
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 6000);
    } else if (/完成|✅/.test(text)) {
      ball.classList.add('we-ball-success');
      if (badge) badge.textContent = '✓';
      clearCount(); // 推演完成 → 计数已归零，清掉进度环与数字
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 4000);
    }

    // 解析「第 N/X 轮」→ 进度环 + 数字（仅未到推演的提示态才显示）
    const m = /第\s*(\d+)\s*\/\s*(\d+)\s*轮/.exec(text || '');
    if (ring && m) {
      const cur = Number(m[1]), total = Number(m[2]) || 1;
      const pct = Math.max(0, Math.min(1, cur / total));
      ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
      ball.classList.toggle('we-ball-counting', cur > 0 && cur < total);
      if (count) count.textContent = (cur < total) ? `${cur}/${total}` : '';
    }
  }

  function clearBallBadge() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    ball.classList.remove('we-ball-success', 'we-ball-fail');
    const badge = ball.querySelector('.we-ball-badge');
    if (badge) badge.textContent = '';
    const tip = ball.querySelector('.we-ball-tip');
    if (tip) tip.textContent = '';
  }

  function buildInputButton() {
    if (!document.body) return;

    let btn = document.getElementById('we-input-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'we-input-btn';
      btn.type = 'button';
      btn.title = '世界引擎';
      btn.setAttribute('aria-label', '世界引擎');
      btn.className = 'we-ball';
      btn.innerHTML =
        '<span class="we-ball-ring"></span>' +
        '<span class="we-ball-globe"></span>' +
        '<span class="we-ball-count"></span>' +
        '<span class="we-ball-badge"></span>' +
        '<span class="we-ball-tip"></span>';
      btn.onclick = () => togglePanel();
      document.body.appendChild(btn);
      applyBallPos(btn);
      makeBallDraggable(btn);
      window.addEventListener('resize', () => applyBallPos(btn));
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
      applyBallPos(btn);
    }

    // 兼容旧的外部状态接口：保留隐藏元素，转发到地球状态机
    let statusIndicator = document.getElementById('we-external-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('span');
      statusIndicator.id = 'we-external-status';
      statusIndicator.style.display = 'none';
      document.body.appendChild(statusIndicator);
    }

    window.__WE_SetExternalStatus = function(text, isError) {
      const el = document.getElementById('we-external-status');
      if (el) el.textContent = text;
      setBallState(text || '', !!isError);
    };

    buildPanel();
    observeInputButton();
  }

  return { buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus, setEvolvingUI };
})();
