# Kuzi: all that native crypto just to lose to Class.forName

*by big and scary rara — nov 2026*

---

### tl;dr

i got my paws on `Kuzi-Loader.jar` (`9,484,800` bytes) from an anonymous source, a `1.21.11` fabric mod by `ar3`. to a normie, it looks like a full client (`159` entries, `114` assets, `16` nested libraries, `97` modules in `default_config.json`), until you check the java and find only `18` loader classes, `4` native bootstrap classes, and `2` encrypted native stages pulling the real client from `https://dashboard.kuziclient.com/api/client-payload`.

with the streamed payload jar (`13,542,982` bytes, `721` classes, `55` client mixins) and the captured runtime registrar (`a/a/a/e/c.class` from `kuzi-module-registrar.zip` provided by an anonymous source) in hand, cracking it comes down to one fallback: if `/kuzi/boot.bin` isn't in the jar, the payload skips native decryption and loads `a.a.a.e.c` straight through `Class.forName`.

so i dropped `kuzi/boot.bin` and `license.txt`, added `a/a/a/e/c.class`, patched 2 module toggle checks, stripped 3 silent exit native calls, and hooked `nvgText` to stamp the profile box. the final standalone `1.21.11` jar (`13,623,464` bytes) boots straight into minecraft with all `100` modules unlocked and zero licence required.

as always: grab some monster before reading this :)

---

## 1. the stub loader

opening `Kuzi-Loader.jar` is boring in the good way. unlike clarity, there are no broken zip offsets or appended payloads: `159` entries, `10,612,475` uncompressed bytes, `22` trailing EOCD slack bytes, and `159` matching `PK\x03\x04` headers.

```
Kuzi-Loader.jar
├── fabric.mod.json            <-- id kuzi, version 1.0.0, minecraft 1.21.11, java >=21
├── license.txt
├── com/kuzi/loader/           <-- 18 class files (69,042 bytes), the actual loader
├── kn/be0be6ec16016051f/      <-- 4 class files (8,604 bytes), native bootstrap
├── native/e0be6ec16016051f/
│   ├── s1                     <-- 127,172 bytes, five stage one stubs
│   ├── r                      <-- 3,265,848 bytes, encrypted stage two
│   └── bk                     <-- 32 bytes of key material
├── assets/kuzi/               <-- 113 files (shaders, fonts, textures, sounds, config)
├── assets/minecraft/          <-- 1 post effect json
└── META-INF/jars/             <-- 16 nested libraries
```

`fabric.mod.json` points `preLaunch` at `com.kuzi.loader.c` and `client` at `com.kuzi.loader.b`, and ships the usual client dependencies (`gson-2.14.0`, `DiscordIPC-0.4`, `java-spotify-api-1.4.7`, `json-20260522`, `junixsocket`, `lwjgl-nanovg-3.3.3`, and `lwjgl-stb-3.3.3` with 4 platform native jars each).

every loader class hides its strings in one constant pool XOR blob decoded inside `<clinit>` into a `static final String[]`:

* the first chunk length is a `bipush` literal
* each chunk ends with a one char separator whose value is the next chunk length
* characters decode with `c[i] ^ schedule[i % 7]` via a seven-entry `tableswitch` per class

instead of reimplementing every `tableswitch` in python, loading the classes against stub `PreLaunchEntrypoint` and `ClientModInitializer` interfaces lets `<clinit>` run and dumps `com/kuzi/loader/c`'s `34` strings for free (`STOP: no valid license baked into the stub`, `in-memory classloader wired into Knot`, `injection complete (mixins + AW applied); waiting for client entrypoint to fire`).

from the bytecode, `onPreLaunch` does the delivery dance cleanly:

1. checks the baked licence (`net.b.a()` / `net.b.a(licence)`) and grabs the 64-hex `hwid` (`net.b.b()`)
2. calls native `net.e.a(licence, hwid)` to download a zip into memory (`net.f.a`)
3. unpacks entries into `com.kuzi.loader.classloader.f`, a `SecureClassLoader` serving resources as `kuzi/<name>` URLs
4. generates an ASM `MethodHandle` `defineClass` shim (`classloader/a` + `b`) and reflectively rewires Knot's `delegate`, `originalLoader`, and `parentClassLoader` (`classloader/c`)
5. registers the delivered `mixins` (`Mixins.addConfiguration` + `Keys.CONFIGS`), applies the access widener via `ClassTweakerReader`, and hands `entrypoints.client[0]` to `com.kuzi.loader.b`

