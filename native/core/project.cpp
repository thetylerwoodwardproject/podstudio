#include "project.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>

#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace ps {
namespace {

const char* kColors[] = {"#ff5c7a", "#ffb454", "#f2e35c", "#5cff9d", "#4fd8eb", "#6ea8ff", "#b48bff", "#ff7ad9"};
const char* kKeys[] = {"1", "2", "3", "4", "5", "6", "7", "8"};

template <class T> T get(const json& j, const char* k, T def) {
    auto it = j.find(k);
    if (it == j.end() || it->is_null()) return def;
    try { return it->get<T>(); } catch (...) { return def; }
}

std::string now_text() {
    std::time_t t = std::time(nullptr);
    char b[32];
    std::strftime(b, sizeof b, "%Y-%m-%d %H:%M:%S", std::localtime(&t));
    return b;
}

}  // namespace

std::string default_root() {
    const char* home = std::getenv("USERPROFILE");
    if (!home) home = std::getenv("HOME");
    return (fs::path(home ? home : ".") / "Music" / "PodStudio").string();
}

bool make_dirs(const std::string& p) { std::error_code ec; fs::create_directories(p, ec); return !ec; }
bool file_exists(const std::string& p) { std::error_code ec; return fs::exists(p, ec); }

bool Project::save(std::string& err) const {
    if (!make_dirs(audio_dir()) || !make_dirs(clips_dir())) { err = "cannot create the session folders"; return false; }
    json j;
    j["format"] = 1; j["name"] = name; j["created"] = created;
    j["mic_db"] = mic_db; j["hotkeys_db"] = hotkeys_db; j["hotkeys_muted"] = hotkeys_muted;
    j["target_lufs"] = target_lufs; j["mic_duration"] = mic_duration;
    j["mix_stats"] = json::parse(mix_stats_json, nullptr, false);
    j["denoise"] = denoise; j["denoise_atten_db"] = denoise_atten_db; j["clean_key"] = clean_key;
    j["recording"] = recording; j["art"] = art;
    j["episode"] = json::parse(episode_json, nullptr, false);
    j["buzz"] = json::parse(buzz_json, nullptr, false);
    for (const char* k : {"mix_stats", "episode", "buzz"}) if (j[k].is_discarded()) j[k] = json::object();
    j["duck_amount_db"] = duck_amount_db; j["duck_threshold_db"] = duck_threshold_db; j["duck_release_ms"] = duck_release_ms;
    j["chapters"] = json::array();
    for (auto& c : chapters) j["chapters"].push_back({{"t", c.t}, {"title", c.title}});
    j["pads"] = json::array();
    for (auto& p : pads) {
        json o = {{"key", p.key}, {"label", p.label}, {"clip", p.clip}, {"color", p.color}, {"gain_db", p.gain_db},
                  {"loop", p.mode == "loop"}, {"duck", p.duck}, {"mode", p.mode}};
        o["norm_db"] = p.norm_db ? json(*p.norm_db) : json(nullptr);
        j["pads"].push_back(o);
    }
    j["events"] = json::array();
    for (auto& e : events) {
        json o = {{"t", e.t}, {"pad", e.pad}, {"clip", e.clip}, {"gain_db", e.gain_db}, {"duck", e.duck}, {"loop", e.loop}};
        o["dur"] = e.dur ? json(*e.dur) : json(nullptr);
        j["events"].push_back(o);
    }
    const std::string tmp = file() + ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary);
        if (!f) { err = "cannot write " + tmp; return false; }
        f << j.dump(2);
        if (!f) { err = "write failed"; return false; }
    }
    std::error_code ec;
    if (fs::exists(file(), ec)) {                           // keep the last good copy
        std::ifstream in(file(), std::ios::binary);
        std::stringstream ss; ss << in.rdbuf();
        if (!json::parse(ss.str(), nullptr, false).is_discarded()) fs::copy_file(file(), file() + ".bak", fs::copy_options::overwrite_existing, ec);
    }
    fs::rename(tmp, file(), ec);
    if (ec) { fs::remove(file(), ec); fs::rename(tmp, file(), ec); }          // Windows: rename won't overwrite
    if (ec) { err = "cannot replace project.json: " + ec.message(); return false; }
    return true;
}

