/* ======== 六面世界 · 引擎流程（补丁重试提示 + 引擎准备）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第五刀：engine-flow 集群（patchRetryPrompt /
 * PATCH_RETRY_PROMPT / enginePrep）。迁移前两侧 app.js 逐字相同（46 行）。
 * 依赖经 ctx 注入：api（preload 桥）、curWs / currentKernelRef / kernel（内核对象
 * 可被整体重赋值，经 getter 取当前引用）。engineProtocolText 协议缓存内化到本模块
 * （模块级懒取一次）；storySess 会话映射同样内化（storyId -> sessionId）。
 * enginePrep 是补丁闭环与叙事主链的公共入口：引擎任何故障都降级为纯对话（不阻断）。
 * 测试保护：test-engine-e2e.cjs（mock 模型 + 补丁闭环）+ e2e-mock.cjs 主链断言。
 * 挂载：<script src="../shared/engine-flow.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createEngineFlow(ctx) {
    const api = ctx.api
    const storySess = new Map() // storyId -> sessionId（重启应用 = 新 Session；故事记忆跨 Session 持久）
    let engineProtocolText = null // 输出协议说明书（每次运行取一次）

    function patchRetryPrompt(reason) {
      const lines = [
        '上一轮叙事已经生成。当前系统缺少合法 State Patch。',
        '请仅根据上面已经生成的叙事和当前 State，输出对应的结构化 State Patch。',
        '不要重新生成剧情。不要修改、扩写或复述已经生成的叙事。不要用 Markdown 代码围栏包裹。',
        '回复的最末尾严格按此格式输出（最小可用示例）：',
        '<<<STATE_PATCH>>>',
        '{"turn_summary":"本回合一句话概括","scene":{"game_time":"故事内时间","location":"当前地点"},"events":[{"type":"action","description":"本回合发生的主要事件","importance":30}]}',
        '<<<END_PATCH>>>',
        '需要记录玩家的决定/新事实/承诺/关系变化/伏笔，就在 JSON 里加对应键：decisions / facts / commitments / commitment_updates / relationships / threads / causal / entity_changes（键可省略，值必须是数组）。',
        '如果重新审视后确认这一回合确实没有任何状态变化，只输出一行：<<<NO_STATE_CHANGE>>>',
        '除状态块（或 NO_STATE_CHANGE）外，不要输出任何其他文字。'
      ]
      if (reason) lines.splice(1, 0, '上一轮的输出因以下原因被系统拒绝：' + reason + ' —— 请修正后重新只输出状态块；引用编号若不存在，改用内容关键词或先创建对应记录。')
      return lines.join('\n')
    }

    async function enginePrep(s, playerInput) {
      try {
        const ws = ctx.curWs()
        const kernelId = ctx.currentKernelRef()
        const kernel = ctx.kernel()
        const en = await api.engineEnsure({ storyId: s.id, title: s.title, kernelId, kernelText: kernel ? kernel.text : '' })
        if (!en || !en.ok) return null
        let sessionId = storySess.get(s.id)
        if (!sessionId) {
          sessionId = 'SES-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
          storySess.set(s.id, sessionId)
        }
        const cx = await api.engineContext({ storyId: s.id, playerInput: String(playerInput || '') })
        if (!cx || !cx.ok || !cx.data) return null
        if (engineProtocolText == null) {
          const pr = await api.engineProtocol()
          engineProtocolText = pr && pr.ok ? pr.data : ''
        }
        return {
          storyId: s.id,
          sessionId,
          // 已有结构化状态时才注入状态块（新故事第一回合无历史可注入，payload 与旧版一致）
          block: cx.data.overview && cx.data.overview.engine_turn > 0 ? cx.data.block : '',
          engineTurn: cx.data.overview ? cx.data.overview.engine_turn : 0,
          retrievedIds: cx.data.retrieved_ids || [],
          contextSize: cx.data.context_size || 0,
          playerInput: String(playerInput || '')
        }
      } catch { return null } // 引擎任何故障都不阻断叙事主流程（降级为纯对话）
    }

    return {
      patchRetryPrompt,
      enginePrep,
      // 协议文本同步给 app.js 侧的系统提示组装（懒取后直读，避免每次 IPC）
      protocolText: () => engineProtocolText,
      // 外部流程（如待补录）先于 enginePrep 需要协议文本时，直接播种缓存
      seedProtocolText: (t) => { engineProtocolText = t },
    }
  }

  window.EngineFlow = { createEngineFlow }
})()
