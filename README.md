# Veil Quick Miner

One click mining for Veil. Paste an address, pick solo or pool, pick an algo, hit start. The app grabs the right miner release, checks it against the published SHA256SUMS, and runs it for you. Solo mode runs a local stratum proxy against your own veild so the whole block reward lands on your address.

Covers all three algos:

| Algo | Hardware | Miner |
| --- | --- | --- |
| RandomX | CPU | Veil-Miner-CPU |
| ProgPoW | GPU (NVIDIA or AMD) | Veil-Miner |
| SHA256d | GPU (NVIDIA) | Veil-Miner-SHA |

Status: milestone 3, pool and solo both work end to end. The app downloads the pinned miner release, verifies it against SHA256SUMS, refuses to run anything that fails the check, launches the miner and shows the live hashrate. Solo mode preflights your veild over rpc, downloads veilproxy the same verified way, runs it locally and points the miner at it, so the whole block reward lands on the node's mining address. Proven on regtest: the engine mined real RandomX blocks through the full stack.

Pool presets come from `src/pools.json`, verified against the endpoints on mining.veil-info.org: yadaminers for all three algos, FastPool for RandomX. SHA256d runs on Linux (NVIDIA and AMD) and Windows (NVIDIA); macOS has no SHA256d build yet.

Solo prerequisites: your veild needs `miningaddress=<your address>` in veil.conf (rewards go there), and for SHA256d a veild built from current master. RandomX solo uses veilproxy v3.0.2 or later (v3.0.1 had a login bug that silently dropped xmrig's shares).

## Run it

```
npm install
npm start
```

`npm test` checks address validation, miner output parsing and the solo building blocks. `npm run smoke` boots the app, exercises validation over IPC, saves a screenshot and exits; add `QUICKMINER_SMOKE_LIVE=1` to have it press start and mine for real until the first hashrate shows. `node test/live.js` runs the download, verify, launch, hashrate pipeline headless against a throwaway address. `node test/live-solo.js <rpcport> <address>` runs the whole solo stack against a local veild and waits for an accepted block.

## Build installers

```
npm run dist
```

Builds installers into `dist/` for the current platform: dmg and zip on mac (arm64 and x64), an nsis setup exe on Windows, AppImage and deb on Linux. `npm run icon` regenerates the icon set from `build/make-icon.py`. On a tag push the release workflow builds all three platforms and publishes them with a SHA256SUMS.txt.

The installers are unsigned for now, so the operating system will complain the first time. The download is fine, verify it against SHA256SUMS.txt if you want to be sure. Signing certificates come later.

**macOS.** Because the app is not notarized, a downloaded copy is quarantined and Gatekeeper shows "Veil Quick Miner is damaged and can't be opened". It is not damaged, that is just the message macOS gives an un-notarized app on Apple Silicon. Drag it to Applications, then clear the quarantine flag once:

```
xattr -dr com.apple.quarantine "/Applications/Veil Quick Miner.app"
```

Then open it normally. (Right click then Open, and Open Anyway in Settings, usually do not clear the "damaged" case, the xattr command does.)

**Windows.** SmartScreen warns on the setup exe: click More info, then Run anyway.

The installer stays small (the miners and the proxy are not bundled). The app downloads the right release the first time you mine and verifies it against its checksums, so nothing binary ships inside the installer.

## Roadmap

- [x] the window: address check, solo or pool, algo picker, hardware detect, veil.conf finder
- [x] miner manager: fetch releases, verify checksums, launch, live hashrate
- [x] pool presets with verified stratum urls
- [x] solo mode: local veilproxy against your own veild, all three algos
- [x] installers for windows, linux, mac (electron-builder + release CI)
- [ ] code signing / notarization
