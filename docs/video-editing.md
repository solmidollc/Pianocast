# Video editing and Interpreter score synchronization

Choose **Edit** on the home screen to import device videos. Stopping an in-app
recording now opens **Your take is ready**, with an explicit choice to edit or
download the original. Downloading never starts automatically. Takes are retained
as separate local video edits; no source video is overwritten.

## Editing a performance

1. Import one or more videos. The browser must be able to decode their codecs.
   MP4 and WebM are supported when the browser can read the specific file; MOV
   support depends on its codecs and the browser.
2. Set each segment's in/out times in seconds, reorder or duplicate segments,
   and choose cut, crossfade, or fade through black to the next segment.
3. Crossfades overlap video and audio; their duration is capped at half of each
   adjoining segment so very short clips cannot create three-way overlaps. Fade
   through black fades to silence and black at the cut without shortening the
   sequence. Preview uses the same compositor and timing model as export.
4. Choose a thumbnail from the current composed preview, take a camera picture,
   or explicitly skip. A selected thumbnail downloads as a separate JPEG.
5. Export the sequence at 720p or 1080p, 30 fps, to one of the formats the browser
   advertises. Export actually re-encodes the trimmed sequence with audio,
   transitions and score changes. It runs in real time and can be cancelled;
   keep the tab visible. If it becomes hidden, export stops with a retry message
   rather than silently producing a video with missing frames.

H.264/AAC MP4 is preferred when explicitly supported. Otherwise the browser's
generic MP4 encoder may choose different codecs (the Linux Chromium validation
machine produced VP9/Opus in an MP4 container). WebM uses VP9/Opus or VP8/Opus.
A file extension is not a guarantee of playback in every application. Original
videos remain available through **Reuse a source video → Download source**.

## Add the score after performing

The **Interpreter · Score synchronization** tools work with both an in-app take
and videos imported from the device. The Interpreter project's toolbar has an
**Edit video / Sync score** entry.

1. Upload the PDF after recording. The existing PDF renderer enforces the
   10 MB / 200-page limits.
2. Select a page and drag a rectangle around both staves of one complete
   grand-staff system. Save the crop, then repeat in performance order. Numeric
   crop coordinates are available for fine adjustments and keyboard operation.
   Each crop is rendered to its own image, so crops can come from different PDF
   pages. Uploading another PDF preserves already-cropped systems.
3. Start playback. Tap **Tap start: System N** at the beginning of each new
   system. The selection advances to the next crop without pausing playback.
   You can also focus the preview and press **T**, or pause/seek for exact marks.
   Choose a previous crop again for musical repeats. Space toggles playback
   when the preview is focused.
4. Cue buttons seek to their timestamp; remove a mistaken cue and mark it again.
   Times are anchored to the source segment, so trimming/reordering rebases them.
   Trimmed-away cues remain in the draft but are excluded from preview/export.
   During a crossfade, a tap belongs to the louder segment (the outgoing segment
   at the exact midpoint).
5. Choose **Fit video below score** for imported performances, or **Cover the
   top of video (Interpreter)** to fill the score strip already reserved by the
   Interpreter recording layout. Adjust strip height as needed.
6. Export renders each crop into the top strip at its cue time. Before the first
   cue the strip is blank; mark the first system at time zero if it should appear
   immediately. This is manual, retrospective synchronization, with no automatic
   note recognition or PDF score following.

## Local storage and limits

Video edits, source blobs, cropped images, cue times and thumbnails autosave in
IndexedDB (`piano-canva.video-edits`). They are separate from scene-layout
projects, local to this browser/origin/device, and can use substantial storage.
Clearing site storage removes them. Save errors remain visible; original source
download and rendering are available even when local storage is full. **Delete
local edit** requires an explicit second action and removes that draft's local
copies; files already downloaded or imported from the device are unchanged.

The legacy automatic direct-to-disk recording preference is ignored so every
take reaches the requested review/thumbnail decision. Recording chunks and edit
exports currently buffer locally in memory before review/download; long-session
memory and physical-device performance still need release testing. This first
editor is a sequential clip editor, without multiple simultaneous video tracks,
speed changes, separate audio editing, or cloud upload.

## Validation

- Timeline tests cover complementary crossfade audio weights, transition caps,
  fade-through-black timing, cue rebasing, trimmed cue filtering and crop bounds.
- Recorder tests verify review instead of an automatic download, including older
  direct-save preferences.
- Browser checks import/trim two videos, crop systems from two PDF pages, tap
  without interrupting playback, select frame and camera thumbnails, cancel and
  retry export, reload a saved edit and delete a local draft with confirmation.
- Real 720p WebM and MP4 exports decoded successfully. Frame checks showed red
  video, the purple crossfade and blue video; PDF markers changed from the first
  crop to the second at the cue. Audio checks found the first clip's 440 Hz tone,
  both tones during the crossfade and the second clip's 880 Hz tone afterward.
- An in-app recording with pause/resume opened review with no download; explicit
  original download worked, and the downloaded WebM could be re-imported.

Validation used generated short clips and simulated capture hardware on Linux
Chromium. Target-device performance, long takes and third-party player
compatibility remain separate alpha release checks.
