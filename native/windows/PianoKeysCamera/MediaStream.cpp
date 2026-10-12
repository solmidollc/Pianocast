#include "MediaStream.h"
#include "MediaSource.h"

#include <mferror.h>
#include <mfapi.h>

using Microsoft::WRL::ComPtr;

namespace pianokeys {

namespace {
constexpr LONGLONG kFrameDuration100ns = 166666;  // 1s / 60 ≈ 16.666ms
}  // namespace

HRESULT MediaStream::RuntimeClassInitialize(MediaSource* parent,
                                            IMFStreamDescriptor* desc) {
    parent_ = parent;
    stream_desc_ = desc;
    return MFCreateEventQueue(&event_queue_);
}

IFACEMETHODIMP MediaStream::GetEvent(DWORD flags, IMFMediaEvent** out) {
    return event_queue_->GetEvent(flags, out);
}
IFACEMETHODIMP MediaStream::BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) {
    return event_queue_->BeginGetEvent(cb, state);
}
IFACEMETHODIMP MediaStream::EndGetEvent(IMFAsyncResult* res, IMFMediaEvent** out) {
    return event_queue_->EndGetEvent(res, out);
}
IFACEMETHODIMP MediaStream::QueueEvent(MediaEventType type, REFGUID ext,
                                        HRESULT status,
                                        const PROPVARIANT* value) {
    return event_queue_->QueueEventParamVar(type, ext, status, value);
}

IFACEMETHODIMP MediaStream::GetMediaSource(IMFMediaSource** out) {
    return parent_->QueryInterface(IID_PPV_ARGS(out));
}

IFACEMETHODIMP MediaStream::GetStreamDescriptor(IMFStreamDescriptor** out) {
    return stream_desc_.CopyTo(out);
}

IFACEMETHODIMP MediaStream::RequestSample(IUnknown* token) {
    return EmitSample(token);
}

HRESULT MediaStream::Start(const PROPVARIANT* /*startPosition*/) {
    if (running_) return S_OK;
    running_ = true;
    next_pts_ = 0;
    reader_ = std::make_unique<FramePipeReader>([this](Frame&& f) {
        OnFrame(std::move(f));
    });
    reader_->Start();
    return QueueEvent(MEStreamStarted, GUID_NULL, S_OK, nullptr);
}

HRESULT MediaStream::Stop() {
    if (!running_) return S_OK;
    running_ = false;
    if (reader_) {
        reader_->Stop();
        reader_.reset();
    }
    return QueueEvent(MEStreamStopped, GUID_NULL, S_OK, nullptr);
}

HRESULT MediaStream::Shutdown() {
    Stop();
    if (event_queue_) event_queue_->Shutdown();
    return S_OK;
}

void MediaStream::OnFrame(Frame&& frame) {
    auto box = std::make_unique<Frame>(std::move(frame));
    std::lock_guard<std::mutex> lk(frame_mu_);
    latest_frame_ = std::move(box);
}

HRESULT MediaStream::EmitSample(IUnknown* token) {
    std::unique_ptr<Frame> frame;
    {
        std::lock_guard<std::mutex> lk(frame_mu_);
        frame = std::move(latest_frame_);
    }
    if (!frame) {
        // No frame yet — emit nothing; the consumer will request again.
        return S_OK;
    }

    ComPtr<IMFMediaBuffer> buffer;
    DWORD length = static_cast<DWORD>(frame->pixels.size());
    HRESULT hr = MFCreateMemoryBuffer(length, &buffer);
    if (FAILED(hr)) return hr;

    BYTE* dst = nullptr;
    hr = buffer->Lock(&dst, nullptr, nullptr);
    if (FAILED(hr)) return hr;
    memcpy(dst, frame->pixels.data(), length);
    buffer->Unlock();
    buffer->SetCurrentLength(length);

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) return hr;
    sample->AddBuffer(buffer.Get());
    sample->SetSampleTime(next_pts_);
    sample->SetSampleDuration(kFrameDuration100ns);
    if (token) sample->SetUnknown(MFSampleExtension_Token, token);
    next_pts_ += kFrameDuration100ns;

    PROPVARIANT v{};
    v.vt = VT_UNKNOWN;
    v.punkVal = sample.Get();
    v.punkVal->AddRef();
    return QueueEvent(MEMediaSample, GUID_NULL, S_OK, &v);
}

}  // namespace pianokeys
