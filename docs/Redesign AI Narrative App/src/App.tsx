import { useState, useRef, useEffect, useCallback } from "react";

// ─── iOS System Colors (Dark / Light) ────────────────────────────────────────
const D = {
  bg:           "#000000",
  bgSecondary:  "#1c1c1e",
  bgTertiary:   "#2c2c2e",
  fill:         "rgba(120,120,128,0.36)",
  fillSec:      "rgba(120,120,128,0.2)",
  fillTer:      "rgba(118,118,128,0.12)",
  sep:          "rgba(60,60,67,0.36)",
  sepOpaque:    "#38383a",
  label:        "#ffffff",
  label2:       "rgba(235,235,245,0.6)",
  label3:       "rgba(235,235,245,0.3)",
  label4:       "rgba(235,235,245,0.18)",
  gold:         "#c8952a",
  goldBright:   "#e8ae3a",
  goldFill:     "rgba(200,149,42,0.18)",
  goldFillSub:  "rgba(200,149,42,0.1)",
  goldBorder:   "rgba(200,149,42,0.28)",
  cyan:         "#32ade6",
  cyanFill:     "rgba(50,173,230,0.14)",
  coral:        "#ff453a",
  coralFill:    "rgba(255,69,58,0.12)",
  green:        "#30d158",
  orange:       "#ff9f0a",
};

const L = {
  ...D,
  bg:           "#f2f2f7",
  bgSecondary:  "#ffffff",
  bgTertiary:   "#f2f2f7",
  fill:         "rgba(120,120,128,0.2)",
  fillSec:      "rgba(120,120,128,0.12)",
  fillTer:      "rgba(118,118,128,0.08)",
  sep:          "rgba(60,60,67,0.18)",
  sepOpaque:    "#c6c6c8",
  label:        "#000000",
  label2:       "rgba(60,60,67,0.6)",
  label3:       "rgba(60,60,67,0.3)",
  label4:       "rgba(60,60,67,0.18)",
  goldFill:     "rgba(200,149,42,0.12)",
  goldFillSub:  "rgba(200,149,42,0.07)",
};

// ─── Types ────────────────────────────────────────────────────────────────────
type MainView = "dialogue" | "gallery" | "settings" | "help";
type Overlay  = null | "state" | "snapshots" | "rerecord" | "illustrations" | "worldSwitch" | "worldCreate" | "modelConfig" | "appearance";
type GenStage = "narrative" | "illustration" | "rerecord";
type DiMode   = "idle" | "pill" | "expanded";
type StateTab = "overview" | "characters" | "facts" | "promises" | "foreshadowing" | "logs";

interface World { id: string; name: string; subtitle: string; core: string; lines: number; rounds: number; img: string; accent: string; }
interface Line  { id: string; name: string; rounds: number; lastActive: string; excerpt: string; hasSnap: boolean; pinned?: boolean; }
interface Msg   { id: string; type: "action" | "narrative"; text: string; round?: number; scene?: string; status?: string; illus?: string; time: string; }
interface Snap  { id: string; tag: string; round: number; time: string; note: string; }
interface Rerecord { id: string; excerpt: string; reason: string; retries: number; }

