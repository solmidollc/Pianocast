# Annotation companion
Add an Annotation module through Edit scene → Add module → Annotation.
The Tools panel offers Open drawing companion for drawing on this computer.
For a tablet or phone, choose Connect tablet or phone → Create pairing link.
Scan the QR or copy/open the link, tap Connect on the drawing device, copy its return code, and paste that into PianoCanva.
Use the same Wi-Fi for the first version. No camera or microphone permission is needed.

Pen, highlighter, and eraser accept mouse, touch, and stylus input. Pen only ignores touch input when a compatible stylus is detected.
Stroke widths are constant in this version. Pressure is captured for future brush support.
Undo, redo, and clear apply to the current board; clear can be undone.
Each annotation module has its own board. Drawing coordinates stay 16:9 and letterbox inside other module proportions.
Ink is drawn directly into the composed scene and recording; editor controls are excluded.
Drawings are held in sessionStorage, not permanent browser storage. Do not rely on this version for permanent notes.

The web connection exchanges WebRTC descriptions through a link and return code.
Drawing packets then travel over an ordered reliable data channel. Chunked resync restores the host board after reconnecting.
The public Google STUN service discovers connectivity; no hosted signaling or TURN relay has been added.
Some corporate, guest, and isolated networks will fail to connect. Reconnect with a new link or use local drawing.
Automatic one-scan pairing and a TURN fallback are follow-up infrastructure work.
No changes are required to the original local project.
