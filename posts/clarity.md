# Clarity: why a broken zip and a java agent aren't DRM

*by big and scary rara — nov 2026*

---

### tl;dr

i got my hands on Clarity, Claude's *finest* work. I was provided `Loader.jar` and `stage-000.jar`, by an anonymous source.

`Loader.jar` is a java agent and a swing launcher. it talks to a licence server at `wss://104-156-154-148.sslip.io/load` over a custom encrypted websocket protocol, pulls down stage chunks, checks every sha256, and injects the client straight into the running minecraft class loader.

the funny part is `stage-000.jar`. it is a `2074` entry zip who's central directory offsets are intentionally broken so normal zip tools die right after entry 11, and inside it is already a complete fabric mod (`fabric.mod.json` targeting `minecraft ~26.1.2`, `fabricloader >=0.19.5`, `java >=25`, plus `clarity.mixins.json` with `126` client mixins). the loader only existed to gate and deliver it, not because the stage actually needs an agent.

so i fixed the zip, nuked the entire agent and DRM package, disabled the presence client, scrubbed the old hostname, added a tiny `preLaunch` native extractor, and packed it into a normal standalone fabric mod jar. drop it in `mods`, launch `26.1.2`, no loader, no licence, no server.

as always: grab some monster before reading this :)

---

## 1. the loader

when you pop open `Loader.jar`, it only has `50` zip entries and `39` real files. the manifest is standard java agent thingies:

```
Premain-Class: need.clarity.agent.ClarityAgent
Agent-Class: need.clarity.agent.ClarityAgent
Can-Redefine-Classes: true
Can-Retransform-Classes: true
Main-Class: need.clarity.agent.loader.Loader
```

the jar layout is pretty clean:

```
Loader.jar
├── assets/clarity/
│   ├── fonts/Inter-Regular.ttf
│   ├── fonts/Inter-SemiBold.ttf
│   ├── fonts/JetBrainsMono-Regular.ttf
│   ├── icon.png
│   ├── textures/fx/clarity_logo.png
│   └── textures/fx/clarity_logo_clean.png
├── need/clarity/agent/
│   ├── AgentStatus.class
│   ├── Attach.class
│   ├── ClarityAgent.class
│   └── WatermarkSlot.class
├── need/clarity/agent/loader/
│   ├── Injector.class
│   ├── Instance.class
│   ├── InstanceScanner.class
│   ├── JsonLite.class
│   ├── Loader.class
│   ├── LoaderPanel.class
│   └── LoaderTheme.class
└── need/clarity/agent/net/
    ├── ClarityConnect.class
    └── ServerKey.class
```

`Loader` just wraps `LoaderPanel`. if you pass a pid argument it jumps straight to `Attach`, otherwise it opens the swing window. `LoaderPanel` scans running jvms via `InstanceScanner`, spots minecraft by classpath or command line keywords, and calls `Injector.run(instance, "wss://104-156-154-148.sslip.io/load", licenceKey, statusCallback)`.

before attaching, `Injector` builds a HWID by grabbing every network interface mac address, sorting them as hex strings, concatenating them, and taking the sha256. then it attaches to the target pid with `com.sun.tools.attach.VirtualMachine` and calls `loadAgent` with six tab separated arguments:

```
wsUrl, licenceKey, hwid, uuid, build, statusFile
```

inside the target jvm, `ClarityAgent.agentmain` parses those arguments, checks for a non empty url and key, finds the minecraft class loader via `Class.forName("net.minecraft.client.Minecraft", false, cl)`, and hands control off to `ClarityConnect.connect`.

meanwhile the agent writes progress updates into the status file as `pct|message`, finishing with `100|DONE` on success or `-1|reason` on failure so the swing ui can update its progress bar.

---

## 2. the stage jar is a zip with lying offsets

next i tried to open `stage-000.jar`. it reports `2074` entries and `32,340,027` uncompressed bytes, yet `unzip`, `java.util.zip`, and python `zipfile` all blow up right around `need/clarity/agent/loader/Injector$Result.class` with `bad magic number for file header`.

at a first glance it looks truncated, but scanning the raw bytes tells a different story. there are exactly `2074` `PK\x03\x04` local headers in the file, one for every central directory entry. every local name matches the central name, and every entry inflates to a clean crc32 match. the devs just poisoned the central directory `header_offset` fields:

* `11` entries point at the real header
* `2057` entries point exactly `7` bytes before the real header
* `6` `.sha1` entries point between `71,278` and `1,021,167` bytes before the real header

because every entry also ends with a `16` byte data descriptor, that first `-7` offset lands straight inside the previous entry descriptor. normal zip parsers read four descriptor bytes instead of `PK\x03\x04` and immediately bail.

