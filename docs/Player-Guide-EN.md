# Player Guide

[中文](玩家上手指南.md) | **English**

This guide is for **first-time users** who are not familiar with the folder layout. Follow it once; after that, every switch is just one button.

> If you only want the quick version, see the [README](../README.en.md). This guide explains every step, every dialog, and the common pitfalls.

---

## 0. Before you start: 5-minute checklist

Confirm these first; they prevent most problems.

- [ ] Windows 10 / 11 64-bit.
- [ ] SCUM is installed and you can enter the game normally.
- [ ] You know each private server's **ID** (for example `0509`, `6646`).
- [ ] You know where each server's **launcher `.exe`** is.
- [ ] The game and every launcher are **fully closed**.
- [ ] You have manually backed up `Saved` and `~Mods` (see section 2).
- [ ] The target drive has at least 10 GB free.
- [ ] The app is in a normal folder (for example `D:\AI\SCUM-Switcher`), not `D:\Coding`.
- [ ] Antivirus software is not blocking the app.

Continue only when all boxes are checked.

---

## 1. The two key folders

SCUM reads only these two "current" locations:

```text
%LocalAppData%\SCUM\Saved
<game root>\SCUM\Content\Paks\~Mods
```

- `%LocalAppData%` is usually `C:\Users\<your name>\AppData\Local`.
- `<game root>` is `steamapps\common\SCUM` in your Steam library.

The switcher creates two archive folders per server:

```text
%LocalAppData%\SCUM\Saved.0509
<game root>\SCUM\Content\~Mods.0509
```

Think of it like this:

| Folder | Purpose |
| --- | --- |
| `Saved` | Saves the game is reading right now |
| `Saved.0509` | Save archive for server 0509 |
| `Paks\~Mods` | Mods the game is reading right now |
| `~Mods.0509` | Mod archive for server 0509 |

Switching = save the current `Saved` / `~Mods` back to the old ID, then load the new ID's archive into the live location.

---

## 2. Before first use: manual backup

### 2.1 What this backup is for

The game reads only two pieces of data at a time:

- `%LocalAppData%\SCUM\Saved`: current saves;
- `<game root>\SCUM\Content\Paks\~Mods`: current mods.

The switcher replaces them with the target server's data. It automatically moves old data into the trash and rolls back on failure, but the trash only keeps the most recent few versions and sits on the same drive. Before first use, copy both folders to **a different folder**. That is an extra safety net:

- you pick the wrong server or enter the wrong path;
- the app is closed during a switch;
- a server's archive is deleted by mistake later.

You can copy this backup back instead of levelling a new character or re-downloading mods.

> `D:\SCUM-Backup` is only an example, **not a folder the app requires**. The app never reads, changes, or deletes it. You can use `E:\SCUM-Backup`, an external drive, or any location with enough space.

### 2.2 What to back up

| Current location | Copy to (example) | Notes |
| --- | --- | --- |
| `%LocalAppData%\SCUM\Saved` | `D:\SCUM-Backup\Saved` | Current saves; required |
| `<game root>\SCUM\Content\Paks\~Mods` | `D:\SCUM-Backup\~Mods` | Current mods; skip if the folder does not exist |
| `%LocalAppData%\SCUM\Saved.<ID>` | `D:\SCUM-Backup\Saved.<ID>` | Per-server save archive; back up if present |
| `<game root>\SCUM\Content\~Mods.<ID>` | `D:\SCUM-Backup\~Mods.<ID>` | Per-server mod archive; back up if present |

The last two rows are archives the switcher has already created per server. Note that `~Mods.<ID>` is under `Content`, **not under `Paks`**.

A finished backup looks roughly like this:

```text
D:\SCUM-Backup\
├─ Saved\          ← copy of current saves
│  ├─ SaveFiles\
│  └─ Config\
├─ ~Mods\          ← copy of current mods (only if they existed)
├─ Saved.0509\     ← optional: server 0509 save archive
└─ ~Mods.0509\     ← optional: server 0509 mod archive
```

### 2.3 Steps

1. **Fully exit the game, the official launcher, and every private-server launcher.** In Task Manager, confirm these processes are gone:
   - `SCUM.exe` (the game itself; most common)
   - `SCUM_Launcher.exe` (official launcher)
   - `SCUM-Win64-Shipping.exe` / `SCUM-Win64-Test.exe` (other build / test game processes)

   If a name does not match, close any process whose icon is SCUM or whose path is inside the SCUM game folder, plus each server's own launcher.
