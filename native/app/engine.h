// Audio engine: capture + metering + recording, pad playback mixer with live ducking, and a preview player.
// Built on miniaudio (WASAPI on Windows). The audio callbacks never take a lock or touch the disk.
#pragma once
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../core/audio.h"

struct ma_device;
struct ma_context;
struct ma_decoder;

namespace ps {

struct InputInfo {
    std::string name;
    std::vector<unsigned char> id;       // opaque ma_device_id
    bool podmic = false;
};

// A decoded sound effect: stereo, 48 kHz, kept in memory for the life of the program (voices point at it).
struct Clip {
    std::string path;
    std::vector<float> data;             // frames * 2
    size_t frames() const { return data.size() / 2; }
};

// Decodes any file miniaudio understands (WAV, MP3, FLAC) to stereo 48 kHz.
bool decode_file(const std::string& path, Audio& out, std::string& err);

// Min/max per bin for a waveform picture, read in chunks so memory stays flat for long files.
bool compute_peaks(const std::string& path, int bins, std::vector<float>& mins, std::vector<float>& maxs,
                   double& duration_s, std::string& err);

class Engine {
public:
    Engine();
    ~Engine();
    bool init(std::string& err);

    // -- input
    std::vector<InputInfo> list_inputs();
    bool open_input(const InputInfo& in, std::string& err);
    bool open_demo(std::string& err);                // a synthetic "voice", for screenshots and testing without a mic
    void close_input();
    bool input_open() const { return input_open_.load(); }
    // Levels are measured per block in the audio thread. mic_* are after the mic fader; voice is before it.
    float mic_rms_db() const { return mic_rms_.load(); }
    float mic_peak_db() const { return mic_peak_.load(); }
    float voice_rms_db() const { return voice_rms_.load(); }
    void set_mic_fader_db(float db) { mic_fader_db_.store(db); }

    // -- recording (48 kHz, 24-bit, mono)
    bool start_recording(const std::string& path, std::string& err);
    size_t stop_recording();                         // returns frames written
    bool recording() const { return recording_.load(); }
    double rec_seconds() const { return double(rec_frames_.load()) / kRate; }
    bool rec_overflowed() const { return rec_overflow_.load(); }

    // -- pads and ducking
    int play(const Clip* clip, double gain_db, bool loop, bool duck, int handle);   // returns a voice index or -1
    void stop_handle(int handle, int fade_ms = 25);
    bool handle_active(int handle) const;
    void stop_all();
    void set_hotkeys_fader_db(float db) { hk_fader_db_.store(db); }
    void set_hotkeys_muted(bool m) { hk_muted_.store(m); }
    void set_ducking(double amount_db, double threshold_db, double release_ms);
    float hotkeys_peak_db() const { return hk_peak_.load(); }
    float master_peak_db() const { return master_peak_.load(); }
    float duck_db() const { return duck_now_db_.load(); }

    // -- preview of recorded files
    bool preview_open(const std::string& path, std::string& err);
    void preview_close();
    void preview_play(bool play);
    void preview_seek(double seconds);
    double preview_position() const;
    double preview_duration() const { return preview_dur_.load(); }
    bool preview_playing() const { return preview_playing_.load(); }
    bool preview_ended();                            // true once after playback reaches the end
    float preview_peak_db() const { return preview_peak_.load(); }

    // -- internals the C callbacks need
    void on_capture(const float* in, unsigned frames);
    void on_playback(float* out, unsigned frames);

private:
    struct Voice {
        std::atomic<bool> active{false};
        std::atomic<bool> loop{false};
        std::atomic<bool> stopping{false};
        std::atomic<int> fade_samples{1200};
        std::atomic<int> handle{-1};
        const Clip* clip = nullptr;
        size_t pos = 0;
        float gain = 1.0f, fade = 1.0f, fade_step = 0.0f;
        bool duck = false;
    };
    static constexpr int kVoices = 48;

    void writer_loop();
    void demo_loop();

    ma_context* ctx_ = nullptr;
    ma_device* cap_ = nullptr;
    ma_device* play_ = nullptr;
    std::atomic<bool> input_open_{false}, demo_{false};
    std::thread demo_thread_;
    std::atomic<float> mic_rms_{-90.f}, mic_peak_{-90.f}, voice_rms_{-90.f}, mic_fader_db_{0.f};

    // recording: callback -> ring -> writer thread -> disk
    std::atomic<bool> recording_{false}, rec_overflow_{false}, writer_run_{false};
    std::atomic<unsigned long long> rec_frames_{0};
    struct Ring;
    std::unique_ptr<Ring> ring_;
    std::thread writer_;
    WavWriter wav_;
    std::string rec_path_;

    // mixer
    Voice voices_[kVoices];
    std::atomic<float> hk_fader_db_{0.f}, hk_peak_{-90.f}, master_peak_{-90.f}, duck_now_db_{0.f};
    std::atomic<bool> hk_muted_{false};
    std::atomic<float> duck_amount_{12.f}, duck_thresh_{-40.f}, duck_release_ms_{350.f};
    float duck_state_db_ = 0.f;                      // capture thread only, smoothed ducking in dB (<= 0)
    std::atomic<float> duck_gain_lin_{1.f};

    // preview
    std::mutex prev_mu_;
    ma_decoder* prev_ = nullptr;
    std::atomic<bool> preview_playing_{false}, preview_end_{false};
    std::atomic<double> preview_dur_{0.0};
    std::atomic<unsigned long long> prev_pos_{0};
    std::atomic<float> preview_peak_{-90.f};
};

}  // namespace ps
