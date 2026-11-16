# SCUM Server Switcher

[中文](README.md) | **English**

Switch **saves + mods + launcher** between SCUM private servers with one click. Before switching, the app saves your current progress back to the matching server folder; if anything fails, it rolls back automatically. No more manually moving `Saved` and `~Mods`.

- Platform: Windows 10 / 11 (64-bit)
- Current version: **v1.0.2**
- Portable: unzip and run, no installer
- Local only: no network access, no telemetry, no data uploads

> **First time? Read the [Player Guide](docs/Player-Guide-EN.md).** This README also covers preparation and how switching works.

---

## Contents

- [What problem it solves](#what-problem-it-solves)
- [What you need before you start](#what-you-need-before-you-start)
- [Download and launch](#download-and-launch)
- [First-time setup](#first-time-setup)
- [Daily switching](#daily-switching)
- [What happens during a switch](#what-happens-during-a-switch)
- [Copy mode vs junction mode](#copy-mode-vs-junction-mode)
- [Missing target save or mod folder](#missing-target-save-or-mod-folder)
- [Launcher detection and command-line keyword](#launcher-detection-and-command-line-keyword)
- [Safety mechanisms](#safety-mechanisms)
- [Extra tools](#extra-tools)
- [Data and folders](#data-and-folders)
- [FAQ](#faq)
- [Run and build from source](#run-and-build-from-source)
- [Project layout](#project-layout)
- [Version and updates](#version-and-updates)
- [Disclaimer](#disclaimer)

---

## What problem it solves

SCUM stores saves and mods in fixed locations, and the game only reads one set at a time:

| Content | Location the game actually reads |
| --- | --- |
| Saves | `%LocalAppData%\SCUM\Saved` |
| Mods | `<game root>\SCUM\Content\Paks\~Mods` |

When you play on several private servers, every server has different saves and mods. Manual switching is easy to get wrong: files get left behind, put in the wrong folder, or one server's progress overwrites another's.

This tool gives every server an **ID** (for example `0509`) and archives that server's data in:

```text
%LocalAppData%\SCUM\Saved.0509
<game root>\SCUM\Content\~Mods.0509
```

When you switch:

1. The current live `Saved` / `~Mods` is saved back to the **old ID** folder.
2. The **new ID** folder is loaded into the live location.
3. The launcher for the new ID is started.

Each server keeps its own complete saves and mods. Switching only moves data around, so servers never overwrite each other.

---

## What you need before you start

### 1. Confirm the game and data folders

You need two paths:

| Name | Should point to | What is inside |
| --- | --- | --- |
| Game root | For example `E:\SteamLibrary\steamapps\common\SCUM` | Contains `SCUM\Content\Paks` |
| Data folder | `%LocalAppData%\SCUM` | Contains `Saved` |

The app detects both on first launch. If detection fails, open **Settings → Paths** and select them manually.

> The game root is the folder that **contains the `SCUM` subfolder**, not `SCUM\Binaries\Win64`.

### 2. Prepare an ID and a launcher for each server

- **ID**: letters, digits, `_` and `-` only, for example `0509`, `6646`, `server_a`. The ID becomes part of the folder name and cannot be changed after creation.
- **Launcher**: the `.exe` that server actually uses. `.bat` / `.cmd` files are not supported; select the final `.exe` they start.
- **Command-line keyword** is only needed when several servers share the same `.exe`. Leave it empty when each server has its own executable.
- If a server does not use mods, enable **This profile uses no mods**.

### 3. Back up manually once before first use

The app has a trash folder and automatic rollback, but you should still make one manual backup before the first switch. You only need to do this once.

**What is this backup for?** The game only reads one `Saved` (saves) and one `~Mods` (mods) at a time, and the switcher replaces them. A manual backup is simply a copy of both folders stored somewhere else. The app never reads, changes, or deletes that copy. The built-in trash only keeps the most recent few versions and lives on the same drive, so this external copy is your last line of defence: if you pick the wrong server, a switch fails halfway, or an archive is deleted by mistake, you can copy it back.

> `D:\SCUM-Backup\...` below is only an example. **The app does not require this folder.** You can use `E:\SCUM-Backup`, an external drive, or any location with enough space. Keeping the `Saved` / `~Mods` folder names only makes it easier to copy them back later.

1. **Fully exit the game, the official launcher, and every private-server launcher.** In Task Manager, confirm these processes are gone:
   - `SCUM.exe` (the game itself; most common)
   - `SCUM_Launcher.exe` (official launcher)
   - `SCUM-Win64-Shipping.exe` / `SCUM-Win64-Test.exe` (other build / test game processes)
2. Create a backup root folder, for example `D:\SCUM-Backup`. Create only this one folder; do not pre-create `Saved` / `~Mods` inside it.
3. Copy the entire `%LocalAppData%\SCUM\Saved` folder to `D:\SCUM-Backup\Saved`.
   The result should be `D:\SCUM-Backup\Saved` containing `SaveFiles`, `Config`, etc. directly — not `Saved\Saved`.
4. Copy the entire `<game root>\SCUM\Content\Paks\~Mods` folder to `D:\SCUM-Backup\~Mods`.
   If `~Mods` does not exist, skip this step.
5. If you already have per-ID archives, copy them too:
   - `%LocalAppData%\SCUM\Saved.<ID>` → `D:\SCUM-Backup\Saved.<ID>`
   - `<game root>\SCUM\Content\~Mods.<ID>` → `D:\SCUM-Backup\~Mods.<ID>`

> Note: `Saved.<ID>` lives under `%LocalAppData%\SCUM`; `~Mods.<ID>` lives under `Content`, **not under `Paks`**. These two folders are each server's real long-term backup. Do not back up only `Saved` and `~Mods`.

After the backup, launch the switcher. Every later switch keeps the previous version automatically. To restore: exit the game → rename the current `Saved` / `~Mods` with a `.bad` suffix → copy the backup back into place. Full steps: [Player Guide 2.4](docs/Player-Guide-EN.md#24-restoring-from-the-manual-backup).

### 4. Free disk space

Copy mode (the default) needs room for an extra copy of the target saves and mods:

- If the target mods take 30 GB, leave about 30 GB free.
- If the target saves take 2 GB, leave another 2 GB free.
- Add the old versions kept in the trash folder.

At least **10 GB** free is recommended. If space is insufficient, the app warns before writing anything, so it will not fail halfway.

### 5. Permissions and antivirus

- Do **not** put the app in a low-integrity folder such as `D:\Coding`; it may be unable to write to `%LocalAppData%\SCUM`. Use a normal folder such as `D:\AI\SCUM-Switcher` or the Desktop.
- The executable is not code-signed, so SmartScreen or antivirus software may warn. If you trust the source, choose **More info → Run anyway**, or add the app folder to your antivirus exclusions.
- If the launcher itself needs administrator rights, run the switcher **as administrator** too; otherwise it may not be able to close or start the launcher.

### 6. Where each server's data lives

| Data | Location |
| --- | --- |
| Server save archive | `%LocalAppData%\SCUM\Saved.<ID>` |
| Server mod archive | `<game root>\SCUM\Content\~Mods.<ID>` |
| Save currently used by the game | `%LocalAppData%\SCUM\Saved` |
| Mods currently used by the game | `<game root>\SCUM\Content\Paks\~Mods` |

When you first add a profile, the target folders do not have to exist:

- Missing saves: the app asks whether to **create empty saves** or **copy the current saves**.
- Missing mods: put that server's mods into `Content\~Mods.<ID>` and click **Retry**; if the server truly uses no mods, choose **Continue with no mods**.

---

## Download and launch

### Option 1: Download the release package (recommended for players)

1. Open **Releases** on the right side of the repository and download the latest `SCUM-Switcher-v1.0.2-win-x64.zip`.
2. Extract it to a normal folder, for example `D:\AI\SCUM-Switcher`.
3. Double-click `SCUM-Switcher.exe`. No installation is needed.

If no package is available yet, follow [Run and build from source](#run-and-build-from-source).

### Option 2: Run from source (developers)

See [Run and build from source](#run-and-build-from-source).

On first launch, a three-step wizard appears: confirm paths → add a server → select a target and switch.

---

## First-time setup

### Step 1: Confirm paths

Open **Settings → Paths** and make sure:

- **Game root** points to `...\steamapps\common\SCUM`
- **Data folder** points to `%LocalAppData%\SCUM`

If a path is invalid, click **Browse** and select it manually. `SCUM\Content\Paks` must exist under the game root.

### Step 2: Add a server profile

Click **Add** on the left and fill in:

| Field | Description | Example |
| --- | --- | --- |
| Name | Display name; anything you like | `0509 server` |
| ID | Folder suffix; cannot be changed later | `0509` |
| Launcher | That server's `.exe` | `D:\Games\0509\SCUMLauncher.exe` |
| Launch arguments | Optional; passed to the launcher unchanged | `-server 0509` |
| Working directory | Optional; empty means the executable's folder | leave empty |
| Command-line keyword | Only when several servers share one `.exe` | `0509` |
| This profile uses no mods | Enable when the server has no mods | off |

After saving, the profile appears on the left and shows:

- `Saved.0509 exists / missing`
- `~Mods.0509 exists / missing`
- Whether the launcher is running

### Step 3: Import existing folders

If `Saved.0509`, `~Mods.0509`, or similar folders already exist, the app discovers them on first launch and offers to import them. You can also use the auto-detect button next to **Add**, or add a profile manually.

### Step 4: Set the current profile

If the app cannot tell which server is currently active from running processes, it asks you to choose the **current profile** before switching.

> This matters: the app must know which ID the current live data belongs to so it can save it back to the correct archive.

---

## Daily switching

1. Fully exit the game. The switcher detects it; if the game is running, it blocks or asks first.
2. Select the target server on the left.
3. Check the route summary in the middle: current → target, switch mode, required space.
4. Click **Switch to this profile**.
5. Wait for the progress bar. Do not open the game or launcher manually.
6. The app starts the target server's launcher automatically.

A switch runs these steps in order:

```text
check paths / processes / disk space
  → close the game (if allowed)
  → close all configured launchers
  → save current Saved   back to Saved.<old ID>
  → load Saved.<new ID>
  → save current ~Mods   back to ~Mods.<old ID>
  → load ~Mods.<new ID>
  → verify files
  → start the target launcher
  → write history
```

If the final launch step fails, **the save and mod switch is still valid**; you only need to start the game manually. The UI shows a warning and a **Launch current profile** button.

---

## What happens during a switch

Suppose you are on `0509` and switch to `6646`.

### Before the switch

```text
%LocalAppData%\SCUM\
  Saved                 ← current live data (0509 progress)
  Saved.0509            ← 0509 archive
  Saved.6646            ← 6646 archive

<game root>\SCUM\Content\
  Paks\~Mods            ← current live mods (0509)
  ~Mods.0509            ← 0509 mod archive
  ~Mods.6646            ← 6646 mod archive
```

### After the switch

```text
%LocalAppData%\SCUM\
  Saved                 ← 6646 progress (copied/linked from Saved.6646)
  Saved.0509            ← latest 0509 progress (moved back from live)
  Saved.6646            ← still present (copy mode does not delete the source)

<game root>\SCUM\Content\
  Paks\~Mods            ← 6646 mods
  ~Mods.0509            ← latest 0509 mods
  ~Mods.6646            ← still present
```

### Key rules

1. **Only one live folder**: the game reads only `Saved` and `Paks\~Mods`.
2. **Archives are per ID**: `Saved.<ID>` and `~Mods.<ID>` are each server's working copy and long-term backup.
3. **Save the old server first**: live data is moved back to the old ID folder. If that folder already exists, the old archive goes to the trash first.
4. **Copy mode keeps the source**: after `Saved.6646` is copied to `Saved`, `Saved.6646` remains, so you can switch back later.
5. **Junction mode does not copy**: live becomes a directory junction pointing at the archive, so switching is almost instant.
6. **Profiles without mods**: the current `~Mods` is saved back to the old ID, then no new `~Mods` is created; the game starts without mods.
7. **The trash is not per server**: `.switcher-trash` holds displaced old archives and keeps the newest N items for the whole trash root (default 5, minimum 2). Each server's long-term backup is `Saved.<ID>` / `~Mods.<ID>`, not the trash.

### Precheck (before any file is written)

The app checks the following before touching files:

- The game root, data folder, and `Paks` exist.
- The target launcher `.exe` exists.
- The game is not running.
- The target `Saved.<ID>` exists (if not, you can create empty saves or copy the current saves).
- The target `~Mods.<ID>` exists (if not, you can retry or continue without mods).
- Free space on the target volume is sufficient (checked per physical volume, with a 200 MB margin).
- The data folder, `Content`, and `Paks` are writable.

If any check fails, the app stops before writing, so it is safe to click **Retry** or **Continue**.

### Failure and rollback

- Every file operation is written to `switch-journal.json`.
- If a switch fails, completed actions are undone in reverse order.
- If the app crashes or is force-closed, the next launch detects the unfinished journal and offers **Roll back** or **Ignore for now**.
- If rollback fails, the journal is kept and the prompt appears again on the next launch.

---

## Copy mode vs junction mode

Choose in **Settings → General → Switch mode**.

| Mode | Behaviour | Speed | Best for |
| --- | --- | --- | --- |
| Copy (default, recommended) | Really copies files into live | Depends on save/mod size | Best compatibility; use this unless you know you need junctions |
| Directory junction | Live becomes a junction pointing at the archive | Almost instant | Very large mods, frequent switching; a few backup/sync tools do not follow junctions |

Recommendations:

- First time, or if unsure, use **Copy**.
- Only try junctions after confirming the game and your backup tools behave correctly.
- In junction mode, `Saved` and `~Mods` are links, not real folders. When cleaning up manually, do not delete the link targets by mistake.

---

## Missing target save or mod folder

### Target saves do not exist

The dialog offers:

| Choice | Result |
| --- | --- |
| Create empty save | Creates an empty `Saved.<ID>`; create a new character in game |
| Clone current save | Uses a copy of the current `Saved` as this server's starting point |
| Back | Do not switch |

### Target mod folder does not exist

1. Open the `Content` folder.
2. Create `~Mods.<ID>` and put that server's mods inside.
3. Return to the dialog and click **Retry**.

If the server truly uses no mods, click **Continue with no mods**. The app saves the current live mods back to the old ID and starts the game with no mods.

### The game is running

The default is **Ask me first**. You can:

- close the game and retry;
- force-close the game and continue.

You can also change this to **Always force-close** in **Settings → Safety**. **The game must be closed before switching, or saves may be corrupted.**

---

## Launcher detection and command-line keyword

The app decides whether a server's launcher is running using these rules:

1. The process executable path must match the configured **Launcher** path (case-insensitive, slash direction ignored).
2. If a **command-line keyword** is set, the process's full command line must also contain that keyword (case-insensitive).

The keyword is matched against the **full command line**, including the executable path itself. Therefore:

- Each server has a different `.exe`: leave the keyword empty.
- Several servers share one `.exe` and differ by arguments: use text that always appears in the arguments, for example `-server 0509` or `0509`.
- If the launcher only forwards arguments to another process: use text that appears in the **actual game process command line**, or point the launcher path directly at the real process.
- A wrong keyword does not affect the file switch, but it can prevent the old launcher from being closed or the running server from being detected.

Since v1.0.2, launch verification uses the launched PID's liveness instead of repeatedly scanning the process list, so a keyword mismatch no longer causes a ~45-second delay.

---

## Safety mechanisms

| Mechanism | Purpose |
| --- | --- |
| Precheck first | Missing files, running game, and low disk space are caught before writing |
| Operation journal | Every action is written to `switch-journal.json`; failures roll back in reverse order |
| Crash recovery | After an interrupted switch, the next launch offers rollback or ignore |
| Trash folder | Displaced old archives go to `.switcher-trash` instead of being deleted |
| Post-switch verification | Compares file count and total size between archive and live (can be disabled) |
| History | `history.json` records route, mode, duration, and result |
| No network | No telemetry, no uploads; only local file access |

Notes:

- The trash keeps the newest N items for the whole trash root; it is **not a permanent per-server backup**. Rely on `Saved.<ID>` / `~Mods.<ID>` or your own backups for long-term safety.
- **Delete profile** only removes the entry from the list; it does not delete `Saved.<ID>` / `~Mods.<ID>` on disk.
- The app does not modify game installation files; it only moves/copies save and mod folders.

---

## Extra tools

The three tools at the bottom left are optional but useful.

### Admin commands

- Built-in quick reference for common `#` commands, grouped and searchable, with one-click copy.
- You can add your own commands; they are stored in `%APPDATA%\SCUM-Switcher\admin-custom.json`.
- Commands vary by server/plugin version; the in-game `#` list is authoritative.

### Map and coordinates

- Import a PNG / JPG / WEBP map (you can screenshot the in-game M map).
- Calibrate pixel ↔ world coordinates using two known points.
- Click the map to pick a point and copy `#Teleport X Y Z`.
- Save custom waypoints.
- Calibration is a linear mapping; it works well for the official isometric map but drifts on non-isometric custom maps.

### Mod checker

- Counts files and total size in the live `~Mods`, and shows usage per top-level entry.
- Detects `.pak` name conflicts (same filename in different subfolders).
- Disable/enable entries:
  - Disabling moves an entry to `Paks\~Mods.disabled` and **never deletes it**.
  - The `.sig` next to a `.pak` moves with it.
  - Both are restored when re-enabled.

---

## Data and folders

| Content | Path |
| --- | --- |
| App config | `%APPDATA%\SCUM-Switcher\config.json` |
| App logs | `%APPDATA%\SCUM-Switcher\logs\app-YYYY-MM-DD.log` |
| Switch history | `%APPDATA%\SCUM-Switcher\history.json` |
| Unfinished switch journal | `%APPDATA%\SCUM-Switcher\switch-journal.json` |
| Custom admin commands | `%APPDATA%\SCUM-Switcher\admin-custom.json` |
| Map config | `%APPDATA%\SCUM-Switcher\map-config.json` |
| Game saves | `%LocalAppData%\SCUM\Saved` |
| Save archives | `%LocalAppData%\SCUM\Saved.<ID>` |
| Save trash | `%LocalAppData%\SCUM\.switcher-trash` |
| Current mods | `<game root>\SCUM\Content\Paks\~Mods` |
| Mod archives | `<game root>\SCUM\Content\~Mods.<ID>` |
| Disabled mods | `<game root>\SCUM\Content\Paks\~Mods.disabled` |
| Mod trash | `<game root>\SCUM\Content\.switcher-trash` |

The app folder can be moved as a whole; settings live in `%APPDATA%` and are unaffected. Deleting the app folder does not delete game saves or mod archives.

---

## FAQ

### Switching is slow

- Copy mode really copies saves and mods; the first switch or a very large mod pack is expected to take time.
- Mechanical drives and real-time antivirus scanning slow it down noticeably.
- Junction mode is almost instant.
- v1.0.2 fixed the ~45-second delay caused by a launcher keyword mismatch. If it is still slow, check the log to see which step takes the longest.

### The game did not start after switching

- Check that the configured launcher `.exe` exists and whether it needs administrator rights.
- Check **Launch arguments** and **Working directory**.
- Read the UI warning and `%APPDATA%\SCUM-Switcher\logs`.
- Saves and mods were already switched successfully; click **Launch current profile** to start manually.

### The old launcher was not closed

- Make sure the configured `.exe` path exactly matches the running process.
- If several servers share one `.exe`, make sure the **command-line keyword** really appears in the process command line.
- The launcher may need administrator rights; run the switcher as administrator.
- You can also close it manually and retry.

### "Target mod folder does not exist"

- Create `~Mods.<ID>` under `Content`, put the server's mods inside, and click **Retry**.
- If the server does not use mods, enable **This profile uses no mods** or choose **Continue with no mods** in the dialog.

### Why is a server missing from the trash?

The trash keeps the newest N items for the whole trash root, not N per server. Each server's long-term data lives in `Saved.<ID>` / `~Mods.<ID>`; those are the real per-server backups. The trash is only a temporary safety net for displaced versions.

### "No permission" / cannot write saves

- Move the app to a normal folder such as `D:\AI`, not a low-integrity folder like `D:\Coding`.
- Run as administrator if necessary.
- Check write permissions on `%LocalAppData%\SCUM` and the game's `Content` folder.

### Antivirus / SmartScreen warning

The executable is unsigned and may be falsely flagged. If you trust the source:

- SmartScreen: **More info → Run anyway**.
- Antivirus: add the app folder to exclusions.
- Or run/build from source yourself.

### Mods disappeared after a game update

Verifying game files through Steam may reset `Paks\~Mods`. The switcher's archives in `~Mods.<ID>` are unaffected; switch once to load them again. Before updating, consider switching to a no-mod profile or making a manual backup.

### Can I select Steam directly?

The app launches an `.exe`, not a Steam URL. If a server is normally started through Steam, point the launcher at the actual executable (for example `SCUM\Binaries\Win64\SCUM.exe`), or use the launcher that server provides. Starting the executable directly may skip the Steam overlay; use whichever fits your setup.

### Does deleting a profile delete saves?

No. It only removes the list entry. `Saved.<ID>` / `~Mods.<ID>` remain on disk, and you can add a profile with the same ID later to import them again.

### How do I uninstall?

1. Close the app.
2. Delete the app folder.
3. Optional: delete `%APPDATA%\SCUM-Switcher` (settings, logs, history).
4. Game saves and `Saved.<ID>` / `~Mods.<ID>` are not deleted; remove them yourself if you want.

---

## Run and build from source

For module details, the state machine, and journal/rollback internals, see the [developer notes](docs/开发者说明.md) (Chinese).

Requirements:

- Windows 10 / 11 x64
- Node.js 22 LTS or newer
- npm

```bash
npm install
npm test
npm start
```

`npm start` launches Electron in development mode.

### Build a portable folder

```bash
npm run pack -- --out "D:\AI\SCUM-Switcher" --keep 2
```

- `--out`: output folder; must be outside the source tree.
- `--keep`: number of old build backups to keep (minimum 2).
- The script copies the Electron runtime, app sources, icon, and documentation.
- On Windows it tries to set the output folder's integrity level to Medium.

The default output is `D:\AI\SCUM-Switcher` (the maintainer's local path). On other machines, pass `--out` explicitly.

> **Do not run the packaged `.exe` from a low-integrity folder such as `D:\Coding`.** Processes in such folders may be unable to write to `%LocalAppData%\SCUM`. Keep the release in a normal folder such as `D:\AI` or the Desktop. If needed, run:
>
> ```bat
> icacls "D:\AI\SCUM-Switcher" /setintegritylevel (OI)(CI)M /T /Q
> ```

### Tests

```bash
npm test
```

There are 28 core tests covering file copy/rollback, config validation, mod enable/disable, the switch state machine, missing targets, junction mode, and process matching.

---

## Project layout

```text
SCUM-Switcher/
  src/
    main/
      main.js          Electron main process, window, IPC, processes, state
      preload.js       window.api exposed through contextBridge
    core/
      config.js        config validation, path building, folder discovery
      fsx.js           copy/move/junction/trash/verification helpers
      journal.js       switch journal and history
      rollback.js      rollback from the journal
      switcher.js      switch state machine (precheck → switch → verify → launch)
      processes.js     process detection, close, launch (PowerShell/WMI)
      mods.js          mod scanning and enable/disable
      messages.js      main-process log messages (Chinese/English)
    renderer/
      index.html       UI structure
      css/             themes and layout
      js/app.js        UI logic
      js/i18n.js       Chinese/English strings
      assets/icon.png  window icon
    data/
      admin-commands.js  admin command reference data
  tests/              node --test unit/integration tests
  scripts/
    pack.js           portable build
    make-icon.ps1     icon generation
  docs/
    玩家上手指南.md    Chinese player guide
    Player-Guide-EN.md English player guide
    开发者说明.md      Chinese developer notes
```

---

## Version and updates

Current version: **v1.0.2**. Main changes:

- Fixed a ~45-second stall during launch verification when a profile's command-line keyword did not match the actual command line (for example the 6646 profile).
- Launch verification now checks whether the launched PID is alive, with one fallback process scan.
- Fixed audit findings: concurrent copy workers trampling each other after `copyDir` failure; process-list parse failures treated as "no processes" (fail-open); `.sig` files left behind when enabling mods; inability to enable mods when `~Mods` was missing; `[hidden]` overridden by theme styles; disk space checked separately for folders on the same volume; folder picker ignoring `defaultPath`; overlapping polling.

See [CHANGELOG.md](CHANGELOG.md) for the full history (Chinese).

---

## Disclaimer

- This tool only moves, copies, and links local files. It does not modify game content or connect to any server.
- Back up important saves yourself before switching. The author is not responsible for losses caused by mistakes, antivirus software, disk failure, or similar.
- This project is not affiliated with the SCUM developer, publisher, or any private server.
- By using this tool you acknowledge and accept the above.
