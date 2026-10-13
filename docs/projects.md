# PianoCanva projects

## Workflow

Home offers Getting Started, Templates, and My Projects. Template selection follows
category → activity → scenes → editor. Scene selections retain click order and can
be changed before creation. Blank projects use the same editor and scene library.

The six template definitions live in `src/state/templates.ts`. They reuse the
existing camera, keyboard, notation, harmonic readout, overhead camera, and
annotation modules. Classical and Jazz share the same `PRO_CREATOR` definition.
The legacy scene identifiers (`creator`, `creator-right`, `headshot`,
`overhead-creator`) are retained for migration and template references. New project
scenes receive unique instance IDs, independent module options, and annotation
board IDs. Templates are starting configurations; editing an instance does not
modify a template.

## Persistence

`src/state/projects.ts` stores version-1 project records in the IndexedDB database
`piano-canva.projects`, in its `projects` object store. Records include timestamps,
activity, scene order and configurations, active scene, canvas dimensions, musical
key, transitions, recording preferences, annotation documents, and PDF sources.

Autosave waits 650 ms after relevant changes, waits for scene transitions to finish,
and serializes writes. MIDI events do not cause project saves. Storage failures
are surfaced instead of reported as successful saves. Returning Home awaits the
save. A Save command is also available from the project menu and Cmd/Ctrl+S.
The existing scene library still maintains a session cache; project records are
the durable source when opening a project.

PDFs use the existing 10 MB / 200-page limit. Project records retain the source
bytes so saved PDFs can reopen without uploading again. Project and scene copies
remap annotation board IDs and retain independent ink/page configurations. Camera
preferences are saved; actual MediaStreams, pairing credentials, permissions,
recording handles, and microphone streams are never project data.

On first use, an existing customized session can be recovered as a real project.
A migration marker prevents deleted projects from being recreated from the old
session cache. Legacy display names are migrated without changing internal IDs or
customized layouts.

Projects are local to the current browser/device. Clearing site storage removes
projects. No cloud account or sign-in service exists yet; the greeting uses an
editable local display name. Authentication and remote project synchronization
can be added around the project repository without replacing editor layouts.

## Editor integration

The scene library supports blank creation, library additions, naming, shortcuts,
duplication, deletion, and ordering. Projects are capped at nine scenes. The last
scene cannot be deleted. Project deletion requires an explicit confirmation.
The existing switching and camera-resource reuse paths remain in place. Saved
camera assignments and per-scene visual settings are restored with each scene.
The new Text module renders editable concert information using the existing
module frame, transitions, program output, and recording compositor.

Getting Started, Crop Sheet Music, Tap to Sync, and Concert Program Manager are
explicit future-feature placeholders. Browser livestreaming and virtual-camera
capabilities are not enabled by choosing the Livestream template.

## Verification

`npm test` runs app tests through Vitest and pairing tests through Node's test runner.
Template tests cover component choices, layout bounds, shared Pro Creator,
presentation hierarchy, and independent options. Browser checks cover every
activity, multiple scene selection, blank creation, scene library additions,
scene edits/order/shortcuts, independent duplication, the nine-scene cap, project
reopening across refresh, PDF restoration, and both themes.
