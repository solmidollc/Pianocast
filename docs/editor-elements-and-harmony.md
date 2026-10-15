# Notation, Harmony, and editor controls

Harmony is part of each Notation element. Chord symbols and advanced note/chord/
interval analysis sit above the staff; Roman numerals with inversion figures and
standalone figured bass sit below. It can be disabled per element. SVG labels
share the engraving viewBox and enter its measured ink bounds, so uniform fitting,
recording, export, and scene transitions include them. Melodic labels use their
note-column anchors with wider cells and uniform text fitting. Nashville is removed.

Legacy harmonic elements migrate into notation, carrying their display, interval,
and enabled settings. A readout with no staff becomes a staff. Scene/project loading
and preset application migrate legacy data; templates expose no harmonic element.
Every Jazz tutorial layout has chord-symbol notation; every Classical tutorial
layout has Roman analysis. New notation on a blank scene defaults to chord symbols.

Elements support multiple instances with unique names, editable in Properties.
Camera inputs remain per element; saved-ID and name matching retain camera identity
when a scene changes or reorders its elements. Internal module identifiers remain
for backward compatibility. The layer list and frame labels use element names.

The centered scene strip ends with a gray + card. Scene deletion is available on
cards, with confirmation. Deleting the last scene leaves a new empty one. The
nine-scene limit, stored layer order, smooth transitions, and tablet edit locks stay.

Shift+R starts recording, Shift+P pauses/resumes, and Shift+S stops and saves on
Mac, Windows, and Linux. These shortcuts ignore text inputs, dialogs, and key repeats.
MediaRecorder pauses its multiplexed audio/video stream; the elapsed clock excludes
the pause, settings remain locked, and stop also works while paused. Visible pause/
resume controls are available in the top bar and full-screen recording view.

When a tablet is connected, the local drawing link disappears. Existing local
companions show a connected-device message and cannot draw; the editor rejects
local BroadcastChannel ink while paired. The authorized RTC ink path stays active.
A same-origin ownership channel updates already-open local companions and releases
ownership on disconnect. This does not create another network or pairing service.
