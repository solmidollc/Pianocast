# Linked teaching annotations

Notation and Keyboard expose **Annotate** in their properties. This attaches an
ink board to the module through `options.annotationBoardId`; it uses the existing
annotation canvas, drawing tools, data channel, and recording compositor.

Enabling a role also links the matching module ordinal in the project's existing
scenes, unless that module already has a separate board. Additional staff or
keyboard modules get independent boards. New library scenes inherit matching
linked roles. Removing an annotation from one scene leaves other scene links
intact. Scene copies receive independent boards and copied ink. Project copies
remap shared boards consistently across all their scenes.

`AnnotationSurfaceBridge` publishes the visible surfaces after a scene settles.
It renders clean reference SVGs through the existing staff and keyboard renderers
with MIDI subscriptions disabled. No note or highlight updates are streamed to
the tablet. The visible video modules retain their normal live MIDI rendering.
Reference generation is separate from the recording loop and never runs per note.

The existing authenticated RTC connection transports the surface catalog and
board documents. One pairing authorizes the surfaces presented during that
session; each surface retains its own ink/history. The tablet keeps its selected
board when it remains available, otherwise selects the first available board.
Scenes without annotation surfaces show a waiting message and disable drawing.
Project persistence includes linked board documents alongside regular annotation
and PDF boards.

While paired, direct layout and module changes are rejected in the app store,
scene mutations, history shortcuts, and drag handlers. Controls also display the
locked state. Scene switching, drawing, MIDI visualization, audio, recording, and
saving remain available. Disconnect restores editing. Existing move/fade/dissolve
transitions carry each linked canvas together with its source module.

Tests cover catalog validation, board resolution, independent ink, shared scene
roles, duplicate remapping, and actual mutation guards. Live verification covers
short-code pairing, all three surface kinds, ink delivery, scene transitions,
locked dragging, full-screen tools, disconnect, and restoration after refresh.
