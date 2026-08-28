import { useRef, useEffect } from "react"

interface Props {
  phase: "intro" | "exiting"
  onEnter: () => void
}

const NOISE = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/></filter><rect width='180' height='180' filter='url(%23n)' opacity='1'/></svg>`

export default function IntroScreen({ phase, onEnter }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf: number
    let alive = true

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const particles = Array.from({ length: 70 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 0.6 + Math.random() * 1.6,
      opacity: 0.08 + Math.random() * 0.3,
      dx: (Math.random() - 0.5) * 0.3,
      dy: -(0.2 + Math.random() * 0.5),
      color:
        Math.random() < 0.72
          ? "#d99a52"
          : Math.random() < 0.5
          ? "#7ad7c2"
          : "#ff5367",
    }))

    const tick = () => {
      if (!alive) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach((p) => {
        p.x += p.dx
        p.y += p.dy
        if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width }
        if (p.x < -5) p.x = canvas.width + 5
        if (p.x > canvas.width + 5) p.x = -5
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.opacity
        ctx.fill()
      })
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      onClick={onEnter}
      style={{
        position: "fixed",
        inset: 0,
        background: "#010304",
        overflow: "hidden",
        cursor: "default",
        zIndex: 100,
        animation:
          phase === "exiting"
            ? "intro-exit 620ms cubic-bezier(.16,1,.3,1) forwards"
            : undefined,
      }}
    >
      {/* Layer 2 – volume light + scan lines, breathing */}
      <div
        style={{
          position: "absolute",
          inset: "-8%",
          background: [
            "linear-gradient(115deg, transparent 0%, rgba(255,83,103,.05) 24%, transparent 42%, rgba(217,154,82,.06) 62%, transparent 82%)",
            "repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 54px)",
            "repeating-linear-gradient(0deg,  rgba(255,255,255,.02) 0 1px, transparent 1px 46px)",
            "linear-gradient(180deg, #020606 0%, #050607 42%, #000 100%)",
          ].join(", "),
          filter: "blur(.4px)",
          opacity: 0.9,
          animation: "breathe 7s ease-in-out alternate infinite",
        }}
      />

      {/* Layer 3 – particle canvas (fades separately first on exit) */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          transition:
            "opacity 560ms cubic-bezier(.22,1,.36,1), transform 560ms cubic-bezier(.22,1,.36,1)",
          opacity: phase === "exiting" ? 0.22 : 1,
          transform: phase === "exiting" ? "scale(1.008)" : "none",
        }}
      />

      {/* Layer 4 – four-edge vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background: [
            "linear-gradient(90deg,  rgba(0,0,0,.82) 0%, transparent 21%, transparent 79%, rgba(0,0,0,.82) 100%)",
            "linear-gradient(180deg, rgba(0,0,0,.68) 0%, transparent 32%, transparent 64%, rgba(0,0,0,.74) 100%)",
          ].join(", "),
          pointerEvents: "none",
        }}
      />

      {/* Layer 5 – noise + depth shadow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          backgroundImage: `url("${NOISE}")`,
          backgroundRepeat: "repeat",
          opacity: 0.038,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          boxShadow: "inset 0 0 180px rgba(0,0,0,.88)",
          pointerEvents: "none",
        }}
      />

      {/* ── Content ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
        }}
      >
        {/* Title lockup – flex row; container auto-recenters as CODEX expands,
            so 六面世界 drifts left to make room (Mineradio two-word mechanic) */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: "clamp(16px, 2.4vw, 30px)",
            height: "clamp(80px, 13vw, 140px)",
          }}
        >
          {/* Main word: 六面世界 */}
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--sans)",
              fontWeight: 720,
              fontSize: "clamp(52px, 8.8vw, 108px)",
              color: "#f8f8f2",
              letterSpacing: "-.01em",
              whiteSpace: "nowrap",
              textShadow:
                "-2px 0 0 rgba(255,83,103,.24), 2px 0 0 rgba(122,215,194,.18), 0 22px 72px rgba(0,0,0,.58), 0 0 34px rgba(217,154,82,.10)",
              animation:
                "title-main 5.2s cubic-bezier(.22,1,.36,1) forwards",
            }}
          >
            六面世界
          </h1>

          {/* Secondary word: CODEX – wrapper grows, inner reveals with slit + skew,
              gradient light sweeps across glyphs, final X solid gold */}
          <div
            style={{
              overflow: "hidden",
              animation:
                "codex-expand 5.2s cubic-bezier(.22,1,.36,1) both",
            }}
          >
            <h2
              className="codex-code"
              style={{
                margin: 0,
                fontFamily: "var(--sans)",
                fontWeight: 720,
                fontSize: "clamp(34px, 5.6vw, 68px)",
                letterSpacing: "-.018em",
                whiteSpace: "nowrap",
                filter:
                  "drop-shadow(-2px 0 0 rgba(255,83,103,.16)) drop-shadow(2px 0 0 rgba(122,215,194,.22)) drop-shadow(0 0 34px rgba(122,215,194,.10))",
                animation:
                  "title-codex-reveal 5.2s cubic-bezier(.22,1,.36,1) both",
              }}
            >
              CODE
              <span
                style={{
                  color: "#d8c486",
                  WebkitTextFillColor: "#d8c486",
                }}
              >
                X
              </span>
            </h2>
          </div>
        </div>

        {/* Signal line */}
        <div
          style={{
            position: "relative",
            width: "min(460px, 54vw)",
            height: "2px",
            marginTop: "clamp(8px, 1.5vw, 20px)",
            background:
              "linear-gradient(90deg, transparent, rgba(122,215,194,.22) 15%, rgba(255,255,255,.78) 35%, rgba(217,154,82,.66) 55%, rgba(255,83,103,.22) 80%, transparent)",
            transformOrigin: "center",
            animation:
              "signal-expand 4.2s cubic-bezier(.22,1,.36,1) forwards",
          }}
        >
          {/* Blip */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "18%",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#ffffff",
              boxShadow:
                "0 0 8px 2px rgba(255,255,255,.9), 0 0 16px 4px rgba(217,154,82,.7)",
              animation:
                "blip-travel 4.2s cubic-bezier(.22,1,.36,1) forwards",
            }}
          />
        </div>

        {/* Subtitle */}
        <p
          style={{
            marginTop: "clamp(12px, 2vw, 24px)",
            fontFamily: "var(--sans)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: "#f8f8f2",
            opacity: 0,
            animation:
              "subtitle-enter .8s cubic-bezier(.22,1,.36,1) 1.976s both",
          }}
        >
          SIX WORLDS · PRIVATE STORY ENGINE
        </p>

        {/* Click to enter – hidden until ready, then breathes */}
        <p
          style={{
            marginTop: "clamp(20px, 3vw, 36px)",
            fontFamily: "var(--sans)",
            fontSize: "11px",
            fontWeight: 400,
            letterSpacing: ".24em",
            textTransform: "uppercase",
            color: "#f8f8f2",
            opacity: 0,
            animation:
              "click-reveal .4s ease 4.6s forwards, click-pulse 1.8s ease-in-out 5.0s alternate infinite",
          }}
        >
          点击进入
        </p>
      </div>
    </div>
  )
}
