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
  "author": "作者名（可选）",
  "source": "素材来源（可选）",
  "spine": {
    "skeleton": "mychar-skeleton.json",
    "atlas": "mychar.atlas",
    "png": "mychar.png"
  },
  "states": {
    "idle": "idle"
  }
}
```

**`states` 是什么意思？** 它把"应用的状态"映射到"你的动画名"。比如 `"idle": "idle"` 表示"待机状态播 idle 这个动画"。

- **只写 `idle` 就能跑**：其他状态（思考/看书/工作…）应用会自动寻找最接近的动画名，找不到就保持待机，不会报错。
- **想姿势丰富？** 多映射几个。常见标准状态：`idle`（待机）、`thinking`（思考）、`reading`（看书）、`working`（工作）、`task_done`（完成）。
- **不会看动画名？** 用记事本打开 `xxx-pro.json`，按 `Ctrl+F` 搜 `"animations"`，下面列出的就是所有动画名，随便挑。

## 完成！重启应用看效果

- 重启 PetAI（右键托盘 → 退出，再重新打开）
- 设置 → 关于皮肤 → 就能看到你的新皮肤，点一下切换
- 状态映射里「虚线框」的就是**自动适配**出来的，实心的是你手写的

## 常见问题

| 问题 | 解决 |
|---|---|
| 应用没显示我的皮肤 | 检查文件夹名没中文、`skin.json` 里 3 个文件名与实际一致 |
| 皮肤显示但不动 | `states` 至少要有 `"idle": "对应动画名"` |
| 动画名字全看不懂 | 先只写 `idle`，其余交给自动适配 |
| 素材是 `.skel` 格式 | 用 Spine 编辑器导出为 `.json` 格式（File → Export → JSON） |

## 想换回来？

应用会记住你上次选的皮肤，随时在 设置 → 关于皮肤 里切换回来。
