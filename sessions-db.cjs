'use strict'
/* Sessions SQLite 主存（P2-3 收敛）
 *
 * - 主存：<userData>/sessions.db —— 单表单行 JSON 文档，形状与旧 sessions.json 完全一致（{ v:1, sessions:[…] }）
 * - 镜像：main.cjs 保存时继续原子写 sessions.json（旧路径旧格式）——移动端进度包工具与人工恢复的兼容面不变
 * - 迁移：load 发现主存为空且旧 JSON 存在时由调用方导入（一次性，见 main.cjs sessions:load）
 * - 自愈：首开损坏 → 删库重建（此时 JSON 镜像仍在，数据不丢，可再次迁移）
 * - 降级：node:sqlite 缺失 / 任何打开异常 → enabled=false，调用方回退为纯文件路径（旧行为）
 */
const path = require('path')

function createSessionsDb(userDataDir) {
  const disabled = { enabled: false, load() { return null }, importDoc() {}, clear() {}, close() {} }
  const fs = require('fs')
  let db = null
  const dbPath = () => path.join(userDataDir, 'sessions.db')

  function open() {
    const { DatabaseSync } = require('node:sqlite')
    fs.mkdirSync(userDataDir, { recursive: true })
    db = new DatabaseSync(dbPath(), {})
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const quick = db.prepare('PRAGMA quick_check').get()
    if (!quick || !String(quick.quick_check || '').startsWith('ok')) throw new Error('sessions.db quick_check failed')
  }

  try {
    try {
      open()
    } catch (e1) {
      // 首开即坏：删除重建。JSON 镜像仍在主进程手里，重建后由调用方迁移回来，无数据损失。
      try { db && db.close() } catch {}
      db = null
      for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath() + suf) } catch {} }
      open()
      console.warn('[sessions-db] 检测到库损坏，已重建 sessions.db（等待从 JSON 镜像迁移）')
    }
  } catch (e) {
    console.warn('[sessions-db] 已停用（' + String((e && e.message) || e).slice(0, 120) + '）；回退为 sessions.json 文件存储')
    return disabled
  }

  return {
    enabled: true,
    load() {
      const row = db.prepare('SELECT payload, updated_at FROM sessions WHERE id = 1').get()
      return row ? { doc: JSON.parse(row.payload), updatedAt: row.updated_at } : null
    },
    importDoc(doc) {
      db.prepare('INSERT INTO sessions(id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
        .run(JSON.stringify(doc), Date.now())
    },
    clear() {
      db.prepare('DELETE FROM sessions WHERE id = 1').run()
    },
    close() { try { db.close() } catch {} }
  }
}

module.exports = { createSessionsDb }
