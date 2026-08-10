/**
 * 修复 3.8→4.2 transform 约束 mix 字段名兼容：
 *   rotateMix     → mixRotate
 *   translateMix  → mixX + mixY
 *   scaleMix      → mixScaleX + mixScaleY
 *   shearMix      → mixShearY
 * 4.2 SkeletonJson 只读新字段名，找不到时默认 mix=1（锁死）→ 旧素材细节骨骼被拉飞。
 *
 * 用法：node fix-3-8-transform-mix.js <骨架.json 路径>
 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node fix-3-8-transform-mix.js <骨架.json 路径>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!Array.isArray(raw.transform)) {
  console.log('无 transform 约束，无需修复');
  process.exit(0);
}

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
  // 清理旧字段
  delete c.rotateMix; delete c.translateMix; delete c.scaleMix; delete c.shearMix;
  fixed++;
});

fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
console.log('已修复约束数:', fixed, '/', raw.transform.length);
