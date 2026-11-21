#include "recovery.h"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>

#include <nlohmann/json.hpp>

#include "audio.h"

#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace ps {

Journal::~Journal() { if (f_) std::fclose(static_cast<FILE*>(f_)); }

bool Journal::start(const std::string& path) {
    if (f_) std::fclose(static_cast<FILE*>(f_));
    path_ = path;
    std::error_code ec;
    fs::create_directories(fs::path(path).parent_path(), ec);
    f_ = std::fopen(path.c_str(), "wb");
    return f_ != nullptr;
}

void Journal::write_line(const std::string& line) {
    if (!f_) return;
    FILE* f = static_cast<FILE*>(f_);
    std::fwrite(line.data(), 1, line.size(), f);
    std::fputc('\n', f);
    std::fflush(f);
#ifdef _WIN32
    _commit(_fileno(f));
#else
    fsync(fileno(f));
#endif
}

void Journal::hit(size_t index, const Event& e) {
    json o = {{"op", "hit"}, {"i", index}, {"t", e.t}, {"pad", e.pad}, {"clip", e.clip}, {"gain_db", e.gain_db}, {"duck", e.duck}, {"loop", e.loop}};
    o["dur"] = e.dur ? json(*e.dur) : json(nullptr);
    write_line(o.dump());
}

void Journal::end(size_t index, double dur) { write_line(json({{"op", "end"}, {"i", index}, {"dur", dur}}).dump()); }

void Journal::discard() {
    if (f_) { std::fclose(static_cast<FILE*>(f_)); f_ = nullptr; }
    std::error_code ec;
    if (!path_.empty()) fs::remove(path_, ec);
}

std::vector<Event> replay_journal(const std::string& path) {
    std::map<size_t, Event> events;
    std::ifstream in(path);
    std::string line;
    while (std::getline(in, line)) {
        json o = json::parse(line, nullptr, false);
        if (o.is_discarded() || !o.is_object() || !o.contains("op") || !o.contains("i")) continue;
        try {
            const size_t i = o["i"].get<size_t>();
            if (o["op"] == "hit") {
                Event e;
                e.t = o.at("t").get<double>(); e.pad = o.at("pad").get<int>(); e.clip = o.at("clip").get<std::string>();
                e.gain_db = o.value("gain_db", 0.0); e.duck = o.value("duck", false); e.loop = o.value("loop", false);
                if (o.contains("dur") && o["dur"].is_number()) e.dur = o["dur"].get<double>();
                events[i] = e;
            } else if (o["op"] == "end" && events.count(i)) {
                events[i].dur = o.at("dur").get<double>();
            }
        } catch (const json::exception&) { continue; }
    }
    std::vector<Event> out;
    for (auto& kv : events) out.push_back(kv.second);
    return out;
}

Recovery recover_session(const std::string& folder) {
    Recovery r;
    Project p; std::string err;
    if (!Project::load(folder, p, err)) {
        const std::string bak = folder + "/project.json.bak";
        if (fs::exists(bak)) {                          // restore the last good copy, keeping the damaged file aside
            std::error_code ec;
            fs::rename(folder + "/project.json", folder + "/project.json.damaged", ec);
            fs::copy_file(bak, folder + "/project.json", fs::copy_options::overwrite_existing, ec);
            if (Project::load(folder, p, err)) r.notes.push_back("The session file was damaged, so your settings were restored from its automatic backup.");
        }
        if (p.root.empty()) { r.error = "That folder has no readable session file."; return r; }
    }
    const double secs = repair_wav_header(p.mic_path());
    if (secs < 0) { r.error = "There is no usable recording in that session."; return r; }
    r.seconds = secs;
    if (fs::exists(p.journal_path())) {
        auto ev = replay_journal(p.journal_path());
        if (!ev.empty()) {
            for (Event& e : ev) if (!e.dur && (e.loop || false)) {}   // loops/holds without an end run to the end of the take
            p.events = ev;
            r.notes.push_back(std::to_string(ev.size()) + " hotkey hit(s) were restored from the journal.");
        }
    }
    p.mic_duration = secs; p.recording = false;
    if (!p.save(err)) { r.error = err; return r; }
    std::error_code ec;
    fs::remove(p.journal_path(), ec);
    r.ok = true;
    return r;
}

}  // namespace ps
