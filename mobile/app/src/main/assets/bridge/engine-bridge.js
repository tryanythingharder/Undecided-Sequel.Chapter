'use strict'
/* 六面世界 · 移动端引擎桥
 *
 * 在嵌入式 V8（Javet, V8 模式）中运行桌面版故事状态引擎（engine/*.js，一行不改）。
 * 与桌面（Electron 主进程 + node:fs）的全部差异集中在本文件：
 *   1. 模块加载：宿主（Kotlin）把 assets 里的 engine/*.js 源码注入 globalThis.__files，
 *      这里实现一个最小 CommonJS require（含 fs/path/crypto 三个内建垫片）。
 *   2. 文件系统：内存虚拟 fs（__state.files）。启动时由 __engineInit 注入磁盘现状（seed），
 *      每次引擎调用后宿主调用 __fsFlushJson() 取走脏文件并负责真实落盘（原子写 + 删除）。
 *   3. crypto：index.js 用 crypto.createHash('sha1') 做内核版本绑定 —— 这里用纯 JS SHA-1
 *      （UTF-8 编码，中文安全）；randomUUID 用 Math.random 版本（仅会话 ID 用途）。
 *   4. SharedArrayBuffer：store.js 的 Windows rename 重试退避用到它，安卓路径上 rename
 *      永远是内存操作不会触发退避；此处再做一层无操作降级兜底。
 * 与宿主的全部通信只依赖两个宿主 API（均已对照 Javet 官方 README 验证）：
 *   - V8Runtime.getExecutor(script).executeString()  （脚本必须以字符串表达式收尾）
 *   - V8Host.getV8Instance().createV8Runtime()
 * 契约（Kotlin 侧 EngineRuntime 依此实现）：
 *   __engineInit(payloadJson) -> '{"ok":true}'          启动：dataDir + 磁盘 seed
 *   __engineApi(name, payloadJson) -> resultJson        与桌面 ipcMain.handle 同名的 API 面
 *   __fsFlushJson() -> {"绝对路径": "内容"|null, ...}    脏文件表；null = 删除
 */

