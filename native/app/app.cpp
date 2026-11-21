#include "app.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "denoise.h"
#include "mp3.h"
#include "platform.h"
#include "theme.h"

namespace fs = std::filesystem;
using namespace theme;

namespace ps {

namespace {

ImGuiKey key_for(const std::string& k) {
    if (k.size() != 1) return ImGuiKey_None;
    char c = char(std::tolower((unsigned char)k[0]));
    if (c >= '0' && c <= '9') return ImGuiKey(ImGuiKey_0 + (c - '0'));
    if (c >= 'a' && c <= 'z') return ImGuiKey(ImGuiKey_A + (c - 'a'));
    return ImGuiKey_None;
}

const char* mode_name(const std::string& m) {
    return m == "momentary" ? "Hold" : m == "toggle" ? "Toggle" : m == "loop" ? "Loop" : "One-shot";
}

std::string stamp() {
    std::time_t t = std::time(nullptr);
    char b[48];
    std::strftime(b, sizeof b, "%b %d, %H:%M", std::localtime(&t));
    return b;
}

}  // namespace

App::App() = default;

App::~App() {
    if (engine_.recording()) {                           // never lose a take because the window was closed
        size_t frames = engine_.stop_recording();
        if (have_proj_) { proj_.mic_duration = double(frames) / kRate; proj_.recording = false; std::string e; proj_.save(e); }
    }
    if (mic_thread_.joinable()) mic_thread_.join();
    if (buzz_thread_.joinable()) buzz_thread_.join();
    if (update_thread_.joinable()) update_thread_.join();
    if (render_thread_.joinable()) render_thread_.join();
    if (mp3_thread_.joinable()) mp3_thread_.join();
    if (peaks_thread_.joinable()) peaks_thread_.join();
    if (have_proj_) { script_save(); }
}

void App::init() {
    http_ = make_http();
    buzz_token_ = credstore::load();
    engine_ok_ = engine_.init(audio_error_);
    demo_ = std::getenv("PODSTUDIO_DEMO") != nullptr;
    root_ = default_root();
    make_dirs(root_);
    refresh_sessions();
    for (auto& si : sessions_) if (si.needs_recovery && recover_path_.empty()) { recover_path_ = si.path; recover_name_ = si.name; open_recover_popup_ = true; }
    if (!sessions_.empty()) open_session(sessions_.front().path);
    else new_session("Session " + stamp());
    if (std::getenv("PODSTUDIO_DEMO_RENDER") && have_proj_) render_async();      // previews: show a finished render
    if (demo_ && engine_ok_) { std::string e; engine_.open_demo(e); source_name_ = "Demo signal"; have_cur_input_ = true; }
}

void App::toast(const std::string& m) { toast_msg_ = m; toast_until_ = now_ + 3.2; }

// ------------------------------------------------------------------------------------------------ sessions
void App::save() {
    if (!have_proj_) return;
    std::string e;
    if (!proj_.save(e)) toast("Couldn't save the session: " + e);
}

void App::refresh_sessions() {
    sessions_.clear();
    for (auto& path : list_sessions(root_)) {
        Project p; std::string e;
        if (!Project::load(path, p, e)) continue;
        SessionInfo s;
        s.path = path; s.name = p.name; s.created = p.created; s.duration = p.mic_duration;
        s.has_master = file_exists(p.master_path()); s.has_mic = file_exists(p.mic_path()); s.needs_recovery = p.recording;
        sessions_.push_back(s);
    }
}

void App::open_session(const std::string& path) {
    if (engine_.recording()) { toast("Finish your recording first."); return; }
    Project p; std::string e;
    if (!Project::load(path, p, e)) { toast(e); return; }
    if (have_proj_) script_save();
    proj_ = p; have_proj_ = true;
    engine_.stop_all(); open_events_.clear();
    engine_.set_mic_fader_db(float(proj_.mic_db)); engine_.set_hotkeys_fader_db(float(proj_.hotkeys_db));
    engine_.set_hotkeys_muted(proj_.hotkeys_muted);
    engine_.set_ducking(proj_.duck_amount_db, proj_.duck_threshold_db, proj_.duck_release_ms);
    have_render_result_ = false;
    script_load();
}

void App::new_session(const std::string& name) {
    if (engine_.recording()) { toast("Finish your recording first."); return; }
    if (have_proj_) script_save();
    proj_ = Project::create(name, root_); have_proj_ = true;
    engine_.stop_all(); open_events_.clear();
    engine_.set_mic_fader_db(0); engine_.set_hotkeys_fader_db(0); engine_.set_hotkeys_muted(false);
    engine_.set_ducking(proj_.duck_amount_db, proj_.duck_threshold_db, proj_.duck_release_ms);
    have_render_result_ = false; script_.clear(); script_dirty_ = false;
    refresh_sessions();
}

void App::next_take() {
    Project old = proj_;
    script_save();
    std::string script = script_;
    Project np = Project::create(old.name + " (next take)", root_);
    np.pads = old.pads;
    np.mic_db = old.mic_db; np.hotkeys_db = old.hotkeys_db; np.hotkeys_muted = old.hotkeys_muted; np.target_lufs = old.target_lufs;
    np.denoise = old.denoise; np.denoise_atten_db = old.denoise_atten_db;
    np.duck_amount_db = old.duck_amount_db; np.duck_threshold_db = old.duck_threshold_db; np.duck_release_ms = old.duck_release_ms;
    std::error_code ec;
    for (auto& f : fs::directory_iterator(old.clips_dir(), ec)) fs::copy_file(f.path(), fs::path(np.clips_dir()) / f.path().filename(), fs::copy_options::skip_existing, ec);
    proj_ = np; have_proj_ = true;
    script_ = script; script_dirty_ = true;
    open_events_.clear();
    save(); script_save(); refresh_sessions();
}

// ------------------------------------------------------------------------------------------------ input
void App::poll_inputs() {
    if (now_ < next_poll_) return;
    next_poll_ = now_ + 2.0;
    if (!engine_ok_ || demo_) return;
    inputs_ = engine_.list_inputs();
    int idx = -1;
    for (size_t i = 0; i < inputs_.size(); i++) if (inputs_[i].podmic) { idx = int(i); break; }
    podmic_idx_ = idx;
    if (idx >= 0 && !engine_.input_open()) {
        std::string e;
        if (engine_.open_input(inputs_[size_t(idx)], e)) { source_name_ = inputs_[size_t(idx)].name; cur_input_ = inputs_[size_t(idx)]; have_cur_input_ = true; }
        else audio_error_ = e;
    } else if (idx < 0 && engine_.input_open() && !engine_.recording() && source_name_.find("PodMic") != std::string::npos) {
        engine_.close_input(); source_name_.clear();
    }
}

// ------------------------------------------------------------------------------------------------ PodMic controls
void App::mic_write(const char* what, const std::function<void(podmic::Mic&)>& fn) {
    if (mic_state_ != 2 || !mic_link_) return;
    try { fn(mic_link_->mic()); }
    catch (const podmic::Error& e) {
        toast(std::string("Mic control: ") + e.what());
        (void)what;
        mic_link_.reset(); mic_state_ = 3; mic_next_try_ = now_ + 3.0;
    }
}

void App::mic_queue(const std::string& key, std::function<void(podmic::Mic&)> fn) {
    mic_pending_[key] = {now_ + 0.15, std::move(fn)};         // slider drags send one write after they settle
}

void App::mic_sync() {
    if (mic_state_ != 2 || !mic_link_) return;
    mic_write("read", [&](podmic::Mic& m) {
        auto st = m.read_state();
        auto flag = [&](const char* k, const std::optional<bool>& v) { if (v) mic_flags_[k] = *v; };
        flag("hpf", st.hpf); flag("mute", st.mute); flag("monitoring", st.monitoring); flag("processing", st.processing);
        flag("advanced", st.advanced); flag("comp_on", st.comp_on); flag("gate_on", st.gate_on);
        flag("exciter_on", st.exciter_on); flag("bottom_on", st.bottom_on);
        if (st.monitor_mix) mic_vals_["monitor_mix"] = float(*st.monitor_mix);
        if (st.depth) mic_vals_["depth"] = float(*st.depth);
        if (st.sparkle) mic_vals_["sparkle"] = float(*st.sparkle);
        if (st.punch) mic_vals_["punch"] = float(*st.punch);
        static const char* fields[][2] = {{"comp", "threshold"}, {"comp", "ratio"}, {"comp", "attack"}, {"comp", "release"}, {"comp", "gain"},
            {"gate", "threshold"}, {"gate", "range"}, {"gate", "attack"}, {"gate", "hold"}, {"gate", "release"}, {"gate", "hysteresis"},
            {"exciter", "harmonics"}, {"exciter", "tune"}, {"bottom", "drive"}, {"bottom", "tune"}};
        for (auto& f : fields) {
            auto v = m.read_field(f[0], f[1]);
            mic_vals_[std::string(f[0]) + "." + f[1]] = v ? float(*v) : float(podmic::default_value(f[0], f[1]));
        }
    });
}

void App::mic_poll() {
    // a connection attempt finished?
    if (mic_state_ == 1 && !mic_thread_.joinable()) mic_state_ = 0;
    if (mic_thread_.joinable() && mic_state_ != 1) {
        mic_thread_.join();
    }
    {
        std::lock_guard<std::mutex> l(mic_mu_);
        if (mic_new_link_) { mic_link_ = std::move(mic_new_link_); mic_state_ = 2; mic_sync(); }
    }
    const bool audio_present = engine_.input_open() && have_cur_input_ ? true : (engine_.input_open() && demo_);
    const bool want = audio_present || mic_hid_present();
    if (!want && mic_state_ != 1) { if (mic_link_) { mic_link_.reset(); } mic_state_ = 0; }
    if (want && (mic_state_ == 0 || mic_state_ == 3) && !mic_link_ && now_ >= mic_next_try_ && !mic_thread_.joinable()) {
        mic_state_ = 1;
        mic_next_try_ = now_ + 3.0;
        mic_thread_ = std::thread([this] {
            std::string err;
            auto link = connect_mic(err);
            std::lock_guard<std::mutex> l(mic_mu_);
            if (link) { mic_new_link_ = std::move(link); mic_error_.clear(); }
            else { mic_error_ = err; mic_state_ = 3; }
        });
    }
    // debounced writes
    for (auto it = mic_pending_.begin(); it != mic_pending_.end();) {
        if (now_ >= it->second.first) { auto fn = std::move(it->second.second); it = mic_pending_.erase(it); mic_write("write", fn); }
        else ++it;
    }
    // input gain follows the system mixer
    if (have_cur_input_ && engine_.input_open() && now_ >= gain_next_ && mic_pending_.find("gain") == mic_pending_.end()) {
        gain_next_ = now_ + 2.0;
        GainRange r; float db;
        gain_ok_ = gain_range(cur_input_, r) && gain_get(cur_input_, db);
        if (gain_ok_) { gain_range_ = r; gain_db_ = db; }
    }
}

// ------------------------------------------------------------------------------------------------ clips and pads
const Clip* App::get_clip(const std::string& file) {
    const std::string path = proj_.clips_dir() + "/" + file;
    auto it = clips_.find(path);
    if (it != clips_.end()) return it->second.get();
    Audio a; std::string e;
    if (!decode_file(path, a, e)) { toast(e); return nullptr; }
    auto c = std::make_unique<Clip>();
    c->path = path; c->data = std::move(a.data);
    Clip* raw = c.get();
    clips_[path] = std::move(c);
    return raw;
}

double App::pad_gain(Pad& p) {
    if (!p.norm_db) {
        const Clip* c = get_clip(p.clip);
        if (c) { Audio a; a.channels = 2; a.data = c->data; p.norm_db = clip_gain_db(a); }
        else p.norm_db = 0.0;
        save();
    }
    return *p.norm_db + p.gain_db;
}

void App::assign_sound(int i, const std::string& src) {
    Audio a; std::string e;
    if (!decode_file(src, a, e)) { toast(e); return; }
    fs::path stem = fs::path(src).stem();
    std::string base;
    for (char c : stem.string()) base += (std::isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.') ? c : '-';
    if (base.empty()) base = "sound";
    fs::path dst = fs::path(proj_.clips_dir()) / (base + ".wav");
    for (int n = 2; fs::exists(dst); n++) dst = fs::path(proj_.clips_dir()) / (base + "-" + std::to_string(n) + ".wav");
    make_dirs(proj_.clips_dir());
    if (!write_wav24(dst.string(), a, e)) { toast(e); return; }
    Pad& p = proj_.pads[size_t(i)];
    p.clip = dst.filename().string();
    if (p.label.empty()) p.label = stem.string().substr(0, 40);
    p.norm_db = clip_gain_db(a);                         // level-match so it sits with the voice
    clips_.erase(dst.string());
    save();
}

void App::pad_press(int i) {
    if (i < 0 || size_t(i) >= proj_.pads.size()) return;
    Pad& pad = proj_.pads[size_t(i)];
    flash_[i] = 1.f;
    if (pad.clip.empty()) { edit_pad_ = i; open_edit_popup_ = true; return; }
    if (!file_exists(proj_.clips_dir() + "/" + pad.clip)) { toast("Missing sound: " + pad.clip); return; }
    if ((pad.mode == "toggle" || pad.mode == "loop") && engine_.handle_active(i)) { stop_pad(i); return; }
    const double gain = pad_gain(pad);
    if (!proj_.hotkeys_muted) engine_.play(get_clip(pad.clip), gain, pad.mode == "loop", pad.duck, i);
    if (engine_.recording()) {
        Event ev;
        ev.t = engine_.rec_seconds(); ev.pad = i; ev.clip = pad.clip; ev.gain_db = gain; ev.duck = pad.duck; ev.loop = pad.mode == "loop";
        proj_.events.push_back(ev);
        journal_.hit(proj_.events.size() - 1, ev);
        if (pad.mode != "once") open_events_[i] = proj_.events.size() - 1;      // its length is known when it ends
    }
}

void App::pad_release(int i) {
    if (i < 0 || size_t(i) >= proj_.pads.size()) return;
    if (proj_.pads[size_t(i)].mode == "momentary" && engine_.handle_active(i)) stop_pad(i);
}

void App::stop_pad(int i) {
    engine_.stop_handle(i);
    auto it = open_events_.find(i);
    if (it != open_events_.end()) {
        if (engine_.recording() && it->second < proj_.events.size()) {
            Event& ev = proj_.events[it->second];
            ev.dur = std::max(0.0, engine_.rec_seconds() - ev.t);
            journal_.end(it->second, *ev.dur);
        }
        open_events_.erase(it);
    }
}

void App::handle_keys() {
    ImGuiIO& io = ImGui::GetIO();
    if (io.WantTextInput || !have_proj_ || page_ != kSession) return;
    if (ImGui::IsPopupOpen("", ImGuiPopupFlags_AnyPopupId)) return;
    for (size_t i = 0; i < proj_.pads.size() && i < 16; i++) {
        ImGuiKey k = key_for(proj_.pads[i].key);
        if (k == ImGuiKey_None || io.KeyCtrl || io.KeyAlt) continue;
        if (ImGui::IsKeyPressed(k, false)) pad_press(int(i));
        if (ImGui::IsKeyReleased(k)) pad_release(int(i));
    }
}

// ------------------------------------------------------------------------------------------------ recording
void App::start_record() {
    if (!engine_.input_open()) { toast("Connect your PodMic USB first."); return; }
    if (rendering_) { toast("Wait for the master to finish rendering."); return; }
    if (file_exists(proj_.mic_path())) next_take();               // never record over an existing take
    proj_.events.clear(); open_events_.clear();
    proj_.recording = true;
    save();
    std::string e;
    if (!engine_.start_recording(proj_.mic_path(), e)) { proj_.recording = false; toast(e); return; }
    rec_start_wall_ = now_;
    journal_.start(proj_.journal_path());
    if (prompter_with_rec_) { prompter_ = true; prompter_run_ = true; prompter_scroll_ = 0; }
}

void App::stop_record() {
    const size_t frames = engine_.stop_recording();
    const double t_end = double(frames) / kRate;
    engine_.stop_all();
    for (auto& kv : open_events_)
        if (kv.second < proj_.events.size()) proj_.events[kv.second].dur = std::max(0.0, t_end - proj_.events[kv.second].t);
    open_events_.clear();
    proj_.mic_duration = t_end; proj_.recording = false;
    save();
    journal_.discard();                                  // the take finished normally: its hits are in project.json
    prompter_run_ = false;
    refresh_sessions();
    if (t_end < 0.5) { toast("That take was too short to keep."); return; }
    render_async();
}

// ------------------------------------------------------------------------------------------------ render
void App::render_async() {
    if (rendering_) return;
    if (render_thread_.joinable()) render_thread_.join();
    if (!file_exists(proj_.mic_path())) { toast("Record something first."); return; }
    rendering_ = true; have_render_result_ = false;
    Project snap = proj_;
    { std::lock_guard<std::mutex> l(render_mu_); render_progress_ = "Starting"; }
    render_thread_ = std::thread([this, snap]() mutable {
        MasterResult r;
        auto progress = [this](const std::string& m) { std::lock_guard<std::mutex> l(render_mu_); render_progress_ = m; };
        DenoiseFn dfn;
        if (snap.denoise && denoise::available()) {
            dfn = [&](const std::string& src, const std::string& dst, double atten) -> std::string {
                char key[96];
                std::error_code ec;
                auto mt = fs::last_write_time(src, ec).time_since_epoch().count();
                std::snprintf(key, sizeof key, "%lld:%.1f", (long long)mt, atten);
                if (snap.clean_key == key && file_exists(dst)) return "";           // same take and strength: reuse the cleaned copy
                std::string e = denoise::run(src, dst, atten);
                if (e.empty()) snap.clean_key = key;
                return e;
            };
        }
        r = mix_master(snap, dfn, progress);
        { std::lock_guard<std::mutex> l(render_mu_); render_result_ = r; render_progress_ = snap.clean_key; }
        rendering_ = false;
    });
}

void App::export_mp3_async() {
    if (mp3_busy_ || rendering_) return;
    if (mp3_thread_.joinable()) mp3_thread_.join();
    if (!file_exists(proj_.master_path())) { toast("Render the master first."); return; }
    if (!mp3::available()) { toast("MP3 export isn't available in this build."); return; }
    mp3_busy_ = true; mp3_done_ = false;
    const Project snap = proj_;
    mp3_thread_ = std::thread([this, snap] {
        std::string err;
        Audio master;
        double lufs = 0, tp = 0; bool retried = false;
        if (read_stereo(snap.master_path(), master, err)) {
            // Lossy encoding can push true peaks up a little: check the decoded file and, if it lands above the ceiling,
            // re-limit the master with extra headroom and encode once more.
            for (int attempt = 0; attempt < 2 && err.empty(); attempt++) {
                const std::string part = snap.mp3_path() + ".part";
                err = mp3::encode(master, part, 128);
                if (!err.empty()) break;
                std::error_code ec; fs::remove(snap.mp3_path(), ec); fs::rename(part, snap.mp3_path(), ec);
                Audio dec;
                if (!decode_file(snap.mp3_path(), dec, err)) break;
                tp = true_peak_db(dec);
                auto l = integrated_loudness(dec);
                lufs = l ? *l : 0.0;
                if (tp <= kTrueCeilingDb + 0.05 || attempt == 1) break;
                retried = true;
                limit(master, kTrueCeilingDb - (tp - kTrueCeilingDb) - 0.2);
            }
        }
        { std::lock_guard<std::mutex> l(mp3_mu_); mp3_error_ = err; mp3_lufs_ = lufs; mp3_tp_ = tp; mp3_retried_ = retried; }
        mp3_busy_ = false; mp3_done_ = true;
    });
}

// ------------------------------------------------------------------------------------------------ frame


void App::draw_toast(ImVec2 d) {
    if (now_ > toast_until_ || toast_msg_.empty()) return;
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    ImVec2 ts = ui::text_size(fonts.body, toast_msg_.c_str());
    const float w = ts.x + px(36), h = px(44);
    ImVec2 p((d.x - w) / 2, d.y - h - px(28));
    const float fade = float(std::min(1.0, (toast_until_ - now_) * 3.0));
    dl->AddRectFilled(ImVec2(p.x + 0, p.y + px(3)), ImVec2(p.x + w, p.y + h + px(3)), hex(0, 0.35f * fade), px(12));
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), hex(0x18181b, fade), px(12));
    dl->AddRect(p, ImVec2(p.x + w, p.y + h), hex(kLine2, fade), px(12));
    ui::text_at(dl, fonts.body, ImVec2(p.x + px(18), p.y + (h - ts.y) / 2), hex(kText, fade), toast_msg_.c_str());
}

