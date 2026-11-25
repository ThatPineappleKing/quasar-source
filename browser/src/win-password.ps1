# Quasar: "is this really you?" with the Windows account password, for PCs without
# Windows Hello (like Chrome does). Shows the standard Windows Security sign-in box for
# the signed-in account, has Windows check the password (LogonUser), and only answers
# "Verified" if it belongs to the same account that's running Quasar, so another
# account's password doesn't count. The password stays inside this process; Quasar only
# gets one word back: Verified, Denied, Cancelled or Error.
#   -Message  the line shown in the box    -Parent  the Quasar window handle (optional)
param([string]$Message = 'Quasar wants to show your saved passwords.', [long]$Parent = 0)

$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class QuasarWinPassword {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDUI_INFO { public int cbSize; public IntPtr hwndParent; public string pszMessageText; public string pszCaptionText; public IntPtr hbmBanner; }

  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  static extern int CredUIPromptForWindowsCredentials(ref CREDUI_INFO info, int authError, ref uint authPackage, IntPtr inBuf, uint inSize,
    out IntPtr outBuf, out uint outSize, ref bool save, int flags);
  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  static extern bool CredUnPackAuthenticationBuffer(int flags, IntPtr buf, uint size, StringBuilder user, ref int userLen,
    StringBuilder domain, ref int domainLen, StringBuilder pass, ref int passLen);
  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  static extern int CredUIParseUserName(string user, StringBuilder name, int nameMax, StringBuilder domain, int domainMax);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool LogonUser(string user, string domain, string pass, int type, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);

  const int CREDUIWIN_ENUMERATE_CURRENT_USER = 0x200;
  const int ERROR_LOGON_FAILURE = 1326;

  public static string Ask(string message, long parent) {
    SecurityIdentifier me = WindowsIdentity.GetCurrent().User;
    CREDUI_INFO info = new CREDUI_INFO();
    info.cbSize = Marshal.SizeOf(typeof(CREDUI_INFO));
    info.hwndParent = new IntPtr(parent);
    info.pszCaptionText = "Quasar";
    info.pszMessageText = message + " Enter your Windows password to continue.";
    for (int attempt = 0; attempt < 3; attempt++) {
      uint pkg = 0; IntPtr outBuf; uint outSize; bool save = false;
      int r = CredUIPromptForWindowsCredentials(ref info, attempt == 0 ? 0 : ERROR_LOGON_FAILURE, ref pkg, IntPtr.Zero, 0,
        out outBuf, out outSize, ref save, CREDUIWIN_ENUMERATE_CURRENT_USER);
      if (r != 0) return "Cancelled";
      StringBuilder user = new StringBuilder(514), dom = new StringBuilder(338), pass = new StringBuilder(514);
      int ul = 514, dl = 338, pl = 514;
      bool unpacked = CredUnPackAuthenticationBuffer(0, outBuf, outSize, user, ref ul, dom, ref dl, pass, ref pl);
      for (int i = 0; i < outSize; i++) Marshal.WriteByte(outBuf, i, 0);
      CoTaskMemFree(outBuf);
      if (!unpacked) return "Error";
      string u = user.ToString(), d = dom.ToString();
      StringBuilder pn = new StringBuilder(514), pd = new StringBuilder(338);
      if (CredUIParseUserName(u, pn, 514, pd, 338) == 0) { u = pn.ToString(); d = pd.ToString(); }
      if (string.IsNullOrEmpty(d)) d = ".";
      IntPtr token;
      bool good = LogonUser(u, d, pass.ToString(), 3 /* network */, 0, out token) || LogonUser(u, d, pass.ToString(), 2 /* interactive */, 0, out token);
      pass.Clear();
      if (good) {
        try {
          // The right password, but for this account? (Another account's password doesn't count.)
          using (WindowsIdentity who = new WindowsIdentity(token)) { if (who.User != null && who.User.Equals(me)) return "Verified"; }
          return "Denied";
        } finally { CloseHandle(token); }
      }
    }
    return "Denied";
  }
}
'@
  Write-Output ([QuasarWinPassword]::Ask($Message, $Parent))
} catch {
  Write-Output 'Error'
}
