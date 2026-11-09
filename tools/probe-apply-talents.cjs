const fs = require('fs');
const path = require('path');
const GAME = 'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game';
const store = require('../electron/data-store.cjs');
const vpkMod = require('../electron/vpk.cjs');
const exp = require('../electron/exporter.cjs');

store.init(GAME);

const changes = [
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'talents.special_bonus_unique_drow_ranger_1.bonus.drow_ranger_multishot.arrow_damage_pct',
    oldValue: '+25', newValue: '+33',
  },
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'abilities.drow_ranger_multishot.values.arrow_width',
    oldValue: '90', newValue: '120',
  },
  {
    category: 'heroes',
    id: 'npc_dota_hero_drow_ranger',
    field: 'talents.special_bonus_attack_range_75.value.value',
    oldValue: '75', newValue: '90',
  },
];

// Mimic what apply() does, but write to a scratch VPK instead of the game.
const srcVpk = vpkMod.openVpk(path.join(GAME, 'dota/pak01_dir.vpk'));
const byFile = exp.groupChanges(changes);
const output = [];

for (const [relFile, objMap] of byFile) {
  const original = vpkMod.readText(srcVpk, relFile);
  let text = original;
  let applied = 0;

  for (const { path: objPath, kind, fields } of objMap.values()) {
    for (const f of fields) {
      const offset = exp.findBlockOffset(text, objPath);
      if (offset === -1) { console.log('BLOCK MISSING', relFile, objPath.join('.')); continue; }
      const next = kind === 'abilityValue'
        ? exp.setAbilityValueInBlock(text, offset, f.field, f.newValue)
        : kind === 'talentModifier'
          ? exp.setTalentModifierInBlock(text, offset, f.field, f.modifier, f.newValue)
          : exp.setFieldInBlock(text, offset, f.field, f.newValue);
      if (next !== text) { text = next; applied++; } else console.log('NO CHANGE', f.field);
    }
  }

  console.log(`${relFile}: ${applied} applied, length ${original.length} -> ${text.length}`);
  const balO = (original.match(/\{/g) || []).length - (original.match(/\}/g) || []).length;
  const balN = (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
  console.log(`  brace balance ${balO} -> ${balN}`, balO === balN ? 'OK' : 'BROKEN');

  // Re-parse to prove the tree still loads and carries the new values.
  const kv = require('../electron/kv-parser.cjs');
  try {
    const { root } = kv.parseKV(text);
    if (relFile.includes('heroes/')) {
      const av = root.DOTAHeroes.npc_dota_hero_drow_ranger.AbilityDefinitions.drow_ranger_multishot.AbilityValues;
      console.log('  arrow_damage_pct:', JSON.stringify(av.arrow_damage_pct));
      console.log('  arrow_width:', JSON.stringify(av.arrow_width));
      console.log('  ability count:', Object.keys(root.DOTAHeroes.npc_dota_hero_drow_ranger.AbilityDefinitions).length);
    } else {
      const v = root.DOTAAbilities.special_bonus_attack_range_75.AbilityValues;
      console.log('  attack_range_75:', JSON.stringify(v));
      console.log('  total abilities:', Object.keys(root.DOTAAbilities).length);
    }
  } catch (e) {
    console.log('  PARSE FAILED:', e.message);
  }

  output.push({ rel: relFile, data: Buffer.from(text, 'utf8') });
}

const outPath = path.join(__dirname, 'out-test-talents.vpk');
vpkMod.writeVpk(outPath, output);
console.log('\nwrote', outPath, fs.statSync(outPath).size, 'bytes');

// Read back through the VPK reader.
const back = vpkMod.openVpk(outPath);
for (const o of output) {
  const t = vpkMod.readText(back, o.rel);
  console.log(`  roundtrip ${o.rel}: ${t ? t.length + ' chars ' + (t === o.data.toString('utf8') ? 'MATCH' : 'MISMATCH') : 'MISSING'}`);
}
