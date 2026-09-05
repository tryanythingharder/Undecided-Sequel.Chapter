/* ======== 六面世界 · 内核数据层（元数据解析 / 模板 / 发布注册表 / 设计会话存储）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第七刀：kernel-library 的纯数据层。迁移前两侧 app.js
 * 逐字相同（约 117 行）：parseKernelMeta（KERNEL_META 块解析）、KERNEL_TEMPLATE（新内核
 * 草稿模板）、KERNEL_DESIGN_SYSTEM（内核设计助手系统提示）、发布注册表
 * （KERNEL_RELEASES_KEY，状态 draft/published/archived + 版本，两方案读写同源）、
 * 设计会话存储（loadKernelDesignChats / saveKernelDesignChats / kernelChat*）、
 * loadKernel（内核装配：工作区专属 → 全局配置 → 内置）。
 * 发布注册表状态内化到本模块；当前内核源 id（kernelChatKey 的键）经 ctx.sourceId() 取。
 * 发布/保存编排（publishKernel / saveKernelEdit）两方案已分叉，留在各自 app.js。
 * 测试保护：e2e-mock.cjs kernel-* 断言 + test-choices/test-engine-e2e 内核装配链路。
 * 挂载：<script src="../shared/kernel-data.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createKernelData(ctx) {
    const $ = ctx.$
    const api = ctx.api

    // ---- 存储键（两方案同键同源） ----
    const KERNEL_DESIGN_KEY = 'sixworlds.kernel.design.v1'
    const KERNEL_DRAFT_KEY = '__draft__'
    const KERNEL_RELEASES_KEY = 'sixworlds.kernel.releases.v1'

    // ---- 元数据解析：KERNEL_META JSON 块（损坏时静默回落默认界面） ----
    function parseKernelMeta(text) {
      if (!text) return null
      const m = String(text).match(/<!--KERNEL_META\s*([\s\S]*?)\s*KERNEL_META-->/)
      if (!m) return null
      try {
        const o = JSON.parse(m[1])
        if (!o || typeof o !== 'object') return null
        const out = {}
        for (const k of ['title', 'tagline', 'startLabel', 'startPayload', 'quickLabel', 'version', 'author', 'license']) {
          if (typeof o[k] === 'string' && o[k].trim()) out[k] = o[k].trim()
        }
        if (Array.isArray(o.origins)) {
          out.origins = o.origins
            .filter((x) => x && typeof x.label === 'string' && typeof x.text === 'string' && x.label.trim() && x.text.trim())
            .map((x) => ({ label: x.label.trim(), text: x.text.trim() }))
            .slice(0, 8)
          if (!out.origins.length) delete out.origins
        }
        return out
      } catch (e) { return null } // 块损坏时静默回落默认界面
    }

    // ---- 新内核草稿模板 ----
    const KERNEL_TEMPLATE = [
      '<!--KERNEL_META',
      '{',
      '  "title": "我的世界：人生模拟器",',
      '  "tagline": "一句话介绍这个世界",',
      '  "startLabel": "开始游戏",',
      '  "origins": [',
      '    { "label": "平民之子", "text": "我出生在平凡家庭，渴望改变命运" },',
      '    { "label": "没落贵族", "text": "我出身没落贵族，背负家族期望" }',
      '  ]',
      '}',
      'KERNEL_META-->',
      '',
      '# 我的世界：人生模拟器',
      '',
      '## 一、世界设定',
      '',
      '（描述世界观：时代、地理、势力、力量体系、经济与日常。写得越具体，AI 演绎越稳定。）',
      '',
      '## 二、运行规则',
      '',
      '1. 你是【世界模拟系统】：维护时间、人物、势力与因果；玩家只是世界里出生的一个人。',
      '2. 世界不围绕玩家转动：NPC 有自己的目标与日程；玩家的特殊必须由行动挣来。',
      '3. 每一幕以场景行开头：【公历 2026.01.01｜晨｜地点】（日期自定历法，格式须保持）。',
      '4. 每一幕结尾输出【你需要决定】与 2-4 个选项，格式逐项一行：`A. 动作短句`（代价写进文案）；',
      '   琐碎回合也照给选项（继续观察 / 谨慎行动 / 主动搭话），不空缺。',
      '5. 重大改变（死亡、承诺、关系变化、获得/失去）必须真实发生并持续影响后续，不可自动回退。',
      '6. 玩家自由输入优先于选项；只记录玩家明确确认的决定。',
      '',
      '## 三、状态记录',
      '',
      '严格遵守系统注入的【状态记录协议】：每幕末尾输出状态块，记录本回合新发生的变化；',
      '纯闲聊回合输出 <<<NO_STATE_CHANGE>>>。'
    ].join('\n')

    // ---- 内核设计助手系统提示 ----
    const KERNEL_DESIGN_SYSTEM = [
      '你是一名叙事世界内核设计师，正在通用的多内核平台中与用户共同工作。',
      '内核是可独立装载的 Markdown 规则书，不能依赖某个固定世界、作品或应用品牌。',
      '你的工作是澄清目标、指出规则漏洞，并把已确认的设计同步到当前草稿。',
      '必须保留合法的 KERNEL_META JSON；正文至少覆盖世界设定、玩家身份、运行规则、因果与失败、输出格式。',
      '系统会另外注入状态记录协议，因此不要自行发明 STATE_PATCH、账本字段或引擎内部格式。',
      '',
      '回复先用简短中文说明本轮判断，再附带一种机器可应用的变更：',
      '1. 新建或大范围重写时：<<<KERNEL_MD>>>完整 Markdown<<<END_KERNEL_MD>>>',
      '2. 局部修改时：<<<KERNEL_PATCH>>>{"operations":[{"search":"草稿中唯一且完全相同的原文","replace":"替换后的完整文本"}]}<<<END_KERNEL_PATCH>>>',
      '3. 本轮只讨论取舍、尚未确认修改时：在说明末尾输出 <<<NO_KERNEL_CHANGE>>>。',
      'PATCH 的 search 必须能在当前草稿中唯一命中；不要同时输出两种变更块。',
      '不要把变更块放进 Markdown 代码围栏。'
    ].join('\n')

    // ---- 发布注册表（状态 + 版本号；两方案共用同一 localStorage 键，切方案不丢） ----
    let kernelReleases = (() => { try { const v = JSON.parse(localStorage.getItem(KERNEL_RELEASES_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } })()
    function saveKernelReleases() {
      try { localStorage.setItem(KERNEL_RELEASES_KEY, JSON.stringify(kernelReleases)) } catch { /* optional presentation metadata */ }
    }
    function kernelReleaseFor(k, meta) {
      const saved = kernelReleases[k.id]
      if (saved && typeof saved === 'object') return saved
      const version = meta && (meta.version || meta.release)
      const archived = !!(meta && (meta.archived || meta.status === 'archived'))
      return { status: archived ? 'archived' : (k.source === 'builtin' ? 'published' : 'draft'), version: version || (k.source === 'builtin' ? '1.0' : '0.1') }
    }
    // 发布登记（两侧 publishKernel 编排里调用；版本号自增语义保持各方案现有文案）
    function setKernelRelease(id, rel) { kernelReleases[id] = rel; saveKernelReleases() }
    function getKernelRelease(id) { return kernelReleases[id] }
    function bumpVersion(v) {
      const parts = String(v || '0.1').split('.')
      const next = (parts[0] || '0') + '.' + ((Number(parts[1]) || 0) + 1)
      return next
    }

    // ---- 内核设计会话存储（草稿与每个库内核独立的历史） ----
    let kernelDesignChats = loadKernelDesignChats()
    function loadKernelDesignChats() {
      try {
        const raw = JSON.parse(localStorage.getItem(KERNEL_DESIGN_KEY) || '{}')
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      } catch { return {} }
    }
    function saveKernelDesignChats() {
      try { localStorage.setItem(KERNEL_DESIGN_KEY, JSON.stringify(kernelDesignChats)) } catch { /* 忽略本地存储失败 */ }
    }
    function kernelChatKey() { return ctx.sourceId() || KERNEL_DRAFT_KEY }
    function kernelChatMessages() {
      const list = kernelDesignChats[kernelChatKey()]
      return Array.isArray(list) ? list.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-40) : []
    }
    function setKernelChatMessages(list) {
      kernelDesignChats[kernelChatKey()] = list.slice(-40)
      saveKernelDesignChats()
    }

    // ---- 内核装配：工作区专属（库 id 或旧路径）→ 全局配置 → 应用内置 kernel.md ----
    async function loadKernel() {
      let r = await ctx.resolveKernelRef(ctx.currentKernelRef())
      if (!r || !r.ok) r = await api.readKernel()
      if (r && r.ok) {
        const meta = parseKernelMeta(r.text)
        $('kernel-state').textContent = '已加载 · ' + ((meta && meta.title) || r.name || '内核')
        $('kernel-state').style.color = 'var(--ok)'
        return r
      }
      $('kernel-state').textContent = '失败'
      $('kernel-state').style.color = 'var(--danger)'
      return null
    }

    return {
      parseKernelMeta, KERNEL_TEMPLATE, KERNEL_DESIGN_SYSTEM,
      saveKernelReleases, kernelReleaseFor, setKernelRelease, getKernelRelease, bumpVersion,
      kernelChatKey, kernelChatMessages, setKernelChatMessages, saveKernelDesignChats,
      loadKernel,
      // 活引用：两侧 publishKernel / saveKernelEdit 编排直接读写对象属性后调 save*
      designChats: kernelDesignChats, releases: kernelReleases,
    }
  }

  window.KernelData = { createKernelData }
})()
