# D2Forge

A modern desktop editor for Dota 2's offline-mode numbers — hero stats, ability
values, and item properties. Built with Electron + React.

修改 Dota 2 离线模式数值的桌面编辑器：英雄属性、技能数值、物品属性。中英双语界面。

---

## What it does

Dota 2 ships its gameplay data inside VPK archives (`pak01_dir.vpk` plus a set of
`pak01_NNN.vpk` volumes). D2Forge reads those archives directly, lets you edit
numeric fields through a structured browser (hero → ability → value), and writes
only the files you actually changed into a small override archive.

The override is activated by adding a `Game 0test` entry to `dota/gameinfo.gi`,
which makes the engine read your changes on top of the base game. **Changes apply
only to locally hosted/local-server matches against bots — not to Valve official
matchmaking.**

范围限定：只改数值。不涉及模型、动画、音效、技能逻辑。

## Features

- **Hierarchical browsing** — heroes → abilities → values, items → properties.
  No digging through flat name lists.
- **Skills and talents first** — the hero panel opens with abilities and the
  talent tree at the top, then stats. Every section is a collapsible accordion,
  so you expand only what you need instead of scrolling past everything.
- **Mixed search** — type Chinese, English, or the raw internal name
  (`幻影`, `anti`, `npc_dota_hero_axe`) into one box.
- **Survives game updates** — re-index the VPK after a patch; edits whose
  underlying value is unchanged keep applying, edits whose target moved are
  reported instead of silently corrupting the file.
- **Every edit is visible** — modified fields are highlighted and always show the
  original value next to your new one.
- **Bilingual UI** — Chinese and English, using the game's own localization
  tokens so ability and item names match what you see in game. 98% of ability
  value labels resolve to Chinese; the remainder are boolean flags
  (`is_global`, `has_multishot`) that are not meaningful to edit anyway.
- **Reversible at three levels**:
  - *per field* — revert one value
  - *一键还原* — clear all edits
  - *恢复原版* — unmount the override and restore `gameinfo.gi` byte-for-byte

  The last two are what you use to hop between an edited and a clean game for
  online play.

## Requirements

- Windows 10/11
- Dota 2 installed (Steam)
- Node.js 18+ (only if running from source)

## Running from source

```bash
npm install
npm start          # run against the built ./dist bundle
npm run app        # dev mode: Vite dev server + Electron with hot reload
npm run preview    # rebuild, then start
```

On first launch, point the app at your Dota 2 **`game`** folder:

```
Steam\steamapps\common\dota 2 beta\game
```

The picker also accepts the Steam install root (`...\dota 2 beta`) and resolves
the correct subdirectory automatically.

## Building a standalone executable

```bash
npm run dist
```

Output lands in `release/`:

- `release/win-unpacked/D2Forge.exe` — portable, just run it
- `release/D2Forge Setup <version>.exe` — NSIS installer

The portable folder is self-contained (~350 MB); copy it anywhere.

## How the override works

1. Only changed files are re-serialized — a hero file with two edits keeps all
   its original formatting and comments.
2. Those files are packed into `dota/0test/pak01_dir.vpk`.
3. `Game 0test` is inserted into the `SearchPaths` block of `dota/gameinfo.gi`.

Dota 2 validates `gameinfo.gi` with a CRC32 check, so step 3 rewrites a trailing
comment's bytes to restore the original hash. The unmodified file is backed up
before anything is touched, and `Revert` restores it exactly.

## Project layout

```
electron/
  main.cjs          Electron main process, IPC handlers, path resolution
  vpk.cjs           VPK read/write (v1 + v2, split archives)
  kv-parser.cjs     Valve KeyValues (KV1) tokenizer and serializer
  data-store.cjs    Indexes the VPK, exposes heroes/items
  exporter.cjs      Applies edits and writes the override VPK
  gameinfo.cjs      gameinfo.gi injection with CRC32 compensation
  localization.cjs  Lazy lookup of the game's localisation tokens
  change-store.cjs  Persists your edit history across sessions
src/                React UI
tools/              Standalone probe scripts used to verify each subsystem
scripts/launch.cjs  Launcher that strips ELECTRON_RUN_AS_NODE before boot
```

## Notes on the probe scripts

`tools/probe-*.mjs` are end-to-end verification harnesses, not part of the app.
They read your installed game files, perform a round-trip edit, and assert the
resulting VPK is structurally intact. Useful when a game patch changes the file
layout.

## Credits

The override mechanism (`0test` search path) follows the approach used by
[Dota2Editor](https://github.com/ado-cs/Dota2Editor). This project is an
independent implementation with a structured UI, VPK v2 support, and edit
preservation across game updates.

Not affiliated with or endorsed by Valve. Dota 2 is a trademark of Valve
Corporation.
