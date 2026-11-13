# AzuraDLC: can AI really do a good job at DRM?

*by big and scary rara — nov 2026*

---

### tl;dr

for the past 4 months ive been trying to get my hands on Zires projects (owner of AzuraDLC). with help from an anonymous source i got a license for AzuraDLC, a 1.21.11 fabric client. on the surface it looks like a normal fabric mod, but under the hood it uses a native JNI bridge, a custom "atlussy" obfuscator, ed25519 signatures, aes gcm payload containers (`AZE1`), and dynamic class loading

grab some monster before reading this :)

---

## 1. the loader:

when you crack open `azuraloader.jar` (sha256 `cd0e3b08001ed48c952005a17bd05ed3327a4c15979c2d894a300c63a23f2e24`), you immediately notice it's not your average gradle build.

the jar structure looks like this:

```
azuraloader.jar
├── fabric.mod.json
├── lib/
│   ├── a.dat                  <-- plaintext c2 url: "https://azuradlc.lol"
│   ├── z.dat                  <-- link token: {"link":"AZL-redactedverysecretsessiontokenhere"}
│   ├── protocol               <-- "2"
│   ├── min-client             <-- "1.2.57"
│   └── bridge-bootstrap       <-- entrypoint pointer: "j.auaxwn.qwoacljxo.RFipGz16M0oeCU.Kkawwzqecwrk"
├── fxamsidnvvjkviod/gbyszyjbihdeoqjr/
│   ├── zamwyhanaepctoje.so    <-- linux x86_64 native jni bridge (241 kb)
│   ├── tpqjubqasxuncgdi.dll   <-- windows x86_64 native jni bridge (281 kb)
│   └── iysnovzsxqijsxja.so    <-- linux aarch64 native bridge (220 kb)
└── fahqgkjykhoshtgf/...       <-- heavy obfuscated java classes
```

### the native jni bridge 

the devs apperantly use their custom obfuscator called "atlussy", a private java bytecode obfuscator/transpiler.

when `JNI_OnLoad` fires, it registers dynamic native methods onto `blktszbmiyewcvek.gwurvopinebsvwdx.lIIIlllIIlllllIIlIIIIlIl`:
- `ngggozqxctnlyynw(int id, String callerClass)`: string decryption
- `dpwjdvteotzukxlj(int op, Object[] args, Class cls)`: reflection & bytecode exec proxy
- `iunebzbbqeimjube(int[] schedule)`: key schedule initializer

the string vault inside `zamwyhanaepctoje.so` holds 591 encrypted entries. we cant just call `decryptString(id)` from anywhere because the native lib computes **hmac sha512** over `"S/" + callerClass.replace('.', '/')` plus a 12 byte nonce and ciphertext. if the caller class doesnt match or mem prot (`mprotect` / `VirtualProtect`) detects tampering, it throws `LinkageError("String authentication failed")` and dies.

each string is decrypted with **chacha20** (10 double rounds, utf 16le output). all 591 strings, including api routes, json keys, error messages, and salts, were statically dumped.

---

## 2. the hwid

to make sure nobody shares their client, azura generates a 2 tier hardware identifier (hwid) before communicating with `azuradlc.lol`. the logic lives inside `fahqgkjykhoshtgf.kgvpfpmxutvemlgv.IIIlIllIllllIIIlIlllIIlI`.

here is how the algorithm works:

### step 1: raw machine properties
the client probes:
1. `cores`: CPU core count via `Runtime.getRuntime().availableProcessors()`
2. `mac`: sorted list of hardware MAC addresses (filtering out loopback `127.0.0.1`, virtual adapters, docker bridges)
3. `platform`: string formatted as `os.name + os.arch + user.name` (on linux it also checks `/etc/machine-id` or `/sys/class/dmi/id/product_uuid`)

### step 2: salted per-property sha256
each property (in egypt) is salted with the private literal `|azura-id` (statically recovered from string vault index 117):

```
hash = SHA-256(raw_value + "|azura-id")
```

