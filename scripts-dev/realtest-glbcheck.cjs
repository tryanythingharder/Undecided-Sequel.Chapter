// 解析 renderer/holo/card.glb：验证 front 面顶点 y 范围与 UV 对应关系（诊断倒置）
const fs = require('fs')
const buf = fs.readFileSync(require('path').join(__dirname, '..', 'renderer', 'holo', 'card.glb'))
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen + 8
const bin = buf.slice(binStart)
const views = json.bufferViews
const readF = (view, i) => bin.readFloatLE((view.byteOffset || 0) + i * 4)

for (const mesh of json.meshes) {
  if (mesh.name !== 'card_front') continue
  const prim = mesh.primitives[0]
  const posAcc = json.accessors[prim.attributes.POSITION]
  const uvAcc = json.accessors[prim.attributes.TEXCOORD_0]
  const pv = views[posAcc.bufferView], uv = views[uvAcc.bufferView]
  console.log('card_front count=', posAcc.count)
  // 顶点 1 是轮廓第一点（perimeter 从 (w/2-r + r*cos(0), h/2-r) 开始 = 右上角附近）
  // y=+h/2 是卡头(上)还是卡底？uv v = y/h+0.5
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < posAcc.count; i++) {
    const y = readF(pv, i * 3 + 1)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  console.log('position y 范围:', minY.toFixed(3), '→', maxY.toFixed(3), '(H=9.45, ±4.725)')
  // 采样轮廓第一点（应是右上角 x≈3.15, y≈4.525）与 UV
  for (const i of [0, 1, 2, 13, 25]) {
    if (i >= posAcc.count) break
    console.log('v' + i, 'pos(', readF(pv, i * 3).toFixed(2), ',', readF(pv, i * 3 + 1).toFixed(2), ') uv(', readF(uv, i * 2).toFixed(3), ',', readF(uv, i * 2 + 1).toFixed(3), ')')
  }
  console.log('vUv = vec2(uv.x, 1.0-uv.y) → 屏幕上"卡顶 y=+4.7"采样 v=', (1 - (1 / 9.45 * 4.725 + 0.5)).toFixed(3), '(0=纹理底, 1=纹理顶)')
}
