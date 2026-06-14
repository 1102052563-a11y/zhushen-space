// world-engine-api.js — 独立 API 调用（支持自定义 OpenAI 兼容 API）
window.WORLD_ENGINE_API = (function() {
  let cachedSettings = null;

  function getSettings(forceRefresh) {
    if (forceRefresh) cachedSettings = null;
    if (cachedSettings) return cachedSettings;
    const defaults = {
      apiUrl: '',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      injectIntoPrompt: true,
      evolveMode: 'auto',
      evolveEveryX: 1
    };
    const raw = window.WORLD_ENGINE_STORE.getItem('world_engine_settings');
    if (raw) {
      try { cachedSettings = { ...defaults, ...JSON.parse(raw) }; return cachedSettings; } catch(e) {}
    }
    cachedSettings = defaults;
    return cachedSettings;
  }

  function normalizeUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    if (u.endsWith('/v1')) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  /**
   * 调用独立 API（非酒馆自带），OpenAI 兼容格式
   */
  async function callApi(prompt, maxTokens, temperature, signal) {
    const settings = getSettings();
    const url = normalizeUrl(settings.apiUrl);
    if (!url) throw new Error('❌ 未配置 API URL，请在设置中填写');

    const body = {
      model: settings.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: temperature ?? settings.temperature ?? 0.7,
      max_tokens: maxTokens ?? settings.maxTokens ?? 2000
    };

    const headers = {
      'Content-Type': 'application/json'
    };
    if (settings.apiKey) {
      headers['Authorization'] = 'Bearer ' + settings.apiKey;
    }

    console.log('[世界引擎] 调用 API:', url, body.model);

    const resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: signal || null
    });

    if (!resp.ok) {
      let detail = '';
      try { const err = await resp.json(); detail = err.error?.message || JSON.stringify(err); } catch(e) {}
      throw new Error(`HTTP ${resp.status}: ${detail}`);
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('API 返回缺少 choices[0]');
    if (choice.finish_reason === 'length') {
      console.warn('[世界引擎] API 输出达到长度上限，将读取截断前已完整返回的字段');
    }
    return choice.message?.content || '';
  }

  function repairTruncatedJSON(content) {
    const rootStart = content.indexOf('{');
    if (rootStart === -1) return null;

    const stack = [];
    const candidates = [];
    let inString = false;
    let escaped = false;

    for (let i = rootStart; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
      } else if (char === ',' && stack.length > 0) {
        candidates.push({
          end: i,
          suffix: stack.slice().reverse().map(open => open === '{' ? '}' : ']').join('')
        });
      }
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = content.slice(rootStart, candidates[i].end) + candidates[i].suffix;
      try {
        return JSON.parse(candidate);
      } catch(e) {}
    }
    return null;
  }

  /**
   * 解析 API 返回的 JSON（容错处理）
   */
  function parseJSON(text) {
    let content = String(text || '').trim();
    content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(content);
    } catch(e) {}

    // 从夹杂说明、思考文本或多个代码块的返回中提取顶层 JSON；
    // 模型的最终答案通常位于最后，因此采用最后一个有效对象。
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    let result = null;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            result = JSON.parse(content.slice(start, i + 1));
          } catch(e2) {}
          start = -1;
        }
      }
    }
    return result || repairTruncatedJSON(content);
  }

  /**
   * 获取模型列表（OpenAI 兼容格式）
   */
  async function fetchModelList() {
    const settings = getSettings();
    const baseUrl = normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');
    const url = baseUrl + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('无法解析模型列表');
  }

  return { callApi, parseJSON, getSettings, fetchModelList };
})();
