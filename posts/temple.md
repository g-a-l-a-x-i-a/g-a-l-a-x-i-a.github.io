# Temple.nz: Did King Terry the terrible make a Minecraft client?

*by big and scary rara — nov 2026*

---

### tl;dr

i got my paws on `temple-loader.exe` from an anonymous source and followed it all the way into the game. temple ships a VMP (VMProtect) wrapped loader (`22,701,568` bytes), native jnic crypto, session checks, and lazy loaded modules that zero out their own byte buffers right after `defineClass`.

after catching the base jar from `%LOCALAPPDATA%` (`9,057,867` bytes, `1,451` zip entries, `1,041` classes), attaching a jvmti `ClassFileLoadHook` collector to dump the lazy classes (`80`+ classes covering all `61` module implementations), patching the startup gates, and swapping the main menu text, we end up with a standalone `1.21.11` fabric mod (`9,448,491` bytes, `1,431` files, `1,127` class files).

as always: grab some monster before reading this :)

---

## 1. the vmp loader

we started with `temple-loader.exe`, a `22,701,568` byte windows x64 executable.

the section table has `.vmp0`, `.vmp1`, and `.vmp2` with the entrypoint sitting inside the protected region, so its a standard VMP setup.

there is still plenty of useful stuff sitting outside the protected path:

```
https://verify.temple.nz
/api/challenge
/api/session
/api/payload-key

client_url
client_key
ckw
ck_epk
ck_salt
```

along with header names for a challenge, timestamp, DPoP, and proof of work. instead of wasting time devirtualizing the whole vmp binary, the obvious move was to follow where the loader actually drops the client once you launch the game.

---

## 2. grabbing the cached jar off disk

the native launch path had references to `fabric_runtime_cache.jar` and `temple-client.jar`, and tracing the path builders pointed straight to:

```
%LOCALAPPDATA%
└── .<eight generated characters>
    └── a
        └── fabric_runtime_cache.jar
```

the 8 character folder name is machine-derived, so i just set up a watcher on the runtime folders to grab complete fabric archives and verify their zip structure, entry crcs, and mod metadata as soon as they hit disk.

the `1.21.11` capture worked cleanly:

```
file:    temple-1.21.11.jar
size:    9,057,867 bytes
entries: 1,451 zip entries (1,041 class files)
mod id:  templenz (0.3.4)
sha256:  e731f50072965997be7fd1e4a86d94c708fd30f3c1a3e2471ac5675d1673da1a
```

---

## 3. what is inside the base jar (and the 61 missing modules)

popping open `fabric.mod.json` shows a completely normal fabric mod layout:

```
id: templenz
version: 0.3.4
name: Temple.nz
environment: client
entrypoints.client: nz.temple.client.TempleNzClient
mixins: templenz.client.mixins.json
depends.minecraft: ~1.21.11
depends.fabricloader: >=0.19.5
depends.java: >=21
```

the loader only existed to gate and deliver it. the interesting bits are sitting under `templenz/`:

```
templenz/
├── payload-map.json        <-- 61 module names -> implementation classes
├── payload-settings.json   <-- 146,006 bytes of gui settings metadata
├── licensed.bin            <-- 64 bytes, used by the license path
└── signer.sha256           <-- c1e1242dac5ac5ac5c3e211221f3552002e1aa0f15edc2bcbb86dcba57105567
```

all `61` primary implementation classes listed in `payload-map.json` are missing from the base jar. the gui still knows their names and settings because `payload-settings.json` ships inside the jar, and the actual code gets pulled down later at runtime through `nz.temple.client.k.e`.

---

## 4. dumping the lazy classes with jvmti

on the java side, `nz.temple.i.c.a(byte[], byte[], String, ClassLoader)` decrypts a module payload into a map of class bytes, spins up a custom classloader (`nz.temple.i.c$a`), and clears the plaintext buffer. then `findClass` pops each requested `byte[]`, passes it to `defineClass`, and immediately zeroes the array with `Arrays.fill(bytes, (byte) 0)`.

waiting around for a decrypted module jar in memory is unreliable, so i attached a native jvmti collector using `ClassFileLoadHook` to the running game jvm. whenever the jvm defined anything under `nz/temple/`, the hook saved the raw class bytes before they could get wiped and passed them along untouched.

the first run had a weird false-negative on the count because java class names are case-sensitive while windows filesystems are not. an obfuscated class ending in `b` and another ending in `B` collided in the same directory when written out naively.

switching the collector's inventory to check every class file's own `this_class` identity and isolating case variants fixed it, recovering the lazy classes under `nz/temple/client/i/` for all `61` module entry classes.

