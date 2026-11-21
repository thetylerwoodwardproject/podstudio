// Offline noise reduction by running the upstream DeepFilterNet command-line tool (MIT / Apache-2.0).
#pragma once
#include <string>

namespace denoise {
std::string find_binary();                                // "" if not found: next to the app, in bin\, in $PODSTUDIO_DEEPFILTER, on PATH
bool available();
// Writes a noise-reduced copy of src to dst (same length, 48 kHz, 24-bit). Returns "" on success, else an error message.
std::string run(const std::string& src, const std::string& dst, double atten_db);
}
