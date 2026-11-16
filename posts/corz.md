# Corz: all that Rust, qProtect, and gRPC just to reuse one XOR keystream

*by big and scary rara — nov 2026*

---

### tl;dr

i got my paws on `Corz` (`2.0.3` for `1.21.11` fabric) from an anonymous source. on paper the delivery + drm stack looks absolutely terrifying: a `30.2 mb` installer jar that drops a VMP wrapped `CorzLauncher-windows-x86_64.exe` into `%LOCALAPPDATA%`, which pulls a `CRZB` memory bundle containing a `68.7 mb` `bootstrap.jar`, a `21.9 mb` `payload.jar` holding almost nothing except a `22.1 mb` `CZVM` blob (`corz.vm`), and a `15.4 mb` packed rust/mingw native loader (`corz-loader.dll`) that checks `ed25519` runtime manifests, unpacks `JCPAY` inside a `.gKe` vm, and feeds `MemoryModStore`, while the client itself packs a `qProtect` native (`vm.dll`), a `20.8 mb` gRPC cloud backend jar, and `corz.gg` telemetry.

turns out you don't have to devirtualize VMP, `.gKe`, or `vm.dll` at all. dumping the `CRZB` bundle straight out of the running launcher's RAM hands over all three artifacts (`106,019,041` bytes total), and once you look inside, every single one of the `3,067` encoded classes across `bootstrap.jar` and `corz.vm` is XOR'd against the **exact same static keystream starting at offset 0**, and a 10 byte custom opcode swap (`0xef..0xf8`) inside `Code` attributes.

using known class file headers and a bytewise constant-pool UTF-8 zipper, i pushed the recovered keystream to `73,099` bytes (`3,156` decoded classes, `145` of `150` modules), stubbed the `18` remaining oversized classes across NTFS safe javac batches, patched `IIIIli` and `IIIilliI` surgically, killed `qvm`, `injector`, `corz.gg` sockets, and `client-rpc` network calls, stamped `IIIiIiIli` with `"Cracked by big scary rara"` / `"galaxia.wtf/#research/corz"`, and packed it into a standalone `1.21.11` fabric mod (`41,715,305` bytes). no custom runtime zip, no license server, no watermark.

grab some monster before reading this :) 

---

## 1. the VMP launcher and dumping `CRZB` from memory

starting from the initial installer jar (`30,263,419` bytes), all that jar really does is act as a dropper for the actual launcher executable inside `%LOCALAPPDATA%`:

| property | `CorzLauncher-windows-x86_64.exe` |
| --- | --- |
| size on disk | `16,312,064` bytes (cached runtime capture copy: `21,188,864` bytes) |
| format | Windows PE x86_64 |
| protection | VMProtect |

note that the `16.3 mb` binary and the `21.18 mb` cached copy seen during the live memory capture are two distinct builds, not the same file. either way, staring at a VMP packed `.exe` statically goes nowhere fast, especially when the launcher's strings already leak its gRPC endpoints:

```text
/corz.client.v1.Launcher/Manifest
/corz.client.v1.Launcher/BeginLaunch
/corz.client.v1.Launcher/AdvanceLaunch
/corz.client.v1.Launcher/Download
```

so instead of unpacking VMP on disk, i went straight after what the running launcher assembles in RAM. my first hook experiment caused the launcher to die immediately, so i switched to passive read/query memory inspection instead.

watching the launcher's heap revealed it assembling a delivery bundle prefixed with `CRZB`, a big endian `version = 2` field, and length prefixed blobs back to back:

```text
CRZB
version = 2 (be32)
bootstrap_len | bootstrap bytes
payload_len   | payload bytes
native_len    | native bytes
(...trailing protocol data)
```

scanning for `CRZB` alongside its string descriptors isnt enough on its own because ripping half of a moving buffer gives you garbage. to make sure every dump was clean, the memory reader sampled each candidate region twice, verified identical `sha256` digests across both reads, and confirmed the descriptor still pointed at the exact same base address and length before writing to disk.

that cleanly pulled all three delivered pieces (`106,019,041` bytes total, with matching hashes across runs and clean ZIP CRCs on both jars):

```text
dumped CRZB artifacts
├── bootstrap.jar   68,704,712 bytes
├── payload.jar     21,912,601 bytes
└── native.dll      15,401,728 bytes
```

```graph
type: flow
direction: lr
Installer JAR (30.2 MB) -> CorzLauncher.exe (VMP)
CorzLauncher.exe (VMP) -> CRZB RAM Bundle
CRZB RAM Bundle -> bootstrap.jar
CRZB RAM Bundle -> payload.jar (corz.vm)
CRZB RAM Bundle -> corz-loader.dll
payload.jar (corz.vm) -> Shared XOR (73,099 B)
Shared XOR (73,099 B) -> Opcode Swap (0xef..0xf8)
Opcode Swap (0xef..0xf8) -> Standalone 1.21.11 JAR
```

