/* ======== 六面世界 · 发送编排器（send + 待补录流）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第八刀（最后一刀）：send() 编排器（181 行）+
 * resolvePendingFlow（41 行）。迁移前两侧 app.js 逐字相同，是双方案最大的一块共享
 * 产品逻辑：push-first 落账（回复先渲染、记账后台进行）、补丁重试闭环
 * （PC-000002：重试携带拒绝原因）、COMMIT_FAILED 不重试、流式打字机渲染、
 * 忙碌岛、中途取消（currentReqId）。
 * 依赖经 ctx 注入：稳定函数/对象在工厂顶部解构（函数体保持逐字）；cfg/kernel 是可被
 * 整体重赋值的绑定，经惰性函数取当前引用；7 个模块级可变标量经带 getter/setter 的
 * st 对象读写（状态唯一真源仍在 app.js 侧，其余代码直读 app.js 变量）。
 * 测试保护：test-choices（选项发送全链路）+ test-engine-e2e（补丁闭环/待补录）+
 * e2e-mock 双方案矩阵（发送/停止/取消/插图）。
 * 挂载：<script src="../shared/send-flow.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createSend(ctx) {
    const st = ctx.st
    const { $, api, cfg, kernel, curSession, deriveTitle, fitInput, generateIllust, illustReady, newSession, openSettings, renderMessages, renderSessionList, saveSessions, sessionDrafts, setSendButtonState, showBusyIsland, toast, touchSession, updateTitle, enginePrep, patchRetryPrompt, protocolText } = ctx
    async function send(text, opts) {
      opts = opts || {}
      const value = String(text || '').trim()
      if (st.busy) return
      if (st.engineBusy) { toast('上一回合状态正在补录，请稍候', 'info'); return }
      if (!value && !opts.regen) return
      if (!cfg().baseUrl || !cfg().apiKey || !cfg().model) {
        toast('请先在设置中填写 API 地址、密钥与模型。', 'err')
        openSettings()
        return
      }
      if (!kernel()) {
        toast('内核未加载，无法开始。', 'err')
        openSettings()
        return
      }

      const s = curSession() || newSession()
      // 发送即清空输入框（不等回复），草稿同步清除
      if (!opts.regen) {
        $('input').value = ''
        fitInput()
        sessionDrafts.delete(s.id)
      }
      if (opts.regen) {
        // 移除末尾的 assistant 消息（若有），保留其前的 user 作为上下文重发
        if (s.messages.length && s.messages[s.messages.length - 1].role === 'assistant') {
          const discarded = s.messages.pop()
          // 状态引擎：被抛弃的叙事留痕（永不静默覆盖，只增不删）
          try { api.engineDiscard({ storyId: s.id, excerpt: String(discarded.content || '').slice(0, 400), reason: 'regen' }) } catch {}
        }
      } else {
        s.messages.push({ role: 'user', content: value, at: Date.now() })
      }
      st.busy = true
      st.streaming = ''
      st.streamRenderedLen = 0
      st.currentReqId = 'r' + Date.now().toString(36)
      st.busyIsland = showBusyIsland() // R76：忙碌灵动岛（独立于 .toast，避免干扰 e2e toast 选择器）
      if (window.BloubPet) window.BloubPet.event('busy') // 桌宠：生成期间化作 thinking
      setSendButtonState(true)
      renderMessages()
      updateTitle()

      // ---- 状态引擎：确保故事存在 + 检索长期记忆（任何故障静默降级为纯对话） ----
      const engineMeta = opts.regen ? await enginePrep(s, value || (s.messages.filter((m) => m.role === 'user').pop() || {}).content || '') : await enginePrep(s, value)

      const ctxN = Math.min(64, Math.max(2, Number(cfg().ctxCount) || 24))
      const history = s.messages.slice(-ctxN).map((m) => ({ role: m.role, content: m.content }))
      const msgs = [{ role: 'system', content: kernel().text }]
      if (engineMeta && engineMeta.block) msgs.push({ role: 'system', content: engineMeta.block })
      if (engineMeta && protocolText()) msgs.push({ role: 'system', content: protocolText() })
      msgs.push(...history)
      const payload = {
        baseUrl: cfg().baseUrl,
        apiKey: cfg().apiKey,
        model: cfg().model,
        // 思考程度（提供商支持 reasoning_effort 时生效，不支持自动回退默认）
        thinkLevel: cfg().thinkLevel || 'default',
        messages: msgs,
        reqId: st.currentReqId
      }

      const r = await api.sendChat(payload)
      const wasAborted = r && r.ok && r.aborted
      st.busy = false
      if (st.busyIsland) { st.busyIsland.close(); st.busyIsland = null } // R76：收纳忙碌灵动岛
      if (window.BloubPet) window.BloubPet.event(r && r.ok && r.content ? 'done' : 'error') // 桌宠：完成亮徽标 / 报错惊叹号
      if (st.streamRaf) { cancelAnimationFrame(st.streamRaf); st.streamRaf = 0 }
      st.streaming = ''
      st.streamRenderedLen = 0
      st.currentReqId = null
      setSendButtonState(false)

      if (r && r.ok && r.content) {
        // ---- 状态引擎：先入列立即可读，后补账（条款 15-22/25/28/30）----
        // 时序原则：阅读永不被记账阻塞。回复一到就 push + 渲染（选项立即可点），
        // 记账（提交/补录重试）随后进行；需要补录时消息挂 committing 标记实时可见。
        let narrative = r.content
        let pendingId = null
        let patchStatus = null
        let patchReason = ''
        if (engineMeta) {
          try {
            const cx = await api.engineCommit(Object.assign({ storyId: engineMeta.storyId, sessionId: engineMeta.sessionId, playerInput: engineMeta.playerInput, intent: engineMeta.playerInput.slice(0, 200), model: cfg().model, retrievedIds: engineMeta.retrievedIds, contextSize: engineMeta.contextSize, raw: r.content, retryCount: 0 }))
            if (cx && cx.data) {
              if (cx.data.narrative) narrative = cx.data.narrative
              pendingId = cx.data.pending_id || null
              patchStatus = cx.data.patch_status || null
              if (cx.data.errors && cx.data.errors[0] && cx.data.errors[0].message) patchReason = String(cx.data.errors[0].message).slice(0, 300)
            }
          } catch { /* 引擎故障不阻断叙事 */ }
        }
        // 立即入列：committed（正常）/ committing（需补录，记账进行中）/ pending（确定性失败）
        // 可重试补录 = 有 pending 且不是确定性的 COMMIT_FAILED（后者直接亮待补录徽标，不再耗一次模型调用）
        const retryable = !!(engineMeta && pendingId && patchStatus && patchStatus !== 'COMMIT_FAILED')
        const needCommit = !!(engineMeta && pendingId)
        const msg = { role: 'assistant', content: narrative, at: Date.now(), pending: needCommit ? (pendingId || true) : undefined, committing: retryable }
        s.messages.push(msg)
        // 首条叙事确定会话标题
        if (s.title === '新世界线') {
          s.title = deriveTitle(narrative)
          renderSessionList()
        }
        if (wasAborted) toast('已停止生成（保留已生成内容）', 'info')
        // 后台时通知：生成完成（点通知回到窗口）
        api.notify({ title: '六面世界 · 世界回应已就绪', body: (s.title || '') + ' 的新一幕已生成' + (r.partial ? '（网络中断，内容不完整）' : '') }).catch(() => {})

        // ---- 记账：缺失/损坏时静默重试（后台，不阻塞阅读） ----
        if (engineMeta) {
          const commitBase = { storyId: engineMeta.storyId, sessionId: engineMeta.sessionId, playerInput: engineMeta.playerInput, intent: engineMeta.playerInput.slice(0, 200), model: cfg().model, retrievedIds: engineMeta.retrievedIds, contextSize: engineMeta.contextSize }
          // 需要补录：消息先亮「记账中」，跑完再落地（成功撤标记 / 失败留待补录）
          if (needCommit && retryable) {
            msg.committing = true
            renderMessages()
            ;(async () => {
              let pendingKept = false
              st.engineBusy = true // 补录期间禁止并发发送/重生成（消息顺序保证），但阅读与选择不受影响
              try {
                const retryMsgs = msgs.concat([
                  { role: 'assistant', content: narrative },
                  // 拒绝原因必须带上：实测 deepseek 会把 threads[update] 写成 ACTIVE（合法 RESOLVED|ABANDONED），
                  // 不带原因的盲重试会原样重蹈（test-memory-real PC-000002）；MISSING 没有原因可言，传 null
                  { role: 'user', content: patchRetryPrompt(patchStatus === 'PATCH_MISSING' ? null : (patchReason || null)) }
                ])
                const rr = await api.sendChat(Object.assign({}, payload, { messages: retryMsgs, reqId: 'rp' + Date.now().toString(36), silent: true }))
                if (rr && rr.ok && rr.content) {
                  const cm2 = await api.engineCommit(Object.assign({}, commitBase, { raw: rr.content, pendingId, retryCount: 1 }))
                  if (cm2 && cm2.data && cm2.data.committed) {
                    toast('状态已补录（模型首轮缺状态块）', 'ok', 3200)
                  } else {
                    pendingKept = true
                  }
                } else pendingKept = true
              } catch { pendingKept = true }
              st.engineBusy = false
              msg.committing = false
              msg.pending = pendingKept ? (pendingId || true) : undefined
              saveSessions()
              renderMessages()
              if (pendingKept) toast('本回合状态未正式提交，已记录待补录（重启不丢失）', 'err', 6000)
            })()
          } else if (needCommit) {
            // COMMIT_FAILED：确定性失败，后台重试必然重蹈覆辙——直接亮待补录徽标（不耗模型调用）
            toast('本回合状态未正式提交，已记录待补录（重启不丢失）', 'err', 6000)
          }
        }
      } else if (r && r.ok && r.aborted) {
        // 没有收到任何内容也取消了
        toast('已停止生成', 'info')
      } else {
        const errMsg = (r && r.error) || '未知错误'
        s.messages.push({ role: 'assistant', content: '⚠️ [[世界引擎报错]]\n' + errMsg })
        toast('世界引擎报错：' + errMsg, 'err')
        api.notify({ title: '六面世界 · 生成失败', body: String(errMsg).slice(0, 120) }).catch(() => {})
      }
      // 累计本轮 token 用量到当前世界线（主进程从 usage 字段解析）
      if (r && r.ok && r.usage) {
        const u = r.usage
        s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
        s.tokens.prompt += Number(u.prompt_tokens) || 0
        s.tokens.completion += Number(u.completion_tokens) || 0
        s.tokens.total += Number(u.total_tokens) || 0
        // 部分端点在 usage 里带回费用（如有则累计，右上角用量面板展示）
        const c = Number(u.cost != null ? u.cost : (r.cost != null ? r.cost : NaN))
        if (Number.isFinite(c)) s.tokens.cost = (s.tokens.cost || 0) + c
        saveSessions()
      }
      const keepN = Math.min(400, Math.max(8, Number(cfg().keepCount) || 80))
      if (s.messages.length > keepN) s.messages = s.messages.slice(s.messages.length - keepN)
      touchSession()
      renderMessages()
      updateTitle()

      // 自动插图：为刚生成的叙事生成
      const last = s.messages.length - 1
      if (r && r.ok && r.content && cfg().illustAuto && illustReady() && last >= 0) {
        generateIllust(last, false, true)
      }
    }

    function streamVisibleLen() {
      let cut = st.streaming.length
      for (const mk of ctx.STREAM_MARKS) {
        const i = st.streaming.indexOf(mk)
        if (i !== -1) cut = Math.min(cut, i)
      }
      if (cut < st.streaming.length) return cut
      const hold = Math.min(st.streaming.length, ctx.STREAM_MARK.length - 1)
      for (let k = hold; k > 0; k--) {
        if (ctx.STREAM_MARK.startsWith(st.streaming.slice(st.streaming.length - k))) return st.streaming.length - k
      }
      return st.streaming.length
    }
    function flushStream() {
      st.streamRaf = 0
      if (!st.busy) return
      const shown = st.streaming.slice(0, streamVisibleLen())
      if (shown.length === st.streamRenderedLen) return
      const bodies = ctx.msgEl.querySelectorAll('.msg.assistant .msg-body')
      const last = bodies[bodies.length - 1]
      if (!last) return
      const firstNode = last.firstChild
      if (firstNode && firstNode.nodeType === Node.TEXT_NODE && firstNode.data.length === st.streamRenderedLen && shown.length > st.streamRenderedLen) {
        // 常规路径：文本节点内容恰好等于已渲染前缀 → 追加增量即可
        firstNode.appendData(shown.slice(st.streamRenderedLen))
      } else {
        // 冷启动/外部重绘后：整体重建一次（含光标），之后回到追加路径
        last.textContent = ''
        last.appendChild(document.createTextNode(shown))
        const dot = document.createElement('span')
        dot.className = 'stream-dot'
        dot.textContent = ' ▍'
        last.appendChild(dot)
      }
      st.streamRenderedLen = shown.length
      ctx.autoScroll()
    }
    function appendStream(piece) {
      st.streaming += piece
      if (!st.streamRaf) st.streamRaf = requestAnimationFrame(flushStream)
    }

    return { send, appendStream, flushStream }
  }

  function createResolvePendingFlow(ctx) {
    const st = ctx.st
    const { $, api, cfg, kernel, curSession, renderMessages, toast, enginePrep, patchRetryPrompt, protocolText, seedProtocolText, refreshPendingBanner } = ctx
    async function resolvePendingFlow(pendingId) {
      const s = curSession()
      if (!s || st.busy || st.engineBusy) return
      let targets = []
      try {
        const lr = await api.enginePendings({ storyId: s.id })
        const list = (lr && lr.ok && Array.isArray(lr.data)) ? lr.data : []
        targets = list.filter((x) => !pendingId || x.pending_id === pendingId)
      } catch { return }
      if (!targets.length) { toast('没有待补录的回合', 'info', 2200); refreshPendingBanner(); return }
      st.busy = true
      let okN = 0
      try {
        if (!protocolText()) { const pr = await api.engineProtocol(); if (pr && pr.ok) seedProtocolText(pr.data) }
        for (const pc of targets) {
          try {
            const prep = await enginePrep(s, pc.player_input || '')
            const msgs2 = [{ role: 'system', content: kernel().text }]
            if (prep && prep.block) msgs2.push({ role: 'system', content: prep.block })
            if (protocolText()) msgs2.push({ role: 'system', content: protocolText() })
            msgs2.push({ role: 'user', content: pc.player_input || '（玩家行动）' })
            msgs2.push({ role: 'assistant', content: pc.narrative || '' })
            // 挂起时记录的拒绝原因必须回传（实测：threads[update] 写成 ACTIVE 这类校验错，盲重试会原样重蹈）
            // 仅存状态码（PATCH_MISSING 等）时没有可解释的原因，退回通用补录提示词
            const pcErr = String(pc.patch_error || '').trim()
            msgs2.push({ role: 'user', content: patchRetryPrompt(/^PATCH_[A-Z_]+$/.test(pcErr) ? null : (pcErr.slice(0, 300) || null)) })
            const rr = await api.sendChat({ baseUrl: cfg().baseUrl, apiKey: cfg().apiKey, model: cfg().model, thinkLevel: cfg().thinkLevel || 'default', messages: msgs2, reqId: 'rp' + Date.now().toString(36), silent: true })
            if (rr && rr.ok && rr.content) {
              const rs = await api.engineResolvePending({ storyId: s.id, pendingId: pc.pending_id, raw: rr.content })
              if (rs && rs.ok && rs.data && rs.data.resolved) okN++
            }
          } catch { /* 单条失败不影响其余补录 */ }
        }
      } finally {
        st.busy = false
        toast(okN === targets.length ? ('已补录 ' + okN + ' 条回合状态') : ('补录完成 ' + okN + '/' + targets.length + '（其余保持待补录）'), okN ? 'ok' : 'err', 5000)
        refreshPendingBanner()
        renderMessages()
      }
    }
    return resolvePendingFlow
  }

  window.SendFlow = { createSend, createResolvePendingFlow }
})()