for example, on my linux test box:
```json
{
  "cores": "66b42b70bd6de109b3b909ed690416d9bb75fc00302c805d27d8a18c8fe6744c",
  "mac": "c95897168fa5c80c6286729f07ceaf0c28e24ca3b0762eda61ad37c9969765fa",
  "platform": "bb82a5b2e2b1edd285d93d8861eb79dfa897b5139b96475bde0a87b78b9e8875"
}
```

### step 3: treemap sorting && master hwid
the dictionary keys are inserted into a `java.util.TreeMap` to have strict alphabetical order (`cores`, `mac`, `platform`). they get concatenated into a semicolon delimited string and salted with `|azura-loader-v2`:

```
cores=66b42b...;mac=c95897...;platform=bb82a5...;
```

```
HWID = SHA-256(joined + "|azura-loader-v2")
```

this produced my machine's exact hwid:
`a743ac02ef0b07daa756fc2d311016edb6be65084de61df8958ff47f782090fe`.

---

## 3. the c2 protocol

the loader communicates with `https://azuradlc.lol` across three distinct phases. everything is authenticated, signed, and encrypted

```
+--------+                                               +-------------+
| Loader |                                               | azuradlc.lol|
+----+---+                                               +------+------+
     |                                                          |
     | 1. POST /v1/auth (hwid, ids, link, loaderHash, jarHash)  |
     |--------------------------------------------------------->|
     |                                                          |
     |    <-- 200 OK (session token, heartbeat interval)        |
     |<---------------------------------------------------------|
     |                                                          |
     | 2. GET /v1/latest (Bearer <session>, x-azura-integrity)  |
     |--------------------------------------------------------->|
     |                                                          |
     |    <-- 200 OK (release manifest 1.2.59 + artifact table) |
     |<---------------------------------------------------------|
     |                                                          |
     | 3. GET /v1/files/1.2.59/azuradlc.jar?channel=stable      |
     |--------------------------------------------------------->|
     |                                                          |
     |    <-- 200 OK (AZE1 binary encrypted payload container)  |
     |<---------------------------------------------------------|
```

### integrity checks
the loader sends 2 anti tamper hashes in custom http headers:
- `x-azura-hash` (`loaderHash`): `50f782a908cb013d5d71dd6efa44f5e5dfc5c34c78ab1f1acb96b44de98c51f0`. computed over every zip entry inside the loader jar *excluding* `lib/z.dat`.
- `x-azura-jar-hash` (`jarHash`): `e9993b427f2bf8057971a82d7652b977a2739f0102606711986bec805b847d4e`. raw sha256 of the whole `.jar` on disk.
- `x-azura-integrity`: a **sha256** integrity proof computed dynamically by `llIIllIIIIIIlIlIIlllllIl` over the active session token (not an embedded ed25519 signing key)

### request 1: `/v1/auth`
the loader posts its hwid, link token, and integrity hashes. the c2 server validates the license and returns a json jwt like session token:
```json
{
  "session": "eyJsIjoibGljX2I1M2EzMjdjZDEiLCJoIjoiMDQwNW...",
  "expiresAt": 1794441370385,
  "beat": 45
}
```

### request 2: `/v1/latest`
using `Authorization: Bearer <session>` and `x-azura-integrity`, the client asks for the latest release manifest. the response advertises **Release 1.2.59**:
- `azuradlc.jar`: kind `core`, size `5,928,365` bytes, sha256 `43ae797ff7e470dd20aa2820c6c07b835456decd5b7da72b119284bbc34ab971`.
- `keyshare.jar`: kind `keyshare`, size `285` bytes.
- optional remote modules: `chinahat.jar`, `storageesp.jar`, `tnttimer.jar`, `trapesp.jar`, `wardenhelper.jar`, `waypoints.jar`.

---

## 4. the AZE1 container

when the loader hits `/v1/files/1.2.59/azuradlc.jar?channel=stable`, it doesnt get a zip file back. it receives `production_core.aze1` (5,928,417 bytes), a binary container format.

