'use strict';

/**
 * Build a portable Windows folder for SCUM Server Switcher.
 *
 * There is no bundler and no electron-builder here: the app is plain
 * CommonJS + ES modules, so the portable build is just Electron's runtime
 * plus resources/app. Run with:
 *
 *   npm run pack
 *   npm run pack -- --out "D:\AI\SCUM-Switcher" --keep 2
 *
 * The default output is D:\AI\SCUM-Switcher on purpose. Running the app from
 * a low-integrity folder (for example D:\Coding on this machine) prevents it
 * from writing %LocalAppData%\SCUM, so the packaged copy must live elsewhere.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const args = process.argv.slice(2);

function option(name, fallback) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return fallback;
}

const OUT = path.resolve(option('--out', 'D:\\AI\\SCUM-Switcher'));
const KEEP_BACKUPS = Math.max(2, Number(option('--keep', '2')) || 2);
const SKIP_INTEGRITY = args.includes('--no-integrity');

function log(message) {
  process.stdout.write(`${message}\n`);
}

function timestamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-` +
    `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  );
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true, errorOnExist: false, dereference: false });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function backupExisting() {
  if (!fs.existsSync(OUT)) return null;

  const backup = `${OUT}.backup-${timestamp()}`;
  log(`Backing up existing build -> ${backup}`);
  fs.renameSync(OUT, backup);

  const parent = path.dirname(OUT);
  const prefix = `${path.basename(OUT)}.backup-`;
  let backups = [];
  try {
    backups = fs
      .readdirSync(parent)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(parent, name))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
  } catch {
    backups = [];
  }

  for (const old of backups.slice(KEEP_BACKUPS)) {
    try {
      fs.rmSync(old, { recursive: true, force: true });
      log(`Pruned old backup: ${old}`);
    } catch (err) {
      log(`Could not prune ${old}: ${err.message}`);
    }
  }
  return backup;
}

function setMediumIntegrity(dir) {
  if (SKIP_INTEGRITY || process.platform !== 'win32') return;
  try {
    execFileSync('icacls', [dir, '/setintegritylevel', '(OI)(CI)M', '/T', '/Q'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    log('Integrity level set to Medium (can write %LocalAppData%\\SCUM).');
  } catch (err) {
    log('Warning: could not set the integrity level automatically.');
    log('         If the app cannot write saves, right-click the folder -> Properties -> Security.');
  }
}

function writeUserGuide(dir) {
  const text = [
    'SCUM 私服切换器  v' + PKG.version,
    '',
    '一、第一次使用前（重要）',
    '  1. 完全退出游戏、官方启动器和各服的私服启动器。',
    '     任务管理器确认没有 SCUM.exe、SCUM_Launcher.exe、',
    '     SCUM-Win64-Shipping.exe、SCUM-Win64-Test.exe。',
    '  2. 手动备份一次（只做一次）：',
    '     作用：游戏只认一份 Saved 和 ~Mods，切换器会替换它们；',
    '     这份外部副本程序不会碰，出问题可以整体复制回去。',
    '     新建 D:\\SCUM-Backup（只是示例，可换任意位置），然后复制：',
    '     %LocalAppData%\\SCUM\\Saved            -> 备份\\Saved',
    '     <游戏目录>\\SCUM\\Content\\Paks\\~Mods    -> 备份\\~Mods（没有就跳过）',
    '     如果已有按编号归档，也分别复制：',
    '     %LocalAppData%\\SCUM\\Saved.编号        -> 备份\\Saved.编号',
    '     <游戏目录>\\SCUM\\Content\\~Mods.编号    -> 备份\\~Mods.编号',
    '     注意 ~Mods.编号 在 Content 下，不在 Paks 下。',
    '     还原：退出游戏和切换器，把当前 Saved / ~Mods 改名加 .bad，',
    '     再把备份复制回原位，确认无误后再删除 .bad 目录。',
    '  3. 建议目标磁盘至少留 10 GB 空闲。',
    '  4. 程序放在普通目录（例如 D:\\AI\\SCUM-Switcher），不要放在 D:\\Coding 这类',
    '     低完整性目录，否则可能无法写入 %LocalAppData%\\SCUM。',
    '',
    '二、启动与路径',
    '  1. 双击 SCUM-Switcher.exe 即可，不需要安装。',
    '  2. 第一次启动会自动查找 SCUM 安装目录和存档目录。',
    '  3. 不对就到「设置 → 路径」手动指定：',
    '     - SCUM 安装目录：包含 SCUM\\Content\\Paks 的那一层，例如',
    '       E:\\SteamLibrary\\steamapps\\common\\SCUM',
    '     - SCUM 数据目录：通常是 %LocalAppData%\\SCUM',
    '',
    '三、添加服务器',
    '  1. 点击左侧「添加」，填写名称和编号（编号会用于 Saved.编号 与 ~Mods.编号）。',
    '  2. 编号只能包含字母、数字、_ 和 -，创建后不能修改。',
    '  3. 选择该服的启动器 exe。启动器必须是 .exe，不能直接选 .bat / .cmd。',
    '  4. 多个服共用同一个 exe 时，才需要填写「命令行关键字」；exe 不同就留空。',
    '  5. 如果这个服不用 MOD，打开「此配置不使用 MOD」。',
    '  6. 如果启动器需要管理员权限，请以管理员身份运行切换器。',
    '',
    '四、切换流程',
    '  1. 选中目标配置，点击「切换到此配置」。',
    '  2. 程序检测并关闭正在运行的启动器（必要时关闭游戏）。',
    '  3. 当前 Saved 移回 Saved.<旧编号>，再把 Saved.<新编号> 载入 Saved。',
    '  4. 当前 ~Mods 移回 ~Mods.<旧编号>，再把 ~Mods.<新编号> 载入 Paks\\~Mods。',
    '  5. 校验文件后启动新配置的启动器。',
    '  6. 切换期间不要手动打开游戏，也不要移动存档/MOD 目录。',
    '',
    '五、找不到目标存档或 MOD 时',
    '  - 目标存档不存在：可以创建空存档，或复制当前存档作为起点。',
    '  - 目标 MOD 目录不存在：把该服的 MOD 放进 Content\\~Mods.<编号>，然后点「重试」；',
    '    如果这个服确实不用 MOD，也可以选择「不使用 MOD 继续」。',
    '  - 游戏正在运行：默认先询问；也可以到「设置 → 安全」改为自动强制关闭。',
    '',
    '六、安全机制',
    '  - 写入前先预检：路径、进程、目标目录、磁盘空间、权限。',
    '  - 每次切换都会写入操作日志，失败会自动回滚。',
    '  - 如果上次切换中途退出，下次启动会提示回滚或忽略。',
    '  - 被替换下来的旧归档会进入回收区（.switcher-trash）。',
    '    回收区按整个目录保留最近 N 份（默认 5，最小 2），不是每个服各一份。',
    '    每个服的长期备份在 Saved.<编号> / ~Mods.<编号>，不要手动删除。',
    '',
    '七、切换方式',
    '  - 复制模式（默认，推荐）：真实复制文件，兼容性最好，大存档需要一些时间。',
    '  - 联接模式：创建目录联接，切换几乎瞬间完成；少数备份/同步工具可能不跟随联接。',
    '',
    '八、数据位置',
    '  配置、日志、历史、自定义指令、地图：%APPDATA%\\SCUM-Switcher',
    '  游戏存档：%LocalAppData%\\SCUM\\Saved',
    '  存档归档：%LocalAppData%\\SCUM\\Saved.<编号>',
    '  当前 MOD：<游戏目录>\\SCUM\\Content\\Paks\\~Mods',
    '  MOD 归档：<游戏目录>\\SCUM\\Content\\~Mods.<编号>',
    '',
    '九、常见问题',
    '  - 启动器没有被识别：确认配置里的 exe 路径与实际运行的程序一致；',
    '    共用一个 exe 时请填写命令行关键字。',
    '  - 切换后游戏没有启动：检查启动器路径、参数、管理员权限；',
    '    存档和 MOD 已经切换成功，可以点「启动当前配置」手动启动。',
    '  - 提示没有权限：把整个程序目录移到 D:\\AI 等普通目录后再运行。',
    '  - 未签名的 exe 可能被杀毒软件拦截，请添加信任或自行从源码运行。',
    '  - 详细说明见程序目录下的 README.md 和 docs\\玩家上手指南.md。',
    '',
    '============================================================',
    'SCUM Server Switcher v' + PKG.version + ' - English',
    '============================================================',
    '',
    'BEFORE FIRST USE',
    '  1. Fully exit the game, the official launcher, and every',
    '     private-server launcher. In Task Manager confirm no SCUM.exe,',
    '     SCUM_Launcher.exe, SCUM-Win64-Shipping.exe, or',
    '     SCUM-Win64-Test.exe is running.',
    '  2. Make one manual backup. The app never reads or changes this',
    '     backup; it is your fallback if something goes wrong.',
    '     Copy:',
    '       %LocalAppData%\\SCUM\\Saved         -> Backup\\Saved',
    '       <game>\\SCUM\\Content\\Paks\\~Mods     -> Backup\\~Mods (skip if absent)',
    '       %LocalAppData%\\SCUM\\Saved.<ID>     -> Backup\\Saved.<ID>',
    '       <game>\\SCUM\\Content\\~Mods.<ID>     -> Backup\\~Mods.<ID>',
    '     ~Mods.<ID> is under Content, NOT under Paks.',
    '     Restore: exit the game, rename current Saved/~Mods to .bad,',
    '     copy the backup back, then delete .bad after checking.',
    '  3. Keep at least 10 GB free.',
    '  4. Put the app in a normal folder (e.g. D:\\AI\\SCUM-Switcher),',
    '     not a low-integrity folder such as D:\\Coding.',
    '',
    'FIRST LAUNCH AND PATHS',
    '  1. Double-click SCUM-Switcher.exe; no installation needed.',
    '  2. The app auto-detects the SCUM install and data folders.',
    '  3. If wrong, open Settings -> Paths:',
    '     - Install folder: the folder containing SCUM\\Content\\Paks',
    '     - Data folder: usually %LocalAppData%\\SCUM',
    '',
    'ADD A SERVER',
    '  1. Click Add, enter a name and an ID.',
    '  2. ID allows letters, digits, _ and -; it cannot be changed later.',
    '  3. Select the server launcher .exe (not .bat / .cmd).',
    '  4. Command-line keyword is only needed when servers share one exe.',
    '  5. Enable "This profile uses no mods" when the server has none.',
    '',
    'SWITCHING',
    '  1. Select the target server, then click Switch to this profile.',
    '  2. The app closes the game/launchers, saves the current data,',
    '     loads the target data, verifies it, and starts the launcher.',
    '  3. Do not open the game or move Saved/~Mods during the switch.',
    '',
    'MISSING SAVE OR MOD FOLDER',
    '  - Missing saves: create empty saves or copy the current saves.',
    '  - Missing mods: put the server mods into Content\\~Mods.<ID> and',
    '    click Retry; or choose Continue with no mods.',
    '',
    'SAFETY',
    '  - Precheck before writing, with journal and automatic rollback.',
    '  - An unfinished switch is offered for rollback on next launch.',
    '  - The trash keeps the newest N displaced archives for the whole',
    '    trash root (default 5, minimum 2), not N per server.',
    '  - Per-server long-term data lives in Saved.<ID> / ~Mods.<ID>.',
    '',
    'DATA',
    '  Config/logs/history/commands/map: %APPDATA%\\SCUM-Switcher',
    '  Saves: %LocalAppData%\\SCUM\\Saved',
    '  Save archives: %LocalAppData%\\SCUM\\Saved.<ID>',
    '  Current mods: <game>\\SCUM\\Content\\Paks\\~Mods',
    '  Mod archives: <game>\\SCUM\\Content\\~Mods.<ID>',
    '',
    'Full English docs: README.en.md and docs\\Player-Guide-EN.md',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, '使用说明.txt'), `\ufeff${text}`, 'utf8');
}

function main() {
  log(`SCUM Server Switcher v${PKG.version}`);
  log(`Project: ${ROOT}`);
  log(`Output : ${OUT}`);

  if (isInside(OUT, ROOT)) {
    throw new Error('Output folder must be outside the source project.');
  }

  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  const electronExe = path.join(dist, 'electron.exe');
  if (!fs.existsSync(electronExe)) {
    throw new Error(
      'Electron runtime not found. Run "npm install" (and "node node_modules/electron/install.js" if needed) first.'
    );
  }

  const staging = `${OUT}.staging-${process.pid}`;
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  ensureDir(staging);

  try {
    log('Copying Electron runtime…');
    copyDir(dist, staging);

    // Never ship Electron's default app.
    const defaultApp = path.join(staging, 'resources', 'default_app.asar');
    if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp, { force: true });

    const appDir = path.join(staging, 'resources', 'app');
    ensureDir(appDir);
    log('Copying application sources…');
    copyDir(path.join(ROOT, 'src'), path.join(appDir, 'src'));

    for (const name of ['README.md', 'README.en.md', 'LICENSE']) {
      const file = path.join(ROOT, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(appDir, name));
    }

    const appPackage = {
      name: PKG.name,
      productName: PKG.productName,
      version: PKG.version,
      description: PKG.description,
      main: 'src/main/main.js',
      author: PKG.author,
      license: PKG.license,
      private: true,
    };
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify(appPackage, null, 2),
      'utf8'
    );

    const renamedExe = path.join(staging, 'SCUM-Switcher.exe');
    fs.renameSync(path.join(staging, 'electron.exe'), renamedExe);
    log('Renamed electron.exe -> SCUM-Switcher.exe');

    const iconFile = path.join(ROOT, 'build', 'icon.ico');
    if (fs.existsSync(iconFile)) {
      fs.copyFileSync(iconFile, path.join(staging, 'SCUM-Switcher.ico'));
      log('Copied app icon (SCUM-Switcher.ico).');
    }
    for (const name of ['README.md', 'README.en.md']) {
      const file = path.join(ROOT, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(staging, name));
    }
    const docsDir = path.join(ROOT, 'docs');
    if (fs.existsSync(docsDir)) {
      copyDir(docsDir, path.join(staging, 'docs'));
      log('Copied player and developer guides (docs/).');
    }
    writeUserGuide(staging);

    const backup = backupExisting();
    fs.renameSync(staging, OUT);
    log(`Build ready: ${OUT}`);
    if (backup) log(`Previous build kept at: ${backup}`);

    setMediumIntegrity(OUT);

    log('');
    log('Done. Launch:');
    log(`  ${path.join(OUT, 'SCUM-Switcher.exe')}`);
  } catch (err) {
    log(`Build failed: ${err.message}`);
    if (fs.existsSync(staging)) log(`Incomplete build left at: ${staging}`);
    process.exitCode = 1;
  }
}

main();
