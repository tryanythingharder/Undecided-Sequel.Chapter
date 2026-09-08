#!/usr/bin/env node
'use strict'
/* ======== 六面世界 · 静态全息卡 card.glb 生成器（一次性工具，产物入库） ========
 * 几何契约来自 RuiC-card-skill（MIT）的 build_card.py / export_web.py：
 * 浏览器端（app.bundle.js）遍历 glb 网格，以 material.name 为角色契约——
 *   web_front（唯一硬校验：缺它直接抛错）/ web_edge（侧壁+外圈压边）/ web_back / web_gold（内金圈）
 * 材质在浏览器端被整体替换为 ShaderMaterial，glb 只需：几何 + UV(0..1) + 命名材质。
 * 本脚本用纯 Node 手写最小 GLB（JSON chunk + BIN chunk），零依赖、无需 Blender。
 *
/* 与 Blender 原版等价性（推导自 build_card.py + glTF exporter 坐标变换）：
 * - Blender 网格在 XY 平面（z=0/-厚度），物体 rotation_euler.x = +90°：顶点 (x,y,z) → (x,-z,y)，
 *   卡面立于 XZ… 实际顶点变 (x, z', y')：面法线 +Z → -Y（朝 Blender 视线轴）。
 * - glTF 导出 yup=True 的标准变换：Blender(x,y,z) → glTF(x, z, -y)。
 *   两步合成后：原网格顶点 (px, py, pz)_local → glTF(px, pz, -py)。
 *   即：原网格的 X → glTF X（横向），原 Y → glTF -Z（竖向，卡头在上=Z负），厚度 Z → glTF Y。
 * - 结论：glTF 里卡片立于 XY 平面，front 面法线 +Z（正对相机 (0,0,20)），
 *   UV 的 V 翻转（vUv=vec2(uv.x,1-uv.y)）正是补偿这套 Blender→Y-up 的镜像。
 *
 * 卡身 6.3×9.45、厚 0.045、圆角 0.20、perimeter 12 段（build_card.py plane()）；
 * 原版一个 mesh 塞 3 种材质，Three.js 端 ob.material?.name 对多 primitive 会取 undefined，
 * 因此这里拆成 4 个独立 mesh（front / side / back / 环×2），行为等价且更稳。
 *
 * 用法：node scripts-dev/build-holo-glb.cjs   →  renderer/holo/card.glb
 */
const fs = require('fs')
const path = require('path')