bool Project::load(const std::string& root, Project& p, std::string& err) {
    std::ifstream in(root + "/project.json", std::ios::binary);
    if (!in) { err = "no project.json in " + root; return false; }
    std::stringstream ss; ss << in.rdbuf();
    json j = json::parse(ss.str(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) { err = "project.json is damaged"; return false; }
    p = Project();
    p.root = root; p.name = get<std::string>(j, "name", fs::path(root).filename().string());
    p.created = get<std::string>(j, "created", "");
    p.mic_db = get(j, "mic_db", 0.0); p.hotkeys_db = get(j, "hotkeys_db", 0.0); p.hotkeys_muted = get(j, "hotkeys_muted", false);
    p.target_lufs = get(j, "target_lufs", -16.0); p.mic_duration = get(j, "mic_duration", 0.0);
    p.denoise = get(j, "denoise", false); p.denoise_atten_db = get(j, "denoise_atten_db", 18.0);
    p.clean_key = get<std::string>(j, "clean_key", ""); p.recording = get(j, "recording", false); p.art = get<std::string>(j, "art", "");
    p.duck_amount_db = get(j, "duck_amount_db", 12.0); p.duck_threshold_db = get(j, "duck_threshold_db", -40.0);
    p.duck_release_ms = get(j, "duck_release_ms", 350.0);
    if (j.contains("episode")) p.episode_json = j["episode"].dump();
    if (j.contains("buzz")) p.buzz_json = j["buzz"].dump();
    if (j.contains("mix_stats")) p.mix_stats_json = j["mix_stats"].dump();
    for (auto& c : j.value("chapters", json::array())) p.chapters.push_back({get(c, "t", 0.0), get<std::string>(c, "title", "")});
    for (auto& o : j.value("pads", json::array())) {
        Pad d;
        d.key = get<std::string>(o, "key", ""); d.label = get<std::string>(o, "label", ""); d.clip = get<std::string>(o, "clip", "");
        d.color = get<std::string>(o, "color", "#6ea8ff"); d.gain_db = get(o, "gain_db", 0.0); d.duck = get(o, "duck", false);
        d.mode = get<std::string>(o, "mode", "once");
        if (d.mode == "once" && get(o, "loop", false)) d.mode = "loop";           // sessions saved before pad modes existed
        if (o.contains("norm_db") && o["norm_db"].is_number()) d.norm_db = o["norm_db"].get<double>();
        p.pads.push_back(d);
    }
    for (auto& o : j.value("events", json::array())) {
        Event e;
        e.t = get(o, "t", 0.0); e.pad = get(o, "pad", 0); e.clip = get<std::string>(o, "clip", ""); e.gain_db = get(o, "gain_db", 0.0);
        e.duck = get(o, "duck", false); e.loop = get(o, "loop", false);
        if (o.contains("dur") && o["dur"].is_number()) e.dur = o["dur"].get<double>();
        p.events.push_back(e);
    }
    return true;
}

Project Project::create(const std::string& name_in, const std::string& parent) {
    std::string name = name_in;
    name.erase(0, name.find_first_not_of(" \t"));
    name.erase(name.find_last_not_of(" \t") + 1);
    std::string slug = std::regex_replace(name, std::regex("[^A-Za-z0-9._-]+"), "-");
    while (!slug.empty() && slug.front() == '-') slug.erase(0, 1);
    while (!slug.empty() && slug.back() == '-') slug.pop_back();
    if (slug.empty()) slug = "session";
    fs::path root = fs::path(parent) / slug;
    for (int n = 2; fs::exists(root); n++) root = fs::path(parent) / (slug + "-" + std::to_string(n));
    Project p;
    p.name = name.empty() ? slug : name;
    p.root = root.string();
    p.created = now_text();
    for (int i = 0; i < 8; i++) { Pad d; d.key = kKeys[i]; d.color = kColors[i]; p.pads.push_back(d); }
    std::string err;
    p.save(err);
    return p;
}

std::vector<std::string> list_sessions(const std::string& root) {
    std::vector<std::pair<fs::file_time_type, std::string>> found;
    std::error_code ec;
    for (auto& d : fs::directory_iterator(root, ec)) {
        if (d.is_directory(ec) && fs::exists(d.path() / "project.json", ec))
            found.push_back({fs::last_write_time(d.path() / "project.json", ec), d.path().string()});
    }
    std::sort(found.begin(), found.end(), [](auto& a, auto& b) { return a.first > b.first; });
    std::vector<std::string> out;
    for (auto& f : found) out.push_back(f.second);
    return out;
}

}  // namespace ps
