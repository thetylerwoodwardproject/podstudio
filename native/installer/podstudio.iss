; Inno Setup script for the native PodStudio.
;   iscc podstudio.iss /DVersion=2026.11.20-8 /DSourceDir=<folder with PodStudio.exe> /DOutputDir=<where to write>
; Installs for the current user (no administrator prompt). It also upgrades over the earlier Python/GTK build of
; PodStudio: that build's folders are removed, the sessions in your Music folder are never touched.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\native"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif
#define AppName "PodStudio"

[Setup]
AppId={{7B1D6F5A-3C0E-4E0B-9A57-5D4F2C9E8A11}
AppName={#AppName}
AppVersion={#Version}
AppPublisher=The Tyler Woodward Project
AppPublisherURL=https://github.com/thetylerwoodwardproject/podstudio
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
SetupIconFile=..\..\packaging\windows\podstudio.ico
UninstallDisplayIcon={app}\PodStudio.exe
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

[InstallDelete]
; folders of the earlier Python/GTK build
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\lib"
Type: filesandordirs; Name: "{app}\libexec"
Type: filesandordirs; Name: "{app}\share"
Type: filesandordirs; Name: "{app}\etc"
Type: filesandordirs; Name: "{app}\ssl"
Type: files; Name: "{app}\VERSION"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\PodStudio.exe"; WorkingDir: "{app}"; AppUserModelID: "io.github.thetylerwoodwardproject.PodStudio"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\PodStudio.exe"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "io.github.thetylerwoodwardproject.PodStudio"

[Run]
Filename: "{app}\PodStudio.exe"; Description: "Open PodStudio"; Flags: nowait postinstall skipifsilent
