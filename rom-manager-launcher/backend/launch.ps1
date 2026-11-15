$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\steam-rom-manager'
$exe = Join-Path $root 'Steam ROM Manager.exe'
$status = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'steam-rom-manager\userData\window-launch-status.txt'
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $status))
function Show-ImporterWindow($app) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ImporterWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
}
"@
    $h = $app.MainWindowHandle
    [void][ImporterWindow]::ShowWindowAsync($h, 9)
    [void][ImporterWindow]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x43)
    [void][ImporterWindow]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x43)
    [void](New-Object -ComObject WScript.Shell).AppActivate($app.Id)
}
function Find-SrmWindow {
    Get-Process -Name 'Steam ROM Manager' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
}
try {
    $app = Find-SrmWindow
    if (!$app) {
        if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'No se encontró Steam ROM Manager.' }
        $shell = New-Object -ComObject Shell.Application
        $location = 0
        $rootLocation = 0
        $handle = 0
        $desktop = $shell.Windows().FindWindowSW([ref]$location, [ref]$rootLocation, 8, [ref]$handle, 1)
        if (!$desktop) { throw 'No se encontró el escritorio de Windows para abrir SRM de forma independiente.' }
        $desktop.Document.Application.ShellExecute($exe, '', $root, 'open', 1)
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 200
            $app = Find-SrmWindow
        } while (!$app -and [DateTime]::UtcNow -lt $deadline)
    }
    if (!$app) { throw 'Steam ROM Manager tardó demasiado en abrir.' }
    $previousSteam = Get-Process -Name steam -ErrorAction SilentlyContinue |
        Where-Object SessionId -eq $app.SessionId | Select-Object -First 1
    Show-ImporterWindow $app
    [IO.File]::WriteAllText($status, 'ready')
} catch {
    [IO.File]::WriteAllText($status, $_.Exception.Message)
}
if ($app -and $previousSteam) {
    $lock = [Threading.Mutex]::new($false, "Local\MillenniumSrmRestart-$($app.Id)")
    try {
        if ($lock.WaitOne(0)) {
            try {
                while (!$app.HasExited) {
                    if ($previousSteam.HasExited) {
                        $steam = Get-Process -Name steam -ErrorAction SilentlyContinue |
                            Where-Object { $_.SessionId -eq $app.SessionId -and $_.Id -ne $previousSteam.Id } |
                            Select-Object -First 1
                        $window = if ($steam) { Get-Process -Name steamwebhelper -ErrorAction SilentlyContinue |
                            Where-Object { $_.SessionId -eq $app.SessionId -and $_.MainWindowHandle -ne 0 -and $_.StartTime -ge $steam.StartTime } |
                            Select-Object -First 1 }
                        if ($steam -and $window) {
                            [void]$app.CloseMainWindow()
                            break
                        }
                    }
                    Start-Sleep -Milliseconds 750
                }
            } finally { $lock.ReleaseMutex() }
        }
    } finally { $lock.Dispose() }
}