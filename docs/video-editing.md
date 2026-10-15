# Video editing and Interpreter score synchronization

Choose **Edit** on the home screen to import device videos. Stopping an in-app
recording opens **Your take is ready**, with a choice to edit or download the
original. Downloads never start automatically. Takes are retained as separate
local edits; no source video is overwritten. Thumbnails are optional for both
original downloads and edited exports.

## Editor workspaces

- **Clips:** import, trim, reorder or duplicate clips. Start/end fields use
  `minutes:seconds`, or `hours:minutes:seconds` for long performances. The playhead
  retains frame-level precision through its slider and saved cue timestamps.
  Choose a cut, crossfade or fade through black between clips. Transition
  duration is a setting in seconds and can include a fraction of a second.
- **Crop score:** upload a PDF and crop systems with a reusable frame.
- **Sync:** listen to the performance and tap a large score to mark each system.
  These tools work with recorded takes and imported device videos.
- **Export:** format and resolution controls, followed by an optional thumbnail
  from the current preview frame or a camera photo. Selected thumbnails download
  separately as JPEGs. Export never requires selecting or skipping a thumbnail.

MP4/WebM imports require browser decoding support for the file's codecs; MOV
support also depends on its codecs. Source downloads are available under
**Clips → Source videos**. The Interpreter project's toolbar also provides
**Edit video / Sync score**.

## Crop and align a score

1. Open **Crop score** and upload a PDF (10 MB / 200-page limit).
2. Drag around the first complete grand-staff system, then **Add crop**. The
   selection stays in place when the pointer leaves the PDF. Actions remain
   visible below the scrolling PDF, so Add stays reachable.
3. Click the next system to crop it with the first crop's width and height.
   Numbered outlines show the performance order directly on the PDF. Clicking
   an existing crop again adds a repeat: its badge can read **1, 3**. Repeats reuse
   the same cropped image and each occurrence gets its own timing mark.
   Older edits with duplicate crops also show a combined numbered outline,
   retaining their image and cue references.
   **Custom crop** draws an exception; **⤢** on a crop redraws and saves its bounds,
   updating all its repeats. Neither changes the first crop's default frame.
   **Undo order** removes the last occurrence; **×** removes a crop and its cues.
   Changing PDF pages retains the default size. Uploading another PDF preserves
   the prior cropped images without placing their outlines on the replacement.
4. Continue to **Sync** and play the performance. The first click/tap or **T**
   starts the displayed system and keeps it visible for reading. Each later tap
   changes to and marks the next numbered system, including planned repeats.
   The last system stays visible. Playback never pauses because of a mark.
   Space toggles playback when the score is focused. **Undo** restores the prior
   mark and displayed system, including any cue replaced at the same instant.
   Seeking displays the system active at that time. To correct a particular
   occurrence, seek first, choose it under **Showing**, then tap to mark it.
5. **Timings** opens a review drawer. Selecting a cue seeks to its start time
   and selects that system for correction; remove a mistaken cue and mark it again.
   Cues stay anchored to their source segment through trimming/reordering.
   Trimmed-away cues remain saved but are excluded from preview/export. During
   crossfades, a tap belongs to the louder segment (outgoing on an exact tie).
6. In **Export → Layout**, select video below the score, or score over the video
   for an Interpreter take with a reserved top strip. Blank crop margins are removed automatically; each
   grand staff starts at full width without stretching. The strip height follows
   its proportions instead of adding a fixed white border. Unusually tall crops
   remain contained so they cannot obscure the entire performance.
   Before the first cue, the strip is blank; mark time zero for an immediate start.

Synchronization is manual and retrospective, without automatic note recognition.

## Frame the video

**Layout** controls live in **Export**, next to the preview on wide screens and
between the preview and download controls on narrow screens. **Score size**
scales the score uniformly from 25% to 100%. Reducing it adds centered white side
margins and reduces the score strip height, leaving more room below for video.
The timing stage always shows the score large for reading, independently of its
export size.
**Video size** scales from 25% to 300% with the original aspect ratio. **Vertical
position** moves the image up/down while keeping it horizontally centered. You
can also drag the preview vertically; horizontal motion is ignored. Enlarged
video is clipped to the frame and stays below the score. **Reset** restores the
fitted video size, centered position and full-width score. Adjustments autosave
with the edit and apply to the preview, frame thumbnails and exported video. Existing edits use 100%
size and a centered position until adjusted. The playback control reads **Play**
or **Pause**.

