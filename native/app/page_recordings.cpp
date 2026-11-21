#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>

#include "app.h"
#include "platform.h"
#include "theme.h"

namespace fs = std::filesystem;
using namespace theme;

namespace ps {

std::string App::session_stem_path(int which) const {
    switch (which) {
        case 0: return view_.master_path();
        case 1: return view_.mic_path();
        case 2: return view_.clean_path();
        case 3: return view_.hotkeys_path();
        default: return view_.mp3_path();
    }
}

void App::select_session(int i) {
    if (i < 0 || size_t(i) >= sessions_.size()) return;
    std::string e;
    Project p;
    if (!Project::load(sessions_[size_t(i)].path, p, e)) { toast(e); return; }
    sel_session_ = i;
    view_ = p;
    int stem = file_exists(view_.master_path()) ? 0 : file_exists(view_.mic_path()) ? 1 : -1;
    engine_.preview_close();
    peaks_for_.clear(); peaks_want_.clear(); peaks_min_.clear(); peaks_max_.clear(); peaks_dur_ = 0;
    stem_ = stem < 0 ? 0 : stem;
    if (stem >= 0) select_stem(stem_);
}

void App::select_stem(int stem) {
    const double keep = engine_.preview_position();
    const bool was_playing = engine_.preview_playing();
    stem_ = stem;
    const std::string path = session_stem_path(stem);
    if (!file_exists(path)) return;
    std::string e;
    if (!engine_.preview_open(path, e)) { toast(e); return; }
    if (keep > 0 && keep < engine_.preview_duration()) engine_.preview_seek(keep);
    if (was_playing) engine_.preview_play(true);
    peaks_want_ = path;
}

void App::page_recordings(ImVec2 avail) {
    if (sel_session_ < 0 && !sessions_.empty()) {
        int cur = 0;
        for (size_t i = 0; i < sessions_.size(); i++) if (have_proj_ && fs::path(sessions_[i].path) == fs::path(proj_.root)) cur = int(i);
        select_session(cur);
    }
    // waveform computation runs off the UI thread; at most one at a time
    if (peaks_ready_.exchange(false)) {
        if (peaks_thread_.joinable()) peaks_thread_.join();
        std::lock_guard<std::mutex> l(peaks_mu_);
        peaks_min_ = new_min_; peaks_max_ = new_max_; peaks_dur_ = new_dur_;
        peaks_loading_ = false;
    }
    if (!peaks_loading_ && !peaks_want_.empty() && peaks_want_ != peaks_for_) {
        if (peaks_thread_.joinable()) peaks_thread_.join();
        peaks_for_ = peaks_want_;
        peaks_loading_ = true;
        std::string path = peaks_for_;
        peaks_thread_ = std::thread([this, path] {
            std::vector<float> mn, mx; double dur = 0; std::string e;
            compute_peaks(path, 1600, mn, mx, dur, e);
            { std::lock_guard<std::mutex> l(peaks_mu_); new_min_ = std::move(mn); new_max_ = std::move(mx); new_dur_ = dur; }
            peaks_ready_ = true;
        });
    }
    if (engine_.preview_ended()) engine_.preview_seek(0);

    ImGuiIO& io = ImGui::GetIO();
    if (!io.WantTextInput && !ImGui::IsPopupOpen("", ImGuiPopupFlags_AnyPopupId)) {
        if (ImGui::IsKeyPressed(ImGuiKey_Space, false)) engine_.preview_play(!engine_.preview_playing());
        if (ImGui::IsKeyPressed(ImGuiKey_LeftArrow)) engine_.preview_seek(engine_.preview_position() - 5);
        if (ImGui::IsKeyPressed(ImGuiKey_RightArrow)) engine_.preview_seek(engine_.preview_position() + 5);
    }
    prev_m_.update(engine_.preview_peak_db(), io.DeltaTime);

    const float gap = px(16), listw = px(300);
    const ImVec2 origin = ImGui::GetCursorScreenPos();

    // ---- session list
    if (ui::card_begin("##slist", ImVec2(listw, avail.y), "Sessions", "Pick one to listen to it.")) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        for (size_t i = 0; i < sessions_.size(); i++) {
            auto& s = sessions_[i];
            ImGui::PushID(int(i));
            ImVec2 p = ImGui::GetCursorScreenPos();
            const float w = ImGui::GetContentRegionAvail().x, h = px(56);
            if (ImGui::InvisibleButton("##r", ImVec2(w, h))) select_session(int(i));
            const bool sel = int(i) == sel_session_;
            dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), hex(sel ? kMuted : ImGui::IsItemHovered() ? kRaised : 0x0c0c0e), px(10));
            ImGui::PushClipRect(p, ImVec2(p.x + w - px(8), p.y + h), true);
            ui::text_at(dl, fonts.semibold, ImVec2(p.x + px(12), p.y + px(9)), hex(kText), s.name.c_str());
            std::string sub = s.created + (s.duration > 0 ? "  -  " + ui::fmt_time(s.duration) : "");
            ui::text_at(dl, fonts.small, ImVec2(p.x + px(12), p.y + px(31)), hex(kDim), sub.c_str());
            ImGui::PopClipRect();
            if (s.has_master) dl->AddCircleFilled(ImVec2(p.x + w - px(14), p.y + px(16)), px(4), hex(kOk), 12);
            ImGui::PopID();
        }
        if (sessions_.empty()) ui::label_dim("No sessions yet. Record one on the Session tab.");
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    // ---- player
    const float rw = avail.x - listw - gap;
    if (sel_session_ < 0) {
        ui::card_begin("##player", ImVec2(rw, avail.y), "Recordings", nullptr);
        ui::card_end();
        return;
    }
    if (ui::card_begin("##player", ImVec2(rw, avail.y), view_.name.c_str(), view_.created.c_str())) {
        // stem chips
        static const char* names[] = {"Master", "Mic", "Cleaned mic", "Hotkeys", "MP3"};
        for (int k = 0; k < 5; k++) {
            if (!file_exists(session_stem_path(k))) continue;
            if (ui::chip(names[k], stem_ == k)) select_stem(k);
            ImGui::SameLine();
        }
        ImGui::NewLine();
        ImGui::Dummy(ImVec2(0, px(4)));

        const bool have_audio = engine_.preview_duration() > 0;
        // waveform
        ImVec2 wp = ImGui::GetCursorScreenPos();
        const float ww = ImGui::GetContentRegionAvail().x, wh = std::min(px(230), avail.y * 0.36f);
        ImGui::InvisibleButton("##wave", ImVec2(ww, wh));
        ImDrawList* dl = ImGui::GetWindowDrawList();
        dl->AddRectFilled(wp, ImVec2(wp.x + ww, wp.y + wh), hex(0x0a0a0c), px(12));
        dl->AddRect(wp, ImVec2(wp.x + ww, wp.y + wh), hex(kLine), px(12));
        const double dur = std::max(engine_.preview_duration(), peaks_dur_);
        if (have_audio && ImGui::IsItemActive()) {
            double f = std::max(0.0, std::min(1.0, double(io.MousePos.x - wp.x) / ww));
            engine_.preview_seek(f * dur);
        }
        if (have_audio && !peaks_min_.empty()) {
            const int bins = int(peaks_min_.size());
            const float mid = wp.y + wh / 2, amp = wh * 0.40f;
            const float playx = wp.x + float(engine_.preview_position() / std::max(0.001, dur)) * ww;
            dl->PushClipRect(ImVec2(wp.x + px(1), wp.y + px(1)), ImVec2(wp.x + ww - px(1), wp.y + wh - px(1)), true);
            const int cols = int(ww);
            for (int x = 0; x < cols; x++) {
                int b0 = x * bins / cols, b1 = std::max(b0 + 1, (x + 1) * bins / cols);
                float lo = 0, hi = 0;
                for (int b = b0; b < std::min(b1, bins); b++) { lo = std::min(lo, peaks_min_[size_t(b)]); hi = std::max(hi, peaks_max_[size_t(b)]); }
                const float px_ = wp.x + float(x);
                const float y0 = mid - std::min(1.f, hi) * amp, y1 = mid - std::max(-1.f, lo) * amp;
                dl->AddLine(ImVec2(px_ + 0.5f, y0), ImVec2(px_ + 0.5f, std::max(y1, y0 + 1.f)), px_ < playx ? hex(0xe4e4e7) : hex(0x52525b), 1.f);
            }
            // hotkey hits and chapters
            for (const Event& ev : view_.events) {
                if (dur <= 0) break;
                float x = wp.x + float(ev.t / dur) * ww;
                int pi = ev.pad;
                ImU32 c = (pi >= 0 && size_t(pi) < view_.pads.size()) ? parse_color(view_.pads[size_t(pi)].color.c_str(), hex(0x6ea8ff)) : hex(0x6ea8ff);
                dl->AddRectFilled(ImVec2(x - px(1), wp.y + px(2)), ImVec2(x + px(1), wp.y + px(9)), c);
            }
            for (const Chapter& ch : view_.chapters) {
                float x = wp.x + float(ch.t / std::max(0.001, dur)) * ww;
                dl->AddLine(ImVec2(x, wp.y), ImVec2(x, wp.y + wh), hex(kWarn, 0.8f), 1.f);
                dl->AddTriangleFilled(ImVec2(x, wp.y), ImVec2(x + px(9), wp.y + px(4)), ImVec2(x, wp.y + px(8)), hex(kWarn));
            }
            dl->PopClipRect();
            dl->AddLine(ImVec2(playx, wp.y), ImVec2(playx, wp.y + wh), hex(kAccent), px(2));
        } else if (peaks_loading_) {
            const char* t = "Reading waveform...";
            ImVec2 ts = ui::text_size(fonts.body, t);
            ui::text_at(dl, fonts.body, ImVec2(wp.x + (ww - ts.x) / 2, wp.y + (wh - ts.y) / 2), hex(kFaint), t);
        } else if (!have_audio) {
            const char* t = "This session has no audio yet.";
            ImVec2 ts = ui::text_size(fonts.body, t);
            ui::text_at(dl, fonts.body, ImVec2(wp.x + (ww - ts.x) / 2, wp.y + (wh - ts.y) / 2), hex(kFaint), t);
        }

        // transport
        ImGui::Dummy(ImVec2(0, px(4)));
        ImVec2 tp = ImGui::GetCursorScreenPos();
        const float bs = px(46);
        if (!have_audio) ImGui::BeginDisabled();
        if (ImGui::InvisibleButton("##play", ImVec2(bs, bs))) engine_.preview_play(!engine_.preview_playing());
        if (!have_audio) ImGui::EndDisabled();
        const ImVec2 c(tp.x + bs / 2, tp.y + bs / 2);
        dl->AddCircleFilled(c, bs / 2, hex(have_audio ? (ImGui::IsItemHovered() ? 0xffffff : kText) : kMuted), 32);
        if (engine_.preview_playing()) {
            dl->AddRectFilled(ImVec2(c.x - px(8), c.y - px(9)), ImVec2(c.x - px(2.5f), c.y + px(9)), hex(kBg), px(1.5f));
            dl->AddRectFilled(ImVec2(c.x + px(2.5f), c.y - px(9)), ImVec2(c.x + px(8), c.y + px(9)), hex(kBg), px(1.5f));
        } else {
            dl->AddTriangleFilled(ImVec2(c.x - px(6), c.y - px(10)), ImVec2(c.x - px(6), c.y + px(10)), ImVec2(c.x + px(10), c.y), hex(kBg));
        }
        ImGui::SameLine(0, px(16));
        std::string tt = ui::fmt_time(engine_.preview_position()) + " / " + ui::fmt_time(dur);
        ImGui::SetCursorScreenPos(ImVec2(tp.x + bs + px(16), tp.y + (bs - ui::text_size(fonts.mono, tt.c_str()).y) / 2));
        ImGui::PushFont(fonts.mono); ImGui::TextUnformatted(tt.c_str()); ImGui::PopFont();
        ImGui::SetCursorScreenPos(ImVec2(tp.x + px(260), tp.y + bs / 2 - px(3)));
        ui::meter_horizontal(prev_m_, px(120), px(6));
        ImGui::SetCursorScreenPos(ImVec2(tp.x + ww - px(180), tp.y + px(4)));
        if (!have_audio) ImGui::BeginDisabled();
        if (ImGui::Button("Add chapter here", ImVec2(px(180), px(38)))) {
            view_.chapters.push_back({engine_.preview_position(), "Chapter " + std::to_string(view_.chapters.size() + 1)});
            std::sort(view_.chapters.begin(), view_.chapters.end(), [](const Chapter& a, const Chapter& b) { return a.t < b.t; });
            std::string e; view_.save(e);
            if (have_proj_ && fs::path(view_.root) == fs::path(proj_.root)) proj_.chapters = view_.chapters;
        }
        if (!have_audio) ImGui::EndDisabled();
        ImGui::SetCursorScreenPos(ImVec2(tp.x, tp.y + bs + px(10)));
        ui::label_dim("Space plays and pauses. Left and Right skip 5 seconds. Click the waveform to jump.");
        ImGui::Dummy(ImVec2(0, px(8)));

        // chapters
        ImGui::PushFont(fonts.semibold); ImGui::TextUnformatted("Chapters"); ImGui::PopFont();
        ImGui::BeginChild("##chaps", ImVec2(0, 0), ImGuiChildFlags_None);
        int del = -1;
        for (size_t i = 0; i < view_.chapters.size(); i++) {
            ImGui::PushID(int(i));
            Chapter& c = view_.chapters[i];
            std::string ts = ui::fmt_time(c.t);
            if (ImGui::Button(ts.c_str(), ImVec2(px(70), px(34)))) engine_.preview_seek(c.t);
            ImGui::SameLine();
            char buf[128]; std::snprintf(buf, sizeof buf, "%s", c.title.c_str());
            ImGui::SetNextItemWidth(ImGui::GetContentRegionAvail().x - px(52));
            if (ImGui::InputText("##t", buf, sizeof buf)) { c.title = buf; }
            if (ImGui::IsItemDeactivatedAfterEdit()) { std::string e; view_.save(e); if (have_proj_ && fs::path(view_.root) == fs::path(proj_.root)) proj_.chapters = view_.chapters; }
            ImGui::SameLine();
            if (ImGui::Button("X", ImVec2(px(40), px(34)))) del = int(i);
            ImGui::PopID();
        }
        if (del >= 0) {
            view_.chapters.erase(view_.chapters.begin() + del);
            std::string e; view_.save(e);
            if (have_proj_ && fs::path(view_.root) == fs::path(proj_.root)) proj_.chapters = view_.chapters;
        }
        if (view_.chapters.empty()) ui::label_dim("No chapters yet. Chapters are uploaded with the episode.");
        ImGui::EndChild();
    }
    ui::card_end();
    (void)origin;
}

}  // namespace ps
