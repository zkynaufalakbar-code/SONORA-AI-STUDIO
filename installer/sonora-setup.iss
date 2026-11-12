; SONORA AI STUDIO - Windows Installer Script (Inno Setup 6)
; Builds SONORA-AI-Studio-Setup.exe with custom directory choice, Desktop/Start Menu shortcuts,
; .sonora project file association, dependency checks, uninstaller, and safe upgrade preserving user data.

#define MyAppName "SONORA AI STUDIO"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Zaky Naufal A"
#define MyAppURL "https://github.com/zkynaufalakbar-code/SONORA-AI-STUDIO"
#define MyAppExeName "SONORA-AI-Studio.exe"
#define StagingDir "..\release\.staging-installer"

[Setup]
AppId={{8D6E4A2F-59B1-4F91-A72E-33C4B8891201}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=
OutputDir=..\release
OutputBaseFilename=SONORA-AI-Studio-Setup
SetupIconFile=..\src-tauri\icons\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ChangesAssociations=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startmenuicon"; Description: "Create Start Menu shortcut"; GroupDescription: "{cm:AdditionalIcons}"
Name: "associate"; Description: "Associate .sonora project files with {#MyAppName}"; GroupDescription: "File Associations"

[Files]
Source: "{#StagingDir}\SONORA-AI-Studio.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingDir}\bin\ffmpeg.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#StagingDir}\bin\ffprobe.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "..\src-tauri\icons\icon.ico"; DestDir: "{app}\icons"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icons\icon.ico"; Tasks: startmenuicon
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenuicon
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icons\icon.ico"; Tasks: desktopicon

[Registry]
; File association for .sonora project files under HKCU or HKLM depending on install privileges (SHCTX)
Root: HKA; Subkey: "Software\Classes\.sonora"; ValueType: string; ValueName: ""; ValueData: "SonoraAudioProject"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Classes\SonoraAudioProject"; ValueType: string; ValueName: ""; ValueData: "SONORA AI STUDIO Project"; Flags: uninsdeletekey; Tasks: associate
Root: HKA; Subkey: "Software\Classes\SonoraAudioProject\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\icons\icon.ico,0"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\SonoraAudioProject\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: associate

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
function IsWebView2Installed(): Boolean;
var
  Ver: String;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Ver)
         or RegQueryStringValue(HKEY_CURRENT_USER, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Ver)
         or RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Ver);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsWebView2Installed() then
  begin
    if MsgBox('Microsoft Edge WebView2 Runtime was not detected in the registry. SONORA AI STUDIO requires WebView2 to display its desktop interface. Continue installation anyway?', mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;

// Clean upgrade preserves %APPDATA%\SONORA AI STUDIO\config, database, projects, and installed AI models automatically
// because only binary application files under {app} are touched during install/upgrade/uninstall.
