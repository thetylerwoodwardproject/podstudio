// RODE PodMic USB control protocol over USB HID (report layouts from the podmicusb-doctor project, MIT, (c) 2026 rumkit).
// Pure protocol: byte encoding and decoding, and a request/reply helper over an abstract Transport. The transport
// (Windows HID) lives in app/. Byte-for-byte checked against podstudio/podmic.py in native/tests.
//
// PodStudio is not affiliated with or endorsed by RODE Microphones.
#pragma once
#include <cstdint>
#include <initializer_list>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace ps::podmic {

constexpr uint16_t kVid = 0x19F7, kPid = 0x004A;

enum Report : uint8_t { R_SVC = 0x02, R_DSP = 0x04, R_ACC = 0x06, R_PARAM = 0x08 };
enum Block { COMP = 0, GATE = 1, EXCITER = 2, BOTTOM = 3 };
enum Param : uint8_t { P_HPF = 0x01, P_MONITOR = 0x03, P_MONMIX = 0x04, P_MUTE = 0x08, P_ADVANCED = 0x0B, P_SLIDER = 0x0C, P_PROCESSING = 0x0D };

class Error : public std::runtime_error { using std::runtime_error::runtime_error; };

// ---- pure encoders
std::vector<uint8_t> dsp_report(int target, int op, int sub, const std::vector<uint8_t>& payload = {});
std::vector<uint8_t> param_report(int param, int op, std::initializer_list<int> args = {});

struct FieldWrite { std::string block, field; double value; };
// Encodes one DSP field (e.g. "comp","threshold", -24.9 dB). Returns false for an unknown field.
bool encode_field(const std::string& block, const std::string& field, double value, int& target, int& sub, std::vector<uint8_t>& payload);
std::optional<double> decode_field(const std::string& block, const std::string& field, const std::vector<uint8_t>& data);
std::vector<FieldWrite> basic_to_advanced(double depth, double sparkle, double punch);   // Depth / Sparkle / Punch, 0..100
int block_target(const std::string& block);                                              // comp 0, gate 1, exciter 2, bottom 3, else -1
double default_value(const std::string& block, const std::string& field);                // factory default (spec 11.2)

// ---- device
struct Transport {
    virtual ~Transport() = default;
    virtual void drain() = 0;                                              // discard any pending input reports
    virtual bool write(const uint8_t* data, size_t n) = 0;                 // one output report, report id first
    virtual int read(uint8_t* buf, size_t cap, int timeout_ms) = 0;        // bytes read, 0 on timeout, -1 on error
};

struct Reply { char status = '?'; std::vector<uint8_t> data; };

class Mic {
public:
    explicit Mic(Transport* t) : t_(t) {}
    Reply xfer(const std::vector<uint8_t>& report, int timeout_ms = 1000);   // throws Error on timeout or write failure

    void set_param(int param, std::initializer_list<int> args);
    std::vector<uint8_t> get_param(int param, std::initializer_list<int> args = {});
    bool hpf() { return get_param(P_HPF)[0]; }               void set_hpf(bool on) { set_param(P_HPF, {on}); }
    bool muted() { return get_param(P_MUTE)[0]; }            void set_mute(bool on) { set_param(P_MUTE, {on}); }
    bool monitoring() { return get_param(P_MONITOR)[0]; }    void set_monitoring(bool on) { set_param(P_MONITOR, {on}); }
    int monitor_mix() { return get_param(P_MONMIX)[0]; }     void set_monitor_mix(int v);
    bool processing() { return get_param(P_PROCESSING)[0]; } void set_processing(bool on) { set_param(P_PROCESSING, {on}); }
    bool advanced() { return get_param(P_ADVANCED)[0]; }     void set_advanced(bool on) { set_param(P_ADVANCED, {on}); }
    int slider(int idx) { auto d = get_param(P_SLIDER, {idx}); return d.size() > 1 ? d[1] : 0; }
    void set_slider(int idx, double pct);

    void set_enabled(const std::string& block, bool on);
    bool enabled(const std::string& block);
    void set_field(const std::string& block, const std::string& field, double value);
    std::optional<double> read_field(const std::string& block, const std::string& field);
    void apply_basic(double depth, double sparkle, double punch);

    struct State {
        std::optional<bool> hpf, mute, monitoring, processing, advanced, comp_on, gate_on, exciter_on, bottom_on;
        std::optional<int> monitor_mix, depth, sparkle, punch;
    };
    State read_state();                                      // best effort: unreadable items stay empty

private:
    Reply ok(Reply r, const char* what);
    Transport* t_;
};

}  // namespace ps::podmic
