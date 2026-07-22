# Video Loop Trim — UX Brief

**Problem:** In/Out/Hold number fields on compact clip rows are opaque. Users need a visual trimmer: click video → expand → pick loop start/end by scrubbing.

**Existing model (keep):** `BgClip` — `trimStartSec` / `trimEndSec` = loop window in source media; `durationSec` = hold on song timeline; stage/export already loop via `mediaTimeFromLocalT` + `applyClipTrim`.

**Primary surface:** `UploadPanel` bg clip list (`src/components/UploadPanel.jsx`). Reuse `getClipTrim` / `applyClipTrim` / `formatClipTime` from `src/lib/bgTimeline.js`.

---

## 1. Interaction flow

```
Collapsed row (video)
  └─ Click thumb OR row body (not ↑↓× / not Hold input)
       → expand this clip; collapse any other expanded clip
       → autoplay muted loop preview (In→Out only)
       → focus scrubber for keyboard

Expanded editor
  ├─ Scrub: drag playhead / click track → seek preview video (source timeline)
  ├─ Set In: button, or drag In handle, or [ I ] at playhead
  ├─ Set Out: button, or drag Out handle, or [ O ] at playhead
  ├─ Play/Pause: toggle loop-only preview (never plays outside In–Out)
  ├─ Hold: auto = loop length; optional "Advanced" reveals manual Hold
  └─ Done / click another row / Esc → collapse; keep last trim

Constraints (enforce live):
  - min loop = 0.25s (match applyClipTrim)
  - 0 ≤ In < Out ≤ sourceDurationSec
  - dragging In past Out−0.25 clamps; same for Out
  - on In/Out change: if holdSynced (default), durationSec = Out − In
```

**Images:** no expand trimmer; keep Hold only.

---

## 2. Expanded layout (wireframe)

```
┌─ bg-clip-row is-expanded ─────────────────────────────────────┐
│ ┌──────┐  2. night-garden.mp4          Loop 3.2s · file 12.0s │
│ │thumb │  [Done]                              ↑  ↓  ×          │
│ └──────┘                                                       │
│                                                                │
│ ┌─ VideoTrimEditor ──────────────────────────────────────────┐ │
│ │  ┌─────────────────────────────────────────────────────┐   │ │
│ │  │           PREVIEW (16:9, muted, playsInline)        │   │ │
│ │  │           loops In ──► Out only                     │   │ │
│ │  └─────────────────────────────────────────────────────┘   │ │
│ │                                                            │ │
│ │  [▶/❚❚]  0:02.4 / loop 3.2s                                │ │
│ │                                                            │ │
│ │  SOURCE TIMELINE (full file width)                         │ │
│ │  |========[████ LOOP ████]================|                │ │
│ │  0      In▴        playhead▾      Out▴   source            │ │
│ │  dim    │◄── highlight ──►│        dim                     │ │
│ │                                                            │ │
│ │  [ Set In ]  In 0:01.5    [ Set Out ]  Out 0:04.7          │ │
│ │                                                            │ │
│ │  ▸ Advanced                                                │ │
│ │    (collapsed by default)                                  │ │
│ │    Hold [ 3.2 ] s   ☑ Match loop length                    │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Collapsed video row (replace raw In/Out inputs):**

```
┌─ thumb ─┬─ name · Loop 3.2s (1.5→4.7) · Hold 3.2s ─┬─ ↑↓× ─┐
│  VID    │  tiny range bar under name (optional)     │       │
└─────────┴───────────────────────────────────────────┴───────┘
```

Hint under list: *"Click a video to set the seamless loop."* Remove the dense In/Out/Hold explainer once UI is visual.

---

## 3. Controls

| Control | Behavior |
|--------|----------|
| **Play / Pause** | Toggle muted preview. While playing, `currentTime` advances only inside In–Out; at Out−ε seek to In (rAF or `timeupdate`). Pause freezes frame. |
| **Scrubber / playhead** | Horizontal track = full `sourceDurationSec`. Click/drag seeks preview. Outside loop range: allowed while scrubbing (to pick new In/Out); resume play snaps into loop. |
| **In marker** | Draggable handle on track. "Set In" = `trimStartSec = playhead` (clamped). |
| **Out marker** | Same for `trimEndSec`. |
| **Loop range highlight** | Filled bar between In and Out; outside dimmed. |
| **Hold** | Hidden under Advanced. Default: locked to loop length (`syncHold: true`). Uncheck "Match loop length" → free Hold number (call `onClipDuration`, stop auto-sync for that edit session). |
| **Done** | Collapse expanded editor. |

**Precision:** drag handles with 0.05–0.1s quantize; show `formatClipTime`. Optional shift+arrow = 0.1s, arrow = 0.5s when track focused.

---

## 4. Hold vs In/Out

| Concept | Field | Meaning |
|--------|--------|---------|
| Loop segment | `trimStartSec`–`trimEndSec` | Source frames that repeat |
| Hold | `durationSec` | How long clip owns the stage timeline |

**Default (recommended):** setting In/Out calls `applyClipTrim(clip, { …, syncHold: true })` — same as `App.handleClipTrim` today. Hold always equals loop length → one seamless cycle per hold slot (best for single looping BGs).

**Advanced:** uncheck "Match loop length" → user sets Hold independently (hold > loop = multiple loops on stage; hold < loop = cut short — rare). When re-enabling match, set `durationSec = Out − In`.

**Collapsed row:** show `Loop Xs` always; show Hold only if `hold !== loop length` (or always as secondary muted text).

Do **not** put Hold next to In/Out as peer number fields in the expanded primary UI.

---

## 5. Visual feedback

1. **Range highlight** on source timeline: solid accent between In/Out; 40% opacity outside.
2. **Markers:** labeled `In` / `Out` handles (high contrast, ≥8px hit target, larger touch ≥24px).
3. **Playhead:** thin line + time tooltip while dragging.
4. **Preview loop:** video element only ever plays In→Out when playing; brief flash/opacity on wrap optional (skip if janky).
5. **Expanded row:** border/glow + `aria-expanded`; list scrolls expanded editor into view (`scrollIntoView({ block: "nearest" })`).
6. **Collapsed summary:** `Loop {length}s` + optional mini bar `width% = length/source`, `marginLeft% = start/source`.
7. **Invalid drag:** cursor `not-allowed` / clamp; no error toast for normal clamps.

---

## 6. React component structure

```
UploadPanel
  state: expandedClipId: string | null
  bgClips.map → BgClipRow

