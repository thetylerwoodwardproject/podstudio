#ifdef _WIN32
#include "micctl.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <setupapi.h>
extern "C" {
#include <hidsdi.h>
#include <hidpi.h>
}
#include <endpointvolume.h>
#include <mmdeviceapi.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "../core/podmic.h"

namespace ps {
namespace {

struct HidInfo { std::wstring path; USHORT usage_page = 0, usage = 0, in_len = 0, out_len = 0; };

std::vector<HidInfo> enumerate_hid() {
    std::vector<HidInfo> out;
    GUID guid; HidD_GetHidGuid(&guid);
    HDEVINFO set = SetupDiGetClassDevsW(&guid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
    if (set == INVALID_HANDLE_VALUE) return out;
    for (DWORD i = 0;; i++) {
        SP_DEVICE_INTERFACE_DATA ifd{}; ifd.cbSize = sizeof ifd;
        if (!SetupDiEnumDeviceInterfaces(set, nullptr, &guid, i, &ifd)) break;
        DWORD need = 0;
        SetupDiGetDeviceInterfaceDetailW(set, &ifd, nullptr, 0, &need, nullptr);
        std::vector<char> buf(need);
        auto* d = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(buf.data());
        d->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
        if (!SetupDiGetDeviceInterfaceDetailW(set, &ifd, d, need, nullptr, nullptr)) continue;
        HANDLE h = CreateFileW(d->DevicePath, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);   // no access: query only
        if (h == INVALID_HANDLE_VALUE) continue;
        HIDD_ATTRIBUTES at{}; at.Size = sizeof at;
        if (HidD_GetAttributes(h, &at) && at.VendorID == podmic::kVid && at.ProductID == podmic::kPid) {
            HidInfo info; info.path = d->DevicePath;
            PHIDP_PREPARSED_DATA pp = nullptr;
            if (HidD_GetPreparsedData(h, &pp)) {
                HIDP_CAPS caps{};
                if (HidP_GetCaps(pp, &caps) == HIDP_STATUS_SUCCESS) {
                    info.usage_page = caps.UsagePage; info.usage = caps.Usage;
                    info.in_len = caps.InputReportByteLength; info.out_len = caps.OutputReportByteLength;
                }
                HidD_FreePreparsedData(pp);
            }
            out.push_back(info);
        }
        CloseHandle(h);
    }
    SetupDiDestroyDeviceInfoList(set);
    // the vendor-defined interface first: a USB device can expose several (volume buttons, vendor controls)
    std::sort(out.begin(), out.end(), [](const HidInfo& a, const HidInfo& b) {
        return std::make_pair(a.usage_page < 0xFF00, a.usage_page) < std::make_pair(b.usage_page < 0xFF00, b.usage_page);
    });
    return out;
}

class HidTransport : public podmic::Transport {
public:
    HidTransport(HANDLE h, size_t in_len, size_t out_len) : h_(h), in_(in_len ? in_len : 64), out_(out_len) {
        ev_r_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        ev_w_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        ibuf_.assign(in_, 0);
    }
    ~HidTransport() override {
        if (pending_) { CancelIoEx(h_, &ovr_); DWORD n; GetOverlappedResult(h_, &ovr_, &n, TRUE); }
        CloseHandle(ev_r_); CloseHandle(ev_w_); CloseHandle(h_);
    }
    void drain() override { uint8_t b[256]; while (read(b, sizeof b, 0) > 0) {} }
    bool write(const uint8_t* d, size_t n) override {
        std::vector<uint8_t> buf(std::max(n, out_), 0);                  // Windows wants exactly the output report length
        std::memcpy(buf.data(), d, n);
        OVERLAPPED ov{}; ov.hEvent = ev_w_; ResetEvent(ev_w_);
        DWORD wrote = 0;
        if (!WriteFile(h_, buf.data(), DWORD(buf.size()), &wrote, &ov)) {
            if (GetLastError() != ERROR_IO_PENDING) return false;
            if (WaitForSingleObject(ev_w_, 1000) != WAIT_OBJECT_0) { CancelIoEx(h_, &ov); return false; }
            if (!GetOverlappedResult(h_, &ov, &wrote, FALSE)) return false;
        }
        return true;
    }
    int read(uint8_t* buf, size_t cap, int timeout_ms) override {
        if (!pending_) {
            std::memset(&ovr_, 0, sizeof ovr_); ovr_.hEvent = ev_r_; ResetEvent(ev_r_);
            DWORD got = 0;
            if (!ReadFile(h_, ibuf_.data(), DWORD(ibuf_.size()), &got, &ovr_) && GetLastError() != ERROR_IO_PENDING) return -1;
            pending_ = true;
        }
        if (WaitForSingleObject(ev_r_, DWORD(std::max(0, timeout_ms))) != WAIT_OBJECT_0) return 0;      // the read stays pending
        DWORD got = 0;
        pending_ = false;
        if (!GetOverlappedResult(h_, &ovr_, &got, FALSE)) return -1;
        const size_t n = std::min<size_t>(got, cap);
        std::memcpy(buf, ibuf_.data(), n);
        return int(n);
    }
private:
    HANDLE h_, ev_r_, ev_w_;
    size_t in_, out_;
    std::vector<uint8_t> ibuf_;
    OVERLAPPED ovr_{};
    bool pending_ = false;
};

class WinLink : public MicLink {
public:
    WinLink(std::unique_ptr<HidTransport> t, std::string d) : t_(std::move(t)), mic_(t_.get()), desc_(std::move(d)) {}
    podmic::Mic& mic() override { return mic_; }
    std::string describe() const override { return desc_; }
private:
    std::unique_ptr<HidTransport> t_;
    podmic::Mic mic_;
    std::string desc_;
};

IAudioEndpointVolume* endpoint(const InputInfo& in) {
    // the capture device's id (a miniaudio ma_device_id) starts with its WASAPI endpoint id, a wide string
    if (in.id.size() < sizeof(wchar_t) * 2) return nullptr;
    const wchar_t* wid = reinterpret_cast<const wchar_t*>(in.id.data());
    IMMDeviceEnumerator* en = nullptr;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&en)))) return nullptr;
    IMMDevice* dev = nullptr; IAudioEndpointVolume* vol = nullptr;
    if (SUCCEEDED(en->GetDevice(wid, &dev))) {
        dev->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&vol));
        dev->Release();
    }
    en->Release();
    return vol;
}