void App::frame(float dt, ImVec2 display) {
    now_ = ImGui::GetTime();
    poll_inputs();
    if (engine_.input_open() && engine_.device_lost() && !demo_) {           // unplugged mid-session
        if (engine_.recording()) { stop_record(); toast("The mic was disconnected. Your take so far was kept."); }
        else { engine_.close_input(); source_name_.clear(); have_cur_input_ = false; }
        next_poll_ = 0;                                                      // look for it again straight away
    }

    // finished render?
    if (!rendering_ && render_thread_.joinable()) {
        render_thread_.join();
        std::lock_guard<std::mutex> l(render_mu_);
        render_result_.error.empty() ? void() : toast("Render failed: " + render_result_.error);
        if (render_result_.ok) {
            have_render_result_ = true;
            if (!render_progress_.empty() && render_progress_.find(':') != std::string::npos) proj_.clean_key = render_progress_;
            save(); refresh_sessions();
            char b[96]; std::snprintf(b, sizeof b, "Master ready: %.1f LUFS, %.1f dBTP", *render_result_.final_lufs, render_result_.true_peak_db);
            toast(b);
            peaks_for_.clear();
        }
    }
    if (!mp3_busy_ && mp3_done_) {
        mp3_done_ = false;
        if (mp3_thread_.joinable()) mp3_thread_.join();
        std::lock_guard<std::mutex> l(mp3_mu_);
        if (!mp3_error_.empty()) toast("MP3 export failed: " + mp3_error_);
        else { char b[96]; std::snprintf(b, sizeof b, "MP3 ready: %.1f LUFS, %.1f dBTP", mp3_lufs_, mp3_tp_); toast(b); }
        mp3_done_shown_ = true;
    }
    // meters
    if (engine_.input_open()) {
        mic_m_.update(engine_.mic_peak_db(), dt);
    } else mic_m_.update(-90.f, dt);
    hk_m_.update(engine_.hotkeys_peak_db(), dt);
    {
        float a = std::pow(10.f, std::max(engine_.mic_peak_db(), -90.f) / 20.f) + std::pow(10.f, engine_.hotkeys_peak_db() / 20.f);
        master_m_.update(20.f * std::log10(a + 1e-9f), dt);
    }
    for (float& f : flash_) f = std::max(0.f, f - dt * 3.5f);

    // global shortcuts
    ImGuiIO& io = ImGui::GetIO();
    if (io.KeyCtrl && ImGui::IsKeyPressed(ImGuiKey_R, false)) { engine_.recording() ? stop_record() : start_record(); }
    handle_keys();
    mic_poll();
    if (!update_checked_ && now_ > 8.0 && !demo_) { update_checked_ = true; update_check_async(); }
    if (update_done_.exchange(false)) {
        if (update_thread_.joinable()) update_thread_.join();
        if (update_after_) { auto f = std::move(update_after_); update_after_ = nullptr; f(); }
    }
    if (buzz_done_.exchange(false)) {
        if (buzz_thread_.joinable()) buzz_thread_.join();
        if (buzz_after_) { auto f = std::move(buzz_after_); buzz_after_ = nullptr; f(); }
    }

    // script autosave
    if (script_dirty_ && now_ > script_save_at_) script_save();

    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(display);
    ImGui::Begin("##main", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                    ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    header(display);
    const float top = px(68);
    ImGui::SetCursorPos(ImVec2(0, top));
    ImVec2 avail(display.x, display.y - top);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(24), px(20)));
    ImGui::BeginChild("##page", avail, ImGuiChildFlags_AlwaysUseWindowPadding, ImGuiWindowFlags_None);
    ImVec2 inner(avail.x - px(48), avail.y - px(40));
    switch (page_) {
        case kSession: page_session(inner); break;
        case kMic: page_mic(inner); break;
        case kMix: page_mix(inner); break;
        case kRecordings: page_recordings(inner); break;
        case kScript: page_script(inner); break;
        case kPublish: page_publish(inner); break;
        default: break;
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::End();

    if (settings_dirty_ && !ImGui::IsMouseDown(0)) { settings_dirty_ = false; save(); }
    pad_editor();
    session_popup();
    recovery_popup();
    update_popup();
    draw_toast(display);
}

