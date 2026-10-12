// Minimal COM in-proc server for the Piano Keys virtual camera.
//
// Exports DllGetClassObject, DllCanUnloadNow, DllRegisterServer,
// DllUnregisterServer. The CLSID is fixed below.
//
// The actual virtual camera registration with Windows happens via a separate
// helper binary that calls MFCreateVirtualCamera using this CLSID. See
// Registration.cpp.

#include <windows.h>
#include <unknwn.h>
#include <wrl/module.h>
#include <wrl/implements.h>
#include <atomic>
#include <new>

#include "MediaSource.h"

using namespace Microsoft::WRL;
using namespace pianokeys;

// {C1A9D3E2-8B4F-4E58-9D5A-3F5B6A9D2DEC}
// regenerate if you fork this project so your COM class is unique.
extern "C" const GUID CLSID_PianoKeysCamera = {
    0xC1A9D3E2, 0x8B4F, 0x4E58,
    {0x9D, 0x5A, 0x3F, 0x5B, 0x6A, 0x9D, 0x2D, 0xEC}};

namespace {

class MediaSourceFactory
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IClassFactory> {
public:
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** out) override {
        if (outer) return CLASS_E_NOAGGREGATION;
        ComPtr<MediaSource> src;
        HRESULT hr = MakeAndInitialize<MediaSource>(&src);
        if (FAILED(hr)) return hr;
        return src.CopyTo(iid, out);
    }
    IFACEMETHODIMP LockServer(BOOL) override { return S_OK; }
};

std::atomic<LONG> g_lock_count{0};
HMODULE g_module = nullptr;

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}

extern "C" __declspec(dllexport) HRESULT __stdcall
DllGetClassObject(REFCLSID clsid, REFIID iid, void** out) {
    if (!IsEqualCLSID(clsid, CLSID_PianoKeysCamera)) return CLASS_E_CLASSNOTAVAILABLE;
    ComPtr<MediaSourceFactory> factory = Make<MediaSourceFactory>();
    if (!factory) return E_OUTOFMEMORY;
    return factory.CopyTo(iid, out);
}

extern "C" __declspec(dllexport) HRESULT __stdcall DllCanUnloadNow() {
    return g_lock_count.load() == 0 ? S_OK : S_FALSE;
}

extern "C" __declspec(dllexport) HRESULT __stdcall DllRegisterServer() {
    // Minimal HKCR registration. The MFCreateVirtualCamera helper performs
    // the actual virtual-camera publication; this only ensures the COM class
    // is constructible by CoCreateInstance.
    wchar_t path[MAX_PATH];
    if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return E_FAIL;
    HKEY clsidKey = nullptr;
    if (RegCreateKeyExW(HKEY_CLASSES_ROOT,
                        L"CLSID\\{C1A9D3E2-8B4F-4E58-9D5A-3F5B6A9D2DEC}",
                        0, nullptr, REG_OPTION_NON_VOLATILE,
                        KEY_WRITE, nullptr, &clsidKey, nullptr) != ERROR_SUCCESS)
        return SELFREG_E_CLASS;
    const wchar_t* friendly = L"Piano Keys Virtual Camera";
    RegSetValueExW(clsidKey, nullptr, 0, REG_SZ,
                   reinterpret_cast<const BYTE*>(friendly),
                   static_cast<DWORD>((wcslen(friendly) + 1) * sizeof(wchar_t)));
    HKEY inproc = nullptr;
    RegCreateKeyExW(clsidKey, L"InprocServer32", 0, nullptr,
                    REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &inproc, nullptr);
    RegSetValueExW(inproc, nullptr, 0, REG_SZ,
                   reinterpret_cast<const BYTE*>(path),
                   static_cast<DWORD>((wcslen(path) + 1) * sizeof(wchar_t)));
    const wchar_t* model = L"Both";
    RegSetValueExW(inproc, L"ThreadingModel", 0, REG_SZ,
                   reinterpret_cast<const BYTE*>(model),
                   static_cast<DWORD>((wcslen(model) + 1) * sizeof(wchar_t)));
    RegCloseKey(inproc);
    RegCloseKey(clsidKey);
    return S_OK;
}

extern "C" __declspec(dllexport) HRESULT __stdcall DllUnregisterServer() {
    RegDeleteTreeW(HKEY_CLASSES_ROOT,
                   L"CLSID\\{C1A9D3E2-8B4F-4E58-9D5A-3F5B6A9D2DEC}");
    return S_OK;
}
