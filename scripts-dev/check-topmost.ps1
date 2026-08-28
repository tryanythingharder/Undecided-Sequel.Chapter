# Check WS_EX_TOPMOST style of a specific window handle (HWND)
param([long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
}
"@
$h = [IntPtr]$Hwnd
if ($h -eq [IntPtr]::Zero) { Write-Output "BADHWND"; exit }
$ex = [W]::GetWindowLong($h, -20)
$topmost = ($ex -band 0x8) -ne 0
Write-Output "TOPMOST=$topmost EXSTYLE=0x$($ex.ToString('X'))"
