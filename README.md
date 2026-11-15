# Millennium ROM Manager

Windows plugins for [Millennium](https://steambrew.app/) that add Steam ROM Manager workflows and automatic external launcher cleanup to Steam.

| Plugin | What it does |
| --- | --- |
| [Steam ROM Manager Launcher](rom-manager-launcher) | Opens your existing Steam ROM Manager installation in an independent window and brings it to the front. |
| [Steam ROM Manager Importer](rom-manager-parity) | Runs a bundled build of Steam ROM Manager 2.6.3 with a Steam-oriented importer UI, parser toggles, artwork, filters, and deferred import. |
| [ExternalLauncherAutoClose](launcher-auto-close) | Detects supported launchers for non-Steam games and closes them after the last game exits. |

Download the ZIP for either Steam ROM Manager plugin from [Releases](https://github.com/NachoAcevedo/MilleniumRomManager/releases). Extract the folder inside it into `Steam\millennium\plugins`, restart Steam, and enable it in Millennium → Plugins. Enable one ROM Manager plugin at a time because both use **Add a Non-Steam Game**. For ExternalLauncherAutoClose, follow its [installation instructions](launcher-auto-close).

The importer includes SRM's [GPL-3.0-or-later source and license](rom-manager-parity/srm-source/LICENSE).