---

## 2. the stub's two native stages

`net/a` through `net/e` are pure `public static native` declarations registered in `<clinit>` via `kn.be0be6ec16016051f.L.init(X.class, n)`.

`native/e0be6ec16016051f/s1` (`127,172` bytes) packs five platform stubs behind a `u16` count and `(u8 name_len, name, u32 offset, u32 length)` index (`x86_64-linux` `13,032`, `x86_64-windows` `25,072`, `aarch64-macos` `51,048`, `x86_64-macos` `25,709`, `aarch64-linux` `12,200`). `L.<clinit>` writes the matching one to `%TEMP%/jvmtp-s1-<ns>-<rand>.dll`, calls `System.load`, and invokes `bootstrap`.

the bootstrap key uses a nice call-site binding trick: `L` hashes `(m0e64901ed1fc212e ^ meef1b5961604f26a) || stackFingerprint`, where `Cc8f3fd5d29.m375b072522()` reads `new Throwable().getStackTrace()` to format `fileName|line5|line3|line1` (`9bee8857ed3d95a754cc272cc2f204100423390dcfa1c8adab3ed3389348002b`). relocate the call chain and the key changes.

stage one imports zero windows crypto APIs (`no BCrypt`, `no Crypt*`) and opens `r` (`3,265,848` bytes, entropy `7.9999`, sha256 `50a3a2d201976cc35b73b0f22f93c0fc86f903565878a236c8e23aed723a0f08`) with a hand-rolled sha256 stream cipher:

```
keybuf[i] = key[i % key_len] ^ bk[i]
S0        = sha256(keybuf || cipher[0:8])
block     = sha256(S0 || le32(blockIndex))
plain     = cipher[8:] ^ block stream
tag       = sha256(S0)[0:4] == plain[8:12]
```

the tag checks out on the first try. inside `r` are five compressed platform libraries (`x86_64-windows` is `1,434,624` bytes uncompressed / `613,462` compressed). stage one unpacks the host library to `%TEMP%/jvm<hex>.tmp` (sha256 `33d684f9b3d464751b94372b3326a0db9c112cd871467c2b16770e80c216aba2`) and forgets to call `DeleteFileA`, leaving stage two sitting right there on disk.

stage two strips almost everything down to 3 plaintext strings (`-Xdebug`, `CheckRemoteDebuggerPresent`, `IsDebuggerPresent`), reads or creates the 64-hex hwid at `%USERPROFILE%\.kuzi\hwid` (`f3148129f0986107233a5a32ab86ac267a4edbe097d1bd0439c85a526f8f31ec` derived from `Windows 11|amd64|<user>|<mac>|` and adapters), and calls:

```
GET https://dashboard.kuziclient.com/api/client-payload
    ?license_key=<licence>&hwid=<64 hex>&plat=<x86_64-windows>
    &ver=3&ts=<unix seconds>&nonce=<random>&lauth=<mac over kuzi-loader-v1|...>
```

there is no hidden client jar inside `r` either: no `PK\x03\x04`, no `fabric.mod.json`, just the five native libraries. the client is streamed straight from that endpoint.

---

## 3. the delivered payload (and its traps)

then the streamed payload jar landed: `13,542,982` bytes, sha256 `19e21c30d437e835527bc9eba7616b6395b4f1f5bbb54a30d1efe1b076fdf00b`.

```
entries          866 (721 classes, 114 assets, 16 nested libs)
client classes   716 under a/a/a/**
bootstrap        5 under kn/bb542ffe4b746c218/**
mixins           55 client mixins in a.a.a.i (JAVA_21)
access widener   kuzi.accesswidener (4 lines)
entrypoint       a.a.a.e.h (ClientModInitializer)
license.txt      57 bytes (KUZI-XXXXXXXX-XXXXXXXX, "do not share")
```

the split is completely clean: zero `com/kuzi/loader` or `dashboard.kuziclient.com` references survive in the payload.

3 things make inspecting it annoying right away:

