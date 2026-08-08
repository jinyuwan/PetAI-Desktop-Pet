/**
 * AI 桌面宠物 — Electron 主进程
 * 职责：透明悬浮窗、置顶、系统原生拖拽、皮肤目录扫描、状态机 IPC
 */
const { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage, desktopCapturer, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let hoverTimer = null;
let lastHoverState = null;
let tray = null;        // 系统托盘
let settingsWin = null; // 设置窗口
let chatWin = null;     // 聊天对话框窗口
let isQuitting = false; // 是否真正退出（托盘常驻时隐藏不等于退出）
let currentPetState = 'idle'; // 宠物当前姿势（主进程记忆，供设置窗口高亮）
let autoPose = true;          // 姿势是否跟随 AI/状态机自动切换
let chatVisible = false;      // 对话框是否处于显示态（hover 控制）
let chatHideTimer = null;     // 对话框延迟隐藏定时器
let silentMode = false;       // 静默模式：仅保留桌宠与手柄，隐藏对话框

/* ---------- 陪伴记录 & 用户偏好 ---------- */

const companionFile = () => path.join(app.getPath('userData'), 'companion.json');
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');

let companion = { firstSeen: Date.now(), lastSeen: Date.now(), interactions: 0, chats: 0 };
let prefs = { userName: '' };

function loadCompanion() {
  try {
    const raw = JSON.parse(fs.readFileSync(companionFile(), 'utf8'));
    if (raw) companion = Object.assign({}, companion, raw);
  } catch (e) { /* 默认 */ }
  return companion;
}

function saveCompanion() {
  try {
    const file = companionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(companion, null, 2), 'utf8');
  } catch (e) {
    console.warn('[companion] 保存失败:', e.message);
  }
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (raw && typeof raw.userName === 'string') prefs = { userName: raw.userName.slice(0, 20) };
  } catch (e) { /* 默认 */ }
  return prefs;
}

function savePrefs() {
  try {
    const file = prefsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs, null, 2), 'utf8');
  } catch (e) {
    console.warn('[prefs] 保存失败:', e.message);
  }
}

/** 每日打卡：更新 lastSeen（跨天时写入，保证统计真实） */
function companionDailyCheck() {
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  const lastKey = (() => {
    const d = new Date(companion.lastSeen);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  })();
  if (lastKey !== todayKey) {
    companion.lastSeen = Date.now();
    saveCompanion();
  }
}

ipcMain.handle('companion:get', () => companion);
ipcMain.on('companion:log-interaction', (e, payload) => {
  companion.interactions += 1;
  saveCompanion();
});

ipcMain.handle('prefs:get', () => prefs);
ipcMain.on('prefs:set', (e, payload) => {
  prefs.userName = (payload && typeof payload.userName === 'string' ? payload.userName : '').trim().slice(0, 20);
  savePrefs();
});

/* ---------- 窗口基础尺寸（保持 400:560 比例） ---------- */
const BASE_W = 400;
const BASE_H = 560;
const DEFAULT_SCALE = 0.6; // 默认/启动/重置尺寸 240×336
const MIN_SCALE = 0.45;    // 最小 180×252
const MAX_SCALE = 2.0;     // 最大 800×1120
let petScale = DEFAULT_SCALE; // 默认以默认尺寸启动

/* 聊天对话框尺寸 */
const CHAT_W = 320;
const CHAT_H = 230;

/** 皮肤规范：白名单标准状态 */
const STANDARD_STATES = [
  'idle', 'reading', 'planning', 'thinking',
  'task_done', 'working', 'work_done',
];

