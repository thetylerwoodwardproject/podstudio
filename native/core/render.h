// Offline rendering: hotkey stem, master mix and loudness normalisation. Port of podstudio/render.py.
#pragma once
#include <functional>
#include <optional>
#include <string>

#include "audio.h"
#include "dsp.h"
#include "project.h"

namespace ps {

bool read_stereo(const std::string& path, Audio& out, std::string& err);       // any channel count -> 2 channels, 48 kHz only

// Places every logged hit on a stereo timeline `length_s` long. `plain` holds pads that never duck, `duckable` the rest.
bool render_hotkeys(const Project& p, double length_s, Audio& plain, Audio& duckable, std::string& err);

// Gain that level-matches a sound effect so it sits with speech: long clips aim for -22 LUFS (capped so peaks stay
// under -3 dBFS); clips too short to measure are peak-matched to -9 dBFS.
double clip_gain_db(const Audio& clip);

struct MasterResult {
    bool ok = false;
    std::string error;
    std::optional<double> measured_lufs, final_lufs;
    double gain_db = 0, true_peak_db = -120;
    bool limited = false, denoised = false, ducked = false;
    std::vector<std::string> notes;
};

// mic (mono -> centre) + hotkeys with faders, ducking and normalisation, written to master.wav (and hotkeys.wav).
// `denoise` may be empty; if set it is given (src, dst, attenuation_db) and returns an error string ("" = ok).
using DenoiseFn = std::function<std::string(const std::string& src, const std::string& dst, double atten_db)>;
MasterResult mix_master(Project& p, const DenoiseFn& denoise, const std::function<void(const std::string&)>& progress);

}  // namespace ps
