/**
 * AI 桌面宠物 — Electron 主进程
 * 职责：透明悬浮窗、置顶、系统原生拖拽、皮肤目录扫描、状态机 IPC
 */
const { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage, desktopCapturer } = require('electron');
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

/* ---------- AI 对话（自定义 OpenAI 兼容接口） ---------- */

const aiConfigFile = () => path.join(app.getPath('userData'), 'ai-config.json');

const DEFAULT_AI_CONFIG = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  systemPrompt: '你是陪伴用户工作学习的桌面宠物蕾米，语气亲切自然，回复简洁，用中文交流。',
};

let aiConfig = null;

function loadAiConfig() {
  if (aiConfig) return aiConfig;
  try {
    aiConfig = JSON.parse(fs.readFileSync(aiConfigFile(), 'utf8'));
  } catch (e) {
    aiConfig = null;
  }
  aiConfig = Object.assign({}, DEFAULT_AI_CONFIG, aiConfig || {});
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

/** 组装发送给 LLM 的消息列表：人设 + 当前会话历史（支持图片多模态） */
function buildMessages(activeSession) {
  const cfg = loadAiConfig();
  // 人设留空 = 不注入任何 system 人设，完全尊重用户设置
  const sysPrompt = (cfg.systemPrompt || '').trim();
  const msgs = sysPrompt ? [{ role: 'system', content: sysPrompt }] : [];
  (activeSession.messages || []).forEach((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return;
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
async function streamChat(cfg, messages, onDelta) {
  const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (cfg.apiKey || '').trim(),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      temperature: 0.8,
    }),
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
  saveAiConfig();
});

/** 测试连接：发送最小请求验证配置 */
ipcMain.handle('ai:test', async () => {
  const cfg = loadAiConfig();
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) return { ok: false, message: '请先填写完整的 API 配置' };
  try {
    await streamChat(cfg, [{ role: 'user', content: 'ping' }], () => {});
    return { ok: true, message: '连接成功！模型可用。' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

/** 发送消息：主进程调用 LLM，流式推送给对话框 */
ipcMain.on('ai:send', async (e, payload) => {
  const sender = e.sender;
  const send = (ch, p) => { if (!sender.isDestroyed()) sender.send(ch, p); };
  const text = typeof payload === 'string' ? payload : (payload && payload.text || '');
  const image = payload && typeof payload.image === 'string' ? payload.image : undefined;
  if (!text && !image) return;
  const cfg = loadAiConfig();
  if (!aiReady()) {
    send('ai:stream-error', '尚未配置 AI。请右键托盘 → 设置 → AI 中填写 API 地址、Key 与模型名。');
    return;
  }
  // 记录用户消息到当前会话
  const d = loadChatData();
  let s = d.sessions.find((x) => x.id === d.activeSessionId);
  if (!s) { s = ensureSession(); }
  s.messages.push({ role: 'user', text, image, time: Date.now() });
  saveChatData();

  const messages = buildMessages(s);
  let full = '';
  send('ai:stream-start', {});
  try {
    await streamChat(cfg, messages, (delta) => {
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
  createWindow();
  createChatWindow();
  createTray();
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
