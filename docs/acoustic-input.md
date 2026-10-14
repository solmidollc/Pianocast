# Experimental Acoustic Piano input

Choose **Acoustic Piano (experimental)** in Input, select a microphone, and click
**Start listening**. It recognizes individual piano pitches across A0–C8 (MIDI
21–108). No piano-specific recordings, profiles, or setup wizard are required.
The only advanced control is room sensitivity. Starting recognition does not
enable microphone recording or software instrument sound.

Capture requests a 48 kHz AudioContext and uses its actual rate throughout. The
AudioWorklet keeps at least 170 ms of audio in a power-of-two window (8192 samples
at 48 kHz), advancing by one quarter-window. This contains multiple cycles of the
27.5 Hz lowest A, while retaining adequate sampling resolution for C8. Only one
window may be in flight; the acknowledgement mechanism drops intermediate windows
instead of building a latency-producing queue.

A dedicated worker calculates FFT-accelerated YIN differences from zero-padded
linear autocorrelation and exact overlapping energy sums. Fractional-period trough
interpolation prevents integer sampling from pushing bright treble notes into a
lower octave. A shorter recent window follows upper notes during note changes;
low notes retain the longer window. Candidate stabilization, silence release,
retrigger heuristics, and stale-result rejection feed the existing visual path.
DSP does not run on the video/UI thread. Desktop output receives recognized note
numbers through the existing bridge; browser recordings use the scene compositor.

Recognition is independent of saved instrument timbre. Tests cover all 88 notes
with soft, bright, weak/missing-fundamental and stretched-partial synthetic piano
signals, decays, tuning offsets, moderate noise, and 44.1/48/96 kHz capture rates.
These are algorithm tests, not a guarantee for every physical piano/microphone.
Room noise, microphone bass/treble response, detuning, and overlapping sustain can
still cause misses or octave mistakes. Chords/polyphony are unsupported; an octave
or chord can be ambiguous to a single-pitch estimator. Acoustic note releases
represent audible decay, not physical key/pedal state. Low bass needs more audio
and is inherently slower to identify than treble.

Stopping, switching inputs, leaving the editor, disconnected devices, and processing
errors stop capture and clear displayed notes. All analysis is local. The removed
calibration implementation and its storage access are no longer included.
