#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>

#include <nlohmann/json.hpp>

#include "app.h"
#include <misc/cpp/imgui_stdlib.h>
#include "platform.h"
#include "theme.h"

namespace fs = std::filesystem;
using namespace theme;
using json = nlohmann::json;

namespace ps {

namespace {

#ifndef PS_VERSION
#define PS_VERSION "dev"
#endif
const std::string kUserAgent = std::string("PodStudio/") + PS_VERSION + " (Windows desktop app)";

std::string str_of(const json& j, const char* k, const std::string& d = "") { return j.is_object() && j.contains(k) && j[k].is_string() ? j[k].get<std::string>() : d; }
int int_of(const json& j, const char* k) { return j.is_object() && j.contains(k) && j[k].is_number() ? j[k].get<int>() : 0; }

}  // namespace

void App::episode_load() {
    if (!have_proj_) return;
    json e = json::parse(proj_.episode_json, nullptr, false);
    if (e.is_discarded() || !e.is_object()) e = json::object();
    std::snprintf(ep_title_, sizeof ep_title_, "%s", str_of(e, "title", proj_.name).c_str());
    std::snprintf(ep_tags_, sizeof ep_tags_, "%s", str_of(e, "tags").c_str());
    ep_desc_ = str_of(e, "description");
    ep_number_ = int_of(e, "episode_number"); season_number_ = int_of(e, "season_number");
    ep_explicit_ = e.contains("explicit") && e["explicit"].is_boolean() && e["explicit"].get<bool>();
    ep_loaded_for_ = proj_.root;
}

void App::episode_save() {
    json e = json::parse(proj_.episode_json, nullptr, false);
    if (e.is_discarded() || !e.is_object()) e = json::object();
    e["title"] = ep_title_; e["description"] = ep_desc_; e["tags"] = ep_tags_;
    e["episode_number"] = ep_number_; e["season_number"] = season_number_; e["explicit"] = ep_explicit_;
    proj_.episode_json = e.dump();
    settings_dirty_ = true;
}

void App::buzz_run(std::function<void(buzz::Client&)> work) {
    if (buzz_busy_) return;
    if (buzz_thread_.joinable()) buzz_thread_.join();
    buzz_busy_ = true; buzz_frac_ = -1.f;
    { std::lock_guard<std::mutex> l(buzz_mu_); buzz_error_.clear(); }
    const std::string token = buzz_token_;
    buzz_thread_ = std::thread([this, token, work = std::move(work)] {
        try { buzz::Client c(token, *http_, kUserAgent); work(c); }
        catch (const buzz::Error& e) { std::lock_guard<std::mutex> l(buzz_mu_); buzz_error_ = e.what(); buzz_after_ = nullptr; }
        catch (const std::exception& e) { std::lock_guard<std::mutex> l(buzz_mu_); buzz_error_ = e.what(); buzz_after_ = nullptr; }
        buzz_busy_ = false; buzz_done_ = true;
    });
}

void App::buzz_connect(const std::string& token, bool remember) {
    buzz_token_ = token;
    buzz_run([this, remember, token](buzz::Client& c) {
        { std::lock_guard<std::mutex> l(buzz_mu_); buzz_status_ = "Checking your token..."; }
        auto pods = c.podcasts();
        std::lock_guard<std::mutex> l(buzz_mu_);
        buzz_after_ = [this, pods, remember, token] {
            buzz_podcasts_ = pods; buzz_connected_ = true;
            json b = json::parse(proj_.buzz_json, nullptr, false);
            long long want = b.is_object() && b.contains("podcast_id") && b["podcast_id"].is_number() ? b["podcast_id"].get<long long>() : 0;
            buzz_podcast_idx_ = 0;
            for (size_t i = 0; i < pods.size(); i++) if (pods[i].id == want) buzz_podcast_idx_ = int(i);
            if (remember && !credstore::store(token)) toast("Connected, but the credential store didn't keep the token.");
            buzz_status_ = pods.empty() ? "Connected, but this account has no podcasts." : "Connected.";
        };
    });
}

void App::buzz_upload() {
    if (buzz_podcasts_.empty() || !have_proj_) return;
    episode_save();
    save();
    const Project snap = proj_;
    const long long pid = buzz_podcasts_[size_t(std::min<size_t>(size_t(buzz_podcast_idx_), buzz_podcasts_.size() - 1))].id;
    buzz_run([this, snap, pid](buzz::Client& c) {
        auto say = [&](const std::string& s) { std::lock_guard<std::mutex> l(buzz_mu_); buzz_status_ = s; };
        json ep = json::parse(snap.episode_json, nullptr, false);
        if (!ep.is_object()) ep = json::object();
        json bz = json::parse(snap.buzz_json, nullptr, false);
        if (!bz.is_object()) bz = json::object();
        const bool expl = ep.value("explicit", false);
        json fields = {{"description", ep.value("description", "")}, {"tags", ep.value("tags", "")}, {"explicit", expl}};
        if (int_of(ep, "episode_number")) fields["episode_number"] = int_of(ep, "episode_number");
        if (int_of(ep, "season_number")) fields["season_number"] = int_of(ep, "season_number");
        const std::string title = ep.value("title", snap.name).empty() ? snap.name : ep.value("title", snap.name);

        long long eid = bz.value("episode_id", 0LL);
        if (bz.value("podcast_id", 0LL) != pid) eid = 0;                       // a different podcast: start a new draft there
        say(eid ? "Updating your draft..." : "Creating a private draft...");
        if (eid) { fields["title"] = title; c.update_episode(pid, eid, fields); }
        else eid = c.create_episode(pid, title, fields).value("id", 0LL);
        if (!eid) throw buzz::Error("Buzzsprout didn't return an episode id.");
        bz["podcast_id"] = pid; bz["episode_id"] = eid; bz["public"] = false;

        if (!snap.art.empty() && file_exists(snap.root + "/" + snap.art)) {
            std::error_code ec;
            const std::string sig = std::to_string(fs::file_size(snap.root + "/" + snap.art, ec)) + ":" + std::to_string(fs::last_write_time(snap.root + "/" + snap.art, ec).time_since_epoch().count());
            if (bz.value("art_sig", "") != sig) {                              // only when it changed
                say("Uploading cover art...");
                c.set_artwork(pid, eid, snap.root + "/" + snap.art, expl);
                bz["art_sig"] = sig;
            }
        }
        say("Uploading the MP3...");
        c.upload_audio(pid, eid, snap.mp3_path(), [this](uint64_t a, uint64_t b) { buzz_frac_ = b ? float(double(a) / double(b)) : -1.f; });
        buzz_frac_ = -1.f;
        say("Buzzsprout is processing the audio...");
        json done = c.wait_until_encoded(pid, eid, 1800, 5);
        std::vector<std::string> notes;
        double dur = done.value("duration", 0.0);
        auto chs = normalize_chapters(snap.chapters, dur, notes);
        say("Setting chapters...");
        c.put_chapters(pid, eid, chs);
        std::lock_guard<std::mutex> l(buzz_mu_);
        buzz_status_ = "Draft ready. It is private: nothing is public until you press Publish.";
        buzz_after_ = [this, bz, notes] { proj_.buzz_json = bz.dump(); chapter_notes_ = notes; save(); };
    });
}

void App::buzz_publish() {
    json bz = json::parse(proj_.buzz_json, nullptr, false);
    json ep = json::parse(proj_.episode_json, nullptr, false);
    if (!bz.is_object() || !bz.contains("episode_id")) return;
    const long long pid = bz.value("podcast_id", 0LL), eid = bz.value("episode_id", 0LL);
    const bool expl = ep.is_object() && ep.value("explicit", false);
    buzz_run([this, pid, eid, expl, bz](buzz::Client& c) mutable {
        { std::lock_guard<std::mutex> l(buzz_mu_); buzz_status_ = "Publishing..."; }
        c.publish(pid, eid, expl);
        std::lock_guard<std::mutex> l(buzz_mu_);
        buzz_status_ = "Published. The episode is public.";
        bz["public"] = true;
        buzz_after_ = [this, bz] { proj_.buzz_json = bz.dump(); save(); };
    });
}

void App::page_publish(ImVec2 avail) {
    if (!have_proj_) return;
    if (ep_loaded_for_ != proj_.root) episode_load();
    if (!buzz_connected_ && !buzz_busy_ && !buzz_token_.empty() && buzz_status_.empty()) buzz_connect(buzz_token_, false);   // reconnect with the saved token
    if (in_demo_mode() && !buzz_connected_ && !buzz_busy_ && buzz_status_.empty()) buzz_connect("demo-token", false);

    const float gap = px(16);
    const float colw = (avail.x - gap) / 2;
    json bz = json::parse(proj_.buzz_json, nullptr, false);
    const long long eid = bz.is_object() ? bz.value("episode_id", 0LL) : 0LL, pid = bz.is_object() ? bz.value("podcast_id", 0LL) : 0LL;
    const bool is_public = bz.is_object() && bz.value("public", false);
    const bool busy = buzz_busy_.load();
    const bool have_mp3 = file_exists(proj_.mp3_path());
    std::string status, error;
    { std::lock_guard<std::mutex> l(buzz_mu_); status = buzz_status_; error = buzz_error_; }

    ImGui::BeginChild("##pubscroll", avail, ImGuiChildFlags_None);
    const float W = avail.x - px(14), cw = (W - gap) / 2;
    (void)colw;
    const float card_h = px(540);

    // ---- episode
    if (ui::card_begin("##episode", ImVec2(cw, card_h), "Episode", "Saved with the session.")) {
        const float fw = cw - px(36);
        ui::label_dim("Title");
        ImGui::SetNextItemWidth(fw);
        if (ImGui::InputText("##title", ep_title_, sizeof ep_title_)) episode_save();
        ui::label_dim("Description");
        if (ImGui::InputTextMultiline("##desc", &ep_desc_, ImVec2(fw, px(110)))) episode_save();
        ui::label_dim("Tags (comma separated)");
        ImGui::SetNextItemWidth(fw);
        if (ImGui::InputText("##tags", ep_tags_, sizeof ep_tags_)) episode_save();
        ImGui::Dummy(ImVec2(0, px(2)));
        // Episode number and Season side by side: labels on one line, inputs on the next, so they line up exactly.
        {
            const ImVec2 p = ImGui::GetCursorScreenPos();
            const float col2 = fw * 0.5f + px(8);
            ImGui::SetCursorScreenPos(p);
            ui::label_dim("Episode number");
            ImGui::SetCursorScreenPos(ImVec2(p.x + col2, p.y));
            ui::label_dim("Season");
            const float y = p.y + px(20);
            ImGui::SetCursorScreenPos(ImVec2(p.x, y));
            ImGui::SetNextItemWidth(fw * 0.5f - px(8));
            if (ImGui::InputInt("##epn", &ep_number_, 1, 5)) { ep_number_ = std::max(0, ep_number_); episode_save(); }
            ImGui::SetCursorScreenPos(ImVec2(p.x + col2, y));
            ImGui::SetNextItemWidth(fw * 0.5f - px(8));
            if (ImGui::InputInt("##sn", &season_number_, 1, 5)) { season_number_ = std::max(0, season_number_); episode_save(); }
            ui::label_dim("0 leaves a number blank.");
        }
        ImGui::Dummy(ImVec2(0, px(10)));
        {
            const ImVec2 p = ImGui::GetCursorScreenPos();
            ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted("Explicit");
            ImGui::SetCursorScreenPos(ImVec2(p.x + fw - px(38), p.y));
            if (ui::toggle("##expl", &ep_explicit_)) episode_save();
        }
        ImGui::Dummy(ImVec2(0, px(10)));
        char b[80]; std::snprintf(b, sizeof b, "%zu chapter(s) will be uploaded with the episode.", proj_.chapters.size());
        ui::label_dim(b);
    }
    ui::card_end();
    ImGui::SameLine(0, gap);

    // ---- buzzsprout
    ImGui::BeginGroup();
    if (ui::card_begin("##account", ImVec2(cw, px(200)), "Buzzsprout", buzz_connected_ ? "Connected. Your token is kept in Windows Credential Manager." : "Paste your API token (Buzzsprout: Profile, then API).")) {
        const float fw = cw - px(36);
        if (!buzz_connected_) {
            ImGui::SetNextItemWidth(fw - px(110));
            ImGui::InputTextWithHint("##tok", "API token", buzz_token_input_, sizeof buzz_token_input_, ImGuiInputTextFlags_Password);
            ImGui::SameLine();
            if (busy) ImGui::BeginDisabled();
            if (ui::primary_button("Connect", px(98), px(38)) && buzz_token_input_[0]) { buzz_connect(buzz_token_input_, true); std::fill(std::begin(buzz_token_input_), std::end(buzz_token_input_), 0); }
            if (busy) ImGui::EndDisabled();
        } else {
            ui::label_dim("Podcast");
            std::string cur = buzz_podcasts_.empty() ? "(none)" : buzz_podcasts_[size_t(buzz_podcast_idx_)].title;
            ImGui::SetNextItemWidth(fw);
            if (ImGui::BeginCombo("##pod", cur.c_str())) {
                for (size_t i = 0; i < buzz_podcasts_.size(); i++)
                    if (ImGui::Selectable(buzz_podcasts_[i].title.c_str(), int(i) == buzz_podcast_idx_)) buzz_podcast_idx_ = int(i);
                ImGui::EndCombo();
            }
            ImGui::Dummy(ImVec2(0, px(6)));
            if (ImGui::Button("Disconnect", ImVec2(px(120), px(34)))) { credstore::clear(); buzz_token_.clear(); buzz_connected_ = false; buzz_podcasts_.clear(); buzz_status_.clear(); }
        }
        if (!error.empty() && !buzz_connected_) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(0xfca5a5)); ImGui::TextWrapped("%s", error.c_str()); ImGui::PopStyleColor(); }
    }
    ui::card_end();
    ImGui::Dummy(ImVec2(0, px(2)));

    // ---- cover art
    if (ui::card_begin("##art", ImVec2(cw, card_h - px(216)), "Cover art", "A square JPEG or PNG, 1400 to 3000 px.")) {
        if (ui::primary_button(proj_.art.empty() ? "Choose an image..." : "Change image...", 0, px(36))) {
            std::string f = platform::open_file_dialog("Choose cover art", "Images", "*.jpg;*.jpeg;*.png");
            if (!f.empty()) {
                std::error_code ec;
                std::string ext = fs::path(f).extension().string();
                for (char& c : ext) c = char(std::tolower((unsigned char)c));
                const std::string name = "cover" + ext;
                make_dirs(proj_.root);
                fs::copy_file(f, proj_.root + "/" + name, fs::copy_options::overwrite_existing, ec);
                if (ec) toast("Couldn't copy the image: " + ec.message()); else { proj_.art = name; settings_dirty_ = true; }
            }
        }
        if (!proj_.art.empty()) {
            int w = 0, h = 0;
            const std::string p = proj_.root + "/" + proj_.art;
            ImGui::SameLine(); ImGui::AlignTextToFramePadding(); ui::label_dim(proj_.art.c_str());
            std::error_code ec; const auto sz = fs::exists(p, ec) ? fs::file_size(p, ec) : 0;
            if (image_size(p, w, h)) {
                char b[120]; std::snprintf(b, sizeof b, "%d x %d px, %.1f MB", w, h, double(sz) / 1e6);
                ui::label_dim(b);
                if (w != h) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(kWarn)); ui::label_dim("It isn't square. Podcast apps crop to a square."); ImGui::PopStyleColor(); }
                else if (w < 1400 || w > 3000) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(kWarn)); ui::label_dim("Apps want 1400 to 3000 px."); ImGui::PopStyleColor(); }
                else { ImGui::PushStyleColor(ImGuiCol_Text, hexv(0x86efac)); ui::label_dim("Good size."); ImGui::PopStyleColor(); }
            } else ui::label_dim("Couldn't read the image size.");
        } else ui::label_dim("Optional. Uploaded only when it changes.");
    }
    ui::card_end();
    ImGui::EndGroup();

    // ---- upload
    ImGui::Dummy(ImVec2(0, px(6)));
    if (ui::card_begin("##upload", ImVec2(W, px(190)), "Upload", "Uploads the MP3 as a private draft. Nothing goes public until you press Publish.")) {
        const bool ready = buzz_connected_ && !buzz_podcasts_.empty() && have_mp3 && !busy;
        if (!ready) ImGui::BeginDisabled();
        if (ui::primary_button(eid ? "Update draft" : "Upload draft", px(170), px(40))) buzz_upload();
        if (!ready) ImGui::EndDisabled();
        if (eid) {
            ImGui::SameLine();
            if (ImGui::Button("Open in Buzzsprout", ImVec2(0, px(40)))) platform::open_url(buzz::episode_url(pid, eid));
            ImGui::SameLine();
            if (!is_public) {
                if (busy) ImGui::BeginDisabled();
                if (ui::danger_button("Publish...", px(130), px(40))) buzz_confirm_publish_ = true;
                if (busy) ImGui::EndDisabled();
            } else { ImGui::AlignTextToFramePadding(); ImGui::PushStyleColor(ImGuiCol_Text, hexv(0x86efac)); ui::label_dim("Public"); ImGui::PopStyleColor(); }
        }
        ImGui::Dummy(ImVec2(0, px(6)));
        if (!have_mp3) ui::label_dim("Export an MP3 on the Mix tab first.");
        else if (!buzz_connected_) ui::label_dim("Connect your Buzzsprout account first.");
        if (busy) {
            ui::label_dim(status.c_str());
            ImVec2 p = ImGui::GetCursorScreenPos();
            const float w = W - px(36), t = float(ImGui::GetTime()), f = buzz_frac_.load();
            ImDrawList* dl = ImGui::GetWindowDrawList();
            dl->AddRectFilled(ImVec2(p.x, p.y + px(4)), ImVec2(p.x + w, p.y + px(9)), hex(kMuted), px(2));
            if (f >= 0.f) dl->AddRectFilled(ImVec2(p.x, p.y + px(4)), ImVec2(p.x + w * f, p.y + px(9)), hex(kText), px(2));
            else { float x = std::fmod(t * 0.7f, 1.4f) - 0.2f; dl->AddRectFilled(ImVec2(p.x + w * std::max(0.f, x), p.y + px(4)), ImVec2(p.x + w * std::min(1.f, x + 0.25f), p.y + px(9)), hex(kText), px(2)); }
            ImGui::Dummy(ImVec2(0, px(14)));
        } else {
            if (!error.empty() && buzz_connected_) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(0xfca5a5)); ImGui::TextWrapped("%s", error.c_str()); ImGui::PopStyleColor(); }
            else if (!status.empty() && status != "Connected.") ui::label_dim(status.c_str());
            for (auto& n : chapter_notes_) ui::label_dim(n.c_str());
        }
    }
    ui::card_end();
    ImGui::EndChild();

    // publishing is a separate, confirmed step
    if (buzz_confirm_publish_) { ImGui::OpenPopup("Publish this episode?"); buzz_confirm_publish_ = false; }
    ImGui::SetNextWindowSize(ImVec2(px(460), 0));
    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.4f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(24), px(22)));
    if (ImGui::BeginPopupModal("Publish this episode?", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::PushFont(fonts.title); ImGui::TextUnformatted("Publish this episode?"); ImGui::PopFont();
        ImGui::Dummy(ImVec2(0, px(4)));
        ImGui::PushTextWrapPos(px(410));
        ImGui::TextWrapped("This makes \"%s\" public on Buzzsprout. Listeners' apps will see it.", ep_title_);
        ImGui::PopTextWrapPos();
        ImGui::Dummy(ImVec2(0, px(10)));
        if (ui::danger_button("Publish", px(120), px(38))) { buzz_publish(); ImGui::CloseCurrentPopup(); }
        ImGui::SameLine();
        if (ImGui::Button("Cancel", ImVec2(px(100), px(38)))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar();
}

}  // namespace ps
