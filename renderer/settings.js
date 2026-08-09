/**
 * AI 桌面宠物 — 设置窗口
 * 职责：左列导航 + 右列子菜单；显示/置顶/跟随AI 开关、姿势切换、关于、退出
 */
(function () {
  'use strict';

  const swVisible = document.getElementById('sw-visible');
  const swTop = document.getElementById('sw-top');
  const swAuto = document.getElementById('sw-auto');
  const swSilent = document.getElementById('sw-silent');
  const btnClose = document.getElementById('btn-close');
  const btnQuit = document.getElementById('btn-quit');

  /* ---------- 左列导航 ---------- */

  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const panels = Array.from(document.querySelectorAll('.panel'));

  function showPanel(name) {
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    // 每次进入"对话"面板时刷新历史（可能有新消息）
    if (name === 'chat') renderChatHistory();
  }
  navItems.forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));

  /* ---------- 姿势折叠子菜单 ---------- */

  const fold = document.getElementById('pose-fold');
  document.getElementById('fold-toggle').addEventListener('click', () => {
    fold.classList.toggle('collapsed');
  });

  /* ---------- 姿势切换 ---------- */

  /** 标准状态的中文名（扩展状态回退显示原始名） */
  const STATE_CN = {
    idle: '发呆',
    reading: '读取内容',
    planning: '准备计划',
    thinking: '思考',
    task_done: '完成任务',
    working: '工作中',
    work_done: '工作结束',
  };

  const poseGrid = document.getElementById('pose-grid');
  const poseBtns = new Map(); // state → button

  function highlightPose(state) {
    poseBtns.forEach((b, s) => b.classList.toggle('active', s === state));
  }

  /** 从皮肤元数据构建姿势按钮（标准状态 + 扩展状态） */
  function buildPoseGrid(skins) {
    const skin = skins && skins[0];
    if (!skin) return;
    const entries = Object.keys(skin.states || {}).map((k) => [k, STATE_CN[k] || k]);
    Object.keys(skin.extraStates || {}).forEach((k) => entries.push([k, STATE_CN[k] || k]));
    entries.forEach(([state, label]) => {
      const b = document.createElement('button');
      b.className = 'pose-btn';
      b.textContent = label;
      b.title = state;
      b.addEventListener('click', () => {
        window.pet.setPose(state);
        window.pet.setAutoPose(false); // 手动选择姿势 → 关闭跟随 AI
        swAuto.setAttribute('aria-checked', 'false');
        highlightPose(state);
      });
      poseGrid.appendChild(b);
      poseBtns.set(state, b);
    });
  }

  /* ---------- AI 配置面板（多套 API 配置） ---------- */

  const aiEditor = document.getElementById('ai-editor');
  const aiProfileList = document.getElementById('ai-profile-list');
  const aiName = document.getElementById('ai-name');
  const aiBase = document.getElementById('ai-base');
  const aiKey = document.getElementById('ai-key');
  const aiModel = document.getElementById('ai-model');
  const aiPrompt = document.getElementById('ai-prompt');
  const aiCtx = document.getElementById('ai-ctx');
  const aiTemp = document.getElementById('ai-temp');
  const aiMaxTok = document.getElementById('ai-maxtok');
  const aiEffort = document.getElementById('ai-effort');
  const aiExtra = document.getElementById('ai-extra');
  const aiAdvToggle = document.getElementById('ai-adv-toggle');
  const aiAdvBody = document.getElementById('ai-adv-body');
  const aiStatus = document.getElementById('ai-status');
  const aiPromptStatus = document.getElementById('ai-prompt-status');
  const aiTestBtn = document.getElementById('ai-test');
  const aiSaveBtn = document.getElementById('ai-save');
  const aiCancelBtn = document.getElementById('ai-cancel');
  const aiAddBtn = document.getElementById('ai-add');

  let aiProfiles = [];
  let aiActiveId = null;
  let aiEditingId = null; // null = 新增模式

  function setAiStatus(msg, type) {
    aiStatus.textContent = msg;
    aiStatus.className = 'ai-status' + (type ? ' ' + type : '');
  }

  function setAiPromptStatus(msg, type) {
    aiPromptStatus.textContent = msg;
    aiPromptStatus.className = 'ai-status' + (type ? ' ' + type : '');
  }

  function readAiForm() {
    return {
      name: aiName.value.trim(),
      baseURL: aiBase.value.trim(),
      apiKey: aiKey.value.trim(),
      model: aiModel.value.trim(),
      advanced: {
        temperature: aiTemp.value,
        maxTokens: aiMaxTok.value,
        reasoningEffort: aiEffort.value,
        extraBody: aiExtra.value,
      },
    };
  }

  /** 渲染配置卡片列表 */
  function renderProfileList() {
    if (!aiProfiles.length) {
      aiProfileList.innerHTML = '<div class="ai-profile-empty">暂无 API 配置，点击右上角「＋ 添加」创建</div>';
      return;
    }
    aiProfileList.innerHTML = aiProfiles.map((p) => {
      const active = p.id === aiActiveId;
      return '<div class="ai-profile-card' + (active ? ' active' : '') + '" data-id="' + p.id + '">' +
        '<div class="ai-profile-head">' +
          '<span class="ai-profile-name">' + escapeHtml(p.name || '未命名') + '</span>' +
          (active ? '<span class="ai-profile-badge">使用中</span>' : '') +
        '</div>' +
        '<div class="ai-profile-meta">' +
          '<span class="ai-profile-model">' + escapeHtml(p.model || '—') + '</span>' +
          '<span class="ai-profile-url">' + escapeHtml(p.baseURL || '') + '</span>' +
        '</div>' +
        '<div class="ai-profile-actions">' +
          (active
            ? '<span class="ai-profile-active-tip">当前启用</span>'
            : '<button class="ai-profile-btn use" data-act="use">启用</button>') +
          '<button class="ai-profile-btn edit" data-act="edit">编辑</button>' +
          '<button class="ai-profile-btn del" data-act="del">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    aiProfileList.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.ai-profile-card').dataset.id;
        const act = btn.dataset.act;
        if (act === 'use') setActiveProfile(id);
        else if (act === 'edit') openAiEditor(id);
        else if (act === 'del') deleteProfile(id);
      });
    });
  }

  /** 打开编辑表单；id 为 null 表示新增 */
  function openAiEditor(id) {
    aiEditingId = id;
    const p = id ? aiProfiles.find((x) => x.id === id) : null;
    const adv = (p && p.advanced) || {};
    aiName.value = p ? p.name || '' : '';
    aiBase.value = p ? p.baseURL || '' : '';
    aiKey.value = p ? p.apiKey || '' : '';
    aiModel.value = p ? p.model || '' : '';
    aiTemp.value = adv.temperature !== undefined && adv.temperature !== null ? adv.temperature : '';
    aiMaxTok.value = adv.maxTokens !== undefined && adv.maxTokens !== null ? adv.maxTokens : '';
    aiEffort.value = adv.reasoningEffort || '';
    aiExtra.value = adv.extraBody || '';
    aiKey.type = 'password';
    setAiStatus('');
    aiEditor.hidden = false;
    aiEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    aiName.focus();
  }

  function closeAiEditor() {
    aiEditor.hidden = true;
    aiEditingId = null;
  }

  /** 保存配置（新增或更新） */
  function saveProfile() {
    const form = readAiForm();
    if (!form.baseURL || !form.apiKey || !form.model) {
      setAiStatus('请填写完整的 API 地址、Key 与模型名', 'err');
      return;
    }
    let profiles;
    if (aiEditingId) {
      profiles = aiProfiles.map((p) => p.id === aiEditingId ? Object.assign({}, p, form) : p);
    } else {
      const np = Object.assign({ id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }, form);
      if (!np.name) np.name = '配置 ' + (aiProfiles.length + 1);
      profiles = aiProfiles.concat(np);
      if (!aiActiveId) aiActiveId = np.id; // 首个配置自动启用
    }
    aiProfiles = profiles;
    window.pet.saveAiConfig({ profiles, activeProfileId: aiActiveId, systemPrompt: aiPrompt.value.trim() });
    setAiStatus('配置已保存' + (aiEditingId ? '' : '，' + (profiles.length === 1 ? '已自动启用' : '')), 'ok');
    closeAiEditor();
    renderProfileList();
  }

  /** 切换启用的配置 */
  function setActiveProfile(id) {
    if (!aiProfiles.some((p) => p.id === id)) return;
    aiActiveId = id;
    window.pet.saveAiConfig({ profiles: aiProfiles, activeProfileId: aiActiveId, systemPrompt: aiPrompt.value.trim() });
    renderProfileList();
  }

  /** 删除配置；若删除的是启用项，自动回退到第一项 */
  function deleteProfile(id) {
    const p = aiProfiles.find((x) => x.id === id);
    if (!p) return;
    if (!confirm('确定删除配置「' + (p.name || '未命名') + '」？')) return;
    aiProfiles = aiProfiles.filter((x) => x.id !== id);
    if (aiActiveId === id) aiActiveId = aiProfiles.length ? aiProfiles[0].id : null;
    if (aiEditingId === id) closeAiEditor();
    window.pet.saveAiConfig({ profiles: aiProfiles, activeProfileId: aiActiveId, systemPrompt: aiPrompt.value.trim() });
    renderProfileList();
  }

  /** 从主进程加载配置面板 */
  async function loadAiPanel() {
    try {
      const cfg = await window.pet.getAiConfig();
      aiProfiles = cfg.profiles || [];
      aiActiveId = cfg.activeProfileId || (aiProfiles.length ? aiProfiles[0].id : null);
      aiPrompt.value = cfg.systemPrompt || '';
      aiCtx.value = cfg.maxContextMessages || 20;
      renderProfileList();
    } catch (e) {
      console.warn('[settings] AI 配置读取失败:', e.message);
    }
  }

  aiAddBtn.addEventListener('click', () => openAiEditor(null));
  aiSaveBtn.addEventListener('click', saveProfile);
  aiCancelBtn.addEventListener('click', closeAiEditor);

  // 高级设置折叠展开
  aiAdvToggle.addEventListener('click', () => {
    const show = aiAdvBody.hidden;
    aiAdvBody.hidden = !show;
    aiAdvToggle.classList.toggle('open', show);
  });

  aiTestBtn.addEventListener('click', async () => {
    const form = readAiForm();
    if (!form.baseURL || !form.apiKey || !form.model) {
      setAiStatus('请先填写完整的 API 地址、Key 与模型名', 'err');
      return;
    }
    aiTestBtn.disabled = true;
    setAiStatus('正在测试连接…');
    try {
      // 直接测试表单中的配置（未保存也能验证，高级参数一并生效）
      const r = await window.pet.testAi({ baseURL: form.baseURL, apiKey: form.apiKey, model: form.model, advanced: form.advanced });
      setAiStatus(r.message, r.ok ? 'ok' : 'err');
    } catch (e) {
      setAiStatus('测试出错：' + e.message, 'err');
    }
    aiTestBtn.disabled = false;
  });

  document.getElementById('ai-prompt-save').addEventListener('click', () => {
    const ctx = parseInt(aiCtx.value, 10);
    const maxContextMessages = Number.isFinite(ctx) && ctx > 0 ? ctx : 20;
    window.pet.saveAiConfig({
      profiles: aiProfiles,
      activeProfileId: aiActiveId,
      systemPrompt: aiPrompt.value.trim(),
      maxContextMessages,
    });
    setAiPromptStatus('全局设置已保存', 'ok');
  });

  // 👁 显示/隐藏 API Key
  document.getElementById('ai-key-toggle').addEventListener('click', () => {
    const show = aiKey.type === 'password';
    aiKey.type = show ? 'text' : 'password';
    aiKey.focus();
  });

  /* ---------- 对话历史 ---------- */

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return '';
    }
  }

  /** 渲染全部对话历史（当前会话高亮） */
  async function renderChatHistory() {
    const box = document.getElementById('chat-history');
    try {
      const data = await window.pet.getChatHistory();
      const sessions = data.sessions || [];
      if (!sessions.length) {
        box.innerHTML = '<div class="chat-empty">暂无对话记录</div>';
        return;
      }
      box.innerHTML = sessions.map((s, i) => {
        const active = s.id === data.activeSessionId ? ' active-session' : '';
        const msgsHtml = (s.messages || []).length
          ? s.messages.map((m) =>
              '<div class="history-msg ' + m.role + '">' +
              (m.image ? '<img class="history-msg-img" src="' + m.image + '" alt="图片">' : '') +
              (m.text ? '<span>' + escapeHtml(m.text) + '</span>' : '') +
              '</div>'
            ).join('')
          : '<div class="history-msg-empty">空对话</div>';
        return '<div class="history-session' + active + (active ? '' : ' switchable') + '" data-id="' + s.id + '">' +
          '<div class="history-session-head">' +
          '<span class="history-session-title">对话 ' + (i + 1) + (active ? ' · 当前' : '') + '</span>' +
          '<span class="history-session-actions">' +
          '<span class="history-session-time">' + fmtTime(s.createdAt) + '</span>' +
          '<button class="history-del" data-id="' + s.id + '" title="删除此会话">✕</button>' +
          '</span>' +
          '</div>' +
          '<div class="history-session-body">' + msgsHtml + '</div>' +
          '</div>';
      }).join('');
      // 绑定删除按钮
      box.querySelectorAll('.history-del').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('确定删除这个会话？此操作不可恢复。')) return;
          window.pet.deleteChatSession(btn.dataset.id);
          renderChatHistory();
        });
      });
      // 点击会话卡片（非当前）→ 切换为当前对话
      box.querySelectorAll('.history-session.switchable').forEach((card) => {
        card.addEventListener('click', () => {
          window.pet.switchChatSession(card.dataset.id);
          renderChatHistory();
        });
      });
    } catch (e) {
      box.innerHTML = '<div class="chat-empty">历史加载失败</div>';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.getElementById('btn-clear-chat').addEventListener('click', () => {
    if (!confirm('确定清空全部对话历史？此操作不可恢复。')) return;
    window.pet.clearChatHistory();
    renderChatHistory();
  });

  /* ---------- 关于皮肤 ---------- */

  function renderSkinAbout(skins) {
    const skin = skins && skins[0];
    const rows = [
      ['皮肤', skin ? skin.name : '未加载'],
      ['作者', skin ? skin.author || '—' : '—'],
      ['版本', skin ? skin.version : '—'],
      ['素材来源', skin ? skin.source || '—' : '—'],
      ['状态数', skin ? Object.keys(skin.states || {}).length + ' 个' : '—'],
    ];
    document.getElementById('about-skin-info').innerHTML = rows.map(([label, value]) =>
      '<div class="about-row"><span class="about-label">' + label + '</span>' +
      '<span class="about-value">' + value + '</span></div>'
    ).join('');
  }

  /* ---------- 关于 PetAI ---------- */

  function renderAppAbout() {
    window.pet.getAppInfo().then((info) => {
      document.getElementById('app-about-name').textContent = info.name || 'PetAI';
      document.getElementById('app-about-desc').textContent = info.description || 'AI 桌面宠物';
      document.getElementById('app-about-version').textContent = 'v' + (info.version || '—');
      const rows = [
        ['作者', info.author || '—'],
        ['主页', info.homepage || '—'],
      ];
      const aboutAppInfo = document.getElementById('about-app-info');
      // 只重建作者 / 主页行；版本行（含更新按钮）保持原位，避免丢失点击事件
      Array.from(aboutAppInfo.querySelectorAll('.about-row:not(.about-row-version)')).forEach((el) => el.remove());
      rows.forEach(([label, value]) => {
        const div = document.createElement('div');
        div.className = 'about-row';
        div.innerHTML = '<span class="about-label">' + label + '</span>' +
          '<span class="about-value about-value-link">' + value + '</span>';
        aboutAppInfo.appendChild(div);
      });
      // 主页行可点击，在浏览器打开 GitHub 主页
      const homepageRow = aboutAppInfo.children[2];
      if (homepageRow) {
        homepageRow.classList.add('about-row-clickable');
        homepageRow.addEventListener('click', () => {
          if (info.homepage) window.pet.openExternal(info.homepage);
        });
      }
      document.getElementById('btn-open-repo').addEventListener('click', () => {
        if (info.repo) window.pet.openExternal(info.repo);
      });
    }).catch((e) => {
      console.warn('[settings] 应用信息读取失败:', e.message);
    });
  }

  /* ---------- 自动更新 ---------- */

  const updateBtn = document.getElementById('btn-update');
  let updateInfo = null; // 最近一次检查结果

  function setUpdateBtn(text, opts) {
    opts = opts || {};
    updateBtn.textContent = text;
    updateBtn.disabled = !!opts.disabled;
    updateBtn.className = 'update-btn' + (opts.cls ? ' ' + opts.cls : '');
    if (opts.title) updateBtn.title = opts.title;
  }

  /** 检查 GitHub 最新版本并更新按钮状态 */
  async function checkUpdate() {
    setUpdateBtn('检查中…', { disabled: true });
    try {
      const r = await window.pet.checkUpdate();
      if (!r || !r.ok) {
        setUpdateBtn('检查更新', { title: (r && r.message) || '检查失败' });
        return;
      }
      updateInfo = r;
      if (r.hasUpdate) {
        setUpdateBtn('下载 v' + r.latest, { cls: 'has-update', title: '发现新版本 v' + r.latest + '，点击下载并自动安装' });
      } else {
        setUpdateBtn('已是最新', { disabled: true });
        setTimeout(() => setUpdateBtn('检查更新'), 2500);
      }
    } catch (e) {
      setUpdateBtn('检查更新', { title: '检查失败：' + (e && e.message) });
    }
  }

  updateBtn.addEventListener('click', () => {
    if (updateInfo && updateInfo.hasUpdate && updateInfo.url) {
      // 有新版：开始下载
      updateBtn.disabled = true;
      updateBtn.classList.add('downloading');
      updateBtn.textContent = '下载中 0%';
      window.pet.downloadUpdate(updateInfo.url);
    } else {
      checkUpdate();
    }
  });

  window.pet.onUpdateProgress((pct) => {
    updateBtn.textContent = '下载中 ' + pct + '%';
  });
  window.pet.onUpdateDone(() => {
    setUpdateBtn('安装中…', { disabled: true });
  });
  window.pet.onUpdateError((msg) => {
    setUpdateBtn('下载失败', { title: msg });
    setTimeout(() => setUpdateBtn('检查更新'), 3000);
  });

  /* ---------- 提醒面板（番茄钟 + 每日闹钟） ---------- */

  const pomodoroTime = document.getElementById('pomodoro-time');
  const pomodoroDuration = document.getElementById('pomodoro-duration');
  const pomodoroStart = document.getElementById('pomodoro-start');
  const pomodoroStop = document.getElementById('pomodoro-stop');
  const alarmList = document.getElementById('alarm-list');
  const alarmTime = document.getElementById('alarm-time');
  const alarmLabel = document.getElementById('alarm-label');

  let alarmTimer = null;

  function fmtRemain(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderReminderState(state) {
    if (!state) return;
    const p = state.pomodoro || {};
    document.getElementById('pomodoro-card').classList.toggle('running', !!p.running);
    if (p.running) {
      pomodoroTime.textContent = fmtRemain(p.remainSec || 0);
      pomodoroStart.hidden = true;
      pomodoroStop.hidden = false;
      pomodoroDuration.disabled = true;
    } else {
      pomodoroTime.textContent = '--:--';
      pomodoroStart.hidden = false;
      pomodoroStop.hidden = true;
      pomodoroDuration.disabled = false;
    }
    renderAlarmList(state.alarms || []);
  }

  let alarmItems = []; // 缓存列表，供 toggle 取当前状态
  let pendingDeleteId = null;  // 待确认删除的闹钟 id
  let pendingDeleteTimer = null;

  function renderAlarmList(alarms) {
    if (!alarms.length) {
      alarmList.innerHTML = '<div class="ai-profile-empty">暂无闹钟，添加一个试试吧</div>';
      return;
    }
    alarmList.innerHTML = alarms.map((a) =>
      '<div class="alarm-item' + (a.enabled ? '' : ' off') + '" data-id="' + a.id + '">' +
        '<span class="alarm-item-time">' + escapeHtml(a.time) + '</span>' +
        '<span class="alarm-item-label">' + escapeHtml(a.label || '提醒') + '</span>' +
        '<button class="alarm-item-toggle" data-act="toggle" title="启用/停用">' + (a.enabled ? '开' : '关') + '</button>' +
        '<button class="alarm-item-del' + (pendingDeleteId === a.id ? ' confirming' : '') + '" data-act="del" title="删除">' +
          (pendingDeleteId === a.id ? '确认？' : '✕') +
        '</button>' +
      '</div>'
    ).join('');
    alarmList.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.alarm-item').dataset.id;
        if (btn.dataset.act === 'del') {
          // 二次点击确认：第一次变"确认？"，3 秒内再点才删除，避免误删
          if (pendingDeleteId === id) {
            pendingDeleteId = null;
            clearTimeout(pendingDeleteTimer);
            window.pet.removeAlarm(id);
          } else {
            pendingDeleteId = id;
            clearTimeout(pendingDeleteTimer);
            pendingDeleteTimer = setTimeout(() => { pendingDeleteId = null; }, 3000);
            renderAlarmList(alarms); // 立即重渲染按钮文字
          }
        } else {
          const cur = alarmItems.find((x) => x.id === id);
          window.pet.toggleAlarm(id, !(cur && cur.enabled));
        }
      });
    });
  }

  /** 每秒刷新番茄钟剩余时间 */
  function pollReminder() {
    clearInterval(alarmTimer);
    alarmTimer = setInterval(async () => {
      try {
        const state = await window.pet.getReminderState();
        renderReminderState(state);
        alarmItems = (state && state.alarms) || [];
      } catch (e) { /* ignore */ }
    }, 1000);
  }

  pomodoroStart.addEventListener('click', () => {
    const min = parseInt(pomodoroDuration.value, 10) || 25;
    window.pet.startPomodoro(min);
  });
  pomodoroStop.addEventListener('click', () => window.pet.stopPomodoro());

  document.getElementById('alarm-add').addEventListener('click', () => {
    const time = alarmTime.value.trim();
    const label = alarmLabel.value.trim();
    if (!/^\d{2}:\d{2}$/.test(time || '')) {
      alarmTime.classList.add('invalid');
      alarmTime.focus();
      return;
    }
    alarmTime.classList.remove('invalid');
    window.pet.addAlarm(time, label);
    alarmLabel.value = '';
    alarmLabel.focus(); // 添加成功后聚焦描述框，方便连续添加
  });
  alarmTime.addEventListener('input', () => alarmTime.classList.remove('invalid'));

  window.pet.onReminderUpdated((state) => renderReminderState(state));

  /* ---------- 称呼（对话面板） ---------- */

  const userNameInput = document.getElementById('user-name');
  const userNameStatus = document.getElementById('user-name-status');

  async function loadUserName() {
    try {
      const prefs = await window.pet.getPrefs();
      userNameInput.value = (prefs && prefs.userName) || '';
    } catch (e) { /* ignore */ }
  }

  document.getElementById('save-user-name').addEventListener('click', () => {
    window.pet.setPrefs({ userName: userNameInput.value.trim() });
    userNameStatus.textContent = '已保存，新对话生效';
    userNameStatus.className = 'ai-status ok';
  });

  /* ---------- 陪伴记录（关于 PetAI） ---------- */

  async function loadCompanionStats() {
    const box = document.getElementById('companion-stats');
    try {
      const c = await window.pet.getCompanionStats();
      const days = Math.max(1, Math.floor((Date.now() - (c.firstSeen || Date.now())) / 86400000) + 1);
      const firstDate = new Date(c.firstSeen || Date.now());
      const firstKey = firstDate.getFullYear() + '年' + (firstDate.getMonth() + 1) + '月' + firstDate.getDate() + '日';
      box.innerHTML =
        '<div class="companion-stat"><span>陪伴天数</span><b>' + days + ' 天</b></div>' +
        '<div class="companion-stat"><span>互动次数</span><b>' + (c.interactions || 0) + ' 次</b></div>' +
        '<div class="companion-stat"><span>对话条数</span><b>' + (c.chats || 0) + ' 条</b></div>' +
        '<div class="companion-stat"><span>初次见面</span><b>' + firstKey + '</b></div>';
    } catch (e) {
      box.textContent = '记录加载失败';
    }
  }

  /* ---------- 状态同步 ---------- */

  /** 刷新开关状态（初始化 / 切换后） */
  async function refreshState() {
    try {
      const state = await window.pet.getSettingsState();
      swVisible.setAttribute('aria-checked', String(!!state.petVisible));
      swTop.setAttribute('aria-checked', String(!!state.alwaysOnTop));
      swAuto.setAttribute('aria-checked', String(!!state.autoPose));
      swSilent.setAttribute('aria-checked', String(!!state.silentMode));
      highlightPose(state.currentState || 'idle');
    } catch (e) {
      console.warn('[settings] 读取状态失败:', e.message);
    }
  }

  /* ---------- 交互 ---------- */

  swVisible.addEventListener('click', () => {
    const next = swVisible.getAttribute('aria-checked') !== 'true';
    swVisible.setAttribute('aria-checked', String(next)); // 乐观更新
    window.pet.togglePetVisible();
    setTimeout(refreshState, 150);
  });

  swTop.addEventListener('click', () => {
    const next = swTop.getAttribute('aria-checked') !== 'true';
    swTop.setAttribute('aria-checked', String(next));
    window.pet.setAlwaysOnTop(next);
  });

  swAuto.addEventListener('click', () => {
    const next = swAuto.getAttribute('aria-checked') !== 'true';
    swAuto.setAttribute('aria-checked', String(next));
    window.pet.setAutoPose(next);
  });

  swSilent.addEventListener('click', () => {
    const next = swSilent.getAttribute('aria-checked') !== 'true';
    swSilent.setAttribute('aria-checked', String(next));
    window.pet.setSilentMode(next);
  });

  btnClose.addEventListener('click', () => window.pet.closeSettings());
  btnQuit.addEventListener('click', () => window.pet.quit());

  // 重置窗口大小（显示面板）
  document.getElementById('btn-reset-size').addEventListener('click', () => window.pet.resize('reset'));

  /* ---------- 初始化 ---------- */
  window.pet.onStateChange((state) => highlightPose(state));

  async function init() {
    await refreshState();
    loadAiPanel();
    pollReminder();
    loadUserName();
    loadCompanionStats();
    try {
      const skins = await window.pet.getSkins();
      buildPoseGrid(skins);
      renderSkinAbout(skins);
      renderAppAbout();
      renderChatHistory();
      await refreshState(); // 皮肤就绪后再次对齐高亮
    } catch (e) {
      console.warn('[settings] 皮肤加载失败:', e.message);
    }
  }

  init();
})();
