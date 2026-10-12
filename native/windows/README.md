# Piano Keys — Windows Virtual Camera

This directory contains a Media Foundation–based virtual camera that exposes
the Piano Keys composite as a system camera on Windows 11 22H2 or newer.

## Architecture

```
Electron app
   └── \\.\pipe\pianokeys-vcam     <- BGRA frame stream, 1920x1080@60
                  │
                  ▼
  PianoKeysCamera.dll  (IMFMediaSource COM in-proc server)
       │
       ▼
  MFCreateVirtualCamera(...) registers the device with the system at install time
       │
       ▼
  Apps that enumerate kVideoCapture sources (OBS, Zoom, Meet, Teams,
  Windows Camera, …) see "Piano Keys" and read frames from it.
```

We target the **Windows 11 Virtual Camera** API (`MFCreateVirtualCamera`,
`IMFVirtualCamera`, available 22H2+). This API replaces the older DirectShow
path; consumers that haven't migrated to MF (some legacy apps) won't see the
camera, but every major streaming/conferencing app on a modern Windows has.

For Windows 10 support, build a parallel `PianoKeysCameraDS.dll` that
implements a DirectShow source filter — same frame pipe, same protocol,
different COM interface. Not included here.

## Source layout

| File | Role |
|---|---|
| `PianoKeysCamera/dllmain.cpp` | DLL entry, COM class factory, registration |
| `PianoKeysCamera/MediaSource.cpp` / `.h` | `IMFMediaSource` |
| `PianoKeysCamera/MediaStream.cpp` / `.h` | `IMFMediaStream` |
| `PianoKeysCamera/FramePipeReader.cpp` / `.h` | Named pipe reader, PKVC decoder |
| `PianoKeysCamera/Registration.cpp` | `MFCreateVirtualCamera` install / uninstall |
| `PianoKeysCamera/CMakeLists.txt` | CMake build |
| `PianoKeysCamera/PianoKeysCamera.def` | Exports `DllGetClassObject`, `DllCanUnloadNow`, etc. |

## Build

```powershell
cd native/windows
cmake -S . -B build -A x64
cmake --build build --config Release
```

Output: `build/Release/PianoKeysCamera.dll`.

Sign with your code-signing certificate (camera DLLs loaded by other apps
must be signed):

```powershell
signtool sign /tr http://timestamp.digicert.com /td sha256 ^
  /fd sha256 /a build\Release\PianoKeysCamera.dll
```

## Install

The Electron app's installer (Inno Setup or MSIX) should:

1. Copy `PianoKeysCamera.dll` to `%ProgramFiles%\PianoKeys\`.
2. Run `regsvr32 PianoKeysCamera.dll` to register the COM class.
3. Spawn `PianoKeysCameraRegister.exe` (a tiny helper bundled with the app)
   that calls `MFCreateVirtualCamera` with the registered COM class id.
   The helper persists the registration with the lifetime
   `MF_VIRTUALCAMERA_LIFETIME_PERSISTENT` so the camera is available across
   reboots without launching the app first.

`MFCreateVirtualCamera` documentation:
https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/

## Wire protocol

Identical to the macOS extension — see `../macos/README.md`. The pipe is
`\\.\pipe\pianokeys-vcam`; everything else (header layout, BGRA top-down,
latest-wins drop policy) is the same.
