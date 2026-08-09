/**
 * preload — 通过 contextBridge 安全暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  /** 获取皮肤列表（主进程扫描 skins/ 目录） */
  getSkins: () => ipcRenderer.invoke('skins:list'),

  /** 窗口缩放：dir > 0 放大，< 0 缩小，'reset' 重置 */
  resize: (dir) => ipcRenderer.send('pet:resize', dir),

  /** 聊天对话框：自定义大小（w/h 像素，右下角拖拽触发） */
  resizeChat: (w, h) => ipcRenderer.send('chat:resize', { w, h }),

  /** 聊天对话框：恢复默认大小 */
  resetChatSize: () => ipcRenderer.send('chat:reset-size'),

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

  /** 对话历史导出：弹出保存对话框，返回 { ok, path } */
  exportChatHistory: () => ipcRenderer.invoke('chat:export'),

  /** 对话历史导入：选择 JSON 文件并替换，返回 { ok, count } 或 { ok:false, message } */
  importChatHistory: () => ipcRenderer.invoke('chat:import'),

  /** 聊天对话框：监听当前会话被删除/变化，需要重载 */
  onSessionChanged: (cb) => ipcRenderer.on('chat:session-changed', (e, changed) => cb(changed)),

  /** AI：获取配置（API 地址 / Key / 模型 / 人设） */
  getAiConfig: () => ipcRenderer.invoke('ai:get-config'),

  /** AI：保存配置 */
  saveAiConfig: (cfg) => ipcRenderer.send('ai:save-config', cfg),

  /** AI：测试连接（可传入 { baseURL, apiKey, model } 测试指定配置，缺省测试当前启用项） */
  testAi: (profile) => ipcRenderer.invoke('ai:test', profile ? { profile } : undefined),

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

  /** 获取应用信息（名称 / 版本 / 作者 / GitHub 仓库） */
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),

  /** 在系统浏览器中打开外部链接（仅 http/https） */
  openExternal: (url) => ipcRenderer.send('app:open-external', url),

  /** 提醒：读取番茄钟与闹钟状态 */
  getReminderState: () => ipcRenderer.invoke('reminder:get-state'),

  /** 提醒：启动番茄钟（durationMin 分钟） */
  startPomodoro: (durationMin) => ipcRenderer.send('reminder:start-pomodoro', { durationMin }),

  /** 提醒：停止番茄钟 */
  stopPomodoro: () => ipcRenderer.send('reminder:stop-pomodoro'),

  /** 提醒：添加每日闹钟（time 'HH:MM'，label 可选） */
  addAlarm: (time, label) => ipcRenderer.send('reminder:add-alarm', { time, label }),

  /** 提醒：删除闹钟 */
  removeAlarm: (id) => ipcRenderer.send('reminder:remove-alarm', id),

  /** 提醒：切换闹钟启用状态 */
  toggleAlarm: (id, enabled) => ipcRenderer.send('reminder:toggle-alarm', { id, enabled }),

  /** 提醒：监听状态变化（设置窗口刷新） */
  onReminderUpdated: (cb) => ipcRenderer.on('reminder:updated', (e, state) => cb(state)),

  /** 提醒：监听提醒触发（宠物窗口显示气泡） */
  onReminderFire: (cb) => ipcRenderer.on('reminder:fire', (e, payload) => cb(payload)),

  /** 陪伴：读取统计（陪伴天数 / 互动次数 / 对话次数） */
  getCompanionStats: () => ipcRenderer.invoke('companion:get'),

  /** 陪伴：记录一次互动（互动按钮等） */
  logInteraction: (reason) => ipcRenderer.send('companion:log-interaction', { reason }),

  /** 偏好：读取（userName 称呼） */
  getPrefs: () => ipcRenderer.invoke('prefs:get'),

  /** 偏好：保存（{ userName }） */
  setPrefs: (prefs) => ipcRenderer.send('prefs:set', prefs),

  /** 自动更新：检查 GitHub 最新版本（返回 { ok, hasUpdate, latest, current, url, name, size }） */
  checkUpdate: () => ipcRenderer.invoke('update:check'),

  /** 自动更新：下载最新安装包并静默安装（url 来自 checkUpdate，sha512 可选用于校验） */
  downloadUpdate: (url, sha512) => ipcRenderer.send('update:download', { url, sha512 }),

  /** 自动更新：监听下载进度（0-100） */
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (e, pct) => cb(pct)),

  /** 自动更新：监听下载完成（随后自动静默安装并重启） */
  onUpdateDone: (cb) => ipcRenderer.on('update:done', (e, p) => cb(p)),

  /** 自动更新：监听下载失败 */
  onUpdateError: (cb) => ipcRenderer.on('update:error', (e, msg) => cb(msg)),

  /** 睡眠检测：宠物窗口监听空闲分钟数推送 */
  onIdleTick: (cb) => ipcRenderer.on('pet:idle-tick', (e, payload) => cb(payload)),

  /** 退出应用 */
  quit: () => ipcRenderer.send('app:quit'),
});
