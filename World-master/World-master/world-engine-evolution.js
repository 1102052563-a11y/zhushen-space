// world-engine-evolution.js — 世界推演 API 调用（使用完整活体引擎规则）
window.WORLD_ENGINE_EVOLUTION = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const api = window.WORLD_ENGINE_API;

  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['萌芽', '发酵', '逼近'],
    progress: ['筹备', '执行', '关键']
  };
  const EVENT_FINAL_STAGE = {
    conflict: '已爆发',
    progress: '已完成'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['已爆发', '已消散'],
    progress: ['已完成', '已失败']
  };
  const EVENT_STAGE_BASE = {
    conflict: { '萌芽': 95, '发酵': 85, '逼近': 75 },
    progress: { '筹备': 75, '执行': 85, '关键': 95 }
  };
  const WIND_DECAY = {
    announcement: { base: 10, grace: 4, linear: 3, quadratic: 1 },
    report: { base: 20, grace: 2, linear: 4, quadratic: 2 },
    rumor: { base: 25, grace: 1, linear: 5, quadratic: 3 },
    sentiment: { base: 8, grace: 5, linear: 2, quadratic: 1 }
  };

  let _lastPrompt = '';
  let _lastRawResult = '';

  function getLastDebug() {
    return { prompt: _lastPrompt, rawResult: _lastRawResult };
  }

  // ========== 区域突发事件骰子系统 ==========

  const REGIONAL_INCIDENT_CONFIG = {
    chance: 0.03,
    cooldownRounds: 10,
    typeWeights: [
      { type: 'banditry', label: '盗匪劫掠', weight: 18 },
      { type: 'fire', label: '大火', weight: 14 },
      { type: 'massacre', label: '恶性凶案', weight: 10 },
      { type: 'flood', label: '洪涝', weight: 10 },
      { type: 'infrastructure', label: '道路水利崩坏', weight: 10 },
      { type: 'plague', label: '疫病', weight: 9 },
      { type: 'famine', label: '饥荒粮荒', weight: 8 },
      { type: 'riot', label: '骚乱暴动', weight: 8 },
      { type: 'rebellion', label: '民变叛乱', weight: 5 },
      { type: 'military', label: '军务突变', weight: 4 },
      { type: 'earthquake', label: '地震山崩', weight: 2 },
      { type: 'storm', label: '风暴雪灾', weight: 2 }
    ]
  };

  const INCIDENT_TYPE_GUIDE = {
    banditry: '盗匪劫掠：山贼、水匪、流寇、贼伙、劫镖、截船、抢粮、抢盐、屠掠村寨或商队。',
    fire: '大火：坊市、粮仓、码头、寺院、官署、工坊、船队、货栈发生区域性火灾。',
    massacre: '恶性凶案：连环杀人、灭门案、客栈血案、商队被屠、码头尸案等足以引发恐慌的案件。',
    flood: '洪涝：河水暴涨、堤坝决口、码头被淹、村田被毁、桥梁被冲毁。',
    infrastructure: '道路水利崩坏：官道塌方、桥梁坍塌、渡口停摆、堤坝裂口、水闸损毁、驿路断绝。',
    plague: '疫病：人疫、畜疫、水源染病、村落封闭、码头拒载、城中高热病人暴增。',
    famine: '饥荒粮荒：粮仓见底、赈粮断供、粮价暴涨、灾民抢粮、大户闭仓、乡村断炊。',
    riot: '骚乱暴动：码头械斗、饥民抢粮、香客踩踏、盐铺被砸、关卡冲突、市井冲突扩大。',
    rebellion: '民变叛乱：流民立寨、乡兵反官、税役暴动、邪教聚众、地方叛乱。',
    military: '军务突变：守军哗变、军粮被劫、边军溃逃、敌军越境、关隘戒严、军营夜惊。',
    earthquake: '地震山崩：地震、山崩、矿山塌陷、地裂、山村被埋。',
    storm: '风暴雪灾：台风、暴雪、沙暴、寒潮、海风毁船、大风摧毁棚屋。'
  };

  function ensureRegionalIncident(state) {
    if (!state.regionalIncident) {
      state.regionalIncident = {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    }
  }

  function weightedPick(items, randomFn = Math.random) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = randomFn() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function buildRegionalIncidentPrompt(picked) {
    const guide = INCIDENT_TYPE_GUIDE[picked.type] || '';
    return `
【本地骰子强制指令：本轮必须生成区域突发事件】
本地骰子已判定：本轮触发区域突发事件。
本地骰子已指定事件类型：
类型：${picked.label}
type：${picked.type}
类型说明：${guide}
你必须根据当前世界状态，生成一个符合该类型的区域级突发事件。
事件必须满足：
1. 事件影响一个明确区域、道路、城镇、关隘、码头、寺院、市场、村落、商路或水路。
2. 事件不是小插曲，不是路人噪音，不是单人偶发事故。
3. 事件必须产生可传播的风声。
4. 事件必须造成至少一种外溢影响：经济变化、势力行动、治安变化、事件链变化、声誉变化、黑盒变化或新的影响链。
5. 事件与{{user}}当前行为没有直接因果，不得写成已有仇敌、已有势力、已有事件链的阴谋结果。
6. 事件发生地点由你根据当前世界状态选择，但必须合理，不得凭空毁灭核心舞台，不得无故摧毁{{user}}核心资产。
7. 如果事件未发生在{{user}}所在区域，不得强行打断{{user}}当前行动，只作为后台世界变化、远方消息或风声传播。
8. 如果事件发生在{{user}}所在区域，可以形成当前场景压力，但仍不得替{{user}}做选择。
9. 禁止生成马车受惊、偷情被抓、路人吵架、小偷行窃、醉汉闹事、普通邻里纠纷等低价值事件。
10. 禁止把"区域突发事件"写成某个已有势力早已策划的阴谋；除非已有状态中存在明确因果证据。
你必须返回以下 JSON 字段：
{
  "regionalIncident": {
    "active": true,
    "title": "事件标题",
    "type": "${picked.type}",
    "scope": "影响范围",
    "impact": "一句话概括区域后果"
  },
  "winds": [
    {
      "topic": "稳定主题名",
      "type": "report",
      "level": 1-4,
      "content": "正在传播的说法",
      "scope": "传播范围",
      "source": "消息来源链"
    }
  ],
  "influenceChain": [
    {
      "trigger": "区域突发事件标题",
      "impact": "已经造成的直接影响",
      "fallout": "后续余波"
    }
  ]
}
如果事件已经足以形成持续冲突或治理任务，可以额外返回 events。
如果事件影响市场、道路、水路、粮价、盐价、货运，可以额外返回 economy。
如果事件影响某个势力判断或资源，可以额外返回 factions。
如果事件影响{{user}}名声，可以额外返回 reputation。
如果事件有隐秘目击者、暗藏证据、失踪人物、未公开真相，可以额外返回 blackbox。
`;
  }

  function rollRegionalIncident(state, randomFn = Math.random) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // 冷却中
    if ((incident.cooldown || 0) > 0) {
      incident.cooldown = Math.max(0, incident.cooldown - 1);
      incident.active = false;
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const dice = randomFn();
    const chance = REGIONAL_INCIDENT_CONFIG.chance;

    // 确定是否需要触发
    let triggerNow = false;
    let triggerType = incident._retryType || '';
    let triggerLabel = '';

    if (incident._retry && triggerType) {
      // 上轮骰子成功但API未返回 → 重试，类型不变
      triggerNow = true;
      incident._retry = false;
      incident._retryType = '';
      const found = REGIONAL_INCIDENT_CONFIG.typeWeights.find(t => t.type === triggerType);
      if (found) triggerLabel = found.label;
    }

    if (!triggerNow && dice >= chance) {
      // 未触发
      incident.active = false;
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };
    }

    // 触发
    let picked;
    if (!triggerNow) {
      picked = weightedPick(REGIONAL_INCIDENT_CONFIG.typeWeights, randomFn);
      triggerType = picked.type;
      triggerLabel = picked.label;
    }

    incident.active = true;
    incident.type = triggerType;
    if (picked) {
      incident.cooldown = REGIONAL_INCIDENT_CONFIG.cooldownRounds;
    }

    return {
      triggered: true,
      incidentType: triggerType,
      incidentLabel: triggerLabel,
      injectPrompt: buildRegionalIncidentPrompt({ type: triggerType, label: triggerLabel || triggerType }),
      chance,
      dice,
      reason: incident._retry ? 'retry' : 'hit'
    };
  }

  function mergeRegionalIncident(state, update) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // 本轮没有本地骰子触发，不接受 API 自发生成
    if (!incident.active) {
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      incident._retry = false;
      incident._retryType = '';
      return;
    }

    // 本地骰子触发了，检查 API 是否返回了 regionalIncident
    if (update.regionalIncident && update.regionalIncident.active) {
      state.regionalIncident = {
        active: true,
        title: update.regionalIncident.title || '未命名区域突发事件',
        type: update.regionalIncident.type || incident.type || 'other',
        scope: update.regionalIncident.scope || '未知区域',
        impact: update.regionalIncident.impact || '区域秩序受到冲击。',
        cooldown: REGIONAL_INCIDENT_CONFIG.cooldownRounds,
        _retry: false,
        _retryType: ''
      };
    } else {
      // API 没返回 → 设置重试标记，下轮继续
      incident._retry = true;
      if (incident.type) {
        incident._retryType = incident.type;
      }
      // 不清空 active/type，让下轮 mergeRegionalIncident 能检测到重试
      state.regionalIncident = {
        active: false,
        title: '区域突发事件生成失败（将在下一轮重试）',
        type: incident.type || 'other',
        scope: '未知区域',
        impact: '本地骰子触发区域突发事件，但 API 未返回 regionalIncident。下一轮将重试同类型。',
        cooldown: 0,
        _retry: true,
        _retryType: incident.type || ''
      };
    }
  }

  // ========== 事件链骰子推进（双类型四阶段系统）==========
  // 每个阶段 9 格，满 9 晋级下一阶段。
  // conflict: 萌芽→发酵→逼近→已爆发；API 可判定已消散；level 越高越容易推进。
  // progress: 筹备→执行→关键→已完成；API 可判定已失败；level 越高越难推进。
  // 停滞完全交给 API 控制，本地骰子不再跳过轮次
  function forceTriggerEvents(state) {
    const events = state.events || [];
    let anyTriggered = false;

    for (const ev of events) {
      // 清除上轮结果
      delete ev.evolveResult;

      // 初始化字段
      if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
      if (ev.stageRound === undefined) ev.stageRound = 1;
      if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
      const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
      const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;

      // 终局事件跳过
      if (terminalStages.includes(ev.stage)) continue;
      if (!ev.stage || !stageOrder.includes(ev.stage)) ev.stage = stageOrder[0];

      // 保底：连续非成功达到上限则强制成功
      const maxFails = getMaxFails(ev);
      if (ev.consecutiveFails >= maxFails) {
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = '成功';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
        continue;
      }

      // 正常掷骰
      const r = Math.min(1, (ev.stageRound || 1) / 9);
      const stageBase = (EVENT_STAGE_BASE[ev.type] || EVENT_STAGE_BASE.conflict)[ev.stage] || 85;
      const level = ev.level || 1;
      const levelAdjust = ev.type === 'progress' ? (level - 1) * 10 : -((level - 1) * 10);
      const threshold = Math.round(stageBase - 200 * r * (1 - r) + levelAdjust);
      const dice = Math.floor(Math.random() * 100) + 1;

      if (dice > threshold) {
        // 成功：推进
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = '成功';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
      } else if (dice < threshold * 0.4) {
        // 受挫：倒退
        ev.stageRound = Math.max(1, ev.stageRound - 1);
        ev.consecutiveFails++;
        ev.evolveResult = '受挫';
      } else {
        // 保持：不动
        ev.consecutiveFails++;
        ev.evolveResult = '保持';
      }
    }

    if (anyTriggered) return anyTriggered;
  }

  function getMaxFails(ev) {
    const level = ev.level || 1;
    return ev.type === 'progress' ? 2 + level : 6 - level;
  }

  function advanceStageRound(ev) {
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const finalStage = EVENT_FINAL_STAGE[ev.type] || EVENT_FINAL_STAGE.conflict;
    ev.stageRound++;
    if (ev.stageRound >= 9) {
      // 晋级下一阶段
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = 1;
      } else {
        ev.stage = finalStage;
        ev.stageRound = 9;
      }
    }
  }

  function logEruption(state, ev) {
    console.log(`[世界引擎] 事件爆发: ${ev.name}`);
  }

  // ========== 风声消散骰 ==========
  // API 本轮返回同 topic 风声时，core.addWind 会将 quietRounds 重置为 0。
  // 未被更新的风声在下轮 API 调用前累积沉寂，并可能直接消散。
  function decayWinds(state, randomFn = Math.random) {
    const survivors = [];
    const decayed = [];

    for (const wind of state.winds || []) {
      const params = WIND_DECAY[wind.type] || WIND_DECAY.rumor;
      const level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0) + 1;

      if (wind.quietRounds <= params.grace) {
        survivors.push(wind);
        continue;
      }

      const n = wind.quietRounds - params.grace - 1;
      const chance = Math.min(95, Math.max(5,
        params.base + params.linear * n + params.quadratic * n * n - (level - 1) * 10
      ));
      const dice = Math.floor(randomFn() * 100) + 1;

      if (dice <= chance) decayed.push(wind);
      else survivors.push(wind);
    }

    state.winds = survivors;
    if (decayed.length) {
      console.log(`[世界引擎] 🌫️ 风声消散: ${decayed.map(w => w.topic).join('、')}`);
    }
    return decayed;
  }

  const OUTPUT_INSTRUCTIONS = `
## JSON 输出字段说明

你必须输出一个 JSON 对象。只输出本轮有实质变化的字段；禁止为了凑数制造无意义内容。

### events（事件链数组）
每项包含：
- name: 事件名称（已有事件同名则覆盖更新，新名称则新增）
- type: "conflict"/"progress"。conflict=冲突型事件链，progress=推进型事件链。新事件必须填写；已有事件的 type 一旦确定禁止改动，更新同名事件时必须沿用当前 type。
- level: 1-4。conflict 表示冲突烈度/失控势能，Lv 越高越容易升级；progress 表示事项规模/完成难度，Lv 越高越难完成。
- stage: 按 type 使用不同阶段：
  - conflict 只能使用 "萌芽"/"发酵"/"逼近"/"已爆发"/"已消散"。
    - 萌芽：冲突刚出现苗头，只有少数人察觉，尚未形成公开压力。
    - 发酵：矛盾开始扩散、组织、人手、传闻或报复动机正在聚集。
    - 逼近：冲突即将落到具体行动或直接影响，已经接近爆发点。
    - 已爆发：冲突结果落地，追杀、通缉、械斗、封锁、清算等已经发生。
    - 已消散：冲突失去动机、执行者、资源、目标或时效，已经确定不会继续爆发。
    - 正常推进顺序固定为：萌芽 → 发酵 → 逼近 → 已爆发；已消散不是正常推进阶段，只能由 API 根据明确因果直接判定。
  - progress 只能使用 "筹备"/"执行"/"关键"/"已完成"/"已失败"。
    - 筹备：资源、人手、材料、情报、路线或计划正在准备，尚未全面展开。
    - 执行：事项已经实际开始，有持续投入、行动痕迹和阶段性消耗。
    - 关键：接近结果，最容易被干扰、截胡、反转、延期或付出代价。
    - 已完成：成果落地并进入世界状态，可能生成后续事件、风声、经济或势力变化。
    - 已失败：事项因执行者退出、资源耗尽、关键条件永久丧失、被有效反制或时效过期而确定无法完成。
    - 正常推进顺序固定为：筹备 → 执行 → 关键 → 已完成；已失败不是正常推进阶段，只能由 API 根据明确因果直接判定。
- stageRound: 当前阶段内进度 1-8。非终局阶段写 9 会被本地自动晋级；所有终局阶段会被本地锁定为 9/9。
- desc: 事件描述
- stall: true/false（true 表示事件暂时停滞/受阻，但未来仍可能恢复；仅作标记，不改变 type 或 stage；停滞原因和恢复条件写入 desc）

### 事件链停滞与终局判定
- 停滞不是终局。只要仍存在合理恢复条件，就设置 stall=true，并保持当前 stage。
- conflict 只有在冲突已确定失去继续爆发的可能时，才可直接将 stage 标记为 "已消散"。
- progress 只有在事项已确定无法继续或无法达成目标时，才可直接将 stage 标记为 "已失败"。
- 标记 "已消散"/"已失败" 时，desc 必须写明导致终局的具体原因；不得仅因为连续多轮没有进展而判定终局。
- "已爆发"/"已消散"/"已完成"/"已失败" 均为终局，进入后不得恢复为非终局阶段。如需重启，应创建新的事件链。

### factions（势力数组）
每项包含：
- name: 势力名称（同名覆盖，新名新增）
- scope: 势力直接控制或具有重大影响力的地理范围
- status: 整体运势——"鼎盛"/"稳固"/"倾轧"/"困顿"/"衰落"/"瓦解"。
  鼎盛=有钱有人有势，铁板一块；稳固=正常运行无重大危机；倾轧=内部派系斗争，架子还没散；困顿=资源枯竭或被封锁，咬牙硬撑；衰落=失去支柱/地盘/核心人物，滑向瓦解；瓦解=名存实亡，仅待终局确认。
- relation: 该势力对{{user}}的态度，七级（以"中立"为正中，只能取这七个值）——"血盟"/"盟友"/"友好"/"中立"/"冷淡"/"敌对"/"世仇"。
  血盟=绝对信任，生死与共；盟友=地位平等，互相支援；友好=认同{{user}}，优先合作；中立=不关心不排斥；冷淡=已注意到但不打算采取行动；敌对=公开对抗；世仇=不死不休。
- currentGoal: 当前目标文字
- core_person: 核心人物姓名
- powerPillars: 该势力当前拥有的权力支柱，最多3个，每个为1-4字的名称字符串（如"武力威慑"/"官场人脉"/"财政支持"）。只有稳固且有实际力量的支柱才列入；已经崩溃或失效的支柱不得保留。此字段仅表示当前的支柱，不包含历史。API 必须在 desc 或 influenceChain 中说明支柱变化。

### worldTrends（天下大势数组）
天下大势是已经改变国家、国际或整个世界运行方式的长期局势，不是普通风声，也不是等待爆发的事件链。
每项包含：
- name: 大势名称（同名覆盖更新，新名新增）
- scope: 实际影响范围
- status: "持续中"/"已结束"
- description: 当前局势及其正在如何约束世界行动
- source: 形成该大势的明确来源

判定规则：
- 每轮检查 Lv4 冲突型事件进入已爆发、Lv4 推进型事件进入已完成、Lv4 风声背后事实被广泛确认等候选来源。
- 只有局势长期、广域、跨系统，并迫使多个势力持续调整行动时，才创建天下大势。全国节庆、单次公告、短期轰动不算。
- 天下大势不参与骰子、不自动消散。持续中的大势每轮都必须作为事件链、势力、经济与风声推演的背景约束。
- 只有出现明确改变局势的事实时才能更新；只有局势确定结束时才标记为已结束。
- 大势产生的新行动、风声或经济变化应写入对应字段；跨系统传导写入 influenceChain。

### winds（风声数组）
每项包含：
- topic: 稳定主题名。更新同一条风声时必须沿用已有 topic；同 topic 覆盖更新，新 topic 新增。
- type: "announcement"/"report"/"rumor"/"sentiment"，分别表示公告、消息、流言、舆情。
- level: 1-4，表示实际传播规模：1=圈内少数人，2=地方，3=大区，4=国家/国际/天下。
- content: 当前正在传播的具体说法；传播变质时更新此字段。
- scope: 当前实际传播到的具体地区或圈层。
- source: 来源与传播链。与{{user}}相关时必须写出完整信息链。

### 风声联动要求
- 每轮检查已有 winds，但只有出现合法传播节点时才能扩大 level 或 scope；不得自动升级。
- 风声只有传播到相关对象所在范围或圈层后，才允许改变 factions、reputation、economy、enemies 或 events。
- 风声导致跨系统变化时，必须同步写入 influenceChain，明确“哪条风声 → 谁获知 → 采取何种行动/形成何种判断”。
- 公告只证明发布者公开说过这件事，不保证内容为真；流言也可能恰好为真。不要使用可信度字段。
- 私信、密令等仅有明确接收者的信息不属于风声；泄露并开始传播后才创建风声。
- 没有产生实际外溢影响的风声可以只更新 winds，不得硬造其他系统变化。
- 风声若连续多轮没有任何实质更新，会由本地系统判定消散并在下轮推演前删除。若一条风声本轮仍在传播、变质、扩大范围或持续影响世界，必须返回相同 topic 的更新；仅原样复述而没有实际变化不算更新。
- quietRounds 是本地内部字段，禁止输出或修改。

### economy（经济对象）
- climate: 经济气候 — 当前区域经济温度："繁荣"/"平稳"/"衰退"/"动荡"
- signals: 市场信号数组。每项 { summary: "一句话描述变化和影响", scope: "影响的地理范围（具体区域名）" }。记录当前市场上值得注意的经济变化——该变化必须足以影响势力行动、NPC决策或事件链走向。日常琐碎波动不配进入。一般不超过3条。

### reputation（声誉对象）
四维声誉，每维五级（从低到高，只能取这五个值）：天怒人怨→声名狼藉→默默无闻→受人尊敬→万众敬仰
- authority: 朝堂之上 — 掌权建制力量对{{user}}的评价。守法/逆法、顺从/挑衅。
- common: 市井之间 — 普通百姓/街头舆论对{{user}}的口碑。仁善/暴戾、保护者/威胁者。
- shadow: 草莽之中 — 体制外力量（绿林/走私/佣兵/黑客/地下帮派等）对{{user}}的看法。核心标准：有种还是没种。以私力对抗体制不公、替弱者出头→加分；欺压平民、出卖同道、恃强凌弱→减分。单纯的刑事犯罪不自动获得草莽尊重。
- circuit: 同道之间 — {{user}}所在行当/职业圈内的同行评价。技艺高低、是否守行规、对行业有无贡献。
- lastChange: 本轮变化简述（如"无变化"或"朝堂评价因协助缉拿上升"）

### world_digest（字符串）
本轮后台世界推演叙事，150-200字。描述本轮世界后台发生了什么（天下大势约束、NPC独立行动、团体内部变化、风声传播等），禁止提及{{user}}。

### enemies（仇敌录数组）
仇敌是因具体伤害行为而与{{user}}产生不可逆个人恩怨的角色或群体。不同于势力层面的态度对立（那是 factions.relation 的职责），仇敌的核心特征是：永不淡化、追着{{user}}跑。

每项包含：
- name: 仇敌名称（个人姓名或复仇团体名）
- reason: 结仇原因（简述{{user}}做了什么导致结仇）
- type: "blood"/"grudge"。blood=血仇（核心人物被杀、至亲身亡/致残）；grudge=非致死恩怨（被废、破产、被夺走重要之物等造成不可逆伤害）
- status: "追踪中"/"策划中"/"执行中"/"已终结"
  - 追踪中：正在收集情报、确定{{user}}位置
  - 策划中：已定位{{user}}，正在组织人手/资源准备行动
  - 执行中：已派出追杀/报复力量，实际攻击已发生或即将发生
  - 已终结：仇敌被{{user}}消灭或复仇已完成。标记后本地保留20轮再清除。

判定规则：
- type=blood 的触发条件：核心人物被杀（排除已失去权力的前核心人物，见势力模块的权力瓦解）；至亲身亡/致残。此种仇恨不可谈判、永不淡化、不因时间推移而放弃。
- type=grudge 的触发条件：{{user}}的行为对特定角色造成了不可逆的重大伤害（被废去武功、被夺走毕生基业、被设局导致破产/流放），且受害者有明确的复仇动机和能力。不是每个被{{user}}得罪的人都算grudge——必须满足"不可逆伤害+明确复仇意愿+有追踪/报复能力"三个条件。
- 无论blood还是grudge，一旦标记为"已终结"，本地会再保留20轮备忘，之后自动清除。

与事件链联动：
- 创建仇敌条目时，通常应同步创建一条冲突型事件链（type=conflict），name与仇敌name对应，并在influenceChain中记录两者的关联。
- 仇敌条目status变化时，对应事件链的stage应同步更新。

与权力瓦解互斥：
- 若某核心人物所有权力支柱已被摧毁（见势力模块的权力瓦解），其失去权力及核心人物地位。此时若被{{user}}杀死，不触发type=blood，仅按type=grudge处理。

禁止事项：
- 血仇提供动机，不提供能力。追杀受势力等级约束，弱势力无法渗透强势力地盘。
- 不得仅因"被{{user}}辱骂"或"商业竞争失败"等可逆伤害创建仇敌条目。
- 不得将势力层面的态度对立（factions.relation）重复录入仇敌录。

### influenceChain（影响链数组）
用于记录重要变化在世界中的传播过程，说明什么触发了变化、直接改变了什么、又产生了什么后续余波。它不是新的事件链，不参与骰子推进，也不表示 stage 进度。
每项包含：
- trigger: 触发源。引发变化的具体事件、行动、天下大势、风声、经济变化、声誉变化或黑盒信息
- impact: 直接影响。触发源已经真实改变了什么世界状态
- fallout: 后续余波。影响继续扩散产生的次生变化或下一步趋势

要求：
- 只记录真实产生外溢影响的变化，不要把每条事件链的普通进度都塞进 influenceChain。
- impact 必须是已经发生的直接变化；fallout 必须是进一步扩散的余波，不得重复改写 trigger。
- 如果事件链 A 导致事件链 B 加速、延缓、转向、消散或失败，必须在 influenceChain 中说明传导过程。
- 如果影响依赖信息传播，必须符合信息传播规则；NPC不能因为 influenceChain 存在就获得上帝视角。
- 同一 trigger 已有记录时更新该记录，不要无限堆叠重复记录。

### blackbox（信息黑盒对象）
- secretActions: 隐秘行为数组，每项 { action: "行为描述", witnesses: "无/仅XX" }
- secretAssets: 隐秘资产数组，每项 { name: "资产名称", exposure: 0-100, status: "有效/过期/暴露/失效" }
  exposure 表示该资产被外界发现的风险程度：0=绝密，100=已完全公开。
  status 表示该资产当前是否仍然可用：有效=仍可调用，过期=情报过时，暴露=已被发现，失效=已不可用。
`;

  const JSON_EXAMPLE = `{
  "events": [
    { "name": "血刀门复仇", "type": "conflict", "level": 2, "stage": "发酵", "stageRound": 5, "desc": "血刀门派出了追踪者，追踪者在青石关外三里亭设了暗哨" },
    { "name": "青炉司改良火药", "type": "progress", "level": 3, "stage": "执行", "stageRound": 4, "desc": "青炉司已收齐硝石与密炭，正在试小炉，尚未进入定型关口" }
  ],
  "factions": [
    { "name": "血刀门", "scope": "血刀岭及周边三镇", "status": "稳固", "relation": "敌对", "currentGoal": "复仇", "core_person": "血刀老祖", "powerPillars": ["武力威慑","情报网"] }
  ],
  "worldTrends": [
    { "name": "北境战争", "scope": "北境三州及周边诸国", "status": "持续中", "description": "边军与北境诸部进入长期战争，征粮、征兵与商路封锁持续改变各方行动", "source": "Lv4冲突型事件「北境战争」进入已爆发" }
  ],
  "winds": [
    { "topic": "青石关设卡", "type": "report", "level": 2, "content": "青石关北门已有官兵设卡盘查", "scope": "青石关及周边村镇", "source": "目击商贩→往来商队" }
  ],
  "economy": { "climate": "平稳", "signals": [] },
  "reputation": { "authority": "默默无闻", "common": "默默无闻", "shadow": "默默无闻", "circuit": "默默无闻", "lastChange": "无变化" },
  "world_digest": "血刀门追踪者在青石关外三里亭设了暗哨；天机阁阁主上官云密信召回了三名外围密探；醉仙楼后厨因粮商涨价换了供货渠道。",
  "enemies": [
    { "name": "血刀门", "reason": "{{user}}杀了血刀门少主", "type": "blood", "status": "执行中" }
  ],
  "influenceChain": [
    { "trigger": "血刀门发布悬赏令", "impact": "草莽中人开始主动留意{{user}}的行踪", "fallout": "客栈与渡口出现试探和秘密报信者" }
  ],
  "blackbox": { "secretActions": [], "secretAssets": [] }
}`;

  async function callEvolutionAPI(state, userMsg, aiMsg, extraInstruction = '') {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const fullRules = rulesLoader ? rulesLoader.getAllRulesText() : '【规则加载失败】';
    const worldbookSection = await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.() || '';

    const prompt = `你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。
请根据世界规则和本轮对话，更新世界状态。只输出 JSON，不要有其他文字。

推演时按以下因果顺序检查：
1. 【私密判定·最先执行】先判定本轮 {{user}} 及相关人物的行为有无目击者、是否留下可追溯痕迹。凡在无目击、未留痕迹的情况下发生的私密行为（独处、私密情爱、闺房之事、密室密谈、隐秘潜入、无人时的杀伐等），一律计入 blackbox.secretActions（witnesses 标"无"或"仅XX"），并且：不得据此生成风声、不得改变任何维度声誉、不得形成或推进事件链、不得让任何不在场 NPC 据此行动。只有当该行为被目击、留下可追溯痕迹、或事后确实被传播后，才可转为公开影响。
2. 将所有持续中的天下大势作为本轮世界级约束，并检查是否形成新大势或已有大势明确结束。
3. 判断本轮事实、行动与公开信息是否形成新风声（私密行为除外，见第1步）。
4. 检查已有风声是否获得新的合法传播节点，并据此更新 level/scope/content/source。
5. 判断风声实际覆盖了哪些势力、圈层或行动者；只有被覆盖者才能据此改变判断与行动。
6. 天下大势或风声造成跨系统变化时，在对应状态字段中落实结果，并用 influenceChain 记录传导过程。
7. 声誉判定：只有当 {{user}} 的行为已形成覆盖对应圈层的风声后，才改动对应维度声誉；私密、未传播或仅单人目击的行为不改变群体声誉。
8. 仇敌判定：判断本轮是否产生触发血仇/恩怨的不可逆伤害；已有仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能推进追踪，且受势力等级约束，不得凭空定位 {{user}}。
9. 经济判定：只有事件链或可追溯的外部原因驱动时才更新 climate 与 signals；重大经济变化须生成对应风声，禁止凭空波动。
10. 不得从面板全知信息直接跳到 NPC 行动，不得为了产生联动而虚构传播节点。

========== 世界推演规则 ==========
${fullRules}

${worldbookSection}

## 当前世界状态（第${state.round}轮）
${JSON.stringify({
  round: state.round,
  events: (state.events || []).map(e => ({ name: e.name, type: e.type || 'conflict', stage: e.stage, stageRound: e.stageRound, level: e.level, desc: e.desc, evolveResult: e.evolveResult, stall: e.stall })),
  factions: (state.factions || []).map(f => ({ name: f.name, scope: f.scope, status: f.status, relation: f.relation, currentGoal: f.currentGoal, core_person: f.core_person, powerPillars: f.powerPillars })),
  worldTrends: state.worldTrends || [],
  winds: (state.winds || []).map(({ quietRounds, ...wind }) => wind),
  reputation: state.reputation,
  economy: state.economy,
  enemies: state.enemies || [],
  influenceChain: state.influenceChain || [],
  blackbox: state.blackbox || { secretActions: [], secretAssets: [] }
}, null, 2)}

## 本轮对话
用户：${userMsg || ''}
AI：${aiMsg || ''}

${OUTPUT_INSTRUCTIONS}
${JSON_EXAMPLE}
${extraInstruction ? '\n' + extraInstruction : ''}`;

    const rawResult = await api.callApi(prompt, 8000, 0.7, _abortController.signal);
    _lastPrompt = prompt;
    _lastRawResult = rawResult;
    const update = api.parseJSON(rawResult);
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error('API 返回无法解析为有效 JSON，已保留重 roll 前的当前状态');
    }
    const knownFields = [
      'events', 'factions', 'worldTrends', 'winds', 'economy', 'reputation',
      'world_digest', 'enemies', 'influenceChain', 'regionalIncident', 'blackbox'
    ];
    if (!knownFields.some(field => Object.prototype.hasOwnProperty.call(update, field))) {
      throw new Error('API 返回不包含任何世界状态字段，已保留重 roll 前的当前状态');
    }
    console.log('[世界引擎] API JSON 解析成功，世界摘要:', update.world_digest || '[未返回]');

    update.events = update.events || [];
    update.factions = update.factions || [];
    update.worldTrends = update.worldTrends || [];
    update.winds = update.winds || [];
    update.economy = update.economy || {};
    if (!update.economy.signals) update.economy.signals = [];
    update.reputation = update.reputation || {};
    update.world_digest = update.world_digest || state.worldDigest;
    update.enemies = update.enemies || [];
    update.influenceChain = Array.isArray(update.influenceChain) ? update.influenceChain : [];
    // regionalIncident 由本地骰子控制，不在 callEvolutionAPI 中自动补全
    // API 返回的 regionalIncident 在 mergeRegionalIncident 中验证
    if (!update.blackbox) update.blackbox = { secretActions: [], secretAssets: [] };

    return update;
  }

  let _abortController = null;
  let _isRunning = false;

  async function evolve(state, userMsg, aiMsg) {
    if (_isRunning) {
      console.warn('[世界引擎] ⚠️ 已有推演正在进行，跳过重复请求');
      return false;
    }

    delete state._terminalEventsThisRound;
    const backup = JSON.parse(JSON.stringify(state));
    const isNew = core.isNewRound();

    if (isNew) {
      console.log('[世界引擎] 📌 新轮次');
    } else {
      // 重roll/手动 → 从存档点 a 恢复
      const cp = core.restoreCheckpoint();
      if (cp) {
        Object.assign(state, cp);
        state.memories = cp.memories || [];
        state.events = cp.events || [];
        state.factions = cp.factions || [];
        state.worldTrends = cp.worldTrends || [];
        state.winds = cp.winds || [];
        state.enemies = cp.enemies || [];
        state.influenceChain = cp.influenceChain || [];
        console.log('[世界引擎] 🔄 检测到重roll，从存档点恢复');
      }
    }

    _isRunning = true;
    _abortController = new AbortController();

    try {
      // 第1步：本地骰子推进事件链（全部在 b 上操作）
      forceTriggerEvents(state);

      // 第2步：风声沉寂累积与消散判定
      decayWinds(state);

      // 第3步：区域突发事件骰子
      const regionalIncidentRoll = rollRegionalIncident(state);

      // 第4步：喂给 API 做叙事更新
      const update = await callEvolutionAPI(state, userMsg, aiMsg, regionalIncidentRoll.injectPrompt);

      // 第5步：合并 API 返回
      for (const ev of update.events) {
        const existing = state.events.find(e => e.name === ev.name);
        if (existing) {
          // 事件类型一旦确定不可由 API 改动
          ev.type = existing.type || 'conflict';

          const stageOrder = EVENT_STAGE_ORDER[existing.type] || EVENT_STAGE_ORDER.conflict;
          const finalStage = EVENT_FINAL_STAGE[existing.type] || EVENT_FINAL_STAGE.conflict;
          const terminalStages = EVENT_TERMINAL_STAGES[existing.type] || EVENT_TERMINAL_STAGES.conflict;

          // 终局事件保护：只允许 API 改 desc
          if (terminalStages.includes(existing.stage)) {
            if (ev.desc !== undefined) existing.desc = ev.desc;
            core.ensureEventFields(existing);
            continue;
          }

          // API 改了 stageRound？以 API 为准，但 >=9 时自动晋级
          if (ev.stageRound !== undefined && ev.stageRound !== existing.stageRound) {
            existing.stageRound = ev.stageRound;
            existing.consecutiveFails = 0;
            // stageRound >= 9 触发晋级
            if (existing.stageRound >= 9) {
              const idx = stageOrder.indexOf(existing.stage);
              if (idx !== -1 && idx < stageOrder.length - 1) {
                existing.stage = stageOrder[idx + 1];
                existing.stageRound = existing.stageRound - 9;
              } else {
                existing.stage = finalStage;
                existing.stageRound = 9;
              }
            }
          }
          // 合并其他字段
          if (ev.stage !== undefined) existing.stage = ev.stage;
          if (ev.desc !== undefined) existing.desc = ev.desc;
          if (ev.level !== undefined) existing.level = ev.level;
          if (ev.name !== undefined) existing.name = ev.name;
          if (ev.stall !== undefined) existing.stall = ev.stall;
          existing.type = ev.type;
          core.ensureEventFields(existing);
        } else {
          if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
          core.addEvent(state, ev);
        }
      }
      for (const fac of update.factions) core.addFaction(state, fac);
      for (const trend of update.worldTrends) core.addWorldTrend(state, trend);
      for (const wind of update.winds) core.addWind(state, wind);
      if (Object.keys(update.economy).length) Object.assign(state.economy, update.economy);
      if (Object.keys(update.reputation).length) Object.assign(state.reputation, update.reputation);
      if (update.world_digest) state.worldDigest = update.world_digest;

      // 仇敌录
      if (update.enemies.length) {
        for (const en of update.enemies) {
          if (!en.name || !en.reason) continue;
          if (!en.type || !['blood', 'grudge'].includes(en.type)) en.type = 'blood';
          if (!en.status|| !['追踪中','策划中','执行中','已终结'].includes(en.status)) en.status = '追踪中';
          const idx = (state.enemies || []).findIndex(ex => ex.name === en.name);
          if (idx !== -1) state.enemies[idx] = { ...state.enemies[idx], ...en };
          else state.enemies.unshift(en);
        }
        // 已终结的仇敌保留20轮后清理
        state.enemies = (state.enemies || []).filter(en => {
          if (en.status === '已终结') {
            en._terminalSince = en._terminalSince || state.round;
            return (state.round - en._terminalSince) < 20;
          }
          return true;
        });
        if (state.enemies.length > 8) state.enemies.length = 8;
      }

      // 影响链
      if (update.influenceChain.length) {
        for (const influence of update.influenceChain) {
          if (!influence.trigger || !influence.impact) continue;
          influence.fallout = influence.fallout || '';
          const idx = (state.influenceChain || []).findIndex(existing => existing.trigger === influence.trigger);
          if (idx !== -1) state.influenceChain[idx] = influence;
          else state.influenceChain.unshift(influence);
        }
        if (state.influenceChain.length > 12) state.influenceChain.length = 12;
      }

      // economy signals 上限
      if (state.economy && state.economy.signals && state.economy.signals.length > 8) {
        state.economy.signals.length = 8;
      }

      // 区域突发事件合并
      mergeRegionalIncident(state, update);

      if (update.blackbox) {
        state.blackbox = update.blackbox;
        const totalBlackbox = (state.blackbox.secretActions?.length || 0) + (state.blackbox.secretAssets?.length || 0);
        if (totalBlackbox > 12) {
          const excess = totalBlackbox - 12;
          const actions = state.blackbox.secretActions || [];
          const assets = state.blackbox.secretAssets || [];
          if (actions.length > excess) {
            state.blackbox.secretActions.length = Math.max(1, actions.length - excess);
          } else {
            state.blackbox.secretActions = [];
            state.blackbox.secretAssets.length = Math.max(1, assets.length - excess + actions.length);
          }
        }
      }

      // 自动清理：已消散/已失败的事件链 & 已结束的天下大势
      // - 负面终局（已消散/已失败）：下一轮即删
      // - 正面终局（已爆发/已完成）：进入终局起保留 2+level*2 轮（Lv1=4/Lv2=6/Lv3=8/Lv4=10），
      //   留出余波铺陈时间，到期自动清退
      const POSITIVE_TERMINALS = ['已爆发', '已完成'];
      const cleanedEvents = (state.events || []).filter(e => {
        if (e.stage === '已消散' || e.stage === '已失败') return false;
        if (POSITIVE_TERMINALS.includes(e.stage)) {
          if (e._terminalSince === undefined) e._terminalSince = state.round;
          const keepRounds = 2 + (e.level || 1) * 2;
          return (state.round - e._terminalSince) < keepRounds;
        }
        // 非终局：清掉可能残留的倒计时标记（被 API 改回非终局阶段时）
        if (e._terminalSince !== undefined) delete e._terminalSince;
        return true;
      });
      if (cleanedEvents.length !== (state.events || []).length) {
        const removed = (state.events || []).filter(e => !cleanedEvents.includes(e));
        state._terminalEventsThisRound = removed.map(e => JSON.parse(JSON.stringify(e)));
        console.log('[世界引擎] 🧹 自动清理事件链:', removed.map(e => e.name).join('、'));
      }
      state.events = cleanedEvents;

      const cleanedTrends = (state.worldTrends || []).filter(t => t.status !== '已结束');
      if (cleanedTrends.length !== (state.worldTrends || []).length) {
        const removed = (state.worldTrends || []).filter(t => !cleanedTrends.includes(t));
        console.log('[世界引擎] 🧹 自动清理天下大势:', removed.map(t => t.name).join('、'));
      }
      state.worldTrends = cleanedTrends;

      state.round++;
      state.lastEvolveResult = update;

      // 推演成功 → 存档点推进（backup 即推演前状态）
      if (isNew) {
        core.saveCheckpoint(backup);
        core.saveFingerprint(core.getChatFingerprint());
        console.log('[世界引擎] ✅ 推演完成，新轮次第', state.round, '轮，存档点已推进');
      } else {
        console.log('[世界引擎] ✅ 推演完成（重roll），轮次不变');
      }
      core.saveStateWithLayer(state);
      _abortController = null;
      _isRunning = false;
      return true;

    } catch(e) {
      if (e.name === 'AbortError') {
        console.log('[世界引擎] 🛑 推演已中止');
      } else {
        console.error('[世界引擎] 推演失败', e);
      }
      Object.assign(state, backup);
      core.saveState(state);
      _abortController = null;
      _isRunning = false;
      return false;
    }
  }

  function abort() {
    if (_abortController) {
      _abortController.abort();
      console.log('[世界引擎] 🛑 发出中止信号');
    }
  }

  function isRunning() {
    return _isRunning;
  }

  window.WORLD_ENGINE_DEBUG = {
    evolve,
    callEvolutionAPI,
    forceTriggerEvents,
    decayWinds,
    state: () => core.loadState()
  };

  return { evolve, getLastDebug, abort, isRunning };
})();
