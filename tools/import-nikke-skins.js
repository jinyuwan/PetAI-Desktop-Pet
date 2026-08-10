/**
 * 批量导入 NIKKE Spine 3.8 皮肤到应用 skins 目录：
 * 1. 复制骨架/图集/贴图/拆分包
 * 2. 生成 skin.json（自动映射动画 → 姿态，默认启用 "00" skin）
 * 3. 修复 transform mix 旧字段名（3.8 → 4.2）
 * 4. 校验动画名存在性
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_BASE = 'F:/下载/3211 胜利女神【202607追】/4.spine动画/SPINE3.8.75';
const DST_BASE = 'g:/files/ai/project_pet/pet-ai/skins';
const TARGETS = process.argv.slice(2); // 指定角色 id（不传则全部）

// 通用姿态映射（NIKKE 动画命名规律）
const POSE_MAP = [
  ['idle', 'idle'],
  ['talk', 'talk_start'],
  ['talk_end', 'talk_end'],
  ['happy', 'delight'],
  ['sad', 'sad'],
  ['angry', 'angry'],
  ['pain', 'pain'],
  ['surprise', 'surprise'],
  ['shy', 'shy'],
  ['think', 'think'],
  ['cry', 'cry'],
  ['worry', 'worry'],
  ['no', 'no'],
  ['good', 'good'],
  ['smile', 'smile'],
  ['action', 'action'],
  ['special', 'special'],
  ['skillcut_1', 'skillcut_1'],
  ['waling_test', 'waling_test'],
  ['surprised', 'surprised'],
  ['surprise2', 'surprise2'],
  ['idle2', 'idle2'],
  ['angry2', 'angry2'],
  ['expression_0', 'expression_0'],
];

const POSE_NAMES = {
  idle: '待机', idle2: '待机2', talk: '说话', talk_end: '说完', happy: '开心',
  sad: '难过', angry: '生气', angry2: '生气2', pain: '疼痛', surprise: '惊讶',
  surprise2: '惊讶2', surprised: '惊讶', shy: '害羞', think: '思考', cry: '哭泣',
  worry: '担忧', no: '摇头', good: '点赞', smile: '微笑', action: '战斗动作',
  special: '特殊', skillcut_1: '技能特写', waling_test: '走路测试', expression_0: '表情0',
};

function collect(dir) {
  const jsonFile = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  const atlasFile = fs.readdirSync(dir).find((f) => f.endsWith('.atlas'));
  if (!jsonFile || !atlasFile) return null;
  // 用 atlas 引用确定贴图文件（支持多页：c090_00.png + c090_00_2.png）
  const atlas = fs.readFileSync(path.join(dir, atlasFile), 'utf8');
  const pngFiles = (atlas.match(/^.+\.png$/gm) || []).filter((f) => fs.existsSync(path.join(dir, f)));
  if (!pngFiles.length) return null;
  return { jsonFile, atlasFile, pngFiles };
}

function buildSkinJson(id, anims, files) {
  const states = {};
  const extraStates = {};
  for (const [pose, anim] of POSE_MAP) {
    if (anims.includes(anim)) {
      if (['action', 'special', 'skillcut_1', 'waling_test', 'expression_0'].includes(pose)) {
        extraStates[pose] = anim;
      } else {
        states[pose] = anim;
      }
    }
  }
  // 兜底：确保 idle 存在
  if (!states.idle && anims.includes('idle')) states.idle = 'idle';
  const poseNames = {};
  Object.keys(states).forEach((k) => { poseNames[k] = POSE_NAMES[k] || k; });
  Object.keys(extraStates).forEach((k) => { poseNames[k] = POSE_NAMES[k] || k; });
  return {
    name: 'NIKKE ' + id,
    author: '素材提取',
    version: '1.0',
    source: 'Spine 3.8 旧版素材（应用自动兼容加载）',
    spine: { skeleton: files.jsonFile, atlas: files.atlasFile, png: files.pngFiles[0], skin: '00' },
    states,
    extraStates,
    poseNames,
  };
}

function fixTransformMix(jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(raw.transform)) return 0;
  let fixed = 0;
  raw.transform.forEach((c) => {
    const hasOld = c.rotateMix !== undefined || c.translateMix !== undefined || c.scaleMix !== undefined || c.shearMix !== undefined;
    if (!hasOld) return;
    if (c.rotateMix !== undefined && c.mixRotate === undefined) c.mixRotate = c.rotateMix;
    if (c.translateMix !== undefined) {
      if (c.mixX === undefined) c.mixX = c.translateMix;
      if (c.mixY === undefined) c.mixY = c.translateMix;
    }
    if (c.scaleMix !== undefined) {
      if (c.mixScaleX === undefined) c.mixScaleX = c.scaleMix;
      if (c.mixScaleY === undefined) c.mixScaleY = c.scaleMix;
    }
    if (c.shearMix !== undefined && c.mixShearY === undefined) c.mixShearY = c.shearMix;
    delete c.rotateMix; delete c.translateMix; delete c.scaleMix; delete c.shearMix;
    fixed++;
  });
  fs.writeFileSync(jsonPath, JSON.stringify(raw), 'utf8');
  return fixed;
}

const all = fs.readdirSync(SRC_BASE).filter((d) => fs.statSync(path.join(SRC_BASE, d)).isDirectory());
const targets = TARGETS.length ? all.filter((d) => TARGETS.includes(d)) : all;
if (TARGETS.length && !targets.length) {
  console.error('未找到指定角色:', TARGETS.join(','));
  process.exit(1);
}

const report = [];
for (const id of targets) {
  const src = path.join(SRC_BASE, id);
  const files = collect(src);
  if (!files) { report.push(id + ': 缺骨架文件，跳过'); continue; }
  try {
    // 1. 复制到 dst
    const dst = path.join(DST_BASE, id);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(src, files.jsonFile), path.join(dst, files.jsonFile));
    fs.copyFileSync(path.join(src, files.atlasFile), path.join(dst, files.atlasFile));
    files.pngFiles.forEach((pf) => fs.copyFileSync(path.join(src, pf), path.join(dst, pf)));
    // 拆分包（00/ 等）
    fs.readdirSync(src).forEach((n) => {
      const full = path.join(src, n);
      if (fs.statSync(full).isDirectory()) {
        fs.cpSync(full, path.join(dst, n), { recursive: true });
      }
    });

    // 2. 读动画名
    const raw = JSON.parse(fs.readFileSync(path.join(dst, files.jsonFile), 'utf8'));
    const anims = Object.keys(raw.animations || {});

    // 3. 写 skin.json
    const skinJson = buildSkinJson(id, anims, files);
    fs.writeFileSync(path.join(dst, 'skin.json'), JSON.stringify(skinJson, null, 2), 'utf8');

    // 4. 修复 transform mix
    const fixed = fixTransformMix(path.join(dst, files.jsonFile));

    // 5. 校验
    const errs = [];
    Object.keys(skinJson.states).forEach((p) => { if (!anims.includes(skinJson.states[p])) errs.push(p); });
    Object.keys(skinJson.extraStates).forEach((p) => { if (!anims.includes(skinJson.extraStates[p])) errs.push(p); });
    report.push(id + ': 动画=' + anims.length + ' 姿态=' + (Object.keys(skinJson.states).length + Object.keys(skinJson.extraStates).length) + ' mix修复=' + fixed + (errs.length ? ' 映射缺失=' + errs.join(',') : ' ✓'));
  } catch (e) {
    report.push(id + ': 失败 ' + e.message);
  }
}
console.log(report.join('\n'));
