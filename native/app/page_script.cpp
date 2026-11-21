#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>

#include "app.h"
#include <misc/cpp/imgui_stdlib.h>
#include "platform.h"
#include "theme.h"

using namespace theme;

namespace ps {

void App::page_script(ImVec2 avail) {
    if (!have_proj_) return;
    ImGuiIO& io = ImGui::GetIO();
    const float gap = px(16);

    // controls row
    if (ui::chip("Edit", !prompter_, px(70))) prompter_ = false;
    ImGui::SameLine();
    if (ui::chip("Prompter", prompter_, px(90))) prompter_ = true;
    ImGui::SameLine(0, px(24));
    if (prompter_) {
        if (ui::primary_button(prompter_run_ ? "Pause  (F8)" : "Start scrolling  (F8)", px(190), px(34))) prompter_run_ = !prompter_run_;
        ImGui::SameLine(0, px(18));
        ImGui::AlignTextToFramePadding(); ui::label_dim("Speed");
        ImGui::SameLine();
        ImGui::SetNextItemWidth(px(180));
        ImVec2 sp = ImGui::GetCursorScreenPos();
        ImGui::InvisibleButton("##spd", ImVec2(px(180), px(34)));
        if (ImGui::IsItemActive()) prompter_speed_ = std::max(1.f, std::min(10.f, 1.f + (io.MousePos.x - sp.x) / px(180) * 9.f));
        ImDrawList* dl = ImGui::GetWindowDrawList();
        float f = (prompter_speed_ - 1.f) / 9.f;
        dl->AddRectFilled(ImVec2(sp.x, sp.y + px(15)), ImVec2(sp.x + px(180), sp.y + px(19)), hex(kMuted), px(2));
        dl->AddRectFilled(ImVec2(sp.x, sp.y + px(15)), ImVec2(sp.x + px(180) * f, sp.y + px(19)), hex(kText), px(2));
        dl->AddCircleFilled(ImVec2(sp.x + px(180) * f, sp.y + px(17)), px(7.5f), hex(kText), 20);
        ImGui::SameLine(0, px(12));
        char b[16]; std::snprintf(b, sizeof b, "%.0f", double(prompter_speed_));
        ImGui::AlignTextToFramePadding(); ui::label_dim(b);
        ImGui::SameLine(0, px(18));
        if (ImGui::Button("A-", ImVec2(px(40), px(34)))) prompter_size_ = std::max(0.6f, prompter_size_ - 0.15f);
        ImGui::SameLine();
        if (ImGui::Button("A+", ImVec2(px(40), px(34)))) prompter_size_ = std::min(2.6f, prompter_size_ + 0.15f);
        ImGui::SameLine(0, px(18));
        ImGui::AlignTextToFramePadding(); ui::label_dim("Start when I record");
        ImGui::SameLine();
        ui::toggle("##wrec", &prompter_with_rec_);
    } else {
        if (ImGui::Button("Import...", ImVec2(px(100), px(34)))) {
            std::string f = platform::open_file_dialog("Import a script", "Text files", "*.txt;*.md");
            if (!f.empty()) {
                std::ifstream in(f, std::ios::binary); std::stringstream ss; ss << in.rdbuf();
                if (script_.empty()) script_ = ss.str(); else script_ += "\n\n" + ss.str();
                script_dirty_ = true; script_save_at_ = now_ + 0.8;
            }
        }
        ImGui::SameLine();
        if (ImGui::Button("Export...", ImVec2(px(100), px(34)))) {
            std::string f = platform::save_file_dialog("Export the script", "Text files", "*.txt", "script.txt");
            if (!f.empty()) { std::ofstream out(f, std::ios::binary | std::ios::trunc); out << script_; }
        }
        ImGui::SameLine(0, px(18));
        ui::label_dim("Saved with the session.");
    }
    if (ImGui::IsKeyPressed(ImGuiKey_F8, false)) { prompter_ = true; prompter_run_ = !prompter_run_; }
    ImGui::Dummy(ImVec2(0, px(6)));

    const float h = avail.y - px(76);
    if (!prompter_) {
        ImGui::PushFont(fonts.body);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, hexv(0x0a0a0c));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(px(22), px(18)));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, px(14));
        if (ImGui::InputTextMultiline("##script", &script_, ImVec2(avail.x, h), ImGuiInputTextFlags_AllowTabInput)) {
            script_dirty_ = true; script_save_at_ = now_ + 1.0;
        }
        ImGui::PopStyleVar(2); ImGui::PopStyleColor(); ImGui::PopFont();
        if (script_.empty()) {
            ImVec2 p = ImGui::GetItemRectMin();
            ImGui::GetWindowDrawList()->AddText(fonts.body, fonts.body->FontSize, ImVec2(p.x + px(23), p.y + px(19)), hex(kFaint),
                                                 "Write or paste your script, notes or outline here.");
        }
    } else {
        // teleprompter: big wrapped text, scrolled by time
        ImGui::PushStyleColor(ImGuiCol_ChildBg, hexv(0x050506));
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, px(14));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(60), px(40)));
        ImGui::BeginChild("##prompter", ImVec2(avail.x, h), ImGuiChildFlags_Borders | ImGuiChildFlags_AlwaysUseWindowPadding);
        if (prompter_run_) {
            prompter_scroll_ += io.DeltaTime * (14.f + prompter_speed_ * 14.f) * theme::scale;
            ImGui::SetScrollY(prompter_scroll_);
            if (ImGui::GetScrollY() < prompter_scroll_ - 2.f) prompter_run_ = false;    // reached the end
        } else prompter_scroll_ = ImGui::GetScrollY();
        if (ImGui::IsKeyPressed(ImGuiKey_Home)) prompter_scroll_ = 0;
        if (ImGui::IsKeyPressed(ImGuiKey_UpArrow)) prompter_speed_ = std::min(10.f, prompter_speed_ + 1);
        if (ImGui::IsKeyPressed(ImGuiKey_DownArrow)) prompter_speed_ = std::max(1.f, prompter_speed_ - 1);
        if (ImGui::IsKeyPressed(ImGuiKey_Space, false)) prompter_run_ = !prompter_run_;
        ImGui::SetWindowFontScale(prompter_size_ * 1.9f);
        ImGui::PushTextWrapPos(ImGui::GetContentRegionAvail().x);
        ImGui::Dummy(ImVec2(0, h * 0.35f));
        ImGui::TextUnformatted(script_.empty() ? "Your script will appear here." : script_.c_str());
        ImGui::Dummy(ImVec2(0, h * 0.8f));
        ImGui::PopTextWrapPos();
        ImGui::EndChild();
        ImGui::PopStyleVar(2); ImGui::PopStyleColor();
    }
    (void)gap;
}

}  // namespace ps
