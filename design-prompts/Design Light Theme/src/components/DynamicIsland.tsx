import { useEffect, useState } from "react"

export type IslandState = "hidden" | "busy" | "ok" | "image" | "error"

interface Props {
  state: IslandState
  onDismiss: () => void
  isDark: boolean
}

export default function DynamicIsland({ state, onDismiss, isDark }: Props) {
  const [mounted, setMounted] = useState(false)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (state === "hidden") {
      if (mounted) {
        setExiting(true)
        const t = setTimeout(() => {
          setMounted(false)
          setExiting(false)
          onDismiss()
        }, 550)
        return () => clearTimeout(t)
      }
      return
    }

    setExiting(false)
    setMounted(true)

    const duration = state === "busy" ? 12000 : 6000
    const t = setTimeout(() => {
      setExiting(true)
      setTimeout(() => {
        setMounted(false)
        setExiting(false)
        onDismiss()
      }, 550)
    }, duration)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!mounted) return null

  const isBusy = state === "busy"
  const isOk = state === "ok"
  const isImage = state === "image"
  const isError = state === "error"

  const accentColor = isDark ? "#c98b4b" : "#a5641f"
  const glassBase = isDark ? "rgba(32,32,37,.88)" : "rgba(255,255,255,.90)"
  const glassBorder = isDark
    ? isError
      ? "rgba(224,107,107,.35)"
      : "rgba(255,255,255,.09)"
    : isError
    ? "rgba(200,70,70,.25)"
    : "rgba(38,35,30,.09)"
  const textColor = isDark ? "#d6d3cd" : "#26231e"
  const textFaint = isDark ? "#97948e" : "#6b675f"
  const okColor = isDark ? "#7fb069" : "#4e8a3f"
  const errColor = isDark ? "#e06b6b" : "#c84646"

  const animClass = exiting
    ? "island-exiting"
    : isBusy
    ? "island-entering busy"
    : "island-entering"

  return (
    <div
      className={animClass}
      style={{
        position: "fixed",
        top: 46,
        left: "50%",
        zIndex: 999,
        background: glassBase,
        backdropFilter: "blur(28px) saturate(1.5)",
        WebkitBackdropFilter: "blur(28px) saturate(1.5)",
        border: `1px solid ${glassBorder}`,
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.10)"
          : "0 8px 32px rgba(0,0,0,.1), inset 0 1px 0 rgba(255,255,255,.85)",
        borderRadius: isImage ? "22px" : "999px",
        overflow: "hidden",
        fontFamily: "\"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
        /* 状态间 morph：宽/圆角/内距平滑过渡，不瞬跳 */
        minWidth: isImage ? 270 : undefined,
        transition:
          "border-radius .5s var(--ease-spring), min-width .5s var(--ease-spring), border-color .25s ease, background .25s ease",
      }}
    >
      {/* Busy scanline */}
      {isBusy && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            borderRadius: "0 0 999px 999px",
            background: `linear-gradient(90deg, transparent 0%, ${accentColor}99 30%, ${accentColor} 50%, ${accentColor}99 70%, transparent 100%)`,
            backgroundSize: "200% 100%",
            animation: "scanline-sweep 1.4s linear infinite",
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: isImage ? "11px 14px" : "7px 14px",
          transition: "padding .5s var(--ease-spring)",
        }}
      >
        {/* Thumbnail (image state) */}
        {isImage && (
          <div
            style={{
              width: 74,
              height: 46,
              borderRadius: 10,
              background:
                "linear-gradient(135deg, #c9955a 0%, #7c4a20 50%, #3d2010 100%)",
              flexShrink: 0,
              animation: "img-in .4s var(--ease-spring) forwards",
            }}
          />
        )}

        {/* Icon */}
        {isBusy && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accentColor,
              flexShrink: 0,
              display: "inline-block",
            }}
          />
        )}
        {isOk && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M2.5 7L5.5 10L11.5 4"
              stroke={okColor}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isImage && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="2" stroke={accentColor} strokeWidth="1.4" />
            <circle cx="4.5" cy="4.5" r="1" fill={accentColor} />
            <path d="M1 10l3-3 3 3 2-2 4 4" stroke={accentColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {isError && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke={errColor} strokeWidth="1.4" />
            <path d="M7 4v4M7 9.5v.5" stroke={errColor} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: isError ? errColor : textColor,
              whiteSpace: "nowrap",
            }}
          >
            {isBusy && "世界正在书写这一幕…"}
            {isOk && "已保存到画廊"}
            {isImage && "插图已完成"}
            {isError && "连接中断，请重试"}
          </div>
          <div
            style={{
              fontSize: 11,
              color: textFaint,
              marginTop: 1,
              whiteSpace: "nowrap",
            }}
          >
            {isBusy && "通常只需几秒"}
            {isOk && "可在画廊随时查看"}
            {isImage && "点击查看完整插图"}
            {isError && "API 超时，模型暂时繁忙"}
          </div>
        </div>

        {/* Actions */}
        {isBusy && (
          <button
            onClick={() => setExiting(true)}
            style={{
              background: "transparent",
              border: `1px solid ${glassBorder}`,
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 11,
              color: textFaint,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            停止
          </button>
        )}
        {isImage && (
          <button
            style={{
              background: accentColor,
              color: isDark ? "#241c10" : "#fff",
              border: "none",
              borderRadius: 999,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            查看
          </button>
        )}
        {isError && (
          <button
            style={{
              background: "transparent",
              border: `1px solid ${glassBorder}`,
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 11,
              color: textFaint,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            重试
          </button>
        )}

        {/* Dismiss */}
        <button
          onClick={() => setExiting(true)}
          style={{
            background: "transparent",
            border: "none",
            color: textFaint,
            cursor: "pointer",
            padding: "0 0 0 2px",
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
