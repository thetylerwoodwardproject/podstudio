#include "podmic.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace ps::podmic {
namespace {

#include "podmic_tables.inc"

constexpr int kSize[9] = {0, 0, 10, 0, 29, 0, 15, 0, 28};            // report id -> length
int reply_id(int report) { return report == R_SVC ? 0x01 : report == R_DSP ? 0x03 : report == R_ACC ? 0x05 : 0x07; }
int clampi(double x, int lo, int hi) { return int(std::max<double>(lo, std::min<double>(hi, x))); }

uint32_t q31(double x) { double v = x * 2147483648.0; return v >= 2147483647.0 ? 0x7FFFFFFFu : uint32_t(int32_t(v)); }   // saturating, as Python int()

void put_u32(std::vector<uint8_t>& o, uint32_t v) { for (int i = 0; i < 4; i++) o.push_back(uint8_t(v >> (8 * i))); }

int idx_thr(double db) { return clampi(int((1 - (db + 60) / 60) * 255), 0, 255); }
int idx_att(double ms) { return clampi(int(std::log10(ms / 0.1) / std::log10(100.0) * 255), 0, 255); }
int idx_rel(double ms) { return clampi(int(std::log10(ms / 5) / std::log10(40.0) * 255), 0, 255); }
int idx_gain(double db) { return clampi(int(db / 9 * 255), 0, 255); }
int coarse_pct(double pct) { return clampi(int(pct / 100 * 255), 0, 255); }
int coarse_exc_hz(double hz) { return clampi(int((hz - 600) / 4400 * 255), 0, 255); }
int coarse_bb_hz(double hz) { return clampi(int((hz - 60) / 252 * 255), 0, 255); }

int nearest(const uint32_t* t, uint32_t raw) {
    int best = 0; int64_t bd = INT64_MAX;
    for (int i = 0; i < 256; i++) {
        int64_t d = std::llabs(int64_t(t[i]) - int64_t(raw));
        if (d == 0) return i;                                      // exact entry first, like list.index
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

double gate_attack_ms(int32_t raw) {
    const double x = raw / 2147483648.0;
    double lo = 0.1, hi = 1000.0;
    for (int i = 0; i < 60; i++) {                                // x falls as ms rises: bisect on a log scale
        double mid = std::sqrt(lo * hi);
        double w = 5 / (48000 * mid / 1000), c = std::cos(w);
        if ((c - 1 + std::sqrt(std::max(c * c - 4 * c + 3, 0.0))) > x) lo = mid; else hi = mid;
    }
    return std::round(std::sqrt(lo * hi) * 100) / 100;
}

double round_to(double v, int places) { double m = std::pow(10.0, places); return std::round(v * m) / m; }

}  // namespace

std::vector<uint8_t> dsp_report(int target, int op, int sub, const std::vector<uint8_t>& payload) {
    std::vector<uint8_t> body = {uint8_t(target), uint8_t(op), uint8_t(sub)};
    body.insert(body.end(), payload.begin(), payload.end());
    body.resize(size_t(kSize[R_DSP] - 1), 0);
    body.insert(body.begin(), R_DSP);
    return body;
}

std::vector<uint8_t> param_report(int param, int op, std::initializer_list<int> args) {
    std::vector<uint8_t> body = {uint8_t(param), uint8_t(op)};
    for (int a : args) body.push_back(uint8_t(a));
    body.resize(size_t(kSize[R_PARAM] - 1), 0);
    body.insert(body.begin(), R_PARAM);
    return body;
}

int block_target(const std::string& b) { return b == "comp" ? COMP : b == "gate" ? GATE : b == "exciter" ? EXCITER : b == "bottom" ? BOTTOM : -1; }

bool encode_field(const std::string& block, const std::string& field, double v, int& target, int& sub, std::vector<uint8_t>& p) {
    p.clear();
    target = block_target(block);
    auto table = [&](const uint32_t* t, int idx) { put_u32(p, t[idx]); };
    auto i32 = [&](uint32_t q) { put_u32(p, q); };
    if (block == "comp") {
        if (field == "threshold") { sub = 1; table(T_thr, idx_thr(v)); }
        else if (field == "ratio") { sub = 2; p.push_back(uint8_t(clampi(int((v - 1.5) / 3 * 255), 0, 255))); }
        else if (field == "attack") { sub = 3; table(T_att, idx_att(v)); }
        else if (field == "release") { sub = 4; table(T_rel, idx_rel(v)); }
        else if (field == "gain") { sub = 5; table(T_gain, idx_gain(v)); }
        else return false;
    } else if (block == "gate") {
        if (field == "threshold") { sub = 1; i32(q31(std::pow(10.0, v / 20))); }
        else if (field == "attack") { sub = 2; double w = 5 / (48000 * (v / 1000)), c = std::cos(w); i32(q31(c - 1 + std::sqrt(c * c - 4 * c + 3))); }
        else if (field == "hold") { sub = 3; i32(q31(1 / (48000 * v))); }
        else if (field == "release") { sub = 4; i32(q31(1 / (48000 * v))); }
        else if (field == "range") { sub = 5; i32(q31(std::pow(10.0, v / 20))); }
        else if (field == "hysteresis") { sub = 6; i32(q31(std::pow(10.0, (-1 - 7 * (v / 100)) / 20))); }
        else return false;
    } else if (block == "exciter") {
        if (field == "harmonics") { sub = 1; int b = coarse_pct(v); table(T_hd, b); p.push_back(uint8_t(b)); }
        else if (field == "tune") { sub = 2; int b = coarse_exc_hz(v); table(T_tuneA, b); table(T_tuneB, b); p.push_back(uint8_t(b)); }
        else return false;
    } else if (block == "bottom") {
        if (field == "drive") { sub = 1; int b = coarse_pct(v); table(T_hd, b); p.push_back(uint8_t(b)); }
        else if (field == "tune") { sub = 2; p.push_back(uint8_t(coarse_bb_hz(v))); }
        else return false;
    } else return false;
    return true;
}

std::optional<double> decode_field(const std::string& block, const std::string& field, const std::vector<uint8_t>& in) {
    std::vector<uint8_t> d = in;
    if (d.size() < 16) d.resize(16, 0);
    uint32_t u; std::memcpy(&u, d.data(), 4);
    int32_t s; std::memcpy(&s, d.data(), 4);
    const double sd = std::max<double>(s, 1);
    if (block == "comp") {
        if (field == "threshold") return round_to((1 - nearest(T_thr, u) / 255.0) * 60 - 60, 1);
        if (field == "ratio") return round_to(1.5 + d[0] / 255.0 * 3, 2);
        if (field == "attack") return round_to(0.1 * std::pow(10.0, nearest(T_att, u) / 255.0 * 2), 2);
        if (field == "release") return round_to(5 * std::pow(40.0, nearest(T_rel, u) / 255.0), 1);
        if (field == "gain") return round_to(nearest(T_gain, u) / 255.0 * 9, 1);
    } else if (block == "gate") {
        if (field == "threshold" || field == "range") return round_to(20 * std::log10(sd / 2147483648.0), 1);
        if (field == "attack") return gate_attack_ms(s);
        if (field == "hold" || field == "release") return round_to(1 / (48000 * sd / 2147483648.0), 3);
        if (field == "hysteresis") return std::round(std::max(0.0, std::min(100.0, (-20 * std::log10(sd / 2147483648.0) - 1) / 7 * 100)));
    } else if (block == "exciter") {
        if (field == "harmonics") return round_to(d[4] / 255.0 * 100, 1);
        if (field == "tune") return std::round(600 + d[8] / 255.0 * 4400);
    } else if (block == "bottom") {
        if (field == "drive") return round_to(d[4] / 255.0 * 100, 1);
        if (field == "tune") return std::round(60 + d[0] / 255.0 * 252);
    }
    return std::nullopt;
}

std::vector<FieldWrite> basic_to_advanced(double depth, double sparkle, double punch) {
    const double p = punch / 100;
    return {{"bottom", "drive", 0.9 * depth}, {"exciter", "harmonics", 0.9 * sparkle}, {"comp", "threshold", -14 - 16 * p},
            {"comp", "gain", 3 * p}, {"gate", "threshold", 10 * p - 45}, {"gate", "range", -13 * p}};
}

double default_value(const std::string& b, const std::string& f) {
    static const std::map<std::string, double> d = {
        {"comp.threshold", -24.9}, {"comp.ratio", 1.99}, {"comp.attack", 0.69}, {"comp.release", 20.9}, {"comp.gain", 1.98},
        {"gate.threshold", -38.0}, {"gate.attack", 30.0}, {"gate.hold", 0.305}, {"gate.release", 0.2}, {"gate.range", -9.0},
        {"gate.hysteresis", 20.0}, {"exciter.harmonics", 69.8}, {"exciter.tune", 3499.0}, {"bottom.drive", 64.7}, {"bottom.tune", 90.0}};
    auto it = d.find(b + "." + f);
    return it == d.end() ? 0.0 : it->second;
}

// ---------------------------------------------------------------------------------------------------- device
Reply Mic::xfer(const std::vector<uint8_t>& report, int timeout_ms) {
    if (!t_) throw Error("not open");
    t_->drain();
    if (!t_->write(report.data(), report.size())) throw Error("couldn't write to the mic");
    const int want = reply_id(report[0]);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    uint8_t buf[256];
    for (;;) {
        const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
        if (left <= 0) throw Error("timeout waiting for reply");
        int n = t_->read(buf, sizeof buf, int(left));
        if (n < 0) throw Error("couldn't read from the mic");
        if (n > 0 && buf[0] == want) {
            Reply r;
            r.status = n > 2 ? char(buf[2]) : '?';
            if (n > 3) r.data.assign(buf + 3, buf + n);
            return r;
        }
    }
}

Reply Mic::ok(Reply r, const char* what) {
    if (r.status != 'A') throw Error(std::string(what) + ": device answered '" + r.status + "'");
    return r;
}

void Mic::set_param(int param, std::initializer_list<int> args) { ok(xfer(param_report(param, 0x00, args)), "set parameter"); }

std::vector<uint8_t> Mic::get_param(int param, std::initializer_list<int> args) {
    auto d = ok(xfer(param_report(param, 0x01, args)), "get parameter").data;
    if (d.empty()) d.push_back(0);
    return d;
}

void Mic::set_monitor_mix(int v) { set_param(P_MONMIX, {std::max(0, std::min(100, v))}); }
void Mic::set_slider(int idx, double pct) { set_param(P_SLIDER, {idx, std::max(0, std::min(100, int(pct)))}); }

void Mic::set_enabled(const std::string& block, bool on) { ok(xfer(dsp_report(block_target(block), 0x02, 0x00, {uint8_t(on)})), "enable"); }
bool Mic::enabled(const std::string& block) {
    auto r = ok(xfer(dsp_report(block_target(block), 0x03, 0x00)), "enabled");
    return !r.data.empty() && r.data[0];
}

void Mic::set_field(const std::string& block, const std::string& field, double value) {
    int target, sub; std::vector<uint8_t> payload;
    if (!encode_field(block, field, value, target, sub, payload)) throw Error("unknown field " + block + "." + field);
    ok(xfer(dsp_report(target, 0x02, sub, payload)), "set field");
}

std::optional<double> Mic::read_field(const std::string& block, const std::string& field) {
    int target, sub; std::vector<uint8_t> payload;
    if (!encode_field(block, field, 0, target, sub, payload)) return std::nullopt;
    try { return decode_field(block, field, ok(xfer(dsp_report(target, 0x03, sub)), "read field").data); }
    catch (const Error&) { return std::nullopt; }
}

void Mic::apply_basic(double depth, double sparkle, double punch) {
    set_slider(0, depth); set_slider(1, sparkle); set_slider(2, punch);
    for (const char* b : {"bottom", "exciter", "comp", "gate"}) set_enabled(b, true);
    for (const auto& w : basic_to_advanced(depth, sparkle, punch)) set_field(w.block, w.field, w.value);
}

Mic::State Mic::read_state() {
    State s;
    auto grab = [](auto& slot, auto fn) { try { slot = fn(); } catch (const Error&) {} };
    grab(s.hpf, [&] { return hpf(); });
    grab(s.mute, [&] { return muted(); });
    grab(s.monitoring, [&] { return monitoring(); });
    grab(s.monitor_mix, [&] { return monitor_mix(); });
    grab(s.processing, [&] { return processing(); });
    grab(s.advanced, [&] { return advanced(); });
    grab(s.depth, [&] { return slider(0); });
    grab(s.sparkle, [&] { return slider(1); });
    grab(s.punch, [&] { return slider(2); });
    grab(s.comp_on, [&] { return enabled("comp"); });
    grab(s.gate_on, [&] { return enabled("gate"); });
    grab(s.exciter_on, [&] { return enabled("exciter"); });
    grab(s.bottom_on, [&] { return enabled("bottom"); });
    return s;
}

}  // namespace ps::podmic
