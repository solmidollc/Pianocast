# Teleprompter

Open **Teleprompter** from the editor toolbar. Enter a script, choose **Read
script**, then start or pause scrolling. Adjust pixels per second, text size,
or mirrored text. **Back to start** resets the reading position. Manual scrolling
pauses automatic movement. Closing the panel stops playback.

The panel includes recording start/stop and pause/resume controls so it can stay
open during a take. Its text is presenter UI and is excluded from scene-based
recording and clean program output. Sharing the entire browser tab can reveal
the panel; use the clean view when sharing with an audience.

The script, speed, text size and mirror setting use the existing project
autosave and IndexedDB persistence. Project copies inherit their own script.
Opening an older project without teleprompter data starts with an empty script.
Playback and reading position are temporary and are not restored on reopening.
Scripts are limited to 50,000 characters. No scripts are sent to a server.

Verified with browser checks for editing, scroll/pause/reset, mirroring,
recording while the panel is open, and project restoration after a reload. An
extracted recording frame confirmed that the presenter panel was excluded.
