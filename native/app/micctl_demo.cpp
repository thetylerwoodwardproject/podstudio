#ifndef _WIN32
// Stand-in for the PodMic on Linux (the preview build): answers like a mic and remembers what was set, so the Mic page
// can be developed and photographed without hardware.
#include "micctl.h"

#include <cstdlib>
#include <map>

namespace ps {
namespace {

class FakeTransport : public podmic::Transport {
public:
    void drain() override {}
    bool write(const uint8_t* d, size_t n) override { last_.assign(d, d + n); apply(); return true; }
    int read(uint8_t* buf, size_t, int) override {
        buf[0] = last_[0] == podmic::R_PARAM ? 0x07 : 0x03; buf[1] = 0; buf[2] = 'A';
        int n = 3;
        if (last_[0] == podmic::R_PARAM && last_[2] == 0x01) {
            auto it = params_.find(last_[1]);
            buf[n++] = it == params_.end() ? 0 : it->second;
            buf[n++] = (last_[1] == podmic::P_SLIDER) ? uint8_t(sliders_[last_[3] % 3]) : 0;
        } else buf[n++] = 1;
        return n;
    }
private:
    void apply() {
        if (last_[0] == podmic::R_PARAM && last_[2] == 0x00) {
            if (last_[1] == podmic::P_SLIDER) sliders_[last_[3] % 3] = last_[4];
            else params_[last_[1]] = last_[3];
        }
    }
    std::vector<uint8_t> last_;
    std::map<int, uint8_t> params_;
    int sliders_[3] = {50, 40, 60};
};

class FakeLink : public MicLink {
public:
    FakeLink() : mic_(&t_) {}
    podmic::Mic& mic() override { return mic_; }
    std::string describe() const override { return "demo mic"; }
private:
    FakeTransport t_;
    podmic::Mic mic_;
};

float g_gain = 38.0f;

}  // namespace

bool mic_hid_present() { return std::getenv("PODSTUDIO_DEMO") != nullptr; }
std::unique_ptr<MicLink> connect_mic(std::string& error) {
    if (!std::getenv("PODSTUDIO_DEMO")) { error = "PodMic USB control channel not found"; return nullptr; }
    return std::make_unique<FakeLink>();
}
bool gain_range(const InputInfo&, GainRange& r) { if (!std::getenv("PODSTUDIO_DEMO")) return false; r = {22.f, 63.f, 1.f}; return true; }
bool gain_get(const InputInfo&, float& db) { if (!std::getenv("PODSTUDIO_DEMO")) return false; db = g_gain; return true; }
bool gain_set(const InputInfo&, float db) { g_gain = db; return true; }

}  // namespace ps
#endif
