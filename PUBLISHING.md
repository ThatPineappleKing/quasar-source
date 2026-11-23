# Publishing Quasar updates

Quasar now ships as an installer (`Quasar-Setup-<version>.exe`). Installed copies check your
GitHub repo's **Releases** every time they start (a few seconds in) and every 4 hours after that. They
download a new version in the background and install it when Quasar is closed, or right away
if the user clicks **Restart to update**.

## One-time setup

### 1. Make a GitHub account
Sign up at <https://github.com/signup> if you don't have an account. Then turn on two-factor
sign-in (**Settings › Password and authentication**), because whoever controls this account
can push software to your friends' PCs.

### 2. Create the repo
1. Go to <https://github.com/new>.
2. Repository name: **quasar**
3. Choose **Public**. Installed copies can't download from a private repo.
4. Tick **Add a README file**, because releases need at least one commit.
5. Click **Create repository**.

Only the installer is uploaded. Your source code stays on your PC.

### 3. Install the GitHub CLI and sign in
In PowerShell:

```
winget install GitHub.cli
```

Close and reopen PowerShell, then run:

```
gh auth login
```

Pick **GitHub.com**, then **HTTPS**, then **Login with a web browser**, and enter the code it shows.

### 4. Publish 1.3.0 (the first time, add your GitHub name)
From the project folder (`C:\Users\happy\Arc+Chrome`):

```
powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -Owner YOUR-GITHUB-NAME -Notes "Quasar now updates itself."
```

This builds `dist\installer\Quasar-Setup-1.3.0.exe` with your repo built in, and creates the
release **v1.3.0** with three files: the `.exe`, the `.blockmap` (used for smaller updates) and
`latest.yml` (what installed copies read). Your name and repo are saved in `tools\github.json`.

> **Never change the owner or repo name afterwards.** Every installed copy looks only in the
> repo it was built with. If you rename the repo, GitHub redirects for a while, but don't rely on it.

### 5. Send your friends the installer, once
Send them **https://github.com/YOUR-GITHUB-NAME/quasar/releases/latest**. They should:
1. Close the old Quasar, then download and run `Quasar-Setup-1.3.0.exe`.
   - If Windows SmartScreen says "Windows protected your PC", click **More info › Run anyway**.
     The app isn't code-signed.
2. Quasar installs without asking any questions and opens. Their bookmarks, logins and
   settings carry over, because they're stored in `%APPDATA%\Quasar`, not in the app folder.
3. Delete the old unzipped Quasar folder.

## Every update after that
1. Make your changes.
2. Raise the version in `browser\package.json` and the **Version** line in `browser\README.md`.
3. Run:

```
powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -Notes "What changed, in a sentence"
```

That's all. Your friends' Quasar picks it up within a few hours, or the next time they open it.
The notes appear in the "ready to update" message, so keep them short.

## Good to know
- **Test without publishing:** add `-BuildOnly` to build the installer without uploading it.
- **Pulling a bad release:** on GitHub, open the release and delete it, then publish a fixed
  version with a **higher** number. Installed copies never move to a lower version by themselves.
- **Electron security fixes** now reach friends only through your releases. Run
  `npm update electron` in `browser\` before a release now and then.
- **Turning updates off:** friends can untick "Download Quasar updates automatically" in
  Settings › Updates. They're then asked before anything downloads.
- **Uninstall:** Windows Settings › Apps › Quasar. Their data in `%APPDATA%\Quasar` is kept.
