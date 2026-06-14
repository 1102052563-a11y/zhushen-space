// world-engine-inject.js — 构建注入上下文（条件筛选，只注入影响RP的关键信息）
window.WORLD_ENGINE_INJECT = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const ledger = window.WORLD_ENGINE_LEDGER;

  // 声誉判词：把等级翻译成给正文模型看的人话，避免注入光秃秃的等级标签
  const REP_DIM_NAME = { authority: '朝堂之上', common: '市井之间', shadow: '草莽之中', circuit: '同道之间' };
  const REP_VERDICT = {
    authority: { // 朝堂之上 —— 守法/顺从 ↔ 挑衅/危险
      天怒人怨: '朝堂视为眼中钉，已被通缉问罪，官面上人人喊打',
      声名狼藉: '在官场名声极坏，被当成麻烦与危险分子，处处提防',
      默默无闻: '朝堂无人识其名，进不了当权者的眼',
      受人尊敬: '官面上颇有声望，被视作可用可信之人',
      万众敬仰: '深得当权者倚重，朝堂之上一言九鼎',
    },
    common: { // 市井之间 —— 仁善/保护 ↔ 暴戾/威胁
      天怒人怨: '百姓恨之入骨，提起就唾骂，避之如蛇蝎',
      声名狼藉: '市井口碑极差，被当成祸害，街坊见了绕道走',
      默默无闻: '街面上没什么人听过他，泯然众人',
      受人尊敬: '百姓念其好，口碑甚佳，当他是仗义之人',
      万众敬仰: '万民拥戴，所到之处百姓夹道，被奉若再生父母',
    },
    shadow: { // 草莽之中 —— 有种/敢扛 ↔ 没种/欺弱
      天怒人怨: '江湖人人喊打，黑市报他名字就有人想动手',
      声名狼藉: '草莽看不起他，当成欺软怕硬的怂货，没人愿与之共事',
      默默无闻: '道上没人认得他，江湖查无此人',
      受人尊敬: '江湖上有几分名头，道上的人敬他三分有种',
      万众敬仰: '草莽奉为豪杰，一句话能调动一方江湖人马',
    },
    circuit: { // 同道之间 —— 技艺/守规/贡献 ↔ 砸招牌/背叛
      天怒人怨: '同行视为行业败类，被逐出圈子，人人喊打',
      声名狼藉: '同道鄙其手艺与人品，背了砸招牌、卖同行的名声',
      默默无闻: '行当里没人知道这号人',
      受人尊敬: '同行敬重其技艺与德行，是行里数得上的人物',
      万众敬仰: '被尊为一代宗师，同道奉其为标杆',
    },
  };
  // 旧存档兼容：六级时期的"小有名气"归入"受人尊敬"
  const REP_LEGACY = { 小有名气: '受人尊敬' };

  // 势力运势判词：把运势词翻译成「这势力眼下什么处境、内部团不团结」
  const STATUS_VERDICT = {
    鼎盛: '钱粮充裕、人手鼎盛，内部上下一心、铁板一块，行事带着不容置疑的底气与排场',
    稳固: '运转如常、根基稳健，无明显内忧外患，按部就班地推进既定事务',
    倾轧: '架子还撑着，内里却派系倾轧、核心不和，许多决策都因内斗而迟滞、自相掣肘',
    困顿: '资源枯竭或被外部封锁，正咬牙硬撑，处处捉襟见肘，经不起再受打击',
    衰落: '已失去关键支柱、地盘或核心人物，人心浮动、节节败退，正一步步滑向瓦解',
    瓦解: '名存实亡、只剩空架子，号令难出、众叛亲离，随时可能彻底散伙',
  };

  // 势力关系判词：把关系词翻译成「这势力对{{user}}的行为倾向」
  const RELATION_VERDICT = {
    血盟: '与{{user}}生死与共、绝对信任，会不惜代价相助，视其安危如自身存亡',
    盟友: '与{{user}}地位平等、互为奥援，在共同利益上主动支援、共享情报，但各有底线',
    友好: '认可{{user}}，愿意优先合作、行个方便、释放善意，尚未到结盟交心的地步',
    中立: '对{{user}}不亲不疏，一切按自身利害行事，无既定立场',
    冷淡: '已注意到{{user}}但兴致缺缺，保持距离、不愿深交，暂无主动行动的打算',
    敌对: '与{{user}}公开对立，会在明处施压、阻挠、为难，乃至寻机正面冲突',
    世仇: '与{{user}}不死不休，必欲除之而后快，会不择手段、持续寻隙下死手',
  };

  // 经济气候判词：把单个气候词翻译成给正文模型看的市面描述
  const CLIMATE_VERDICT = {
    繁荣: '市面繁盛，商路通畅、百业兴旺，钱货流转顺畅，物价稳中偏高',
    平稳: '市面如常，物价随时节自然起落，没有大的波动',
    衰退: '市面萧条，需求萎缩、商号接连倒闭，少数刚需之物反而紧俏涨价',
    动荡: '经济秩序濒临崩坏，物价失控、商路受阻，人心惶惶，以物易物回潮',
  };

  function buildContext(worldState, tags) {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const rulesSummary = rulesLoader ? rulesLoader.getCoreRulesSummary() : '';

    // 重大事件账本
    const ledgerText = ledger.buildLedgerText(worldState);

    // 事件链：Lv3/4 全注入，Lv1/2 仅已爆发/已完成终局注入
    const visibleEvents = (worldState.events || []).filter(e => {
      if (e.level >= 3) return true;
      return e.stage === '已爆发' || e.stage === '已完成';
    });
    const eventsText = visibleEvents.map(e => {
      const typeName = e.type === 'progress' ? '推进型' : '冲突型';
      let txt = `${e.name}(${typeName}, Lv.${e.level}) ${e.stage} ${e.stageRound||1}/9`;
      if (e.evolveResult) txt += ` [${e.evolveResult}]`;
      return txt;
    }).join('；') || '无';

    // 势力：全部7级关系都注入，渲染成自然语句，运势/关系各带判词
    const formatPillars = (arr) => arr.length === 1
      ? arr[0]
      : arr.slice(0, -1).join('、') + '与' + arr[arr.length - 1];
    const allFactions = worldState.factions || [];
    const factionsText = allFactions.length
      ? '\n' + allFactions.map(f => {
          const statusDesc = STATUS_VERDICT[f.status] || (f.status ? `处于「${f.status}」之中` : '处境不明');
          const relation = f.relation || '中立';
          const relationDesc = RELATION_VERDICT[relation] || `对{{user}}的态度为「${relation}」`;
          let s = `- ${f.name}眼下${statusDesc}；它对{{user}}的态度是${relation}——${relationDesc}。`;
          if (f.scope) s += `其势力范围覆盖${f.scope}。`;
          if (f.currentGoal) s += `当前正致力于${f.currentGoal}。`;
          const tail = [];
          if (f.core_person) tail.push(`核心人物是${f.core_person}`);
          if (f.powerPillars?.length) tail.push(`赖以运转的根基是${formatPillars(f.powerPillars)}`);
          if (tail.length) s += tail.join('，') + '。';
          return s;
        }).join('\n')
      : '无';

    // 风声：只注入 Lv3/4
    const windTypeNames = { announcement: '公告', report: '消息', rumor: '流言', sentiment: '舆情' };
    const visibleWinds = (worldState.winds || []).filter(w => (w.level || 0) >= 3);
    const windsText = visibleWinds.map(w =>
      `[${windTypeNames[w.type] || '风声'} Lv.${w.level || 1} ${w.scope || '?'}] ${w.content}`
    ).join('；') || '无';

    // 天下大势
    const trendsText = (worldState.worldTrends || []).filter(t => t.status !== '已结束').map(t =>
      `${t.name}（${t.scope || '天下'}）：${t.description}`
    ).join('；') || '无';

    // 声誉：注入人话判词，而非光秃秃的等级标签
    const rep = worldState.reputation || {};
    const repText = ['authority', 'common', 'shadow', 'circuit'].map(k => {
      const lv = REP_LEGACY[rep[k]] || rep[k];
      const verdict = REP_VERDICT[k] && REP_VERDICT[k][lv];
      if (!verdict) return '';
      return `在${REP_DIM_NAME[k]}${lv}，${verdict}`;
    }).filter(Boolean).join('。') + '。';
    const repChange = rep.lastChange ? `（${rep.lastChange}）` : '';

    // 经济信号：全注入
    const econ = worldState.economy || {};
    const signalsText = (econ.signals || []).map(s => `${s.summary}（${s.scope}）`).join('；');
    const climate = econ.climate || '平稳';
    const climateText = `市面${climate}，${CLIMATE_VERDICT[climate] || CLIMATE_VERDICT['平稳']}`;
    const econText = `${climateText}${signalsText ? '。信号:' + signalsText : ''}`;

    // 仇敌录
    let enemiesText = '无';
    if (worldState.enemies && worldState.enemies.length) {
      enemiesText = worldState.enemies.map(e =>
        `${e.name}（${e.type==='blood'?'血仇':'恩怨'}，${e.status}，原因：${e.reason}）`
      ).join('；');
    }

    // 区域突发事件
    const ri = worldState.regionalIncident || {};
    let riText = '';
    if (ri.active) {
      riText = `⚠️ ${ri.title || '区域突发事件'}（${ri.type || '?'}，${ri.scope || '?'}）— ${ri.impact || ''}`;
    } else {
      riText = ri.title && ri.title.includes('重试') ? `⚠️ ${ri.title}` : '本轮无区域突发事件';
    }

    // 信息黑盒：展示具体内容
    const blackbox = worldState.blackbox || {};
    const boxParts = [];
    if (blackbox.secretActions?.length) {
      const actionsText = blackbox.secretActions.map(a =>
        `[行为] ${a.action || '?'}（目击:${a.witnesses || '无'}）`
      ).join('；');
      boxParts.push(`隐秘行为(${blackbox.secretActions.length}): ${actionsText}`);
    }
    if (blackbox.secretAssets?.length) {
      const assetsText = blackbox.secretAssets.map(a =>
        `[资产] ${a.name || '?'}（暴露:${a.exposure || 0}%，${a.status || '有效'}）`
      ).join('；');
      boxParts.push(`隐秘资产(${blackbox.secretAssets.length}): ${assetsText}`);
    }
    const blackboxText = boxParts.length ? boxParts.join(' | ') : '无暗面信息';

    const context = `
【世界状态】
轮次：${worldState.round}
摘要：${worldState.worldDigest}
天下大势：${trendsText}
事件链：${eventsText}
势力：${factionsText}
风声：${windsText}
仇敌：${enemiesText}
声誉：${repText}${repChange}
经济：${econText}
区域事件：${riText}
黑盒：${blackboxText}

【近期重大事件账本】
${ledgerText}

${rulesSummary}
    `.trim();

    return context.substring(0, 5000);
  }

  return { buildContext };
})();
