# Video editor

Choose **Edit** on the home screen. The editor uses the website's theme and
purple accent, a central preview, a bottom timeline and an optional inspector.
Standard Lucide icons have accessible labels and tooltips. Edits autosave on this
device; reopening Edit restores the latest saved edit. Escape returns home.

## Video

Import one video. **Change video** replaces that source and resets its timing
marks and thumbnail while retaining cropped score systems. MP4/WebM imports
require browser support for their codecs; MOV support depends on its codecs.
A recorded take can also open directly in the editor, with an original download
available before editing. Source files are never overwritten.

Select a timeline segment and use the split, cut or delete icons. Split uses the
playhead position; drag either segment edge to trim. Cut segments can be pasted.
Undo and redo restore editing operations. Shortcuts: **S** splits, **Delete**
deletes, **Ctrl/Cmd-X** cuts, **Ctrl/Cmd-V** pastes and **Ctrl/Cmd-Z** undoes.
Playback uses play/pause icons. Space toggles playback outside form fields.

## Score

1. Import a PDF (10 MB / 200-page limit). Drag around the first complete
   grand-staff system and choose **Add crop**. Selection and actions remain
   visible after dragging; the PDF scrolls independently of the crop controls.
2. Click another system to reuse the first crop's dimensions. **Custom crop**
   draws an exception; the resize icon on an existing crop changes its bounds
   and updates its repeats without changing the reusable default.
3. Numbered outlines on the PDF show performance order. Click a crop again to
   add a repeat: its badge can read **1, 3**. Each occurrence gets its own timing
   mark. Undo order removes the last occurrence. Removing a crop removes its
   occurrences and clears timing from its first affected occurrence onward.
   Changing PDF pages keeps the default frame. Replacing the PDF preserves
   previous cropped images without placing their outlines on the replacement.

Older edits with duplicate crops show combined numbered outlines and retain
their image and cue references. Crop coordinates remain internal; the user
adjusts the crop visually.

## Sync

The score fills the workspace while audio plays; no scrolling between systems
is necessary. The first score press, or **T**, marks system 1 at **0:00** and
starts playback. The marked system stays visible for reading. Each subsequent
press marks and displays the next occurrence, including planned repeats. The
last system stays visible. Marking does not pause playback.

Numbered timeline markers show each system's timestamp. Selecting one seeks to
it. Undo removes the last timing; deleting a selected marker removes that timing
and all later timings. Reset clears all timing marks while retaining crop order.
Marks form a consecutive, chronological sequence. Tapping at an earlier time
never silently replaces or removes neighboring marks. To correct an earlier
mark, delete from that marker onward, seek and mark the remaining sequence again.
An older incomplete timing sequence needs an explicit Reset before continuing.

The preview uses the actual media clock. Marks capture pointer-down or key-down,
compensate for queued input and browser-reported audio output latency, and retain
fractional timestamps. Offline export uses those same timestamps, quantized only
to the next available output frame at 30 fps. Synchronization remains manual;
there is no automatic note recognition.

## Layout and export

The inspector holds **Layout** controls. Blank crop margins are removed and
notation starts at full width without stretching. **Score size** scales uniformly
from 25% to 100%; reducing it adds centered white side margins and gives more
height to the video. The timing workspace always shows the score large,
independently of its exported size.

**Video size** scales uniformly from 25% to 300%. Horizontal and vertical controls,
or dragging the preview with the move cursor, position it in both directions.
Enlarged video is clipped to the output frame and remains below the score.
Choose video below score or score over video for a take with a reserved strip.
Reset restores fitted video, centered position and full-width score. Layout
changes autosave and apply equally to preview, thumbnails and export.

Choose MP4 or WebM and 720p or 1080p, then Export. Thumbnails are optional: capture
the current frame or take a photo. A selected thumbnail downloads separately as
JPEG. Enable **Intro** to insert it briefly at the beginning of the exported
video (0.5, 1 or 2 seconds). The intro is silent; source video, audio and score
changes all shift together by that duration. Without Intro, performance begins
immediately. Export never requires choosing or skipping a thumbnail.

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
  marks and cascading deletion, intro duration, proportional composition and
  audible media-clock timestamps.
- Browser checks cover one-source import/replacement, split/cut/delete/paste,
  undo/redo, trim handles, playback, zero-time first press, pointer-down capture,
  timestamp markers, cascading removal, autosave/reopen and MP4/WebM export.
- Responsive checks keep the score and transport visible at 390, 570 and
  1159 × 668. Theme checks verify website neutrals and purple accents.
- Independent media decoding checks frame counts, cue-boundary frames, audio
  alignment, intro silence, proportional score/video and preview agreement.
- The repository has four existing failures in `src/state/templates.test.ts`
  from stale template expectations; these are outside this editor change.