---

## 2. unpacking the jars (and the ntfs trap)

popping open `payload.jar` first is funny because there is almost nothing inside it:

```text
payload.jar
├── fabric.mod.json           <-- id corzclient, version 2.0.3, entrypoint com.corz.client.CorzClient
├── gg/corz/IIIIIlli.class    <-- 459 bytes, plaintext class
├── gg/corz/IIll.class        <-- 170 bytes, plaintext interface named corz$capeFrame
└── corz.vm                   <-- 22,113,618 bytes, the entire client blob
```

`com.corz.client.CorzClient` doesn't even exist inside `payload.jar`, so `bootstrap.jar` (`632` zip entries) has to load and define everything before fabric resolves the entrypoint.

unpacking `bootstrap.jar` on windows immediately ran into the same ntfs case-collision headache we saw in kuzi and temple: extracting to disk dropped `5` classes (`116` instead of `121`) because obfuscated names like `gg/corz/III.class`, `IIl.class`, and `IIi.class` silently overwrite each other on a case-insensitive filesystem. reading straight from the zip stream gave the real layout:

```text
bootstrap.jar (632 entries, 121 classes)
├── com/corz/client/mixins/**                 <-- 107 plaintext mixins (intermediary names)
├── gg/corz/{III..IIil}.class                 <-- 10 XOR-encoded classes
├── gg/corz/injector/CorzPreLaunch.class      <-- 5,025 bytes, XOR-encoded preLaunch entrypoint
├── gg/corz/injector/bootstrap/N.class        <-- 181 bytes, XOR-encoded JNI bindings
├── gg/corz/injector/bootstrap/PayloadBootstrap.class  <-- 11,502 bytes, XOR-encoded Java callback
├── com/corz/client/qvm/Runtime.class         <-- 2,128 bytes, XOR-encoded qProtect VM bridge
└── META-INF/
    └── jars/client-rpc-1.0.0-bundled.jar     <-- 20,820,364 bytes (8,203 entries), gRPC + protobuf stubs
```

---

## 3. the native loader (`corz-loader.dll`) and `vm.dll`

`corz-loader.dll` only exports `JNI_OnLoad` and `_DllMainCRTStartup`, and its import table is practically empty: just `_msize`, `_execute_onexit_table`, `CloseHandle`, `__acrt_iob_func`, `_time64`, and `strncmp`. every real win32 api is resolved dynamically by walking export tables or hashing. mingw-w64 strings (`Mingw-w64 runtime failure`, `Unknown pseudo relocation protocol version %d`) and rust io error kinds confirm its a packed rust binary.

on disk the code sections are encrypted, so i loaded both natives and dumped their unpacked images straight from memory:

```text
corzloader_unpacked.bin   25,214,976 bytes   sections: .text .rdata .buildid .data .pdata .tls .gKe .uq .bmL .reloc
vm_unpacked.bin           25,354,240 bytes   sections: .text .rdata .buildid .data .pdata .tls .QVM0 .QVM1 .QVM2 .reloc
```

`.rdata` in `corz-loader.dll` spells out the entire architecture in plaintext:

* **container parser errors**: `TruncatedContainer`, `InvalidPayloadHeader`, `InvalidPayloadCount`, `TruncatedPayloadEntry`, `InvalidPayloadEntry`, `TruncatedPackedPayload`, `InvalidPackedHeader`, `InvalidPackedIndex`, `TruncatedPackedIndex`, `InvalidPackedName`, `InvalidPackedRange`, `InvalidPackedClass`, `PackedPayloadTooLarge`, `TrailingPackedData`, `InvalidPayloadKind`, `MissingPackedPayload`, `InvalidContainer`, `UntrustedRuntimeLocation`.
* **runtime integrity machinery**: `corz-runtime-integrity-v1`, `corz-runtime-intime-integrity-v1+`, `windows-x86_64-server-release.zip`, `bin/java.exe`, `bin/server/corz.dll`, `lib/modules`, `net/fabricmc/loader/impl/memory/MemoryModStore`, `installPayload`, `authorizePayload`.
* **ed25519-dalek signature errors**: `InvalidRuntimeSignature`, `SignatureVerificationFailed`, `WeakPublicKey`, `NonCanonical`, `IdentityElement`, `InvalidPadding`, `ExpiredRuntimeManifest`, `InvalidRuntimeHash`, `RuntimeFileMissingOrLinked`, `RuntimeFileChanged`.

before installing anything into fabric's `MemoryModStore`, the loader expects to run inside its own custom jdk (`windows-x86_64-server-release.zip`, which of course wasnt sitting in our captured `CRZB` bundle 😭), hash `bin/java.exe`, `bin/server/corz.dll`, and `lib/modules`, and verify an `ed25519` manifest signature.