function createWindow() {
  win = new BrowserWindow({
    width: Math.round(BASE_W * petScale),
    height: Math.round(BASE_H * petScale),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 置顶层级：screen-saver 保证在大多数窗口之上
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 开发模式打开调试工具
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // 屏蔽默认右键菜单（由渲染进程自定义）
  win.webContents.on('context-menu', (e) => e.preventDefault());

    // 宠物移动 / 缩放时重新布局聊天对话框
  win.on('move', () => layoutChatWindow());
  win.on('resize', () => layoutChatWindow());

  win.on('closed', () => { win = null; });
}

/* ---------- 聊天对话框窗口 ---------- */

/** 判断屏幕坐标点是否在某窗口 bounds 内 */
function isPointInBounds(cursor, b) {
  return cursor.x >= b.x && cursor.x <= b.x + b.width &&
         cursor.y >= b.y && cursor.y <= b.y + b.height;
}

/** 根据宠物窗口位置布局对话框：优先下方，其次右侧，最后左侧（边界钳制） */
function layoutChatWindow() {
  if (!chatWin || chatWin.isDestroyed() || !win || win.isDestroyed()) return;
  const pb = win.getBounds();
  const wa = screen.getDisplayMatching(pb).workArea;
  const gap = 10;
  let x, y;
  if (pb.y + pb.height + gap + CHAT_H <= wa.y + wa.height) {
    // 下方：水平居中于宠物
    x = Math.round(pb.x + (pb.width - CHAT_W) / 2);
    y = pb.y + pb.height + gap;
  } else if (pb.x + pb.width + gap + CHAT_W <= wa.x + wa.width) {
    // 右侧：垂直居中
    x = pb.x + pb.width + gap;
    y = Math.round(pb.y + (pb.height - CHAT_H) / 2);
  } else {
    // 左侧：垂直居中
    x = pb.x - gap - CHAT_W;
    y = Math.round(pb.y + (pb.height - CHAT_H) / 2);
  }
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - CHAT_W - 4));
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - CHAT_H - 4));
  chatWin.setBounds({ x, y, width: CHAT_W, height: CHAT_H });
}

/** 创建聊天对话框窗口（平时透明隐藏，hover 显示） */
function createChatWindow() {
  chatWin = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.setAlwaysOnTop(true, 'screen-saver');
  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  chatWin.on('closed', () => { chatWin = null; });
  layoutChatWindow();
}

/** 切换对话框显示态（通知渲染层做透明度动画） */
function setChatVisible(v) {
  if (chatVisible === v) return;
  chatVisible = v;
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('chat:hover-state', v);
  }
}

/* ---------- 对话历史（本地持久化） ---------- */

const chatDataFile = () => path.join(app.getPath('userData'), 'chat-history.json');
let chatData = null;

function loadChatData() {
  if (chatData) return chatData;
  try {
    chatData = JSON.parse(fs.readFileSync(chatDataFile(), 'utf8'));
  } catch (e) {
    chatData = null;
  }
  if (!chatData || !Array.isArray(chatData.sessions)) {
    chatData = { sessions: [], activeSessionId: null };
  }
  return chatData;
}

function saveChatData() {
  try {
    const file = chatDataFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(chatData, null, 2), 'utf8');
  } catch (e) {
    console.warn('[chat] 历史保存失败:', e.message);
  }
}

function ensureSession() {
  const d = loadChatData();
  let s = d.sessions.find((x) => x.id === d.activeSessionId);
  if (!s) {
    s = { id: String(Date.now()), createdAt: Date.now(), messages: [] };
    d.sessions.push(s);
    d.activeSessionId = s.id;
    saveChatData();
  }
  return s;
}

/** 聊天对话框 IPC */
ipcMain.handle('chat:get-state', () => {
  const d = loadChatData();
  return {
    sessions: d.sessions.map((s) => ({ id: s.id, createdAt: s.createdAt, count: s.messages.length })),
    activeSessionId: d.activeSessionId,
  };
});

ipcMain.handle('chat:get-history', () => loadChatData());

ipcMain.on('chat:log', (e, msg) => {
  if (!msg || typeof msg.role !== 'string' || typeof msg.text !== 'string') return;
  const s = ensureSession();
  s.messages.push({
    role: msg.role,
    text: msg.text,
    image: typeof msg.image === 'string' ? msg.image : undefined,
    time: Date.now(),
  });
  saveChatData();
});

/** 切换当前会话（设置 → 对话 点击历史卡片），并通知对话框重载 */
ipcMain.on('chat:switch-session', (e, id) => {
  const d = loadChatData();
  if (!d.sessions.some((s) => s.id === id)) return;
  d.activeSessionId = id;
  saveChatData();
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('chat:session-changed', true);
  }
});

