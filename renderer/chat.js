/**
 * AI 桌面宠物 — 聊天对话框
 * 职责：hover 显示/隐藏、会话管理（新对话）、历史恢复与记录、图片附件（多模态）、AI 流式对话
 */
(function () {
  'use strict';

  const panel = document.getElementById('chat-panel');
  const msgs = document.getElementById('chat-msgs');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const sessionNum = document.getElementById('session-num');
  const newSessionBtn = document.getElementById('new-session-btn');

  const attachBtn = document.getElementById('attach-btn');
  const captureBtn = document.getElementById('capture-btn');
  const fileInput = document.getElementById('file-input');
  const attachPreview = document.getElementById('attach-preview');
  const attachThumb = document.getElementById('attach-thumb');
  const attachRemove = document.getElementById('attach-remove');

  let waiting = false; // 是否正在等待 AI 回复
  let replyEl = null;  // 当前流式渲染中的回复气泡
  let pendingImage = null; // 待发送图片 data URL

  /* ---------- hover 显示/隐藏 ---------- */
  window.pet.onChatHover((inside) => {
    panel.classList.toggle('show', inside);
  });

  /* ---------- 消息 ---------- */

  function addMsg(text, who, image) {
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    if (image) {
      const img = document.createElement('img');
      img.className = 'msg-img';
      img.src = image;
      img.alt = '图片';
      div.appendChild(img);
    }
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      div.appendChild(span);
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showWelcome() {
    addMsg('你好呀，我是蕾米～ 有什么想聊的？', 'bot');
  }

  /* ---------- 姿势联动（复用主进程 pet:set-pose → 宠物窗口） ---------- */
  function setPose(state) {
    try { window.pet.setPose(state); } catch (e) { /* ignore */ }
  }
  // 对话情绪延续：发送时切 thinking、完成后切 task_done，
  // 宠物窗口内根据收到的状态自动锁定自主动作调度，保持情绪一段时间再自然回归（见 app.js）。

  /* ---------- 图片附件 ---------- */

  /** 压缩图片：最长边限制 1024，JPEG 质量 0.82，返回 data URL */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败'));
        img.onload = () => {
          const MAX = 1024;
          let { width, height } = img;
          if (Math.max(width, height) > MAX) {
            const scale = MAX / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function setPendingImage(dataUrl) {
    pendingImage = dataUrl;
    if (dataUrl) {
      attachThumb.src = dataUrl;
      attachPreview.hidden = false;
    } else {
      attachThumb.removeAttribute('src');
      attachPreview.hidden = true;
    }
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    const file = files[0];
    if (!file.type || !file.type.startsWith('image/')) {
      // 非图片文件：OpenAI 兼容接口无标准文件格式
      addMsg('（当前仅支持图片附件哦，文件请直接文字描述）', 'bot');
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      setPendingImage(dataUrl);
    } catch (e) {
      addMsg('图片处理失败：' + e.message, 'bot');
    }
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
  attachRemove.addEventListener('click', () => setPendingImage(null));

  // 🖥 识别当前屏幕：截屏后直接发送给 AI
  captureBtn.addEventListener('click', async () => {
    if (waiting) return;
    try {
      const r = await window.pet.captureScreen();
      if (!r.ok) {
        addMsg('截屏失败：' + (r.message || '未知错误'), 'bot');
        return;
      }
      const text = '（屏幕截图，请帮我看看屏幕上的内容）';
      addMsg(text, 'user', r.image);
      waiting = true;
      sendBtn.disabled = true;
      setPose('thinking');
      const replyEl_ = addMsg('…', 'bot');
      replyEl = replyEl_;
      window.pet.sendAi(text, r.image);
    } catch (e) {
      addMsg('截屏失败：' + e.message, 'bot');
    }
  });

  // 粘贴图片
  input.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFiles([file]);
        return;
      }
    }
  });

  /* ---------- AI 流式对话 ---------- */

  function streamInto(el, text) {
    el.textContent = text;
    msgs.scrollTop = msgs.scrollHeight;
  }

  function send() {
    const text = input.value.trim();
    if ((!text && !pendingImage) || waiting) return;
    input.value = '';
    const img = pendingImage || undefined;
    addMsg(text, 'user', img);
    setPendingImage(null);

    waiting = true;
    sendBtn.disabled = true;
    setPose('thinking');

    const replyEl_ = addMsg('…', 'bot');
    replyEl = replyEl_;
    window.pet.sendAi(text, img);
  }

  window.pet.onAiStart(() => {
    streamInto(replyEl, '');
  });

  window.pet.onAiDelta((delta) => {
    streamInto(replyEl, (replyEl.textContent || '') + delta);
  });

  window.pet.onAiEnd((full) => {
    streamInto(replyEl, full || '（空回复）');
    waiting = false;
    sendBtn.disabled = false;
    setPose('task_done'); // 完成任务姿态
    input.focus();
  });

  window.pet.onAiError((msg) => {
    streamInto(replyEl, '出错了：' + msg);
    waiting = false;
    sendBtn.disabled = false;
    setPose('idle');
  });

  /* ---------- 会话管理 ---------- */

  async function refreshSessionNum() {
    try {
      const state = await window.pet.getChatState();
      const idx = (state.sessions || []).findIndex((s) => s.id === state.activeSessionId);
      sessionNum.textContent = String(Math.max(idx, 0) + 1);
    } catch (e) { /* ignore */ }
  }

  async function restoreHistory() {
    try {
      const data = await window.pet.getChatHistory();
      const active = (data.sessions || []).find((s) => s.id === data.activeSessionId);
      if (active && active.messages && active.messages.length) {
        active.messages.forEach((m) => addMsg(m.text, m.role === 'user' ? 'user' : 'bot', m.image));
      } else {
        showWelcome();
      }
    } catch (e) {
      showWelcome();
    }
    refreshSessionNum();
  }

  function newSession() {
    if (waiting) return;
    msgs.innerHTML = '';
    setPendingImage(null);
    window.pet.newChatSession();
    showWelcome();
    refreshSessionNum();
    input.focus();
  }

  /* ---------- 事件绑定 ---------- */
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) send();
  });
  newSessionBtn.addEventListener('click', newSession);

  // 当前会话被删除时（设置 → 对话），重新加载
  window.pet.onSessionChanged(() => {
    if (waiting) return;
    msgs.innerHTML = '';
    restoreHistory();
  });

  /* ---------- 启动 ---------- */
  restoreHistory();
})();
