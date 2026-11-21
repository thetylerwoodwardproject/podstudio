// Connection to the PodMic's on-board controls: HID transport (Windows) plus the input gain through Core Audio.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "../core/podmic.h"
#include "engine.h"

namespace ps {

class MicLink {
public:
    virtual ~MicLink() = default;
    virtual podmic::Mic& mic() = 0;
    virtual std::string describe() const = 0;             // which HID interface answered, for the log
};

// Finds the PodMic's HID interfaces and returns a link over the first one that answers a request. Null + error otherwise.
std::unique_ptr<MicLink> connect_mic(std::string& error);
bool mic_hid_present();                                    // is there any HID interface with the PodMic's USB id?

// Input gain through the system mixer (Windows Core Audio endpoint volume), addressed by the capture device.
struct GainRange { float lo = 0, hi = 0, step = 0; };
bool gain_range(const InputInfo& in, GainRange& r);
bool gain_get(const InputInfo& in, float& db);
bool gain_set(const InputInfo& in, float db);

}  // namespace ps
