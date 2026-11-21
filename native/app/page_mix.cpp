#include <algorithm>
#include <cmath>
#include <cstdio>

#include "app.h"
#include "denoise.h"
#include "platform.h"
#include "theme.h"

using namespace theme;

namespace ps {

void App::page_mix(ImVec2 avail) {
    if (!have_proj_) return;
    static double last_check = -10; static bool have_dfn = false;
    if (ImGui::GetTime() - last_check > 2.0) { have_dfn = denoise::available(); last_check = ImGui::GetTime(); }

    const float gap = px(16);
    const float colw = (avail.x - gap) / 2;
    const float row1 = px(318);
    bool changed = false;

    // ---- loudness + noise reduction
    if (ui::card_begin("##loud", ImVec2(colw, row1), "Master", "The master is stereo, normalized to the loudness target with a true-peak limit.")) {
        float t = float(proj_.target_lufs);
        if (ui::slider_row("Loudness target", &t, -24.f, -10.f, "%.0f LUFS", colw - px(36), "Podcasts are usually -16 LUFS. Louder than -14 may be turned down by players.")) {
            proj_.target_lufs = std::round(t); changed = true;
        }
        ImGui::Dummy(ImVec2(0, px(6)));
        ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted("Mute hotkeys in the master");
        ImGui::SameLine(colw - px(36) - px(38));
        if (ui::toggle("##hkmute", &proj_.hotkeys_muted)) { changed = true; engine_.set_hotkeys_muted(proj_.hotkeys_muted); }
        ImGui::Dummy(ImVec2(0, px(10)));
        ui::label_dim("True-peak ceiling");
        ImGui::PushFont(fonts.semibold); ImGui::TextUnformatted("-1.0 dBTP  (4x oversampled)"); ImGui::PopFont();
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    if (ui::card_begin("##noise", ImVec2(colw, row1), "Noise reduction", "DeepFilterNet cleans the mic when the master is rendered. Your raw mic is never changed.")) {
        ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted("Reduce background noise");
        ImGui::SameLine(colw - px(36) - px(38));
        if (!have_dfn) ImGui::BeginDisabled();
        if (ui::toggle("##dfn", &proj_.denoise)) changed = true;
        if (!have_dfn) ImGui::EndDisabled();
        ImGui::Dummy(ImVec2(0, px(8)));
        float a = float(proj_.denoise_atten_db);
        if (ui::slider_row("Strength", &a, 6.f, 40.f, "%.0f dB", colw - px(36), "Maximum noise attenuation. Higher removes more, and can sound processed.")) {
            proj_.denoise_atten_db = a; changed = true;
        }
        ImGui::Dummy(ImVec2(0, px(10)));
        if (have_dfn) ui::label_dim("DeepFilterNet found. About 10x faster than real time.");
        else { ImGui::PushStyleColor(ImGuiCol_Text, hexv(kWarn)); ui::label_dim("deep-filter.exe not found next to PodStudio, so noise reduction is off."); ImGui::PopStyleColor(); }
    }
    ui::card_end();

    ImGui::Dummy(ImVec2(0, gap - px(10)));
    const float row2 = px(300);
    if (ui::card_begin("##duck", ImVec2(colw, row2), "Ducking", "Pads set to duck dip under your voice, live and in the master.")) {
        float amt = float(proj_.duck_amount_db), thr = float(proj_.duck_threshold_db), rel = float(proj_.duck_release_ms);
        const float w = colw - px(36);
        bool d = false;
        d |= ui::slider_row("Dip", &amt, 3.f, 30.f, "%.0f dB", w);
        d |= ui::slider_row("Voice threshold", &thr, -60.f, -20.f, "%.0f dB", w);
        d |= ui::slider_row("Release", &rel, 100.f, 1500.f, "%.0f ms", w);
        if (d) { proj_.duck_amount_db = amt; proj_.duck_threshold_db = thr; proj_.duck_release_ms = rel; changed = true;
                 engine_.set_ducking(amt, thr, rel); }
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    // ---- render + result
    if (ui::card_begin("##render", ImVec2(colw, row2), "Render master", nullptr)) {
        const bool busy = rendering_.load();
        const bool have_take = file_exists(proj_.mic_path());
        if (busy) ImGui::BeginDisabled();
        if (!have_take) ImGui::BeginDisabled();
        if (ui::primary_button(busy ? "Rendering..." : "Render master", px(170), px(40))) render_async();
        if (!have_take) ImGui::EndDisabled();
        if (busy) ImGui::EndDisabled();
        ImGui::SameLine();
        if (file_exists(proj_.master_path()) && ImGui::Button("Show files", ImVec2(0, px(40)))) platform::reveal(proj_.audio_dir());
        ImGui::Dummy(ImVec2(0, px(6)));
        if (busy) {
            std::string pr; { std::lock_guard<std::mutex> l(render_mu_); pr = render_progress_; }
            ui::label_dim((pr + "...").c_str());
            ImVec2 p = ImGui::GetCursorScreenPos();
            const float w = colw - px(36), t = float(ImGui::GetTime());
            ImDrawList* dl = ImGui::GetWindowDrawList();
            dl->AddRectFilled(ImVec2(p.x, p.y + px(6)), ImVec2(p.x + w, p.y + px(10)), hex(kMuted), px(2));
            float x = std::fmod(t * 0.7f, 1.4f) - 0.2f;
            dl->AddRectFilled(ImVec2(p.x + w * std::max(0.f, x), p.y + px(6)), ImVec2(p.x + w * std::min(1.f, x + 0.25f), p.y + px(10)), hex(kText), px(2));
            ImGui::Dummy(ImVec2(0, px(14)));
        } else if (!have_take) {
            ui::label_dim("Record a take first. The master is rendered automatically when you stop.");
        } else if (have_render_result_ && render_result_.ok) {
            const MasterResult& r = render_result_;
            const bool lufs_ok = r.final_lufs && std::fabs(*r.final_lufs - proj_.target_lufs) <= 0.6;
            const bool tp_ok = r.true_peak_db <= -0.95;
            char b[64];
            ImVec2 p = ImGui::GetCursorScreenPos();
            const float cw = (colw - px(36)) / 3;
            std::snprintf(b, sizeof b, "%.1f LUFS", r.final_lufs ? *r.final_lufs : 0.0);
            ImGui::SetCursorScreenPos(p); ui::label_value("Loudness", b, hex(lufs_ok ? kOk : kWarn));
            std::snprintf(b, sizeof b, "%.1f dBTP", r.true_peak_db);
            ImGui::SetCursorScreenPos(ImVec2(p.x + cw, p.y)); ui::label_value("True peak", b, hex(tp_ok ? kOk : kWarn));
            std::snprintf(b, sizeof b, "%+.1f dB", r.gain_db);
            ImGui::SetCursorScreenPos(ImVec2(p.x + cw * 2, p.y)); ui::label_value("Gain applied", b);
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + px(52)));
            std::string flags;
            if (r.denoised) flags += "Noise reduced  -  ";
            if (r.ducked) flags += "Ducked  -  ";
            if (r.limited) flags += "Limited  -  ";
            flags += (lufs_ok && tp_ok) ? "Meets the podcast standard" : "Outside the podcast standard";
            ImGui::PushStyleColor(ImGuiCol_Text, hexv((lufs_ok && tp_ok) ? 0x86efac : 0xfcd34d));
            ui::label_dim(flags.c_str());
            ImGui::PopStyleColor();
            for (auto& n : r.notes) ui::label_dim(n.c_str());
        } else if (file_exists(proj_.master_path())) {
            ui::label_dim("A master already exists for this take. Render again after changing any setting.");
        }
    }
    ui::card_end();

    if (changed) settings_dirty_ = true;
}

}  // namespace ps
