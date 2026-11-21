// Custom-drawn controls: LED meters, faders, pads, toggles, tab bar, cards.
#pragma once
#include <imgui.h>

#include <string>
#include <vector>

namespace ui {

// A meter value that rises instantly and falls smoothly, with a peak-hold tick.
struct MeterState {
    float level = -90.f, peak = -90.f, hold_t = 0.f;
    void update(float db, float dt);
};

// Vertical LED meter with a dBFS ruler. `h` is the height in pixels; width is derived.
void meter_vertical(const char* id, const MeterState& m, float h, bool ruler_right = true);
// Horizontal thin meter, used in the Recordings player.
void meter_horizontal(const MeterState& m, float w, float h);

// Vertical fader, -60..+12 dB, with a detent and highlighted mark at 0 dB. Double-click resets. Returns true on change.
bool fader(const char* id, float* db, float h, unsigned color = 0xfafafa);

bool toggle(const char* id, bool* v);
bool chip(const char* label, bool selected, float min_w = 0);
bool pill_tabs(const char* const* labels, int n, int* sel, float w_each);
bool primary_button(const char* label, float w = 0, float h = 0);
bool danger_button(const char* label, float w = 0, float h = 0);
bool record_button(bool recording, float size, bool enabled);
// A hotkey pad. Returns true when clicked. `flash` 0..1 lights it. `active` shows a playing/looping state.
bool pad_button(const char* id, ImVec2 size, const char* key, const char* label, const char* mode_text, ImU32 color,
                float flash, bool active, bool empty, bool ducks);

// Card: rounded raised surface with a hairline border. Use begin/end like a child window.
bool card_begin(const char* id, ImVec2 size, const char* title = nullptr, const char* subtitle = nullptr);
void card_end();

void label_dim(const char* text);
void label_value(const char* label, const char* value, ImU32 value_color = 0);
ImVec2 text_size(ImFont* f, const char* t);
void text_at(ImDrawList* dl, ImFont* f, ImVec2 p, ImU32 col, const char* t);
// Slider with a label above, a value readout on the right, and the app's look. Returns true on change.
bool slider_row(const char* label, float* v, float lo, float hi, const char* fmt, float w, const char* hint = nullptr);

float db_to_frac(float db);                              // -60..0 -> 0..1 for the meter scale
std::string fmt_time(double s, bool tenths = false);

}  // namespace ui
