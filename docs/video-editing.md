# Video editing and Interpreter score synchronization

Choose **Edit** on the home screen to import device videos. Stopping an in-app
recording opens **Your take is ready**, with a choice to edit or download the
original. Downloads never start automatically. Takes are retained as separate
local edits; no source video is overwritten. Thumbnails are optional for both
original downloads and edited exports.

## Editor workspaces

- **Edit clips:** import, trim, reorder or duplicate clips. Start/end fields use
  `minutes:seconds`, or `hours:minutes:seconds` for long performances. The playhead
  retains frame-level precision through its slider and saved cue timestamps.
  Choose a cut, crossfade or fade through black between clips. Transition
  duration is a setting in seconds and can include a fraction of a second.
- **Score sync:** a focused workspace with **Crop systems** and **Align timing**
  steps. These tools work with recorded takes and imported device videos.
- **Export:** format and resolution controls, followed by an optional thumbnail
  from the current preview frame or a camera photo. Selected thumbnails download
  separately as JPEGs. Export never requires selecting or skipping a thumbnail.

MP4/WebM imports require browser decoding support for the file's codecs; MOV
support also depends on its codecs. Source downloads are available under
**Edit clips → Source videos**. The Interpreter project's toolbar also provides
**Edit video / Sync score**.

## Crop and align a score

1. Open **Score sync → Crop systems** and upload a PDF (10 MB / 200-page limit).
2. Drag around the first complete grand-staff system, then **Add cropped system**.
   Its size becomes the saved frame for subsequent crops.
3. Click the center of each subsequent system to save it immediately with the
   same width and height. Change PDF pages as needed; the frame size is retained.
   **Adjust crop size** lets you drag a new frame; already saved systems retain
   their original crops. Numeric coordinates are available for keyboard input.
   Uploading another PDF preserves saved cropped images.
4. Continue to **Align timing**. Play the video and **Tap system start** as each
   system begins, or focus the preview and press **T**. The next system is selected
   automatically without pausing playback. Seek/mark while paused for corrections.
   Choose an earlier cropped system again for musical repeats. Space toggles
   playback when the preview is focused.
5. Cue buttons seek to their start time; remove a mistaken cue and mark it again.
   Cues stay anchored to their source segment through trimming/reordering.
   Trimmed-away cues remain saved but are excluded from preview/export. During
   crossfades, a tap belongs to the louder segment (outgoing on an exact tie).
6. Select video below the score, or score over the video for an Interpreter take
   with a reserved top strip. Adjust the score height and continue to **Export**.
   Before the first cue, the strip is blank; mark time zero for an immediate start.

Synchronization is manual and retrospective, without automatic note recognition.

## Export implementation and performance

Export uses Mediabunny and WebCodecs to decode original media and encode the edit
offline. It does not play or record the preview and has no real-time playback
requirement. The compositor retains the top score pixels between cues and only
repaints that region when the selected system changes. It decodes source frames
sequentially, draws them directly, and uses a separate blend canvas only for
fades. Audio is mixed/resampled in one-second chunks with the preview's transition
envelopes. Decoder buffering stays bounded; the completed encoded file is held
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

Edits, sources, crops, reusable crop size, cues and thumbnails autosave to IndexedDB
(`piano-canva.video-edits`). They are local to the browser/origin/device; clearing
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
- Independently decode exported MP4/WebM files; verify frame count, duration,
  score changes, intermediate blend frames and both audio sources in a crossfade.
- Check layouts at the reported 715 × 668 viewport and a desktop viewport.
- The repository has four existing failures in `src/state/templates.test.ts`
  (stale template expectations); these are outside this editor change.

A 30-second 1280 × 720 moving test pattern with audio and two timed score systems
exported at 720p in 26.9 seconds (MP4) and 22.6 seconds (WebM) on the Linux cloud
browser using SwiftShader software rendering. The previous playback recorder
required at least the video's full duration, plus setup. These measurements are
one test run, not a promise for all devices; hardware acceleration remains a
material factor.