// ------------------------------------------------------------------------------------------------ header
void App::header(ImVec2 display) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float h = px(68);
    dl->AddLine(ImVec2(0, h), ImVec2(display.x, h), hex(kLine));
    // logo
    ImVec2 lp(px(24), px(16));
    dl->AddRectFilled(lp, ImVec2(lp.x + px(36), lp.y + px(36)), hex(kAccent), px(10));
    dl->AddCircleFilled(ImVec2(lp.x + px(18), lp.y + px(18)), px(7), hex(0xffffff), 24);
    ui::text_at(dl, fonts.title, ImVec2(lp.x + px(48), lp.y + px(5)), hex(kText), "PodStudio");
    // tabs
    static const char* tabs[] = {"Session", "Mic", "Mix", "Recordings", "Script", "Publish"};
    const float each = px(84);
    ImGui::SetCursorPos(ImVec2(px(216), px(16)));
    int sel = int(page_);
    if (ui::pill_tabs(tabs, 6, &sel, each)) page_ = Page(sel);
    if (update_info_) {                                                 // "Update available"
        const char* t = "Update available";
        ImVec2 ts = ui::text_size(fonts.semibold, t);
        const float bw = ts.x + px(34);
        ImGui::SetCursorPos(ImVec2(display.x - px(24) - px(210) - px(12) - px(170) - px(12) - bw, px(15)));
        ImVec2 bp = ImGui::GetCursorScreenPos();
        if (ImGui::InvisibleButton("##upd", ImVec2(bw, px(38)))) open_update_popup_ = true;
        const bool hv = ImGui::IsItemHovered();
        dl->AddRectFilled(bp, ImVec2(bp.x + bw, bp.y + px(38)), hex(hv ? 0x1e3a8a : 0x172554), px(19));
        dl->AddRect(bp, ImVec2(bp.x + bw, bp.y + px(38)), hex(0x3b82f6), px(19));
        ui::text_at(dl, fonts.semibold, ImVec2(bp.x + px(17), bp.y + (px(38) - ts.y) / 2), hex(0x93c5fd), t);
    }
    // right side: mic pill + session button
    const bool ok = engine_.input_open();
    const char* mic_text = ok ? (demo_ ? "Demo signal" : "PodMic connected") : "PodMic not connected";
    ImVec2 ms = ui::text_size(fonts.body, mic_text);
    std::string sname = have_proj_ ? proj_.name : "No session";
    if (sname.size() > 22) sname = sname.substr(0, 21) + "...";
    ImVec2 ss = ui::text_size(fonts.semibold, sname.c_str());
    const float sbw = ss.x + px(44), pw = ms.x + px(40);
    float x = display.x - px(24) - sbw;
    ImGui::SetCursorPos(ImVec2(x, px(15)));
    ImVec2 bp = ImGui::GetCursorScreenPos();
    if (ImGui::InvisibleButton("##sess", ImVec2(sbw, px(38)))) { open_session_popup_ = true; refresh_sessions(); }
    const bool hov = ImGui::IsItemHovered();
    dl->AddRectFilled(bp, ImVec2(bp.x + sbw, bp.y + px(38)), hex(hov ? kMuted : kRaised), px(10));
    dl->AddRect(bp, ImVec2(bp.x + sbw, bp.y + px(38)), hex(kLine), px(10));
    ui::text_at(dl, fonts.semibold, ImVec2(bp.x + px(14), bp.y + (px(38) - ss.y) / 2), hex(kText), sname.c_str());
    dl->AddTriangleFilled(ImVec2(bp.x + sbw - px(22), bp.y + px(16)), ImVec2(bp.x + sbw - px(12), bp.y + px(16)),
                          ImVec2(bp.x + sbw - px(17), bp.y + px(22)), hex(kDim));
    ImVec2 pp(x - px(12) - pw, bp.y);
    dl->AddRectFilled(pp, ImVec2(pp.x + pw, pp.y + px(38)), hex(ok ? 0x0f2a1a : 0x2a1f0a), px(19));
    dl->AddRect(pp, ImVec2(pp.x + pw, pp.y + px(38)), hex(ok ? 0x14532d : 0x713f12), px(19));
    dl->AddCircleFilled(ImVec2(pp.x + px(17), pp.y + px(19)), px(4), hex(ok ? kOk : kWarn), 16);
    ui::text_at(dl, fonts.body, ImVec2(pp.x + px(30), pp.y + (px(38) - ms.y) / 2), hex(ok ? 0x86efac : 0xfcd34d), mic_text);
}

