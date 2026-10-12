#include "MediaSource.h"
#include "MediaStream.h"

#include <mfapi.h>
#include <mferror.h>
#include <new>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;

namespace pianokeys {

namespace {
constexpr UINT32 kWidth = 1920;
constexpr UINT32 kHeight = 1080;
constexpr UINT32 kFps = 60;

HRESULT BuildVideoType(IMFMediaType** out) {
    ComPtr<IMFMediaType> type;
    HRESULT hr = MFCreateMediaType(&type);
    if (FAILED(hr)) return hr;
    hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);                    if (FAILED(hr)) return hr;
    hr = type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);                    if (FAILED(hr)) return hr;
    hr = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);   if (FAILED(hr)) return hr;
    hr = MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, kWidth, kHeight);     if (FAILED(hr)) return hr;
    hr = MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, kFps, 1);            if (FAILED(hr)) return hr;
    hr = MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);       if (FAILED(hr)) return hr;
    hr = type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);                  if (FAILED(hr)) return hr;
    return type.CopyTo(out);
}
}  // namespace

HRESULT MediaSource::RuntimeClassInitialize() {
    HRESULT hr = MFCreateEventQueue(&event_queue_);
    if (FAILED(hr)) return hr;
    hr = MFCreateAttributes(&source_attrs_, 4);
    if (FAILED(hr)) return hr;
    source_attrs_->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, KSCATEGORY_VIDEO_CAMERA);
    return BuildStream();
}

HRESULT MediaSource::BuildStream() {
    ComPtr<IMFMediaType> type;
    HRESULT hr = BuildVideoType(&type);
    if (FAILED(hr)) return hr;

    ComPtr<IMFStreamDescriptor> sd;
    IMFMediaType* types[1] = { type.Get() };
    hr = MFCreateStreamDescriptor(0, 1, types, &sd);
    if (FAILED(hr)) return hr;

    ComPtr<IMFMediaTypeHandler> handler;
    sd->GetMediaTypeHandler(&handler);
    handler->SetCurrentMediaType(type.Get());

    hr = Make<MediaStream>(&stream_, this, sd.Get());
    if (FAILED(hr)) return hr;

    IMFStreamDescriptor* sds[1] = { sd.Get() };
    hr = MFCreatePresentationDescriptor(1, sds, &presentation_);
    if (FAILED(hr)) return hr;
    presentation_->SelectStream(0);
    return S_OK;
}

IFACEMETHODIMP MediaSource::GetEvent(DWORD flags, IMFMediaEvent** out) {
    return event_queue_->GetEvent(flags, out);
}
IFACEMETHODIMP MediaSource::BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) {
    return event_queue_->BeginGetEvent(cb, state);
}
IFACEMETHODIMP MediaSource::EndGetEvent(IMFAsyncResult* res, IMFMediaEvent** out) {
    return event_queue_->EndGetEvent(res, out);
}
IFACEMETHODIMP MediaSource::QueueEvent(MediaEventType type, REFGUID ext, HRESULT status,
                                        const PROPVARIANT* value) {
    return event_queue_->QueueEventParamVar(type, ext, status, value);
}

IFACEMETHODIMP MediaSource::GetCharacteristics(DWORD* out) {
    *out = MFMEDIASOURCE_IS_LIVE;
    return S_OK;
}

IFACEMETHODIMP MediaSource::CreatePresentationDescriptor(IMFPresentationDescriptor** out) {
    return presentation_->Clone(out);
}

IFACEMETHODIMP MediaSource::Start(IMFPresentationDescriptor* /*desc*/,
                                   const GUID* /*timeFormat*/,
                                   const PROPVARIANT* startPosition) {
    HRESULT hr = stream_->Start(startPosition);
    if (FAILED(hr)) return hr;

    PROPVARIANT v{};
    v.vt = VT_UNKNOWN;
    v.punkVal = stream_.Get();
    v.punkVal->AddRef();
    QueueEvent(MENewStream, GUID_NULL, S_OK, &v);

    PROPVARIANT t{};
    t.vt = VT_I8;
    t.hVal.QuadPart = 0;
    return QueueEvent(MESourceStarted, GUID_NULL, S_OK, &t);
}

IFACEMETHODIMP MediaSource::Stop() {
    stream_->Stop();
    return QueueEvent(MESourceStopped, GUID_NULL, S_OK, nullptr);
}

IFACEMETHODIMP MediaSource::Pause() { return MF_E_INVALID_STATE_TRANSITION; }

IFACEMETHODIMP MediaSource::Shutdown() {
    std::lock_guard<std::mutex> lk(mu_);
    if (shutdown_) return MF_E_SHUTDOWN;
    shutdown_ = true;
    if (stream_) stream_->Shutdown();
    if (event_queue_) event_queue_->Shutdown();
    return S_OK;
}

IFACEMETHODIMP MediaSource::GetSourceAttributes(IMFAttributes** out) {
    return source_attrs_.CopyTo(out);
}
IFACEMETHODIMP MediaSource::GetStreamAttributes(DWORD /*streamId*/, IMFAttributes** out) {
    return source_attrs_.CopyTo(out);
}
IFACEMETHODIMP MediaSource::SetD3DManager(IUnknown* /*manager*/) {
    return S_OK;  // pure software output; no D3D needed.
}

}  // namespace pianokeys
