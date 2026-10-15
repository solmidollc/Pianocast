# PianoCanva design audit — 15 October 2026

Audience: piano teachers and performers composing camera, score, annotation and MIDI views for recordings or shared video calls. Preserve the working editor, music typography, templates, local projects and media pipeline.

## Prioritized findings (before implementation)

| Priority | Location | Finding / evidence | Improvement |
| --- | --- | --- | --- |
| High | Editor at 390px | Fixed 256px and 288px panels consume the viewport; canvas disappears and toolbar controls overflow. This blocks use. | Offer Canvas, Layers and Properties views on narrow screens; wrap toolbar controls and keep scene strip in one scrollable row. |
| High | Getting started, both entry points | Promises an interactive tour, then shows a coming-later notice. It gives no usable setup instructions. | One shared, factual guide covering scenes, cameras, MIDI, microphone, annotations, recording and tab sharing. |
| High | Welcome / Livestream | Action cards omit purpose; Livestream may be mistaken for a hosted broadcasting service. | Add short descriptions and explain sharing the composed tab through a video-call app. Preserve the established greeting and action choices. |
| High | Modal dialogs | Several lack Escape handling, focus containment and focus return. Top-bar selects have no accessible names. | Shared keyboard behavior on project, library, help, shortcut and pairing dialogs; name key and MIDI controls. |
| Medium | Scene chooser on phone | Nested margins and padding squeeze names into multiple lines. Sticky creation form covers about a quarter of the display. | Correct card spacing, increase preview targets, remove sticky positioning on small screens, explain multi-selection. |
| Medium | Home, dialogs, editor | Mixed 10–13px helper text, 0–12px radii and decorative hover motion create inconsistent density. | Set readable helper text and restrained control/dialog corners; remove welcome entrance and floating-card motion. This is a consistency judgment, not a claim that rounded cards are inherently bad. |
| Medium | Camera phone connection | Browser users see Electron and npm developer instructions. | Explain that phone camera streaming requires the desktop app, distinguishing it from browser drawing-device pairing. |
| Medium | Light appearance | Some dialogs and secondary text retain hard-coded dark colors. | Use existing theme tokens for dialogs and helper text. Preserve scene/output colors. |
| Low | Companion | Useful compact drawing controls already support touch and horizontal scrolling. | Preserve drawing and pairing behavior; improve small help text only. |

## Scope and preservation

Keep the personalized welcome, Record / Livestream / Edit choices, lesson and performance categories, layout previews, MIDI notation, camera crop tools, project autosave, recording controls and sharing workflows. Keep unavailable features visibly marked; software instrument implementation remains preserved behind its existing flag. Do not alter saved scene geometry or media algorithms. No new dependencies.

Source review covers the welcome, templates, saved projects, editor, scene library/manager, settings, camera and audio controls, annotation properties, companion entry/drawing, and output views. Live checks cover accessible navigation and responsive layouts; camera hardware, a second-device pairing session, and native desktop output require separate device testing.