ipcMain.on('chat:new-session', () => {
  const d = loadChatData();
  const s = { id: String(Date.now()), createdAt: Date.now(), messages: [] };
  d.sessions.push(s);
  d.activeSessionId = s.id;
  saveChatData();
});

ipcMain.on('chat:clear-history', () => {
  chatData = { sessions: [], activeSessionId: null };
  saveChatData();
  // 通知聊天对话框重载：清空当前对话、回到欢迎语
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send('chat:session-changed', true);
  }
});

/** 删除单个会话；若删的是当前会话，则切换到剩余会话中的第一个（或空） */
ipcMain.on('chat:delete-session', (e, id) => {
  const d = loadChatData();
  const idx = d.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  d.sessions.splice(idx, 1);
  if (d.activeSessionId === id) {
    d.activeSessionId = d.sessions.length ? d.sessions[0].id : null;
    // 通知聊天对话框重新加载（当前会话被删）
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send('chat:session-changed', true);
    }
  }
  saveChatData();
});

/* ---------- AI 对话（自定义 OpenAI 兼容接口，支持多套 API 配置） ---------- */

const aiConfigFile = () => path.join(app.getPath('userData'), 'ai-config.json');

const DEFAULT_AI_CONFIG = {
  profiles: [],
  activeProfileId: null,
  systemPrompt: '你是陪伴用户工作学习的桌面宠物蕾米，语气亲切自然，回复简洁，用中文交流。',
  maxContextMessages: 20, // 每次请求携带的最近消息条数（控制上下文 Token 消耗）
};

/** 生成 profile id */
function newProfileId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 旧版单配置结构 → 新版 profiles 列表 */
function migrateLegacyConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.profiles)) return null; // 已是新结构
  if (!raw.baseURL && !raw.apiKey) return null; // 空配置
  const profile = {
    id: newProfileId(),
    name: '配置 1',
    baseURL: raw.baseURL || '',
    apiKey: raw.apiKey || '',
    model: raw.model || '',
  };
  return { profiles: [profile], activeProfileId: profile.id, systemPrompt: raw.systemPrompt || '' };
}

let aiConfig = null;

function loadAiConfig() {
  if (aiConfig) return aiConfig;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(aiConfigFile(), 'utf8'));
  } catch (e) {
    raw = null;
  }
  const migrated = migrateLegacyConfig(raw);
  aiConfig = migrated || Object.assign({}, DEFAULT_AI_CONFIG, raw || {});
  if (!Array.isArray(aiConfig.profiles)) aiConfig.profiles = [];
  if (!aiConfig.maxContextMessages) aiConfig.maxContextMessages = DEFAULT_AI_CONFIG.maxContextMessages;
  // 启用项失效时自动回退到第一个配置
  if (!aiConfig.profiles.some((p) => p.id === aiConfig.activeProfileId)) {
    aiConfig.activeProfileId = aiConfig.profiles.length ? aiConfig.profiles[0].id : null;
  }
  return aiConfig;
}

function saveAiConfig() {
  try {
    const file = aiConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(aiConfig, null, 2), 'utf8');
  } catch (e) {
    console.warn('[ai] 配置保存失败:', e.message);
  }
}

/** 当前启用的 API 配置；无配置或未启用时返回 null */
function activeAiProfile() {
  const cfg = loadAiConfig();
  return cfg.profiles.find((p) => p.id === cfg.activeProfileId) || null;
}

/** 当前是否有可用的 AI 配置 */
function aiReady() {
  const p = activeAiProfile();
  return !!(p && p.baseURL && p.apiKey && p.model);
}

/** 解析传入的 profile 或回退到启用项 */
function resolveProfile(payload) {
  if (payload && payload.profile && typeof payload.profile === 'object') {
    const { baseURL, apiKey, model } = payload.profile;
    if (baseURL && apiKey && model) {
      return { baseURL, apiKey, model, advanced: payload.profile.advanced };
    }
  }
  return activeAiProfile();
}

