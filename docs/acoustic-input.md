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

## Optional one-octave calibration experiment

While listening, **Calibrate my piano** opens a guided room check, twelve chromatic
notes (C3–B3, C4–B4, or C5–B5), and six fresh comparison recordings. Each note needs
about one second of stable, isolated sound. Wrong pitches, low signal, unstable
spectra, loud room checks, and missing input are rejected with a retry. The
keyboard highlights the requested key. Cancel/disconnect discards the draft and
preserves any previously saved profile.

The worker extracts normalized Hann-windowed FFT fingerprints. A finished profile
stores twelve averaged spectra, median pitch offsets, measured room noise, sample
rate, microphone device identity, and comparison counts. Raw audio is neither saved
nor uploaded. IndexedDB stores one named profile per microphone on this device;
storage failure retains the profile in memory with an explicit message. Profiles
are device calibration, separate from scene/project documents. Starting a new
microphone session reloads that microphone's profile but leaves it disabled.

When enabled, the profile applies a measured noise gate and compares spectra only
near the original pitch estimate within its trained octave. Strong matches can
adjust a nearby pitch to the measured template; weak matches are rejected.
Untrained pitches and incompatible sample rates retain the original detector.
This conservative experiment does not correct arbitrary octave errors, expand the
supported range to 88 keys, or enable polyphony. No FFT is added to the normal
uncalibrated listening path; fingerprint work runs in the existing worker only
while capturing a template or evaluating a profile.

The comparison uses fresh performances on the same microphone, with identical
frames supplied to the original and calibrated detectors. It reports the fraction
of voiced test frames recognizing the prompted pitch; silence and low-confidence
input before a usable note are not scored. These six notes are never added to the
templates. It is a small guided test, not a controlled accuracy benchmark or proof
of general improvement. Equal/worse scores are reported plainly, and saving never
automatically enables the profile. Use the profile checkbox to opt in or return
to the original detector immediately.
