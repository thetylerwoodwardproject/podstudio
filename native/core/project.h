// Session folders. The on-disk layout and project.json schema are the same as the Python app's, so sessions open in either.
#pragma once
#include <optional>
#include <string>
#include <vector>

namespace ps {

struct Pad {
    std::string key, label, clip, color = "#6ea8ff";
    double gain_db = 0.0;
    bool duck = false;
    std::string mode = "once";                 // once | momentary | toggle | loop
    std::optional<double> norm_db;             // level-matching gain measured from the clip itself
};

struct Event {
    double t = 0;                              // seconds since the mic stream started
    int pad = 0;
    std::string clip;
    double gain_db = 0;
    bool duck = false, loop = false;
    std::optional<double> dur;                 // how long it played; none = the clip's own length
};

struct Chapter { double t = 0; std::string title; };

struct Project {
    std::string name, root, created;
    double mic_db = 0, hotkeys_db = 0, target_lufs = -16.0, mic_duration = 0;
    bool hotkeys_muted = false, denoise = true, recording = false;
    double denoise_atten_db = 18.0, duck_amount_db = 12.0, duck_threshold_db = -40.0, duck_release_ms = 350.0;
    std::vector<Pad> pads;
    std::vector<Event> events;
    std::vector<Chapter> chapters;
    std::string art, clean_key;
    std::string episode_json = "{}", buzz_json = "{}", mix_stats_json = "{}";   // carried through untouched

    std::string audio_dir() const { return root + "/audio"; }
    std::string clips_dir() const { return root + "/clips"; }
    std::string mic_path() const { return audio_dir() + "/mic.wav"; }
    std::string clean_path() const { return audio_dir() + "/mic-clean.wav"; }
    std::string hotkeys_path() const { return audio_dir() + "/hotkeys.wav"; }
    std::string master_path() const { return audio_dir() + "/master.wav"; }
    std::string mp3_path() const { return audio_dir() + "/episode.mp3"; }
    std::string journal_path() const { return audio_dir() + "/events.jsonl"; }
    std::string file() const { return root + "/project.json"; }

    bool save(std::string& err) const;                         // writes project.json, keeping a .bak of the last good copy
    static bool load(const std::string& root, Project& out, std::string& err);
    static Project create(const std::string& name, const std::string& parent);   // new folder, 8 default pads; saved
};

std::string default_root();                                    // ~/Music/PodStudio
std::vector<std::string> list_sessions(const std::string& root);   // folder paths, newest first
bool make_dirs(const std::string& path);
bool file_exists(const std::string& path);

}  // namespace ps
