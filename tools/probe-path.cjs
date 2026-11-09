const path = require('path');
const fs = require('fs');

function resolveGameDir(input) {
  if (!input) return input;
  const candidates = [input, path.join(input, 'game'), path.resolve(input, '..')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'dota', 'pak01_dir.vpk'))) return dir;
  }
  return input;
}

const base = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta';
const cases = [base, path.join(base, 'game'), path.join(base, 'game', 'dota'), 'C:\\nope'];

for (const c of cases) {
  const r = resolveGameDir(c);
  console.log(`in : ${c}`);
  console.log(`out: ${r}`);
  console.log(`vpk: ${fs.existsSync(path.join(r, 'dota', 'pak01_dir.vpk'))}`);
  console.log('---');
}