* **ntfs case collisions**: `unzip` bails twelve files in on `a/a/a/j/c/O.class` vs `o.class`. there are `178` case-colliding pairs (a quarter of the jar), so unpacking to windows overwrites them unless you work directly inside zip streams or `JarFile`.
* **double-encrypted native stage**: `kn/bb542ffe4b746c218/L` uses the exact same `s1` (`25,129` bytes, sha256 `9da019edcdb551d27f70f80541e742ad54f188e9a4df39f938cb79334fb1acfe`), `bk`, `Cefd0bc00b6.m4b312eb222()` stack key, and `r` (`1,136,410` bytes, sha256 `c658df69eecc0021ff7341af8928a725db33f3c5d2e247d8fbf1b55ce58c2aff`) format, except `r` unpacks to a single entry (`native/b542ffe4b746c218/x86_64-windows`, `1,136,362` bytes, entropy `7.997`) that's encrypted a second time inside `s1`. no decrypted client dll ever lands in `%TEMP%` or shows up cleanly in `VirtualQueryEx`.
* **per-class invokedynamic pools**: every class runs its own `invokedynamic` bootstrap (switch table, 7-bit XOR keys, encrypted `MethodHandle` lookups) and a `private static String a(int, long)` decoder, breaking vineflower on big constructors and keeping every useful string out of the constant pool.

to bypass both decompilation headaches, i wrote an ASM `9.8` `ClassLoader` harness that generates empty stub classes and interfaces on demand for `net.minecraft.*`, `net.fabricmc.*`, `com.mojang.*`, and `org.lwjgl.*` under `-Xverify:none`. that lets `<clinit>` run, exposes `a(int, long)` directly, and lets us interrogate `a.a.a.b.c` and `d` live:

```
d.a()                            = KUZI-XXXXXXXX-XXXXXXXX
d.c()                            = f3148129f0986107233a5a32ab86ac267a4edbe097d1bd0439c85a526f8f31ec
c.b() / c.a(long) / c.a(String)  = false / 0 / null
c.a("toggle:" + id)              = false
c.a("setEnabled:" + id)          = false
```

the baked key in the native layer matches `license.txt`, and without an active session every module check answers `false`.

---

## 4. the missing registrar and the fallback branch

even with the full payload jar, launching it produces `0` modules. decoding the two strings inside `a.a.a.e.d.a()` explains why:

```java
public static a.a.a.e.b a() {
    boolean sealed = d.class.getResource("/kuzi/boot.bin") != null;
    if (sealed) {
        try {
            byte[] b = a.a.a.b.c.a();
            if (b == null) return null;
            ClassLoader cl = new a.a.a.e.a(a.a.a.e.b.class.getClassLoader());
            return (a.a.a.e.b) cl.a(b).getDeclaredConstructor().newInstance();
        } catch (Throwable t) {
            return null;
        }
    }
    try {
        return (a.a.a.e.b) Class.forName("a.a.a.e.c").getDeclaredConstructor().newInstance();
    } catch (Throwable t) {
        return null;
    }
}
```

the payload ships `kuzi/boot.bin` (`12,259` bytes, next to `kuzi/boot.bip`), so `sealed` is always `true`. unlicensed, native `a.a.a.b.c.a()` returns `null`, `g.b()` swallows the failure in a `try` block, and the client boots empty.

but if `/kuzi/boot.bin` is absent, it falls straight back to `Class.forName("a.a.a.e.c")`.

soon after, our anonymous source covered us with a supply drop: `kuzi-module-registrar.zip` (`6,375` bytes), carrying the captured `a/a/a/e/c.class` (`12,231` bytes, sha256 `3f4330d9c035f403964167e80f2a719d908979a960c11ca83836efb9e222f365`). deleting `kuzi/boot.bin` and adding `a/a/a/e/c.class` flips `d.a()` onto the fallback path and registers all `100` modules (`97` in `default_config.json` plus `3` newer ones).

---

## 5. the gate map and silent native exits

scanning the payload bytecode for references to `a.a.a.b` turns up `14` call sites in `c` and `3` in `d`:

| site | call | effect |
| --- | --- | --- |
| `a.a.a.j.j.j()` | `c.a("toggle:" + id)` | returns early when false, blocking module toggles |
| `a.a.a.j.j.i(Z)` | `c.a("setEnabled:" + id)` | same guard on gui and config setters |
| `a.a.a.e.h.onInitializeClient()` | `c.a()V` | native startup check |
| `a.a.a.e.i.a()` | `c.a(Z)V` | `Kuzi-ModuleTicker` callback |
| `a.a.a.l.c.a.a()` | `c.b(Z)V` | render thread callback after resource reload |
| `a.a.a.f.b` | `c.c()[B`, `c.a([B,[B)Z` | sealed config store, returns early when null |
| `a.a.a.d.a.f`, `a.a.a.m.k` | `c.c()Z` | returns `true` unlicensed |

