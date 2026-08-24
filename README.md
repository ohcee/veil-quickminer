# Veil Quick Miner

One click mining for Veil. Paste an address, pick solo or pool, pick an algo, hit start. The app grabs the right miner release, checks it against the published SHA256SUMS, and runs it for you. Solo mode runs a local stratum proxy against your own veild so the whole block reward lands on your address.

Covers all three algos:

| Algo | Hardware | Miner |
| --- | --- | --- |
| RandomX | CPU | Veil-Miner-CPU |
| ProgPoW | GPU (NVIDIA or AMD) | Veil-Miner |
| SHA256d | GPU (NVIDIA) | Veil-Miner-SHA |

Status: milestone 1, interface only. Address validation, hardware detection and the veil.conf finder work. Miner download and launch come next, then the solo proxy, SHA256d first.

## Run it

```
npm install
npm start
```

`npm test` checks the address validation. `npm run smoke` boots the app, exercises validation over IPC, saves a screenshot and exits.

## Roadmap

- [x] the window: address check, solo or pool, algo picker, hardware detect, veil.conf finder
- [ ] miner manager: fetch releases, verify checksums, launch, live hashrate
- [ ] pool presets with verified stratum urls
- [ ] solo proxy: SHA256d, then ProgPoW, then RandomX
- [ ] installers for windows, linux, mac