struct ComScope { bool ok; ComScope() : ok(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {} ~ComScope() { if (ok) CoUninitialize(); } };

}  // namespace

bool mic_hid_present() { return !enumerate_hid().empty(); }

std::unique_ptr<MicLink> connect_mic(std::string& error) {
    auto list = enumerate_hid();
    if (list.empty()) { error = "PodMic USB control channel not found"; return nullptr; }
    for (const HidInfo& i : list) {
        HANDLE h = CreateFileW(i.path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
        if (h == INVALID_HANDLE_VALUE) continue;
        auto t = std::make_unique<HidTransport>(h, i.in_len, i.out_len);
        try {
            podmic::Mic probe(t.get());
            probe.xfer(podmic::param_report(podmic::P_HPF, 0x01), 400);       // the right interface answers a request
        } catch (const podmic::Error&) { continue; }
        char d[96]; std::snprintf(d, sizeof d, "usage page 0x%04X, usage 0x%04X, reports %u/%u", i.usage_page, i.usage, i.in_len, i.out_len);
        return std::make_unique<WinLink>(std::move(t), d);
    }
    error = "The mic is connected, but its controls didn't answer. Close RODE Central if it is open, then replug the mic.";
    return nullptr;
}

bool gain_range(const InputInfo& in, GainRange& r) {
    ComScope c; IAudioEndpointVolume* v = endpoint(in);
    if (!v) return false;
    bool ok = SUCCEEDED(v->GetVolumeRange(&r.lo, &r.hi, &r.step));
    v->Release();
    return ok && r.hi > r.lo;
}
bool gain_get(const InputInfo& in, float& db) {
    ComScope c; IAudioEndpointVolume* v = endpoint(in);
    if (!v) return false;
    bool ok = SUCCEEDED(v->GetMasterVolumeLevel(&db));
    v->Release();
    return ok;
}
bool gain_set(const InputInfo& in, float db) {
    ComScope c; IAudioEndpointVolume* v = endpoint(in);
    if (!v) return false;
    bool ok = SUCCEEDED(v->SetMasterVolumeLevel(db, nullptr));
    v->Release();
    return ok;
}

}  // namespace ps
#endif
