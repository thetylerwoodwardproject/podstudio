#ifndef _WIN32
#include "mp3.h"
namespace mp3 {
bool available() { return false; }
std::string encode(const ps::Audio&, const std::string&, int) { return "MP3 export is only available on Windows in this build"; }
}
#endif