meanwhile `vm.dll` (bundled inside `com/corz/client/qvm/native/windows-x86_64/vm.dll`, alongside `libvm.so` at `10,976,008` bytes) holds `.QVM0..2`, `"expand 32-byte k"` at `0x32670` (chacha20), `qProtect.vm.code.key.v1`, and a tiny class list (`gg.corz.IIIiIiIl`, `IIilliiI`, `IIIilliI`, `IIIiilli`, `IIliiIii`, `IIIlilIl`, `IIIlIIii`, `IIIiiIIl`).

probing the jni surface with candidate stub signatures mapped every native method:

```text
com.corz.client.qvm.Runtime
  native Object run(long, int, Object[])
  native int    runI(long, int, Object[])
  native long   runJ(long, int, Object[])
  native float  runF(long, int, Object[])
  native double runD(long, int, Object[])
  native void   loadVm(Class, MethodHandles.Lookup)

gg.corz.injector.bootstrap.N
  native int    v()        -> returns 6
  native void   i(byte[])  -> container installer
```

(one trap: `System.load` on `vm.dll` immediately throws `NoClassDefFoundError: com/corz/client/qvm/Runtime` unless that stub class is already on the classpath, because `JNI_OnLoad` resolves it right at load time)

---

## 4. bypassing `UntrustedRuntimeLocation` and the `0x8943` gate

calling `N.i(corzVmBytes)` directly first threw `NoSuchMethodError: gg/corz/injector/bootstrap/PayloadBootstrap.runtimeIntegrity()[B`. after stubbing `runtimeIntegrity()` to return `32` zero bytes, `N.i` immediately died with:

```text
java.lang.IllegalStateException: Corz runtime integrity check failed: UntrustedRuntimeLocation
    at gg.corz.injector.bootstrap.N.i(Native Method)
```

even copying a full zulu jdk, dropping `corz-loader.dll` at `bin/server/corz.dll`, and launching its `java.exe` hit the exact same error.

tracing win32 api calls with frida caught the check:

```text
GetModuleFileNameW        from corz.dll+0x3534
CreateFileW               from corz.dll+0x3585   ...\bin\server\jvm.dll
GetFinalPathNameByHandleW from corz.dll+0x2b4f
GetModuleFileNameW        from corz.dll+0x35e2
CreateFileW               from corz.dll+0x3633   ...\bin\java.exe
GetFinalPathNameByHandleW from corz.dll+0x2b4f
```

it opened `jvm.dll` and `java.exe` with `0x80` (`FILE_READ_ATTRIBUTES`), share mode `7`, `OPEN_EXISTING`, and `0x2000000` (`FILE_FLAG_BACKUP_SEMANTICS`), read zero bytes from either file, and never touched `lib/modules`.