/** 组装发送给 LLM 的消息列表：人设(+称呼) + 当前会话历史（支持图片多模态、上下文截断） */
function buildMessages(activeSession) {
  const cfg = loadAiConfig();
  // 人设留空 = 不注入任何 system 人设，完全尊重用户设置
  let sysPrompt = (cfg.systemPrompt || '').trim();
  const uName = (loadPrefs().userName || '').trim();
  if (sysPrompt && uName) {
    sysPrompt += '\n\n（用户希望你称呼他为「' + uName + '」，请在对话中自然地使用这个称呼。）';
  }
  const msgs = sysPrompt ? [{ role: 'system', content: sysPrompt }] : [];
  const history = (activeSession.messages || []).filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  );
  // 上下文截断：只携带最近 N 条消息（N 由全局设置控制）
  const maxN = parseInt(cfg.maxContextMessages, 10);
  const keep = Number.isFinite(maxN) && maxN > 0 ? Math.min(history.length, maxN) : history.length;
  history.slice(-keep).forEach((m) => {
    if (m.image) {
      // OpenAI 兼容多模态：图片走 image_url（data URL）
      msgs.push({
        role: m.role,
        content: [
          { type: 'text', text: m.text },
          { type: 'image_url', image_url: { url: m.image } },
        ],
      });
    } else {
      msgs.push({ role: m.role, content: m.text });
    }
  });
  return msgs;
}

/** 解析数字；空值返回 null */
function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 根据配置的 advanced 组装请求体（温度/最大 tokens/思考模式/附加参数） */
function buildRequestBody(profile, messages) {
  const adv = profile.advanced || {};
  const body = { model: profile.model, messages, stream: true };
  const temp = parseNum(adv.temperature);
  const maxTok = parseNum(adv.maxTokens);
  const effort = (adv.reasoningEffort || '').trim();
  // 设置了思考模式时不默认发 temperature（reasoner 类模型通常不兼容）
  if (temp !== null) body.temperature = temp;
  else if (!effort) body.temperature = 0.8;
  if (maxTok !== null && maxTok > 0) body.max_tokens = maxTok;
  if (effort) body.reasoning_effort = effort;
  // 附加参数 JSON：透传服务商特有能力（联网搜索 / thinking 开关等），允许覆盖以上字段
  if (typeof adv.extraBody === 'string' && adv.extraBody.trim()) {
    try {
      const extra = JSON.parse(adv.extraBody);
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.assign(body, extra);
      }
    } catch (e) {
      console.warn('[ai] 附加参数 JSON 解析失败:', e.message);
    }
  }
  return body;
}

/** 解析 SSE 数据行，返回增量文本或 null */
function parseSSE(line) {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    return json.choices && json.choices[0] && json.choices[0].delta
      ? (json.choices[0].delta.content || '')
      : null;
  } catch (e) {
    return null;
  }
}

/** 调用 OpenAI 兼容接口（流式），逐段调用 onDelta 回调 */
async function streamChat(profile, messages, onDelta) {
  const url = profile.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (profile.apiKey || '').trim(),
    },
    body: JSON.stringify(buildRequestBody(profile, messages)),
  });
  if (!resp.ok) {
    let detail = '';
    try {
      const err = await resp.json();
      detail = (err.error && err.error.message) || JSON.stringify(err).slice(0, 300);
    } catch (e) { /* ignore */ }
    throw new Error('HTTP ' + resp.status + (detail ? ': ' + detail : ''));
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const delta = parseSSE(line.trim());
      if (delta) onDelta(delta);
    }
  }
  if (buffer.trim()) {
    const delta = parseSSE(buffer.trim());
    if (delta) onDelta(delta);
  }
}

/** 当前是否有可用的 AI 配置 */
function aiReady() {
  const cfg = loadAiConfig();
  return !!(cfg.baseURL && cfg.apiKey && cfg.model);
}

/* AI IPC */
ipcMain.handle('ai:get-config', () => loadAiConfig());

