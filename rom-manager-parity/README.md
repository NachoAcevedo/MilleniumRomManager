# Steam ROM Manager Importer

Windows x64 plugin for Millennium. It opens an independent Steam ROM Manager build with parser toggles, game selection, cover art, filters, and import backed by the SRM engine. The ZIP bundles Electron and the built importer. It uses a separate profile under `%APPDATA%\MillenniumRomManager\userData`.

## Install

1. Download the Windows x64 Importer ZIP from Releases and extract the `rom-manager-parity` folder into `Steam\millennium\plugins`.
2. Restart Steam and enable **Importador de juegos · SRM 2.6.3** in Millennium. Disable the Launcher if active.
3. Open **Add a Non-Steam Game** and configure the parsers for your PC.

**Restart now** queues the selected games and asks a background worker to close Steam, apply the import, and reopen it. **Later** queues the same import until Steam closes. While the queue is pending, Windows can start the worker at sign-in. If Steam opens first, the worker waits until Steam exits again. These restart flows are experimental.

## Source

`srm-source` is based on [Steam ROM Manager v2.6.3](https://github.com/SteamGridDB/steam-rom-manager/tree/v2.6.3), commit `b3f46785c997226cb28515dd73a9ef58851a8fdc`. It contains the modified source under the upstream GPL-3.0-or-later license. To rebuild, run `yarn install --frozen-lockfile` and `yarn build:dist` in `srm-source` with Node 24 and Yarn Classic. Copy the resulting `dist` and Electron 44.7.2 Windows x64 runtime into the plugin folder as `dist` and `runtime`.
