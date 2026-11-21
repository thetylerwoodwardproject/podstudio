#include <algorithm>
#include <cmath>
#include <cstdio>

#include "app.h"
#include "platform.h"
#include "theme.h"

using namespace theme;

namespace ps {

namespace {

const char* mode_short(const std::string& m) {
    return m == "momentary" ? "Hold" : m == "toggle" ? "Toggle" : m == "loop" ? "Loop" : "One-shot";
}

void dot(ImDrawList* dl, ImVec2 p, float r, unsigned c) { dl->AddCircleFilled(p, r, hex(c), 16); }

// One channel strip, centred in a column of width `col_w`: title, readout, then the meter beside its fader.
void strip(const char* name, unsigned color, const ui::MeterState& m, float* fader_db, bool has_fader, float meter_h,
           const char* note, float col_w) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    char v[32];
    if (has_fader) std::snprintf(v, sizeof v, "%s%.1f dB", *fader_db > 0.05f ? "+" : "", double(*fader_db));
    else std::snprintf(v, sizeof v, "%s", note);
    const ImVec2 ns = ui::text_size(fonts.semibold, name), vs = ui::text_size(fonts.mono, v);
    const float title_w = px(14) + ns.x;
    const float cx = p.x + col_w / 2;
    dot(dl, ImVec2(cx - title_w / 2 + px(5), p.y + px(10)), px(4.5f), color);
    ui::text_at(dl, fonts.semibold, ImVec2(cx - title_w / 2 + px(14), p.y), hex(kText), name);
    ui::text_at(dl, fonts.mono, ImVec2(cx - vs.x / 2, p.y + px(24)), hex(kDim), v);
    const float meter_w = px(14 + 30), group_w = has_fader ? meter_w + px(10) + px(40) : meter_w;
    ImGui::SetCursorScreenPos(ImVec2(cx - group_w / 2, p.y + px(58)));
    ImVec2 q = ImGui::GetCursorScreenPos();
    ui::meter_vertical(name, m, meter_h, true);
    if (has_fader) {
        ImGui::SetCursorScreenPos(ImVec2(q.x + meter_w + px(10), q.y - px(8)));
        char id[32]; std::snprintf(id, sizeof id, "##f_%s", name);
        ui::fader(id, fader_db, meter_h + px(16), color);
    }
}

}  // namespace

void App::connect_overlay(ImVec2 pos, ImVec2 size) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y), hex(kBg, 0.93f), px(14));
    const float cw = px(520), ch = show_other_inputs_ ? px(420) : px(300);
    ImVec2 c(pos.x + (size.x - cw) / 2, pos.y + std::max(px(10), (size.y - ch) / 2 - px(20)));
    dl->AddRectFilled(c, ImVec2(c.x + cw, c.y + ch), hex(0x0f0f12), px(16));
    dl->AddRect(c, ImVec2(c.x + cw, c.y + ch), hex(kLine), px(16));
    // microphone glyph
    ImVec2 m(c.x + cw / 2, c.y + px(66));
    dl->AddRectFilled(ImVec2(m.x - px(13), m.y - px(34)), ImVec2(m.x + px(13), m.y + px(10)), hex(kDim), px(13));
    dl->AddRect(ImVec2(m.x - px(23), m.y - px(10)), ImVec2(m.x + px(23), m.y + px(24)), hex(kDim), px(23), ImDrawFlags_RoundCornersBottom, px(3));
    dl->AddLine(ImVec2(m.x, m.y + px(24)), ImVec2(m.x, m.y + px(38)), hex(kDim), px(3));
    dl->AddLine(ImVec2(m.x - px(14), m.y + px(38)), ImVec2(m.x + px(14), m.y + px(38)), hex(kDim), px(3));
    const char* t1 = "Connect your PodMic USB";
    ImVec2 ts = ui::text_size(fonts.title, t1);
    ui::text_at(dl, fonts.title, ImVec2(c.x + (cw - ts.x) / 2, c.y + px(124)), hex(kText), t1);
    const char* t2 = "PodStudio works with the RODE PodMic USB. Plug it in and this screen clears by itself.";
    ImGui::SetCursorScreenPos(ImVec2(c.x + px(48), c.y + px(162)));
    ImGui::PushTextWrapPos(c.x + cw - px(48) - ImGui::GetWindowPos().x + ImGui::GetScrollX());
    ImGui::PushFont(fonts.body); ImGui::PushStyleColor(ImGuiCol_Text, hexv(kDim));
    ImGui::TextUnformatted(t2);
    ImGui::PopStyleColor(); ImGui::PopFont(); ImGui::PopTextWrapPos();
    if (!audio_error_.empty()) {
        ImGui::SetCursorScreenPos(ImVec2(c.x + px(48), c.y + px(206)));
        ui::label_dim(audio_error_.c_str());
    }
    ImGui::SetCursorScreenPos(ImVec2(c.x + (cw - px(210)) / 2, c.y + px(238)));
    if (ImGui::Button("Use another microphone", ImVec2(px(210), px(34)))) show_other_inputs_ = !show_other_inputs_;
    if (show_other_inputs_) {
        ImGui::SetCursorScreenPos(ImVec2(c.x + px(40), c.y + px(284)));
        ImGui::BeginChild("##others", ImVec2(cw - px(80), px(120)), ImGuiChildFlags_None);
        for (size_t i = 0; i < inputs_.size(); i++) {
            if (ImGui::Selectable(inputs_[i].name.c_str(), false, 0, ImVec2(0, px(28)))) {
                std::string e;
                if (engine_.open_input(inputs_[i], e)) { source_name_ = inputs_[i].name; cur_input_ = inputs_[i]; have_cur_input_ = true; show_other_inputs_ = false; }
                else audio_error_ = e;
            }
        }
        if (inputs_.empty()) ui::label_dim("No audio inputs found.");
        ImGui::EndChild();
    }
}

