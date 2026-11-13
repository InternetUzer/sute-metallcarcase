#define MyAppVersion "0.3.0"
[Setup]
AppId={{78D1E957-1A68-41DC-A7E3-9E33592E7A47}
AppName=Контур
AppVersion={#MyAppVersion}
AppPublisher=Kontur Workspace
DefaultDirName={localappdata}\Programs\Kontur
DefaultGroupName=Контур
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=Kontur-Setup-0.3.0
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Kontur.exe
[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
[Files]
Source: "..\..\dist\Kontur\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Контур"; Filename: "{app}\Kontur.exe"
Name: "{userdesktop}\Контур"; Filename: "{app}\Kontur.exe"
[Run]
Filename: "{app}\Kontur.exe"; Description: "Открыть Контур"; Flags: nowait postinstall skipifsilent
