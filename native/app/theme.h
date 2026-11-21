// Visual design: the same zinc/shadcn dark palette as the Python app, drawn with Dear ImGui.
#pragma once
#include <imgui.h>

namespace theme {

inline ImU32 hex(unsigned rgb, float alpha = 1.0f) {
    return IM_COL32((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, int(alpha * 255));
}
inline ImVec4 hexv(unsigned rgb, float alpha = 1.0f) { return ImGui::ColorConvertU32ToFloat4(hex(rgb, alpha)); }
ImU32 parse_color(const char* css, ImU32 fallback);          // "#rrggbb"

constexpr unsigned kBg = 0x09090b, kRaised = 0x18181b, kMuted = 0x27272a, kLine = 0x27272a, kLine2 = 0x3f3f46;
constexpr unsigned kText = 0xfafafa, kDim = 0xa1a1aa, kFaint = 0x71717a;
constexpr unsigned kAccent = 0xef4444, kOk = 0x22c55e, kWarn = 0xf59e0b;

struct Fonts {
    ImFont* body = nullptr;       // 15 px
    ImFont* sm = nullptr;         // 12.5 px
    ImFont* semibold = nullptr;   // 15 px
    ImFont* title = nullptr;      // 22 px semibold
    ImFont* mono = nullptr;       // 14 px, tabular digits
    ImFont* mono_big = nullptr;   // 46 px
};
extern Fonts fonts;

// Loads fonts for the given UI scale (DPI) and applies the style. Call once before the first frame, and again
// (after clearing the atlas) if the scale changes.
void setup(float scale);
extern float scale;
inline float px(float v) { return v * scale; }

}  // namespace theme