ipcMain.on('ai:save-config', (e, cfg) => {
  aiConfig = Object.assign({}, DEFAULT_AI_CONFIG, cfg || {});
  if (!Array.isArray(aiConfig.profiles)) aiConfig.profiles = [];
  if (!aiConfig.profiles.some((p) => p.id === aiConfig.activeProfileId)) {
    aiConfig.activeProfileId = aiConfig.profiles.length ? aiConfig.profiles[0].id : null;
  }
  saveAiConfig();
});

/** 测试连接：发送最小请求验证配置（可指定 profile，缺省用启用项） */
ipcMain.handle('ai:test', async (e, payload) => {
  const profile = resolveProfile(payload);
  if (!profile) return { ok: false, message: '请先添加并启用一套 API 配置' };
  try {
    await streamChat(profile, [{ role: 'user', content: 'ping' }], () => {});
    return { ok: true, message: '连接成功！模型可用。' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

/** 核心对话管线：记录消息 → 调用 LLM → 流式推送给 sender */
async function runAiChat(sender, text, image) {
  const send = (ch, p) => { if (sender && !sender.isDestroyed()) sender.send(ch, p); };
  if (!text && !image) return;
  const profile = activeAiProfile();
  if (!profile || !profile.baseURL || !profile.apiKey || !profile.model) {
    send('ai:stream-error', '尚未配置 AI。请右键托盘 → 设置 → AI 中添加并启用一套 API 配置。');
    return;
  }
  // 记录用户消息到当前会话
  const d = loadChatData();
  let s = d.sessions.find((x) => x.id === d.activeSessionId);
  if (!s) { s = ensureSession(); }
  s.messages.push({ role: 'user', text, image, time: Date.now() });
  saveChatData();
  companion.chats += 1; // 对话计数
  saveCompanion();

  const messages = buildMessages(s);
  let full = '';
  send('ai:stream-start', {});
  try {
    await streamChat(profile, messages, (delta) => {
      full += delta;
      send('ai:stream-delta', { delta });
    });
    s.messages.push({ role: 'assistant', text: full, time: Date.now() });
    saveChatData();
    send('ai:stream-end', { full });
  } catch (err) {
    const msg = err.message || String(err);
    // 带图请求失败且错误疑似不支持图片 → 友好提示
    const friendly = image && /image|vision|multimodal|图片|unsupported|invalid|400|422/i.test(msg)
      ? '当前模型不支持识别图片哦~ 该功能需要大模型支持原生多模态~'
      : msg;
    send('ai:stream-error', friendly);
  }
}

/** 发送消息：主进程调用 LLM，流式推送给对话框 */
ipcMain.on('ai:send', (e, payload) => {
  const text = typeof payload === 'string' ? payload : (payload && payload.text || '');
  const image = payload && typeof payload.image === 'string' ? payload.image : undefined;
  runAiChat(e.sender, text, image);
});

/* ---------- 屏幕识别（多模态特殊功能） ---------- */

/** 截取鼠标所在屏幕，压缩后返回 JPEG data URL */
ipcMain.handle('screen:capture', async () => {
  try {
    const cursor = screen.getCursorScreenPoint();
    const disp = screen.getDisplayNearestPoint(cursor);
    const { width, height } = disp.size;
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
    if (!sources.length) return { ok: false, message: '未找到屏幕源' };
    const img = sources[0].thumbnail;
    if (img.isEmpty()) return { ok: false, message: '截图失败' };
    const buf = img.toJPEG(80);
    return { ok: true, image: 'data:image/jpeg;base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

/* ---------- 皮肤加载器 ---------- */

function loadSkins() {
  const skinsDir = path.join(__dirname, 'skins');
  const result = [];
  if (!fs.existsSync(skinsDir)) return result;
  for (const name of fs.readdirSync(skinsDir)) {
    const dir = path.join(skinsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const jsonPath = path.join(dir, 'skin.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const spine = meta.spine || {};
      const assetOk = ['skeleton', 'atlas', 'png'].every((k) => spine[k] && fs.existsSync(path.join(dir, spine[k])));
      if (!assetOk) continue;
      result.push({
        id: name,
        name: meta.name || name,
        author: meta.author || '',
        version: meta.version || '1.0',
        source: meta.source || '',
        states: meta.states || {},
        extraStates: meta.extraStates || {},
        spine,
      });
    } catch (e) {
      console.warn('[skins] 跳过损坏皮肤:', name, e.message);
    }
  }
  return result;
}

ipcMain.handle('skins:list', () => loadSkins());

/* ---------- 定时提醒 & 番茄钟 ---------- */

const reminderFile = () => path.join(app.getPath('userData'), 'reminders.json');

let reminders = { pomodoro: { running: false, endAt: 0, durationMin: 25 }, alarms: [] };
let reminderTimer = null;

function loadReminders() {
  try {
    const raw = JSON.parse(fs.readFileSync(reminderFile(), 'utf8'));
    if (raw) {
      reminders = Object.assign({}, reminders, raw);
      if (!Array.isArray(reminders.alarms)) reminders.alarms = [];
    }
  } catch (e) { /* 默认空 */ }
  return reminders;
}

function saveReminders() {
  try {
    const file = reminderFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(reminders, null, 2), 'utf8');
  } catch (e) {
    console.warn('[reminder] 保存失败:', e.message);
  }
}

function newAlarmId() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 提醒触发：宠物窗口气泡 + 动作；主窗口隐藏时用系统通知兜底 */
function fireReminder(type, label) {
  const payload = { type, label };
  [win, chatWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:fire', payload);
  });
  // 宠物窗口不可见时（隐藏状态），用系统通知保证提醒可达
  if (!win || win.isDestroyed() || !win.isVisible()) {
    if (Notification.isSupported()) {
      try {
        const n = new Notification({
          title: type === 'pomodoro' ? '🍅 番茄钟结束' : '⏰ 提醒',
          body: label || (type === 'pomodoro' ? '休息一下吧！' : '该做事啦'),
        });
        n.show();
      } catch (e) { /* ignore */ }
    }
  }
}

/** 每秒检查一次：番茄钟到期 / 每日闹钟到点 */
function reminderTick() {
  const now = Date.now();

  // 番茄钟
  if (reminders.pomodoro.running && now >= reminders.pomodoro.endAt) {
    reminders.pomodoro.running = false;
    reminders.pomodoro.endAt = 0;
    saveReminders();
    fireReminder('pomodoro', '');
  }

  // 每日闹钟：HH:MM 格式，每天到点触发（当天只触发一次）
  const d = new Date(now);
  const todayKey = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  const curMin = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  reminders.alarms.forEach((a) => {
    if (!a.enabled || !a.time) return;
    if (a.time === curMin && a.lastFired !== todayKey) {
      a.lastFired = todayKey;
      fireReminder('alarm', a.label || a.time);
    }
  });
}

function startReminderWatch() {
  if (reminderTimer) return;
  reminderTimer = setInterval(reminderTick, 1000);
}

ipcMain.handle('reminder:get-state', () => {
  const r = loadReminders();
  // 返回给前端时补算剩余秒数
  const remainSec = r.pomodoro.running ? Math.max(0, Math.ceil((r.pomodoro.endAt - Date.now()) / 1000)) : 0;
  return Object.assign({}, r, { pomodoro: Object.assign({}, r.pomodoro, { remainSec }) });
});

ipcMain.on('reminder:start-pomodoro', (e, payload) => {
  const min = Math.max(1, Math.min(180, parseInt(payload && payload.durationMin, 10) || 25));
  reminders.pomodoro = { running: true, endAt: Date.now() + min * 60000, durationMin: min };
  saveReminders();
  const remainSec = Math.ceil((reminders.pomodoro.endAt - Date.now()) / 1000);
  [settingsWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:updated', Object.assign({}, reminders, { pomodoro: Object.assign({}, reminders.pomodoro, { remainSec }) }));
  });
});

ipcMain.on('reminder:stop-pomodoro', () => {
  reminders.pomodoro = { running: false, endAt: 0, durationMin: reminders.pomodoro.durationMin };
  saveReminders();
  [settingsWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:updated', Object.assign({}, reminders));
  });
});

ipcMain.on('reminder:add-alarm', (e, payload) => {
  const time = payload && typeof payload.time === 'string' ? payload.time : '';
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  const label = payload && typeof payload.label === 'string' ? payload.label.slice(0, 60) : '';
  reminders.alarms.push({ id: newAlarmId(), time, label, enabled: true, lastFired: '' });
  saveReminders();
  [settingsWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:updated', Object.assign({}, reminders));
  });
});

ipcMain.on('reminder:remove-alarm', (e, id) => {
  reminders.alarms = reminders.alarms.filter((a) => a.id !== id);
  saveReminders();
  [settingsWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:updated', Object.assign({}, reminders));
  });
});

ipcMain.on('reminder:toggle-alarm', (e, payload) => {
  const a = reminders.alarms.find((x) => x.id === payload && typeof payload === 'string');
  if (!a && payload && typeof payload === 'object') {
    reminders.alarms.forEach((x) => {
      if (x.id === payload.id) x.enabled = !!payload.enabled;
    });
  } else if (a) {
    a.enabled = !a.enabled;
  }
  saveReminders();
  [settingsWin].forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('reminder:updated', Object.assign({}, reminders));
  });
});

/* ---------- 应用信息 & 外部链接 ---------- */

let appInfoCache = null;

ipcMain.handle('app:get-info', () => {
  if (appInfoCache) return appInfoCache;
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  } catch (e) { /* ignore */ }
  appInfoCache = {
    name: pkg.productName || pkg.name || 'PetAI',
    description: pkg.description || '',
    version: app.getVersion() || pkg.version || '',
    author: pkg.author || '',
    repo: 'https://github.com/jinyuwan/PetAI-Desktop-Pet',
    homepage: 'https://github.com/jinyuwan',
  };
  return appInfoCache;
});

