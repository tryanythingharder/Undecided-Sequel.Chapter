# UX Flows - Zcode Universal Kernel Platform

## Master Screen Map

See [screen-map.md](diagrams/screen-map.md).

## Screen Inventory

| Screen or layer | Purpose | Wireframe | Use cases |
| --- | --- | --- | --- |
| Content Canvas | Read and continue the active world | [content](wireframes/content.html) | UC-001 |
| Kernel Design Canvas | Collaborate with AI through structured checkpoints | [kernel design](wireframes/kernel-design.html) | UC-002 |
| Kernel Library Sheet | Find, inspect, and apply reusable kernels | [library](wireframes/kernel-library.html) | UC-003 |
| Source Focus Layer | Edit and validate kernel source intentionally | [source](wireframes/source-focus.html) | UC-002, UC-003 |

## Use Case Diagrams

- UC-001: [Flow](diagrams/uc-001-content/flow.md), [States](diagrams/uc-001-content/states.md), [Sequence](diagrams/uc-001-content/sequence.md)
- UC-002: [Flow](diagrams/uc-002-kernel-design/flow.md), [States](diagrams/uc-002-kernel-design/states.md), [Sequence](diagrams/uc-002-kernel-design/sequence.md)
- UC-003: [Flow](diagrams/uc-003-kernel-operations/flow.md), [States](diagrams/uc-003-kernel-operations/states.md), [Sequence](diagrams/uc-003-kernel-operations/sequence.md)

## Clickable Prototype Links

| From | Element | To |
| --- | --- | --- |
| Content | Kernel Design tab | Kernel Design |
| Content | Kernel Library command | Kernel Library |
| Kernel Design | Inspect source | Source Focus |
| Kernel Library | Inspect source | Source Focus |
| Kernel Library | Apply | Content |
| Source Focus | Return to design | Kernel Design |

## Navigation Patterns

- Content and Kernel Design are the only top-level modes.
- Library and Source are focus layers that preserve a clear return path.
- On narrow screens, the left command dock moves to the bottom and sheets become full-height.
- `Esc` closes the topmost temporary layer. Mode switching remains available only when no blocking confirmation is open.

## Open Questions For Production

- Whether a published kernel version is immutable or can receive patch releases.
- Exact compatibility contract between a kernel version and an existing world state.
- Whether source edits require an explicit branch before modification.
- Whether third-party kernels need trust, permission, or sandbox indicators.

The wireframes can later be exported through Figma Code to Canvas after the user explicitly requests Figma setup. No Figma operation is attempted in this prototype phase.