### the AZE1 structure
```
0x00               0x04              0x10                                                      EOF
+------------------+-----------------+----------------------------------------------------------+
|  Magic ("AZE1")  |   IV / Nonce    |           Ciphertext + AES-GCM Tag (16 bytes)            |
|     (4 bytes)    |   (12 bytes)    |      (contains jar bytes + 20 byte AZMK trailer)         |
+------------------+-----------------+----------------------------------------------------------+
```

### cryptographic key derivation
the decryption key is not stored in plaintext (atleast the devs arent THAT dumb xD). it is derived dynamically via `IlIllIllIlIIIllIIIIIlIlI.derive(...)`:
- **domain**: `"azura-payload-v2"`
- **salt / components**: `session_token` + `"azuradlc.jar"` + `loaderCodeHash`
- **kdf**: native sha256 derivation into a 256 bit aes key.
- **cipher**: `AES/GCM/NoPadding`
- **aad (additional authenticated data)**: `"azura-payload-v2|azuradlc.jar"`

### payload recovery
decrypting the `AZE1` stream yields 5,928,385 bytes, with the 20 byte `AZMK` trailer sitting inside the encrypted payload right after the jar bytes:
- 4 bytes magic: `AZMK`
- 16 bytes: cryptographic verification tag

we sliced off the 20 byte `AZMK` trailer, leaving exactly **5,928,365 bytes**.
we computed sha256 over the sliced bytes:
`43ae797ff7e470dd20aa2820c6c07b835456decd5b7da72b119284bbc34ab971`.
**100% exact match** with the server manifest. i had cleanly extracted `azura-payload.jar` yay!

---

## 5. what does keyshare.jar do?

in the release manifest, alongside the core jar, there was a tiny 285 byte file named `keyshare.jar`.

what on god's green earth does a 285 byte jar do?
in azura's crazy drm, the payload's own internal string vault (`tsgkevdrmsmjvpbr.cfxsxxwmqtsgcihw.lIIIIllIIlIIIIlllllIllll`, method `rwgznnmljxwnputa(int id)`) requires a runtime master key share array (`int[8]`).
`keyshare.jar` is actually a zip holding `share.json` with a per build share (not an executable class or fresh session entropy). the loader parses the hex `share` from `share.json` into 8 little endian `int`s and reflectively passes them to the payload's provision method (`provisionKeyShare(int[] key)`) to unlock the native string vault. without that share being passed at runtime, the payload's string decryptor runs with an uninitialized or zeroed key schedule.


## 6. payload DRM dependencies

these are the main areas tied to the loader and license checks:

Authentication: `allowed()Z`, `require()V`, and `start()V` in `IIIlIIlIIIIIllIIIIIIIlll` (the `1.2.59` obfuscated
name for the payload gate, rotated to `mqgwxpyvrncgsntl.lgrlspilndsgkqso.IlllIIlllIlIlllIIIllIIlI` in `1.2.61`,
where all three methods are native bridge stubs calling `plewrkvxyvprjyai` grrr, Zire!)

Heartbeat: the loader side `HeartbeatMonitor` (`lIlIllIIllllllIllIIIIIll` in `azuraloader.jar`) and its lease
renewal paths (`C2Client.ping()`)

---

## 7. live fetch of release 1.2.61

hooked `azuraloader.jar` directly from a standalone java runner by calling `UmbraBootstrap.initializeEmbedded()` and `HeartbeatMonitor.baseline()` before `C2Client.session()`. that satisfied the `env` check (`agent=false`, `debug=false`, `attach=false`) and pulled the live `1.2.61` stable release from `https://azuradlc.lol` onto my pc, yay!

