# Veil Quick Miner

One click mining for Veil. Paste an address, pick solo or pool, pick an algo, hit start. The app grabs the right miner release, checks it against the published SHA256SUMS, and runs it for you. Solo mode runs a local stratum proxy against your own veild so the whole block reward lands on your address.

Covers all three algos:

| Algo | Hardware | Miner |
| --- | --- | --- |
| RandomX | CPU | Veil-Miner-CPU |
| ProgPoW | GPU (NVIDIA or AMD) | Veil-Miner |
| SHA256d | GPU (NVIDIA) | Veil-Miner-SHA |

Status: milestone 3, pool and solo both work end to end. The app downloads the pinned miner release, verifies it against SHA256SUMS, refuses to run anything that fails the check, launches the miner and shows the live hashrate. Solo mode preflights your veild over rpc, downloads veilproxy the same verified way, runs it locally and points the miner at it, so the whole block reward lands on the node's mining address. Proven on regtest: the engine mined real RandomX blocks through the full stack.

Pool presets come from `src/pools.json`, verified against the endpoints on mining.veil-info.org: yadaminers for all three algos, FastPool for RandomX. SHA256d is linux only until Veil-Miner-SHA gets windows builds.

Solo prerequisites: your veild needs `miningaddress=<your address>` in veil.conf (rewards go there), and for SHA256d a veild built from current master. RandomX solo uses veilproxy v3.0.2 or later (v3.0.1 had a login bug that silently dropped xmrig's shares).

## Run it

```
npm install
npm start
```

`npm test` checks address validation, miner output parsing and the solo building blocks. `npm run smoke` boots the app, exercises validation over IPC, saves a screenshot and exits; add `QUICKMINER_SMOKE_LIVE=1` to have it press start and mine for real until the first hashrate shows. `node test/live.js` runs the download, verify, launch, hashrate pipeline headless against a throwaway address. `node test/live-solo.js <rpcport> <address>` runs the whole solo stack against a local veild and waits for an accepted block.

## Roadmap

- [x] the window: address check, solo or pool, algo picker, hardware detect, veil.conf finder
- [x] miner manager: fetch releases, verify checksums, launch, live hashrate
- [x] pool presets with verified stratum urls
- [x] solo mode: local veilproxy against your own veild, all three algos
- [ ] installers for windows, linux, mac
