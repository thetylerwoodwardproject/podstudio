// MP3 export. Windows uses the MP3 encoder that ships with Media Foundation, so nothing extra is bundled.
#pragma once
#include <string>

#include "../core/audio.h"

namespace mp3 {
bool available();
// Encodes stereo 48 kHz audio to a constant-bitrate MP3 file. Returns "" on success, else an error message.
std::string encode(const ps::Audio& stereo, const std::string& dst_path, int kbps);
}
