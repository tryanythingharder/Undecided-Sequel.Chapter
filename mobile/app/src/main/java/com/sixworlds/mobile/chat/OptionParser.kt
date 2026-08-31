package com.sixworlds.mobile.chat

/**
 * 选项解析 —— 逐行移植自桌面 renderer/app.js 的 parseChoices / extractQuoteChoices，
 * 保证两端对同一叙事解析出相同的选项集合。
 *
 * parseChoices 支持：
 *  ①【A】xxx（全角括号） ②行内字母标记 A. / A、 / A) / A: ③行首数字 1. ④行首圈号 ①②③
 *  兼容全角字母/数字、行首列表符（- * • ·）与加粗星号残留。
 *
 * extractQuoteChoices 为兜底（R83）：模型没按契约输出选项但以「…」列表给出候选时提取，
 * 需要同行 ≥2 个引号项或 ≥2 个列表引号行，防止把对白/书名误判成选项。
 */
data class Choice(val key: String, val label: String)

private const val CIRCLED = "①②③④⑤⑥⑦⑧"

fun parseChoices(text: String): List<Choice> {
    val out = mutableListOf<Choice>()
    val seen = mutableSetOf<String>()

    fun normKey(k: String): String {
        val c = k.first()
        return if (c.code in 0xFF21..0xFF28) (c.code - 0xFEE0).toChar().toString() else k.uppercase()
    }

    fun push(keyRaw: String, labelRaw: String?) {
        var l = (labelRaw ?: "").trim()
        // 剥离尾部残留的选项标记（如 "label A."）——必须带标点才剥，避免误伤正常结尾字母
        l = l.replace(Regex("\\s*[A-H0-9]\\s*[.、)]\\s*$"), "")
        // 剥离残留的加粗星号（如 "**A.** label" 匹配后标签带 "**" 前缀）
        l = l.replace(Regex("^\\*\\*\\s*"), "").replace(Regex("\\s*\\*\\*$"), "").replace(Regex("^\\*\\*"), "")
        l = l.trim()
        if (l.isEmpty()) return
        // 去重按 key+文案：多组【你需要决定】块（多组 A/B/C）时只合并完全相同的选项
        val dedupe = keyRaw + "|" + l
        if (dedupe in seen) return
        seen.add(dedupe)
        out.add(Choice(keyRaw, l))
    }

    // ①【A】xxx（全角括号）
    Regex("【([A-HＡ-Ｈ])】([^【\\n]*)").findAll(text).forEach { m ->
        push(normKey(m.groupValues[1]), m.groupValues[2].replace("*", ""))
    }

    val digitRe = Regex("^([1-8１-８])\\s*[.、):：．]\\s*")
    val circRe = Regex("^([①-⑧])\\s*")
    val inlineMarkRe = Regex("(?:^|\\s)([A-HＡ-Ｈ])\\s*[.、):：．]\\s*")

    for (rawLine in text.split('\n')) {
        // 行首列表符剥离后清除全部残星号；分隔符含全角句点 ．
        val clean = rawLine.replace(Regex("^\\s*(?:[-*•·]\\s*)+"), "").replace("*", "").trim()
        val marks = inlineMarkRe.findAll(clean).map {
            Pair(normKey(it.groupValues[1]), it.range.first + it.value.length)
        }.toList()
        if (marks.isEmpty()) {
            // 行首数字标记：1. / 1、 / 1) / 1:（仅行首，避免误吞正文数字）
            val nm = digitRe.find(clean)
            if (nm != null) {
                val ch = nm.groupValues[1].first()
                val d = if (ch.code >= 0xFF11) ch.code - 0xFEE0 - '0'.code else ch - '0'
                push(('A' + d - 1).toString(), clean.substring(nm.value.length))
                continue
            }
            // 行首圈号：①②③…
            val cm = circRe.find(clean)
            if (cm != null) {
                push((64 + CIRCLED.indexOf(cm.groupValues[1].first()) + 1).toChar().toString(), clean.substring(cm.value.length))
                continue
            }
        }
        for (i in marks.indices) {
            val label = if (i + 1 < marks.size) clean.substring(marks[i].second, marks[i + 1].second).trim()
            else clean.substring(marks[i].second).trim()
            push(marks[i].first, label)
        }
    }
    return out.sortedBy { it.key }
}

fun extractQuoteChoices(text: String): List<String> {
    var inlineRun = 0 // 至少一行内并列 ≥2 个引号项
    var listRows = 0  // 以列表符开头的引号行数
    val flat = mutableListOf<String>()
    val quoteRe = Regex("「([^「」\\n]{4,60})」")
    for (raw in text.split('\n')) {
        val line = raw.trim()
        val items = quoteRe.findAll(line).map { it.groupValues[1].trim() }.filter { it.isNotEmpty() }.toList()
        if (items.isEmpty()) continue
        flat.addAll(items)
        if (items.size >= 2) inlineRun++
        if (Regex("^[-*•·]").containsMatchIn(line)) listRows++
    }
    if (flat.size < 2) return emptyList()
    if (!(inlineRun > 0 || listRows >= 2)) return emptyList()
    val seen = mutableSetOf<String>()
    val out = mutableListOf<String>()
    for (item in flat) {
        if (seen.add(item)) {
            out.add(item)
            if (out.size >= 6) break
        }
    }
    return out
}
