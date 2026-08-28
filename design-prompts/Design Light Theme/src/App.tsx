import { useState, useEffect, useCallback } from "react"
import IntroScreen from "./components/IntroScreen"
import MainInterface from "./components/MainInterface"
import type { IslandState } from "./components/DynamicIsland"

type Phase = "intro" | "exiting" | "main"

export default function App() {
  // Start directly on main interface so the light-theme design is immediately visible
  const [phase, setPhase] = useState<Phase>("main")
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [islandState, setIslandState] = useState<IslandState>("hidden")

  const enter = useCallback(() => {
    setPhase((p) => {
      if (p !== "intro") return p
      return "exiting"
    })
  }, [])

  const playIntro = useCallback(() => {
    setPhase("intro")
    setIslandState("hidden")
  }, [])

  // Phase: exiting → main after exit animation
  useEffect(() => {
    if (phase !== "exiting") return
    const t = setTimeout(() => setPhase("main"), 650)
    return () => clearTimeout(t)
  }, [phase])

  // Fallback: auto-enter after 12s if not clicked
  useEffect(() => {
    if (phase !== "intro") return
    const t = setTimeout(enter, 12000)
    return () => clearTimeout(t)
  }, [phase, enter])

  return (
    <div
      className={theme === "dark" ? "dark" : ""}
      style={{ width: "100%", height: "100%" }}
    >
      {phase !== "main" && (
        <IntroScreen phase={phase} onEnter={enter} />
      )}
      {phase === "main" && (
        <MainInterface
          theme={theme}
          setTheme={setTheme}
          islandState={islandState}
          setIslandState={setIslandState}
          onPlayIntro={playIntro}
        />
      )}
    </div>
  )
}
