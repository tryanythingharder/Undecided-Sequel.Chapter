import { useState, useEffect, useRef } from "react";

/* ─────────────────────────────────────────────────────────────
   Inline SVG icons (16px / 1.5px stroke)
───────────────────────────────────────────────────────────── */
const IconX = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const IconCheck = ({ size = 16, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const IconChevronRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);
const IconChevronLeft = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const IconChevronDown = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const IconImage = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const IconDownload = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);
const IconShare = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
  </svg>
);
const IconTrash = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);
const IconExpand = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
  </svg>
);
const IconMoon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);
const IconSun = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);
const IconPalette = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0010 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.476-1.125-.29-.289-.71-.633-.71-1.187 0-1.04.84-1.875 1.875-1.875H16c2.209 0 4-1.79 4-4 0-4.418-3.582-8-8-8z" />
  </svg>
);
const IconHelp = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
    <circle cx="12" cy="17" r=".5" fill="currentColor" />
  </svg>
);
const IconSettings = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);
const IconImages = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="2" y="8" width="15" height="14" rx="2" />
    <path d="M7 4h14a1 1 0 011 1v13" />
    <circle cx="7.5" cy="13.5" r="1.5" />
    <path d="M17 22l-5-5-3 3" />
  </svg>
);
const IconRefresh = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </svg>
);
const IconPlug = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M12 22v-5M9 7V2M15 7V2M17 7H7l1 8a4 4 0 008 0l1-8z" />
  </svg>
);
const IconFolder = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);
const IconExport = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);
const IconImport = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */
const SCREENS = [
  { id: "wizard",      label: "E · 初始化向导" },
  { id: "disclaimer",  label: "F · 免责声明" },
  { id: "settings",    label: "G · 设置窗口" },
  { id: "confirm",     label: "H · 确认框" },
  { id: "help",        label: "I · 帮助弹窗" },
  { id: "theme-pop",   label: "J · 主题弹层" },
  { id: "gallery",     label: "K · 画廊" },
];

const PALETTES = [
  { name: "经典", colors: ["#c98b4b", "#1a1a1a"] },
  { name: "羊皮纸", colors: ["#c9a96e", "#2a2218"] },
  { name: "林间", colors: ["#6e9b6a", "#1a2218"] },
  { name: "紫晶", colors: ["#8b6ec9", "#1a1422"] },
  { name: "海渊", colors: ["#4b8ec9", "#0e1a2a"] },
  { name: "蔷薇", colors: ["#c94b7a", "#2a1018"] },
  { name: "高对比", colors: ["#ffffff", "#000000"] },
];

const PROVIDERS = [
  { id: "deepseek",  label: "DeepSeek",    char: "D" },
  { id: "openai",    label: "OpenAI",      char: "O" },
  { id: "kimi",      label: "Moonshot Kimi", char: "K" },
  { id: "glm",       label: "智谱 GLM",    char: "G" },
  { id: "qwen",      label: "通义 Qwen",   char: "Q" },
  { id: "siliconflow", label: "硅基流动",  char: "S" },
  { id: "custom",    label: "自定义＋",    char: "＋" },
];

const ILLUS_PROVIDERS = [
  { id: "none",    label: "暂不启用", char: "—" },
  { id: "sd",      label: "Stable Diffusion", char: "SD" },
  { id: "comfy",   label: "ComfyUI", char: "CU" },
  { id: "dalle",   label: "DALL·E 3", char: "D3" },
  { id: "flux",    label: "Flux",    char: "FX" },
];

