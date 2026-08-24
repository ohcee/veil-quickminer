# Signing and notarization

The installers ship unsigned today. That is why macOS says "Veil Quick Miner is
damaged and can't be opened" and Windows SmartScreen warns on the setup exe.
Signing (and, on macOS, notarizing) removes both prompts so the app opens with a
double click. This is the how and the what-it-costs.

## The short version

| Platform | What removes the warning | Yearly cost | Effort |
| --- | --- | --- | --- |
| macOS | Developer ID signature + notarization | $99 (Apple Developer Program) | low, well trodden |
| Windows | Code signing certificate | ~$120/yr (Azure Trusted Signing) to ~$400/yr (EV cert) | medium |

macOS is the clear first move: $99/yr, and electron-builder does the signing and
notarizing for you once the credentials are in place. Windows is the messier one
because of how certificates and SmartScreen reputation work.

Nothing in the code needs to change to add signing. electron-builder reads the
credentials from environment variables at build time, so this is a secrets and
config task, not a rewrite.

## macOS

### One time setup

1. Enroll in the Apple Developer Program ($99/yr) at developer.apple.com.
2. Create a **Developer ID Application** certificate (Xcode > Settings > Accounts
   > Manage Certificates, or on the developer site). Export it as a `.p12` with a
   password.
3. Create an **App Store Connect API key** for notarization (Users and Access >
   Integrations > App Store Connect API): note the Issuer ID and Key ID and
   download the `.p8`. An Apple ID plus an app specific password also works, but
   the API key is cleaner for CI.

### electron-builder config

Add to the `build.mac` block in `package.json`:

```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "notarize": true
}
```

`hardenedRuntime` is required for notarization. Electron apps generally do not
need custom entitlements, but if a future feature needs one (for example the
JIT entitlement), add an `entitlements` plist.

### Building signed + notarized

Locally or in CI, set:

```
CSC_LINK=<base64 of the Developer ID .p12>     # or a file path
CSC_KEY_PASSWORD=<the .p12 password>
APPLE_API_KEY=<path to the .p8>                # notarization
APPLE_API_KEY_ID=<Key ID>
APPLE_API_ISSUER=<Issuer ID>
```

Then `npm run dist` signs and notarizes with no other change. Notarization adds a
few minutes (Apple staples a ticket to the dmg). After this, the `xattr` dance in
the README is no longer needed: the app opens normally on any Mac.

Signing must run on a macOS machine or the macOS CI runner, which the release
workflow already uses.

## Windows

Windows is trickier because a plain certificate file no longer buys instant
trust, and SmartScreen keeps its own reputation score.

### The certificate options

- **Azure Trusted Signing** (~$10/month). Microsoft's cloud signing service. It
  is the cheapest route to a real signature, and because it chains to a Microsoft
  root, SmartScreen trusts it quickly. Signing happens through Azure, so there is
  no cert file to store, but it needs an Azure subscription and a one time
  identity validation. electron-builder supports it through a custom sign step.
- **OV (Organization Validation) certificate** (~$150 to $400/yr from a CA like
  Sectigo or DigiCert). A `.pfx` you can drop into CI. Signs fine, but SmartScreen
  still warms up reputation over downloads and time, so early users may still see
  a warning for a while.
- **EV (Extended Validation) certificate** (~$300 to $600/yr). Gives SmartScreen
  trust immediately, but the private key must live on a hardware token or cloud
  HSM, so it cannot sit in a CI secret. That makes CI signing awkward unless the
  provider offers a cloud signing API.

For this project, **Azure Trusted Signing** is the best value: cheap, CI
friendly, and no hardware token.

### With a .pfx (OV cert)

Set in CI and electron-builder signs the nsis installer:

```
WIN_CSC_LINK=<base64 of the .pfx>
WIN_CSC_KEY_PASSWORD=<the .pfx password>
```

Windows signing runs on the Windows CI runner, which the release workflow already
uses. (macOS can cross sign Windows with an added tool, but signing on the
Windows runner is simpler.)

### With Azure Trusted Signing

Use electron-builder's `win.signtoolOptions` / custom `sign` hook to call the
Azure signing tool (`azuresigntool` or the Trusted Signing task). This is a small
addition to the Windows job rather than a cert file.

## Wiring it into CI

All of the above are GitHub Actions secrets:

- `CSC_LINK`, `CSC_KEY_PASSWORD` (macOS cert)
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (notarization)
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Windows OV cert) **or** the Azure
  Trusted Signing credentials

The `.github/workflows/release.yml` jobs pass these through as `env:` on the
build step. electron-builder detects them and signs automatically, so the yaml
change is just forwarding the secrets, not new build logic.

## Recommended order

1. **macOS now** ($99/yr). Biggest quality of life win, easiest to set up, kills
   the "damaged" message.
2. **Azure Trusted Signing for Windows** when you want to drop the SmartScreen
   warning. Cheapest and CI friendly.
3. Leave Linux as is. AppImage and deb are not signed the way Windows and macOS
   are, and the checksums file already covers integrity.

Until then, the published `SHA256SUMS.txt` is how anyone verifies a download.
