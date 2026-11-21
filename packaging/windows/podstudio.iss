; Inno Setup script for the PodStudio installer.
;   iscc podstudio.iss /DVersion=2026.11.20-7 /DSourceDir=..\..\dist\PodStudio-2026.11.20-7 /DOutputDir=..\..\dist
; Installs for the current user by default (no administrator prompt), which also lets the in-app updater run it.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\PodStudio"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

#define AppName "PodStudio"
#define AppExe "bin\PodStudio.exe"

[Setup]
AppId={{7B1D6F5A-3C0E-4E0B-9A57-5D4F2C9E8A11}
AppName={#AppName}
AppVersion={#Version}
AppPublisher=The Tyler Woodward Project
AppPublisherURL=https://github.com/thetylerwoodwardproject/podstudio
AppSupportURL=https://github.com/thetylerwoodwardproject/podstudio/issues
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=PodStudio-{#Version}-x64-setup
SetupIconFile=podstudio.ico
UninstallDisplayIcon={app}\{#AppExe}
LicenseFile=..\..\LICENSE
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; AppUserModelID: "io.github.thetylerwoodwardproject.PodStudio"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "io.github.thetylerwoodwardproject.PodStudio"

[Run]
; normal install: offer to open PodStudio on the last page
Filename: "{app}\{#AppExe}"; Description: "Open PodStudio"; Flags: nowait postinstall skipifsilent
; in-app update: the updater passes /RELAUNCH=1 and runs this silently, so PodStudio comes back by itself
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser skipifnotsilent; Check: ShouldRelaunch

[Code]
function ShouldRelaunch: Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;