void App::session_popup() {
    if (open_session_popup_) { ImGui::OpenPopup("Sessions"); open_session_popup_ = false; new_name_[0] = 0; }
    ImGui::SetNextWindowSize(ImVec2(px(460), 0));
    ImVec2 c = ImGui::GetMainViewport()->GetCenter();
    ImGui::SetNextWindowPos(c, ImGuiCond_Appearing, ImVec2(0.5f, 0.4f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(22), px(20)));
    if (ImGui::BeginPopupModal("Sessions", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::PushFont(fonts.title); ImGui::TextUnformatted("Sessions"); ImGui::PopFont();
        ui::label_dim("Each session is a folder with its mic take, sounds and master.");
        ImGui::Dummy(ImVec2(0, px(6)));
        ImGui::SetNextItemWidth(px(300));
        ImGui::InputTextWithHint("##nn", "Name a new session", new_name_, sizeof new_name_);
        ImGui::SameLine();
        if (ui::primary_button("Create", px(96), px(38)) ) {
            std::string n = new_name_[0] ? new_name_ : "Session " + stamp();
            new_session(n); ImGui::CloseCurrentPopup();
        }
        ImGui::Dummy(ImVec2(0, px(4)));
        ImGui::BeginChild("##slist", ImVec2(0, px(260)), ImGuiChildFlags_None);
        for (size_t i = 0; i < sessions_.size(); i++) {
            auto& s = sessions_[i];
            const bool cur = have_proj_ && fs::path(s.path) == fs::path(proj_.root);
            ImGui::PushID(int(i));
            ImVec2 p = ImGui::GetCursorScreenPos();
            const float w = ImGui::GetContentRegionAvail().x, h = px(52);
            if (ImGui::InvisibleButton("##row", ImVec2(w, h)) && !cur) { open_session(s.path); ImGui::CloseCurrentPopup(); }
            ImDrawList* dl = ImGui::GetWindowDrawList();
            dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), hex(cur ? kMuted : ImGui::IsItemHovered() ? kRaised : kBg), px(10));
            ui::text_at(dl, fonts.semibold, ImVec2(p.x + px(14), p.y + px(8)), hex(kText), s.name.c_str());
            std::string sub = s.created + (s.duration > 0 ? "  -  " + ui::fmt_time(s.duration) : "") + (s.has_master ? "  -  mastered" : "");
            ui::text_at(dl, fonts.sm, ImVec2(p.x + px(14), p.y + px(29)), hex(kDim), sub.c_str());
            ImGui::PopID();
        }
        if (sessions_.empty()) ui::label_dim("No sessions yet.");
        ImGui::EndChild();
        if (ImGui::Button("Show the sessions folder")) platform::reveal(root_);
        ImGui::SameLine();
        if (ImGui::Button("Check for updates")) { update_manual_ = true; update_check_async(); ImGui::CloseCurrentPopup(); }
        ImGui::SameLine();
        if (ImGui::Button("Close") || ImGui::IsKeyPressed(ImGuiKey_Escape)) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar();
}

