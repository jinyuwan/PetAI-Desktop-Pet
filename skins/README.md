# skins/ 皮肤目录

本仓库为纯技术实现，**不包含皮肤素材**（版权原因，见根目录 README「版权说明」）。

请在本地放入你的 Spine 皮肤，每个皮肤一个子目录（本地目录已被 `.gitignore` 排除，不会上传）：

```
skins/
└─ <皮肤名>/
   ├─ skin.json           ← 皮肤元数据（见下方模板）
   ├─ xxx-skeleton.json   ← Spine 骨架
   ├─ xxx.atlas           ← 图集
   └─ xxx.png             ← 纹理
```

`skin.json` 模板：

```json
{
  "name": "皮肤显示名",
  "author": "作者名",
  "version": "1.0",
  "source": "素材来源（可选）",
  "spine": {
    "skeleton": "xxx-skeleton.json",
    "atlas": "xxx.atlas",
    "png": "xxx.png"
  },
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

详细说明见 [README.md](../README.md)「皮肤说明」一节。
