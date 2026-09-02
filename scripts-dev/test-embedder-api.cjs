// api-v1 真实嵌入模型专项（mock /v1/embeddings 服务，纯 Node 无 Electron）：
// 冷同步降级（chunks/FTS 落盘、无向量行、查询走 FTS 兜底不崩）→ 异步补嵌批量请求 → 自动重同步补插向量行 →
// 语义命中 → 缓存去重（重复 sync 零新请求）→ 离线韧性（断网 sync/search 不崩、已热条目照常）→
// 维度切换整表重建（hash 256 ↔ api 4）→ 缓存跨重建持久（切回零新请求）。
// 用法：node scripts-dev/test-embedder-api.cjs
// api-v1 嵌入器专项：mock /v1/embeddings 服务 + 缓存 + 未热降级 + 补嵌收敛 + 维度重建 + 离线韧性
const http = require('http')
const fs = require('fs'); const path = require('path'); const os = require('os')

let calls = 0
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => body += c)
  req.on('end', () => {
    calls++
    const input = JSON.parse(body).input
    const data = input.map((t, i) => ({ index: i, embedding: mockEmbed(t) }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data }))
  })
})
// 语义可控 mock：含「救命」→ [1,0,0,0]；含「集市」→ [0,1,0,0]；其他 → 混合方向
function mockEmbed(t) {
  const s = String(t)
  if (s.includes('救命')) return [1, 0, 0, 0]
  if (s.includes('集市')) return [0, 1, 0, 0]
  if (s.includes('恩人') || s.includes('报答')) return [0.9, 0.1, 0, 0] // 与救命方向近
  return [0, 0, 1, 0]
}
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const { createVectorStore } = require('../engine/vector-store')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vecapi-'))
  const apiEmbedder = { baseUrl: 'http://127.0.0.1:' + port, model: 'mock-embed', dim: 4, apiKey: 'k-test' }
  const vs = createVectorStore(dir, { embedder: 'api-v1', apiEmbedder })
  const fails = []
  const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }
  const mk = () => ({ story_id: 'S1', counters: { turn: 2 }, facts: [
    { fact_id: 'F1', story_id: 'S1', statement: '薇拉在旧桥救了玩家一命，救命之恩', key: '救命', importance: 90, turn: 1 },
    { fact_id: 'F2', story_id: 'S1', statement: '集市的铜价三个月内翻了一倍', key: '物价', importance: 40, turn: 2 }
  ], events: [], decisions: [] })
  check('api-store-enabled', vs.enabled === true)
  // 1. 首次 sync：全部未热 → chunks/FTS 落盘、无向量行、不写水位
  vs.sync(mk())
  const st0 = vs.stats()
  check('cold-sync-chunks-only', st0.chunks === 2, JSON.stringify(st0))
  // 2. 冷查询：向量通道跳过，FTS 兜底（不崩溃）
  const qCold = vs.search('S1', '救命之恩的恩人是谁', 40)
  check('cold-search-fts-fallback', qCold instanceof Map, '冷查询不崩溃')
  // 3. 等异步补嵌完成（轮询向量行出现）
  let warmed = false
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
    // 补嵌完成后 resyncAfterWarm 自动重同步 → 向量行落表
    try {
      const q = vs.search('S1', '救命之恩的恩人是谁', 40)
      if (q && (q.get('f|F1') || 0) > 0.3) { warmed = true; break }
    } catch {}
  }
  const stW = vs.stats()
  check('warm-resync-semantic-hit', warmed, '补嵌后语义命中 F1')
  check('warm-chunks-stable', stW.chunks === 2, JSON.stringify(stW))
  const callsAfterWarm = calls
  check('batched-requests', callsAfterWarm >= 1 && callsAfterWarm <= 3, 'mock 请求次数=' + callsAfterWarm)
  // 4. 再 sync 幂等（缓存已热）：无新请求
  vs.sync(mk())
  await new Promise((r) => setTimeout(r, 500))
  check('cached-no-refetch', calls === callsAfterWarm, '重复 sync 请求 ' + callsAfterWarm + '→' + calls)
  // 5. 近邻检索：查询向量同样走缓存——首次查询未热（跳过向量通道+入队补嵌），补嵌后再查命中
  vs.search('S1', '我还没报答的恩情，那位恩人是谁', 40)
  const dl5 = Date.now() + 6000
  while (Date.now() < dl5) {
    await new Promise((r) => setTimeout(r, 250))
    const qW = vs.search('S1', '我还没报答的恩情，那位恩人是谁', 40)
    if ((qW.get('f|F1') || 0) > 0.5) break
  }
  const qW2 = vs.search('S1', '我还没报答的恩情，那位恩人是谁', 40)
  check('semantic-beats-lexical', (qW2.get('f|F1') || 0) > 0.5 && (qW2.get('f|F2') || 0) < 0.1, 'F1=' + (qW2.get('f|F1') || 0).toFixed(3))
  // 6. 离线韧性：断掉 fetch 后 sync 新文本不崩溃，FTS 照常
  const vsOffline = createVectorStore(dir, { embedder: 'api-v1', apiEmbedder: { ...apiEmbedder, baseUrl: 'http://127.0.0.1:1' } })
  const mk2 = () => { const s = mk(); s.facts.push({ fact_id: 'F3', story_id: 'S1', statement: '断网时的记录', key: 'x', importance: 20, turn: 3 }); return s }
  vsOffline.sync(mk2())
  const qOff = vsOffline.search('S1', '救命之恩', 40)
  check('offline-sync-search-safe', qOff instanceof Map && (qOff.get('f|F1') || 0) > 0.3, '离线时已热条目照常命中')
  vsOffline.close()
  // 7. 维度切换重建：hash-v1（256 维）重开 → 表重建；再回 api-v1 → 缓存仍在（无新请求）且检索可用
  vs.close()
  const vsHash = createVectorStore(dir) // hash-v1 默认
  check('dim-switch-rebuilds', vsHash.stats().dim === 256, JSON.stringify(vsHash.stats()))
  vsHash.sync(mk())
  check('hash-sync-works', (vsHash.search('S1', '救命之恩', 40).get('f|F1') || 0) > 0.2)
  vsHash.close()
  await new Promise((r) => setTimeout(r, 1200)) // 等上一步查询补嵌批次落地，避免与新断言竞态
  calls = 0
  const vsApi2 = createVectorStore(dir, { embedder: 'api-v1', apiEmbedder })
  vsApi2.sync(mk())
  await new Promise((r) => setTimeout(r, 800))
  const stBack = vsApi2.stats()
  check('back-to-api-dim-restored', stBack.dim === 4, JSON.stringify(stBack))
  check('cache-survives-dim-switch', calls === 0, '切回 api-v1 零新请求（缓存持久）calls=' + calls)
  vsApi2.close()
  fs.rmSync(dir, { recursive: true, force: true })
  server.close()
  console.log(fails.length ? fails.length + ' FAILED' : 'ALL PASS')
  process.exit(fails.length ? 1 : 0)
})
