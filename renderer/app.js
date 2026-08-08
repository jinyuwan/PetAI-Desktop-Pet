/**
 * AI 桌面宠物 — 渲染进程
 * 职责：加载皮肤（skin.json 规范）、工作状态机（供 AI 驱动）、窗口拖拽
 * 状态栏 UI 已移除：接入 AI 后由 AI 实时行为自动切换状态（见 window.petAPI）
 */
(function () {
  'use strict';

  const playerEl = document.getElementById('player-container');
  const statusTip = document.getElementById('status-tip');

  let player = null;       // spine-player 实例
  let currentSkin = null;  // 当前皮肤元数据
  let currentState = 'idle';
  let autoPose = true;     // 跟随 AI：自动模式（与设置窗口同步）

  /* ---------- 自主动作调度器（让宠物"活"起来） ---------- */
  // 空闲时按权重随机播放小动作，动作结束后自然回归 idle。
  // 所有自动切换都走 setState（非 manual），手动锁定模式（autoPose=false）下自动被忽略。

  /** 动作表：状态名 / 权重 / 播放时长范围（秒） */
  const ACTIONS = [
    { state: 'idle', weight: 40, min: 8, max: 20 },     // 发呆（基底）
    { state: 'thinking', weight: 24, min: 5, max: 13 }, // 思考
    { state: 'reading', weight: 15, min: 5, max: 13 },  // 看书
    { state: 'planning', weight: 11, min: 4, max: 11 }, // 准备计划
    { state: 'working', weight: 10, min: 6, max: 16 },  // 工作中
  ];

  let actionTimer = null;      // 动作调度定时器
  let actionHoldTimer = null;  // 动作保持定时器（到点回 idle）
  let interactionLock = 0;     // 交互锁定截止时间戳（对话/点击期间不自动动作）

  /** 按权重随机选一个动作 */
  function pickAction() {
    const total = ACTIONS.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * total;
    for (const a of ACTIONS) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return ACTIONS[0];
  }

  /** 播放一个自主动作：持续 min~max 秒后回 idle */
  function playAction() {
    if (!player || !autoPose) return;
    if (Date.now() < interactionLock) return; // 交互期间不打扰
    clearTimeout(actionHoldTimer);
    const a = pickAction();
    setState(a.state);
    const holdMs = (a.min + Math.random() * (a.max - a.min)) * 1000;
    actionHoldTimer = setTimeout(() => {
      if (Date.now() >= interactionLock) setState('idle');
    }, holdMs);
  }

  /** 启动自主动作调度：每 6~14 秒决定一次动作 */
  function startAutoActions() {
    stopAutoActions();
    const tick = () => {
      playAction();
      actionTimer = setTimeout(tick, 6000 + Math.random() * 8000);
    };
    tick();
  }

  function stopAutoActions() {
    if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
    if (actionHoldTimer) { clearTimeout(actionHoldTimer); actionHoldTimer = null; }
  }

  /** 交互锁定：锁定期内调度器不动作（对话 / 点击反馈用） */
  function lockInteraction(ms) {
    interactionLock = Date.now() + ms;
  }

  /* ---------- 状态机 ---------- */

  /** 解析某状态对应的动画名：states → extraStates → idle 兜底 */
  function resolveAnimation(state) {
    if (!currentSkin) return state;
    if (currentSkin.states && currentSkin.states[state]) return currentSkin.states[state];
    if (currentSkin.extraStates && currentSkin.extraStates[state]) return currentSkin.extraStates[state];
    if (currentSkin.states && currentSkin.states.idle) return currentSkin.states.idle;
    return state;
  }

  /**
   * 切换工作状态（供 AI / 交互模块调用）
   * @param {string} state  目标状态
   * @param {object} [opts] opts.manual=true 表示用户手动指定（忽略自动模式锁定）
   */
  function setState(state, opts) {
    if (!player) return;
    const manual = !!(opts && opts.manual);
    // 手动锁定模式（跟随 AI 关闭）：忽略 AI/状态机的自动切换
    if (!manual && !autoPose) {
      console.log('[pet] 手动锁定姿势，忽略自动切换 →', state);
      return;
    }
    currentState = state;
    const anim = resolveAnimation(state);
    player.setAnimation(anim, true);
    console.log('[pet] state →', state, '| animation →', anim);
    // 通知主进程，同步设置窗口的姿势高亮
    if (window.pet && typeof window.pet.notifyState === 'function') {
      window.pet.notifyState(state);
    }
  }

  /** 供外部（AI 对话模块）使用 */
  window.petAPI = {
    setState,
    getState: () => currentState,
    getAvailableStates: () => {
      const s = currentSkin || {};
      return Object.keys(s.states || {}).concat(Object.keys(s.extraStates || {}));
    },
    /** 发送对话（阶段 2 接入 LLM；当前为占位，供右键输入框调用） */
    sendMessage: (text) => {
      console.log('[pet] 对话消息(待接入AI):', text);
      showTip('AI 对话尚未接入，消息已记录');
    },
  };

  /* ---------- 皮肤加载 ---------- */

  function showTip(msg) {
    statusTip.textContent = msg;
    statusTip.classList.remove('hidden');
  }

  async function loadSkin(skin) {
    currentSkin = skin;

    try {
      player = new spine.SpinePlayer(playerEl, {
        jsonUrl: '../skins/' + skin.id + '/' + skin.spine.skeleton,
        atlasUrl: '../skins/' + skin.id + '/' + skin.spine.atlas,
        pngUrl: '../skins/' + skin.id + '/' + skin.spine.png,
        animation: resolveAnimation('idle'),
        skin: undefined,
        backgroundColor: '#00000000',
        alpha: true,
        showControls: false,
        showLoading: true,
        viewport: { padLeft: '4%', padRight: '4%', padTop: '2%', padBottom: '4%' },
        success: (p) => {
          player = p;
          setState('idle');
        },
        error: (p, reason) => {
          showTip('皮肤加载失败：' + (reason && reason.message ? reason.message : reason));
        },
      });
    } catch (e) {
      showTip('皮肤初始化异常：' + e.message);
    }
  }

  /* ---------- 手柄显示（主进程鼠标悬停检测） ---------- */
  const topBar = document.getElementById('top-bar');
  window.pet.startHoverWatch().then(() => {
    window.pet.onHoverChange((inside) => {
      topBar.classList.toggle('show', inside);
    });
  });

  /* ---------- 姿势切换（设置窗口 / AI 对话 → 主进程 → 本窗口） ---------- */
  window.pet.onSetPose((state) => {
    setState(state, { manual: true });
    // AI 对话情绪延续：思考期间锁 30s，完成/开心后锁 12s，期间自主动作不打扰
    if (state === 'thinking') lockInteraction(30000);
    else if (state === 'task_done') lockInteraction(12000);
  });

  // 跟随 AI 模式变化（设置窗口切换）
  window.pet.onAutoPoseChange((val) => {
    autoPose = !!val;
    console.log('[pet] 跟随 AI 模式 →', autoPose);
    if (autoPose) {
      startAutoActions();   // 恢复自主行为
    } else {
      stopAutoActions();    // 手动锁定：暂停自主行为
    }
  });

  /* ---------- 单击互动：轻点宠物给个开心反馈 ---------- */
  // 注意：宠物窗口整体是系统拖拽区，用 pointerdown/up + 位移/时长判定"轻点"，
  // 避免把真实拖动误判成点击。
  let pointerStart = null;
  window.addEventListener('pointerdown', (e) => {
    pointerStart = { x: e.screenX, y: e.screenY, t: Date.now() };
  });
  window.addEventListener('pointerup', (e) => {
    if (!pointerStart) return;
    const dx = e.screenX - pointerStart.x;
    const dy = e.screenY - pointerStart.y;
    const dt = Date.now() - pointerStart.t;
    pointerStart = null;
    // 位移 < 10px 且时长 < 400ms 才算"轻点"
    if (Math.hypot(dx, dy) < 10 && dt < 400) {
      console.log('[pet] 轻点宠物 → 开心回应');
      lockInteraction(3500);
      setState('task_done');
      setTimeout(() => setState('idle'), 3200); // 开心 3.2s 后自然回位
    }
  });

  /* ---------- 设置：手柄 ☰ 键打开设置窗口 ---------- */
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.pet.openSettings();
  });

  /* ---------- 窗口控制 ---------- */
  document.getElementById('btn-smaller').addEventListener('click', () => window.pet.resize(-1));
  document.getElementById('btn-larger').addEventListener('click', () => window.pet.resize(1));
  document.getElementById('btn-reset').addEventListener('click', () => window.pet.resize('reset'));
  document.getElementById('btn-quit').addEventListener('click', () => window.pet.quit());

  // 窗口 resize 防抖 250ms 后再通知 spine-player 适配画布
  // 关键：拖动窗口时 Windows 会对无边框透明窗口触发高频微小 resize，
  // 若不防抖，spine-player 反复重算 canvas 尺寸会累积放大（表现为"宠物越拖越大"）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (player && typeof player.resize === 'function') player.resize();
    }, 250);
  });

  /* ---------- 启动 ---------- */

  async function init() {
    try {
      // 同步初始自动模式状态
      window.pet.getSettingsState().then((s) => {
        if (s) {
          autoPose = !!s.autoPose;
          if (autoPose) startAutoActions(); // 皮肤就绪前先启动，playAction 内会兜底
        }
      }).catch(() => {});
      const skins = await window.pet.getSkins();
      if (!skins.length) {
        showTip('未找到皮肤（skins/ 目录为空）');
        return;
      }
      await loadSkin(skins[0]);
    } catch (e) {
      showTip('初始化失败：' + e.message);
    }
  }

  init();
})();
