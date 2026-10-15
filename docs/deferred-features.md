# Deferred features

## Software instrument

The user paused this feature on October 15, 2026. Remind them that development
already started before proposing a new implementation.

The full engine, samples, instrument catalog, reverb, tone, tuning, velocity,
stereo and output controls remain in src/audio/pianoEngine.ts and
src/ui/AudioPanel.tsx. SOFTWARE_INSTRUMENT_AVAILABLE in src/features.ts gates
access and sound. Existing preferences remain stored for future reactivation.
Recording and microphone mixing still use the shared audio context; preserve
that infrastructure when resuming. The current UI is a disabled Coming Soon row.
