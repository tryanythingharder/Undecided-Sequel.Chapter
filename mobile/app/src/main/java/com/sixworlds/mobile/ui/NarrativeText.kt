package com.sixworlds.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.withStyle
import com.sixworlds.mobile.ui.theme.LocalSwColors

/**
 * 叙事结构化渲染 —— 对齐原型 S2 世界气泡内的排版：
 * 【你需要决定】→ 金色徽章；【简要状态】→ 独立小面板；正文衬线 13.5sp 行距 1.85；
 * Markdown 基础（加粗/斜体/行内码）；标题/列表/引用/代码块降级渲染。
 */
private sealed class Block {
    data class Para(val lines: List<String>) : Block()
    data class Header(val text: String) : Block()
    data class Ask(val text: String) : Block()
    data class OptionLine(val text: String) : Block()
    data class Status(val lines: List<String>) : Block()
    data class Quote(val lines: List<String>) : Block()
    data class Code(val lines: List<String>) : Block()
    data class ListItem(val text: String) : Block()
}

private val OPTION_LINE_RE = Regex("^【[A-H]】")
private val HEADER_RE = Regex("^(#{1,3})\\s+(.*)$")
private val LIST_RE = Regex("^[-*•]\\s+(.*)$")
private val INLINE_RE = Regex("\\*\\*(.+?)\\*\\*|\\*(.+?)\\*|`([^`\\n]+)`")

private fun parseBlocks(text: String, hideOptionLines: Boolean): List<Block> {
    val lines = text.replace("\r\n", "\n").split('\n')
    val blocks = mutableListOf<Block>()
    var para = mutableListOf<String>()
    fun flushPara() {
        if (para.isNotEmpty()) { blocks.add(Block.Para(para.toList())); para = mutableListOf() }
    }
    var i = 0
    while (i < lines.size) {
        val t = lines[i].trim()
        when {
            t.isEmpty() -> { flushPara(); i++ }
            t.startsWith("```") -> {
                flushPara()
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) { code.add(lines[i]); i++ }
                i++
                blocks.add(Block.Code(code))
            }
            t.startsWith("【你需要决定】") -> { flushPara(); blocks.add(Block.Ask(t)); i++ }
            OPTION_LINE_RE.containsMatchIn(t) -> {
                flushPara()
                if (!hideOptionLines) blocks.add(Block.OptionLine(t))
                i++
            }
            t.startsWith("【简要状态】") -> {
                flushPara()
                val status = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().isNotEmpty()) { status.add(lines[i].trim()); i++ }
                blocks.add(Block.Status(status))
            }
            HEADER_RE.containsMatchIn(t) -> {
                flushPara()
                blocks.add(Block.Header(HEADER_RE.find(t)!!.groupValues[2].trim()))
                i++
            }
            LIST_RE.containsMatchIn(t) -> {
                flushPara()
                blocks.add(Block.ListItem(LIST_RE.find(t)!!.groupValues[1].trim()))
                i++
            }
            t.startsWith(">") -> {
                flushPara()
                val quote = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    quote.add(lines[i].trim().removePrefix(">").trim()); i++
                }
                blocks.add(Block.Quote(quote))
            }
            else -> { para.add(t); i++ }
        }
    }
    flushPara()
    return blocks
}

private fun inline(s: String): AnnotatedString = buildAnnotatedString {
    var idx = 0
    for (m in INLINE_RE.findAll(s)) {
        if (m.range.first > idx) append(s.substring(idx, m.range.first))
        when {
            m.groupValues[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groupValues[1]) }
            m.groupValues[2].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(m.groupValues[2]) }
            else -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x22808080))) { append(m.groupValues[3]) }
        }
        idx = m.range.last + 1
    }
    if (idx < s.length) append(s.substring(idx))
}

@Composable
fun NarrativeText(
    text: String,
    modifier: Modifier = Modifier,
    hideOptionLines: Boolean = false,
    isUser: Boolean = false,
    fontSizeScale: Float = 1f,
    baseFontSize: Float = 13.5f,
    lineHeightScale: Float = 1.85f,
    serif: Boolean = true,
) {
    val c = LocalSwColors.current
    val bodySize = (baseFontSize * fontSizeScale).sp
    val lineHeight = (bodySize.value * lineHeightScale).sp
    val bodyFamily = if (serif) FontFamily.Serif else FontFamily.Default
    if (isUser) {
        Text(inline(text), modifier = modifier, color = c.text, fontSize = bodySize, lineHeight = lineHeight, fontFamily = bodyFamily)
        return
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (block in parseBlocks(text, hideOptionLines)) {
            when (block) {
                is Block.Para -> block.lines.forEach {
                    Text(inline(it), color = c.text.copy(alpha = 0.9f), fontSize = bodySize, lineHeight = lineHeight, fontFamily = bodyFamily)
                }
                is Block.Header -> Text(
                    inline(block.text), color = c.text, fontSize = (bodySize.value * 1.15f).sp,
                    fontWeight = FontWeight.Bold, fontFamily = bodyFamily,
                )
                is Block.Ask -> if (!hideOptionLines) Row(Modifier.padding(vertical = 2.dp)) {
                    Text(
                        "【你需要决定】",
                        Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(c.gold.copy(alpha = 0.12f))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        color = c.gold, fontSize = 9.sp, fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace, letterSpacing = 1.sp,
                    )
                }
                is Block.OptionLine -> Text(
                    inline(block.text), color = c.muted, fontSize = (bodySize.value * 0.9f).sp,
                    fontFamily = bodyFamily,
                )
                is Block.Status -> Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(c.bg.copy(alpha = 0.6f))
                        .border(1.dp, c.border.copy(alpha = 0.8f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    Text(
                        "【简要状态】", color = c.muted, fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace,
                    )
                    Spacer2()
                    block.lines.drop(1).forEach {
                        Text(it, color = c.muted, fontSize = 9.sp, lineHeight = 15.sp, fontFamily = FontFamily.Monospace)
                    }
                }
                is Block.Quote -> Column(Modifier.padding(start = 8.dp)) {
                    block.lines.forEach {
                        Text(
                            inline(it), color = c.textDim, fontSize = bodySize, lineHeight = lineHeight,
                            fontFamily = bodyFamily, fontStyle = FontStyle.Italic,
                        )
                    }
                }
                is Block.Code -> Column {
                    block.lines.forEach {
                        Text(it, color = c.textDim, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                    }
                }
                is Block.ListItem -> Text(
                    inline("• " + block.text), color = c.text.copy(alpha = 0.9f),
                    fontSize = bodySize, lineHeight = lineHeight, fontFamily = bodyFamily,
                )
            }
        }
    }
}

@Composable
private fun Spacer2() { SpacerMin(4) }

@Composable
private fun SpacerMin(dp: Int) {
    androidx.compose.foundation.layout.Spacer(Modifier.padding(top = dp.dp))
}