disassembling live `.text` at `0x34d0..0x3e30` showed unvirtualized rust code:
1. `0x350e` calls `GetModuleHandleExW(6, addr, out)` where `addr` landed inside `jvm.dll` in my harness.
2. `0x2b10` calls `GetFinalPathNameByHandleW` to canonicalize the path (defeating symlinks and `\\?\` tricks).
3. `0x366b..0x38b7` folds slashes to `/` and upper/lowercases ascii via `cmp cl, 0x1a / setb / shl 5 / or`, checking byte by byte that the canonical path ends with `/bin/server/corz.dll` (`len >= 0x15`). any mismatch jumps to `0x3daa`, writing error tag `0x14` (`20` decimal = `UntrustedRuntimeLocation`).
4. `0x35e2+` repeats it for `java.exe`.

trying to patch `0x366b` with frida `Memory.patchCode`, `Memory.protect`, or raw `VirtualProtect` on the `r-x` `.text` page (`size 290816`) returned `0` (`protect=false`), because the packer maps `.text` in a way that rejects write protection changes.

so instead of patching `.text`, i hooked `GetModuleFileNameW` in `kernel32.dll` whenever the return address was `corz.dll+0x3534` and overwrote `...\bin\server\jvm.dll` in the output buffer with `...\bin\server\corz.dll` (length `40`). that walked straight past `0x34d0`, invoked `PayloadBootstrap.runtimeIntegrity()`, and hit `Corz runtime integrity check failed: SyntaxError`.

tracing the call stack (`0x3534 -> 0x5d6527 -> 0x8943 -> 0x5d5909`) and disassembling `0x8800..0x8b00` revealed the next gate:

```text
0x893e  call 0x8150     (jumps into vm-protected verifier at 0x67048)
0x8943  test ax, ax
0x8946  je 0x8982       (sets r14b = 1 and returns success)
```

since `.text` cant be written, i allocated an `rwx` page, registered an x64 `AddVectoredExceptionHandler`, and triggered an `int3` inside `GetModuleFileNameW` to arm `DR0 = corz.dll + 0x8943` and `DR7 = 1` on the caller thread. when `0x8943` fired `EXCEPTION_SINGLE_STEP`, the handler zeroed `rax`, cleared `DR0`/`DR7`, and resumed, bypassing the entire `ed25519` manifest check on the first shot (`HIT_COUNT=1`).

```graph
type: flow
direction: td
title: native bypass flow inside N.i(byte[])
N.i(byte[]) -> 0x34d0: Path Check
0x34d0: Path Check --|GetModuleFileNameW Spoof|--> 0x893e: call 0x8150
0x893e: call 0x8150 -> 0x8943: test ax, ax
0x8943: test ax, ax --|DR0 + VEH zeros rax|--> 0x17d0: .gKe VM Unpacker
0x17d0: .gKe VM Unpacker -> 0x1ef0: CPAY Validator
```

---

## 5. `N.i`, `CPAY` vs `JCPAY`, and why `.gKe` was a trap

with `0x8943` bypassed, `N.i` threw `IllegalStateException: Invalid Corz packed payload container` at `corz.dll+0x5d59ed`. disassembling `0x5d5900..0x5d5c80` laid out the whole `N.i` pipeline:

```text
0x5d5904  call 0x8770       (runtime integrity gate, bypassed via DR0)
0x5d5988  GetByteArrayRegion into native buffer
0x5d59b7  call 0x17d0       (.gKe vm-protected unpacker, outputs ptr [rbp-0x38] & len [rbp-0x30])
0x5d59bc  cmp word ptr [rbp-0x28], 0
0x5d59c6  je 0x5d5acb       (nonzero throws "Invalid Corz packed payload container")
0x5d5aee  call 0x1ef0       (plain rust CPAY validator)
0x5d5b54  NewByteArray + SetByteArrayRegion + java callback with unpacked CPAY buffer
```

`0x1ef0` is plain rust, documenting the exact plaintext `CPAY` format passed back to java:

```text
magic     4 bytes   "CPAY"
version   u32_be    1
count     u32_be    1..100000
entries:
  kind      u8      1
  name_len  u32_be  6..65535
  data_len  u32_be  >= 4
  name      bytes   must end with ".class", no leading '/', no "..", no '\0', no '\\'
  data      bytes
```

meanwhile `0x17d0` takes an outer `JCPAY` container (string sitting right next to `CZVM` in `.rdata` at `0x48b3b`) and returned error tag `4` on raw `corz.vm` (`CZVM`). single-stepping `0x17d0` under a thread isolated VEH (`Dr3` watchpoint on `rdx+0` + `EFlags.TF` on `rip` inside `[corzBase, corzBase + corzSize)`) caught `+0x3c51a3` (`mov eax, dword ptr [r8 + r10*2 - 0x11d8e]`) reading `0x4150434a` (`JCPA`), then watched the `.gKe` vm (`+0x3c51a9..+0x3c52be`) burn `200+` instructions just to compute `~0x4150434a = 0xbeafbcb5` and reject synthetic `JCPAY` headers before even touching `rdx+4`.

fighting `.gKe` instruction-by-instruction for a fake `JCPAY` header was clearly the slow path, especially once i looked directly at `corz.vm`.

---

## 6. `corz.vm` (`CZVM`) and the reused XOR keystream disaster

`corz.vm` (`22,113,618` bytes) has an binary index with zero hidden trailers:

```text
magic          CZVM
version        1
class_count    3053
index_offset   22032466
```

each index record is `u16 name_len`, name bytes, `u32 offset`, `u32 length`, breaking down cleanly by package:

```text
gg/corz          2974 classes
corzbot            53 classes
de/neo/uhcbot      25 classes
com/corz/client     1 class
```

```graph
type: bar
title: corz.vm class distribution (3,053 total)
x: gg/corz | corzbot | de/neo/uhcbot | com/corz/client
y: 2974 | 53 | 25 | 1
```

every single class blob in `corz.vm` starts with the exact same `8` bytes:

```text
95 2a 1c f7 17 4a 73 b9
```

a java 21 (`major 65`) class file starts with `CA FE BA BE 00 00 00 41`. XOR the two and the first `8` bytes of the keystream fall right out:

```text
CA ^ 95 = 5f    00 ^ 17 = 17
FE ^ 2a = d4    00 ^ 4a = 4a
BA ^ 1c = a6    00 ^ 73 = 73
BE ^ f7 = 49    41 ^ b9 = f8
```

now for my mistake: i checked whether the keystream was per class or global by XORing `cipher[13..16]` against the known class name from the index across all `3,053` blobs in `corz.vm` **and** all `14` encoded classes in `bootstrap.jar`:

```text
offset 13 ^ name[0] = 31
offset 14 ^ name[1] = b7
offset 15 ^ name[2] = a2
offset 16 ^ name[3] = 5d
```

every single one of all `3,067` classes collapsed to the exact same constants. **they encrypted all `3,067` class files with the exact same fixed build wide keystream starting at offset `0`.**

from the constant pool header layout (`offset 10` = `CONSTANT_Utf8` tag `0x01`, `offset 11` = high length byte `0x00`, `offset 12` = `len(name)`), seven more bytes fell out immediately (`keystream[10..16] = 8f 47 6a 31 b7 a2 5d`).

EVEN better, `gg/corz/injector/bootstrap/N.class` is only `181` bytes long (`cp_count = 14`). decoding its tiny `Code` attribute (and cross-checking `gg/corz/IIIiIi`, `gg/corz/IIIiIIl`, and `gg/corz/IIliili`) revealed a 10-byte custom JVM opcode substitution table:

```text
0xef -> 0x2b (astore_0)       0xf4 -> 0xb8 (invokestatic)
0xf0 -> 0xb3 (putstatic)      0xf5 -> 0x04 (iconst_1)
0xf1 -> 0xb6 (invokevirtual)  0xf6 -> 0xb2 (getstatic)
0xf2 -> 0xb7 (invokespecial)  0xf7 -> 0x2a (aload_0)
0xf3 -> 0xb5 (putfield)       0xf8 -> 0xb4 (getfield)
```

before attacking the stream directly, i ruled out all cheap crypto guesses:
* **compression / ECB**: no zlib/gzip/lzma/bz2 headers; no repeating 16-byte blocks in a `1.37 mb` blob.
* **32-bit PRNGs / `java.util.Random`**: checked `w0 = 0x49a6d45f` / `w1 = 0xf8734a17` (LE and BE) against common LCGs, `xorshift32`, `splitmix32`, and `java.util.Random` seeded with hashes/lengths/indices, with no match.
* **embedded keys**: swept every `16`/`24`/`32`-byte window across loader `.rdata` (`71,168` bytes) and `vm.dll` `.rdata` (`1,695,744` bytes) plus SHA/MD5 digests of `qProtect.vm.code.key.v1`, `corz-runtime-integrity-v1`, `corz.vm`, `CZVM` into AES-CTR, ChaCha20, and RC4, getting zero hits.
* **HotSpot `jvm.dll` check**: verified `ClassFileParser::parse_stream` (`0x296cb0`) in `jvm.dll` (`15,509,600` bytes) checks raw `bswap r8d` against `0xCAFEBABE` with zero inline decryption.

and statistical checks on the stream showed uniform byte distribution (`min_freq = 64`, `max_freq = 115` over `22,486` bytes) and flat `~1/256` lag coincidences (`~87.8` expected across lags `1..64`, zero periods up to lag `4769`). none of that mattered, because `3,067` aligned blobs sharing one keystream can be unzipped straight from their own constant pools.

---

## 7. the constant-pool UTF-8 zipper (`0` -> `73,099` bytes)

every java class file packs its `CONSTANT_Utf8` descriptors, `net/minecraft/class_*` names, and `gg/corz/*` references near the front, followed by fields, methods, and attributes. whenever one blob crosses the unknown keystream frontier inside a `CONSTANT_Utf8` string (matching an already seen string or strict descriptor/obfuscated name grammar), every other active blob crossing that exact byte acts as an oracle checking whether the candidate keystream byte keeps its own constant pool tags, lengths, and post CP offsets valid.

1. **round 1 (`0 -> 20,044` bytes, `2,865` classes decoded)**: matching `CONSTANT_Utf8` prefixes of `>= 8` bytes against harvested pool strings pushed cleanly to `20,044` bytes.
2. **round 2 (`20,044 -> 38,932` bytes, `3,107` total decoded classes)**: switching to bytewise prediction + a post-CP structural cursor (`PostCpCursor`) + strict `gg/corz/[Ili$0-9]+` charset constraints hit three memorable dead ends:
   * **drift at `22,185`**: an early pass drifted by `^ 0x05`, turning `minecraft` into `minecrdft`, `Lgg/corz/` into `Lgg/cowz/`, and `ticksSince` into `ticksSikce`. checking all `10` active descriptors crossing `22,185` (`IIiIii`, `IIIIiliI`, `IIIlllIIi`, `IIIiiIlIi`, `IIlIiIlll`, `IIliiiiIl`, `IIiIIIIli`, `IIilIiiII`, `Fighter`, `IIiil`) unanimously forced `ks[22185] = 0x06`.
   * **the `20,873`-byte SVG atlas at `22,187`**: `175/176` blobs agreed on `0x80` (`_` in `field_`), while `gg/corz/IIII.class` (`120,617` bytes) tried to declare a `20,873`-byte `CONSTANT_Utf8` SVG path atlas (`M629,460L591,280...` at `22189..43062`), tripping my `8192`-byte sanity cap. replacing the cap with `pos + 3 + sl < len(bl)` unlocked `22,187..22,486`.
   * **false match at `22,486..22,488`**: matching seen `net/minecraft/class_1294` instead of unseen `class_1292` drifted `22,487` by `0x06` (`GameProfij` / `Lgg/cot`). tightening charset rules climbed straight to `38,932` verified bytes (`2,987` of `3,053` `corz.vm` classes + `13` bootstrap + `107` mixins, `bad=0`, `67` oversized remaining).
   * **`Long`/`Double` parser bug**: decoding `MixinGameRenderer.class` (`6,930` bytes) initially jumped out of bounds (`ifc = 512`) because `parse_cp_full` incremented the CP index by `1` instead of `2` on `CONSTANT_Long` (`5`) and `CONSTANT_Double` (`6`) tags. fixing `i += 2` parsed all `3,107` classes cleanly.
3. **round 3 (`38,932 -> 73,099` bytes, `3,156` total decoded classes)**: checking the `11` classes still inside their constant pools at byte `38,932` showed `gg.corz.IIliIIiii` sitting at `(FF)Lorg/joml/Matrix3` with declared length `25`. the only valid JOML type matching that length is `(FF)Lorg/joml/Matrix3x2f;`. seeding those `4` bytes (`x2f;`) propelled the zipper to `73,099` bytes, decoding `49` more classes!

```graph
type: bar
title: keystream zipper progress (decoded classes)
x: 0 B (Start) | 20,044 B | 38,932 B | 73,099 B
y: 107 | 2865 | 3107 | 3156
line: true
```

that left just `18` oversized classes `> 73,099` bytes, mostly giant bots/modules (`gg.corz.IIIlllill` `AutoBuilder` at `1,378,815` bytes, `IIliIIiii` `ShowHUD` at `169,884`, `IIIlllI` `VillagerTradeBot` at `126,692`, `IIIllIi` `AutoElytraFinder` at `120,864`, `de/neo/uhcbot/Fighter` at `73,373`, and `corzbot/Bot` at `52,459`), while decoding `145` of the `150` `IIIIli` modules, all `9` `IIIlIIl` subclasses, and the real `IIlillIIi` clickgui `Screen` (`42,012` bytes).

---

## 8. bytecode audit: isolating `qvm`, auth, rpc, and watermarks

walking every `Code` attribute instruction by instruction (`wide`, `tableswitch`, and `lookupswitch` handled cleanly so `0xef..0xf8` literal operands never get corrupted) gave us full visibility into the client:

* only **`16` decoded classes** reference `com/corz/client/qvm/Runtime` (and partial CP header scans of oversized classes showed zero `Runtime` references).
* zero non-`qvm` classes reference `gg/corz/injector/*`.
* `com.corz.client.CorzClient` is completely plain java bytecode with **zero `Runtime.run` calls**; it invokes `IIIIIllI.IIi()`, `IIIiillll.IIl()`, `IIIIiiIil.IIi()`, `IIIilliI.III()`, `IIiilIl.III()`, and gates the clickgui (`IIlillIIi`) vs the auth screen (`IIIiIiIli`) and keybinds on `IIIiillll.IIli()`.

the network, auth, and telemetry targets split cleanly:

| class | original behavior | standalone replacement |
| --- | --- | --- |
| `gg/corz/IIIlIIiil` | 15-constant tier/license enum | clean enum (`IIIliiIIIii .. IIIliiIIiII`) |
| `gg/corz/IIIiillll` | auth/license check (`IIli()`, `IIIlI()`, `IIiI(String)`, `IIil()`, `IIii()`) | returns `true`, `IIIliiIIIii`, `"Offline"` |
| `gg/corz/IIIIIllI` | startup verification (`IIIl()`, `IIi()`) | returns `true` / no-op |
| `gg/corz/IIIIiiIil` | session/user info (`IIII()`, `IIi()`, `IIl()`) | returns `"offline"` / no-ops |
| `gg/corz/IIliiIiil` | auxiliary auth check (`IIi()`, `IIl()`) | returns `"offline"` / no-op |
| `gg/corz/IIIlilIll` | API URLs (`https://api.corz.gg/api/v1`, `https://corz-api.apkreader.dev`) | pointed to `http://127.0.0.1` + `false` flags |
| `gg/corz/IIiilIl` | `SocketChannel` to `corz.gg` sending `"Playing CorzClient"` + `"corz_logo_v2"` | no-op `III()` and `IIIl()` |
| `gg/corz/IIliII` / `IIllIlIiI` | `gg/corz/rpc/RpcClient` (`analyze`/`call`/`combat`) | dummy `RpcClient` + HTTP `200` empty `JsonObject` stubs |
| `gg/corz/IIIlIIiIl` | `HttpURLConnection` cape & texture fetcher | returns `null` / empty arrays |

and clean java 21 implementations for the helper types `IIIiIiIl`, `IIilliiI`, `IIIiiIIlI`, `IIiIIIIIl`, `IIIiillii`, `IIiI`, and `IIli` with zero `Runtime` references.

---

## 9. surgical patching & live `1.21.11` debugging

### 9.1 binary patching `IIIIli` and `IIIilliI`

out of `30+` methods in `gg/corz/IIIIli` (`Module` base), only `<clinit>` (`Runtime.loadVm`) and `IIIII(boolean)` (`setEnabled`) used `qvm`. likewise `gg/corz/IIIilliI` (`ModuleManager`) kept `12` plain java event dispatchers (`IIIIl`, `IIl`, `IIIl`, `IIIll`, `IIIli`, `IIiI`, `IIli`, `IIil`, `IIii`, `IIIIi`, `IIll`, `IIIII`, `IIlI`, `IIIlI`, `IIIi`, `IIII`) and used `qvm` only in `<clinit>`, `III()` (module registration), and `IIi()` (tick dispatch).

instead of rewriting whole classes and losing those dispatchers, i patched both `.class` files directly:
1. NOP'd the first `8` bytes (`ldc`, `MethodHandles.lookup()`, `Runtime.loadVm`) in both `<clinit>` methods, keeping `IIIiIiII = MinecraftClient.method_1551()` and `ArrayList`/`EnumMap`/`IdentityHashMap` setup intact, and rewrote `"com/corz/client/qvm/Runtime"` CP entries to `"java/lang/Object"`.
2. changed `IIIIli.IIIiIill` (`enabled`) and `IIIii`/`IIIil` (`onEnable`/`onDisable`) to `public`, and rewrote `IIIIli.IIIII(boolean)` to call `gg/corz/CorzOfflineHooks.toggleModule(IIIIli, boolean)` (updating `IIIiIill`, calling `IIIii()` or `IIIil()`, and saving config via `IIIIlili.IIl()`).
3. rebuilt `IIIilliI.III()` to call `CorzOfflineHooks.initCategoryMap(IIlIllilll)` and instantiate/register all `150` modules (`new; dup; invokespecial <init>()V; invokestatic IIIilliI.IIl(IIIIli)V`), and routed `IIIilliI.IIi()` into `CorzOfflineHooks.tickModules(IIlIllillI)`.

### 9.2 NTFS safe compilation & offline stub wiring

compiling the replacement and stub `.java` sources (`--release 21 -implicit:none`) on windows hit ntfs collisions again (e.g. `gg/corz/IIIlIIiIl` `HttpURLConnection` helper vs `gg/corz/IIIlIIiil` `License` enum), so the build splits sources across case-insensitive-safe directories and collects compiled `.class` bytes straight into zips. (`javac` also immediately caught a false positive on `gg/corz/IIIiIIill` `57,332` bytes because its `int IIi()` clashed with `IIIIli`/`IIIIll`'s `boolean IIi()`, confirming `16` -> later `5` remaining undecoded `IIIIli` modules.)

to make the offline jar boot cleanly on `Fabric 1.21.11` (`zulu21.46.19-ca-jre21.0.9-win_x64`), the build also wires up these invariants:

1. **`IIIilliI.IIl` category map & `fabric.mod.json`**: `CorzOfflineHooks.initCategoryMap` populates an `ArrayList` for every `IIIiIll.values()` entry in `IIlIllilll` (which `IIIilliI.<clinit>` initializes as an empty `EnumMap<>(IIIiIll.class)`), stubbed module constructors pass `IIIiIll.values()[0]` instead of `null`, and the unsupported `"assets"` root key is stripped from `fabric.mod.json`.
2. **`IIIliiiii` array inheritance**: `IIIliiiii` builds an `IIIlIIl[]` array of `21` implementations, so any stubbed entries (`IIIiIllll`, `IIlIllll`, `IIIlIlli`, `IIIiiill`, `IIlliIlIi`, `IIIlIiIlI`, `IIlillIi`, `IIiIllill`, `IIIlIIi`, all decoded at `73,099` bytes) `extends gg.corz.IIIlIIl`.
3. **`gg.corz.rpc` protobuf types**: all `.class` entries from `META-INF/jars/client-rpc-1.0.0-bundled.jar` are extracted so protobuf message/builder references (like `gg/corz/rpc/cloud/AnalysisJob` in `IIlIilIii.<init>`) resolve while our offline `gg/corz/rpc/RpcClient` override blocks all network calls.
4. **singleton, `Matrix4f`, and array defaults**: stubbed classes auto-initialize static singleton self-fields (like `IIliliIll.IIiilIIIliI` for `IIliIIil.IIII`), `public static org.joml.Matrix4f` fields (`new org.joml.Matrix4f()`, e.g. `IIllIIIIliI`, `IIllIIIIlil`, `IIllIIIIlli` on `gg.corz.IIIliiili` for `MixinGameRenderer`), `float[16]`, `String[0]`, and `""` fields.
5. **`CONSTANT_MethodHandle` lambda targets**: the use scanner collects `invokedynamic` `CONSTANT_MethodHandle` (`tag == 15`) targets alongside direct `invoke*` opcodes so method-reference bindings (like `IIIlllI::IIlIIll` and `IIIlllI::IIlIIli` in `gg.corz.IIlIIliIi.III`) are included on every stub, while the real `IIlillIIi` (`42,012` bytes) clickgui `Screen` is decoded directly.

---

## 10. stamping the footer in `gg.corz.IIIiIiIli`

running the `invokedynamic` string decryptor across `gg/corz/*.class` found `"Verified securely on this device."` in `gg/corz/IIIiIiIli.class` (`utf#1298`, `BootstrapMethods #48` via `IIiiI`), rendered by `private void IIlii(int, int)` through `IIii(String, float, float, int)` at `(x, y + 121)`.

since `IIii` centers a single line at scale `0.82f`, rewriting `IIIiIiIli.IIlii(int, int)` draws two centered lines instead:

```text
Cracked by big scary rara       (at y + 121)
galaxia.wtf/#research/corz      (at y + 132)
```

---

## 11. the cracked build

```text
file     corzclient-2.0.3-cracked.jar
size     41,715,305 bytes (11,519 entries, 11,013 classes)
```

`corz.vm`, `com/corz/client/qvm/**`, `gg/corz/injector/**`, `"preLaunch"`, and `"jars"` are completely stripped. static audit (`bad_magic=0`, `qvm_refs=[]`, `injector_refs=[]`, `endpoint_refs=[]`, `javap -v -p` major `65`) and live `Fabric 1.21.11` verification both pass, completing `CorzClient.onInitializeClient()`, initializing OpenGL and OpenAL (`Sound engine started`), joining worlds, and opening the real `IIlillIIi` clickgui cleanly with zero crashes and zero network traffic.

---

### final thoughts

all that packed rust/mingw native code, `ed25519-dalek` manifest verification, `.gKe` VM container unpacking, `qProtect` `vm.dll`, and `20.8 mb` of gRPC cloud analysis, and they:

1. encrypted all `3,067` classes with the **exact same XOR keystream from byte 0**, letting a constant-pool UTF-8 zipper peel `3,156` classes straight out of `corz.vm` without ever devirtualizing `.gKe` or `vm.dll`.
2. left `CorzClient` and `145` modules as plain java bytecode (behind a 10-byte opcode swap) once `Runtime.loadVm` was NOP'd out of `<clinit>`.

huge thanks again to our anonymous source for the drop, and remember: never reuse a stream cipher keystream across 3,000+ structured files xD. hope you enjoyed the breakdown, go grab another monster :)

---

### full protection architecture

```graph
title: Corz 2.0.3 full protection & crack architecture
direction: td
CorzInstaller.jar (30.2 MB) --|drops VMP binary|--> CorzLauncher.exe (VMP)
CorzLauncher.exe (VMP) --|decrypts in RAM|--> CRZB bundle (106 MB)
CRZB bundle (106 MB) --|68.7 MB|--> bootstrap.jar
CRZB bundle (106 MB) --|21.9 MB|--> payload.jar
CRZB bundle (106 MB) --|15.4 MB rust/mingw|--> corz-loader.dll
payload.jar --|22.1 MB CZVM blob|--> corz.vm (3,067 classes)
corz-loader.dll --|verifies|--> ed25519-dalek manifest
ed25519-dalek manifest --|unlocks|--> .gKe custom VM
.gKe custom VM --|unpacks|--> JCPAY -> MemoryModStore
corz.vm (3,067 classes) --|same XOR from byte 0|--> 10B opcode swap (0xef..0xf8)
bootstrap.jar --|preLaunch + JNI|--> CorzClient (Fabric 1.21.11)
JCPAY -> MemoryModStore --|injects|--> CorzClient (Fabric 1.21.11)
10B opcode swap (0xef..0xf8) --|JVMTI / classload|--> CorzClient (Fabric 1.21.11)
CorzClient (Fabric 1.21.11) --|Runtime.loadVm|--> qProtect vm.dll
CorzClient (Fabric 1.21.11) --|gates|--> IIIiIiIli Auth / IIlillIIi GUI
CorzClient (Fabric 1.21.11) --|TLS sockets|--> corz.gg telemetry
CorzClient (Fabric 1.21.11) --|20.8 MB gRPC|--> client-rpc cloud backend
CRZB bundle (106 MB) --|RAM dump + UTF-8 zipper|--> 73,099B keystream (3,156 classes)
73,099B keystream (3,156 classes) --|NOP <clinit> + CorzOfflineHooks|--> corzclient-2.0.3-standalone.jar
```