## Export implementation and performance

Export uses Mediabunny and WebCodecs to decode original media and encode the edit
offline. It does not play or record the preview and has no real-time playback
requirement. The compositor retains the top score pixels between cues and only
repaints that region when the selected system changes. It decodes source frames
sequentially, draws them directly, and uses a separate blend canvas only for
fades. Audio is mixed/resampled in one-second chunks with the preview's transition
envelopes. Preview and export share the same score preparation and video geometry.
Decoder buffering stays bounded; the completed encoded file is held
in memory for download.

Outputs are 720p/1080p, 30 fps: H.264/AAC MP4 or VP8/Opus WebM, subject to browser
video encoding support. A lazy AAC encoder fallback supports browsers without
native AAC encoding. Fast encoding checks the encoded frame count and retries
with frame-preserving encoding if the browser drops frames. Cancellation releases
inputs, decoders, encoders and images; an immediate retry is supported. Export
uses message tasks instead of background-throttled timers to keep yielding for
progress and cancellation.

Burning a score into a video still requires encoding the resulting video frames;
it cannot simply copy the compressed original video track. Throughput depends on
video complexity, resolution and available hardware acceleration. Software-only
cloud results do not predict every tester's laptop or phone.

## Storage and alpha limits

**Library** in the editor header opens saved edits, naming and deletion controls.
Edits, sources, crops, reusable crop size, score size, cues and thumbnails autosave
to IndexedDB (`piano-canva.video-edits`). They are local to the browser/origin/device; clearing
site storage removes them. Older edits remain readable and infer a crop frame
from their first saved system. Local save errors do not block source downloads
or export. Deletion requires a second confirmation and affects local copies only.

Recording and completed export files buffer in memory. Test long takes and
physical-device performance before widening the alpha. The editor supports a
sequential clip sequence, without separate audio editing, simultaneous tracks,
speed changes or cloud upload. A hidden browser tab may still have its codecs
reclaimed by the browser; cancellation/retry and original downloads remain
available. Keep the export tab open until downloading begins.

## Validation

- Unit tests cover crossfade audio weights, transition caps, fades, cue rebasing,
  trimmed cue filtering, crop bounds, reusable crop placement and clock formatting.
- Browser checks cover trims, crossfades, first-crop sizing, one-click cropping on
  another PDF page, uninterrupted playback while marking, optional thumbnails,
  camera cleanup, cancellation/retry and saved edits after reload.
- Layout checks cover proportional enlargement, vertical-only dragging, reset,
  persistence, full-width notation, and preview/export agreement. Square markers
  remain square in real MP4 and WebM outputs, including score-over-video layout.
- Independently decode exported MP4/WebM files; verify frame count, duration,
  score changes, intermediate blend frames and both audio sources in a crossfade.
- Timing checks cover scroll-free score focus at 390, 570 and 1012 × 668,
  first-tap hold, change-on-next-tap, uninterrupted playback, keyboard repeat
  suppression, Undo, numbered repeats and the timing review drawer.
- Crop checks leave the PDF after dragging, verify Add remains enabled and
  visible, resize an existing crop, draw an exception, reuse the first size on
  another page, and reopen saved repeat numbers and cues. Checks also cover
  older duplicate crops, touch scrolling/repeats and replacement PDF isolation.
- Score sizing checks compare saved previews and independently decoded MP4/WebM
  outputs, including proportional side margins and increased video space.
- The repository has four existing failures in `src/state/templates.test.ts`
  (stale template expectations); these are outside this editor change.

A 30-second 1280 × 720 moving test pattern with audio and two timed score systems
exported at 720p in 26.9 seconds (MP4) and 22.6 seconds (WebM) on the Linux cloud
browser using SwiftShader software rendering. The previous playback recorder
required at least the video's full duration, plus setup. These measurements are
one test run, not a promise for all devices; hardware acceleration remains a
material factor.