const GALLERY_ITEMS = [
  { id: 1, round: "甲龙历 400年 第12回合", summary: "鲁迪与艾莉丝穿越幽暗森林，遭遇了银月魔狼群的埋伏……", img: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=640&h=360&fit=crop&auto=format" },
  { id: 2, round: "甲龙历 400年 第18回合", summary: "在古都迷宫深处，发现了一块记载上古战争的碑铭，字迹间散发着微弱的魔力光芒……", img: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=640&h=360&fit=crop&auto=format" },
  { id: 3, round: "甲龙历 400年 第25回合", summary: "贤者大陆的天空划过三道紫色流星，预言书上所载的「天使降临」之兆再次出现……", img: "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=640&h=360&fit=crop&auto=format" },
  { id: 4, round: "甲龙历 401年 第3回合", summary: "艾莉丝·格雷拉特开始教导鲁迪水系魔法，细雨中的练习场笼罩在朦胧的水雾里……", img: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=640&h=360&fit=crop&auto=format" },
  { id: 5, round: "甲龙历 401年 第11回合", summary: "夜晚的营地，篝火映照着旅伴们的面庞，鲁迪悄悄展开了那张写满命运的地图……", img: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=640&h=360&fit=crop&auto=format" },
  { id: 6, round: "甲龙历 401年 第19回合", summary: "与剑神埃里斯的第一次正式对决，剑光在雨中闪烁，每一击都带着无言的期望……", img: "https://images.unsplash.com/photo-1552083375-1447ce886485?w=640&h=360&fit=crop&auto=format" },
];

const CONFIRM_VARIANTS = [
  {
    id: "delete",
    title: "删除世界线",
    body: "确定要删除「甲龙历主线」？此操作不可撤销，该世界线下所有对话与插图将永久消失。",
    input: false,
    cancelLabel: "取消",
    confirmLabel: "删除",
    danger: true,
    placeholder: "",
  },
  {
    id: "rename",
    title: "重命名世界线",
    body: "",
    input: true,
    cancelLabel: "取消",
    confirmLabel: "重命名",
    danger: false,
    placeholder: "甲龙历主线",
  },
  {
    id: "newworld",
    title: "新建工作区",
    body: "创建一条全新的独立世界线，与当前存档互不干扰。",
    input: true,
    cancelLabel: "取消",
    confirmLabel: "创建",
    danger: false,
    placeholder: "未命名世界线",
  },
  {
    id: "branch",
    title: "IF 分歧命名",
    body: "你正在从「甲龙历 401年 第11回合」创建一条分歧支线，请为它起一个名字。",
    input: true,
    cancelLabel: "取消",
    confirmLabel: "创建分歧线",
    danger: false,
    placeholder: "篝火之夜 · 另一个选择",
  },
];

/* ─────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────── */

/* ── 徽记 Emblem ── */
function Emblem({ size = 48 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "linear-gradient(135deg, #c98b4b 0%, #e8b06a 40%, #a05a28 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 0 0 1px rgba(201,139,75,.3), 0 4px 20px rgba(201,139,75,.35)",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: size * 0.45, fontWeight: 700, color: "#241c10", fontFamily: "var(--sans)", lineHeight: 1 }}>六</span>
    </div>
  );
}

/* ── Step indicator ── */
function StepBar({ step, total, labels }: { step: number; total: number; labels: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, justifyContent: "center", padding: "20px 0 4px" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              className={`step-dot ${i < step ? "done" : ""} ${i === step ? "active" : ""}`}
              style={{ position: "relative" }}
            >
              {i < step && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconCheck size={8} />
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: i === step ? "var(--accent)" : "var(--text-faint)", letterSpacing: ".02em", whiteSpace: "nowrap" }}>
              {labels[i]}
            </span>
          </div>
          {i < total - 1 && (
            <div style={{
              width: 60,
              height: 1.5,
              marginBottom: 18,
              background: i < step
                ? "linear-gradient(90deg, var(--accent), var(--accent))"
                : "var(--border)",
              transition: "background .4s",
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Mini browser preview ── */
function BrowserPreview({ dark }: { dark: boolean }) {
  const bg = dark ? "#000" : "#fff";
  const panel = dark ? "#0f0f10" : "#f5f5f5";
  const accent = dark ? "#c98b4b" : "#a5641f";
  const text = dark ? "#d4d4d4" : "#262626";
  const dim = dark ? "#6b6b6b" : "#a3a3a3";
  return (
    <div style={{ width: "100%", aspectRatio: "16/9", background: bg, borderRadius: 6, overflow: "hidden", border: `1px solid ${dark ? "#26262b" : "#e6e6e6"}`, display: "flex" }}>
      <div style={{ width: "28%", background: panel, borderRight: `1px solid ${dark ? "#26262b" : "#e6e6e6"}`, padding: "6px 4px", display: "flex", flexDirection: "column", gap: 3 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ height: 4, borderRadius: 2, background: i === 0 ? accent : dim, opacity: i === 0 ? 1 : 0.35, width: i === 0 ? "80%" : `${60-i*10}%` }} />
        ))}
      </div>
      <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 3 }}>
        {[1,0.7,0.5,0.7,0.4].map((w, i) => (
          <div key={i} style={{ height: 3, borderRadius: 1.5, background: text, opacity: 0.15 * w + 0.05, width: `${w * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   E. 初始化向导
───────────────────────────────────────────────────────────── */
function WizardScreen({ onNext }: { onNext: () => void }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"right" | "left">("right");
  const [animKey, setAnimKey] = useState(0);
  const [themeCard, setThemeCard] = useState(1);
  const [palette, setPalette] = useState(0);
  const [chatProvider, setChatProvider] = useState("deepseek");
  const [chatKey, setChatKey] = useState("");
  const [modelStatus, setModelStatus] = useState<"idle" | "ok" | "err">("idle");
  const [illusProvider, setIllusProvider] = useState("none");

  const goStep = (next: number) => {
    setDirection(next > step ? "right" : "left");
    setAnimKey(k => k + 1);
    setStep(next);
  };

  const handleFetchModel = () => {
    setModelStatus("ok");
    setTimeout(() => {}, 0);
  };

  const stepLabels = ["外观", "对话模型", "插图模型"];

  return (
    <div className="modal-backdrop">
      <div className="glass modal-enter" style={{
        width: "min(640px, 94vw)",
        borderRadius: 20,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        maxHeight: "90vh",
      }}>
        {/* Header */}
        <div style={{ padding: "28px 32px 0", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <Emblem size={52} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0, letterSpacing: "-.01em" }}>欢迎使用六面世界</h2>
          <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "6px 0 0", lineHeight: 1.6 }}>
            三步完成初始配置，所有选项之后都能在设置中调整
          </p>
          <StepBar step={step} total={3} labels={stepLabels} />
        </div>

        <hr className="divider" style={{ margin: "16px 0 0" }} />

        {/* Step content */}
        <div style={{ padding: "24px 32px", flex: 1, overflowY: "auto", minHeight: 320 }}>
          <div key={animKey} className={direction === "right" ? "slide-right" : "slide-left"}>
            {step === 0 && (
              <div>
                <p className="label-sm" style={{ marginBottom: 14 }}>选择外观</p>
                {/* Theme cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
                  {[{ id: 0, label: "纯白", dark: false }, { id: 1, label: "纯黑", dark: true }, { id: 2, label: "跟随系统", dark: false }].map(t => (
                    <div key={t.id} className={`theme-card ${themeCard === t.id ? "selected" : ""}`} onClick={() => setThemeCard(t.id)}>
                      {themeCard === t.id && (
                        <div className="check-badge"><IconCheck size={10} /></div>
                      )}
                      <BrowserPreview dark={t.id === 1 || (t.id === 2)} />
                      <p style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center", margin: "8px 0 0", fontWeight: 500 }}>{t.label}</p>
                    </div>
                  ))}
                </div>
                {/* Palette swatches */}
                <div style={{ background: "var(--panel-2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                  <p className="label-sm" style={{ marginBottom: 10 }}>配色方案</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {PALETTES.map((p, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                        <div
                          className={`swatch ${palette === i ? "selected" : ""}`}
                          onClick={() => setPalette(i)}
                          title={p.name}
                          style={{ overflow: "hidden" }}
                        >
                          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                            <div style={{ flex: 1, background: p.colors[0] }} />
                            <div style={{ flex: 1, background: p.colors[1] }} />
                          </div>
                          {palette === i && (
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.2)" }}>
                              <IconCheck size={12} />
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 12, textAlign: "center" }}>
                  随时可以在右上角主题按钮或设置中更改
                </p>
              </div>
            )}
            {step === 1 && (
              <div>
                <p className="label-sm" style={{ marginBottom: 14 }}>配置对话模型</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 }}>
                  {PROVIDERS.map(p => (
                    <div key={p.id} className={`provider-card ${chatProvider === p.id ? "selected" : ""}`} onClick={() => setChatProvider(p.id)}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: chatProvider === p.id ? "var(--accent)" : "var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700, color: chatProvider === p.id ? "var(--on-accent)" : "var(--text-dim)",
                        fontFamily: "var(--mono)",
                      }}>
                        {p.char}
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.3 }}>{p.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label className="label-sm" style={{ display: "block", marginBottom: 6 }}>API Key</label>
                    <input className="input-base" type="password" placeholder="sk-…" value={chatKey} onChange={e => setChatKey(e.target.value)} />
                  </div>
                  <div>
                    <label className="label-sm" style={{ display: "block", marginBottom: 6 }}>模型</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="input-base" placeholder="deepseek-chat" style={{ flex: 1 }} defaultValue="deepseek-chat" />
                      <button className="btn btn-ghost btn-mini" onClick={handleFetchModel} style={{ flexShrink: 0, gap: 4 }}>
                        <IconRefresh size={12} /> 拉取模型
                      </button>
                    </div>
                  </div>
                  {modelStatus === "ok" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ok)" }}>
                      <IconCheck size={14} /> 已成功拉取 5 个可用模型
                    </div>
                  )}
                  {modelStatus === "err" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--danger)" }}>
                      <IconX size={14} /> API Key 无效，请重新检查
                    </div>
                  )}
                </div>
              </div>
            )}
            {step === 2 && (
              <div>
                <p className="label-sm" style={{ marginBottom: 14 }}>配置插图模型</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 20 }}>
                  {ILLUS_PROVIDERS.map(p => (
                    <div key={p.id} className={`provider-card ${illusProvider === p.id ? "selected" : ""}`} onClick={() => setIllusProvider(p.id)}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: illusProvider === p.id ? "var(--accent)" : "var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: illusProvider === p.id ? 14 : 12, fontWeight: 700,
                        color: illusProvider === p.id ? "var(--on-accent)" : "var(--text-dim)",
                        fontFamily: "var(--mono)",
                      }}>
                        {p.char}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.3 }}>{p.label}</span>
                    </div>
                  ))}
                </div>
                {illusProvider === "none" ? (
                  <div style={{
                    border: "1.5px dashed var(--border-strong)", borderRadius: 12,
                    padding: 32, display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 10, color: "var(--text-faint)",
                  }}>
                    <IconImage size={36} />
                    <p style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.6 }}>
                      暂不启用插图生成<br />你仍然可以正常进行 AI 文字 RPG
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label className="label-sm" style={{ display: "block", marginBottom: 6 }}>API Key</label>
                      <input className="input-base" type="password" placeholder="sk-…" />
                    </div>
                    <div>
                      <label className="label-sm" style={{ display: "block", marginBottom: 6 }}>模型</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input className="input-base" placeholder="stable-diffusion-xl" style={{ flex: 1 }} />
                        <button className="btn btn-ghost btn-mini" style={{ gap: 4 }}>
                          <IconRefresh size={12} /> 拉取模型
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <hr className="divider" />

        {/* Footer */}
        <div style={{ padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>第 {step + 1} / 3 步</span>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 0 ? (
              <button className="btn btn-ghost" onClick={onNext}>跳过</button>
            ) : (
              <button className="btn btn-ghost" onClick={() => goStep(step - 1)}>
                <IconChevronLeft size={14} /> 上一步
              </button>
            )}
            {step < 2 ? (
              <button className="btn btn-primary" onClick={() => goStep(step + 1)}>
                下一步 <IconChevronRight size={14} />
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onNext}>完成</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   F. 免责声明
───────────────────────────────────────────────────────────── */
function DisclaimerScreen({ onClose }: { onClose: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const CLAUSES = [
    { n: "01", title: "AI 生成内容免责", body: "「六面世界」所有叙事内容由 AI 大语言模型实时生成，不代表开发者立场。生成结果因模型提供商而异，开发者不对内容的准确性、合法性或适宜性作任何保证。" },
    { n: "02", title: "同人创作声明", body: "本应用基于《无职转生》IP 进行同人二次创作，仅限个人娱乐使用。所有角色、世界观及设定归原著作者及版权方所有。请勿将本应用产出内容用于商业目的。" },
    { n: "03", title: "API 密钥安全", body: "你的 API Key 仅存储于本地设备，不会上传至任何第三方服务器。请妥善保管，不要将含密钥的配置文件分享给他人。" },
    { n: "04", title: "插图版权说明", body: "应用生成的插图版权归属取决于各插图提供商的服务条款。在使用 Stable Diffusion、DALL·E 等服务时，请自行阅读并遵守其内容政策与版权条款。" },
    { n: "05", title: "数据与隐私", body: "对话内容存储于本地，不会被收集或传输。但你与模型提供商的 API 通信受其各自隐私政策约束，请知悉。" },
  ];
  return (
    <div className="modal-backdrop">
      <div className="glass modal-enter" style={{
        width: "min(640px, 94vw)",
        borderRadius: 20,
        display: "flex",
        flexDirection: "column",
        maxHeight: "90vh",
      }}>
        <div style={{ padding: "24px 28px 20px", display: "flex", alignItems: "flex-start", gap: 14 }}>
          <Emblem size={40} />
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: 0, lineHeight: 1.3 }}>配置完成前 · 请先阅读免责声明</h2>
            <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "4px 0 0" }}>请仔细阅读以下条款，阅读完成后方可继续使用</p>
          </div>
        </div>
        <hr className="divider" />
        <div style={{ padding: "0 28px", flex: 1, overflowY: "auto", maxHeight: 340 }}>
          <div style={{ paddingTop: 20, paddingBottom: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {CLAUSES.map(c => (
              <div key={c.n} style={{ display: "flex", gap: 14 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--accent)", flexShrink: 0, paddingTop: 1 }}>§{c.n}</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{c.title}</p>
                  <p style={{ fontSize: 13, color: "var(--text-dim)", margin: 0, lineHeight: 1.7 }}>{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <hr className="divider" />
        <div style={{ padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label className="checkbox-wrap" style={{ fontSize: 13, color: "var(--text-dim)" }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            我已阅读并同意上述免责声明条款
          </label>
          <button className="btn btn-primary" disabled={!agreed} onClick={onClose}>
            同意并继续
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   G. 设置窗口
───────────────────────────────────────────────────────────── */
function SettingsWindow({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const TABS = ["文本模型", "插图模型", "外观 · 内核", "高级"];

  const save = () => {
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2200);
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-faint)", margin: "20px 0 10px" }}>
      {children}
    </p>
  );

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--mono)", letterSpacing: ".04em" }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="glass modal-enter" style={{
        width: "min(560px, 94vw)",
        height: "min(700px, 92vh)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Title bar */}
        <div className="title-drag" style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: 6 }} className="title-nodrag">
            <div className="win-btn" onClick={onClose} style={{ background: "#e06b6b" }} title="关闭" />
            <div className="win-btn" style={{ background: "#c9a84b" }} title="最小化" />
            <div className="win-btn" style={{ background: "#7fb069" }} title="最大化" />
          </div>
          <span style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--text-dim)", letterSpacing: ".02em" }}>
            设置
          </span>
          <button className="btn btn-ghost btn-mini title-nodrag" style={{ fontSize: 11 }}>重置</button>
        </div>

        {/* Tabs */}
        <div className="tab-bar" style={{ padding: "0 16px", flexShrink: 0 }}>
          {TABS.map((t, i) => (
            <div key={i} className={`tab-item ${tab === i ? "active" : ""}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 24px 24px" }}>
          {tab === 0 && (
            <div>
              <SectionTitle>接口配置</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Row label="提供商">
                  <select className="input-base">
                    {PROVIDERS.map(p => <option key={p.id}>{p.label}</option>)}
                  </select>
                </Row>
                <Row label="API Key">
                  <input className="input-base" type="password" defaultValue="sk-••••••••••••••••••••••••" />
                </Row>
                <Row label="API Base URL（可选）">
                  <input className="input-base" placeholder="https://api.deepseek.com/v1" />
                </Row>
                <Row label="模型">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="input-base" defaultValue="deepseek-chat" style={{ flex: 1 }} />
                    <button className="btn btn-ghost btn-mini" style={{ gap: 4 }}><IconRefresh size={12} />获取</button>
                    <button className="btn btn-ghost btn-mini" style={{ gap: 4 }}><IconPlug size={12} />测试</button>
                  </div>
                </Row>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ok)", height: 20 }}>
                  <IconCheck size={12} /> 连接成功 · deepseek-chat · 延迟 342ms
                </div>
              </div>
              <SectionTitle>可用模型清单</SectionTitle>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                {["deepseek-chat", "deepseek-coder", "deepseek-reasoner"].map((m, i) => (
                  <label key={m} className="checkbox-wrap" style={{
                    padding: "10px 14px",
                    borderBottom: i < 2 ? "1px solid var(--border)" : "none",
                    background: "var(--panel-2)",
                    fontSize: 13,
                    color: "var(--text)",
                    gap: 10,
                  }}>
                    <input type="checkbox" defaultChecked={i === 0} />
                    <span style={{ flex: 1 }}>{m}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>DeepSeek</span>
                  </label>
                ))}
              </div>
              <button className="btn btn-ghost btn-mini" style={{ marginTop: 8, gap: 4, fontSize: 12 }}>
                ＋ 手动添加模型
              </button>
            </div>
          )}

          {tab === 1 && (
            <div>
              <SectionTitle>插图生成</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label className="checkbox-wrap" style={{ fontSize: 13, color: "var(--text)" }}>
                  <input type="checkbox" defaultChecked />
                  自动插图（每回合自动生成）
                </label>
                <hr className="divider" />
                <Row label="提供商">
                  <select className="input-base">
                    {ILLUS_PROVIDERS.map(p => <option key={p.id}>{p.label}</option>)}
                  </select>
                </Row>
                <Row label="API Key">
                  <input className="input-base" type="password" placeholder="sk-…" />
                </Row>
                <Row label="风格预设">
                  <select className="input-base">
                    {["动漫插画（默认）","写实风格","水彩手绘","像素艺术","油画风格","极简线稿","暗黑奇幻"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </Row>
                <Row label="画面尺寸">
                  <select className="input-base">
                    <option>1280×720 · 16:9（默认）</option>
                    <option>1024×1024 · 1:1</option>
                    <option>768×1024 · 3:4</option>
                  </select>
                </Row>
                <Row label="清晰度">
                  <select className="input-base">
                    <option>标准</option><option>高清</option><option>超高清</option>
                  </select>
                </Row>
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 13, color: "var(--text-dim)", padding: "10px 0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>高级参数</span><IconChevronDown />
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 }}>
                    <Row label="反向提示词">
                      <textarea className="input-base" style={{ height: 56, resize: "none", paddingTop: 8, paddingBottom: 8 }} placeholder="worst quality, blurry…" />
                    </Row>
                    <Row label="随机种子（-1 = 随机）">
                      <input className="input-base" defaultValue="-1" />
                    </Row>
                    <Row label="每回合生成张数">
                      <select className="input-base">
                        <option>1 张</option><option>2 张</option><option>4 张</option>
                      </select>
                    </Row>
                  </div>
                </details>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div>
              <SectionTitle>外观</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Row label="配色方案">
                  <select className="input-base">
                    {PALETTES.map(p => <option key={p.name}>{p.name}</option>)}
                  </select>
                </Row>
                <Row label="明暗模式">
                  <select className="input-base">
                    <option>跟随系统</option><option>深色</option><option>浅色</option>
                  </select>
                </Row>
                <Row label="界面字体">
                  <select className="input-base">
                    <option>系统默认（PingFang SC / Microsoft YaHei）</option>
                    <option>Noto Sans SC</option>
                  </select>
                </Row>
                <Row label="圆角风格">
                  <select className="input-base">
                    <option>标准（16px）</option><option>紧凑（8px）</option><option>宽松（24px）</option>
                  </select>
                </Row>
                <Row label="界面密度">
                  <select className="input-base">
                    <option>舒适</option><option>紧凑</option>
                  </select>
                </Row>
                <Row label="布局方向">
                  <select className="input-base">
                    <option>消息在左、选项在右（默认）</option><option>消息在右、选项在左</option>
                  </select>
                </Row>
                <label className="checkbox-wrap" style={{ fontSize: 13, color: "var(--text)" }}>
                  <input type="checkbox" />
                  窗口始终置顶
                </label>
                <Row label="正文字号（px）">
                  <input className="input-base" defaultValue="14" />
                </Row>
                <Row label="内容最大宽度（px）">
                  <input className="input-base" defaultValue="720" />
                </Row>
              </div>
              <SectionTitle>内核</SectionTitle>
              <Row label="内核路径">
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="input-base" defaultValue="/usr/local/bin/node" style={{ flex: 1 }} />
                  <button className="btn btn-ghost btn-mini" style={{ gap: 4 }}><IconFolder size={12} />浏览</button>
                </div>
              </Row>
            </div>
          )}

          {tab === 3 && (
            <div>
              <SectionTitle>上下文</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Row label="发送上下文条数">
                  <input className="input-base" defaultValue="20" />
                </Row>
                <Row label="本地保留条数">
                  <input className="input-base" defaultValue="200" />
                </Row>
                <Row label="插图触发字数">
                  <input className="input-base" defaultValue="150" />
                </Row>
              </div>
              <SectionTitle>提示词</SectionTitle>
              <Row label="系统提示词前缀">
                <textarea className="input-base" style={{ height: 72, resize: "none", paddingTop: 8, paddingBottom: 8 }}
                  defaultValue="你是《无职转生》世界的全知叙述者，以第三人称推进故事，保持世界观一致性……" />
              </Row>
              <SectionTitle>数据管理</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn-ghost" style={{ justifyContent: "flex-start", gap: 6 }}><IconExport size={14} />导出配置</button>
                <button className="btn btn-ghost" style={{ justifyContent: "flex-start", gap: 6 }}><IconImport size={14} />导入配置</button>
                <hr className="divider" style={{ margin: "4px 0" }} />
                <button className="btn btn-danger-ghost" style={{ justifyContent: "flex-start", gap: 6 }}><IconTrash size={14} />清空全部世界线数据</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer bar */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          background: "var(--panel-2)",
        }}>
          <span style={{ fontSize: 12, color: saveStatus === "saved" ? "var(--ok)" : "var(--text-faint)", transition: "color .3s", fontFamily: "var(--mono)" }}>
            {saveStatus === "saved" ? "✓ 保存成功" : ""}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={save}>保存设置</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   H. 确认框
───────────────────────────────────────────────────────────── */
function ConfirmDialog({ variant, onClose }: { variant: typeof CONFIRM_VARIANTS[0]; onClose: () => void }) {
  const [val, setVal] = useState(variant.placeholder);
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="glass modal-enter" style={{ width: "min(400px, 90vw)", borderRadius: 16, padding: "24px" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>{variant.title}</h3>
        {variant.body && (
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.65, margin: "0 0 16px" }}>{variant.body}</p>
        )}
        {variant.input && (
          <input
            className="input-base"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onClose()}
            style={{ marginBottom: 16 }}
            autoFocus
            placeholder={variant.placeholder}
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>
            {variant.cancelLabel}
          </button>
          <button
            className={`btn ${variant.danger ? "btn-danger" : "btn-primary"}`}
            onClick={onClose}
            style={{ fontSize: 13 }}
          >
            {variant.confirmLabel}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "right", marginTop: 8, fontFamily: "var(--mono)" }}>
          <kbd>Esc</kbd> 取消 · <kbd>↵</kbd> 确认
        </p>
      </div>
    </div>
  );
}

function ConfirmScreen() {
  const [variantIdx, setVariantIdx] = useState(0);
  const [key, setKey] = useState(0);
  const switchVariant = (i: number) => { setVariantIdx(i); setKey(k => k + 1); };
  return (
    <div>
      {/* picker */}
      <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 200, display: "flex", gap: 6, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 6 }}>
        {CONFIRM_VARIANTS.map((v, i) => (
          <button key={v.id} className={`btn btn-ghost btn-mini ${variantIdx === i ? "selected" : ""}`}
            style={{ borderColor: variantIdx === i ? "var(--accent)" : undefined, color: variantIdx === i ? "var(--accent)" : undefined }}
            onClick={() => switchVariant(i)}>
            {v.title}
          </button>
        ))}
      </div>
      <ConfirmDialog key={key} variant={CONFIRM_VARIANTS[variantIdx]} onClose={() => {}} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   I. 帮助弹窗
───────────────────────────────────────────────────────────── */
function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const GUIDE = [
    { step: "第一步", title: "开始转生", body: "点击「新建世界线」，为你的主角选择出生背景。AI 将在甲龙历世界中为你生成专属的开场叙事，故事由此展开。" },
    { step: "第二步", title: "推进故事", body: "每回合 AI 会输出剧情文本与三个 A/B/C 选项。点击选项即可推进。若启用了插图模型，AI 会自动生成当前场景的 16:9 插图。" },
    { step: "第三步", title: "分歧与回溯", body: "在任意回合点击「创建分歧」可保存当前世界线快照，之后可随时回到该节点探索另一条历史。" },
    { step: "更多", title: "画廊与导出", body: "右上角画廊按钮可浏览本次世界线所有生成插图，支持单张下载或打包导出为故事存档 ZIP。" },
  ];
  const SHORTCUTS = [
    { group: "对话", items: [["Enter / Space", "确认选项"], ["←→ 方向键", "切换选项 A/B/C"], ["Ctrl+Z", "撤销上一回合"]] },
    { group: "导航", items: [["Ctrl+N", "新建世界线"], ["Ctrl+,", "打开设置"], ["Ctrl+G", "打开画廊"], ["Ctrl+W", "关闭当前弹窗"]] },
    { group: "大图查看", items: [["←→ 方向键", "切换插图"], ["Esc", "关闭大图"], ["Ctrl+S", "下载当前插图"]] },
  ];
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="glass modal-enter" style={{ width: "min(540px, 94vw)", borderRadius: 18, display: "flex", flexDirection: "column", maxHeight: "85vh", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: 0 }}>帮助</h2>
          <button className="btn btn-ghost btn-mini" onClick={onClose} style={{ padding: "0 8px" }}><IconX size={14} /></button>
        </div>
        <div className="tab-bar" style={{ padding: "0 24px", margin: "12px 0 0" }}>
          {["怎么玩", "快捷键"].map((t, i) => (
            <div key={i} className={`tab-item ${tab === i ? "active" : ""}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {tab === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {GUIDE.map(g => (
                <div key={g.step} style={{ display: "flex", gap: 14 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0, paddingTop: 2, minWidth: 40 }}>{g.step}</span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{g.title}</p>
                    <p style={{ fontSize: 13, color: "var(--text-dim)", margin: 0, lineHeight: 1.7 }}>{g.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {SHORTCUTS.map(g => (
                <div key={g.group}>
                  <p className="label-sm" style={{ marginBottom: 10 }}>{g.group}</p>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {g.items.map(([k, v]) => (
                        <tr key={k} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 0", width: "45%" }}>
                            <kbd>{k}</kbd>
                          </td>
                          <td style={{ padding: "8px 0", fontSize: 13, color: "var(--text-dim)" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   J. 主题弹层
───────────────────────────────────────────────────────────── */
function ThemePopover({ theme, onTheme, onClose }: { theme: string; onTheme: (t: string) => void; onClose: () => void }) {
  const [palette, setPalette] = useState(0);
  const [pulse, setPulse] = useState(-1);

  const modes = [
    { id: "system", label: "跟随系统" },
    { id: "dark",   label: "深色" },
    { id: "light",  label: "浅色" },
  ];

  const handlePalette = (i: number) => {
    setPalette(i);
    setPulse(i);
    setTimeout(() => setPulse(-1), 500);
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()} style={{ alignItems: "flex-start", justifyContent: "flex-end", padding: "52px 16px 0 0" }}>
      <div className="glass fade-in" style={{ width: 232, borderRadius: 14, padding: "16px", boxShadow: "var(--shadow-lg)" }} onClick={e => e.stopPropagation()}>
        {/* Mode selector */}
        <p className="label-sm" style={{ marginBottom: 8 }}>明暗模式</p>
        <div style={{ display: "flex", background: "var(--panel-2)", borderRadius: 8, padding: 3, gap: 2, marginBottom: 14 }}>
          {modes.map(m => (
            <button key={m.id} onClick={() => onTheme(m.id === "dark" ? "dark" : "light")}
              style={{
                flex: 1, height: 28, fontSize: 12, border: "none", borderRadius: 6, cursor: "pointer",
                background: (m.id === "dark" ? theme === "dark" : m.id === "system" ? false : theme === "light") ? "var(--panel)" : "transparent",
                color: (m.id === "dark" ? theme === "dark" : m.id === "system" ? false : theme === "light") ? "var(--accent)" : "var(--text-dim)",
                fontWeight: 500,
                boxShadow: (m.id === "dark" ? theme === "dark" : m.id === "light" ? theme === "light" : false) ? "var(--shadow-sm)" : "none",
                transition: "all .2s",
              }}>
              {m.label}
            </button>
          ))}
        </div>
        <hr className="divider" style={{ marginBottom: 14 }} />
        <p className="label-sm" style={{ marginBottom: 10 }}>配色方案</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {PALETTES.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div
                className={`swatch ${palette === i ? "selected" : ""}`}
                onClick={() => handlePalette(i)}
                style={{
                  animation: pulse === i ? "pulse-ring .5s ease" : "none",
                  overflow: "hidden",
                }}
                title={p.name}
              >
                <div style={{ position: "absolute", inset: 0, display: "flex" }}>
                  <div style={{ flex: 1, background: p.colors[0] }} />
                  <div style={{ flex: 1, background: p.colors[1] }} />
                </div>
              </div>
              <span style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   K. 画廊 + 大图
───────────────────────────────────────────────────────────── */
function GalleryPanel({ onClose }: { onClose: () => void }) {
  const [lightboxItem, setLightboxItem] = useState<typeof GALLERY_ITEMS[0] | null>(null);

  return (
    <>
      {/* Lightbox */}
      {lightboxItem && (
        <div
          className="modal-backdrop"
          style={{ background: "rgba(0,0,0,.82)", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={() => setLightboxItem(null)}
        >
          <div className="fade-in" style={{ maxWidth: "min(900px, 92vw)", width: "100%" }} onClick={e => e.stopPropagation()}>
            <img
              src={lightboxItem.img}
              alt={lightboxItem.summary}
              style={{ width: "100%", borderRadius: 12, display: "block", objectFit: "cover" }}
            />
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 11, color: "rgba(255,255,255,.5)" }}>
                {lightboxItem.round}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", fontFamily: "var(--mono)" }}>
                点击遮罩或 <kbd style={{ background: "rgba(255,255,255,.12)", color: "rgba(255,255,255,.5)", border: "1px solid rgba(255,255,255,.15)" }}>Esc</kbd> 关闭
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Gallery panel */}
      <div
        className="modal-backdrop"
        style={{ alignItems: "stretch", justifyContent: "flex-end" }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div
          className="glass gallery-in"
          style={{
            width: "min(520px, 94vw)",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            borderRadius: "16px 0 0 16px",
            borderRight: "none",
          }}
        >
          {/* Head */}
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: 0 }}>画廊</h2>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", background: "var(--panel-2)", padding: "2px 8px", borderRadius: 20, border: "1px solid var(--border)" }}>
                  {GALLERY_ITEMS.length} 幅
                </span>
              </div>
              <button className="btn btn-ghost btn-mini" onClick={onClose} style={{ padding: "0 8px" }}><IconX size={14} /></button>
            </div>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select className="input-base" style={{ flex: 1, height: 32, fontSize: 12 }}>
                <option>全部世界线</option>
                <option>甲龙历主线</option>
                <option>篝火之夜 · 分歧</option>
              </select>
              <button className="btn btn-ghost btn-mini" style={{ gap: 4, fontSize: 12 }}><IconDownload size={12} />保存全部</button>
              <button className="btn btn-ghost btn-mini" style={{ gap: 4, fontSize: 12 }}><IconExport size={12} />导出存档</button>
            </div>
          </div>

          {/* Grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {GALLERY_ITEMS.map(item => (
                <div key={item.id} className="gallery-card" style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)", cursor: "pointer", position: "relative" }}>
                  <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", background: "#111" }}>
                    <img
                      src={item.img}
                      alt={item.summary}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .3s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                    />
                    {/* hover actions */}
                    <div className="hover-actions" style={{ position: "absolute", bottom: 6, right: 6, display: "flex", gap: 4 }}>
                      {[
                        { icon: <IconExpand size={12} />, label: "大图", action: () => setLightboxItem(item) },
                        { icon: <IconDownload size={12} />, label: "下载", action: () => {} },
                        { icon: <IconShare size={12} />,   label: "分享", action: () => {} },
                        { icon: <IconTrash size={12} />,   label: "删除", action: () => {} },
                      ].map((a, i) => (
                        <button key={i} onClick={a.action} title={a.label} style={{
                          width: 26, height: 26, borderRadius: 6, border: "none",
                          background: "rgba(0,0,0,.65)", color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", backdropFilter: "blur(4px)",
                        }}>
                          {a.icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px 10px" }}>
                    <p style={{ fontSize: 12, color: "var(--text)", margin: "0 0 3px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}>
                      {item.summary}
                    </p>
                    <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{item.round}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main App
───────────────────────────────────────────────────────────── */
export default function App() {
  const [screen, setScreen] = useState("wizard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Close nav on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <div
      data-theme={theme}
      className="stage"
      style={{ minHeight: "100%", height: "100%", position: "relative", color: "var(--text)", fontFamily: "var(--sans)" }}
    >
      {/* ── Top title bar (simulated Electron) ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 44, zIndex: 100,
        background: "var(--panel)", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", padding: "0 16px", gap: 12,
      }}>
        {/* Window controls */}
        <div style={{ display: "flex", gap: 6 }}>
          <div className="win-btn" style={{ background: "#e06b6b" }} />
          <div className="win-btn" style={{ background: "#c9a84b" }} />
          <div className="win-btn" style={{ background: "#7fb069" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" }}>
          <Emblem size={22} />
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".01em", color: "var(--text)" }}>六面世界</span>
        </div>
        {/* Right controls */}
        <div style={{ display: "flex", gap: 4, position: "relative" }} ref={navRef}>
          <button
            className="btn btn-ghost btn-mini"
            onClick={() => { setNavOpen(o => !o); setScreen("theme-pop"); }}
            title="主题"
            style={{ padding: "0 8px" }}
          >
            <IconPalette size={14} />
          </button>
          <button className="btn btn-ghost btn-mini" onClick={() => { setScreen("help"); setNavOpen(false); }} title="帮助" style={{ padding: "0 8px" }}>
            <IconHelp size={14} />
          </button>
          <button className="btn btn-ghost btn-mini" onClick={() => { setScreen("settings"); setNavOpen(false); }} title="设置" style={{ padding: "0 8px" }}>
            <IconSettings size={14} />
          </button>
          <button className="btn btn-ghost btn-mini" onClick={() => { setScreen("gallery"); setNavOpen(false); }} title="画廊" style={{ padding: "0 8px" }}>
            <IconImages size={14} />
          </button>
          <button className="btn btn-ghost btn-mini" onClick={toggleTheme} title="切换明暗" style={{ padding: "0 8px" }}>
            {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
          </button>
        </div>
      </div>

      {/* ── Demo navigation ── */}
      <div style={{
        position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
        zIndex: 300, display: "flex", gap: 4, background: "var(--panel)",
        border: "1px solid var(--border)", borderRadius: 12, padding: "6px",
        boxShadow: "var(--shadow-lg)", flexWrap: "wrap", justifyContent: "center",
        maxWidth: "calc(100vw - 32px)",
      }}>
        {SCREENS.map(s => (
          <button
            key={s.id}
            onClick={() => setScreen(s.id)}
            className="btn btn-ghost btn-mini"
            style={{
              fontSize: 11,
              borderColor: screen === s.id ? "var(--accent)" : undefined,
              color: screen === s.id ? "var(--accent)" : undefined,
              background: screen === s.id ? "rgba(201,139,75,.08)" : undefined,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Stage background content ── */}
      <div style={{ paddingTop: 44, height: "100%", position: "relative", zIndex: 1 }}>
        {/* Ambient stage hint */}
        {!["gallery"].includes(screen) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, opacity: 0.06, pointerEvents: "none" }}>
            <Emblem size={120} />
            <span style={{ fontSize: 18, fontWeight: 300, letterSpacing: ".3em", color: "var(--text)" }}>六面世界</span>
          </div>
        )}

        {/* Screens */}
        {screen === "wizard" && <WizardScreen onNext={() => setScreen("disclaimer")} />}
        {screen === "disclaimer" && <DisclaimerScreen onClose={() => setScreen("wizard")} />}
        {screen === "settings" && <SettingsWindow onClose={() => setScreen("wizard")} />}
        {screen === "confirm" && <ConfirmScreen />}
        {screen === "help" && <HelpModal onClose={() => setScreen("wizard")} />}
        {screen === "theme-pop" && (
          <ThemePopover theme={theme} onTheme={(t) => setTheme(t as "dark" | "light")} onClose={() => setScreen("wizard")} />
        )}
        {screen === "gallery" && <GalleryPanel onClose={() => setScreen("wizard")} />}
      </div>
    </div>
  );
}
