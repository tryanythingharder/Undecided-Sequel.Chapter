# Zcode V2 Use Cases

The following use cases consolidate the requirements already given for the universal multi-kernel direction. They are the approved input for this isolated prototype and do not change production behavior.

## UC-001: Continue Content

| Field | Definition |
| --- | --- |
| Actors | Creator, Zcode, active kernel |
| Preconditions | A world and an active kernel exist; the current world line can be loaded |
| Main flow | 1. Open Content. 2. Resume the current world line. 3. Read the latest scene and kernel state. 4. Enter an action. 5. Receive generated content and updated choices. |
| Alternative flows | Open another world line; search history; stop generation; recover a pending commit; open state inspector. |
| Postconditions | The turn and structured state are committed, or a visible recovery state remains. |

## UC-002: Design A Kernel With AI

| Field | Definition |
| --- | --- |
| Actors | Kernel designer, Zcode design agent, validation engine |
| Preconditions | Kernel Design mode is available; a draft may be new or imported. |
| Main flow | 1. Enter Kernel Design. 2. State the intended experience. 3. AI proposes a structured checkpoint. 4. Review assumptions, rules, and missing decisions. 5. Accept or revise. 6. Validate. 7. Publish a version. |
| Alternative flows | Start from a template; fork an existing kernel; inspect source; return to the conversation without saving source edits. |
| Postconditions | A versioned reusable kernel exists, or a named draft remains with visible validation state. |

## UC-003: Find, Inspect, And Apply A Kernel

| Field | Definition |
| --- | --- |
| Actors | Creator, kernel library, target world |
| Preconditions | At least one kernel exists in the library. |
| Main flow | 1. Invoke Kernel Library. 2. Search or filter. 3. Select a kernel. 4. Review compatibility and version. 5. Choose a target world. 6. Apply. 7. Return to the prior mode. |
| Alternative flows | Create, import, duplicate, archive, inspect source, or cancel without changing the current world. |
| Postconditions | The chosen world references the selected kernel version, with a visible confirmation and undo window. |