fixing it was simple. i ignored the declared offsets completely, scanned the raw file for every `PK\x03\x04` signature, paired those real offsets with the central directory entries in order, and inflated each payload using the central `compress_size` and `CRC`. all `2074` names matched and all `2074` crc32 values matched, giving `1895` files and `32,340,027` bytes of content.

once extracted, the layout of `stage-000.jar` is a massive giveaway:

```
stage-000.jar
├── META-INF/MANIFEST.MF
├── fabric.mod.json          <-- id clarity, version 1.1.5b, minecraft ~26.1.2
├── clarity.mixins.json      <-- 126 client mixins, JAVA_25
├── need/clarity/
│   ├── Clarity.class
│   ├── ClarityPreLaunch.class
│   ├── agent/               <-- loader, network, asm, transformer, watermark slot
│   ├── alts/
│   ├── audio/
│   ├── bridge/
│   ├── clickgui/
│   ├── compat/
│   ├── config/
│   ├── event/
│   ├── friends/
│   ├── hotbar/
│   ├── keybind/
│   ├── media/
│   ├── menu/
│   ├── mixin/               <-- 128 class files, 126 listed in the config
│   ├── modules/             <-- combat, movement, utility, visual
│   ├── nvg/
│   ├── preview/
│   ├── render/
│   ├── server/
│   └── util/
├── assets/clarity/          <-- fonts, shaders, sounds, textures, skyboxes
├── org/lwjgl/               <-- nanovg and friends
├── linux/{x64,arm64}/       <-- lwjgl_nanovg natives
├── windows/{x64,arm64}/
└── macos/{x64,arm64}/
```

that changes everything. the agent loader was never the only way to run this client. a full fabric mod path was sitting right there in the root of the stage the whole time.

---

## 3. the licence protocol (CLR1)

even though we dont need the loader to run the mod, i still mapped out `ClarityConnect` to see how the auth works. it is a websocket client with a custom encrypted framing layer:

* domain string `CLR1`
* X25519 ephemeral key exchange
* Ed25519 server identity key `96de94e8da32afbc8d879671f1444edd9c3c98308739f901512bfdae94ba87da`
* Ed25519 release signing key `174ed3cf53647a9c7559824aaf7959f8a0a7b87ee41db0ec5510b928df790537`
* HKDF sha256 with labels `clr1 c2s`, `clr1 s2c`, and `clr1 ack`
* AES GCM with a `12` byte iv and a `16` byte tag
* additional authenticated data is `c2s` or `s2c`
* frame header is an `8` byte counter followed by the ciphertext

the handshake flow looks like this:

```
server -> hello       { ns, spk, sig }
client -> auth        { cpk, nc }
client -> req         { key, hwid, uuid, build, pid }   encrypted
server -> grant       { tsig, manifest, msig }          encrypted
server -> stage_begin { size, sha256 }
server -> raw chunks
server -> stage_end
client -> ack         { n, mac }                        hmac sha256 of stage sha256
```

the client verifies the hello signature over `CLR1hello + ns + spk`, verifies the transcript signature over `sha256(CLR1 + ns + spk + nc + cpk)`, and checks the manifest signature against the release key. a `deny` message or websocket close code `4001` means your licence got rejected.

once authorized, it spawns a daemon thread named `clarity-heartbeat` that sends a `beat` every `30` seconds, waits up to `15` seconds for `beat_ok`, and triggers `shutdown` if the last good beat is older than `90` seconds or if the server sends `kill`. `shutdown` closes the socket, stops the heartbeat, and reflectively calls `need.clarity.ClarityBootstrap.disableAll` inside the game loader.

then `bootstrapFromMemory` does the heavy lifting for the agent path:

1. `extractNatives` writes the matching os and arch native libraries to a temp dir and appends `org.lwjgl.librarypath`
2. `extractResources` writes every non class, non `META-INF` entry into a temp resource jar and appends it to the system and bootstrap loaders
3. creates an `InMemoryClassLoader` for stage 0
4. `injectBridgesFromBytes` opens `java.lang` and defines the client and lwjgl classes into the game loader
5. instantiates `ClarityTransformer` from the in memory loader, registers it as a retransforming `ClassFileTransformer`, and retransforms existing target classes
6. `ClarityBootstrap.initialize(gameLoader)` reflectively constructs `need.clarity.Clarity` and calls `onInitialize`

on the normal fabric mod path, none of that is needed. fabric applies the mixins before minecraft loads, calls `need.clarity.Clarity` as the main entrypoint, and boots normally.

---

## 4. wait.. the stage is already a fabric mod

looking closer at the root `fabric.mod.json`, everything a fabric loader needs is already declared:

