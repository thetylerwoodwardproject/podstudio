#include <algorithm>
#include <cmath>
#include <cstdio>

#include "app.h"
#include "theme.h"

using namespace theme;

namespace ps {

namespace {

struct Field { const char* block; const char* field; const char* title; float lo, hi; const char* fmt; };

const Field kComp[] = {{"comp", "threshold", "Threshold", -60, 0, "%.1f dB"}, {"comp", "ratio", "Ratio", 1.5f, 4.5f, "%.2f : 1"},
                       {"comp", "attack", "Attack", 0.1f, 10, "%.1f ms"}, {"comp", "release", "Release", 5, 200, "%.0f ms"},
                       {"comp", "gain", "Make-up gain", 0, 9, "%.1f dB"}};
const Field kGate[] = {{"gate", "threshold", "Threshold", -60, 0, "%.1f dB"}, {"gate", "range", "Range", -100, 0, "%.0f dB"},
                       {"gate", "attack", "Attack", 0.1f, 1000, "%.0f ms"}, {"gate", "hold", "Hold", 0.05f, 2, "%.2f s"},
                       {"gate", "release", "Release", 0.05f, 2, "%.2f s"}, {"gate", "hysteresis", "Hysteresis", 0, 100, "%.0f %%"}};
const Field kExc[] = {{"exciter", "harmonics", "Harmonics", 0, 100, "%.0f %%"}, {"exciter", "tune", "Tune", 600, 5000, "%.0f Hz"}};
const Field kBot[] = {{"bottom", "drive", "Drive", 0, 100, "%.0f %%"}, {"bottom", "tune", "Tune", 60, 312, "%.0f Hz"}};

}  // namespace

void App::page_mic(ImVec2 avail) {
    const bool ok = mic_state_ == 2 && mic_link_;
    const float gap = px(16);
    ImGui::BeginChild("##micscroll", avail, ImGuiChildFlags_None);
    const float W = avail.x - px(14);                     // leave room for the scrollbar
    const float colw = (W - gap) / 2;
    ImDrawList* dl = ImGui::GetWindowDrawList();

    // ---- banner
    if (!ok) {
        ImVec2 p = ImGui::GetCursorScreenPos();
        std::string msg;
        if (mic_state_ == 1) msg = "Connecting to the PodMic's controls...";
        else if (mic_state_ == 3) { std::lock_guard<std::mutex> l(mic_mu_); msg = mic_error_.empty() ? "The mic's controls didn't answer." : mic_error_; }
        else msg = "PodMic USB not detected. Plug it in to control its on-board processing.";
        const float h = px(44);
        dl->AddRectFilled(p, ImVec2(p.x + W, p.y + h), hex(0x2a1f0a), px(10));
        dl->AddRect(p, ImVec2(p.x + W, p.y + h), hex(0x713f12), px(10));
        ui::text_at(dl, fonts.body, ImVec2(p.x + px(16), p.y + (h - ui::text_size(fonts.body, msg.c_str()).y) / 2), hex(0xfcd34d), msg.c_str());
        ImGui::Dummy(ImVec2(W, h + px(12)));
    }
    auto flag = [&](const char* k) -> bool& { return *reinterpret_cast<bool*>(&mic_flags_[k]); };
    auto get_flag = [&](const char* k) { auto it = mic_flags_.find(k); return it != mic_flags_.end() && it->second; };
    (void)flag;

    auto toggle_row = [&](const char* label, const char* sub, const char* key, float width, const std::function<void(podmic::Mic&, bool)>& apply) {
        ImVec2 p = ImGui::GetCursorScreenPos();
        ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted(label);
        if (sub) { ImGui::SameLine(); ui::label_dim(sub); }
        ImGui::SetCursorScreenPos(ImVec2(p.x + width - px(38), p.y));
        bool v = get_flag(key);
        if (!ok) ImGui::BeginDisabled();
        if (ui::toggle(key, &v)) { mic_flags_[key] = v; mic_write("toggle", [&](podmic::Mic& m) { apply(m, v); }); }
        if (!ok) ImGui::EndDisabled();
        ImGui::Dummy(ImVec2(0, px(6)));
    };

    // ---- input + headphones
    const float row1 = px(330);
    if (ui::card_begin("##input", ImVec2(colw, row1), "Input", "Gain is the mic's own preamp, the same control as Windows' Sound settings.")) {
        const float cw = colw - px(36);
        ImGui::Dummy(ImVec2(0, px(4)));
        if (gain_ok_ && have_cur_input_) {
            float g = gain_db_;
            if (ui::slider_row("Input gain", &g, gain_range_.lo, gain_range_.hi, "%.1f dB", cw, "Set it so your loudest speech peaks around -12 dB on the meter.")) {
                gain_db_ = g;
                mic_queue("gain", [this, g](podmic::Mic&) { if (have_cur_input_) gain_set(cur_input_, g); });
                gain_next_ = now_ + 3.0;
            }
        } else {
            ImGui::TextUnformatted("Input gain"); ui::label_dim("Not available: the mic isn't connected, or Windows doesn't expose a gain control for it.");
            ImGui::Dummy(ImVec2(0, px(10)));
        }
        ImGui::Dummy(ImVec2(0, px(8)));
        toggle_row("Mute", "Silences the mic itself", "mute", cw, [](podmic::Mic& m, bool v) { m.set_mute(v); });
        toggle_row("High-pass filter", "Cuts rumble below 75 Hz", "hpf", cw, [](podmic::Mic& m, bool v) { m.set_hpf(v); });
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    if (ui::card_begin("##phones", ImVec2(colw, row1), "Headphones", "Direct monitoring plays your mic in the headphone jack with no delay. It is independent of mute.")) {
        const float cw = colw - px(36);
        ImGui::Dummy(ImVec2(0, px(4)));
        float mix = mic_vals_.count("monitor_mix") ? mic_vals_["monitor_mix"] : 91.f;
        char fmt[24]; std::snprintf(fmt, sizeof fmt, "%s", "%.0f");
        float shown = mix * 66.f / 100.f - 60.f;
        float tmp = mix;
        if (!ok) ImGui::BeginDisabled();
        if (ui::slider_row("Monitor mix (mic level)", &tmp, 0.f, 100.f, "%.0f", cw)) {
            mic_vals_["monitor_mix"] = std::round(tmp);
            const int v = int(std::round(tmp));
            mic_queue("monitor_mix", [v](podmic::Mic& m) { m.set_monitor_mix(v); });
        }
        if (!ok) ImGui::EndDisabled();
        char sb[40]; std::snprintf(sb, sizeof sb, "%+.0f dB in the headphones", double(shown));
        ui::label_dim(sb);
        ImGui::Dummy(ImVec2(0, px(14)));
        toggle_row("Direct monitoring", nullptr, "monitoring", cw, [](podmic::Mic& m, bool v) { m.set_monitoring(v); });
    }
    ui::card_end();

    // ---- processing header
    ImGui::Dummy(ImVec2(0, px(6)));
    {
        ImGui::PushFont(fonts.title); ImGui::TextUnformatted("Processing"); ImGui::PopFont();
        ImGui::SameLine(0, px(14)); ImGui::AlignTextToFramePadding(); ui::label_dim("Runs inside the mic, so every app hears it.");
        ImGui::SameLine(W - px(330));
        bool on = get_flag("processing");
        ImGui::AlignTextToFramePadding(); ui::label_dim("On");
        ImGui::SameLine(0, px(8));
        if (!ok) ImGui::BeginDisabled();
        if (ui::toggle("##proc", &on)) { mic_flags_["processing"] = on; mic_write("processing", [&](podmic::Mic& m) { m.set_processing(on); }); }
        ImGui::SameLine(0, px(18));
        const bool adv = get_flag("advanced");
        if (ui::chip("Basic", !adv, px(78))) { if (adv) { mic_flags_["advanced"] = false; mic_write("mode", [](podmic::Mic& m) { m.set_advanced(false); }); } }
        ImGui::SameLine(0, px(6));
        if (ui::chip("Advanced", adv, px(98))) { if (!adv) { mic_flags_["advanced"] = true; mic_write("mode", [](podmic::Mic& m) { m.set_advanced(true); }); } }
        if (!ok) ImGui::EndDisabled();
    }
    ImGui::Dummy(ImVec2(0, px(4)));

    if (!get_flag("advanced")) {
        // ---- basic: Depth, Sparkle, Punch
        const float w3 = (W - gap * 2) / 3;
        struct B { const char* key; const char* title; const char* sub; unsigned color; };
        static const B basics[] = {{"depth", "Depth", "Low-end weight (Big Bottom)", 0xff7ad9}, {"sparkle", "Sparkle", "Air and presence (Aural Exciter)", 0xb48bff},
                                   {"punch", "Punch", "Dynamics (compressor and gate)", 0xffb454}};
        bool any = false;
        for (int i = 0; i < 3; i++) {
            if (i) ImGui::SameLine(0, gap);
            const B& b = basics[i];
            if (ui::card_begin(b.key, ImVec2(w3, px(190)), b.title, b.sub)) {
                float v = mic_vals_.count(b.key) ? mic_vals_[b.key] : 50.f;
                char big[16]; std::snprintf(big, sizeof big, "%.0f", double(v));
                ImGui::PushFont(fonts.mono_big); ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(hex(b.color)));
                ImGui::TextUnformatted(big);
                ImGui::PopStyleColor(); ImGui::PopFont();
                if (!ok) ImGui::BeginDisabled();
                if (ui::slider_row("Amount", &v, 0.f, 100.f, "%.0f", w3 - px(36))) { mic_vals_[b.key] = std::round(v); any = true; }
                if (!ok) ImGui::EndDisabled();
            }
            ui::card_end();
        }
        if (any) {
            const float d = mic_vals_["depth"], s = mic_vals_["sparkle"], p = mic_vals_["punch"];
            mic_queue("basic", [d, s, p](podmic::Mic& m) { m.apply_basic(d, s, p); });
        }
    } else {
        // ---- advanced: four processors
        struct Block { const char* title; const char* block; const Field* f; size_t n; unsigned color; };
        const Block blocks[] = {{"Compressor", "comp", kComp, 5, 0xffb454}, {"Noise gate", "gate", kGate, 6, 0x4fd8eb},
                                {"Aural Exciter", "exciter", kExc, 2, 0xb48bff}, {"Big Bottom", "bottom", kBot, 2, 0xff7ad9}};
        for (int i = 0; i < 4; i++) {
            const Block& b = blocks[i];
            if (i % 2) ImGui::SameLine(0, gap);
            const float h = (i < 2) ? px(46) + b.n * px(62) + px(34) : px(46) + b.n * px(62) + px(34);
            if (ui::card_begin(b.title, ImVec2(colw, std::max(h, px(220))), b.title, nullptr)) {
                std::string ek = std::string(b.block) + "_on";
                ImVec2 top = ImGui::GetCursorScreenPos();
                bool on = get_flag(ek.c_str());
                ImGui::SetCursorScreenPos(ImVec2(top.x + colw - px(36) - px(38), top.y - px(40)));
                if (!ok) ImGui::BeginDisabled();
                if (ui::toggle(ek.c_str(), &on)) { mic_flags_[ek] = on; const std::string blk = b.block; mic_write("enable", [&](podmic::Mic& m) { m.set_enabled(blk, on); }); }
                if (!ok) ImGui::EndDisabled();
                ImGui::SetCursorScreenPos(top);
                dl = ImGui::GetWindowDrawList();
                dl->AddRectFilled(ImVec2(top.x, top.y - px(2)), ImVec2(top.x + px(26), top.y), hex(b.color), px(1));
                for (size_t k = 0; k < b.n; k++) {
                    const Field& f = b.f[k];
                    std::string key = std::string(f.block) + "." + f.field;
                    float v = mic_vals_.count(key) ? mic_vals_[key] : float(podmic::default_value(f.block, f.field));
                    if (!ok) ImGui::BeginDisabled();
                    if (ui::slider_row(f.title, &v, f.lo, f.hi, f.fmt, colw - px(36))) {
                        mic_vals_[key] = v;
                        const std::string blk = f.block, fld = f.field; const double dv = v;
                        mic_queue(key, [blk, fld, dv](podmic::Mic& m) { m.set_field(blk, fld, dv); });
                    }
                    if (!ok) ImGui::EndDisabled();
                }
            }
            ui::card_end();
        }
    }
    ImGui::Dummy(ImVec2(0, px(10)));
    if (ok) {
        std::string d; { std::lock_guard<std::mutex> l(mic_mu_); d = mic_desc_; }
        ui::label_dim("Settings are stored in the mic itself, so they stay when you unplug it.");
    }
    ImGui::EndChild();
}

}  // namespace ps