once i dropped the jar into `Fabric 1.21.11`, it silently exited with `exit code: 0` right after `[Indigo] Different rendering plugin detected; not applying Indigo.` with no crash log and no `Runtime.halt`.

attaching a java agent to trace `a.a.a.e.*` and `a.a.a.b.*` caught all three native kill switches: `c.a()V` in `h.onInitializeClient()`, `c.a(Z)V` on `Kuzi-ModuleTicker` inside `i.a()`, and `c.b(Z)V` on the render thread inside `a.a.a.l.c.a.a()`.

---

## 6. making it a standalone mod

### 6.1 swap the registrar and clean metadata

i deleted `license.txt` (carrying the licence key and `do not share`, but sadly for them, our anonymous source did share the client, sharing is caring 🫶) and `kuzi/boot.bin`, dropped in `a/a/a/e/c.class`, and removed the dead `another-mod` entry from `suggests` in `fabric.mod.json`.

`kn/` and `native/` stay in the jar on purpose because client modules `a/a/a/j/c/D`, `u`, and `X` declare their own natives through the same bootstrap. `a.a.a.f.b` stays inert when `c.c()[B` returns `null`, while normal gson settings in `a.a.a.j.a.l` continue saving as usual.

### 6.2 patch the toggle gates and native lifecycle kills

i rewrote the five call sites across `a/a/a/j/j`, `a/a/a/e/h`, `a/a/a/e/i`, and `a/a/a/l/c/a`:

```
a/a/a/j/j.j()V, i(Z)V         c.a(Ljava/lang/String;)Z -> POP + ICONST_1
a/a/a/e/h.onInitializeClient  c.a()V                   -> removed
a/a/a/e/i.a()V                c.a(Z)V                  -> POP
a/a/a/l/c/a.a()V              c.b(Z)V                  -> POP
```

replacing `invokestatic c.a(String)Z` with `pop` + `iconst_1` consumes the `String` and leaves a `boolean`, keeping the stack shape identical so ASM `BasicVerifier` passes and zero `a.a.a.b.c` calls remain in `a/a/a/j/j`.

### 6.3 stamp the profile box

instead of chasing encrypted `invokedynamic` strings in the click gui panel, i went straight to the choke point: `a/a/a/l/c/c` is the only class in the jar calling `nvgText` and `nvgTextBounds`, with `5` public static methods taking a `String` as their first parameter (four draw variants and one width measure).

inserting `aload_0`, `invokestatic com/kuzi/standalone/TextSwap.r`, `astore_0` at the top of all five methods swaps `Licence: Active` (or split `licen...` + `active` calls) for `cracked by big and scary rara @ galaxia.wtf/#research/kuzi`, and patching the width measure too lets the box resize cleanly around the new string.

---

## 7. the standalone build

```
dist/Kuzi-1.0.0-standalone.jar
size    13,623,464 bytes
sha256  50c7933b53200fac8999286d7c6d4ac206db091e6a120f8cf9a63948319e9d65
entries 866
```

launching the patched jar in `Fabric 1.21.11` (`fabricloader >=0.19.2`, `java >=21`) alongside `fabric-api` clears `OpenAL initialized`, builds all texture atlases, registers all `100` modules, logs `[kuzi-cloud-ctl/WARN]: [Kuzi] cloud call refused (nolicence)`, renders the custom profile box stamp, and stays alive without touching the licence server.

---

### final thoughts

credit where its due: kuzi actually avoided the classic mistakes. it didn't bundle the client inside the loader, didn't drop a decrypted stage two client dll into `%TEMP%`, and tied its bootstrap key to the live stack trace.

then it blew all of that effort by leaving an unencrypted `Class.forName` fallback sitting right behind `kuzi/boot.bin`, routing every module toggle and silent exit through five predictable call sites in `a.a.a.b.c`, and funneling all click gui text through one `nvgText` helper.

hope you enjoyed the breakdown :)
