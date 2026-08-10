# 🎨 PetAI 皮肤接入傻瓜指南

给「蕾米」换个新形象？只要你的素材是 **Spine 格式**（`.json` + `.atlas` + `.png`），按下面 3 步就能搞定，全程 **5~10 分钟**，不用写代码、不用重新打包。

---

## 第一步：找素材（可选）

没有自己的 Spine 素材？可以先用开源的试试水：

| 皮肤 | 来源 | 地址 |
|---|---|---|
| Spineboy / Raptor / Owl / Dragon 等 | Esoteric（Spine 官方） | `github.com/EsotericSoftware/spine-runtimes` → `spine-ts/assets/` |

下载时认准这 **3 个文件**（`.skel` 是二进制格式，我们用的 `.json` 是文本格式）：
- `xxx-pro.json`（骨架）
- `xxx-pma.atlas`（图集索引）
- `xxx-pma.png`（纹理贴图）

> 名字里的 `pma` 代表"预乘 Alpha"，是 Web 渲染最稳的格式，优先选带 `pma` 的。

## 第二步：放进皮肤目录

打开这个文件夹（就是应用自动加载皮肤的地方）：

```
C:\Users\你的用户名\AppData\Roaming\desktop-pet\skins\
```

如果没有 `skins` 文件夹，自己新建一个。然后：

```
skins/
└─ 我的新角色/            ← 文件夹名随便起（英文/拼音，别用中文）
   ├─ skin.json           ← 见第三步
   ├─ mychar-skeleton.json
   ├─ mychar.atlas
   └─ mychar.png
```

## 第三步：写 skin.json（照抄改文件名）

复制下面这段，**只改 `spine` 里的 3 个文件名**即可：

```json
{
  "name": "我的新角色",
  "petName": "新名字",       // 可选：宠物名（弹窗气泡 / 聊天 / 设置 / 托盘 / AI 人设都用它，缺省用 name）
  "author": "作者名（可选）",
  "source": "素材来源（可选）",
  "spine": {
    "skeleton": "mychar-skeleton.json",
    "atlas": "mychar.atlas",
    "png": "mychar.png",
    "skin": "00"
  },
  "states": {
    "idle": "idle"
  }
}
```

**`petName` 是什么？** 这是皮肤的「宠物名」，选了这个皮肤后，应用里所有称呼都跟着它走：弹窗气泡、聊天窗口标题 / 欢迎语、设置窗口标题 / 描述、系统托盘悬浮提示、AI 对话人设，全部换成这个名字。不写就默认用 `name`。

**`spine.skin` 是什么？** 可选的皮肤集名称。骨架里有多个 skin（如 `default` / `00`）时，有些素材的 `default` 只含少量附件、其余槽位要切到另一个 skin 才有贴图（表现为"能加载但画面空白"）。遇到这种情况，在骨架 JSON 里搜 `"skins"` 找到完整的那个 skin 名（通常是 `00` / `default` 之外的），填在这里即可。普通单 skin 素材不需要这个字段。

**`states` 是什么意思？** 它是你的「姿态表」：每个键是**姿态名（可以自己随便起）**，对应的值是骨架里的动画名。比如 `"idle": "idle"` 表示"idle 这个姿态播放 idle 动画"。

- **姿态完全由你定义**：应用没有内置的默认姿态，也不会自动补映射——你写了几个姿态，设置 → 姿势 里就显示几个。
- **想姿态丰富？** 多写几个。比如：
  ```json
  "states": {
    "idle": "idle",
    "思考": "think",
    "看书": "read",
    "工作": "work",
    "完成": "done"
  }
  ```
  姿态名支持中文，AI / 互动触发时会按"思考 / 完成 / 看书"这类语义关键词自动匹配到你的姿态，找不到就回退到第一个（或 `idle`）姿态，不会报错。
- **想给姿态起显示名？** 加一个可选的 `poseNames` 表，设置界面里显示的就是它：
  ```json
  "poseNames": {
    "idle": "发呆",
    "思考": "思考中",
    "看书": "读书"
  }
  ```
  没写 `poseNames` 的姿态，显示姿态名本身。
- **不会看动画名？** 用记事本打开 `xxx-pro.json`，按 `Ctrl+F` 搜 `"animations"`，下面列出的就是所有动画名，随便挑。

## 完成！重启应用看效果

- 重启 PetAI（右键托盘 → 退出，再重新打开）
- 设置 → 关于皮肤 → 就能看到你的新皮肤，点一下切换
- 设置 → 姿势 → 看到的就是你这套皮肤自己的姿态列表，点一下立即切换

## 常见问题

| 问题 | 解决 |
|---|---|
| 应用没显示我的皮肤 | 检查文件夹名没中文、`skin.json` 里 3 个文件名与实际一致 |
| 皮肤显示但不动 | `states` 至少要有 `"idle": "对应动画名"` |
| 动画名字全看不懂 | 先只写一个 `"idle": "动画名"`，想加姿态时再对照骨架的 `animations` 补 |
| 素材是 `.skel` 格式 | 用 Spine 编辑器导出为 `.json` 格式（File → Export → JSON） |
| 素材是旧版 Spine（3.x / 4.0）| 直接可用！应用会自动识别版本并兼容加载（旧版会自动用骨架包围盒定位，个别旧版素材可能需微调 `atlas` 中的贴图文件名与目录一致） |
| 旧版素材出现"人体撕裂 / 部件乱飞" | 旧版 JSON 的 transform 约束 mix 字段名（`rotateMix`/`translateMix`）与 4.2 不兼容，会被读成默认 100%。运行 `tools/fix-3-8-transform-mix.js` 一键修复（可对 `skin.json` 所在目录的骨架 JSON 运行） |
| 气泡 / 聊天里的名字还是旧的 | 在 `skin.json` 里加 `petName` 字段，或检查是否已重启应用 |

## 想换回来？

应用会记住你上次选的皮肤，随时在 设置 → 关于皮肤 里切换回来。