/** 在系统浏览器打开外部链接（仅允许 http/https） */
ipcMain.on('app:open-external', (e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.on('app:quit', () => {
  isQuitting = true;
  app.quit();
});

/* ---------- 鼠标悬停检测（drag 区域不触发 CSS hover，改用主进程轮询） ---------- */

function startHoverWatch() {
  if (hoverTimer) return;
  hoverTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    // 鼠标在宠物窗口内，或对话框当前显示时鼠标在其范围内
    const inPet = isPointInBounds(cursor, win.getBounds());
    const inChat = chatVisible && chatWin && !chatWin.isDestroyed() &&
                   isPointInBounds(cursor, chatWin.getBounds());
    const inside = inPet || inChat;

    // 互动计时：鼠标在宠物/对话框内视为"互动"，更新最后互动时间
    if (inside) lastPetInteraction = Date.now();

    // 宠物手柄：即时显示/隐藏
    if (inside !== lastHoverState) {
      lastHoverState = inside;
      win.webContents.send('pet:hover-state', inside);
    }

    // 对话框：静默模式下不显示；否则即时显示，延迟隐藏（避免宠物↔对话框之间移动时闪烁）
    if (silentMode) {
      if (chatHideTimer) { clearTimeout(chatHideTimer); chatHideTimer = null; }
      setChatVisible(false);
    } else if (inside) {
      if (chatHideTimer) { clearTimeout(chatHideTimer); chatHideTimer = null; }
      setChatVisible(true);
    } else if (chatHideTimer === null) {
      chatHideTimer = setTimeout(() => {
        chatHideTimer = null;
        setChatVisible(false);
      }, 450);
    }
  }, 90);
}

