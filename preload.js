/**
 * preload — 通过 contextBridge 安全暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  /** 获取皮肤列表（主进程扫描 skins/ 目录） */
  getSkins: () => ipcRenderer.invoke('skins:list'),

  /** 窗口缩放：dir > 0 放大，< 0 缩小，'reset' 重置 */
  resize: (dir) => ipcRenderer.send('pet:resize', dir),

  /** 启动鼠标悬停检测，监听鼠标进出窗口 */
  startHoverWatch: () => ipcRenderer.invoke('pet:hover-watch'),
  onHoverChange: (cb) => ipcRenderer.on('pet:hover-state', (e, inside) => cb(inside)),

  /** 聊天对话框：监听 hover 显示/隐藏指令 */
  onChatHover: (cb) => ipcRenderer.on('chat:hover-state', (e, inside) => cb(inside)),

  /** 对话历史：获取会话概要（编号/时间/消息数） */
  getChatState: () => ipcRenderer.invoke('chat:get-state'),

  /** 对话历史：获取完整历史 */
  getChatHistory: () => ipcRenderer.invoke('chat:get-history'),

  /** 记录一条消息到当前会话（可选图片 data URL） */
  logChat: (role, text, image) => ipcRenderer.send('chat:log', { role, text, image }),

  /** 开启新对话 */
  newChatSession: () => ipcRenderer.send('chat:new-session'),

  /** 清空全部对话历史 */
  clearChatHistory: () => ipcRenderer.send('chat:clear-history'),

  /** 删除单个会话（传入会话 id） */
  deleteChatSession: (id) => ipcRenderer.send('chat:delete-session', id),

  /** 切换当前会话到指定 id（设置 → 对话 点击历史卡片） */
  switchChatSession: (id) => ipcRenderer.send('chat:switch-session', id),

  /** 聊天对话框：监听当前会话被删除/变化，需要重载 */
  onSessionChanged: (cb) => ipcRenderer.on('chat:session-changed', (e, changed) => cb(changed)),

  /** AI：获取配置（API 地址 / Key / 模型 / 人设） */
  getAiConfig: () => ipcRenderer.invoke('ai:get-config'),

  /** AI：保存配置 */
  saveAiConfig: (cfg) => ipcRenderer.send('ai:save-config', cfg),

  /** AI：测试连接 */
  testAi: () => ipcRenderer.invoke('ai:test'),

  /** AI：发送消息（主进程调用 LLM 流式返回；image 为可选图片 data URL） */
  sendAi: (text, image) => ipcRenderer.send('ai:send', { text, image }),

  /** AI：监听流式开始 */
  onAiStart: (cb) => ipcRenderer.on('ai:stream-start', () => cb()),

  /** AI：监听流式增量 */
  onAiDelta: (cb) => ipcRenderer.on('ai:stream-delta', (e, p) => cb(p.delta)),

  /** AI：监听流式结束（full 为完整回复） */
  onAiEnd: (cb) => ipcRenderer.on('ai:stream-end', (e, p) => cb(p.full)),

  /** AI：监听流式错误 */
  onAiError: (cb) => ipcRenderer.on('ai:stream-error', (e, msg) => cb(msg)),

  /** 屏幕识别：截取当前屏幕，返回 { ok, image(JPEG data URL), message } */
  captureScreen: () => ipcRenderer.invoke('screen:capture'),

  /** 设置窗口：读取当前状态（宠物是否可见 / 是否置顶） */
  getSettingsState: () => ipcRenderer.invoke('settings:get-state'),

  /** 切换静默模式（仅保留桌宠与手柄，隐藏对话框） */
  setSilentMode: (val) => ipcRenderer.send('pet:set-silent', val),

  /** 显示/隐藏宠物 */
  togglePetVisible: () => ipcRenderer.send('settings:toggle-visible'),

  /** 置顶开关 */
  setAlwaysOnTop: (val) => ipcRenderer.send('settings:set-always-on-top', val),

  /** 关闭设置窗口 */
  closeSettings: () => ipcRenderer.send('settings:close'),

  /** 切换宠物姿势（设置窗口 → 主进程 → 宠物窗口） */
  setPose: (state) => ipcRenderer.send('pet:set-pose', state),

  /** 宠物窗口：监听姿势切换指令 */
  onSetPose: (cb) => ipcRenderer.on('pet:set-pose', (e, state) => cb(state)),

  /** 宠物窗口：通知主进程当前姿势变化 */
  notifyState: (state) => ipcRenderer.send('pet:state-changed', state),

  /** 设置窗口：监听宠物姿势变化（AI/交互触发时同步高亮） */
  onStateChange: (cb) => ipcRenderer.on('pet:state-changed', (e, state) => cb(state)),

  /** 切换"跟随 AI"自动姿势模式 */
  setAutoPose: (val) => ipcRenderer.send('pet:set-autopose', val),

  /** 宠物窗口：监听自动模式变化 */
  onAutoPoseChange: (cb) => ipcRenderer.on('pet:auto-pose-changed', (e, val) => cb(val)),

  /** 打开设置窗口（手柄 ☰ 设置键调用） */
  openSettings: () => ipcRenderer.send('pet:open-settings'),

  /** 退出应用 */
  quit: () => ipcRenderer.send('app:quit'),
});