#ifndef PS_VERSION
#define PS_VERSION "dev"
#endif
#ifndef PS_REVISION
#define PS_REVISION "1"
#endif

void App::update_check_async() {
    if (update_busy_ || !http_) return;
    if (update_thread_.joinable()) update_thread_.join();
    update_busy_ = true;
    update_thread_ = std::thread([this] {
        std::optional<updates::UpdateInfo> info; std::string err;
        try { info = updates::check(*http_, std::string(PS_VERSION) + "-" + PS_REVISION, std::string("PodStudio/") + PS_VERSION + " (Windows desktop app)"); }
        catch (const std::exception& e) { err = e.what(); }
        std::lock_guard<std::mutex> l(update_mu_);
        update_error_ = err;
        update_after_ = [this, info] {
            update_info_ = info;
            if (update_manual_) {
                update_manual_ = false;
                if (!info && update_error_.empty()) toast(std::string("You're up to date (v") + PS_VERSION + ")."); 
                else if (!update_error_.empty()) toast("Couldn't check for updates. " + update_error_);
                else open_update_popup_ = true;
            }
        };
        update_busy_ = false; update_done_ = true;
    });
}

void App::update_download_async() {
    if (update_busy_ || !update_info_) return;
    if (update_thread_.joinable()) update_thread_.join();
    update_busy_ = true; update_frac_ = 0.f;
    const updates::UpdateInfo info = *update_info_;
    { std::lock_guard<std::mutex> l(update_mu_); update_error_.clear(); update_status_ = "Downloading..."; }
    update_thread_ = std::thread([this, info] {
        std::string path, err;
        try {
            path = updates::download(*http_, info, platform::exe_dir() + "/../update-cache", std::string("PodStudio/") + PS_VERSION + " (Windows desktop app)",
                                     [this](uint64_t a, uint64_t b) { update_frac_ = b ? float(double(a) / double(b)) : -1.f; });
        } catch (const std::exception& e) { err = e.what(); }
        std::lock_guard<std::mutex> l(update_mu_);
        update_error_ = err; update_path_ = path; update_status_ = err.empty() ? "Downloaded and verified. PodStudio will close, update, and open again." : "";
        update_busy_ = false; update_done_ = true; update_frac_ = -1.f;
    });
}

