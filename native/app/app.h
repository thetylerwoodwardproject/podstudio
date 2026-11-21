// Application state and the pages of the UI.
#pragma once
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <imgui.h>

#include "../core/project.h"
#include "../core/recovery.h"
#include "../core/render.h"
#include "engine.h"
#include "micctl.h"
#include "widgets.h"

namespace ps {

struct SessionInfo {
    std::string path, name, created;
    double duration = 0;
    bool has_master = false, has_mic = false, needs_recovery = false;
};

enum Page { kSession = 0, kMic, kMix, kRecordings, kScript, kPageCount };

class App {
public:
    App();
    ~App();
    void init();
    void frame(float dt, ImVec2 display);                // draws everything; call between NewFrame and Render
    bool wants_quit() const { return quit_; }

    // test hooks for screenshots: jump to a page / open a popup
    void debug_set_page(int p) { page_ = Page(p); }
    void debug_select_session(int i);

private:
    // ---- sessions
    void open_session(const std::string& path);
    void new_session(const std::string& name);
    void next_take();                                    // a fresh session with this one's pads and sounds
    void refresh_sessions();
    void save();
    // ---- input
    void poll_inputs();
    void mic_poll();
    void mic_sync();
    void mic_write(const char* what, const std::function<void(podmic::Mic&)>& fn);
    void mic_queue(const std::string& key, std::function<void(podmic::Mic&)> fn);
    // ---- recording and pads
    void start_record();
    void stop_record();
    void pad_press(int i);
    void pad_release(int i);
    void stop_pad(int i);
    const Clip* get_clip(const std::string& file);
    void assign_sound(int pad, const std::string& source_path);
    double pad_gain(Pad& p);
    void handle_keys();
    // ---- render
    void render_async();
    void export_mp3_async();
    // ---- ui
    void header(ImVec2 display);
    void page_session(ImVec2 avail);
    void page_mic(ImVec2 avail);
    void page_mix(ImVec2 avail);
    void page_recordings(ImVec2 avail);
    void page_script(ImVec2 avail);
    void connect_overlay(ImVec2 pos, ImVec2 size);
    void pad_editor();
    void recovery_popup();
    void recover(const std::string& path);
    void session_popup();
    void toast(const std::string& msg);
    void draw_toast(ImVec2 display);
    void select_session(int i);
    void select_stem(int stem);
    void script_load();
    void script_save();
    std::string session_stem_path(int which) const;

public:
    // exposed to the pages
    Engine engine_;
    Project proj_;
    bool have_proj_ = false;
    std::string root_;
    Page page_ = kSession;
    bool quit_ = false;

    // input
    std::vector<InputInfo> inputs_;
    int podmic_idx_ = -1;
    std::string source_name_;
    double next_poll_ = 0;
    bool demo_ = false, engine_ok_ = false, show_other_inputs_ = false;
    std::string audio_error_;

    // meters
    ui::MeterState mic_m_, hk_m_, master_m_;

    // pads
    std::map<std::string, std::unique_ptr<Clip>> clips_;
    float flash_[16] = {};
    std::map<int, size_t> open_events_;                  // pad -> index into proj_.events awaiting its duration
    int edit_pad_ = -1;
    char edit_label_[64] = {};
    bool open_edit_popup_ = false;

    // recording / render
    double rec_start_wall_ = 0;
    std::thread render_thread_;
    std::atomic<bool> rendering_{false};
    std::mutex render_mu_;
    std::string render_progress_;
    MasterResult render_result_;
    bool have_render_result_ = false, render_just_done_ = false;
    std::thread mp3_thread_;
    std::atomic<bool> mp3_busy_{false};
    std::mutex mp3_mu_;
    std::string mp3_error_;
    double mp3_lufs_ = 0, mp3_tp_ = 0;
    bool mp3_retried_ = false, mp3_done_shown_ = false;
    std::atomic<bool> mp3_done_{false};
    std::string toast_msg_;
    double toast_until_ = 0;

    // recordings page
    std::vector<SessionInfo> sessions_;
    int sel_session_ = -1;
    int stem_ = 0;                                       // 0 master, 1 mic, 2 cleaned, 3 hotkeys, 4 mp3
    Project view_;                                       // the session shown on the Recordings page
    std::vector<float> peaks_min_, peaks_max_;
    double peaks_dur_ = 0;
    std::string peaks_for_, peaks_want_;
    std::thread peaks_thread_;
    std::atomic<bool> peaks_loading_{false};
    std::mutex peaks_mu_;
    std::vector<float> new_min_, new_max_;
    double new_dur_ = 0;
    std::atomic<bool> peaks_ready_{false};
    ui::MeterState prev_m_;

    // script
    std::string script_;
    bool script_dirty_ = false;
    double script_save_at_ = 0;
    bool prompter_ = false, prompter_run_ = false, prompter_with_rec_ = false;
    float prompter_speed_ = 4.0f, prompter_scroll_ = 0.f, prompter_size_ = 1.0f;

    // crash recovery
    Journal journal_;
    std::string recover_path_, recover_name_;
    bool open_recover_popup_ = false;

    // new session popup
    bool open_session_popup_ = false;
    char new_name_[96] = {};

    // PodMic on-board controls
    InputInfo cur_input_;
    bool have_cur_input_ = false;
    std::unique_ptr<MicLink> mic_link_, mic_new_link_;
    std::thread mic_thread_;
    std::atomic<int> mic_state_{0};                      // 0 absent, 1 connecting, 2 ready, 3 failed
    std::mutex mic_mu_;
    std::string mic_error_, mic_desc_;
    double mic_next_try_ = 0, gain_next_ = 0;
    std::map<std::string, float> mic_vals_;              // "comp.threshold", "depth", "monitor_mix", ...
    std::map<std::string, bool> mic_flags_;              // "hpf", "mute", "monitoring", "processing", "advanced", "comp_on", ...
    std::map<std::string, std::pair<double, std::function<void(podmic::Mic&)>>> mic_pending_;   // debounced writes
    float gain_db_ = 0; GainRange gain_range_; bool gain_ok_ = false;
    bool settings_dirty_ = false;
    double now_ = 0;
};

}  // namespace ps
