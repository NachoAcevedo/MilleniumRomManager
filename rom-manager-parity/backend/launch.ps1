$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$exe = Join-Path $root 'runtime\electron.exe'
$entry = Join-Path $root 'dist\main.bundle.js'
$data = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'MillenniumRomManager\userData'
[void][IO.Directory]::CreateDirectory($data)
$status = Join-Path $data 'window-launch-status.txt'
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
    Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -like "*$entry*" } |
        ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
        Where-Object MainWindowHandle -ne 0 |
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
        $arguments = '"' + $entry + '" --millennium-data="' + $data + '"'
        $desktop.Document.Application.ShellExecute($exe, $arguments, $root, 'open', 1)
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 200
            $app = Find-SrmWindow
        } while (!$app -and [DateTime]::UtcNow -lt $deadline)
    }
    if (!$app) { throw 'Steam ROM Manager tardó demasiado en abrir.' }
    Show-ImporterWindow $app
    [IO.File]::WriteAllText($status, 'ready')
} catch {
    [IO.File]::WriteAllText($status, $_.Exception.Message)
}