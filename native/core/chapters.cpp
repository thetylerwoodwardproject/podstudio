#include "chapters.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace ps {

std::string fmt_chapter_time(double t, bool tenths) {
    t = std::max(0.0, t);
    const long whole = long(t), h = whole / 3600, m = (whole / 60) % 60, s = whole % 60;
    char b[40];
    if (h) std::snprintf(b, sizeof b, "%ld:%02ld:%02ld", h, m, s); else std::snprintf(b, sizeof b, "%ld:%02ld", m, s);
    std::string o = b;
    if (tenths) o += "." + std::to_string(int((t - double(whole)) * 10));
    return o;
}

std::vector<Chapter> normalize_chapters(std::vector<Chapter> in, double duration, std::vector<std::string>& notes) {
    for (auto& c : in) {
        size_t a = c.title.find_first_not_of(" \t\r\n"), z = c.title.find_last_not_of(" \t\r\n");
        c.title = a == std::string::npos ? "" : c.title.substr(a, z - a + 1);
    }
    std::stable_sort(in.begin(), in.end(), [](const Chapter& a, const Chapter& b) { return a.t < b.t; });
    std::vector<Chapter> kept;
    for (const Chapter& c : in) {
        if (c.title.empty()) notes.push_back("Skipped the chapter at " + fmt_chapter_time(c.t) + ": it has no title.");
        else if (duration > 0 && c.t >= duration) notes.push_back("Skipped \"" + c.title + "\" at " + fmt_chapter_time(c.t) + ": it starts after the episode ends.");
        else if (!kept.empty() && std::fabs(c.t - kept.back().t) < 1.0) notes.push_back("Skipped \"" + c.title + "\": it is within a second of \"" + kept.back().title + "\".");
        else kept.push_back(c);
    }
    if (!kept.empty() && kept.front().t > 0.5) {
        kept.insert(kept.begin(), Chapter{0.0, "Intro"});
        notes.push_back("Added an \"Intro\" chapter at 0:00. Podcast apps expect the first chapter to start at the beginning.");
    } else if (!kept.empty()) kept.front().t = 0.0;
    return kept;
}

}  // namespace ps
