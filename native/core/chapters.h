// Chapter markers: the checks Buzzsprout and podcast apps care about. Port of podstudio/chapters.py.
#pragma once
#include <string>
#include <vector>

#include "project.h"

namespace ps {

std::string fmt_chapter_time(double t, bool tenths = false);       // 0:00 / 12:34 / 1:02:03
// What will actually be sent: sorted, titled, inside the episode, starting at 0:00. `notes` explains every change.
std::vector<Chapter> normalize_chapters(std::vector<Chapter> in, double duration, std::vector<std::string>& notes);

}  // namespace ps
