'use strict';
// Detect whether Dota 2 is currently running.
//
// Why this matters: the engine keeps its pak files mapped and resolves its
// mount table at launch. Writing `<game>/0test` (or restoring gameinfo.gi)
// while the game is live either fails on a locked file or succeeds and gets
// ignored, because the running process already resolved its search paths.
// Either way the user sees a failed or pointless export, so we check up front
// and say so plainly.
//
// Implementation notes — both of these were bugs before:
//   * Do NOT use `tasklist /FI "IMAGENAME eq dota2.exe"`. On a non-English
//     Windows the "no tasks match" case is a localized sentence, and it comes
//     back in the console codepage (GBK here), so any later string matching is
//     garbage. We list every process with `/FO CSV /NH` and decode as UTF-8,
//     which yields stable `"name.exe","pid",...` rows.
//   * `tasklist` is a Windows tool. Elsewhere we fall back to `pgrep`, and if
//     that is unavailable we assume the game is NOT running rather than
//     blocking the export on a false positive.

const { execFile } = require('child_process');

// The game's image name is exactly `dota2.exe`; `dota2` is the POSIX form.
const WIN_IMAGE_NAME = 'dota2.exe';
const POSIX_PROC_NAME = 'dota2';
const PROCESS_NAMES = [WIN_IMAGE_NAME, POSIX_PROC_NAME];
const TASKLIST_MAX_BUFFER = 32 * 1024 * 1024;
const CSV_WIN_ROW = new RegExp(`^"${WIN_IMAGE_NAME.replace('.', '\\.')}","(\\d+)"`, 'i');

/**
 * @returns {Promise<{running: boolean, pids: number[], detail?: string}>}
 */
function isDotaRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      execFile('pgrep', ['-x', POSIX_PROC_NAME], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve({ running: false, pids: [], detail: err.message });
          return;
        }
        const pids = String(stdout)
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
          .filter((n) => !Number.isNaN(n));
        resolve({ running: pids.length > 0, pids });
      });
      return;
    }

    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 8000, maxBuffer: TASKLIST_MAX_BUFFER, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          // tasklist missing or timed out — don't block the export on it.
          resolve({ running: false, pids: [], detail: err.message });
          return;
        }
        const text = Buffer.from(stdout).toString('utf8');
        const pids = [];
        for (const line of text.split(/\r?\n/)) {
          // Format: "dota2.exe","1234","Console","1","1,234 K"
          const m = CSV_WIN_ROW.exec(line.trim());
          if (m) pids.push(Number(m[1]));
        }
        resolve({ running: pids.length > 0, pids });
      }
    );
  });
}

module.exports = { isDotaRunning, PROCESS_NAMES };
