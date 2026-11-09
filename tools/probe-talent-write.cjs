const fs = require('fs');
const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';
const vpkMod = require('../electron/vpk.cjs');
const exp = require('../electron/exporter.cjs');

const srcVpk = vpkMod.openVpk(path.join(GAME, 'dota/pak01_dir.vpk'));
const HERO_FILE = 'scripts/npc/heroes/npc_dota_hero_drow_ranger.txt';
const GLOBAL_FILE = 'scripts/npc/npc_abilities.txt';

function check(label, relFile, needles) {
  const text = vpkMod.readText(srcVpk, relFile);
  console.log(`\n--- ${label} ---`);
  for (const n of needles) {
    const idx = text.indexOf(n);
    console.log(`  ${idx >= 0 ? 'FOUND' : 'MISSING'}  ${JSON.stringify(n)}`);
    if (idx >= 0) {
      const a = text.lastIndexOf('\n', idx - 1);
      const b = text.indexOf('\n', idx + n.length);
      console.log(`      ctx: ${text.slice(a + 1, b).trim()}`);
    }
  }
}

check('BEFORE: hero talent modifier', HERO_FILE, [
  'special_bonus_unique_drow_ranger_1',
  '"special_bonus_unique_drow_ranger_1"',
]);

const changes = [
  {
    key: 'heroes/npc_dota_hero_drow_ranger/talents.special_bonus_unique_drow_ranger_1.bonus.drow_ranger_multishot.arrow_damage_pct',
    id: 'npc_dota_hero_drow_ranger',
    category: 'heroes',
    field: 'talents.special_bonus_unique_drow_ranger_1.bonus.drow_ranger_multishot.arrow_damage_pct',
    oldValue: '+25',
    newValue: '+33',
  },
];
console.log('\nlocate ->', JSON.stringify(exp.locate(changes[0])));

// Direct function test against raw text (no game write).
const raw = vpkMod.readText(srcVpk, HERO_FILE);
const block = exp.findBlockOffset(raw, ['DOTAHeroes', 'npc_dota_hero_drow_ranger', 'AbilityDefinitions', 'drow_ranger_multishot', 'AbilityValues']);
console.log('AbilityValues block offset:', block);
if (block === -1) { console.log('FAIL: block not found'); process.exit(1); }

const out = exp.setTalentModifierInBlock(raw, block, 'arrow_damage_pct', 'special_bonus_unique_drow_ranger_1', '+33');
console.log('changed:', out !== raw, '| length delta:', out.length - raw.length);

const i = out.indexOf('"arrow_damage_pct"');
console.log('\n--- AFTER snippet ---');
console.log(out.slice(i, i + 320));

// Braces must stay balanced.
const bal = (out.match(/\{/g) || []).length - (out.match(/\}/g) || []).length;
console.log('\nbrace balance (should match original):',
  (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length, '->', bal);