// ─── Data ─────────────────────────────────────────────────────────────────────
const WORLDS: World[] = [
  { id:"w1", name:"凛冬之国", subtitle:"永恒冬日的奇幻史诗", core:"黑暗奇幻", lines:3, rounds:847, img:"https://images.unsplash.com/photo-1491002052546-bf38f186af56?w=600&h=800&fit=crop&auto=format", accent:"#4a8bd4" },
  { id:"w2", name:"黑铁纪元", subtitle:"蒸汽与钢铁编织的命运", core:"蒸汽朋克", lines:7, rounds:2341, img:"https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&h=800&fit=crop&auto=format", accent:"#c8952a" },
  { id:"w3", name:"星尘编年史", subtitle:"星际流亡者的归途", core:"科幻史诗", lines:2, rounds:156, img:"https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600&h=800&fit=crop&auto=format", accent:"#32ade6" },
  { id:"w4", name:"朱雀秘境", subtitle:"乱世江湖的血与义", core:"武侠", lines:5, rounds:1203, img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=600&h=800&fit=crop&auto=format", accent:"#ff453a" },
];

const LINES: Line[] = [
  { id:"l1", name:"凛冬骑士团", rounds:234, lastActive:"2小时前", excerpt:"你握紧了冰封之剑，寒风卷起战袍——王都已近在咫尺，但背叛者就在身侧...", hasSnap:true, pinned:true },
  { id:"l2", name:"雪山修道院", rounds:89,  lastActive:"3天前",  excerpt:"修士低声吟诵，烛火摇曳。古老羊皮纸上的密文似乎正在改变...", hasSnap:true },
  { id:"l3", name:"北境商队",   rounds:524, lastActive:"上周",   excerpt:"马车缓行于冰雪覆盖的古道，远处狼嚎传来，随行护卫脸色发白...", hasSnap:false },
];

const MSGS: Msg[] = [
  { id:"m1", type:"action", text:"我沿着石阶缓步走向祭坛，双手展开，准备捧起那枚散发寒光的纹章石。", round:233, time:"21:14" },
  { id:"m2", type:"narrative", scene:"凛冬神殿 · 中殿祭坛", text:`寒光如利刃切开你的掌心——不，那是错觉。纹章石触感冰凉却不刺骨，像是握住了一块凝固的月光。\n\n祭坛上的浮雕在你指尖触碰的刹那缓缓亮起，古老的凛冬文字以蓝白双色交织燃烧，仿佛整座山神殿正在从沉眠中苏醒。那刻入石心的誓约，已沉睡三百年。\n\n"终于……"\n\n身后传来阿尔维斯的低语，靴子踩过碎石发出细微声响。老骑士已放下了剑，在此刻选择了下跪。\n\n【守誓者支线已触发】纹章真正的持有人须在三个昼夜内抵达霜冠峰顶，否则纹章将归还虚空。`, status:"体力 68/100 · 威望 ★★★☆☆ · 阿尔维斯好感度：高", illus:"https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=700&h=420&fit=crop&auto=format", round:233, time:"21:14" },
  { id:"m3", type:"action", text:"我转身将阿尔维斯扶起，低声道：'不必如此，老朋友。我们是并肩的。一起去霜冠峰。'", round:234, time:"21:17" },
  { id:"m4", type:"narrative", scene:"凛冬神殿 · 中殿祭坛", text:`阿尔维斯的眼眶微微泛红，那是你从未见过的神情——这个见证过王朝倾覆的老人，此刻像一个孩子一样任你将他拉起。\n\n"殿下……不，"他顿了顿，改口，"朋友。"\n\n纹章石在你们两人掌心之间散发出柔和光晕，仿佛对这个承诺做出了回应。神殿深处，封印的大门正在缓缓开启，透出久违的冷风与光明。\n\n你们还有三天。`, status:"体力 68/100 · 威望 ★★★★☆ · 阿尔维斯好感度：极高", round:234, time:"21:18" },
];

const ACTION_OPTIONS = [
  "即刻出发——三天时间不容浪费，命令阿尔维斯备马",
  "先询问阿尔维斯关于霜冠峰的路线与危险",
  "检视纹章石，尝试感知其中封存的魔力与记忆",
  "环顾神殿四周，确认是否还有其他线索",
];

const SNAPS: Snap[] = [
  { id:"s1", tag:"进入神殿前",   round:228, time:"20:58", note:"决策点：是否独自前往" },
  { id:"s2", tag:"与守卫交涉后", round:215, time:"19:42", note:"" },
  { id:"s3", tag:"抵达王都",     round:180, time:"昨天 23:11", note:"重要转折点" },
  { id:"s4", tag:"初见阿尔维斯", round:91,  time:"3天前 16:33", note:"" },
];

const RERECORDS: Rerecord[] = [
  { id:"r1", excerpt:"我向守卫投掷了烟雾弹，趁乱穿越...", reason:"内容过滤：包含暴力动作描写", retries:1 },
  { id:"r2", excerpt:"询问商人关于黑市武器的来源...", reason:"生成超时（30s）", retries:0 },
];

const ILLUS = [
  "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=280&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=280&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=280&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?w=400&h=280&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=400&h=280&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&h=280&fit=crop&auto=format",
];

// ─── Hooks / Helpers ──────────────────────────────────────────────────────────
function useT(dark: boolean) { return dark ? D : L; }

// ─── Dynamic Island ───────────────────────────────────────────────────────────
function DynamicIsland({ mode, onToggle, wordCount, stage, onStop, dark }: {
  mode: DiMode; onToggle: () => void; wordCount: number; stage: GenStage; onStop: () => void; dark: boolean;
}) {
  const stageColor  = stage === "narrative" ? D.gold : stage === "illustration" ? D.cyan : D.coral;
  const stageLabel  = stage === "narrative" ? "叙事生成中" : stage === "illustration" ? "插图生成中" : "补录处理中";
  const expanded    = mode === "expanded";

  return (
    <div className="absolute top-0 left-0 right-0 flex justify-center" style={{ zIndex: 9000, paddingTop: "10px", pointerEvents: "none" }}>
      <div
        className="di-spring overflow-hidden"
        onClick={onToggle}
        style={{
          background: "#000",
          border: `1px solid rgba(255,255,255,0.08)`,
          width: expanded ? "312px" : "182px",
          borderRadius: expanded ? "22px" : "100px",
          boxShadow: "0 4px 32px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(255,255,255,0.06)",
          pointerEvents: "all",
          cursor: "pointer",
        }}
      >
        {!expanded ? (
          /* Pill (collapsed) */
          <div className="flex items-center justify-between px-4" style={{ height: "33px" }}>
            <span className="mono" style={{ fontSize:"11px", color: D.gold, letterSpacing:"0.04em" }}>claude-opus-5</span>
            <div className="flex items-center gap-[4px]">
              {[0,1,2].map(i => (
                <div key={i} className="breathe-dot rounded-full" style={{ width:5, height:5, background: D.gold, animationDelay:`${i*0.22}s` }} />
              ))}
            </div>
          </div>
        ) : (
          /* Expanded card */
          <div className="p-4" onClick={e => e.stopPropagation()}>
            {/* Stage row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full" style={{ width:7, height:7, background: stageColor, boxShadow:`0 0 10px ${stageColor}90`, flexShrink:0 }} />
                <span style={{ fontSize:"12px", fontWeight:500, color:"rgba(255,255,255,0.7)" }}>{stageLabel}</span>
              </div>
              <span className="mono" style={{ fontSize:"11px", color: D.gold }}>{wordCount} 字</span>
            </div>

            {/* Streaming preview */}
            <div className="rounded-xl px-3 py-2.5 mb-3" style={{ background:"rgba(255,255,255,0.05)" }}>
              <p style={{ fontFamily:"'Lora',serif", fontSize:"13px", lineHeight:1.75, color:"rgba(255,255,255,0.82)", fontStyle:"italic" }} className="line-clamp-3">
                寒光如利刃切开你的掌心——不，那是错觉。纹章石触感冰凉却不刺骨，像是握住了一块凝固的月光，三百年的誓约在你指尖颤动……
                <span className="cursor-blink inline-block align-middle ml-px" style={{ width:1.5, height:13, background: D.gold, verticalAlign:"middle" }} />
              </p>
            </div>

            {/* Stage indicators */}
            <div className="flex gap-1.5 mb-3">
              {(["narrative","illustration","rerecord"] as GenStage[]).map(s => (
                <div key={s} className="flex-1 h-1 rounded-full" style={{ background: s === stage ? (s === "narrative" ? D.gold : s === "illustration" ? D.cyan : D.coral) : "rgba(255,255,255,0.1)" }} />
              ))}
            </div>

            {/* Stop */}
            <button
              onClick={onStop}
              className="w-full rounded-xl py-2 text-xs font-semibold"
              style={{ background: D.coralFill, color: D.coral, border:`1px solid rgba(255,69,58,0.25)` }}
            >
              停止生成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Left Drawer ──────────────────────────────────────────────────────────────
function Drawer({ open, onClose, dark, world, lines, activeLine, onLineSelect, onOverlay, onView, view, rerecordCount }: {
  open: boolean; onClose: () => void; dark: boolean;
  world: World; lines: Line[]; activeLine: Line | null;
  onLineSelect: (l: Line) => void; onOverlay: (o: Overlay) => void;
  onView: (v: MainView) => void; view: MainView; rerecordCount: number;
}) {
  const t = useT(dark);
  const [closing, setClosing] = useState(false);

  const close = () => { setClosing(true); setTimeout(() => { setClosing(false); onClose(); }, 260); };

  if (!open && !closing) return null;

  const NavLink = ({ label, sub, onClick, badge, accent }: { label: string; sub?: string; onClick: () => void; badge?: number; accent?: string }) => (
    <button
      onClick={() => { close(); setTimeout(onClick, 80); }}
      className="w-full flex items-center gap-3 px-4 py-3"
      style={{ borderBottom: `0.5px solid ${t.sep}` }}
    >
      <div className="flex-1 text-left">
        <p style={{ fontSize:"15px", color: accent || t.label, fontWeight:500 }}>{label}</p>
        {sub && <p style={{ fontSize:"12px", color: t.label3, marginTop:1 }}>{sub}</p>}
      </div>
      {badge != null && badge > 0 && (
        <div className="rounded-full flex items-center justify-center" style={{ minWidth:20, height:20, background: D.coral, paddingInline:5 }}>
          <span style={{ fontSize:"11px", color:"#fff", fontWeight:700 }}>{badge}</span>
        </div>
      )}
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={t.label3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  );

  return (
    <div className="absolute inset-0" style={{ zIndex: 8000 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-in"
        style={{ background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}
        onClick={close}
      />
      {/* Drawer panel */}
      <div
        className={`absolute top-0 left-0 bottom-0 flex flex-col overflow-hidden ${closing ? "drawer-close" : "drawer-open"}`}
        style={{ width:"300px", background: dark ? "#111113" : "#f2f2f7", borderRight:`0.5px solid ${t.sep}` }}
      >
        {/* Header */}
        <div style={{ paddingTop:56, paddingBottom:16, paddingInline:20, borderBottom:`0.5px solid ${t.sep}` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="mono" style={{ fontSize:"10px", letterSpacing:"0.16em", color: D.gold, marginBottom:3 }}>SIX WORLDS</p>
              <p style={{ fontFamily:"'Lora',serif", fontSize:"22px", fontWeight:700, color: t.label, letterSpacing:"-0.02em" }}>六面世界</p>
            </div>
            <button onClick={close} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.fillTer }}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke={t.label2} strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* World selector */}
        <div style={{ padding:"12px 16px", borderBottom:`0.5px solid ${t.sep}` }}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: t.fillTer }}>
            <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width:40, height:40 }}>
              <img src={world.img} alt={world.name} className="w-full h-full object-cover" style={{ filter:"brightness(0.75) saturate(0.8)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize:"14px", fontWeight:600, color: t.label }} className="truncate">{world.name}</p>
              <p style={{ fontSize:"11px", color: t.label3 }}>{world.core} · {world.lines} 条世界线</p>
            </div>
            <button onClick={() => { close(); setTimeout(() => onOverlay("worldSwitch"), 80); }} style={{ fontSize:"12px", color: D.gold, fontWeight:600, flexShrink:0 }}>切换</button>
          </div>
        </div>

        {/* World lines */}
        <div className="flex-1 overflow-y-auto">
          <div style={{ padding:"8px 16px 4px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em" }}>世界线</p>
            <button onClick={() => { close(); setTimeout(() => onOverlay("worldCreate"), 80); }} style={{ fontSize:"13px", color: D.gold }}>+ 新建</button>
          </div>
          {lines.map(line => {
            const isActive = activeLine?.id === line.id;
            return (
              <button
                key={line.id}
                onClick={() => { close(); setTimeout(() => onLineSelect(line), 80); }}
                className="w-full flex items-center gap-3 px-4 py-3"
                style={{ background: isActive ? D.goldFillSub : "transparent", borderBottom:`0.5px solid ${t.sep}` }}
              >
                <div className="w-1 h-6 rounded-full flex-shrink-0" style={{ background: isActive ? D.gold : "transparent" }} />
                <div className="flex-1 text-left min-w-0">
                  <p style={{ fontSize:"14px", fontWeight: isActive ? 600 : 400, color: isActive ? D.gold : t.label }} className="truncate">{line.name}</p>
                  <p style={{ fontSize:"11px", color: t.label3 }}>R{line.rounds} · {line.lastActive}</p>
                </div>
                {line.hasSnap && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: D.cyan }} />}
              </button>
            );
          })}

          {/* Tools */}
          <div style={{ padding:"12px 16px 4px" }}>
            <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:4 }}>工具</p>
          </div>
          <NavLink label="状态引擎" sub="事实·关系·承诺·伏笔台账" onClick={() => onOverlay("state")} />
          <NavLink label="快照记录" sub={`${SNAPS.length} 个存档`} onClick={() => onOverlay("snapshots")} />
          <NavLink label="待补录队列" sub={rerecordCount > 0 ? `${rerecordCount} 条待处理` : "队列为空"} onClick={() => onOverlay("rerecord")} badge={rerecordCount} />
          <NavLink label="插图画廊" sub="AI生成插图集" onClick={() => onView("gallery")} />

          {/* Settings */}
          <div style={{ padding:"12px 16px 4px", marginTop:4 }}>
            <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:4 }}>系统</p>
          </div>
          <NavLink label="模型配置" onClick={() => onOverlay("modelConfig")} />
          <NavLink label="外观个性化" onClick={() => onOverlay("appearance")} />
          <NavLink label="设置" onClick={() => onView("settings")} />
          <NavLink label="帮助与手势" onClick={() => onView("help")} />
        </div>
      </div>
    </div>
  );
}

