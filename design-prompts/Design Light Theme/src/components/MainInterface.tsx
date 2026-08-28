import { useRef, useState, useCallback } from "react"
import DynamicIsland, { type IslandState } from "./DynamicIsland"

interface Props {
  theme: "light" | "dark"
  setTheme: (t: "light" | "dark") => void
  islandState: IslandState
  setIslandState: (s: IslandState) => void
  onPlayIntro: () => void
}

const NOISE = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/></filter><rect width='180' height='180' filter='url(%23n)' opacity='1'/></svg>`

function glass(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: "var(--glass)",
    backdropFilter: "blur(20px) saturate(1.4)",
    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
    border: "1px solid var(--glass-border)",
    boxShadow: "inset 0 1px 0 var(--glass-highlight)",
    ...extra,
  }
}

function SceneLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px" }}>
      <span
        style={{
          display: "inline-block",
          width: 18,
          height: 2,
          background: "var(--accent)",
          borderRadius: 1,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--accent)",
          letterSpacing: "1.5px",
        }}
      >
        {children}
      </span>
    </div>
  )
}

function StatusPanel({ lines }: { lines: string[] }) {
  return (
    <div style={glass({ borderRadius: 14, padding: "10px 14px", marginTop: 12 })}>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text-dim)",
            lineHeight: 1.75,
          }}
        >
          {l}
        </div>
      ))}
    </div>
  )
}

function MsgToolbar() {
  const btns = ["复制", "重生成", "插图·重绘", "IF 分歧", "保存"]
  return (
    <div className="msg-toolbar" style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
      {btns.map((b) => (
        <button
          key={b}
          style={{
            ...glass(),
            borderRadius: 8,
            padding: "3px 9px",
            fontSize: 11,
            color: "var(--text-dim)",
            cursor: "pointer",
            fontFamily: "var(--sans)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
        >
          {b}
        </button>
      ))}
    </div>
  )
}

function KeyBadge({ label, selected }: { label: string; selected?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--mono)",
        flexShrink: 0,
        background: selected ? "var(--accent)" : "var(--accent-glow)",
        color: selected ? "var(--on-accent)" : "var(--accent)",
        transition: "background .2s, color .2s",
      }}
    >
      {label}
    </span>
  )
}

function CtrlBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...glass(),
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        color: active ? "var(--accent)" : "var(--text)",
        cursor: "pointer",
        fontFamily: "var(--sans)",
        width: "100%",
        textAlign: "left",
        transition: "color .15s",
        border: active ? "1px solid var(--accent-dim)" : "1px solid var(--glass-border)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = active ? "var(--accent)" : "var(--text)")}
    >
      {children}
    </button>
  )
}

export default function MainInterface({
  theme,
  setTheme,
  islandState,
  setIslandState,
  onPlayIntro,
}: Props) {
  const msgRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [selectedOpts, setSelectedOpts] = useState<Set<string>>(new Set())
  const [multiMode, setMultiMode] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(true)

  const handleScroll = () => {
    if (!msgRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = msgRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 80)
  }

  const scrollToBottom = useCallback(() => {
    msgRef.current?.scrollTo({ top: msgRef.current.scrollHeight, behavior: "smooth" })
  }, [])

  const toggleOpt = (opt: string) => {
    if (!multiMode) {
      setSelectedOpts(new Set([opt]))
      return
    }
    setSelectedOpts((prev) => {
      const next = new Set(prev)
      if (next.has(opt)) next.delete(opt)
      else next.add(opt)
      return next
    })
  }

  const options = [
    { key: "A", text: "坦然承认自己是外乡人，询问老者的意思" },
    { key: "B", text: "装作若无其事，转身假装看其他摊位" },
    { key: "C", text: "假装没听见，直接询问物资的价格" },
  ]

  const isDark = theme === "dark"

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--stage)",
        fontFamily: "\"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
        color: "var(--text)",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(52% 38% at 50% -6%, var(--accent-glow), transparent 68%)",
          pointerEvents: "none",
          animation: "ambient-pulse 4s ease-in-out alternate infinite",
          zIndex: 0,
        }}
      />

      {/* Film noise */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url("${NOISE}")`,
          backgroundRepeat: "repeat",
          opacity: 0.03,
          mixBlendMode: isDark ? "screen" : "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Dynamic Island */}
      <DynamicIsland state={islandState} onDismiss={() => setIslandState("hidden")} isDark={isDark} />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* ── Message flow ── */}
        <div
          ref={msgRef}
          className="msg-flow"
          onScroll={handleScroll}
          style={{
            flex: 1,
            width: "100%",
            maxWidth: 760,
            padding: "76px 24px 12px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Round 1 – historical */}
          <div className="msg-row" style={{ marginBottom: 32 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                }}
              >
                世界
              </span>
              <span
                style={{ fontSize: 11, color: "var(--text-faint)" }}
              >
                · 407.03.01 清晨
              </span>
            </div>

            <SceneLine>【甲龙历 407.03.01｜清晨｜布耶纳村】</SceneLine>

            <p
              style={{
                lineHeight: 1.85,
                color: "var(--text)",
                marginBottom: 14,
                margin: "0 0 14px",
              }}
            >
              远处的鸡鸣声划破晨雾，唤醒了这座沉睡的边陲小村。你站在草屋门口，身上只有一套破旧的麻布衣物，还有从前世带来的、隐隐约约的记忆碎片在脑海中浮沉。
              <strong>这个世界的空气比记忆中厚重许多</strong>
              ，带着泥土与草木的气息——不，还有什么，某种你说不清的魔力底蕴。
            </p>

            <StatusPanel
              lines={[
                "【简要状态】",
                "生命 ♥ 87/100　　位置 布耶纳村·草屋前",
                "持有 铜钱×3  黑面包×1  麻布外套",
                "同行 无",
              ]}
            />

            {/* Historical options – weakened */}
            <div
              style={{
                marginTop: 12,
                padding: "7px 12px",
                borderRadius: 8,
                background: isDark ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.03)",
                border: `1px solid ${"var(--border)"}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-faint)",
                  fontFamily: "\"SF Mono\", \"Cascadia Code\", Consolas, monospace",
                  letterSpacing: ".5px",
                }}
              >
                [历史] A 前往村口打探消息 · B 去集市换些必需品 · C 拜访村中长老
              </span>
            </div>

            <MsgToolbar />
          </div>

          {/* Player bubble */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 24,
            }}
          >
            <div
              style={glass({
                borderRadius: "16px 16px 6px 16px",
                padding: "10px 14px",
                maxWidth: "68%",
              })}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-faint)",
                  marginBottom: 4,
                }}
              >
                你 · 午前 10:32
              </div>
              <div style={{ lineHeight: 1.7 }}>
                我决定先去集市，用仅有的铜钱换些必需的物资，顺便打听情况。
              </div>
            </div>
          </div>

          {/* Round 2 – current */}
          <div className="msg-row" style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                }}
              >
                世界
              </span>
              <span
                style={{ fontSize: 11, color: "var(--text-faint)" }}
              >
                · 407.03.01 午前
              </span>
            </div>

            <SceneLine>【甲龙历 407.03.01｜午前｜布耶纳村·集市】</SceneLine>

            <p
              style={{
                lineHeight: 1.85,
                margin: "0 0 14px",
              }}
            >
              集市的喧嚣扑面而来——叫卖声、牲口的嘶鸣、还有几句陌生的魔法咒语在空气里回荡。你挤过人群，来到一个卖杂货的老摊主面前。老人眯眼打量你手中的铜钱，皱眉良久，
              <strong>用带着浓重乡音的语调缓缓开口</strong>：
            </p>
            <p
              style={{
                lineHeight: 1.85,
                margin: "0 0 14px",
                paddingLeft: 16,
                borderLeft: `2px solid ${isDark ? "rgba(201,139,75,.5)" : "rgba(165,100,31,.4)"}`,
                fontStyle: "italic",
                color: "var(--text-dim)",
              }}
            >
              「外乡人，这枚钱……不对劲。」
            </p>
            <p style={{ lineHeight: 1.85, margin: "0 0 16px" }}>
              他的目光突然变得警惕起来，右手悄悄向摊位下方移去。周围几个买主已经察觉到异样，开始侧目张望。
            </p>

            {/* Illustration block */}
            <div
              className="illus-block"
              style={{
                borderRadius: 18,
                marginBottom: 16,
                boxShadow: `0 18px 70px ${isDark ? "rgba(217,154,82,.34)" : "rgba(165,100,31,.22)"}`,
                aspectRatio: "16 / 9",
                background:
                  "linear-gradient(135deg, #c9955a 0%, #7c4a20 40%, #3d2010 70%, #1a0d05 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  color: "rgba(255,255,255,.35)",
                  fontSize: 12,
                  fontFamily: "\"SF Mono\", Consolas, monospace",
                  letterSpacing: "2px",
                }}
              >
                [ 集市·午前·小说插图 ]
              </span>
            </div>

            <MsgToolbar />
          </div>

          {/* ── Streaming demo ── */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 20,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-faint)",
                marginBottom: 14,
                fontFamily: "monospace",
                letterSpacing: "1px",
              }}
            >
              ─── 流式生成演示 ───
            </div>
            <div className="msg-row">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
                  世界
                </span>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  · 生成中…
                </span>
              </div>
              <SceneLine>【甲龙历 407.03.01｜午前｜集市东侧小巷】</SceneLine>
              <p style={{ lineHeight: 1.85, margin: 0 }}>
                你迈出的脚步让空气凝固了片刻。老者缓缓抬头，目光如炬——
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: "1.1em",
                    background: "var(--accent)",
                    verticalAlign: "text-bottom",
                    marginLeft: 2,
                    animation: "stream-blink .9s step-end infinite",
                  }}
                />
              </p>
            </div>
          </div>

          {/* ── Illustration states + search highlight demo ── */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 20,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-faint)",
                marginBottom: 14,
                fontFamily: "monospace",
                letterSpacing: "1px",
              }}
            >
              ─── 插图状态 / 搜索高亮演示 ───
            </div>

            {/* Illustration – pending */}
            <div
              style={{
                borderRadius: 18,
                marginBottom: 12,
                aspectRatio: "16 / 9",
                border: "1px dashed var(--border-strong)",
                background: "var(--glass)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  letterSpacing: "1px",
                }}
              >
                正在绘制这一幕的插图…
              </span>
              <span
                style={{
                  width: 120,
                  height: 2,
                  borderRadius: 2,
                  background:
                    "linear-gradient(90deg, transparent, var(--accent), transparent)",
                  backgroundSize: "40% 100%",
                  backgroundRepeat: "no-repeat",
                  animation: "scanline-sweep 1.4s linear infinite",
                }}
              />
            </div>

            {/* Illustration – error */}
            <div
              style={{
                borderRadius: 14,
                marginBottom: 16,
                padding: "10px 14px",
                background: "rgba(224,107,107,.07)",
                border: "1px solid rgba(224,107,107,.25)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--danger)", flex: 1 }}>
                插图生成失败：请求超时
              </span>
              <button
                style={{
                  background: "transparent",
                  border: "1px solid rgba(224,107,107,.3)",
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: 12,
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontFamily: "var(--sans)",
                }}
              >
                ↻ 重试绘制
              </button>
            </div>

            {/* Search highlight */}
            <p
              style={{
                lineHeight: 1.85,
                margin: 0,
                color: "var(--text-dim)",
                fontSize: 14,
              }}
            >
              搜索「铜钱」时的命中效果：他掂了掂你递来的
              <mark
                style={{
                  background: "var(--accent-glow)",
                  color: "var(--accent)",
                  borderRadius: 3,
                  padding: "0 3px",
                }}
              >
                铜钱
              </mark>
              ，又看了看摊位上成色相同的
              <mark
                style={{
                  background: "var(--accent-glow)",
                  color: "var(--accent)",
                  borderRadius: 3,
                  padding: "0 3px",
                }}
              >
                铜钱
              </mark>
              ，眉头皱得更深了。
            </p>
          </div>

          {/* ── Error demo ── */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 20,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-faint)",
                marginBottom: 14,
                fontFamily: "monospace",
                letterSpacing: "1px",
              }}
            >
              ─── 错误消息演示 ───
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: isDark
                  ? "rgba(224,107,107,.07)"
                  : "rgba(200,70,70,.05)",
                border: `1px solid ${isDark ? "rgba(224,107,107,.25)" : "rgba(200,70,70,.2)"}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle
                  cx="7.5"
                  cy="7.5"
                  r="6.5"
                  stroke={isDark ? "#e06b6b" : "#c84646"}
                  strokeWidth="1.4"
                />
                <path
                  d="M7.5 4.5v3.5M7.5 10v.5"
                  stroke={isDark ? "#e06b6b" : "#c84646"}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <span
                style={{
                  fontSize: 13,
                  color: isDark ? "#e06b6b" : "#c84646",
                  flex: 1,
                }}
              >
                API 响应超时，这一回合生成失败。
              </span>
              <button
                style={{
                  background: "transparent",
                  border: `1px solid ${isDark ? "rgba(224,107,107,.3)" : "rgba(200,70,70,.3)"}`,
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: 12,
                  color: isDark ? "#e06b6b" : "#c84646",
                  cursor: "pointer",
                  fontFamily: "var(--sans)",
                }}
              >
                ↻ 重试这一回合
              </button>
            </div>
          </div>

          {/* ── Empty state demo ── */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 32,
              marginBottom: 40,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-faint)",
                marginBottom: 24,
                fontFamily: "monospace",
                letterSpacing: "1px",
              }}
            >
              ─── 空状态演示（新世界线）───
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                padding: "20px 0 8px",
              }}
            >
              {/* Diamond emblem */}
              <div
                style={{
                  width: 54,
                  height: 54,
                  background: isDark
                    ? "rgba(217,154,82,.16)"
                    : "rgba(165,100,31,.1)",
                  border: `1.5px solid ${isDark ? "rgba(201,139,75,.4)" : "rgba(165,100,31,.3)"}`,
                  transform: "rotate(45deg)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    transform: "rotate(-45deg)",
                    fontSize: 22,
                    display: "block",
                  }}
                >
                  ⬡
                </span>
              </div>

              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  六面世界
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--text-dim)",
                  }}
                >
                  世界已就绪，等待第一个转生者
                </div>
              </div>

              {/* Preset chips */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  justifyContent: "center",
                  marginTop: 4,
                }}
              >
                {["平民之子", "贵族血脉", "魔物之力", "无名浪人"].map(
                  (preset) => (
                    <button
                      key={preset}
                      style={glass({
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "inherit",
                        transition: "color .15s, box-shadow .2s",
                      })}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = isDark
                          ? "#c98b4b"
                          : "#a5641f"
                        e.currentTarget.style.boxShadow = `0 0 0 1.5px ${isDark ? "rgba(201,139,75,.5)" : "rgba(165,100,31,.4)"}`
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "inherit"
                        e.currentTarget.style.boxShadow =
                          "inset 0 1px 0 var(--glass-highlight)"
                      }}
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>

              <button
                style={{
                  background: "var(--accent)",
                  color: isDark ? "#241c10" : "#ffffff",
                  border: "none",
                  borderRadius: 12,
                  padding: "11px 28px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: `0 4px 20px ${isDark ? "rgba(217,154,82,.34)" : "rgba(165,100,31,.22)"}`,
                  transition: "transform .25s, box-shadow .25s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)"
                  e.currentTarget.style.boxShadow = `0 8px 28px ${isDark ? "rgba(217,154,82,.5)" : "rgba(165,100,31,.35)"}`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ""
                  e.currentTarget.style.boxShadow = `0 4px 20px ${isDark ? "rgba(217,154,82,.34)" : "rgba(165,100,31,.22)"}`
                }}
              >
                开始游戏
              </button>

              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-faint)",
                  background: isDark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)",
                  borderRadius: 8,
                  padding: "5px 12px",
                  border: `1px solid ${"var(--border)"}`,
                }}
              >
                ⚠ 尚未配置 API Key — 前往设置完成接入
              </div>
            </div>
          </div>
        </div>

        {/* Scroll to bottom */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            style={{
              position: "absolute",
              bottom: 148,
              right: "max(20px, calc(50% - 356px))",
              ...glass({ borderRadius: "50%", width: 36, height: 36 }),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 16,
              zIndex: 10,
            }}
          >
            ↓
          </button>
        )}

        {/* ── Options area ── */}
        <div
          style={{
            width: "100%",
            maxWidth: 760,
            padding: "0 24px 18px",
            flexShrink: 0,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-dim)",
                flex: 1,
              }}
            >
              这一幕的 {options.length} 个选择
            </span>
            <button
              onClick={() => {
                setMultiMode((m) => !m)
                setSelectedOpts(new Set())
              }}
              style={{
                ...glass(),
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 12,
                color: multiMode
                  ? "var(--accent)"
                  : "var(--text-faint)",
                border: multiMode
                  ? `1px solid ${isDark ? "rgba(201,139,75,.5)" : "rgba(165,100,31,.4)"}`
                  : "1px solid var(--glass-border)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              多选组合
            </button>
            <button
              onClick={() => setOptionsOpen((o) => !o)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-faint)",
                cursor: "pointer",
                fontSize: 13,
                padding: "4px 6px",
                transform: optionsOpen ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform .2s ease",
              }}
            >
              ▴
            </button>
          </div>

          {/* Collapsed hint – 上翻历史时选项自动收起，点此展开 */}
          {!optionsOpen && (
            <button
              onClick={() => setOptionsOpen(true)}
              className="option-btn"
              style={{
                ...glass({
                  borderRadius: 999,
                  padding: "5px 14px",
                  fontSize: 12,
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }),
              }}
            >
              › 展开选项
            </button>
          )}

          {/* Option buttons */}
          {optionsOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map(({ key, text }) => {
                const sel = selectedOpts.has(key)
                return (
                  <button
                    key={key}
                    className="option-btn"
                    onClick={() => toggleOpt(key)}
                    style={{
                      ...glass({
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: sel
                          ? `1px solid ${isDark ? "rgba(201,139,75,.5)" : "rgba(165,100,31,.4)"}`
                          : "1px solid var(--glass-border)",
                        width: "100%",
                      }),
                    }}
                  >
                    <KeyBadge label={key} selected={sel} />
                    <span
                      style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        paddingTop: 2,
                      }}
                    >
                      {text}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Multi-select bar */}
          {multiMode && selectedOpts.size > 0 && (
            <div
              style={{
                marginTop: 10,
                ...glass({
                  borderRadius: 10,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: `1px solid ${isDark ? "rgba(201,139,75,.4)" : "rgba(165,100,31,.3)"}`,
                }),
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  flex: 1,
                }}
              >
                已选 {selectedOpts.size} 项：{[...selectedOpts].join(" + ")}
              </span>
              <button
                style={{
                  background: "var(--accent)",
                  color: isDark ? "#241c10" : "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                组合发送
              </button>
              <button
                onClick={() => setSelectedOpts(new Set())}
                style={{
                  background: "transparent",
                  border: `1px solid ${"var(--border)"}`,
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 12,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                清空
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Control panel ── */}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 50,
          ...glass({
            borderRadius: 14,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minWidth: 144,
          }),
        }}
      >
        <div
          style={{
            fontSize: 9,
            color: "var(--text-faint)",
            letterSpacing: "1.2px",
            marginBottom: 3,
            fontFamily: "monospace",
            textTransform: "uppercase",
          }}
        >
          Demo Panel
        </div>

        <CtrlBtn
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? "☀ 浅色模式" : "🌙 深色模式"}
        </CtrlBtn>

        <div
          style={{
            height: 1,
            background: "var(--border)",
            margin: "2px 0",
          }}
        />

        {(["busy", "ok", "image", "error"] as const).map((s) => (
          <CtrlBtn
            key={s}
            onClick={() => setIslandState(s)}
            active={islandState === s}
          >
            {s === "busy"
              ? "⏳ 岛·生成中"
              : s === "ok"
              ? "✓ 岛·已完成"
              : s === "image"
              ? "🖼 岛·插图完成"
              : "⚠ 岛·失败"}
          </CtrlBtn>
        ))}

        <div
          style={{
            height: 1,
            background: "var(--border)",
            margin: "2px 0",
          }}
        />

        <CtrlBtn onClick={onPlayIntro}>↺ 播放入场动画</CtrlBtn>
      </div>
    </div>
  )
}