void App::page_session(ImVec2 avail) {
    if (!have_proj_) return;
    const float gap = px(16);
    const ImVec2 origin = ImGui::GetCursorScreenPos();
    const float top_h = std::min(px(360), avail.y * 0.52f);
    const float left_w = avail.x * 0.60f - gap / 2, right_w = avail.x - left_w - gap;
    const bool rec = engine_.recording();

    // ---- console
    if (ui::card_begin("##console", ImVec2(left_w, top_h), "Console", "Levels in dBFS. Double-click a fader for unity (0 dB).")) {
        const float meter_h = top_h - px(158);
        const float col_w = (left_w - px(36)) / 3;
        ImVec2 start = ImGui::GetCursorScreenPos();
        float mic = float(proj_.mic_db), hk = float(proj_.hotkeys_db);
        ImGui::SetCursorScreenPos(start);
        strip("Mic", 0x4fd8eb, mic_m_, &mic, true, meter_h, "", col_w);
        ImGui::SetCursorScreenPos(ImVec2(start.x + col_w, start.y));
        strip("Hotkeys", 0xb48bff, hk_m_, &hk, true, meter_h, "", col_w);
        ImGui::SetCursorScreenPos(ImVec2(start.x + col_w * 2, start.y));
        char note[32]; std::snprintf(note, sizeof note, "%.0f LUFS target", proj_.target_lufs);
        float dummy = 0;
        strip("Master", 0xfafafa, master_m_, &dummy, false, meter_h, note, col_w);
        if (mic != float(proj_.mic_db)) { proj_.mic_db = mic; engine_.set_mic_fader_db(mic); settings_dirty_ = true; }
        if (hk != float(proj_.hotkeys_db)) { proj_.hotkeys_db = hk; engine_.set_hotkeys_fader_db(hk); settings_dirty_ = true; }
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    // ---- display and record
    if (ui::card_begin("##display", ImVec2(right_w, top_h), "Recorder", nullptr)) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 p = ImGui::GetCursorScreenPos();
        const bool busy = rendering_.load();
        const char* state = rec ? "RECORDING" : busy ? "RENDERING MASTER" : engine_.input_open() ? "READY" : "NO MIC";
        const unsigned sc = rec ? kAccent : busy ? kWarn : engine_.input_open() ? kOk : kFaint;
        dl->AddCircleFilled(ImVec2(p.x + px(5), p.y + px(10)), px(4.5f), hex(sc), 16);
        ui::text_at(dl, fonts.sm, ImVec2(p.x + px(16), p.y + px(3)), hex(sc), state);
        double secs = rec ? engine_.rec_seconds() : (proj_.mic_duration > 0 ? proj_.mic_duration : 0.0);
        std::string t = ui::fmt_time(secs, true);
        ImVec2 ts = ui::text_size(fonts.mono_big, t.c_str());
        const float cx = p.x + (right_w - px(36)) / 2;
        ui::text_at(dl, fonts.mono_big, ImVec2(cx - ts.x / 2, p.y + px(24)), hex(rec ? kText : kDim), t.c_str());
        const float bs = px(92);
        ImGui::SetCursorScreenPos(ImVec2(cx - bs / 2, p.y + px(88)));
        if (ui::record_button(rec, bs, engine_.input_open() && !busy)) { rec ? stop_record() : start_record(); }
        const char* hint = rec ? "Stop  (Ctrl+R)" : "Record  (Ctrl+R)";
        ImVec2 hs = ui::text_size(fonts.body, hint);
        ui::text_at(dl, fonts.body, ImVec2(cx - hs.x / 2, p.y + px(88) + bs + px(8)), hex(kDim), hint);
        ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + top_h - px(112)));
        if (busy) {
            std::string pr; { std::lock_guard<std::mutex> l(render_mu_); pr = render_progress_; }
            if (pr.find(':') != std::string::npos) pr = "Finishing";
            ui::label_dim((pr + "...").c_str());
        } else if (engine_.duck_db() < -1.f && engine_.input_open()) {
            char b[48]; std::snprintf(b, sizeof b, "Ducking %.0f dB", double(engine_.duck_db()));
            ui::label_dim(b);
        } else ui::label_dim("48 kHz, 24-bit, mono");
        if (rec && engine_.rec_overflowed()) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(kWarn)); ui::label_dim("Disk is too slow: some audio was dropped."); ImGui::PopStyleColor(); }
    }
    ui::card_end();

    // ---- pads
    ImGui::SetCursorScreenPos(ImVec2(origin.x, origin.y + top_h + gap));
    const float pad_area_h = avail.y - top_h - gap;
    if (ui::card_begin("##pads", ImVec2(avail.x, pad_area_h), "Hotkeys", "Press a pad's key or click it. Right-click a pad to edit it.")) {
        const int n = int(std::min<size_t>(proj_.pads.size(), 8));
        const int cols = 4, rows = (n + cols - 1) / cols;
        const float pgap = px(12);
        ImVec2 inner = ImGui::GetContentRegionAvail();
        const float pw = (inner.x - pgap * (cols - 1)) / cols;
        const float ph = std::max(px(84), (inner.y - pgap * (rows - 1)) / std::max(1, rows));
        ImVec2 base = ImGui::GetCursorScreenPos();
        for (int i = 0; i < n; i++) {
            Pad& pad = proj_.pads[size_t(i)];
            ImGui::SetCursorScreenPos(ImVec2(base.x + (i % cols) * (pw + pgap), base.y + (i / cols) * (ph + pgap)));
            char id[24]; std::snprintf(id, sizeof id, "##pad%d", i);
            std::string label = pad.label.empty() ? pad.clip : pad.label;
            std::string keyup = pad.key;
            for (char& c : keyup) c = char(std::toupper((unsigned char)c));
            const bool active = engine_.handle_active(i);
            ui::pad_button(id, ImVec2(pw, ph), keyup.c_str(), label.c_str(), mode_short(pad.mode),
                           parse_color(pad.color.c_str(), hex(0x6ea8ff)), flash_[i], active, pad.clip.empty(), pad.duck);
            if (ImGui::IsItemActivated()) pad_press(i);
            if (ImGui::IsItemDeactivated()) pad_release(i);
            if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(ImGuiMouseButton_Right)) { edit_pad_ = i; open_edit_popup_ = true; }
        }
    }
    ui::card_end();

    if (!engine_.input_open() && !rec) connect_overlay(origin, ImVec2(avail.x, avail.y));
}

}  // namespace ps
