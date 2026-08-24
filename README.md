# Veil Quick Miner

One click mining for Veil. Paste an address, pick solo or pool, pick an algo, hit start. The app grabs the right miner release, checks it against the published SHA256SUMS, and runs it for you. Solo mode runs a local stratum proxy against your own veild so the whole block reward lands on your address.

Covers all three algos:

| Algo | Hardware | Miner |
| --- | --- | --- |
| RandomX | CPU | Veil-Miner-CPU |
| ProgPoW | GPU (NVIDIA or AMD) | Veil-Miner |
| SHA256d | GPU (NVIDIA) | Veil-Miner-SHA |

Status: milestone 2, pool mining works end to end. The app downloads the pinned miner release, verifies it against SHA256SUMS, refuses to run anything that fails the check, launches the miner and shows the live hashrate. Solo mode still needs the local proxy.

Pool presets come from `src/pools.json`, verified against the endpoints on mining.veil-info.org: yadaminers for all three algos, FastPool for RandomX. SHA256d is linux only until Veil-Miner-SHA gets windows builds.

## Run it

```
npm install
npm start
```

`npm test` checks address validation and miner output parsing. `npm run smoke` boots the app, exercises validation over IPC, saves a screenshot and exits; add `QUICKMINER_SMOKE_LIVE=1` to have it press start and mine for real until the first hashrate shows. `node test/live.js` runs the download, verify, launch, hashrate pipeline headless against a throwaway address.

## Roadmap

- [x] the window: address check, solo or pool, algo picker, hardware detect, veil.conf finder
- [x] miner manager: fetch releases, verify checksums, launch, live hashrate
- [x] pool presets with verified stratum urls
- [ ] solo proxy: SHA256d, then ProgPoW, then RandomX
- [ ] installers for windows, linux, mac
