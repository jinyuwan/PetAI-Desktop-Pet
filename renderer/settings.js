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

  /* ---------- AI 配置面板 ---------- */

  const aiBase = document.getElementById('ai-base');
  const aiKey = document.getElementById('ai-key');
  const aiModel = document.getElementById('ai-model');
  const aiPrompt = document.getElementById('ai-prompt');
  const aiStatus = document.getElementById('ai-status');
  const aiTestBtn = document.getElementById('ai-test');
  const aiSaveBtn = document.getElementById('ai-save');

  function setAiStatus(msg, type) {
    aiStatus.textContent = msg;
    aiStatus.className = 'ai-status' + (type ? ' ' + type : '');
  }

  function readAiForm() {
    return {
      baseURL: aiBase.value.trim(),
      apiKey: aiKey.value.trim(),
      model: aiModel.value.trim(),
      systemPrompt: aiPrompt.value.trim(),
    };
  }

  async function loadAiForm() {
    try {
      const cfg = await window.pet.getAiConfig();
      aiBase.value = cfg.baseURL || '';
      aiKey.value = cfg.apiKey || '';
      aiModel.value = cfg.model || '';
      aiPrompt.value = cfg.systemPrompt || '';
    } catch (e) {
      console.warn('[settings] AI 配置读取失败:', e.message);
    }
  }

  aiTestBtn.addEventListener('click', async () => {
    window.pet.saveAiConfig(readAiForm()); // 测试前先落盘，保证用最新配置
    aiTestBtn.disabled = true;
    setAiStatus('正在测试连接…');
    try {
      const r = await window.pet.testAi();
      setAiStatus(r.message, r.ok ? 'ok' : 'err');
    } catch (e) {
      setAiStatus('测试出错：' + e.message, 'err');
    }
    aiTestBtn.disabled = false;
  });

  aiSaveBtn.addEventListener('click', () => {
    window.pet.saveAiConfig(readAiForm());
    setAiStatus('配置已保存', 'ok');
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

  /* ---------- 关于面板 ---------- */

  function renderAbout(skins) {
    const skin = skins && skins[0];
    const rows = [
      ['皮肤', skin ? skin.name : '未加载'],
      ['作者', skin ? skin.author || '—' : '—'],
      ['版本', skin ? skin.version : '—'],
      ['素材来源', skin ? skin.source || '—' : '—'],
      ['状态数', skin ? Object.keys(skin.states || {}).length + ' 个' : '—'],
    ];
    document.getElementById('about-info').innerHTML = rows.map(([label, value]) =>
      '<div class="about-row"><span class="about-label">' + label + '</span>' +
      '<span class="about-value">' + value + '</span></div>'
    ).join('');
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

  /* ---------- 初始化 ---------- */
  window.pet.onStateChange((state) => highlightPose(state));

  async function init() {
    await refreshState();
    loadAiForm();
    try {
      const skins = await window.pet.getSkins();
      buildPoseGrid(skins);
      renderAbout(skins);
      renderChatHistory();
      await refreshState(); // 皮肤就绪后再次对齐高亮
    } catch (e) {
      console.warn('[settings] 皮肤加载失败:', e.message);
    }
  }

  init();
})();