```
id: clarity
version: 1.1.5b
environment: client
entrypoints.main: need.clarity.Clarity
entrypoints.preLaunch: need.clarity.ClarityPreLaunch
mixins: clarity.mixins.json
depends.minecraft: ~26.1.2
depends.fabricloader: >=0.19.5
depends.java: >=25
depends.fabric-api: *
```

`clarity.mixins.json` targets package `need.clarity.mixin` with compatibility level `JAVA_25` and lists `126` client mixins, including `ConnectionMixin`, `MinecraftMixin`, `LocalPlayerMixin`, `GameRendererMixin`, `LevelRendererMixin`, chat and nametag mixins, shader mixins, and accessors. there are `128` class files in the mixin package, so two are unused, and the shipped config is already wired up.

theres also a built in watermark hidden here, designed to catch reverse engineers just like me. better luck next time ;)  
`need.clarity.agent.WatermarkSlot`:

```java
public static final String SLOT = "MZK8QB5FTVR1DWOE0U4HN55ZORMYYFT1";
```

this watermark also was not the only one.

it is a `32` character placeholder a server side packer swaps per licence so any leaked stage can be traced right back to the exact build. nothing outside the agent package even touches it, and it wasn't the only watermark they hid in here either.

---

## 5. making it a standalone mod

since the stage already has `fabric.mod.json` and `clarity.mixins.json`, turning it into a clean standalone jar is pretty easy.

### 5.1 nuke the agent and drm package

i deleted the entire `need/clarity/agent/` directory (`179` files). that wipes out:

* `ClarityAgent`, `Attach`, and the loader package
* `ClarityConnect` and `ServerKey`, removing all licence protocol code
* `ClarityTransformer` and the bundled asm copy, which only the agent path uses
* `WatermarkSlot`, removing the per licence drm tracking constant

before deleting it, i scanned every non agent class in the jar and confirmed zero references to `need.clarity.agent`. neither the mod entrypoints nor the `126` mixins touch it.

### 5.2 kill the presence client and old host

i patched `PresenceClient.wanted()` to return `false`. `clientTick` checks `wanted()`, closes any socket, sets the state to `DISABLED`, and never calls `connect`. that cleanly shuts off friends, global chat, direct messages, cloud configs, and presence in one spot.

i also replaced every occurrence of `104-156-154-148.sslip.io` in class constant pools with the same length string `Offline.invalid.hostname` so nothing ever resolves back to the original server. the local `127.0.0.1:7420` server stays untouched since it never leaves localhost, and third party calls (mojang, xbox, spotify, lrclib, mc heads) were left alone.

### 5.3 add a preLaunch native extractor

the only thing the agent path did that a normal fabric mod doesnt do out of the box is `extractNatives`, which unpacks `lwjgl_nanovg.dll`, `liblwjgl_nanovg.so`, and `liblwjgl_nanovg.dylib` and appends them to `org.lwjgl.librarypath`.

so i wrote `need.clarity.ClarityNativePreLaunch` and put it first in the `preLaunch` entrypoint list. it locates its own jar, reads `os.name` and `os.arch`, extracts everything under `<os>/<arch>/` into a temp directory, and appends that directory to `org.lwjgl.librarypath`. testing it on windows unpacked one file as expected:

```
[Clarity] extracted 1 native files to C:\Users\rara\AppData\Local\Temp\clarity-natives...
librarypath=...\clarity-natives...
  lwjgl_nanovg.dll 472576
```

### 5.4 main menu credit

the main menu builds its title string as `VERSION_LABEL = "Clarity " + version()`. i patched `version()` to return the constant `b1.1.5b - cracked by big scary rara @ https://galaxia.wtf/#research/clarity`, so the menu renders:

```
Clarity b1.1.5b - cracked by big scary rara @ https://galaxia.wtf/#research/clarity
```

the original string was `Clarity 1.1.5b`.

### 5.5 clean manifest

i stripped `Premain-Class`, `Agent-Class`, and `Main-Class` from `META-INF/MANIFEST.MF`, leaving a normal mod manifest:

```
Manifest-Version: 1.0
Implementation-Title: Clarity
Implementation-Version: 1.1.5b
```

---

## 6. the standalone build

the final standalone jar comes out to `22,220,377` bytes and works as a normal fabric mod.
---


### final thoughts

wrapping a complete fabric mod inside a broken zip and a websocket java agent is honestly a funny design choice. once you look past the poisoned central directory offsets and spot `fabric.mod.json` sitting at the root, the entire loader, x25519/ed25519 handshake, heartbeat thread, and `WatermarkSlot` become completely optional.

a tiny `preLaunch` native extractor, one `iconst_0` in `PresenceClient.wanted()`, and deleting the agent package turns it right back into a regular fabric mod. 

hope you enjoyed the breakdown :)

ryanair, please ship better drm next time for the big scary rara, you could have at least obfuscated the payload ;)