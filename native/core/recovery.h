// Getting a session back after a crash or power cut. Same journal format as the Python app (audio/events.jsonl), so a
// take that was started in one app can be recovered by the other.
#pragma once
#include <string>
#include <vector>

#include "project.h"

namespace ps {

// Append-only record of hotkey hits while recording: one JSON object per line, flushed to disk each time, so a crash
// can lose at most a line that was half written.
class Journal {
public:
    ~Journal();
    bool start(const std::string& path);
    void hit(size_t index, const Event& e);
    void end(size_t index, double dur);
    void discard();                                     // the take finished normally: its events are in project.json
private:
    void write_line(const std::string& line);
    void* f_ = nullptr;
    std::string path_;
};

std::vector<Event> replay_journal(const std::string& path);        // a torn final line (the crash itself) is ignored

struct Recovery {
    bool ok = false;
    std::string error;
    double seconds = 0;
    std::vector<std::string> notes;
};
// Repairs the session folder in place: fixes the mic WAV's header, replays the hit journal, and clears the "recording"
// flag. Nothing is deleted except the journal once its hits are saved into project.json.
Recovery recover_session(const std::string& folder);

}  // namespace ps