void App::update_popup() {
    if (open_update_popup_) { ImGui::OpenPopup("Update available"); open_update_popup_ = false; }
    ImGui::SetNextWindowSize(ImVec2(px(500), 0));
    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.4f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(24), px(22)));
    if (ImGui::BeginPopupModal("Update available", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_AlwaysAutoResize)) {
        if (!update_info_) { ImGui::CloseCurrentPopup(); ImGui::EndPopup(); ImGui::PopStyleVar(); return; }
        const updates::UpdateInfo& u = *update_info_;
        ImGui::PushFont(fonts.title); ImGui::Text("PodStudio v%s is available", u.version.c_str()); ImGui::PopFont();
        ui::label_dim((std::string("You have v") + PS_VERSION + "-" + PS_REVISION + ".").c_str());
        ImGui::Dummy(ImVec2(0, px(6)));
        ImGui::BeginChild("##notes", ImVec2(px(452), px(130)), ImGuiChildFlags_Borders);
        ImGui::PushTextWrapPos(px(430));
        ImGui::TextUnformatted(u.notes.empty() ? "No release notes." : u.notes.substr(0, 1800).c_str());
        ImGui::PopTextWrapPos();
        ImGui::EndChild();
        std::string status, error, path;
        { std::lock_guard<std::mutex> l(update_mu_); status = update_status_; error = update_error_; path = update_path_; }
        ImGui::Dummy(ImVec2(0, px(4)));
        const bool can = u.can_install() && platform::installed_by_setup();
        if (!u.problems.empty()) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(kWarn)); for (auto& p : u.problems) ui::label_dim(p.c_str()); ImGui::PopStyleColor(); }
        else if (!platform::installed_by_setup()) ui::label_dim("This copy wasn't installed with the setup program, so install the new version the same way. The release page has the download.");
        else ui::label_dim("The download is checked against the checksum published with the release.");
        if (update_busy_) {
            ui::label_dim(status.c_str());
            ImVec2 p = ImGui::GetCursorScreenPos(); const float w = px(452), f = update_frac_.load();
            ImGui::GetWindowDrawList()->AddRectFilled(ImVec2(p.x, p.y + px(4)), ImVec2(p.x + w, p.y + px(8)), hex(kMuted), px(2));
            if (f >= 0) ImGui::GetWindowDrawList()->AddRectFilled(ImVec2(p.x, p.y + px(4)), ImVec2(p.x + w * f, p.y + px(8)), hex(kText), px(2));
            ImGui::Dummy(ImVec2(0, px(12)));
        } else if (!error.empty()) { ImGui::PushStyleColor(ImGuiCol_Text, hexv(0xfca5a5)); ImGui::TextWrapped("%s", error.c_str()); ImGui::PopStyleColor(); }
        else if (!status.empty()) ui::label_dim(status.c_str());
        ImGui::Dummy(ImVec2(0, px(8)));
        const bool ready = !path.empty() && error.empty() && !update_busy_;
        if (ready) {
            if (ui::primary_button("Install and restart", px(190), px(38))) {
                if (engine_.recording()) toast("Finish your recording first.");
                else if (platform::start_detached(path, {"/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RELAUNCH=1"})) quit_ = true;
                else toast("Couldn't start the installer. You can run it yourself: " + path);
            }
        } else {
            if (!can || update_busy_) ImGui::BeginDisabled();
            if (ui::primary_button("Download and install", px(200), px(38))) update_download_async();
            if (!can || update_busy_) ImGui::EndDisabled();
        }
        ImGui::SameLine();
        if (ImGui::Button("View release", ImVec2(px(120), px(38)))) platform::open_url(u.page);
        ImGui::SameLine();
        if (ImGui::Button("Later", ImVec2(px(80), px(38))) && !update_busy_) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar();
}

