#ifdef _WIN32
#include "mp3.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

namespace mp3 {
namespace {

template <class T> struct Rel { T* p = nullptr; ~Rel() { if (p) p->Release(); } T** operator&() { return &p; } T* operator->() { return p; } };

std::string hr_text(const char* what, HRESULT hr) {
    char b[160];
    std::snprintf(b, sizeof b, "%s failed (0x%08lx)", what, static_cast<unsigned long>(hr));
    return b;
}

}  // namespace

bool available() { return true; }

std::string encode(const ps::Audio& a, const std::string& dst, int kbps) {
    if (a.channels != 2 || a.rate != 48000) return "MP3 export expects stereo 48 kHz audio";
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool co = SUCCEEDED(hr);
    hr = MFStartup(MF_VERSION, MFSTARTUP_LITE);
    if (FAILED(hr)) { if (co) CoUninitialize(); return hr_text("Media Foundation start-up", hr); }
    std::string result;
    {
        Rel<IMFAttributes> attr;
        Rel<IMFSinkWriter> writer;
        Rel<IMFMediaType> out_t, in_t;
        int wn = MultiByteToWideChar(CP_UTF8, 0, dst.c_str(), -1, nullptr, 0);
        std::wstring wpath(size_t(wn), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, dst.c_str(), -1, wpath.data(), wn);
        DeleteFileW(wpath.c_str());
        do {
            if (FAILED(hr = MFCreateAttributes(&attr, 1))) { result = hr_text("MFCreateAttributes", hr); break; }
            attr->SetGUID(MF_TRANSCODE_CONTAINERTYPE, MFTranscodeContainerType_MP3);
            if (FAILED(hr = MFCreateSinkWriterFromURL(wpath.c_str(), nullptr, attr.p, &writer))) { result = hr_text("creating the MP3 writer", hr); break; }

            MFCreateMediaType(&out_t);
            out_t->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
            out_t->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_MP3);
            out_t->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000);
            out_t->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2);
            out_t->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, UINT32(kbps * 125));
            out_t->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 1);
            DWORD stream = 0;
            if (FAILED(hr = writer->AddStream(out_t.p, &stream))) { result = hr_text("adding the MP3 stream", hr); break; }

            MFCreateMediaType(&in_t);
            in_t->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
            in_t->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
            in_t->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
            in_t->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000);
            in_t->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2);
            in_t->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 4);
            in_t->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 48000 * 4);
            if (FAILED(hr = writer->SetInputMediaType(stream, in_t.p, nullptr))) { result = hr_text("setting the input format", hr); break; }
            if (FAILED(hr = writer->BeginWriting())) { result = hr_text("starting the encoder", hr); break; }

            const size_t chunk = 48000;                    // one second per sample
            LONGLONG t100ns = 0;
            for (size_t at = 0; at < a.frames() && result.empty(); at += chunk) {
                const size_t n = std::min(chunk, a.frames() - at);
                Rel<IMFMediaBuffer> buf;
                Rel<IMFSample> sample;
                if (FAILED(hr = MFCreateMemoryBuffer(DWORD(n * 4), &buf))) { result = hr_text("allocating a buffer", hr); break; }
                BYTE* p = nullptr;
                buf->Lock(&p, nullptr, nullptr);
                auto* s16 = reinterpret_cast<int16_t*>(p);
                for (size_t i = 0; i < n * 2; i++) {
                    float v = std::max(-1.0f, std::min(1.0f, a.data[at * 2 + i]));
                    s16[i] = int16_t(std::lrintf(v * 32767.0f));
                }
                buf->Unlock();
                buf->SetCurrentLength(DWORD(n * 4));
                MFCreateSample(&sample);
                sample->AddBuffer(buf.p);
                const LONGLONG dur = LONGLONG(n) * 10000000LL / 48000;
                sample->SetSampleTime(t100ns);
                sample->SetSampleDuration(dur);
                t100ns += dur;
                if (FAILED(hr = writer->WriteSample(stream, sample.p))) result = hr_text("encoding", hr);
            }
            if (result.empty() && FAILED(hr = writer->Finalize())) result = hr_text("finishing the MP3", hr);
        } while (false);
    }
    MFShutdown();
    if (co) CoUninitialize();
    return result;
}

}  // namespace mp3
#endif