/* 圆角矩形轮廓（沿 build_card.py perimeter()：四角 12 段圆弧，逆时针） */
function perimeter(w, h, r, n = 12) {
  const pts = []
  for (const [cx, cy, start] of [
    [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90],
    [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]
  ]) {
    for (let j = 0; j <= n; j++) {
      const a = (start + (j * 90) / n) * Math.PI / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/* Y-up 布局：卡面 = XZ 平面，front 面朝 +Y。
 * UV 映射与 build_card.py 一致：u = x/w+0.5, v = z/h+0.5（z 对应原版的"y"）。
 * 注意 app.bundle.js 顶点着色器有 vUv = vec2(uv.x, 1.0-uv.y) 的 V 翻转——
 * 这是补偿 Blender Y-up 导出的补偿，我们在 Y-up 下按上式直出即可对齐。 */
const CARD_W = 6.3, CARD_H = 9.45, THICK = 0.045, CORNER = 0.20, SEG = 12

const buffers = [] // { bytes: Buffer }
function addBin(bin) { buffers.push(bin); return buffers.reduce((s, b) => s + b.length, 0) - bin.length }
const PAD4 = (n) => (4 - (n % 4)) % 4

function meshes() {
  const out = []
  const outer = perimeter(CARD_W, CARD_H, CORNER, SEG)
  const N = outer.length

  /* 坐标映射（见文件头推导）：卡面立在 XY 平面，厚度沿 Z。
   * 轮廓 (x, y) 直接作为 glTF (x, y)；厚度 pz ∈ [0, -THICK]。
   * front 面 z=0 法线 +Z（正对相机 (0,0,20)）；UV 与 build_card.py 一致
   * (u = x/w+0.5, v = y/h+0.5)，浏览器端的 vUv=vec2(uv.x,1-uv.y) 翻转即对应此映射。 */

  /* --- 卡身正面（web_front）：三角扇连圆角轮廓 --- */
  {
    const pos = [[0, 0, 0]], uv = [[0.5, 0.5]], idx = []
    outer.forEach(([x, y]) => { pos.push([x, y, 0]); uv.push([x / CARD_W + 0.5, y / CARD_H + 0.5]) })
    // perimeter 在 XY 平面逆时针（数学系）→ 三角扇 (0, i, i+1) 法线 +Z
    for (let i = 1; i <= N; i++) idx.push(0, i, (i % N) + 1)
    out.push({ name: 'card_front', mat: 'web_front', pos, uv, idx })
  }
  /* --- 卡身背面（web_back）：z = -THICK，法线 -Z；UV 左右镜像（从背后看） --- */
  {
    const pos = [[0, 0, -THICK]], uv = [[0.5, 0.5]], idx = []
    outer.forEach(([x, y]) => { pos.push([x, y, -THICK]); uv.push([0.5 - x / CARD_W, y / CARD_H + 0.5]) })
    for (let i = 1; i <= N; i++) idx.push(0, (i % N) + 1, i)
    out.push({ name: 'card_back', mat: 'web_back', pos, uv, idx })
  }
  /* --- 卡身侧壁（web_edge）：沿轮廓挤出的环带 --- */
  {
    const pos = [], uv = [], idx = []
    outer.forEach(([x, y], i) => {
      pos.push([x, y, 0]); pos.push([x, y, -THICK])
      const u = x / CARD_W + 0.5
      uv.push([u, 1]); uv.push([u, 0])
      const j = (i + 1) % N
      // 轮廓逆时针 → 该绕序外壁法线朝外
      idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1)
    })
    out.push({ name: 'card_side', mat: 'web_edge', pos, uv, idx })
  }
  /* --- 环带：外圈全息压边 / 内圈古金（build_card.py ring()） --- */
  const ring = (name, w, h, width, mat, z) => {
    const o = perimeter(w, h, CORNER, SEG)
    const inn = perimeter(w - width * 2, h - width * 2, Math.max(CORNER - width, 0.01), SEG)
    const M = o.length
    const pos = [], uv = [], idx = []
    o.forEach(([x, y]) => { pos.push([x, y, z]); uv.push([x / w + 0.5, y / h + 0.5]) })
    inn.forEach(([x, y]) => { pos.push([x, y, z]); uv.push([x / w + 0.5, y / h + 0.5]) })
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M
      idx.push(i, j, j + M, i, j + M, i + M)
    }
    out.push({ name, mat, pos, uv, idx })
  }
  ring('holo_trim', CARD_W, CARD_H, 0.060, 'web_edge', -0.025)
  ring('gold_trim', 6.13, 9.28, 0.018, 'web_gold', -0.026)
  return out
}

/* ---- glTF 组装 ---- */
function buildGlb() {
  const parts = meshes()
  const json = {
    asset: { version: '2.0', generator: 'sixworlds build-holo-glb' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'holo_card', children: parts.map((_, i) => i + 1) }]
      .concat(parts.map((p, i) => ({ name: p.name, mesh: i }))),
    materials: ['web_front', 'web_edge', 'web_back', 'web_gold'].map((name) => ({
      name,
      pbrMetallicRoughness: { baseColorFactor: [0.7, 0.5, 0.2, 1], metallicFactor: 0, roughnessFactor: 1 }
    })),
    meshes: [], accessors: [], bufferViews: [], buffers: []
  }

  // 顶点/索引按 float32/uint32 落 BIN chunk（>65535 顶点才需 uint32，这里保守用之）
  for (const p of parts) {
    const posBuf = Buffer.from(new Float32Array(p.pos.flat()).buffer)
    const uvBuf = Buffer.from(new Float32Array(p.uv.flat()).buffer)
    const idxBuf = Buffer.from(new Uint32Array(p.idx).buffer)
    const posOff = addBin(posBuf)
    const uvOff = addBin(uvBuf)
    const idxOff = addBin(idxBuf)
    const base = json.bufferViews.length
    json.bufferViews.push(
      { buffer: 0, byteOffset: posOff, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBuf.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBuf.length, target: 34963 }
    )
    const posAcc = json.accessors.length
    json.accessors.push(
      { bufferView: base, componentType: 5126, count: p.pos.length, type: 'VEC3', min: [-CARD_W / 2, -CARD_H / 2, -THICK], max: [CARD_W / 2, CARD_H / 2, 0] },
      { bufferView: base + 1, componentType: 5126, count: p.uv.length, type: 'VEC2' },
      { bufferView: base + 2, componentType: 5125, count: p.idx.length, type: 'SCALAR', min: [0], max: [p.pos.length - 1] }
    )
    const matIdx = ['web_front', 'web_edge', 'web_back', 'web_gold'].indexOf(p.mat)
    json.meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: posAcc, TEXCOORD_0: posAcc + 1 }, indices: posAcc + 2, material: matIdx }] })
  }

  // BIN chunk 4 字节对齐（glTF 二进制规范）
  const bin = Buffer.concat(buffers)
  const pad = PAD4(bin.length)
  const binPadded = Buffer.concat([bin, Buffer.alloc(pad)])
  json.buffers.push({ byteLength: binPadded.length })

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = PAD4(jsonBuf.length)
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)])

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length
  const glb = Buffer.alloc(total)
  glb.writeUInt32LE(0x46546C67, 0)          // 'glTF'
  glb.writeUInt32LE(2, 4)                    // version
  glb.writeUInt32LE(total, 8)                // total length
  glb.writeUInt32LE(jsonPadded.length, 12)   // JSON chunk length
  glb.writeUInt32LE(0x4E4F534A, 16)         // 'JSON'
  jsonPadded.copy(glb, 20)
  glb.writeUInt32LE(binPadded.length, 20 + jsonPadded.length)
  glb.writeUInt32LE(0x004E4942, 24 + jsonPadded.length) // 'BIN'
  binPadded.copy(glb, 28 + jsonPadded.length)
  return glb
}

const out = path.join(__dirname, '..', 'renderer', 'holo', 'card.glb')
const glb = buildGlb()
fs.writeFileSync(out, glb)
console.log('card.glb 写出：' + out + '（' + glb.length + ' 字节）')
console.log('自检：材质契约 web_front/web_edge/web_back/web_gold 已按 mesh 独立挂载')
