#include "theme.h"

#include <cstdio>
#include <cstdlib>

#include "fonts/cousine.inc"
#include "fonts/inter_regular.inc"
#include "fonts/inter_semibold.inc"

namespace theme {

Fonts fonts;
float scale = 1.0f;

ImU32 parse_color(const char* css, ImU32 fallback) {
    unsigned r, g, b;
    if (css && css[0] == '#' && std::sscanf(css + 1, "%2x%2x%2x", &r, &g, &b) == 3) return IM_COL32(r, g, b, 255);
    return fallback;
}

void setup(float s) {
    scale = s;
    ImGuiIO& io = ImGui::GetIO();
    io.Fonts->Clear();
    static const ImWchar ranges[] = {0x0020, 0x00FF, 0x2010, 0x2027, 0x2190, 0x2193, 0x2212, 0x2212, 0x2022, 0x2022, 0};
    ImFontConfig cfg;
    cfg.OversampleH = 2; cfg.OversampleV = 2;
    cfg.PixelSnapH = false;
    auto add = [&](const char* b85, float size) {
        return io.Fonts->AddFontFromMemoryCompressedBase85TTF(b85, size * s, &cfg, ranges);
    };
    fonts.body = add(inter_regular_compressed_data_base85, 15.0f);
    fonts.small = add(inter_regular_compressed_data_base85, 12.5f);
    fonts.semibold = add(inter_semibold_compressed_data_base85, 15.0f);
    fonts.title = add(inter_semibold_compressed_data_base85, 22.0f);
    fonts.mono = add(cousine_compressed_data_base85, 14.0f);
    fonts.mono_big = add(cousine_compressed_data_base85, 46.0f);
    io.FontDefault = fonts.body;

    ImGuiStyle& st = ImGui::GetStyle();
    st = ImGuiStyle();
    st.WindowRounding = 0; st.FrameRounding = 8 * s; st.ChildRounding = 12 * s; st.PopupRounding = 10 * s;
    st.GrabRounding = 8 * s; st.ScrollbarRounding = 8 * s; st.TabRounding = 8 * s;
    st.WindowBorderSize = 0; st.ChildBorderSize = 1; st.FrameBorderSize = 1; st.PopupBorderSize = 1;
    st.WindowPadding = ImVec2(0, 0); st.FramePadding = ImVec2(12 * s, 7 * s);
    st.ItemSpacing = ImVec2(10 * s, 10 * s); st.ItemInnerSpacing = ImVec2(8 * s, 6 * s);
    st.ScrollbarSize = 10 * s; st.GrabMinSize = 14 * s;
    st.SeparatorTextBorderSize = 1;

    ImVec4* c = st.Colors;
    c[ImGuiCol_Text] = hexv(kText);                 c[ImGuiCol_TextDisabled] = hexv(kFaint);
    c[ImGuiCol_WindowBg] = hexv(kBg);               c[ImGuiCol_ChildBg] = hexv(0, 0);
    c[ImGuiCol_PopupBg] = hexv(0x111113);           c[ImGuiCol_Border] = hexv(kLine);
    c[ImGuiCol_BorderShadow] = hexv(0, 0);
    c[ImGuiCol_FrameBg] = hexv(kRaised);            c[ImGuiCol_FrameBgHovered] = hexv(0x1f1f23);
    c[ImGuiCol_FrameBgActive] = hexv(kMuted);
    c[ImGuiCol_Button] = hexv(kRaised);             c[ImGuiCol_ButtonHovered] = hexv(kMuted);
    c[ImGuiCol_ButtonActive] = hexv(kLine2);
    c[ImGuiCol_Header] = hexv(kMuted);              c[ImGuiCol_HeaderHovered] = hexv(0x303034);
    c[ImGuiCol_HeaderActive] = hexv(kLine2);
    c[ImGuiCol_SliderGrab] = hexv(kText);           c[ImGuiCol_SliderGrabActive] = hexv(0xd4d4d8);
    c[ImGuiCol_CheckMark] = hexv(kText);
    c[ImGuiCol_ScrollbarBg] = hexv(0, 0);           c[ImGuiCol_ScrollbarGrab] = hexv(kLine2);
    c[ImGuiCol_ScrollbarGrabHovered] = hexv(kFaint); c[ImGuiCol_ScrollbarGrabActive] = hexv(kDim);
    c[ImGuiCol_Separator] = hexv(kLine);
    c[ImGuiCol_TextSelectedBg] = hexv(0x3b82f6, 0.45f);
    c[ImGuiCol_NavHighlight] = hexv(0, 0);
    c[ImGuiCol_ModalWindowDimBg] = hexv(0, 0.6f);
}

}  // namespace theme
