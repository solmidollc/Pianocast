# Experimental Acoustic Piano input

Select **Acoustic Piano (experimental)** from the editor's Input menu, choose a
microphone, and click **Start listening**. Permission is requested only then.
Stopping, changing input, leaving the editor, a disconnected microphone, or an
analysis failure releases the microphone and clears recognized notes.

This first version detects one pitch at a time in C2–C7 (optionally C3–C6).
It is intended for isolated notes and melody demonstrations. Chords, overlapping
sustain, room speech, strong reverberation, and piano harmonics can cause wrong or
missed notes. It does not infer a physical key release or sustain pedal: notes
remain active while a confident pitch is audible. Harmonic Readout shows the
recognized note rather than inventing a chord. Existing MIDI behavior is retained.

A separate microphone stream disables browser voice processing. A small
AudioWorklet captures 2048-sample windows with 50% overlap; a dedicated worker
runs YIN at the AudioContext's actual sample rate (requested 16 kHz). The worklet
waits for analysis acknowledgement before sending another window, so background
or overloaded pages cannot build an unbounded queue. Stale results are discarded.
The main thread stabilizes candidates and publishes only changed notes, plus a
meter update at most every 100 ms. Repeated same-pitch attacks use a conservative
rise-in-level heuristic; they cannot be as exact as MIDI note-on events.

Detected events are tagged as acoustic and excluded from the software instrument.
Recognition never changes recording-microphone or monitoring settings. Audio is
processed on the device; no audio is uploaded. In the desktop output view, a
BroadcastChannel forwards recognized notes only, without another microphone or
analysis engine. The browser recording compositor uses the existing visual path.

Automated coverage includes chromatic synthetic piano-like harmonic signals
throughout the supported range, tuning offsets, noise/silence, gating/range,
transient rejection, input switching, source tags, permission denial, cancellation,
worker failure, and cleanup. Real acoustic-piano accuracy still needs field testing
across microphones, instruments, room acoustics, and browsers.