// ─── Nav Bar ──────────────────────────────────────────────────────────────────
function NavBar({ title, sub, dark, onMenu, right }: {
  title: string; sub?: string; dark: boolean; onMenu: () => void; right?: React.ReactNode;
}) {
  const t = useT(dark);
  return (
    <div
      className={dark ? "navbar-blur" : "navbar-blur-light"}
      style={{ paddingTop:48, paddingBottom:10, paddingInline:16, borderBottom:`0.5px solid ${t.sep}`, position:"relative", zIndex:100 }}
    >
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: t.fillTer }}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
            <path d="M1 1.5h15M1 6h10M1 10.5h15" stroke={t.label2} strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize:"15px", fontWeight:600, color: t.label, lineHeight:1.2 }} className="truncate">{title}</p>
          {sub && <p style={{ fontSize:"11px", color: t.label3, marginTop:1 }}>{sub}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

// ─── Dialogue Screen ──────────────────────────────────────────────────────────
const DUMMY_NARRATIVES = [
  { scene:"凛冬神殿 · 外殿回廊", text:`你抬脚迈出，靴底踩在冰封石板上发出清脆回响。\n\n阿尔维斯走在你右侧半步之后，沉默如一道山岳。外殿的穹顶高悬，每一道裂缝里都有寒风低鸣——像是这座神殿在呼吸，又像是在诉说某段被遗忘的誓言。\n\n前方，通往山道的大门已经洞开，夜色与星光一同涌入。`, status:"体力 66/100 · 威望 ★★★★☆ · 与阿尔维斯好感度：极高" },
  { scene:"霜冠山道 · 入口", text:`山风刀刃一般割过面颊。\n\n阿尔维斯从腰间取出一块压缩干粮，默默递给你，没有多余的话。在边境征战三十年的人，知道什么时候沉默比语言更有力量。\n\n雪道在月光下泛着蓝白色的光，向上延伸至看不见尽头的黑暗里。纹章石在你胸口轻轻震颤，像一颗沉睡的心脏刚刚记起它的跳法。`, status:"体力 63/100 · 威望 ★★★★☆ · 饥饿度：轻微" },
];

function DialogueScreen({ dark, onMenu, line, world, msgs, actionOpts, diMode, generating, wordCount, onDiToggle, onDiStop, onOverlay }: {
  dark: boolean; onMenu: () => void; line: Line | null; world: World; msgs: Msg[];
  actionOpts: string[]; diMode: DiMode; generating: boolean; wordCount: number;
  onDiToggle: () => void; onDiStop: () => void; onOverlay: (o: Overlay) => void;
}) {
  const t          = useT(dark);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const taRef      = useRef<HTMLTextAreaElement>(null);
  const [input,    setInput]    = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm,  setConfirm]  = useState<string | null>(null);
  const [localMsgs, setLocalMsgs] = useState<Msg[]>(msgs);
  const [localGen,  setLocalGen]  = useState(false);
  const [localWC,   setLocalWC]   = useState(0);
  const [showError, setShowError] = useState(true);
  const dummyIdx = useRef(0);

  // Auto-grow textarea
  const growTextarea = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [localMsgs, localGen]);

  const toggleOpt = (o: string) => setSelected(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o]);

  const handleSend = () => {
    const text = input.trim() || selected.map(s => s).join("；");
    if (!text) return;

    const round = (localMsgs.filter(m => m.round).pop()?.round ?? 234) + 1;
    const now   = new Date().toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" });

    setLocalMsgs(p => [...p, { id:`a-${Date.now()}`, type:"action", text, round, time: now }]);
    setInput("");
    setSelected([]);
    if (taRef.current) { taRef.current.style.height = "auto"; }

    // Start generation
    setLocalGen(true);
    setLocalWC(0);
    onDiToggle();

    let c = 0;
    const iv = setInterval(() => {
      c += Math.floor(Math.random() * 26 + 14);
      setLocalWC(c);
      if (c >= 280) {
        clearInterval(iv);
        const dummy = DUMMY_NARRATIVES[dummyIdx.current % DUMMY_NARRATIVES.length];
        dummyIdx.current++;
        const nowEnd = new Date().toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" });
        setLocalMsgs(p => [...p, {
          id:`n-${Date.now()}`, type:"narrative",
          scene: dummy.scene, text: dummy.text, status: dummy.status,
          round: round, time: nowEnd,
        }]);
        setLocalGen(false);
        onDiStop();
      }
    }, 360);
  };

  const isEmpty = !line;
  const canSend = !!input.trim() || selected.length > 0;

  return (
    <div className="h-full flex flex-col" style={{ background: t.bg }}>
      {/* Navbar */}
      <NavBar
        dark={dark} onMenu={onMenu}
        title={line ? line.name : world.name}
        sub={line ? `R${line.rounds} · ${world.name}` : `${world.core} · ${world.lines} 条世界线`}
        right={line ? (
          <div className="flex items-center gap-2">
            <IconBtn dark={dark} onClick={() => onOverlay("snapshots")} title="快照">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 4.5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </IconBtn>
            <IconBtn dark={dark} onClick={() => onOverlay("state")} title="状态">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="1.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="1.5" y="9" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.4"/></svg>
            </IconBtn>
          </div>
        ) : null}
      />

      {/* Dynamic Island spacer */}
      {diMode !== "idle" && (
        <div style={{ height: diMode === "expanded" ? "178px" : "54px", transition:"height 0.42s cubic-bezier(0.34,1.4,0.64,1)", flexShrink:0 }} />
      )}

      {isEmpty ? (
        /* ── Empty state ── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl overflow-hidden" style={{ border:`1px solid ${D.goldBorder}` }}>
              <img src={world.img} alt={world.name} className="w-full h-full object-cover" style={{ filter:"brightness(0.55) saturate(0.7)" }} />
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: D.gold }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="#0a0600" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div className="text-center">
            <p style={{ fontFamily:"'Lora',serif", fontSize:"21px", fontWeight:700, color: t.label, marginBottom:8, letterSpacing:"-0.01em" }}>开始你的故事</p>
            <p style={{ fontSize:"14px", color: t.label2, lineHeight:1.65 }}>从左上角菜单选择一条世界线<br/>或新建一段全新的冒险</p>
          </div>
          <button onClick={onMenu} className="px-7 py-3.5 rounded-2xl font-semibold text-sm" style={{ background: D.gold, color:"#0a0600", boxShadow:`0 4px 20px ${D.gold}40` }}>
            打开菜单
          </button>
        </div>
      ) : (
        <>
          {/* ── Message list ── */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ paddingTop:12 }}>
            {localMsgs.map(msg => (
              <MessageRow key={msg.id} msg={msg} dark={dark} confirm={confirm} setConfirm={setConfirm} />
            ))}

            {/* Generating state — inline card */}
            {localGen && (
              <div className="mx-4 mb-4 rounded-3xl overflow-hidden fade-in" style={{ border:`0.5px solid ${D.goldBorder}`, background: dark ? "rgba(200,149,42,0.05)" : "rgba(200,149,42,0.06)" }}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex gap-[4px]">
                      {[0,1,2].map(i => <div key={i} className="breathe-dot rounded-full" style={{ width:5, height:5, background: D.gold, animationDelay:`${i*0.22}s` }} />)}
                    </div>
                    <span style={{ fontSize:"11px", color: D.gold, fontWeight:600, letterSpacing:"0.04em" }}>叙事生成中</span>
                    <span className="mono ml-auto" style={{ fontSize:"11px", color: t.label3 }}>{localWC} 字</span>
                  </div>
                  <p style={{ fontFamily:"'Lora',serif", fontSize:"14px", color: t.label2, lineHeight:1.75, fontStyle:"italic" }}>
                    山风刀刃一般割过面颊。阿尔维斯从腰间取出一块压缩干粮，默默递给你……
                    <span className="cursor-blink inline-block align-middle" style={{ width:2, height:14, background: D.gold, marginLeft:3, borderRadius:1 }} />
                  </p>
                </div>
              </div>
            )}

            {/* Action options */}
            {!localGen && (
              <div className="fade-in px-4 pb-4 pt-1">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1" style={{ background: t.sep }} />
                  <p style={{ fontSize:"11px", fontWeight:600, color: t.label3, letterSpacing:"0.08em", flexShrink:0 }}>选择行动</p>
                  <div className="h-px flex-1" style={{ background: t.sep }} />
                </div>
                <div className="flex flex-col gap-2">
                  {actionOpts.map((opt, i) => {
                    const on = selected.includes(opt);
                    return (
                      <button
                        key={i}
                        onClick={() => toggleOpt(opt)}
                        className="text-left px-4 py-3 rounded-2xl flex items-start gap-3"
                        style={{
                          background: on ? D.goldFill : t.fillTer,
                          border:`0.5px solid ${on ? D.goldBorder : "transparent"}`,
                          transition:"all 0.18s cubic-bezier(0.34,1.4,0.64,1)",
                        }}
                      >
                        {/* Checkmark circle */}
                        <div className="flex-shrink-0 mt-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center" style={{ background: on ? D.gold : t.fill, border: on ? "none" : `1px solid ${t.sep}`, transition:"all 0.22s cubic-bezier(0.34,1.4,0.64,1)" }}>
                          {on && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5 5-5" stroke="#0a0600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <span style={{ fontSize:"14px", color: on ? D.goldBright : t.label, lineHeight:1.55, flex:1 }}>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* State extract error */}
            {showError && (
              <div className="mx-4 mb-4 px-3.5 py-2.5 rounded-xl flex items-center gap-2.5" style={{ background:"rgba(255,159,10,0.08)", border:`0.5px solid rgba(255,159,10,0.22)` }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0 }}><circle cx="7" cy="7" r="6" stroke={D.orange} strokeWidth="1.3"/><path d="M7 4v3.5" stroke={D.orange} strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="10" r="0.75" fill={D.orange}/></svg>
                <p style={{ fontSize:"12px", color: D.orange, flex:1 }}>状态提取失败 — <button onClick={() => onOverlay("rerecord")} style={{ textDecoration:"underline" }}>查看补录队列</button></p>
                <button onClick={() => setShowError(false)} style={{ color: t.label3, flexShrink:0, lineHeight:1 }}>×</button>
              </div>
            )}

            <div style={{ height:8 }} />
          </div>

          {/* ── Input bar ── */}
          <div style={{ paddingInline:12, paddingBottom:20, paddingTop:8, borderTop:`0.5px solid ${t.sep}`, background: dark ? "rgba(0,0,0,0.88)" : "rgba(242,242,247,0.94)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)" }}>
            {/* Selected option chips */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 fade-in">
                {selected.map(opt => (
                  <div key={opt} className="flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full" style={{ background: D.goldFillSub, border:`1px solid ${D.goldBorder}`, maxWidth:"100%" }}>
                    <span style={{ fontSize:"12px", color: D.goldBright, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:180 }}>{opt}</span>
                    <button onClick={() => toggleOpt(opt)} style={{ color: D.gold, fontSize:"15px", lineHeight:1, flexShrink:0 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-2">
              <ToolBtn label="插图" dark={dark} onClick={() => onOverlay("illustrations")} />
              <ToolBtn label="补录队列" dark={dark} onClick={() => onOverlay("rerecord")} badge={RERECORDS.length} />
              <ToolBtn label="快照" dark={dark} onClick={() => onOverlay("snapshots")} />
            </div>

            {/* Input row */}
            <div className="flex items-end gap-2">
              <div className="flex-1 rounded-2xl px-3.5 py-2.5" style={{ background: t.fillSec, border:`0.5px solid ${canSend ? D.goldBorder : t.sep}`, transition:"border-color 0.2s ease", minHeight:44 }}>
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); growTextarea(); }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={selected.length > 0 ? "可继续补充细节，或直接发送…" : "输入你的行动…"}
                  rows={1}
                  className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
                  style={{ color: t.label, caretColor: D.gold, maxHeight:120, display:"block" }}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: canSend ? D.gold : t.fillTer,
                  transition:"all 0.2s cubic-bezier(0.34,1.4,0.64,1)",
                  transform: canSend ? "scale(1)" : "scale(0.92)",
                  boxShadow: canSend ? `0 4px 16px ${D.gold}45` : "none",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                  <path d="M2 8.5h13M9 2.5l6 6-6 6" stroke={canSend ? "#0a0600" : t.label3} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MessageRow({ msg, dark, confirm, setConfirm }: { msg: Msg; dark: boolean; confirm: string | null; setConfirm: (id: string | null) => void }) {
  const t = useT(dark);
  const [menuOpen, setMenuOpen] = useState(false);

  if (msg.type === "action") {
    return (
      <div className="flex justify-end px-4 mb-4 fade-in">
        <div style={{ maxWidth:"80%" }}>
          <div
            className="px-4 py-3 rounded-3xl rounded-tr-lg"
            style={{ background: D.goldFill, border:`1px solid ${D.goldBorder}` }}
          >
            <p style={{ fontSize:"15px", color: t.label, lineHeight:1.65 }}>{msg.text}</p>
          </div>
          <div className="flex items-center justify-end gap-3 mt-1.5 px-1">
            <span className="mono" style={{ fontSize:"10px", color: t.label3 }}>R{msg.round} · {msg.time}</span>
            <button onClick={() => setMenuOpen(!menuOpen)} style={{ color: t.label3, padding:"2px 4px" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="2.5" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11.5" r="1" fill="currentColor"/></svg>
            </button>
          </div>
          {menuOpen && (
            <div className="rounded-2xl overflow-hidden mt-1 fade-in" style={{ background: dark ? "#2c2c2e" : "#fff", boxShadow:"0 8px 40px rgba(0,0,0,0.45)", border:`0.5px solid ${t.sep}` }}>
              {["复制文本", "编辑并回溯", "重新生成"].map((a, i, arr) => (
                <button key={a} onClick={() => { if (a === "编辑并回溯") { setConfirm(msg.id); } setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-sm" style={{ color: t.label, borderBottom: i < arr.length-1 ? `0.5px solid ${t.sep}` : "none" }}>{a}</button>
              ))}
              <button onClick={() => setMenuOpen(false)} className="w-full text-left px-4 py-3 text-sm" style={{ color: D.coral, borderTop:`0.5px solid ${t.sep}` }}>删除</button>
            </div>
          )}
          {confirm === msg.id && (
            <BacktrackConfirm dark={dark} msgId={msg.id} roundsAfter={4} onCancel={() => setConfirm(null)} onConfirm={() => setConfirm(null)} />
          )}
        </div>
      </div>
    );
  }

  // ── Narrative ──
  return (
    <div className="px-4 mb-5 fade-in">
      {/* Scene pill */}
      {msg.scene && (
        <div className="flex justify-center mb-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: D.goldFillSub, border:`0.5px solid ${D.goldBorder}` }}>
            <div className="w-1 h-1 rounded-full" style={{ background: D.gold }} />
            <span className="mono" style={{ fontSize:"10px", color: D.gold, letterSpacing:"0.05em" }}>{msg.scene} · R{msg.round} · {msg.time}</span>
          </div>
        </div>
      )}

      {/* Illustration */}
      {msg.illus && (
        <div className="rounded-2xl overflow-hidden mb-2" style={{ height:192, border:`0.5px solid ${t.sep}` }}>
          <img src={msg.illus} alt="AI插图" className="w-full h-full object-cover" style={{ filter:"brightness(0.8) saturate(0.85)" }} />
        </div>
      )}

      {/* Body card — left gold accent line */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: dark ? "rgba(255,255,255,0.038)" : "rgba(0,0,0,0.032)", border:`0.5px solid ${t.sep}`, display:"flex" }}
      >
        {/* Gold left accent */}
        <div style={{ width:2.5, flexShrink:0, background:`linear-gradient(to bottom, ${D.gold}80, ${D.gold}18)`, borderRadius:"0 0 0 12px" }} />
        <div className="flex-1 px-4 py-4">
          <p className="narrative whitespace-pre-line" style={{ color: t.label }}>{msg.text}</p>
          {msg.status && (
            <div className="mt-3.5 pt-3" style={{ borderTop:`0.5px solid ${t.sep}` }}>
              <p className="mono" style={{ fontSize:"11px", color: t.label3, lineHeight:1.75, letterSpacing:"0.02em" }}>{msg.status}</p>
            </div>
          )}
        </div>
      </div>

      {/* Message actions */}
      <div className="flex items-center gap-4 mt-2 px-1">
        <button style={{ fontSize:"12px", color: t.label3 }}>复制</button>
        <button style={{ fontSize:"12px", color: t.label3 }}>重新生成</button>
        <button style={{ fontSize:"12px", color: D.coral }}>回溯至此</button>
      </div>
    </div>
  );
}

function BacktrackConfirm({ dark, msgId, roundsAfter, onCancel, onConfirm }: {
  dark: boolean; msgId: string; roundsAfter: number; onCancel: () => void; onConfirm: () => void;
}) {
  const t = useT(dark);
  return (
    <div className="mt-2 rounded-2xl p-4 fade-in" style={{ background: dark ? "#2c1a1a" : "#fff5f5", border:`1px solid ${D.coral}30` }}>
      <p style={{ fontSize:"13px", color: t.label, lineHeight:1.6, marginBottom:12 }}>
        确认回溯至此？之后 <strong style={{ color: D.coral }}>{roundsAfter} 条</strong> 记录将从主线移入「弃置叙事档案」，永久留痕，不可撤销。
      </p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ background: t.fillTer, color: t.label2 }}>取消</button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: D.coral, color:"#fff" }}>确认回溯</button>
      </div>
    </div>
  );
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
function GalleryScreen({ dark, onMenu }: { dark: boolean; onMenu: () => void }) {
  const t = useT(dark);
  const [filter, setFilter] = useState("全部");
  const [large, setLarge] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col" style={{ background: t.bg }}>
      <NavBar dark={dark} onMenu={onMenu} title="插图画廊" sub="AI生成插图存档" />
      <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ borderBottom:`0.5px solid ${t.sep}`, flexShrink:0 }}>
        {["全部","凛冬之国","黑铁纪元","星尘编年史"].map(f => (
          <button key={f} onClick={() => setFilter(f)} className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: filter===f ? D.gold : t.fillTer, color: filter===f ? "#0a0600" : t.label2, transition:"all 0.18s" }}>{f}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 p-4">
          {ILLUS.map((url,i) => (
            <div key={i} onClick={() => setLarge(url)} className="rounded-2xl overflow-hidden relative cursor-pointer" style={{ aspectRatio:"4/3", border:`0.5px solid ${t.sep}` }}>
              <img src={url} alt="" className="w-full h-full object-cover" style={{ filter:"brightness(0.82)" }} />
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5" style={{ background:"linear-gradient(to top, rgba(0,0,0,0.75), transparent)" }}>
                <p className="mono" style={{ fontSize:"9px", color:"rgba(255,255,255,0.55)" }}>凛冬之国 · R{(i+1)*37}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {large && (
        <div className="absolute inset-0 backdrop-in flex items-center justify-center" style={{ background:"rgba(0,0,0,0.92)", zIndex:7000 }} onClick={() => setLarge(null)}>
          <img src={large} alt="" className="rounded-3xl" style={{ maxWidth:"92%", maxHeight:"80%" }} />
        </div>
      )}
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsScreen({ dark, onMenu, onToggleDark }: { dark: boolean; onMenu: () => void; onToggleDark: () => void }) {
  const t = useT(dark);
  const Grp = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-6">
      <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.08em", padding:"0 20px 6px" }}>{title}</p>
      <div style={{ background: t.bgSecondary, borderTop:`0.5px solid ${t.sep}`, borderBottom:`0.5px solid ${t.sep}` }}>{children}</div>
    </div>
  );
  const Row = ({ label, right, danger, onTap }: { label: string; right?: React.ReactNode; danger?: boolean; onTap?: () => void }) => (
    <div onClick={onTap} className="flex items-center px-5 py-3.5 cursor-pointer" style={{ borderBottom:`0.5px solid ${t.sep}`, minHeight:44 }}>
      <p className="flex-1" style={{ fontSize:"16px", color: danger ? D.coral : t.label }}>{label}</p>
      {right ?? <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke={t.label3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: t.bg }}>
      <NavBar dark={dark} onMenu={onMenu} title="设置" />
      <div className="flex-1 overflow-y-auto pt-4">
        <Grp title="外观">
          <Row label="深色主题" right={<Toggle on={dark} onToggle={onToggleDark} />} />
          <Row label="字号" right={<span style={{ fontSize:"14px", color: t.label2 }}>标准</span>} />
          <Row label="阅读宽度" right={<span style={{ fontSize:"14px", color: t.label2 }}>舒适</span>} />
          <Row label="排版密度" right={<span style={{ fontSize:"14px", color: t.label2 }}>宽松</span>} />
        </Grp>
        <Grp title="AI 引擎">
          <Row label="对话模型" right={<span style={{ fontSize:"14px", color: t.label2 }}>claude-opus-5</span>} />
          <Row label="插图模型" right={<span style={{ fontSize:"14px", color: t.label2 }}>DALL-E 3</span>} />
          <Row label="思考程度" right={<span style={{ fontSize:"14px", color: t.label2 }}>扩展</span>} />
          <Row label="API 配置" />
          <Row label="连接测试" />
        </Grp>
        <Grp title="数据">
          <Row label="配置导入/导出" />
          <Row label="续玩码导出" />
          <Row label="续玩码导入" />
          <Row label="存储占用" right={<span style={{ fontSize:"14px", color: t.label2 }}>384 MB</span>} />
          <Row label="弃置叙事档案" right={<span style={{ fontSize:"14px", color: t.label2 }}>128 条</span>} />
          <Row label="清空所有数据" danger />
        </Grp>
        <Grp title="关于">
          <Row label="版本" right={<span style={{ fontSize:"14px", color: t.label2 }}>v1.0.0-beta</span>} />
          <Row label="六面世界 · 私语引擎" />
        </Grp>
      </div>
    </div>
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function HelpScreen({ dark, onMenu }: { dark: boolean; onMenu: () => void }) {
  const t = useT(dark);
  const items = [
    { g:"基础操作", q:"如何开始一条新故事？", a:"从左上角菜单 → 选择世界线 → 新建，或在世界线列表中点击「+ 新建」。" },
    { g:"基础操作", q:"如何切换世界集？", a:"打开左侧菜单，点击当前世界集右侧的「切换」按钮。" },
    { g:"游戏玩法", q:"什么是快照？", a:"快照是任意回合的存档。恢复快照后，之后的剧情将移入弃置叙事档案，永久留痕。" },
    { g:"游戏玩法", q:"补录队列是什么？", a:"当状态提取失败时，该回合进入补录队列。你可以单条重试或批量处理。" },
    { g:"手势",     q:"如何返回上级？", a:"Android 系统返回手势（右滑或底部返回），或点击导航栏左侧菜单按钮。" },
    { g:"手势",     q:"长按消息有什么操作？", a:"长按任意消息可呼出：复制 / 编辑回溯 / 重新生成 / 删除。" },
  ];

  return (
    <div className="h-full flex flex-col" style={{ background: t.bg }}>
      <NavBar dark={dark} onMenu={onMenu} title="帮助与手势" />
      <div className="flex-1 overflow-y-auto pt-4 px-4 pb-8 space-y-4">
        {["基础操作","游戏玩法","手势"].map(g => (
          <div key={g}>
            <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.08em", marginBottom:8 }}>{g}</p>
            <div className="rounded-2xl overflow-hidden" style={{ border:`0.5px solid ${t.sep}` }}>
              {items.filter(i => i.g === g).map((item,idx,arr) => (
                <div key={item.q} className="px-4 py-4" style={{ borderBottom: idx < arr.length-1 ? `0.5px solid ${t.sep}` : "none", background: t.bgSecondary }}>
                  <p style={{ fontSize:"14px", fontWeight:600, color: t.label, marginBottom:5 }}>{item.q}</p>
                  <p style={{ fontSize:"13px", color: t.label2, lineHeight:1.6 }}>{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bottom Sheet overlays ────────────────────────────────────────────────────
function Sheet({ title, dark, onClose, height, children }: { title: string; dark: boolean; onClose: () => void; height?: string; children: React.ReactNode }) {
  const t = useT(dark);
  return (
    <div className="absolute inset-0 backdrop-in flex flex-col justify-end" style={{ zIndex: 8500, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}>
      <div onClick={onClose} className="flex-1" />
      <div
        className="sheet-up rounded-t-3xl overflow-hidden flex flex-col"
        style={{ height: height ?? "78vh", background: dark ? "#1c1c1e" : "#ffffff", borderTop:`0.5px solid ${t.sep}` }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: t.label4 }} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom:`0.5px solid ${t.sep}` }}>
          <h2 style={{ fontFamily:"'Lora',serif", fontSize:"18px", fontWeight:700, color: t.label }}>{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: t.fillTer }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke={t.label2} strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function StateSheet({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const t = useT(dark);
  const [tab, setTab] = useState<StateTab>("overview");
  const tabs: { id: StateTab; label: string }[] = [
    {id:"overview",label:"概览"},{id:"characters",label:"人物"},
    {id:"facts",label:"事实"},{id:"promises",label:"承诺"},
    {id:"foreshadowing",label:"伏笔"},{id:"logs",label:"日志"},
  ];

  return (
    <Sheet title="状态引擎" dark={dark} onClose={onClose} height="88vh">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-3">
        {[["回合","234",D.gold],["字数","84K",D.cyan],["插图","12","#bf5af2"]].map(([l,v,c]) => (
          <div key={l} className="rounded-2xl px-3 py-3 text-center" style={{ background: t.fillTer }}>
            <p className="mono" style={{ fontSize:"20px", fontWeight:500, color: c as string }}>{v}</p>
            <p style={{ fontSize:"11px", color: t.label3, marginTop:3 }}>{l}</p>
          </div>
        ))}
      </div>

      {/* Scene */}
      <div className="mx-4 mb-3 px-4 py-3 rounded-2xl" style={{ background: t.fillTer }}>
        <p style={{ fontSize:"11px", color: t.label3, marginBottom:3 }}>当前场景</p>
        <p style={{ fontFamily:"'Lora',serif", fontSize:"15px", fontWeight:600, color: t.label }}>凛冬神殿 · 中殿祭坛</p>
        <p style={{ fontSize:"12px", color: t.label2, marginTop:3 }}>体力 68/100 · 威望 ★★★★☆ · 魔力 45/80</p>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 px-4 pb-3">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: tab===tb.id ? D.gold : t.fillTer, color: tab===tb.id ? "#0a0600" : t.label2, transition:"all 0.18s" }}>{tb.label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="px-4 pb-6 space-y-2">
        {tab === "overview" && ["· 守誓者支线已触发（R233）","· 纹章石持有者身份确认","· 与阿尔维斯好感度达到极高","· 霜冠峰任务倒计时：3天"].map((f,i) => (
          <div key={i} className="px-4 py-3 rounded-2xl" style={{ background: t.fillTer }}><p style={{ fontSize:"13px", color: t.label, lineHeight:1.5 }}>{f}</p></div>
        ))}
        {tab === "characters" && [
          {name:"阿尔维斯",role:"忠诚骑士",status:"极高好感",col: D.gold},
          {name:"霜冠守卫",role:"神庙守护者",status:"已消除敌意",col: D.cyan},
          {name:"王国议长",role:"政治对手",status:"动机未知",col: D.coral},
        ].map(c => (
          <div key={c.name} className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: t.fillTer }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: c.col + "22" }}>
              <span style={{ fontFamily:"'Lora',serif", fontSize:"15px", color: c.col }}>{c.name[0]}</span>
            </div>
            <div>
              <p style={{ fontSize:"14px", fontWeight:600, color: t.label }}>{c.name} <span style={{ fontSize:"12px", color: t.label3, fontWeight:400 }}>— {c.role}</span></p>
              <p style={{ fontSize:"11px", color: t.label3 }}>{c.status}</p>
            </div>
          </div>
        ))}
        {tab === "promises" && [
          {text:"三日内抵达霜冠峰",deadline:"剩余约72小时",crit:true},
          {text:"向阿尔维斯承诺并肩同行",deadline:"进行中",crit:false},
        ].map((p,i) => (
          <div key={i} className="px-4 py-3 rounded-2xl" style={{ background: t.fillTer, border:`0.5px solid ${p.crit ? D.coral+"30" : "transparent"}` }}>
            <p style={{ fontSize:"13px", color: t.label, marginBottom:4 }}>{p.text}</p>
            <p style={{ fontSize:"11px", color: p.crit ? D.coral : D.cyan }}>{p.deadline}</p>
          </div>
        ))}
        {(tab==="facts"||tab==="foreshadowing") && (tab==="facts" ? ["纹章石封存了三百年前的誓约","凛冬王室真实继承人须通过守誓试炼","霜冠峰海拔6800米，全年冰封","阿尔维斯曾是先王护卫队长"] : ["神殿中心有更古老的存在等待觉醒","王国议长暗中追踪你的行踪","纹章石在月圆时散发异常光芒"]).map((f,i) => (
          <div key={i} className="px-4 py-3 rounded-2xl" style={{ background: t.fillTer }}><p style={{ fontSize:"13px", color: t.label, lineHeight:1.5 }}>· {f}</p></div>
        ))}
        {tab==="logs" && [
          {r:234,s:"success",m:"状态提取完成 · 3个新事实"},
          {r:233,s:"success",m:"守誓者支线触发 · 关系图更新"},
          {r:232,s:"warning",m:"预兆提取不完整 · 已回退"},
          {r:231,s:"success",m:"场景切换检测 · 进入神殿"},
          {r:230,s:"error",  m:"人物状态同步失败 · 已重试"},
        ].map((l,i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-2xl" style={{ background: t.fillTer }}>
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: l.s==="success" ? D.green : l.s==="warning" ? D.gold : D.coral }} />
            <div><p className="mono" style={{ fontSize:"10px", color: t.label3 }}>R{l.r}</p><p style={{ fontSize:"12px", color: t.label }}>{l.m}</p></div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function SnapshotsSheet({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const t = useT(dark);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <Sheet title="快照记录" dark={dark} onClose={onClose} height="72vh">
      <div className="px-4 pt-4 pb-2">
        <button className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 font-semibold text-sm" style={{ background: D.goldFillSub, border:`1px dashed ${D.goldBorder}`, color: D.gold }}>
          <span style={{ fontSize:"18px", lineHeight:1 }}>+</span>创建当前快照
        </button>
      </div>
      <div className="px-4 pb-6 space-y-2 pt-2">
        {SNAPS.map(s => (
          <div key={s.id} className="rounded-2xl overflow-hidden" style={{ border:`0.5px solid ${t.sep}` }}>
            <div className="flex items-start gap-3 px-4 py-3" style={{ background: t.bgSecondary }}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: D.cyan }} />
                  <p style={{ fontSize:"14px", fontWeight:600, color: t.label }}>{s.tag}</p>
                </div>
                {s.note && <p style={{ fontSize:"12px", color: t.label2, marginBottom:3 }}>{s.note}</p>}
                <p className="mono" style={{ fontSize:"11px", color: t.label3 }}>R{s.round} · {s.time}</p>
              </div>
              <button onClick={() => setConfirm(s.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold" style={{ background: D.cyanFill, color: D.cyan, flexShrink:0 }}>还原</button>
            </div>
            {confirm === s.id && (
              <div className="px-4 py-3" style={{ background: dark ? "#2a1a1a" : "#fff5f5", borderTop:`0.5px solid ${D.coral}30` }}>
                <p style={{ fontSize:"13px", color: t.label, lineHeight:1.6, marginBottom:10 }}>
                  确认还原至 <strong>R{s.round}</strong>？之后 <strong style={{ color: D.coral }}>{234 - s.round} 条</strong>记录将移入弃置叙事档案。
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl text-sm" style={{ background: t.fillTer, color: t.label2 }}>取消</button>
                  <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: D.coral, color:"#fff" }}>确认还原</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function RerecordSheet({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const t = useT(dark);
  const [items, setItems] = useState(RERECORDS);
  return (
    <Sheet title="待补录队列" dark={dark} onClose={onClose} height="60vh">
      <div className="px-4 pt-4 pb-6">
        {items.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: D.goldFillSub }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 7" stroke={D.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p style={{ fontSize:"15px", color: t.label2 }}>补录队列为空</p>
          </div>
        ) : (
          <>
            <button className="w-full py-2.5 rounded-2xl text-sm font-semibold mb-3" style={{ background: D.goldFillSub, color: D.gold, border:`1px solid ${D.goldBorder}` }}>
              批量补录所有（{items.length}条）
            </button>
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="px-4 py-4 rounded-2xl" style={{ background: t.fillTer }}>
                  <p style={{ fontSize:"13px", color: t.label, marginBottom:6, lineHeight:1.5 }}>"{item.excerpt}"</p>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span style={{ fontSize:"11px", color: D.coral, background: D.coralFill, padding:"2px 8px", borderRadius:100 }}>{item.reason}</span>
                    <span className="mono" style={{ fontSize:"10px", color: t.label3 }}>重试 {item.retries}×</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ background: D.goldFillSub, color: D.gold, border:`1px solid ${D.goldBorder}` }}>重新补录</button>
                    <button onClick={() => setItems(p => p.filter(i => i.id !== item.id))} className="px-4 py-2 rounded-xl text-xs font-medium" style={{ background: D.coralFill, color: D.coral }}>丢弃</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function IllustrationsSheet({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const t = useT(dark);
  const [autoOn, setAutoOn] = useState(true);
  const [style, setStyle] = useState("油画风格");
  const styles = ["油画风格","水彩插画","黑白素描","动漫风格","概念艺术","自定义"];

  return (
    <Sheet title="插图设置" dark={dark} onClose={onClose} height="68vh">
      <div className="px-4 pt-4 pb-8 space-y-4">
        <div className="flex items-center justify-between px-4 py-4 rounded-2xl" style={{ background: t.fillTer }}>
          <div>
            <p style={{ fontSize:"15px", color: t.label, fontWeight:500 }}>自动生成插图</p>
            <p style={{ fontSize:"12px", color: t.label2, marginTop:2 }}>每轮叙事结束后自动触发</p>
          </div>
          <Toggle on={autoOn} onToggle={() => setAutoOn(!autoOn)} />
        </div>
        <div>
          <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:10 }}>插图风格</p>
          <div className="flex flex-wrap gap-2">
            {styles.map(s => <button key={s} onClick={() => setStyle(s)} className="px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: style===s ? D.gold : t.fillTer, color: style===s ? "#0a0600" : t.label2, transition:"all 0.18s" }}>{s}</button>)}
          </div>
        </div>
        {style === "自定义" && (
          <div className="fade-in">
            <p style={{ fontSize:"12px", color: t.label3, marginBottom:8 }}>自定义提示词</p>
            <textarea className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none" rows={3} placeholder="dark fantasy, dramatic lighting, detailed..." style={{ background: t.fillTer, color: t.label, caretColor: D.gold, border:`0.5px solid ${t.sep}` }} />
          </div>
        )}
        <div>
          <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:10 }}>高级参数</p>
          <div className="rounded-2xl overflow-hidden" style={{ border:`0.5px solid ${t.sep}` }}>
            {[["尺寸","1024×768"],["清晰度","标准"],["生成张数","1"],["种子锁定","关闭"]].map(([l,v],i,arr) => (
              <div key={l} className="flex items-center px-4 py-3" style={{ background: t.bgSecondary, borderBottom: i<arr.length-1 ? `0.5px solid ${t.sep}` : "none" }}>
                <p className="flex-1" style={{ fontSize:"14px", color: t.label }}>{l}</p>
                <p style={{ fontSize:"14px", color: t.label2 }}>{v}</p>
              </div>
            ))}
          </div>
        </div>
        <button className="w-full py-3 rounded-2xl font-semibold text-sm" style={{ background: D.gold, color:"#0a0600" }}>保存设置</button>
      </div>
    </Sheet>
  );
}

function WorldSwitchSheet({ dark, onClose, worlds, current, onSelect }: { dark: boolean; onClose: () => void; worlds: World[]; current: World; onSelect: (w: World) => void }) {
  const t = useT(dark);
  return (
    <Sheet title="切换世界集" dark={dark} onClose={onClose} height="72vh">
      <div className="px-4 pt-4 pb-6 space-y-2">
        <button className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold mb-3" style={{ background: D.goldFillSub, border:`1px dashed ${D.goldBorder}`, color: D.gold }}>
          + 新建世界集
        </button>
        {worlds.map(w => {
          const isActive = w.id === current.id;
          return (
            <div key={w.id} onClick={() => { onSelect(w); onClose(); }} className="flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer" style={{ background: isActive ? D.goldFillSub : t.fillTer, border:`0.5px solid ${isActive ? D.goldBorder : "transparent"}` }}>
              <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width:44, height:44 }}>
                <img src={w.img} alt={w.name} className="w-full h-full object-cover" style={{ filter:"brightness(0.7)" }} />
              </div>
              <div className="flex-1">
                <p style={{ fontSize:"15px", fontWeight: isActive ? 600 : 400, color: isActive ? D.goldBright : t.label }}>{w.name}</p>
                <p style={{ fontSize:"12px", color: t.label3 }}>{w.core} · {w.lines} 线 · R{w.rounds.toLocaleString()}</p>
              </div>
              {isActive && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: D.gold }} />}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function ModelConfigSheet({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const t = useT(dark);
  const [provider, setProvider] = useState("Anthropic");
  const providers = ["Anthropic","OpenAI","Gemini","本地（Ollama）","自定义"];
  const models = ["claude-opus-5","claude-sonnet-5","claude-haiku-4-5"];
  const [sel, setSel] = useState(["claude-opus-5"]);

  return (
    <Sheet title="模型配置" dark={dark} onClose={onClose} height="85vh">
      <div className="px-4 pt-4 pb-8 space-y-5">
        <div>
          <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:10 }}>提供商</p>
          <div className="flex flex-wrap gap-2">
            {providers.map(p => <button key={p} onClick={() => setProvider(p)} className="px-3 py-2 rounded-xl text-sm font-medium" style={{ background: provider===p ? D.gold : t.fillTer, color: provider===p ? "#0a0600" : t.label2, transition:"all 0.18s" }}>{p}</button>)}
          </div>
        </div>
        <div>
          <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:8 }}>API 配置</p>
          <div className="space-y-2">
            {["API 地址","API Key"].map(l => (
              <div key={l}>
                <p style={{ fontSize:"12px", color: t.label3, marginBottom:4 }}>{l}</p>
                <input className="w-full px-4 py-3 rounded-2xl text-sm outline-none" placeholder={l === "API Key" ? "sk-ant-..." : "https://api.anthropic.com"} style={{ background: t.fillTer, color: t.label, caretColor: D.gold, border:`0.5px solid ${t.sep}` }} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-8">
            <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em" }}>可用模型</p>
            <button style={{ fontSize:"13px", color: D.gold }}>拉取模型列表</button>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border:`0.5px solid ${t.sep}` }}>
            {models.map((m,i,arr) => (
              <div key={m} onClick={() => setSel(p => p.includes(m) ? p.filter(x => x!==m) : [...p,m])} className="flex items-center gap-3 px-4 py-3 cursor-pointer" style={{ background: t.bgSecondary, borderBottom: i<arr.length-1 ? `0.5px solid ${t.sep}` : "none" }}>
                <div className="w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0" style={{ borderColor: sel.includes(m) ? D.gold : t.label3, background: sel.includes(m) ? D.gold : "transparent" }}>
                  {sel.includes(m) && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#0a0600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span className="mono flex-1" style={{ fontSize:"13px", color: t.label }}>{m}</span>
                {sel[0] === m && <span style={{ fontSize:"11px", color: D.gold, background: D.goldFillSub, padding:"2px 8px", borderRadius:100 }}>主力</span>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p style={{ fontSize:"12px", fontWeight:600, color: t.label3, letterSpacing:"0.06em", marginBottom:10 }}>思考程度</p>
          <div className="flex gap-2">
            {["快速","标准","扩展","最强"].map(l => <button key={l} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ background: l==="扩展" ? D.gold : t.fillTer, color: l==="扩展" ? "#0a0600" : t.label2 }}>{l}</button>)}
          </div>
        </div>
        <button className="w-full py-3 rounded-2xl font-semibold text-sm" style={{ background: t.fillTer, color: D.gold, border:`1px solid ${D.goldBorder}` }}>
          测试连接
        </button>
      </div>
    </Sheet>
  );
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────
function IconBtn({ dark, onClick, title, children }: { dark: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  const t = useT(dark);
  return (
    <button onClick={onClick} title={title} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: t.fillTer, color: t.label2 }}>
      {children}
    </button>
  );
}

function ToolBtn({ label, dark, onClick, badge }: { label: string; dark: boolean; onClick: () => void; badge?: number }) {
  const t = useT(dark);
  return (
    <button onClick={onClick} className="relative px-3 py-1.5 rounded-xl text-xs font-medium" style={{ background: t.fillTer, color: t.label2 }}>
      {label}
      {badge != null && badge > 0 && (
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: D.coral, fontSize:"9px", color:"#fff", fontWeight:700 }}>{badge}</div>
      )}
    </button>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} className="relative cursor-pointer flex-shrink-0" style={{ width:51, height:31, borderRadius:100, background: on ? D.gold : D.fill, transition:"background 0.2s ease" }}>
      <div style={{ position:"absolute", top:2, width:27, height:27, borderRadius:"50%", background:"#fff", transition:"left 0.22s cubic-bezier(0.34,1.4,0.64,1)", left: on ? 22 : 2, boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }} />
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [dark,        setDark]        = useState(true);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [view,        setView]        = useState<MainView>("dialogue");
  const [overlay,     setOverlay]     = useState<Overlay>(null);
  const [world,       setWorld]       = useState<World>(WORLDS[0]);
  const [activeLine,  setActiveLine]  = useState<Line | null>(LINES[0]);
  const [diMode,      setDiMode]      = useState<DiMode>("idle");
  const [generating,  setGenerating]  = useState(false);
  const [wordCount,   setWordCount]   = useState(0);
  const genStage: GenStage            = "narrative";
  const timerRef                      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulate one generation cycle for demo
  const startGenDemo = () => {
    if (generating) return;
    setGenerating(true);
    setDiMode("pill" );
    setWordCount(0);
    let c = 0;
    timerRef.current = setInterval(() => {
      c += Math.floor(Math.random() * 25 + 12);
      setWordCount(c);
      if (c >= 290) {
        clearInterval(timerRef.current!);
        setGenerating(false);
        setDiMode("idle" );
      }
    }, 380);
  };

  const stopGen = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setGenerating(false);
    setDiMode("idle" );
  };

  const handleDiToggle = () => {
    setDiMode(m => m === "pill" ? "expanded"  : "pill" );
  };

  const handleView = (v: MainView) => {
    setView(v);
    setDrawerOpen(false);
  };

  const handleOverlay = (o: Overlay) => {
    setOverlay(o);
  };

  const t = useT(dark);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: t.bg, color: t.label, fontFamily:"'DM Sans', system-ui, sans-serif" }}>

      {/* Dynamic Island — absolute positioned at very top */}
      {diMode !== ("idle" ) && view === "dialogue" && (
        <DynamicIsland mode={diMode as DiMode} onToggle={handleDiToggle} wordCount={wordCount} stage={genStage} onStop={stopGen} dark={dark} />
      )}

      {/* Main view */}
      {view === "dialogue" && (
        <DialogueScreen
          dark={dark} onMenu={() => setDrawerOpen(true)}
          line={activeLine} world={world}
          msgs={MSGS} actionOpts={ACTION_OPTIONS}
          diMode={diMode as DiMode} generating={generating} wordCount={wordCount}
          onDiToggle={startGenDemo} onDiStop={stopGen}
          onOverlay={handleOverlay}
        />
      )}
      {view === "gallery"  && <GalleryScreen  dark={dark} onMenu={() => setDrawerOpen(true)} />}
      {view === "settings" && <SettingsScreen dark={dark} onMenu={() => setDrawerOpen(true)} onToggleDark={() => setDark(d => !d)} />}
      {view === "help"     && <HelpScreen     dark={dark} onMenu={() => setDrawerOpen(true)} />}

      {/* Left Drawer */}
      <Drawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        dark={dark} world={world} lines={LINES} activeLine={activeLine}
        onLineSelect={line => { setActiveLine(line); setView("dialogue"); }}
        onOverlay={o => { setOverlay(o); setDrawerOpen(false); }}
        onView={v => { setView(v); setDrawerOpen(false); }}
        view={view} rerecordCount={RERECORDS.length}
      />

      {/* Overlay sheets */}
      {overlay === "state"          && <StateSheet         dark={dark} onClose={() => setOverlay(null)} />}
      {overlay === "snapshots"      && <SnapshotsSheet     dark={dark} onClose={() => setOverlay(null)} />}
      {overlay === "rerecord"       && <RerecordSheet      dark={dark} onClose={() => setOverlay(null)} />}
      {overlay === "illustrations"  && <IllustrationsSheet dark={dark} onClose={() => setOverlay(null)} />}
      {overlay === "modelConfig"    && <ModelConfigSheet   dark={dark} onClose={() => setOverlay(null)} />}
      {overlay === "worldSwitch"    && <WorldSwitchSheet   dark={dark} onClose={() => setOverlay(null)} worlds={WORLDS} current={world} onSelect={setWorld} />}
      {overlay === "appearance"     && (
        <Sheet title="外观个性化" dark={dark} onClose={() => setOverlay(null)} height="60vh">
          <div className="px-4 pt-4 pb-8 space-y-4">
            {[["深色主题", <Toggle on={dark} onToggle={() => setDark(d => !d)} />],["衬线叙事字体",<Toggle on={true} onToggle={() => {}} />],["叙事行距","<span style='font-size:14px'>宽松</span>"],["阅读宽度","<span style='font-size:14px'>100%</span>"]].map(([l,r],i) => (
              <div key={i} className="flex items-center justify-between px-4 py-4 rounded-2xl" style={{ background: t.fillTer }}>
                <p style={{ fontSize:"15px", color: t.label }}>{l as string}</p>
                {typeof r === "object" ? r : <span style={{ fontSize:"14px", color: t.label2 }} dangerouslySetInnerHTML={{ __html: r as string }} />}
              </div>
            ))}
            <div>
              <p style={{ fontSize:"12px", color: t.label3, marginBottom:10, letterSpacing:"0.06em", fontWeight:600 }}>字号</p>
              <div className="flex gap-2">
                {["小","标准","大","特大"].map(s => <button key={s} className="flex-1 py-2.5 rounded-xl text-sm" style={{ background: s==="标准" ? D.gold : t.fillTer, color: s==="标准" ? "#0a0600" : t.label2 }}>{s}</button>)}
              </div>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