ipcMain.handle('pet:hover-watch', () => { startHoverWatch(); });

/* ---------- 睡眠检测（长时间无互动让宠物打盹） ---------- */

let lastPetInteraction = Date.now(); // 最后"互动"（鼠标在宠物/对话框内）时间
let idleTickTimer = null;

/** 每 60 秒向宠物窗口推送空闲分钟数（宠物据此打盹 / 自言自语） */
function startIdleTick() {
  if (idleTickTimer) return;
  idleTickTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const idleMinutes = Math.floor((Date.now() - lastPetInteraction) / 60000);
    win.webContents.send('pet:idle-tick', { idleMinutes });
  }, 60000);
}

/* ---------- 窗口缩放（保持 400:560 比例） ---------- */

ipcMain.on('pet:resize', (e, dir) => {
  if (!win) return;
  if (dir === 'reset') {
    petScale = DEFAULT_SCALE;
  } else {
    const step = dir > 0 ? 1.12 : 1 / 1.12;
    petScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, petScale * step));
  }
  const [x, y] = win.getPosition();
  // 窗口创建时 resizable:false，setSize 会被忽略——缩放前临时允许，完成后恢复
  const wasResizable = win.isResizable();
  if (!wasResizable) win.setResizable(true);
  win.setSize(Math.round(BASE_W * petScale), Math.round(BASE_H * petScale), false);
  win.setResizable(wasResizable);
  win.setPosition(x, y);
});

