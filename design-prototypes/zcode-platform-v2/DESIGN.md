---
version: prototype-v2
name: Zcode Universal Kernel Canvas
description: A single-focus AI creation workspace where content and kernel design are distinct modes, while libraries and source stay invocation-only.
sources:
  - ../../../renderer/index.html
  - ../../../renderer/styles.css
  - ../../../build/cat.png
  - ../../../docs/shots/01-splash.png
  - ../../../docs/shots/02-main-dark.png
  - ../../../output/playwright/reference-mobbin-cursor.png
  - ../../../output/playwright/reference-mobbin-cosmos.png
  - ../../../output/playwright/reference-mobbin-jitter.png
  - ../../../output/playwright/reference-mobbin-claude.png
notes:
  - Local product files are direct evidence. Award references are interaction inspiration, not brand sources.
  - The existing opening animation, Dynamic Island behavior, black-cat icon, and production functionality remain unchanged.
  - This document governs an isolated prototype only.
colors:
  canvas: "#0A0A0B"
  surface: "#111214"
  surfaceRaised: "#191A1D"
  text: "#F4F1EA"
  textMuted: "#AAA9A5"
  border: "#303238"
  brand: "#D6A45B"
  information: "#79B7FF"
  success: "#79C89C"
  danger: "#FF8B8B"
typography:
  ui:
    fontFamily: "Noto Sans SC, Segoe UI, Microsoft YaHei, system-ui, sans-serif"
  mono:
    fontFamily: "IBM Plex Mono, Cascadia Code, Consolas, monospace"
---

# Product Direction

Zcode is a general platform for many kernels. It is not a kernel editor wrapped around one story engine. The product has two top-level modes:

- **Content**: continue a world, inspect its state, and talk to the active kernel.
- **Kernel Design**: collaborate with AI to create, test, revise, and publish reusable kernels.

The active mode owns the whole canvas. Kernel Library, Source, History, and Commands are temporary layers. They never become permanent peer columns.

# Evidence And Inference

## Direct evidence

- The existing product uses near-black surfaces, warm amber emphasis, a restrained icon system, an animated opening, and a centered story reading width.
- `build/cat.png` is the application identity asset and must remain visible as the product mark.
- Existing functionality includes worlds, conversations, kernel management, source editing, notifications, theme controls, gallery, state inspection, and keyboard shortcuts.

## Awarded-work behavior used

- **Cursor**: one central AI action and minimal persistent chrome.
- **Claude**: full capability can live behind a calm conversational surface.
- **Cosmos**: depth and discovery appear when invoked, not as permanent density.
- **Jitter**: motion explains state transitions rather than decorating idle screens.

## Inference

- A universal-kernel platform benefits from a command surface and temporary layers because the same person repeatedly shifts between creating worlds, selecting kernels, and auditing source.
- Comfortable density should be default. Compact density is a user-controlled mode, not the permanent visual language.

# Tokens

## Color roles

| Token | Role | Do not use for |
| --- | --- | --- |
| `canvas` | Window and focus-layer background | Raised controls |
| `surface` | Composer, navigation, quiet grouped content | Decoration |
| `surfaceRaised` | Command palette, library sheet, source sheet | Every section |
| `text` | Primary copy and active labels | Disabled states |
| `textMuted` | Metadata and secondary labels | Critical status without an icon or label |
| `brand` | Product mark and primary action | Success or warning semantics |
| `information` | Informational state with icon/text | Brand decoration |
| `success` | Validated and saved states with icon/text | Selection alone |
| `danger` | Destructive or failed states with icon/text | General emphasis |

Color never carries meaning alone. Every status combines color with a label and, where space permits, an icon.

## Typography

- Use a single readable UI family, `Noto Sans SC`, across interface and narrative copy.
- Use `IBM Plex Mono` only for source, identifiers, versions, and technical metadata.
- Base size is 16px for editable fields and 14px for interface copy.
- Use a major-second scale for an app-like hierarchy. No viewport-scaled type and no negative letter spacing.
- Narrative measure is 62ch; technical measure is unconstrained inside the source focus layer.