void App::recover(const std::string& path) {
    Recovery r = recover_session(path);
    if (!r.ok) { toast("Couldn't recover: " + r.error); return; }
    char b[96]; std::snprintf(b, sizeof b, "Recovered %s of audio.", ui::fmt_time(r.seconds).c_str());
    toast(b);
    refresh_sessions();
    open_session(path);
    sel_session_ = -1;
    render_async();                                      // the master was never made for this take
}

void App::recovery_popup() {
    if (open_recover_popup_) { ImGui::OpenPopup("Recover"); open_recover_popup_ = false; }
    ImGui::SetNextWindowSize(ImVec2(px(470), 0));
    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.4f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(24), px(22)));
    if (ImGui::BeginPopupModal("Recover", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::PushFont(fonts.title); ImGui::TextUnformatted("A recording didn't finish"); ImGui::PopFont();
        ImGui::Dummy(ImVec2(0, px(4)));
        ImGui::PushTextWrapPos(px(420));
        ImGui::TextWrapped("PodStudio closed while \"%s\" was recording. The audio is on disk and your hotkey hits were journaled as you pressed them, "
                           "so the take can be repaired. Nothing is deleted.", recover_name_.c_str());
        ImGui::PopTextWrapPos();
        ImGui::Dummy(ImVec2(0, px(10)));
        if (ui::primary_button("Recover it", px(130), px(38))) { recover(recover_path_); ImGui::CloseCurrentPopup(); }
        ImGui::SameLine();
        if (ImGui::Button("Not now", ImVec2(px(100), px(38)))) ImGui::CloseCurrentPopup();
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar();
}

void App::pad_editor() {
    if (open_edit_popup_ && edit_pad_ >= 0 && size_t(edit_pad_) < proj_.pads.size()) {
        std::snprintf(edit_label_, sizeof edit_label_, "%s", proj_.pads[size_t(edit_pad_)].label.c_str());
        ImGui::OpenPopup("Edit pad");
        open_edit_popup_ = false;
    }
    ImGui::SetNextWindowSize(ImVec2(px(440), 0));
    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.4f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(22), px(20)));
    if (ImGui::BeginPopupModal("Edit pad", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_AlwaysAutoResize)) {
        if (edit_pad_ < 0 || size_t(edit_pad_) >= proj_.pads.size()) { ImGui::CloseCurrentPopup(); ImGui::EndPopup(); ImGui::PopStyleVar(); return; }
        Pad& p = proj_.pads[size_t(edit_pad_)];
        ImGui::PushFont(fonts.title);
        ImGui::Text("Pad %d", edit_pad_ + 1);
        ImGui::PopFont();
        ImGui::Dummy(ImVec2(0, px(4)));
        ui::label_dim("Sound");
        std::string cur = p.clip.empty() ? "No sound chosen" : p.clip;
        if (ui::primary_button("Choose a sound...", 0, px(36))) {
            std::string f = platform::open_file_dialog("Choose a sound", "Audio files", "*.wav;*.mp3;*.flac;*.ogg;*.m4a");
            if (!f.empty()) { assign_sound(edit_pad_, f); std::snprintf(edit_label_, sizeof edit_label_, "%s", p.label.c_str()); }
        }
        ImGui::SameLine(); ImGui::AlignTextToFramePadding(); ui::label_dim(cur.c_str());
        ImGui::Dummy(ImVec2(0, px(6)));
        ui::label_dim("Label");
        ImGui::SetNextItemWidth(-1);
        if (ImGui::InputText("##label", edit_label_, sizeof edit_label_)) { p.label = edit_label_; }
        ui::label_dim("Key");
        char key[4]; std::snprintf(key, sizeof key, "%s", p.key.c_str());
        ImGui::SetNextItemWidth(px(80));
        if (ImGui::InputText("##key", key, sizeof key)) p.key = key;
        ImGui::Dummy(ImVec2(0, px(4)));
        ui::label_dim("Button mode");
        static const char* modes[] = {"once", "momentary", "toggle", "loop"};
        for (int m = 0; m < 4; m++) {
            if (m) ImGui::SameLine();
            if (ui::chip(mode_name(modes[m]), p.mode == modes[m], px(84))) p.mode = modes[m];
        }
        ImGui::Dummy(ImVec2(0, px(6)));
        float g = float(p.gain_db);
        if (ui::slider_row("Level", &g, -24.f, 12.f, "%+.1f dB", px(396), "Added to the automatic level-matching.")) p.gain_db = double(g);
        ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted("Duck under my voice");
        ImGui::SameLine(px(352));
        ui::toggle("##duck", &p.duck);
        ImGui::Dummy(ImVec2(0, px(8)));
        if (ui::primary_button("Done", px(110), px(38))) { save(); ImGui::CloseCurrentPopup(); }
        ImGui::SameLine();
        if (!p.clip.empty() && ImGui::Button("Remove sound")) { p.clip.clear(); p.label.clear(); p.norm_db.reset(); engine_.stop_handle(edit_pad_); save(); }
        ImGui::SameLine();
        if (ImGui::Button("Test") && !p.clip.empty()) { const Clip* c = get_clip(p.clip); if (c) engine_.play(c, pad_gain(p), false, false, 100 + edit_pad_); }
        ImGui::EndPopup();
    }
    ImGui::PopStyleVar();
}

// ------------------------------------------------------------------------------------------------ script storage
void App::script_load() {
    script_.clear(); script_dirty_ = false;
    std::ifstream f(proj_.root + "/script.txt", std::ios::binary);
    if (f) { std::stringstream ss; ss << f.rdbuf(); script_ = ss.str(); }
}

void App::script_save() {
    if (!have_proj_ || !script_dirty_) return;
    script_dirty_ = false;
    if (script_.empty() && !file_exists(proj_.root + "/script.txt")) return;
    std::ofstream f(proj_.root + "/script.txt", std::ios::binary | std::ios::trunc);
    f << script_;
}

void App::debug_select_session(int i) { if (i >= 0 && size_t(i) < sessions_.size()) sel_session_ = i; }

}  // namespace ps