2. Create a backup root folder, for example `D:\SCUM-Backup`. Create only this folder; do not pre-create `Saved` / `~Mods` inside it.
3. Open `%LocalAppData%\SCUM`, copy the entire `Saved` folder, and paste it into `D:\SCUM-Backup`.
   The result should be `D:\SCUM-Backup\Saved` containing `SaveFiles`, `Config`, etc. directly, not `Saved\Saved`.
4. Open `<game root>\SCUM\Content\Paks`, copy the entire `~Mods` folder, and paste it into `D:\SCUM-Backup`.
   If `~Mods` does not exist, skip this step.
5. If `Saved.<ID>` / `~Mods.<ID>` exist, copy them as shown in the table in 2.2.
6. Check: if `D:\SCUM-Backup\Saved\SaveFiles` exists, the save backup succeeded.

Keeping the backup on another drive is safer. Once the switcher works correctly, you can keep or delete this manual backup.

### 2.4 Restoring from the manual backup

If a switch leaves you with the wrong saves/mods, or you think data is missing:

1. Fully exit the game and the switcher.
2. Rename the current `%LocalAppData%\SCUM\Saved` to `Saved.bad`. **Do not delete it yet.**
3. Copy `D:\SCUM-Backup\Saved` back into `%LocalAppData%\SCUM\`, keeping the name `Saved`.
4. Do the same for mods: rename the current `Paks\~Mods` to `~Mods.bad`, then copy the backup `~Mods` back into `Paks\`.
5. Start the game and confirm. Only after that, delete `Saved.bad` / `~Mods.bad`.

If only one server's archive is wrong, you can also restore from `Saved.<ID>` / `~Mods.<ID>` or the trash folder; see section 8.

---

## 3. First launch

1. Extract the release package to `D:\AI\SCUM-Switcher`.
2. Double-click `SCUM-Switcher.exe`.
3. If Windows says "Windows protected your PC", click **More info → Run anyway**.
4. The first launch shows a three-step wizard:
   - confirm the game paths;
   - add a server profile;
   - select a target and switch.

You can close the wizard; open **Settings** from the gear icon in the top-right later.

### 3.1 Confirm paths

Click the gear icon → **Paths**:

| Field | Should point to | How to check |
| --- | --- | --- |
| SCUM install folder | `...\steamapps\common\SCUM` | It contains `SCUM\Content\Paks` |
| SCUM data folder | `%LocalAppData%\SCUM` | It contains `Saved` |

If it says "invalid path":

- click **Browse** and select it again;
- or click **Auto-detect**;
- if it still fails, type `%LocalAppData%\SCUM` into Explorer's address bar and confirm it exists.

> The install folder is the one that **contains the `SCUM` subfolder**, not `SCUM\Binaries\Win64`.

### 3.2 Add your first server

Click **Add** on the left and fill in:

| Field | What to enter |
| --- | --- |
| Name | Anything you recognise, for example `0509 server` |
| ID | A unique ID for the server, for example `0509`. Letters, digits, `_`, `-` only; cannot be changed later |
| Launcher | The server's launcher `.exe`. Do not select `.bat` / `.cmd` |
| Launch arguments | Copy them if the launcher needs them to reach the right server; otherwise leave empty |
| Working directory | Usually empty; defaults to the executable's folder |
| Command-line keyword | Only when several servers share one `.exe`; otherwise leave empty |
| This profile uses no mods | Enable when the server has no mods |

After saving, the profile card shows:

- `Saved.0509 exists` or `missing`
- `~Mods.0509 exists` or `missing`
- Whether the launcher is running

On the first add, the archive folders usually do not exist yet. That is normal; the switcher handles it during a switch.

### 3.3 Import existing folders

If `Saved.0509`, `~Mods.0509`, etc. already exist on disk, the app discovers them on first launch and offers to import them. You can also:

- click the auto-detect button next to **Add**;
- or add a profile manually with the same ID.

Importing only adds a profile; it does not move files.

### 3.4 Set the "current profile"

If the app cannot detect a running launcher, it asks you to choose the **current profile** before switching.

Why? The app must know which ID the current `Saved` / `~Mods` belong to, so it can save them back to the correct archive.

- If you just exited a server, choose that server.
- If unsure, check the `Saved` folder's modification time and size, or the character/server information in game.

Choosing wrong saves your current progress into the wrong ID folder. Double-check this on first use.

---

## 4. Add the remaining servers

Repeat step 3.2 for every server.

### Several servers share one launcher `.exe`

If several servers use the same executable with different arguments:

1. Select the same `.exe` for **Launcher**.
2. Enter each server's arguments in **Launch arguments**.
3. Set **Command-line keyword** to text that **always appears in the process command line**, for example `-server 0509` or `0509`.

The keyword only identifies which server is running; it is not passed to the launcher. A wrong keyword can prevent the old launcher from closing or the current server from being detected, but it does not corrupt saves.

### Servers without mods

Enable **This profile uses no mods**. When switching to this server:

- the current `~Mods` is saved back to the old ID;
- no new `~Mods` is created;
- the game starts without mods.

### Launcher needs administrator rights

If the launcher shows a UAC prompt or "access denied":

- close the switcher;
- right-click `SCUM-Switcher.exe` → **Run as administrator**;
- switch again.

---

## 5. First switch: do a test run

Before the first real switch, switch to a server you do not care about and confirm the flow works.

1. Fully exit the game and launcher.
2. Select the target server on the left.
3. Check the summary in the middle:
   - current → target;
   - copy or junction mode;
   - whether the target saves/mods exist;
   - approximate space required.
4. Click **Switch to this profile**.
5. Watch the progress:
   - checking;
   - closing game/launcher;
   - saving current saves;
   - loading target saves;
   - saving current mods;
   - loading target mods;
   - verifying;
   - launching.
6. After the switch, enter the game and confirm:
   - the character/server is correct;
   - mods load correctly.

Only then start switching between the servers you care about.

### Do not do these during a switch

- Do not open the game or launcher manually.
- Do not move `Saved` / `~Mods` manually.
- Do not force-close the switcher while files are being copied.
- Do not switch while the game is running (the app blocks or asks first).

---

## 6. What to choose in each dialog

### 6.1 Target saves do not exist

`Saved.<target ID>` does not exist yet.

| Option | When to choose it |
| --- | --- |
| Create empty save | You want to create a new character on this server |
| Clone current save | You want your current progress as this server's starting point |
| Back | You are not ready; do not switch |

Creating empty saves means you create a new character in game. Copying current saves gives you a copy of your current progress.

### 6.2 Target mod folder does not exist

`~Mods.<target ID>` does not exist yet.

1. Click **Open Content folder**.
2. Create a folder named `~Mods.<target ID>`.
3. Put that server's mod files inside.
4. Return to the dialog and click **Retry**.

If the server truly uses no mods:

- click **Continue with no mods**; or
- enable **This profile uses no mods** in the profile beforehand.

### 6.3 The game is running

The default is **Ask me first**:

- **Close game and continue**: the app force-closes the game;
- **Back**: close the game yourself and switch again.

You can change this to **Always force-close** in **Settings → Safety**. **Do not force-close without saving first.**

### 6.4 The launcher will not close

Possible causes:

- wrong executable path;
- several servers share one `.exe`, but the keyword is missing or wrong;
- the launcher runs as administrator and the switcher does not.

What to do:

1. Close the launcher manually.
2. Check the executable path and keyword in the profile.
3. Run the switcher as administrator if needed.
4. Switch again.

### 6.5 Switch failed / app exited halfway

- If the UI says "rolled back", files were restored to their pre-switch state. Try again.
- If the app crashed or was force-closed, the next launch offers **Roll back** or **Ignore for now**:
  - if unsure, choose **Roll back**;
  - check saves and mods after rolling back.
- If rollback fails, the journal is kept and the prompt appears again. Restore manually from the journal, the trash folder, or your manual backup.

---

## 7. Daily use

Every switch is just:

1. exit the game;
2. open the switcher;
3. select the target server;
4. click **Switch to this profile**;
5. wait for the app to launch the game.

Other settings only need to be configured once.

---

## 8. Trash folder and per-server backups

### What the trash folder is

During a switch, if an archive folder for an ID already exists and live data must be written back, the old archive is moved to:

```text
%LocalAppData%\SCUM\.switcher-trash
<game root>\SCUM\Content\.switcher-trash
```

This lets you recover the old version if something goes wrong during the overwrite.

### How many versions the trash keeps

**Settings → Safety → Keep recent backups** controls this. Default 5, minimum 2.

Note: this is the newest N items for the **whole trash root**, not N per server. Older items are pushed out by newer ones.

### Where each server's long-term backup lives

Here:

```text
%LocalAppData%\SCUM\Saved.<ID>
<game root>\SCUM\Content\~Mods.<ID>
```

These two folders are each server's real working copy and long-term backup. As long as you do not delete them, they keep that server's latest data.

> If you want the trash to keep N items per server, the program logic must change. The current version keeps the newest N items for the whole trash root.

---

## 9. Copy mode vs junction mode

**Settings → General → Switch mode**.

| | Copy (default) | Directory junction |
| --- | --- | --- |
| How it works | Really copies files | Creates a link to the archive folder |
| Speed | Depends on size | Almost instant |
| Compatibility | Best | A few backup/sync tools do not understand links |
| Disk usage | One archive + one live copy | Only the archive |
| Best for | First use, safety first | Very large mods, frequent switching |

For first use, keep **Copy**. Try junctions only after everything works.

In junction mode:

- `Saved` and `~Mods` are links, not real folders;
- do not manually delete the link targets;
- some backup tools back up only the link, not its contents; verify yours.

---

## 10. Extra tools

### Admin commands

**Admin commands** on the left:

- browse by category;
- search commands;
- click **Copy**;
- in game, press `T` to open chat, paste, and press Enter.

Commands vary by server/plugin version; the in-game `#` list is authoritative.

