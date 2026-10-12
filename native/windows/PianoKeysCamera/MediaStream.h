#pragma once

#include <mfidl.h>
#include <mfobjects.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include <atomic>
#include <mutex>
#include <queue>
#include <memory>

#include "FramePipeReader.h"

namespace pianokeys {

class MediaSource;

// IMFMediaStream implementation for the single 1920x1080 BGRA video track.
//
// Workflow:
//   - On Start(), the FramePipeReader opens \\.\pipe\pianokeys-vcam and starts
//     pushing frames into latest_frame_ (latest-wins; we drop on overrun).
//   - When the MF pipeline pulls a sample (RequestSample), we wrap the latest
//     BGRA buffer in an IMFMediaBuffer + IMFSample with a host-clock timestamp
//     and emit MEMediaSample.
class MediaStream
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          IMFMediaStream> {
public:
    HRESULT RuntimeClassInitialize(MediaSource* parent, IMFStreamDescriptor* desc);

    // IMFMediaEventGenerator
    IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** out) override;
    IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* cb, IUnknown* state) override;
    IFACEMETHODIMP EndGetEvent(IMFAsyncResult* res, IMFMediaEvent** out) override;
    IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID ext, HRESULT status,
                              const PROPVARIANT* value) override;

    // IMFMediaStream
    IFACEMETHODIMP GetMediaSource(IMFMediaSource** out) override;
    IFACEMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** out) override;
    IFACEMETHODIMP RequestSample(IUnknown* token) override;

    HRESULT Start(const PROPVARIANT* startPosition);
    HRESULT Stop();
    HRESULT Shutdown();

private:
    void OnFrame(Frame&& frame);
    HRESULT EmitSample(IUnknown* token);

    Microsoft::WRL::ComPtr<IMFMediaEventQueue> event_queue_;
    Microsoft::WRL::ComPtr<IMFStreamDescriptor> stream_desc_;
    MediaSource* parent_ = nullptr;  // weak; owns us
    std::unique_ptr<FramePipeReader> reader_;

    std::mutex frame_mu_;
    std::unique_ptr<Frame> latest_frame_;
    LONGLONG next_pts_ = 0;
    bool running_ = false;
};

}  // namespace pianokeys
