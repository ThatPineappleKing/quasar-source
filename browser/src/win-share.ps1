# Quasar: Windows' share panel (Nearby Share, Mail, Teams, Phone Link…) for a web address.
# Electron has no share API on Windows, so this small helper opens the panel itself: a
# tiny, nearly invisible window of its own (the panel has to belong to a window of the
# process that asks), DataTransferManager for that window, and the page's address and
# title as what's shared. Prints "Shown" once the panel is up; exits when it closes.
#   -Url, -Title   what to share       -X, -Y   where Quasar's window is (screen pixels)
param([string]$Url, [string]$Title = '', [int]$X = 200, [int]$Y = 200, [string]$Parent = '0')

$ErrorActionPreference = 'Stop'
if (-not ($Url -match '^https?://')) { 'Error'; exit 1 }
try {
  Add-Type -AssemblyName System.Windows.Forms
  $null = [Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]
  $null = [Windows.ApplicationModel.DataTransfer.DataPackage, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDataTransferManagerInterop {
  IntPtr GetForWindow([In] IntPtr appWindow, [In] ref Guid riid);
  void ShowShareUIForWindow(IntPtr appWindow);
}

public static class QuasarShareInterop {
  [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string s, int len, out IntPtr h);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr cls, [In] ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);
  const string Cls = "Windows.ApplicationModel.DataTransfer.DataTransferManager";

  static IDataTransferManagerInterop Interop() {
    IntPtr h; WindowsCreateString(Cls, Cls.Length, out h);
    try {
      Guid iid = typeof(IDataTransferManagerInterop).GUID; object f;
      int hr = RoGetActivationFactory(h, ref iid, out f);
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      return (IDataTransferManagerInterop)f;
    } finally { WindowsDeleteString(h); }
  }
  // The window's DataTransferManager (as an IInspectable pointer PowerShell can wrap).
  public static object ForWindow(IntPtr hwnd) {
    Guid iid = new Guid("A5CAEE9B-8708-49D1-8D36-67D25A8DA00C");
    IntPtr p = Interop().GetForWindow(hwnd, ref iid);
    try { return Marshal.GetObjectForIUnknown(p); } finally { Marshal.Release(p); }
  }
  public static void Show(IntPtr hwnd) { Interop().ShowShareUIForWindow(hwnd); }
}
'@

  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.ShowInTaskbar = $false
  $form.StartPosition = 'Manual'
  $form.Size = New-Object System.Drawing.Size(2, 2)
  $form.Location = New-Object System.Drawing.Point(($X - 1), ($Y - 1))
  $form.Opacity = 0.01
  $form.TopMost = $true
  $form.Text = 'Share'
  $shown = $false
  $form.Add_Shown({
    try {
      $dtm = [QuasarShareInterop]::ForWindow($form.Handle)
      $dtm.add_DataRequested({
        param($sender, $e)
        $pkg = $e.Request.Data
        $pkg.Properties.Title = $(if ($Title) { $Title } else { $Url })
        $pkg.Properties.Description = $Url
        $pkg.SetWebLink([Uri]$Url)
        $pkg.SetText($Url)
      })
      [QuasarShareInterop]::Show($form.Handle)
      $script:shown = $true
      [Console]::Out.WriteLine('Shown'); [Console]::Out.Flush()
    } catch { [Console]::Out.WriteLine('Error: ' + $_.Exception.Message); $form.Close() }
  })
  # The panel closes (shared or dismissed): our window gets focus back, or we time out.
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 120000
  $timer.Add_Tick({ $form.Close() })
  $timer.Start()
  $form.Add_Activated({ if ($script:shown) { $script:activations++; if ($script:activations -gt 1) { $form.Close() } } })
  $script:activations = 0
  [System.Windows.Forms.Application]::Run($form)
} catch {
  'Error: ' + $_.Exception.Message
  exit 1
}
