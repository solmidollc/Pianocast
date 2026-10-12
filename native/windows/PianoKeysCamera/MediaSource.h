#pragma once

#include <mfidl.h>
#include <mfobjects.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include <atomic>
#include <mutex>

namespace pianokeys {

class MediaStream;

// Top-level IMFMediaSource for the Piano Keys virtual camera. One BGRA
// 1920x1080 video stream at 60fps.
class MediaSource
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          IMFMediaSource,
          IMFMediaSourceEx> {
public:
    HRESULT RuntimeClassInitialize();

    // IMFMediaEventGenerator
    IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** out) override;
    IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) override;
    IFACEMETHODIMP EndGetEvent(IMFAsyncResult* res, IMFMediaEvent** out) override;
    IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID ext, HRESULT status,
                              const PROPVARIANT* value) override;

    // IMFMediaSource
    IFACEMETHODIMP GetCharacteristics(DWORD* out) override;
    IFACEMETHODIMP CreatePresentationDescriptor(
        IMFPresentationDescriptor** out) override;
    IFACEMETHODIMP Start(IMFPresentationDescriptor* desc, const GUID* timeFormat,
                         const PROPVARIANT* startPosition) override;
    IFACEMETHODIMP Stop() override;
    IFACEMETHODIMP Pause() override;
    IFACEMETHODIMP Shutdown() override;

    // IMFMediaSourceEx
    IFACEMETHODIMP GetSourceAttributes(IMFAttributes** out) override;
    IFACEMETHODIMP GetStreamAttributes(DWORD streamId, IMFAttributes** out) override;
    IFACEMETHODIMP SetD3DManager(IUnknown* manager) override;

private:
    HRESULT BuildStream();

    Microsoft::WRL::ComPtr<IMFMediaEventQueue> event_queue_;
    Microsoft::WRL::ComPtr<IMFPresentationDescriptor> presentation_;
    Microsoft::WRL::ComPtr<IMFAttributes> source_attrs_;
    Microsoft::WRL::ComPtr<MediaStream> stream_;
    std::mutex mu_;
    bool shutdown_ = false;
};

}  // namespace pianokeys