---

## 5. neutralising the license machinery

even with the base jar and the `80` recovered classes, the client still runs its own startup gates inside `TempleNzClient.onInitializeClient`:

```
k.a.a()String      -> if non-null, report and return
k.b.a()Z           -> jar signature check
k.d.a()Z           -> session check
k.d.a()V           -> start session watch thread
```

there is also `nz.temple.security.NativeCrypto`, backed by the packaged jnic bridge (`templenz/jnic.json` says `JNIC 3.7.0`, five native methods) for payload decryption and ed25519 verification. i left the native side completely untouched—it is only ever called from the delivery and signature paths, and those are the exact paths i nuked.

here is the map of the gate classes and what got patched:

| class | role |
| --- | --- |
| `nz.temple.client.k.a` | environment and license path detection |
| `nz.temple.client.k.b` | jar signature verification |
| `nz.temple.client.k.d` | session check, watch thread, reporting |
| `nz.temple.client.k.e` | lazy module resolution and loading |
| `nz.temple.g.d` | module registry |

5 boolean/string gates became constants:

```
nz.temple.client.k.a.b()Z                          -> return true
nz.temple.client.k.a.a()Ljava/lang/String;         -> return null
nz.temple.client.k.b.a()Z                          -> return true
nz.temple.client.k.d.a()Z                          -> return true
nz.temple.client.k.e.a()Z                          -> return true
```

5 void entry points became a bare `return`:

```
nz.temple.client.k.d.a()V
nz.temple.client.k.d.a(Ljava/lang/String;)V
nz.temple.client.k.d.b(Ljava/lang/String;)V
nz.temple.client.k.d.c(Ljava/lang/String;)V
nz.temple.client.k.e.b(Ljava/lang/String;)V
```

3 telemetry getters became `null`:

```
nz.temple.client.k.d.e()Ljava/lang/String;
nz.temple.client.k.d.g()Ljava/lang/String;
nz.temple.client.k.d.h()Ljava/lang/String;
```

the lazy loader in `nz.temple.client.k.e` now resolves straight against the mod classloader:

```java
a(String)ClassLoader          -> OfflineRuntime.localClassLoader()
a(String, String)g.b          -> a(name, OfflineRuntime.localClassLoader())
```

and the module registry gets a filter at the top of `nz.temple.g.d.a(g.b)`:

```java
if (!OfflineRuntime.availableName(module.a())) {
    return module;
}
```

the helper is a tiny local class `nz.temple.offline.OfflineRuntime`:

```java
package nz.temple.offline;

public final class OfflineRuntime {
    private static final Set<String> MISSING = Set.of();

    public static boolean availableName(String name) {
        return name == null || !MISSING.contains(name);
    }

    public static ClassLoader localClassLoader() {
        return OfflineRuntime.class.getClassLoader();
    }
}
```

`MISSING` stays empty so every module name passes.

in total that is `13` method bodies and one static initializer insertion across six classes.

---

## 6. main menu footer

the footer text isnt a plain constant in the base jar. it sits at index `6` of a `60` entry `String[]` that `nz.temple.client.e.t` builds inside its static initializer from an encrypted table. rather than messing with the encrypted table, i inserted four instructions right after the array gets stored:

```
getstatic nz/temple/client/e/t.y : [Ljava/lang/String;
bipush 6
ldc "Assistance from 648k.exe was not enough to stop the big scary rara. better luck next time ;) @ https://galaxia.wtf/#research/temple"
aastore
```

---

## 7. packaging

the original jar ships signed:

```
META-INF/TEMPLE-C.SF
META-INF/TEMPLE-C.RSA
META-INF/MANIFEST.MF   <-- 237,288 bytes, full of per-entry digest sections
```

shipping modified class bytes with an old jar signature is pointless, so those two signature files are gone and `MANIFEST.MF` is trimmed down to its main section only (`63,806` bytes, keeping the stonecutter and fabric loom attributes). the per build watermark comment (`temple-wm:K9xQ_7mVpW2nZ4bT`) is also gone, and `licensed.bin` / `signer.sha256` sit dead in the jar with nothing reachable reading them.

---

## 8. yay now its cracked

yay!

---

### final thoughts

all that vmp, jnic, and buffer wiping drm just to guard a normal fabric mod with 13 small gate methods bolted on. 

clearly taking notes from ryanair industries xD

once you dump the cached jar and catch the lazy classes as the jvm loads them, the rest falls apart in minutes. hope you enjoyed the breakdown and don't forget to get more monster :)