# UC-003 States

```mermaid
stateDiagram-v2
    [*] --> LibraryOpen
    LibraryOpen --> Filtering: Type search
    Filtering --> KernelSelected: Select result
    KernelSelected --> ChoosingWorld: Apply
    ChoosingWorld --> Incompatible: Check fails
    Incompatible --> KernelSelected: Review guidance
    ChoosingWorld --> Applying: Check passes
    Applying --> Applied: Save reference
    Applied --> [*]
    LibraryOpen --> [*]: Cancel
```