/* ---------- 系统托盘 & 设置窗口 ---------- */

/** 显示/隐藏宠物主窗口（隐藏时联动隐藏对话框） */
function togglePetVisible() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
    if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
  } else {
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
    if (chatWin && !chatWin.isDestroyed()) chatWin.show();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.focus();
  }
}

/** 创建系统托盘：左键显隐宠物，右键打开设置 */
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('AI 桌面宠物 · 蕾米');

  tray.on('click', togglePetVisible);          // 左键：显示/隐藏宠物
  tray.on('right-click', openSettingsWindow);  // 右键：打开设置

  // 兜底：图标文件缺失时也提供菜单入口
  if (icon.isEmpty()) {
    const fallback = Menu.buildFromTemplate([
      { label: '显示/隐藏宠物', click: togglePetVisible },
      { label: '设置', click: openSettingsWindow },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(fallback);
  }
}

/** 打开设置窗口（单实例） */
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 620,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setAlwaysOnTop(true, 'floating');
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

/** 读取当前状态（设置窗口初始化用） */
ipcMain.handle('settings:get-state', () => ({
  petVisible: !!(win && !win.isDestroyed() && win.isVisible()),
  alwaysOnTop: !!(win && !win.isDestroyed() && win.isAlwaysOnTop()),
  currentState: currentPetState,
  autoPose,
  silentMode,
}));

/** 设置窗口 → 切换静默模式 */
ipcMain.on('pet:set-silent', (e, val) => {
  silentMode = !!val;
  if (silentMode) {
    if (chatHideTimer) { clearTimeout(chatHideTimer); chatHideTimer = null; }
    setChatVisible(false);
  }
});

/** 设置窗口 → 切换"跟随 AI"自动姿势模式 */
ipcMain.on('pet:set-autopose', (e, val) => {
  autoPose = !!val;
  if (win && !win.isDestroyed()) win.webContents.send('pet:auto-pose-changed', autoPose);
});

/** 设置窗口 → 切换宠物姿势 */
ipcMain.on('pet:set-pose', (e, state) => {
  currentPetState = state;
  if (win && !win.isDestroyed()) win.webContents.send('pet:set-pose', state);
});

/** 宠物渲染进程 → 广播当前姿势变化（AI/交互触发时同步设置窗口高亮） */
ipcMain.on('pet:state-changed', (e, state) => {
  currentPetState = state;
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('pet:state-changed', state);
});

/** 设置窗口操作 → 同步主窗口 */
ipcMain.on('settings:toggle-visible', togglePetVisible);

/** 手柄 ☰ 设置键：打开同一个设置窗口 */
ipcMain.on('pet:open-settings', openSettingsWindow);

ipcMain.on('settings:set-always-on-top', (e, val) => {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(!!val, 'screen-saver');
});

ipcMain.on('settings:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

/* ---------- 应用生命周期 ---------- */

app.whenReady().then(() => {
  loadCompanion();
  companionDailyCheck();
  loadPrefs();
  loadReminders();
  startReminderWatch();
  createWindow();
  createChatWindow();
  createTray();
  startIdleTick();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 托盘常驻：关闭所有窗口不退出（除非用户明确退出）
app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  } else if (process.platform === 'darwin') {
    // macOS 惯例保持运行
  } else if (!tray) {
    app.quit();
  }
});