BgClipRow
  props:
    clip, index, isFirst, isLast, isExpanded
    onExpand(id)          // toggle / exclusive expand
    onCollapse()
    onMove(id, dir)
    onRemove(id)
    onDuration(id, sec)   // Hold (images + advanced video)
    onTrim(id, patch)     // { trimStartSec?, trimEndSec?, syncHold? }
  collapsed: thumb, name, loop summary, Hold (images always; video if advanced or mismatch)
  expanded + video: <VideoTrimEditor … />

VideoTrimEditor
  props:
    clip: BgClip
    onTrim(patch)         // parent → handleClipTrim / applyClipTrim
    onDuration(sec)       // parent → handleClipDuration
    onDone()
  internal state:
    playing: boolean
    playheadSec: number   // source time
    holdSynced: boolean   // default true
    advancedOpen: boolean
  refs:
    videoRef
  subcomponents (can be same file initially):
    TrimTimeline
      props: source, inSec, outSec, playheadSec
      events: onSeek(sec), onInChange(sec), onOutChange(sec)
    LoopPreviewVideo
      props: url, inSec, outSec, playing, playheadSec, onPlayhead(sec), onEndedLoop
```

**Events → App (existing handlers OK):**

| UI event | Call |
|----------|------|
| In/Out change (synced) | `onClipTrim(id, { trimStartSec, trimEndSec })` — App already forces `syncHold: true` |
| In/Out + keep free hold | extend `handleClipTrim` to accept `syncHold: false` when Advanced unlocked |
| Hold number | `onClipDuration(id, sec)` |
| Expand | local to UploadPanel only |

**Suggested files:**

- `src/components/BgClipRow.jsx` (optional extract)
- `src/components/VideoTrimEditor.jsx` (+ CSS in `styles.css` under `.video-trim-*`)
- Keep trim math in `bgTimeline.js` (no duplicate clamps)

---

## 7. Implementation steps

1. **Extract row shell** — `BgClipRow` with expand state in `UploadPanel`; remove always-visible In/Out number inputs for video; keep Hold for images.
2. **VideoTrimEditor scaffold** — preview `<video muted playsInline>`, Play/Pause, Done; wire `url` + initial seek to In.
3. **Loop playback** — on `timeupdate`/rAF: if `currentTime >= outSec - 0.02` → `currentTime = inSec`; playing only inside range.
4. **TrimTimeline** — full-width track, range fill, In/Out handles, playhead; pointer events → `onTrim` via `applyClipTrim` clamps.
5. **Set In / Set Out buttons** — from playhead; show `formatClipTime` labels.
6. **Hold policy** — default sync (existing App path); Advanced disclosure + checkbox; pass `syncHold: false` when unlocked; collapse summary shows Loop (± Hold if different).
7. **Polish** — exclusive expand, Esc/Done, scroll into view, collapsed mini-range, update list hint copy.
8. **Smoke** — single video loop on stage + export still honor trim; multi-clip order/hold unchanged; min 0.25s loop; keyboard path works.

---

## 8. Accessibility

- Row expand control: `button` or row with `role="button"`, `aria-expanded`, `aria-controls={editorId}`.
- Don't expand when activating ↑↓×, Hold input, or Advanced fields (`stopPropagation`).
- Timeline: `role="slider"` group or three sliders — **Playhead**, **In**, **Out** — each with `aria-valuemin/max/now`, `aria-label`.
- Keys (when editor focused):
  - `Space` / `k` — play/pause
  - `←` / `→` — nudge playhead 0.5s (Shift: 0.1s)
  - `i` / `o` — set In / Out at playhead
  - `Esc` — collapse
  - `Tab` cycles: Play → Set In → Set Out → timeline → Advanced → Done
- Preview video: `aria-hidden` decorative (controls are the buttons); announce loop length via live region on In/Out commit: `"Loop 3.2 seconds"`.
- Handles: visible focus ring; touch targets ≥ 44px height on track.
- Reduced motion: skip wrap flash; instant seek OK.

---

## Out of scope

- Waveform / audio from BG video
- Multi-segment trim / speed
- Frame-accurate (~1/30s) unless free later
- Changing stage preview when editor is open (list editor owns its own `<video>`)

## Acceptance

User clicks a video clip → editor expands with preview → drags or sets In/Out on a full-file timeline → hears/sees only the loop → Hold stays in sync unless Advanced → Done collapses with clear Loop summary → stage + export use same trim fields as today.