;(function () {
  if (globalThis.__bridgeLoaded) return 'already'
  globalThis.__bridgeLoaded = true

  /* ---- SharedArrayBuffer 兜底（store.js 的 Windows 退避路径在安卓不可达，仅防患） ---- */
  if (typeof globalThis.SharedArrayBuffer === 'undefined') {
    globalThis.SharedArrayBuffer = globalThis.ArrayBuffer
    globalThis.Atomics = Object.assign({}, globalThis.Atomics, {
      wait: function () { return { value: 'ok', index: 0, timeout: true } }
    })
  }

  /* ---- path 垫片（engine 只用 join/basename/dirname/normalize） ---- */
  var __path = {
    sep: '/',
    delimiter: ':',
    normalize: function (p) {
      p = String(p)
      var abs = p.charAt(0) === '/'
      var out = []
      var parts = p.split('/')
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i]
        if (!s || s === '.') continue
        if (s === '..') out.pop()
        else out.push(s)
      }
      return (abs ? '/' : '') + out.join('/')
    },
    join: function () {
      var segs = []
      for (var i = 0; i < arguments.length; i++) {
        var s = arguments[i]
        if (s === null || s === undefined || s === '') continue
        segs.push(String(s))
      }
      return __path.normalize(segs.join('/'))
    },
    resolve: function () { return __path.join.apply(null, arguments) },
    basename: function (p) {
      p = String(p)
      var i = p.lastIndexOf('/')
      return i === -1 ? p : p.slice(i + 1)
    },
    dirname: function (p) {
      p = String(p)
      var i = p.lastIndexOf('/')
      if (i <= 0) return i === 0 ? '/' : '.'
      return p.slice(0, i)
    },
    isAbsolute: function (p) { return String(p).charAt(0) === '/' },
    extname: function (p) {
      var b = __path.basename(p)
      var i = b.lastIndexOf('.')
      return i <= 0 ? '' : b.slice(i)
    }
  }

  /* ---- 纯 JS SHA-1（UTF-8；结果与 node:crypto 对齐，tools/bridge-test.mjs 已校验） ---- */
  function __sha1Hex(input) {
    var str = unescape(encodeURIComponent(String(input)))
    var bytes = []
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff)
    var bitLen = bytes.length * 8
    var hi = Math.floor(bitLen / 0x100000000)
    var lo = bitLen >>> 0
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) bytes.push(0)
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff)
    bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff)
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0
    var w = new Array(80)
    for (var off = 0; off < bytes.length; off += 64) {
      for (var a = 0; a < 16; a++) {
        var j = off + a * 4
        w[a] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) | 0
      }
      for (var b = 16; b < 80; b++) {
        var n = w[b - 3] ^ w[b - 8] ^ w[b - 14] ^ w[b - 16]
        w[b] = ((n << 1) | (n >>> 31)) | 0
      }
      var A = h0, B = h1, C = h2, D = h3, E = h4
      for (var t = 0; t < 80; t++) {
        var f, k
        if (t < 20) { f = (B & C) | (~B & D); k = 0x5A827999 }
        else if (t < 40) { f = B ^ C ^ D; k = 0x6ED9EBA1 }
        else if (t < 60) { f = (B & C) | (B & D) | (C & D); k = 0x8F1BBCDC }
        else { f = B ^ C ^ D; k = 0xCA62C1D6 }
        var tmp = ((((A << 5) | (A >>> 27)) + (f >>> 0) + (E >>> 0) + k + (w[t] >>> 0)) | 0) >>> 0
        E = D; D = C; C = ((B << 30) | (B >>> 2)) | 0; B = A; A = tmp
      }
      h0 = (h0 + A) | 0; h1 = (h1 + B) | 0; h2 = (h2 + C) | 0; h3 = (h3 + D) | 0; h4 = (h4 + E) | 0
    }
    var hex = '0123456789abcdef'
    var out = ''
    var hs = [h0, h1, h2, h3, h4]
    for (var q = 0; q < hs.length; q++) {
      var h = hs[q] >>> 0
      for (var d = 7; d >= 0; d--) out += hex[(h >>> (d * 4)) & 0xf]
    }
    return out
  }

  function __uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /* ---- crypto 垫片（engine/index.js 只用 createHash('sha1')） ---- */
  var __crypto = {
    createHash: function (algo) {
      if (String(algo).toLowerCase() !== 'sha1') throw new Error('engine-bridge crypto shim: 仅支持 sha1，收到 ' + algo)
      var buf = ''
      return {
        update: function (d) { buf += String(d); return this },
        digest: function (enc) {
          if (enc !== undefined && String(enc) !== 'hex') throw new Error('engine-bridge crypto shim: digest 仅支持 hex')
          return __sha1Hex(buf)
        }
      }
    },
    randomUUID: function () { return __uuid() },
    randomBytes: function (n) {
      var out = []
      for (var i = 0; i < Number(n) || 0; i++) out.push((Math.random() * 256) | 0)
      return out
    }
  }

  /* ---- 内存虚拟 fs（真实落盘由 Kotlin 在每次引擎调用后完成） ---- */
  var __state = {
    dataDir: '',
    files: Object.create(null), // 绝对路径 -> 文本内容
    dirty: Object.create(null)  // 绝对路径 -> 内容 | null(删除)
  }

  var __fs = {
    mkdirSync: function () { return undefined }, // 虚拟目录树随文件自动存在
    existsSync: function (p) {
      var f = String(p)
      if (Object.prototype.hasOwnProperty.call(__state.files, f)) return true
      var pref = f + '/'
      for (var key in __state.files) {
        if (key.lastIndexOf(pref, 0) === 0) return true
      }
      return false
    },
    readFileSync: function (p) {
      var f = String(p)
      if (Object.prototype.hasOwnProperty.call(__state.files, f)) return __state.files[f]
      throw new Error('ENOENT: no such file or directory, open \'' + f + '\'')
    },
    writeFileSync: function (p, data) {
      var f = String(p)
      var content = data === undefined || data === null ? '' : String(data)
      __state.files[f] = content
      __state.dirty[f] = content
      return undefined
    },
    appendFileSync: function (p, data) {
      var f = String(p)
      var content = (__state.files[f] || '') + String(data)
      __state.files[f] = content
      __state.dirty[f] = content
      return undefined
    },
    readdirSync: function (p) {
      var dir = String(p)
      if (dir.length > 1 && dir.charAt(dir.length - 1) === '/') dir = dir.slice(0, -1)
      var seen = Object.create(null)
      var out = []
      var pref = dir + '/'
      for (var key in __state.files) {
        if (key === dir || key.lastIndexOf(pref, 0) !== 0) continue
        var rest = key.slice(pref.length)
        var slash = rest.indexOf('/')
        var name = slash === -1 ? rest : rest.slice(0, slash)
        if (!seen[name]) { seen[name] = true; out.push(name) }
      }
      return out
    },
    unlinkSync: function (p) {
      var f = String(p)
      if (!Object.prototype.hasOwnProperty.call(__state.files, f)) {
        throw new Error('ENOENT: no such file or directory, unlink \'' + f + '\'')
      }
      delete __state.files[f]
      __state.dirty[f] = null
      return undefined
    },
    renameSync: function (from, to) {
      var a = String(from)
      var b = String(to)
      if (!Object.prototype.hasOwnProperty.call(__state.files, a)) {
        throw new Error('ENOENT: no such file or directory, rename \'' + a + '\' -> \'' + b + '\'')
      }
      __state.files[b] = __state.files[a]
      delete __state.files[a]
      __state.dirty[b] = __state.files[b]
      __state.dirty[a] = null
      return undefined
    },
    rmSync: function (p) {
      var f = String(p)
      var pref = f + '/'
      var victims = []
      for (var key in __state.files) {
        if (key === f || key.lastIndexOf(pref, 0) === 0) victims.push(key)
      }
      for (var i = 0; i < victims.length; i++) {
        delete __state.files[victims[i]]
        __state.dirty[victims[i]] = null
      }
      return undefined
    }
  }

  /* ---- CommonJS 加载器（engine/*.js 源码来自宿主注入的 __files） ---- */
  var __mods = Object.create(null)

  function __resolveSpec(fromDir, rel) {
    var spec = String(rel)
    if (spec.indexOf('node:') === 0) spec = spec.slice(5)
    var base
    if (spec.charAt(0) === '.') base = __path.normalize((fromDir || '.') + '/' + spec)
    else base = spec
    if (/\.js$/.test(base)) return base
    var candidates = [base, base + '.js', base + '/index.js']
    for (var i = 0; i < candidates.length; i++) {
      if (Object.prototype.hasOwnProperty.call(__files, candidates[i])) return candidates[i]
    }
    throw new Error('module not found: ' + rel + ' (from ' + (fromDir || '.') + ')')
  }

  function __require(fromDir, rel) {
    var spec = String(rel)
    if (spec.indexOf('node:') === 0) spec = spec.slice(5)
    if (spec === 'fs') return __fs
    if (spec === 'path') return __path
    if (spec === 'crypto') return __crypto
    var resolved = __resolveSpec(fromDir, spec)
    if (__mods[resolved]) return __mods[resolved].exports
    var module = { exports: {} }
    __mods[resolved] = module
    var dir = __path.dirname(resolved)
    var fn = new Function('require', 'module', 'exports', '__dirname', '__filename', __files[resolved])
    fn(function (r) { return __require(dir, r) }, module, module.exports, dir, resolved)
    return module.exports
  }

  /* ---- 引擎实例与 API 面（逐条对齐桌面 main.cjs 的 ipcMain.handle） ---- */
  var __engineFactory = null
  var __storyEngine = null

  function __engineFor() {
    if (!__engineFactory) __engineFactory = __require('', 'engine/index.js')
    if (!__storyEngine) __storyEngine = __engineFactory.createEngine(__state.dataDir)
    return __storyEngine
  }

  var __api = {
    ensure: function (p) {
      var r = __engineFor().ensureStory({
        storyId: p.storyId, title: p.title, kernelId: p.kernelId, kernelText: p.kernelText
      })
      return {
        story_id: p.storyId, created: r.created,
        kernel_version: r.kernel_version, kernel_match: r.kernel_match,
        turn: r.story.counters.turn
      }
    },
    context: function (p) {
      // 条款 6/7/8：玩家路径强制 PLAYER 级别（与桌面 main.cjs 一致）
      var r = __engineFor().buildContext(p.storyId, {
        playerInput: p.playerInput, entityNames: p.entityNames, limit: p.limit, accessLevel: 'PLAYER'
      })
      return {
        block: r.block, overview: r.overview,
        retrieved_ids: r.retrieved.retrieved_ids, context_size: r.block.length
      }
    },
    commit: function (p) {
      var eng = __engineFor()
      var r = eng.commitFromRaw(p.raw, {
        storyId: p.storyId, sessionId: p.sessionId, playerInput: p.playerInput,
        intent: p.intent, model: p.model, rawOutput: p.raw,
        retrievedIds: p.retrievedIds, contextSize: p.contextSize
      })
      // 条款 15/18/19/28：未正式提交且非显式 NO_STATE_CHANGE → 落 Pending Commit
      if (r.committed) {
        if (p.pendingId) {
          try { eng.discardPending({ storyId: p.storyId, pendingId: p.pendingId }); r.pending_resolved = true } catch (e) { }
        }
        return r
      }
      if (r.patch_status === 'NO_STATE_CHANGE') return r
      try {
        if (p.pendingId) {
          var pc = eng.getPending(p.storyId, p.pendingId)
          if (pc) { // 重试仍未成功：更新既有 Pending（retry_count 递增，不另建）
            pc.retry_count = (pc.retry_count || 0) + (Number(p.retryCount) || 1)
            pc.patch_error = (r.errors && r.errors.length ? r.errors[0].message : (r.warnings[0] && r.warnings[0].message) || r.patch_status || 'unknown')
            pc.updated_at = Date.now()
            eng.store.savePending(pc)
            r.pending_id = pc.pending_id; r.pending_recorded = true
            return r
          }
        }
        var rec = eng.recordPending({
          storyId: p.storyId, sessionId: p.sessionId, playerInput: p.playerInput,
          narrative: r.narrative || p.raw,
          patchError: (r.errors && r.errors.length ? r.errors[0].message : (r.warnings[0] && r.warnings[0].message) || r.patch_status || ''),
          retryCount: Number(p.retryCount) || 0, turnId: r.turn_id,
          stateVersion: (eng.overview(p.storyId) || {}).engine_turn
        })
        r.pending_id = rec.pending_id; r.pending_recorded = true
      } catch (e) { r.pending_error = String((e && e.message) || e) }
      return r
    },
    pendings: function (p) { return __engineFor().listPendings(p.storyId) },
    resolvePending: function (p) { return __engineFor().resolvePending({ storyId: p.storyId, pendingId: p.pendingId, raw: p.raw }) },
    discardPending: function (p) { return __engineFor().discardPending({ storyId: p.storyId, pendingId: p.pendingId }) },
    overview: function (p) { return __engineFor().overview(p.storyId) },
    snapshot: function (p) { return __engineFor().snapshot(p.storyId, p.label) },
    snapshots: function (p) { return __engineFor().listSnapshots(p.storyId) },
    restore: function (p) {
      __engineFor().restoreSnapshot(p.storyId, p.snapshotId)
      return __engineFor().overview(p.storyId)
    },
    logs: function (p) { return __engineFor().turnLogs(p.storyId) },
    log: function (p) { return __engineFor().turnLog(p.storyId, p.turnId) },
    protocol: function () { return __engineFor().protocolPrompt() },
    listStories: function () { return __engineFor().listStories() },
    // 被抛弃的叙事留痕（重生成丢弃上一版）—— 永不静默覆盖，只增不删
    discardTurn: function (p) {
      var eng = __engineFor()
      var story = eng.getStory(p.storyId)
      if (!story) return { recorded: false }
      story.discarded_turns.push({
        at: Date.now(), reason: p.reason || 'regen',
        excerpt: String(p.excerpt || '').slice(0, 400)
      })
      if (story.discarded_turns.length > 200) story.discarded_turns = story.discarded_turns.slice(-200)
      story.updated_at = Date.now()
      eng.store.saveStory(p.storyId)
      return { recorded: true }
    }
  }

  /* ---- 宿主入口（Kotlin 经 executeString 调用；返回值必须是字符串表达式） ---- */

  globalThis.__engineInit = function (payloadJson) {
    try {
      var p = JSON.parse(String(payloadJson))
      __state.dataDir = String(p.dataDir || '')
      if (!__state.dataDir) throw new Error('__engineInit: dataDir 必填')
      __state.files = Object.create(null)
      __state.dirty = Object.create(null)
      var seed = p.files || {}
      for (var k in seed) __state.files[k] = String(seed[k])
      __mods = Object.create(null)
      __engineFactory = null
      __storyEngine = null
      return JSON.stringify({ ok: true })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e && e.message) || e) })
    }
  }

  globalThis.__engineApi = function (name, payloadJson) {
    try {
      var h = __api[String(name)]
      if (!h) throw new Error('unknown engine api: ' + name)
      var p = payloadJson ? JSON.parse(String(payloadJson)) : {}
      var data = h(p)
      return JSON.stringify({ ok: true, data: data === undefined ? null : data })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String((e && e.message) || e) })
    }
  }

  globalThis.__fsFlushJson = function () {
    var out = {}
    for (var k in __state.dirty) out[k] = __state.dirty[k]
    __state.dirty = Object.create(null)
    return JSON.stringify(out)
  }

  return 'bridge-ok'
})()