everything came back encrypted (grr!!) and signed, and every single artifact passed sha256 and ed25519 verification:
* `azuradlc.jar` (core): `13887454` bytes on disk (`13887434` manifest size plus 20 byte `AZMK` trailer), `738` zip entries, sha256 `e780d47cf0646bc017b027cc01f67893dbae657892f3bf3715f8c972e8570ae5`
* `keyshare.jar` (keyshare): `306` bytes on disk (`286` manifest size plus 20 byte trailer), sha256 `8c21b01b83947ecad76072992c612be0bb9c9ccda442072bc64492b53f11a773`
* `chinahat.jar` (module): `7327` bytes on disk (`7307` manifest size), sha256 `93d156aca1bddfa1afd3e0d88becb4c308e888b4727148193a86b3b2a211d38a`
* `storageesp.jar` (module): `9079` bytes on disk (`9059` manifest size), sha256 `55aeeab6577e3e280b13a0a96c0314734940311db872ccc04c82f3f3142204fd`
* `tnttimer.jar` (module): `1989` bytes on disk (`1969` manifest size), sha256 `9487c5c278c46bc28d22707757ae19980a62589edce81dc88b73e1aaad35c3b7`
* `trapesp.jar` (module): `11010` bytes on disk (`10990` manifest size), sha256 `31e3f7db575a7369ca6b85778943599e81c5f4baac281217c0912b613022e4c6`
* `wardenhelper.jar` (module): `3014` bytes on disk (`2994` manifest size), sha256 `42be8a18ed9c7c3717138e5c8963ac7752afd7d1b5d1d0da6f13f7d4f712770f`
* `waypoints.jar` (module): `7359` bytes on disk (`7339` manifest size), sha256 `369ddc7c5c45e9449e5e270ac58e761fa1ca53f394ad21c11264a2638e4694c4`

turns out `keyshare.jar` is not even a class jar lol, it is literally just a zip holding `share.json`:
```json
{"share":"e919ac49f3e7cf0cf0cda163f6d0f671fc673264b3fadc09b44c5c41039622a9","provisionClass":"cgabzvezwxlcdwrh.mvtenjtrxoraowgb.IIIllIIIllIlIlIlIlllllII","provisionMethod":"bqeydmlheupvufcu","descriptor":"([I)V"}
```
`C2Client.parseKeyShare` parses that 64 hex character `share` into 8 little endian `int`s (`[1236015593, 214951923, 1671548400, 1912000758, 1681025020, 165477043, 1096567988, -1457351165]`) and reflectively calls `cgabzvezwxlcdwrh.mvtenjtrxoraowgb.IIIllIIIllIlIlIlIlllllII.bqeydmlheupvufcu(int[])` inside the core payload.

---

## 8. offline replay boundary

traced the actual launch path in `dev.azura.loader.AzuraPreLaunch` to see how far we could push it offline. `onPreLaunch()` calls `C2Client.bundle()` before attaching the core payload, then reflectively calls the key share provision method, registers mixins, adds the payload to `PayloadRegistry`, and arms `HeartbeatMonitor.arm()`.

that heartbeat spawns a daemon thread named `azura-beat`, sleeps 45 seconds plus up to 8 seconds of jitter, and pings `C2Client.ping()` to renew the session (with `HeartbeatMonitor.leaseExpired()` timing out after 15 minutes). if the server sends back `license_revoked`, `license_expired`, `license_locked`, `session_ended`, `unsupported_environment`, `integrity_failed`, or `loader_outdated`, it straight up calls `Runtime.getRuntime().halt(0)` on you lol.

verifying every fetched artifact offline, checking the `AZMK` trailer and manifest sha256, and stripping the 20 byte trailer against the 1.2.61 set gave me these exact jar sizes:

```text
core azuradlc.jar 13887434 bytes
keyshare keyshare.jar 286 bytes
modules 7307, 9059, 1969, 10990, 2994, and 7339 bytes
```

that gets you clean decrypted jars for static analysis, though the shipped loader still enforces auth, signatures, and the heartbeat lease unless you actually patch the launch path.

---

## 9. loader 1.3.30 integrity and azmk verification

