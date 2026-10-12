// Companion installer-helper: publishes the COM class registered by
// PianoKeysCamera.dll as a system virtual camera via MFCreateVirtualCamera.
//
// Build this as a tiny exe and ship it alongside the DLL. The Electron app's
// installer runs it post-install. Lifetime is PERSISTENT so the camera is
// available across reboots without the app being open.

#include <windows.h>
#include <mfvirtualcamera.h>
#include <mfapi.h>
#include <wrl/client.h>
#include <cstdio>

using Microsoft::WRL::ComPtr;

extern "C" const GUID CLSID_PianoKeysCamera;
// Stable friendly name shown to users in OBS/Zoom/etc.
constexpr const wchar_t* kFriendlyName = L"Piano Keys";
constexpr const wchar_t* kSourceId     = L"com.pianokeys.app.camera";

int wmain(int argc, wchar_t** argv) {
    bool uninstall = (argc > 1 && wcscmp(argv[1], L"--uninstall") == 0);

    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) return 1;

    if (uninstall) {
        ComPtr<IMFVirtualCamera> existing;
        // MFCreateVirtualCamera with lifetime PERSISTENT and an existing source id
        // re-acquires the registration; we then shut it down to remove.
        hr = MFCreateVirtualCamera(
            MFVirtualCameraType_SoftwareCameraSource,
            MFVirtualCameraLifetime_System,
            MFVirtualCameraAccess_AllUsers,
            kFriendlyName,
            L"",  // no inproc DLL parameter at uninstall
            nullptr, 0,
            &existing);
        if (SUCCEEDED(hr) && existing) existing->Shutdown();
        MFShutdown();
        return 0;
    }

    wchar_t guidStr[64] = {};
    StringFromGUID2(CLSID_PianoKeysCamera, guidStr, ARRAYSIZE(guidStr));

    ComPtr<IMFVirtualCamera> camera;
    hr = MFCreateVirtualCamera(
        MFVirtualCameraType_SoftwareCameraSource,
        MFVirtualCameraLifetime_System,
        MFVirtualCameraAccess_AllUsers,
        kFriendlyName,
        guidStr,
        nullptr, 0,
        &camera);
    if (FAILED(hr)) {
        fwprintf(stderr, L"MFCreateVirtualCamera failed: 0x%08X\n", hr);
        MFShutdown();
        return 2;
    }
    hr = camera->Start(nullptr);
    if (FAILED(hr)) {
        fwprintf(stderr, L"Start failed: 0x%08X\n", hr);
        MFShutdown();
        return 3;
    }
    // Camera is now registered. The lifetime is system-wide and survives
    // the helper exiting.
    MFShutdown();
    return 0;
}
