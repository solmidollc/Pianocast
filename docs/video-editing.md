# Score Sync Mode

Choose **Score Sync Mode** on the home screen. The four numbered steps use the website's theme and
purple accent, a central preview, an adjacent timeline and an optional inspector. The same bottom
Next button names the next step; the last step exports the video.
Standard Lucide icons have accessible labels and tooltips. Edits autosave on this
device; reopening Score Sync restores the latest saved edit. Escape cancels an
active crop, closes local help or pauses playback; it never exits Score Sync.
Use the header back arrow to leave.

## 1. Video

Import one video. **Change video** replaces that source and resets its timing
marks and thumbnail while retaining cropped score systems. MP4/WebM imports
require browser support for their codecs; MOV support depends on its codecs.
**The Interpreter** records in the app and then opens this same Score Sync
workspace. Its new recording scene captures the camera without baking in a score
strip. **Save original & continue** writes an original copy before editing;
**Continue without saving** enters the same workflow without a download. The
choice survives reopening. **Download original recording** remains available
beside Change video. Source files are never overwritten. Replacing the source
clears its recording-save decision and timing marks.


The timeline sits directly beneath the video. Drag segments to rearrange them,
or use Alt-Left/Right while a segment is focused. Select a segment and use the
split, copy, cut, paste or delete icons. Split uses the
playhead position; drag either segment edge to trim. Cut segments can be pasted.
Undo and redo restore editing operations. Shortcuts: **S** splits, **Delete**
deletes, **Ctrl/Cmd-C** copies, **Ctrl/Cmd-X** cuts, **Ctrl/Cmd-V** pastes, **Ctrl/Cmd-Z**
undoes and **Ctrl/Cmd-Shift-Z** or **Ctrl/Cmd-Y** redoes.
Playback uses play/pause icons. Space toggles playback outside form fields.

## 2. Crop score

1. Choose the score position and reserved score area in step 1, then import a
   PDF (10 MB / 200-page limit). Drag around a system and release to save it.
   No Add crop click is needed. The first selection can follow the frame ratio;
   **Free crop** allows another shape.
2. Click another system to reuse the latest crop dimensions. **Custom crop**
   draws another shape and saves on release. Every completed custom crop,
   resize or move updates the reusable frame. Drag a saved crop's edge/corner
   handles to resize it, or its move handle to reposition it. Adjustments update
   all repeats of that crop and save on release.
3. Crops retain the exact selected pixels, including intentional white margins.
   Sync and export never trim them automatically. Numbered outlines show the
   playing order. Clicking a saved crop again adds a repeat: **1, 3** means that
   image plays first and third. The boxed repeat/segno button briefly explains
   repeats and returns. Undo order removes the last occurrence; deleting a crop
   clears its timing suffix. Changing pages keeps the latest reusable frame.
   Replacing the PDF preserves existing cropped images without placing their
   outlines on the replacement.

Older edits with duplicate crops show combined numbered outlines and retain
their image and cue references. Crop coordinates remain internal; the user
adjusts the crop visually.

## 3. Sync

The score fills the workspace while audio plays; no scrolling between systems
is necessary. The first score press, or **T**, marks system 1 at **0:00** and
starts playback. A visible score-stage prompt explains that tapping marks a
crop start. The marked system stays visible for reading. Each subsequent
press marks and displays the next occurrence, including planned repeats. The
last system stays visible. Marking does not pause playback.

Numbered timeline markers show each system's timestamp. Selecting one seeks to
it. Undo removes the last timing; deleting a selected marker removes that timing
and all later timings. Reset clears all timing marks while retaining crop order.
Marks form a consecutive, chronological sequence. Tapping at an earlier time
never silently replaces or removes neighboring marks. To correct an earlier
mark, delete from that marker onward, seek and mark the remaining sequence again.
Reordering video retains source-anchored marks; a resulting ordering conflict
requires explicit retiming rather than silently discarding cues. An older
incomplete timing sequence needs an explicit Reset before continuing.

The preview uses the actual media clock. Marks capture pointer-down or key-down,
compensate for queued input and browser-reported audio output latency, and retain
fractional timestamps. Offline export uses those same timestamps, quantized only
to the next available output frame at 30 fps. Synchronization remains manual;
there is no automatic note recognition.

## 4. Final Check and export

Step 1 reserves a fixed score area from 10% to 60% of the output height, either
above or below the video. The video fills the remaining area without stretching;
drag it to adjust its crop. Zoom controls sit at the bottom right, beside the
shared navigation. Change video sits at the bottom left.

**Final Check** repeats the first step's controls and adds **Score size**. Reducing
the score size scales both axes uniformly inside the reserved area. It never
changes video framing. The crop-dimensions setting offers **Same frame · fill
sides**, which normalizes display height with white side padding, or **Fit each
crop**, which retains each crop's own shape within the reserved area. Switching
systems, changing this setting or resizing the score never moves the video.
The timing workspace always shows the score large, independently of export size.

Choose MP4 or WebM and 720p or 1080p, then **Export video** in the shared footer.
Thumbnails are optional: **Choose frame** opens a video-frame slider; **Use this
frame** captures the preview after seeking finishes. Clicking the thumbnail
reopens frame selection. A camera photo remains another option. A selected
thumbnail downloads separately as JPEG. **Include as first frame** inserts it
for exactly one output frame (1/30 second), with matching silent audio. Source
video, audio and score changes shift together by that one frame. There is no
intro-duration setting. Without the checkmark, performance begins immediately.

## Implementation and storage

Export uses Mediabunny and WebCodecs to decode original media and encode offline.
It does not record preview playback. Preview and export share score preparation
and video geometry. Sources decode sequentially; audio mixes/resamples in
one-second chunks. Score pixels repaint at cue boundaries. Output is 30 fps,
H.264/AAC MP4 or VP8/Opus WebM, subject to browser encoding support. A lazy AAC
fallback supports browsers without native AAC encoding. Export checks frame
counts and retries with frame-preserving encoding if needed. Cancellation frees
codec resources and allows retry. Keep the tab open until download begins.

Sources, crops, crop order, timing, layout and thumbnails autosave to IndexedDB
(`piano-canva.video-edits`). They are local to the browser/origin/device; clearing
site storage removes them. Older saved edits remain stored and readable.
Original downloads and export remain available after a local save failure.
Existing transition data remains readable, although new editing uses one source
and simple cuts. There are no simultaneous tracks, separate audio editing, speed
changes or cloud uploads. Recording and completed exports buffer in memory;
long takes and physical-device performance need separate validation.

## Validation

- Unit tests cover timeline math, source-anchored cues, split remapping, sequential
  marks and cascading deletion, first-frame duration, proportional composition and
  audible media-clock timestamps.
- Browser checks cover one-source import/replacement, split/cut/delete/paste,
  undo/redo, trim handles, playback, zero-time first press, pointer-down capture,
  timestamp markers, cascading removal, autosave/reopen and MP4/WebM export.
- Workflow checks cover numbered steps, shared Next navigation, centered PDF
  import, source saving before edits, copy/paste shortcuts and drag rearrangement.
- Responsive checks keep the score and transport visible at 390, 570 and
  1159 × 668. Theme checks verify website neutrals and purple accents.
- Independent media decoding checks frame counts, cue-boundary frames, audio
  alignment, first-frame silence, stable top/bottom score areas across different crops,
  proportional score/video and preview agreement.