peeked at the newer `azuraloader.jar` (`1.3.30` in `fabric.mod.json`, `lib/min-client` `1.2.61`). here the prelaunch entrypoint moved to `jhemukcjurvtchdp.leffykvkfszvwwpa.lIIlllIIlIllIllllIlIIIII`, the c2 client is `llIIllIIIlllIIIlIllIIlll`, and the integrity helpers live in `IIllllllIlIIIlIlIlIIllll`.

for `x-azura-hash`, `IIllllllIlIIIlIlIlIIllll.loaderCodeHash()` and `IlllllIllIIIIIlllllIIlII()` punt straight into the native bridge (`tpwbyplekofvrzel/qyhucngiukkmroqc/pugwhliabweljmli.dll` on windows) via `IIlIllIIllllIlIIlIIIlIII.kvyxyvnrtpmltssf` (ops `13` and `14`). the callback `lIlllIIlIIIIlllIllllIIIl` hashes zip entries with `ZipInputStream` and `TreeMap` using native string ids `561` through `569`. java never checks `loaderCodeHash()` locally; it ships it off to `https://azuradlc.lol`, mixes it into `IIllllllIlIIIlIlIlIIllll.integrityProof(String)`, and uses it inside `lIllIllIllIIIIIllllllllI(...)` for `AZE1` key derivation. since the entry filter itself is hidden in the native string vault, the exact `lib/z.dat` / `lib/a.dat` filter strings stay out of the java constant pool.

funny thing about the `AZMK` check on `keyshare.jar`: nothing checks `AZMK` after `bundle()` returns. `onPreLaunch()` just grabs `core`, `modules`, and `keyShare` and runs straight to `attach(...)` and `keyShare.provisionMethod(words)`. the actual `AZMK` check happens inside `llIIllIIIlllIIIlIllIIlll.lIllIllIllIIIIIllllllllI(...)` right after decryption, where it slices to the manifest `size`, verifies `sha256` and `IIllllllIlIIIlIlIlIIllll.verify(...)`, and checks the next 4 bytes against `AZMK` (`65, 90, 77, 75`).

---

## 10. azuradlc-standalone.jar startup path

now onto `azuradlc-standalone.jar` (`13702351` bytes, sha256 `fc813241150ba92932722ec21fcf3f03fcad205b6fe7d9e4c89ea91fcff884ac`, `739` zip entries), which i built by merging the decrypted core jar, the keyshare, and all the remote modules (`chinahat`, `storageesp`, `tnttimer`, `trapesp`, `wardenhelper`, and `waypoints`) into a single standalone jar. its `fabric.mod.json` sets `preLaunch` to `azura.StandalonePreLaunch` and `client` to `mqgwxpyvrncgsntl.fewjqzwtisqdiyrj.IlIllIIIlIIllIIIllIIIlII`, and neither `C2Client` nor `HeartbeatMonitor` is even in this build.

`azura.StandalonePreLaunch#onPreLaunch()` skips `bundle()` and `arm()` completely; it just builds a hardcoded `int[8]` array (`[-384193463, -202911988, -254959261, -154077583, -60345756, -1275405303, -1270064063, 60170921]`) and calls `IIIllIIIllIlIlIlIlllllII.bqeydmlheupvufcu([I)V`.

meanwhile the inpayload gate (`mqgwxpyvrncgsntl.lgrlspilndsgkqso.IlllIIlllIlIlllIIIllIIlI`, the `1.2.61` version of `IIIlIIlIIIIIllIIIIIIIlll`) is still wired up: `onInitializeClient()` calls `start()`, and `WorldRenderContext` checks `allowed()`. every method on `IlllIIlllIlIlllIIIllIIlI` (`lIIlIIIllIlllllIIlllIIll` op `0` for `allowed()`, `IlIlIIIlIIllIllllIIlllll` op `1` for `require()`, `lIIlIIlIIllIIlIlllIIllIl` op `2` for `start()`, plus ops `3` and `4`) is just a stub calling `IIIllIIIllIlIlIlIlllllII.plewrkvxyvprjyai(int, Object[], Class<?>)` into the native library (`kvnypfsirzybcxzi.dll`, `stathmapjbadkjvv.so`, `nsuoqrvanxlnzgxg.so`).

