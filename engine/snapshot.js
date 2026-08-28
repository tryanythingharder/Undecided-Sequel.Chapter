'use strict'
/* Snapshot / Restore —— 完整状态快照（条款 33/34/35）
 * 快照按 story_id 归属存独立文件；恢复时校验 story 归属，跨故事恢复直接拒绝。
 */

const { createStory, ENGINE_VERSION } = require('./schema')

function createSnapshot(store, story, label) {
  if (!story || !story.story_id) throw new Error('snapshot: invalid story')
  const snapId = 'SNP-' + String(++story.counters.snapshot).padStart(6, '0')
  const data = {
    snapshot_id: snapId,
    story_id: story.story_id,
    label: String(label || ('Turn ' + story.counters.turn)).slice(0, 120),
    turn: story.counters.turn,
    created_at: Date.now(),
    engine_version: ENGINE_VERSION,
    // 全量状态（含九大 Ledger / 实体 / 玩家 / 场景 / 计数器）
    state: JSON.parse(JSON.stringify(story, (k, v) => (k === '_nameIndex' ? undefined : v)))
  }
  store.writeSnapshot(story.story_id, snapId, data)
  return { snapshot_id: snapId, story_id: story.story_id, label: data.label, turn: data.turn, created_at: data.created_at }
}

function restoreSnapshot(store, storyId, snapshotId) {
  const data = store.readSnapshot(storyId, snapshotId)
  if (!data) throw new Error('snapshot not found: ' + snapshotId)
  // 条款 35：跨故事恢复硬闸
  if (data.story_id !== storyId) throw new Error('cross-story snapshot restore blocked: snapshot belongs to ' + data.story_id + ', requested ' + storyId)
  const story = JSON.parse(JSON.stringify(data.state))
  story._nameIndex = null // 重建索引
  if (!story.counters || story.schema_version !== ENGINE_VERSION) throw new Error('snapshot incompatible engine version')
  return story
}

module.exports = { createSnapshot, restoreSnapshot }