### Map and coordinates

**Map and coordinates** on the left:

1. Import a map image (you can screenshot the in-game M map).
2. Calibrate with two known points: enter each point's pixel and world coordinates.
3. Click the map to pick a point.
4. Copy `#Teleport X Y Z`.

Calibration is a linear mapping; the official isometric map is accurate, while custom non-isometric maps drift.

### Mod checker

**Mod checker** on the left:

- see the live `~Mods` file count, total size, and size per top-level entry;
- detect `.pak` name conflicts;
- disable/enable entries:
  - disabling moves an entry to `Paks\~Mods.disabled`; nothing is deleted;
  - the `.sig` next to a `.pak` moves with it;
  - both are restored when re-enabled.

---

## 11. Where to look when something goes wrong

| Symptom | Check first |
| --- | --- |
| Switch button is greyed out | Valid paths, a target selected, no switch already running |
| Says the game is running | End all SCUM processes in Task Manager (`SCUM.exe` / `SCUM_Launcher.exe` / `SCUM-Win64-Shipping.exe` / `SCUM-Win64-Test.exe`) and each server's launcher, or let the app force-close it |
| Says target mods are missing | Does `Content\~Mods.<ID>` exist? Should the profile use no mods? |
| Says target saves are missing | Choose create-empty or copy-current |
| Says not enough space | Free some space or switch to junction mode |
| Launcher was not closed | Executable path, command-line keyword, administrator rights |
| Game did not start after switching | Launcher path/arguments/permissions; check logs and warnings |
| Saves look wrong | Check the current profile; restore from `Saved.<ID>` or the trash |
| App will not open / crashes | Antivirus block; move to a normal folder; check `%APPDATA%\SCUM-Switcher\logs` |

Log location:

```text
%APPDATA%\SCUM-Switcher\logs\app-YYYY-MM-DD.log
```

You can also open it from **Settings → About → Open log folder**.

---

## 12. Safe uninstall

1. Close the switcher.
2. Delete the app folder (for example `D:\AI\SCUM-Switcher`).
3. Optional: delete `%APPDATA%\SCUM-Switcher` (settings, logs, history).
4. Game saves and `Saved.<ID>` / `~Mods.<ID>` are not deleted.

To reset only the settings, delete `%APPDATA%\SCUM-Switcher\config.json`; the wizard appears again on the next launch. Back up the whole `%APPDATA%\SCUM-Switcher` folder before deleting anything.

---

## 13. Final reminders

- **Make a manual backup before first use.**
- **Exit the game before switching.**
- **Pick the correct current profile.**
- **If unsure, use copy mode.**
- **Each server's long-term data lives in `Saved.<ID>` / `~Mods.<ID>`; do not delete those folders manually.**