---

## 11. step by step path to launching azuradlc standalone

to get `azuradlc-standalone.jar` booting cleanly in minecraft `1.21.11` with `fabric-loader-0.19.1` and `fabric-api`:

1. **patch the java gate and c2 urls, and leave the native dll alone**: stub the gate methods in `mqgwxpyvrncgsntl.lgrlspilndsgkqso.IlllIIlllIlIlllIIIllIIlI` (`lIIlIIIllIlllllIIlllIIll` returning `true`, `lIIlIIlIIllIIlIlllIIllIl` and `IlIlIIIlIIllIllllIIlllll` returning `void`), bypass the `MessageDigest.isEqual` native integrity check in `IIIllIIIllIlIlIlIlllllII.<clinit>` (`a7 01 cb` `goto 4615`), and rewrite any `https://azuradlc.lol` `CONSTANT_Utf8_info` entries in `.class` constant pools by updating their `u2` length prefix to `16` (`0x0010`) with `http://127.0.0.1` (do not pad java utf8 strings with `\x00` bytes or `URI` parsing will choke; null padding is only for c strings). keep `spqhwkggsfjynpqb/jjauhovptjylcdch/kvnypfsirzybcxzi.dll` completely untouched, because it already holds the real `.rdata` sha512 digest (`9caac3f4c59367c3880d6a95f0d6511d...` at `0x180027000`, file offset `0x25c00`) and the wrapped native string vault master key at `0x1800059f6..0x180005a74`.
2. **pass the little endian keyshare in `azura/StandalonePreLaunch.class`**: `IIIllIIIllIlIlIlIlllllII.najmvkefnxjevuwd(int[])` clones the 8 int share and xors it with `ynnkhrjmiunyketj()` (which mutates through `ibwmarijtlmzyyde.emhlbgowtwjvkklj.IIlIlllIlIlIllIIIllIIlll.lIllIllIIlIllIlIllIlllIl(int[])` into `[1213615400, 549123787, -2059206599, -1156914186, -930232216, -939049247, 913221494, -1206842057]`) before calling `taitwonxlkyanjis`. passing the little endian `C2Client.parseKeyShare` ints `[1236015593, 214951923, 1671548400, 1912000758, 1681025020, 165477043, 1096567988, -1457351165]` from `azura/StandalonePreLaunch` gives `sha512(preimage)` starting with `9caac3f4c59367c3880d6a95f0d6511d`—matching `.rdata` verbatim and unwrapping the real string vault key.
3. **optional string vault hook**: in `cgabzvezwxlcdwrh/mvtenjtrxoraowgb/IIIllIIIllIlIlIlIlllllII.class`, swapping `invokevirtual java/lang/String.intern:()Ljava/lang/String;` (`b6 00 70`) inside `mrodfccvigqnsoqo(int)` for `invokestatic azura/StandalonePreLaunch.hook:(Ljava/lang/String;)Ljava/lang/String;` lets you intercept decoded native strings on the fly (like swapping `"Made with <3 by zire and exvinixty"` for something funnier xD).
4. **repack and launch**: pack the patched classes and untouched native dll back into the jar, and minecraft `1.21.11` with `fabric-loader-0.19.1` and `fabric-api` boots right past `StandalonePreLaunch`, `onInitializeClient()`, resource loading, and texture atlas creation.

---

## 12. current status

~~ive mapped the relevant classes, methods, and dependencies, and havent made any bytecode changes. it is 4am and cats need sleep too~~

i have a fully running version as of 13/11/2026. yay!

---

### final thoughts

building complex drm into a java client is always an uphill battle. no matter how many layers of jni bridges, chacha20 string vaults, ed25519 signatures, and custom container formats you pile on, at the end of the day:
1. the bytecode must run on the client's jvm.
2. your container decryption keys can be derived if the math is deterministic.
3. asm bytecode manipulation will always win against static checks.

huge respect to anyone working in this field, im just a beginner still lol. hope you enjoyed the breakdown