## Geometry

- Radius: 4px for inputs, 6px for panels and sheets, circular only for avatars/status dots.
- Touch targets: 40px minimum in the desktop prototype, 44px in narrow mode.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Borders establish grouping; shadows are reserved for temporary focus layers.

# Spatial Model

1. A quiet top bar holds identity, the `Content / Kernel Design` mode switch, and global actions.
2. A slim left dock contains invocations, not a persistent information wall.
3. The active mode takes the remaining canvas.
4. The Kernel Library opens as a left focus sheet.
5. Source opens as a full focus layer with an explicit return action.
6. Dynamic Island notifications occupy reserved top-center space and never cover navigation.

# Component Contracts

## Mode switch

- Native buttons inside a labelled tablist.
- Arrow keys move between modes; Enter/Space activates.
- Active mode uses shape, label, and color together.

## Composer

- One textarea, visible context line, attachment/action tools, and one primary send command.
- `Ctrl+Enter` sends. Empty submit is ignored and announced.
- Generation replaces Send with Stop without changing control dimensions.

## Kernel checkpoint

- A kernel-design conversation periodically produces a structured checkpoint inside the main flow.
- Checkpoints expose `Accept`, `Revise`, and `Inspect source`; they are not nested cards.
- Acceptance updates the progress rail and announces the change.

## Library sheet

- Search, recent kernels, status, version, and clear actions.
- Selected state uses a leading marker, border, and `Selected` text.
- Applying a kernel requires an explicit destination world.

## Source focus layer

- Opens intentionally from a checkpoint or command menu.
- Source and audit may share this focus layer because source inspection is now the only task.
- Save state remains persistent and text-labelled.

## Dynamic Island

- Collapsed state shows icon plus concise status.
- Expanded state may show progress or a single recovery action.
- It does not contain navigation and is `aria-live="polite"`.

# Motion

- Micro feedback: 120-160ms.
- Sheets and command palette: 220-260ms using transform plus opacity.
- Mode recomposition: 320ms maximum; content never crossfades through an empty frame.
- No continuous decorative motion.
- `prefers-reduced-motion: reduce` removes spatial travel while retaining immediate state feedback.

# Responsive Behavior

| Region | Wide (>=1200) | Medium (760-1199) | Narrow (<760) |
| --- | --- | --- | --- |
| Top bar | Full identity and actions | Short identity, full mode switch | Icon identity, essential actions only |
| Left dock | 56px icon dock | 48px icon dock | Bottom command dock |
| Content | Centered 62ch reading canvas | Centered flexible canvas | Edge-to-edge with safe-area padding |
| Composer | Max 760px, fixed footprint | Width follows canvas | Docked above safe area, 16px input text |
| Library | 400px left sheet | 360px left sheet | Full-height bottom sheet |
| Source | Source plus audit | Source plus collapsible audit | Source/audit tabs |

# Imagery And Icon Rules

- The black cat remains the application mark. Do not redraw or recolor it.
- World imagery is content, not wallpaper. Show it at inspectable contrast and stable aspect ratio.
- Use a consistent 1.75px line icon system for commands. Pair unfamiliar icons with tooltips.
- Do not use decorative gradients, floating color blobs, glass cards, or nested cards.

# Do And Do Not

## Do

- Give one task visual priority at a time.
- Let overlays preserve context and provide an obvious return.
- Use motion to explain where a layer came from and where it returns.
- Expose keyboard focus and ensure focused content is not obscured.

## Do not

- Recreate `Kernel Library | AI Chat | Source` as equal persistent columns.
- Turn the first screen into a marketing page or an explanation of features.
- Represent saved, valid, warning, or selected states by color alone.
- Claim production readiness from a visual prototype.

