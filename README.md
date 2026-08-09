# PetAI 桌宠（AI Desktop Pet）

一个基于 Electron + Spine 的 AI 桌面宠物。透明悬浮窗、自主动作、AI 多模态对话、本地会话历史。

> 仓库只包含**技术实现**，不包含皮肤素材（素材来自 B 站，见文末版权说明）。

## ✨ 功能

- 🐾 **桌宠本体**：透明无边框窗口、置顶、系统原生拖拽、自主动作调度（思考/看书/计划/工作随机切换）
- 💬 **AI 对话**：任意 OpenAI 兼容接口（DeepSeek / 豆包 / 通义 / Ollama 本地模型均可）
  - 流式打字机回复、自定义人设 Prompt、对话历史本地保存
  - 多会话管理：新对话 / 历史切换 / 单删 / 清空
  - 📎 图片上传（多模态识图）· 🖥 屏幕识别
  - 🔎 对话历史导出 / 导入（JSON，备份与换机迁移）
- 📐 **对话框自定义大小**：拖拽右下角手柄任意缩放，支持恢复默认，尺寸自动记忆
- ⏰ **提醒**：番茄钟（25/45/60/90 分钟）+ 每日闹钟，到点宠物气泡 / 系统通知提醒
- 🔄 **自动更新**：启动静默检查 GitHub 新版本，设置页一键下载、sha512 校验、静默安装自动重启
- 🎛 **设置面板**：显示 / AI / 姿势 / 提醒 / 对话 / 关于，全部可视化配置
- 🎀 **陪伴记录**：本地统计陪伴天数 / 互动次数 / 对话条数
- 🌙 **静默模式**：仅保留桌宠与手柄，隐藏对话框
- 🔒 **单实例**：防止多开导致数据互相覆盖

## 📦 快速开始

```bash
# 1. 准备皮肤：在 skins/ 目录放入你的 Spine 皮肤（见下方说明）
# 2. 安装依赖
npm install
# 3. 运行
npm start
```

### 皮肤说明

应用按以下顺序查找皮肤目录（同名皮肤优先用高优先级目录）：

1. `%APPDATA%/desktop-pet/skins/` — **用户自定义皮肤的标准位置**（安装版也能用）
2. 安装目录旁的 `skins/`（便携版 / 免安装版场景）
3. 应用内置 `skins/`（随安装包分发）

每个皮肤是独立文件夹，结构如下：

```
skins/<皮肤名>/
├─ skin.json          # 皮肤元数据（名称 / 状态映射）
├─ xxx-skeleton.json  # Spine 骨架
├─ xxx.atlas          # Spine 图集
└─ xxx.png            # Spine 贴图
```

`skin.json` 示例：

```json
{
  "name": "皮肤显示名",
  "author": "作者名",
  "version": "1.0",
  "spine": { "skeleton": "xxx-skeleton.json", "atlas": "xxx.atlas", "png": "xxx.png" },
  "states": {
    "idle": "e",
    "reading": "a",
    "planning": "a_win",
    "thinking": "b",
    "task_done": "c",
    "working": "d",
    "work_done": "d_win"
  }
}
```

放好后重启应用即可加载；如无皮肤，应用会提示"未找到皮肤"（代码逻辑在 `renderer/app.js`，可自行替换为其他渲染方案）。

## ⚙️ AI 配置

打开设置 → AI：

| 字段 | 说明 | 示例 |
|---|---|---|
| API 地址 | OpenAI 兼容接口地址 | `https://api.deepseek.com` |
| API Key | 平台密钥，仅存本机 | `sk-xxxx` |
| 模型名 | 模型/端点 ID | `deepseek-chat` |
| 人设 Prompt | 可选，留空则不注入人设 | `你是...` |

> 图片识别需要模型支持视觉多模态（如 `gpt-4o`、`qwen-vl-max`），不支持时自动提示。

## 🖥 平台与打包

```bash
npm start       # 开发运行
npm run dist    # 打包 Windows 安装包（electron-builder，输出到 dist/）
```

需要自行签名请配置 `build.win.signAndEditExecutable` 并准备证书。

## 📁 数据存储

| 数据 | 位置 |
|---|---|
| 对话历史 | `%APPDATA%/desktop-pet/chat-history.json` |
| AI 配置 | `%APPDATA%/desktop-pet/ai-config.json` |
| 用户偏好（称呼 / 对话框尺寸等） | `%APPDATA%/desktop-pet/prefs.json` |
| 提醒（番茄钟 / 闹钟） | `%APPDATA%/desktop-pet/reminders.json` |
| 陪伴记录 | `%APPDATA%/desktop-pet/companion.json` |

## 🔒 隐私说明

- **API Key 仅存本机**：你的 API Key 只保存在自己电脑的 `%APPDATA%/desktop-pet/` 中，不会随程序、安装包或代码仓库分发，也不会上传到任何服务器
- **程序与数据分离**：安装包仅包含程序代码，不携带任何个人数据（Key / 对话记录）。对方安装后需自行填写自己的 Key
- **对话记录本地保存**：聊天历史只写入本机文件，程序不采集、不上报任何使用数据
- **注意**：使用识图 / 屏幕识别 / AI 对话时，图片与文本会发送到你配置的模型服务商（如 DeepSeek / 豆包 / OpenAI）进行处理，请勿发送敏感信息

## ⚠️ 版权说明

- 皮肤素材来自网络（bilibili@森哈_Yeah、绝区零虚狩绘本），**仅供个人学习**，请勿商用或二次传播
- 本仓库代码部分可自由使用，使用图片素材需自行确认授权

## 🧱 技术栈

Electron 33 · Spine Player 4.2 · 原生 JS（无框架）· electron-builder
