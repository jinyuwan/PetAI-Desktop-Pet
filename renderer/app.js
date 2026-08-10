/**
 * AI 桌面宠物 — 渲染进程
 * 职责：加载皮肤（skin.json 规范）、工作状态机（供 AI 驱动）、窗口拖拽
 * 状态栏 UI 已移除：接入 AI 后由 AI 实时行为自动切换状态（见 window.petAPI）
 */
(function () {
  'use strict';

  const playerEl = document.getElementById('player-container');
  const statusTip = document.getElementById('status-tip');
  const bubbleEl = document.getElementById('bubble');
  const bubbleEmoji = document.getElementById('bubble-emoji');
  const bubbleText = document.getElementById('bubble-text');

  let player = null;       // spine-player 实例
  let currentSkin = null;  // 当前皮肤元数据
  let skinLoadToken = 0;   // 皮肤加载序列号：连续切换时丢弃迟到的旧回调
  let currentState = 'idle';
  let autoPose = true;     // 跟随 AI：自动模式（与设置窗口同步）
  let isSleeping = false;  // 打盹中（长时间无互动）
  let lastIdleMinutes = 0; // 最近一次空闲分钟数（主进程推送）

  /** 当前宠物名：皮肤 petName → 皮肤名 → 「蕾米」 */
  function petName() {
    return (currentSkin && currentSkin.petName) || '蕾米';
  }

  /* ---------- 气泡 ---------- */

  let bubbleTimer = null;

  /** 在宠物上方弹出气泡，duration 毫秒后自动消失 */
  function showBubble(emoji, text, duration) {
    bubbleEmoji.textContent = emoji || '';
    bubbleText.textContent = text || '';
    bubbleEl.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), duration || 3500);
  }

  /* ---------- 自主动作调度器（让宠物"活"起来） ---------- */
  // 空闲时按权重随机播放小动作，动作结束后自然回归基准姿态。
  // 所有自动切换都走 setState（非 manual），手动锁定模式（autoPose=false）下自动被忽略。

  /* ---------- 姿态解析（姿态名由皮肤自定义，无内置默认姿态） ---------- */

  /** 当前皮肤的全部姿态名（states + extraStates 合并去重，保持声明顺序） */
  function getPoseNames() {
    const s = currentSkin || {};
    const out = [];
    const seen = {};
    [s.states, s.extraStates].forEach((map) => {
      if (!map) return;
      Object.keys(map).forEach((k) => {
        if (!seen[k]) { seen[k] = 1; out.push(k); }
      });
    });
    return out;
  }

  /**
   * 按关键词找姿态：姿态名由皮肤自定义，用语义关键词模糊匹配（不区分大小写）。
   * 找不到时 fallback 传 'first' 返回第一个姿态，否则返回空串。
   */
  function findPose(keywords, fallback) {
    const poses = getPoseNames();
    if (!poses.length) return '';
    for (const kw of keywords) {
      const hit = poses.find((p) => p.toLowerCase().includes(kw));
      if (hit) return hit;
    }
    return fallback === 'first' ? poses[0] : '';
  }

  /** 基准姿态：idle 类优先，否则第一个姿态 */
  function basePose() {
    return findPose(['idle', 'stand', '待机', '发呆'], 'first');
  }

  /** 随机动作姿态：只从 states（常规姿态）里挑，避免特殊大幅动作（extraStates）随机触发撕裂画面 */
  function randomActionPose() {
    const s = currentSkin || {};
    const base = basePose();
    // 候选池 = states 去掉基准姿态；states 为空时退化为全部姿态
    let pool = [];
    if (s.states && Object.keys(s.states).length) {
      pool = Object.keys(s.states).filter((p) => p !== base);
    } else {
      const poses = getPoseNames();
      pool = base ? poses.filter((p) => p !== base) : poses;
    }
    if (!pool.length) pool = base ? [base] : [];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  let actionTimer = null;      // 动作调度定时器
  let actionHoldTimer = null;  // 动作保持定时器（到点回基准姿态）
  let interactionLock = 0;     // 交互锁定截止时间戳（对话/点击期间不自动动作）

  /** 播放一个自主动作：随机挑一个姿态，持续 4~13 秒后回基准姿态 */
  function playAction() {
    if (!player || !autoPose) return;
    if (Date.now() < interactionLock) return; // 交互期间不打扰
    const base = basePose();
    const act = randomActionPose();
    if (!act || act === base) return; // 无可换姿态 → 保持现状
    clearTimeout(actionHoldTimer);
    setState(act);
    const holdMs = 4000 + Math.random() * 9000;
    actionHoldTimer = setTimeout(() => {
      if (Date.now() >= interactionLock && base) setState(base);
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

  /** 解析某姿态对应的动画名：states → extraStates → 基准姿态 → 第一个姿态 兜底 */
  function resolveAnimation(state) {
    if (!currentSkin) return state;
    const maps = [currentSkin.states, currentSkin.extraStates].filter(Boolean);
    for (const map of maps) {
      if (map[state]) return map[state];
    }
    const base = basePose();
    if (base) {
      for (const map of maps) {
        if (map[base]) return map[base];
      }
    }
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
    getAvailableStates: () => getPoseNames(),
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
      // 关键：切换皮肤前销毁旧播放器实例并清空容器。
      // 注意：spine-player 4.2 的销毁方法是 dispose()，没有 destroy()！
      // 用 destroy() 判断永远为 false → 旧实例泄漏（rAF 循环 + WebGL 纹理/上下文不释放），
      // 连续切换后 WebGL 上下文耗尽，新皮肤创建失败
      if (player) {
        try {
          if (typeof player.dispose === 'function') player.dispose();
          else if (typeof player.destroy === 'function') player.destroy();
        } catch (e) { /* ignore */ }
        player = null;
      }
      if (playerEl) playerEl.innerHTML = '';

      // 连续切换保护：每次加载生成新 token，
      // 旧加载的 success/error 回调若 token 不匹配则丢弃，避免旧实例覆盖新实例
      const token = ++skinLoadToken;
      const _skin = skin;

      // skin://local/<id>/<file>：由主进程 skin 协议从外部皮肤目录（或内置目录）读取
      // 注意：spine-player 4.2 用 skeleton/atlas 参数（不是 jsonUrl/atlasUrl/pngUrl），
      // 且 URL 不能带查询参数（否则扩展名破坏，误按二进制解析）
      const skinUrl = (file) => 'skin://local/' + encodeURIComponent(_skin.id) + '/' + file;

      // 双版本兼容：spine-player 4.2 解析旧版 JSON 骨架本身没问题，
      // 但「自动计算动画视口」在旧版数据上会算出非法边界（Animation bounds are invalid）。
      // 解决：先读骨架版本，旧版（非 4.2）改用骨架 AABB 作为固定 viewport，跳过自动计算。
      let viewport = { padLeft: '4%', padRight: '4%', padTop: '2%', padBottom: '4%' };
      try {
        const res = await fetch(skinUrl(_skin.spine.skeleton));
        if (res.ok) {
          const json = await res.json();
          const ver = (json.skeleton && json.skeleton.spine) || '';
          const isNew = ver.indexOf('4.2') === 0;
          if (!isNew && json.skeleton) {
            const s = json.skeleton;
            const w = s.width || 800, h = s.height || 800;
            const pad = Math.max(w, h) * 0.04;
            viewport = { x: (s.x || 0) - pad, y: (s.y || 0) - pad, width: w + pad * 2, height: h + pad * 2 };
            console.log('[pet] 旧版骨架 (' + ver + ')，已使用固定 viewport');
          }
        }
      } catch (e) { /* 读取失败则用默认百分比 viewport */ }

      const p = new spine.SpinePlayer(playerEl, {
        skeleton: skinUrl(_skin.spine.skeleton),
        atlas: skinUrl(_skin.spine.atlas),
        animation: resolveAnimation(basePose() || 'idle'),
        skin: _skin.spine.skin || undefined, // 皮肤可指定启用哪个 skin（多 skin 骨架：default 可能是空的）
        backgroundColor: '#00000000',
        alpha: true,
        showControls: false,
        showLoading: true,
        viewport,
        success: (instance) => {
          if (token !== skinLoadToken) {
            // 已被更新的切换打断：销毁这次迟到的实例，不覆盖 player
            try {
              if (typeof instance.dispose === 'function') instance.dispose();
              else if (typeof instance.destroy === 'function') instance.destroy();
            } catch (e) { /* ignore */ }
            return;
          }
          player = instance;
          const pose = basePose();
          if (pose) setState(pose);
        },
        error: (instance, reason) => {
          if (token !== skinLoadToken) return; // 迟到的失败回调，忽略
          showTip('皮肤加载失败：' + (reason && reason.message ? reason.message : reason));
        },
      });
      player = p; // 立即持有（供 setState 兜底），真正就绪以 success 为准
    } catch (e) {
      showTip('皮肤初始化异常：' + e.message);
    }
  }

  /* ---------- 手柄显示（主进程鼠标悬停检测） ---------- */
  const topBar = document.getElementById('top-bar');
  window.pet.startHoverWatch().then(() => {
    window.pet.onHoverChange((inside) => {
      topBar.classList.toggle('show', inside);
      if (inside) wakePet(); // 鼠标进入 → 唤醒
    });
  });

  /* ---------- 姿态切换（设置窗口 / AI 对话 → 主进程 → 本窗口） ---------- */
  window.pet.onSetPose((state) => {
    // 语义意图（thinking/task_done/idle 等）→ 皮肤自定义姿态名；找不到则用原名（resolveAnimation 兜底）
    const INTENT_KEYWORDS = {
      thinking: ['think', '思考', '想'],
      task_done: ['done', 'win', 'cheer', 'happy', '完成', '开心', '胜利'],
      idle: ['idle', 'stand', '待机', '发呆'],
    };
    const intent = INTENT_KEYWORDS[state];
    const target = intent ? (findPose(intent) || state) : state;
    setState(target, { manual: true });
    // AI 对话情绪延续：思考期间锁 30s，完成/开心后锁 12s，期间自主动作不打扰
    const s = String(target || '').toLowerCase();
    if (/think|思考|想/.test(s)) lockInteraction(30000);
    else if (/done|win|cheer|happy|完成|开心|胜利/.test(s)) lockInteraction(12000);
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

  /* ---------- 提醒气泡（番茄钟结束 / 每日闹钟） ---------- */
  window.pet.onReminderFire((payload) => {
    if (!payload) return;
    if (payload.type === 'pomodoro') {
      lockInteraction(9000);
      const pose = findPose(['done', 'win', 'cheer', 'happy', '完成', '开心', '胜利']) || basePose();
      if (pose) setState(pose);
      showBubble('🍅', '番茄钟结束！休息一下吧~', 5000);
    } else {
      lockInteraction(6000);
      const pose = findPose(['think', '思考', '想']) || basePose();
      if (pose) setState(pose);
      showBubble('⏰', payload.label || '时间到啦！', 4500);
    }
  });

  /* ---------- 设置：手柄 ☰ 键打开设置窗口 ---------- */
  document.getElementById('settings-btn').addEventListener('click', () => {
    window.pet.openSettings();
  });

  /* ---------- 窗口控制 ---------- */
  document.getElementById('btn-smaller').addEventListener('click', () => window.pet.resize(-1));
  document.getElementById('btn-larger').addEventListener('click', () => window.pet.resize(1));
  document.getElementById('btn-quit').addEventListener('click', () => window.pet.quit());

  /* ---------- 互动：单击随机触发 / 长按弹出菜单选择 ---------- */
  // 交互按钮位于手柄 no-drag 区域，纯按钮事件不触发窗口拖拽，不会引发放大 bug。
  // match：语义关键词，触发时在当前皮肤的自定义姿态名里模糊匹配，找不到则随机/基准兜底
  const INTERACTIONS = [
    { emoji: '♡', label: '摸摸头', match: ['done', 'win', 'cheer', 'happy', '完成', '开心', '胜利'], text: '嘿嘿~ 最喜欢你啦！' },
    { emoji: '👋', label: '打招呼', match: ['done', 'win', 'cheer', 'happy', 'hi', '打招呼'], text: '嗨~ 一直在等你哦！' },
    { emoji: '✨', label: '撒个娇', match: ['done', 'win', 'cheer', 'happy', '撒娇'], text: '人家想你了嘛~' },
    { emoji: '🍬', label: '喂糖果', match: ['done', 'win', 'cheer', 'happy', '吃', '开心'], text: '好甜！谢谢你！' },
    { emoji: '❓', label: '歪头疑惑', match: ['think', '思考', '想', '疑问', '疑惑', '歪'], text: '嗯？你在看什么呀？' },
    { emoji: '😴', label: '睡觉觉', match: ['read', '书', '睡', 'zzz', '打盹'], text: '呼…好困，小眯一会儿' },
  ];

  const interactBtn = document.getElementById('btn-interact');
  const interactMenu = document.getElementById('interact-menu');
  let interactPressTimer = null;
  let interactMenuTimer = null;

  /** 触发一个交互：播放动作 + 气泡 + 计入陪伴互动 */
  function playInteraction(it) {
    lockInteraction(3200);
    const target = findPose(it.match) || randomActionPose() || basePose();
    if (target) setState(target);
    showBubble(it.emoji, it.text, 2600);
    setTimeout(() => {
      if (Date.now() >= interactionLock) {
        const base = basePose();
        if (base) setState(base);
      }
    }, 3000);
    if (window.pet && typeof window.pet.logInteraction === 'function') {
      window.pet.logInteraction('interact');
    }
  }

  /** 构建长按菜单（首次点击时生成，仅一次） */
  function buildInteractMenu() {
    if (interactMenu.childElementCount) return;
    INTERACTIONS.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'interact-menu-item';
      b.innerHTML = '<span class="interact-menu-emoji">' + it.emoji + '</span>' + it.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        hideInteractMenu();
        playInteraction(it);
      });
      interactMenu.appendChild(b);
    });
  }

  function showInteractMenu() {
    buildInteractMenu();
    interactMenu.hidden = false;
  }
  function hideInteractMenu() {
    interactMenu.hidden = true;
  }

  // 按下：0.5 秒后弹菜单（长按）；松开：若未长按则视为单击随机触发
  interactBtn.addEventListener('pointerdown', () => {
    clearTimeout(interactMenuTimer);
    interactPressTimer = setTimeout(() => {
      showInteractMenu();
      interactPressTimer = null;
    }, 500);
  });
  interactBtn.addEventListener('pointerup', () => {
    clearTimeout(interactPressTimer);
    interactPressTimer = null;
    // 菜单已弹出：交给菜单项点击处理，不再随机触发
    if (!interactMenu.hidden) return;
    const it = INTERACTIONS[Math.floor(Math.random() * INTERACTIONS.length)];
    playInteraction(it);
  });
  // 点击窗口其他区域时收起菜单
  window.addEventListener('pointerdown', (e) => {
    if (e.target !== interactBtn && e.target.closest && !e.target.closest('#interact-menu')) {
      hideInteractMenu();
    }
  });
  // 鼠标离开菜单后延迟收起
  interactMenu.addEventListener('mouseleave', () => {
    clearTimeout(interactMenuTimer);
    interactMenuTimer = setTimeout(hideInteractMenu, 300);
  });
  interactMenu.addEventListener('mouseenter', () => clearTimeout(interactMenuTimer));

  /* ---------- 睡眠 / 唤醒（长时间无互动打盹，鼠标回来即醒） ---------- */

  function sleepPet() {
    if (isSleeping) return;
    isSleeping = true;
    stopAutoActions(); // 打盹期间不自动动作
    const pose = findPose(['read', '书', '睡', 'zzz', '打盹']) || basePose();
    if (pose) setState(pose);
    showBubble('💤', '呼…没人陪，小睡一会儿 Zzz', 4000);
  }

  function wakePet() {
    if (!isSleeping) return;
    isSleeping = false;
    if (autoPose) startAutoActions();
    const pose = basePose();
    if (pose) setState(pose);
    showBubble('😊', '嗯？你回来啦！', 2200);
  }

  window.pet.onIdleTick(({ idleMinutes }) => {
    lastIdleMinutes = idleMinutes || 0;
    if (lastIdleMinutes >= 10) sleepPet();
    else if (lastIdleMinutes < 10) wakePet();
  });

  /* ---------- 时间感知行为：早晚问候 / 整点报时 / 自言自语 ---------- */

  const MUMBLES = [
    '嗯…今天做什么好呢？',
    '嘿嘿，发呆中~',
    '主人现在在忙什么呢？',
    '好想和主人说说话呀',
    '唔…这里的风景不错！',
  ];

  let lastHourReport = -1;     // 上次整点报时的小时
  let lastGreetingDate = '';   // 上次问候的日期 key
  let lastMumbleTime = 0;      // 上次自言自语时间戳

  /** 每 30 秒检查一次时间相关行为（睡眠时不打扰） */
  function timeTick() {
    if (isSleeping) return;
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const dateKey = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();

    // 早晚问候：每天一次
    if (dateKey !== lastGreetingDate) {
      if (h >= 6 && h < 9) {
        lastGreetingDate = dateKey;
        lastHourReport = h;
        showBubble('🌤', '早安~ 新的一天，' + petName() + '会一直陪着你！', 4000);
        return;
      }
      if (h >= 22) {
        lastGreetingDate = dateKey;
        lastHourReport = h;
        showBubble('🌙', '夜深了~ 忙完记得早点休息哦', 4000);
        return;
      }
      if (h < 5) {
        lastGreetingDate = dateKey;
        lastHourReport = h;
        showBubble('🌙', '都这么晚啦…早点睡吧', 4000);
        return;
      }
      lastGreetingDate = dateKey; // 白天启动：只记录日期，不打扰
    }

    // 整点报时（每小时一次）
    if (m === 0 && lastHourReport !== h) {
      lastHourReport = h;
      showBubble('🕐', '现在是 ' + h + ' 点整', 3000);
      return;
    }

    // 自言自语：空闲 ≥2 分钟且随机，间隔 ≥4 分钟
    if (lastIdleMinutes >= 2 && Date.now() - lastMumbleTime > 4 * 60000 && Math.random() < 0.25) {
      lastMumbleTime = Date.now();
      showBubble('💭', MUMBLES[Math.floor(Math.random() * MUMBLES.length)], 3500);
    }
  }

  setInterval(timeTick, 30000);

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

  /** 按 prefs 中的皮肤 id 加载；无匹配时回退到第一个 */
  async function loadActiveSkin() {
    const skins = await window.pet.getSkins();
    if (!skins.length) {
      showTip('未找到皮肤（skins/ 目录为空）');
      return;
    }
    let target = skins[0];
    try {
      const activeId = await window.pet.getActiveSkinId();
      if (activeId) {
        const found = skins.find((s) => s.id === activeId);
        if (found) target = found;
      }
    } catch (e) { /* ignore */ }
    if (currentSkin && currentSkin.id === target.id) return; // 相同皮肤不重复加载
    await loadSkin(target);
  }

  // 设置页切换皮肤 → 重载
  window.pet.onSkinChanged(() => {
    loadActiveSkin();
  });

  async function init() {
    try {
      // 同步初始自动模式状态
      window.pet.getSettingsState().then((s) => {
        if (s) {
          autoPose = !!s.autoPose;
          if (autoPose) startAutoActions(); // 皮肤就绪前先启动，playAction 内会兜底
        }
      }).catch(() => {});
      await loadActiveSkin();
    } catch (e) {
      showTip('初始化失败：' + e.message);
    }
  }

  init();
})();
