# Formal verification tools

The verification packages keep three claims separate: a finite model's invariants, conformance checks against the actual implementation, and deliberate source mutations that the checks detect. A green model alone does not prove the implementation.

`toolchain.lock.json` records the exact official artifacts used for the initial runs. TLC is the TLA+ tools release 1.7.4, reporting TLC2 version 2.19. The verified Java runtime is Temurin 25.0.5+8 for macOS ARM64. The Java archive and TLC JAR are development tools, not application dependencies or deployment artifacts.

## Prepare a checker

Download the named archives from the lock file, verify their complete SHA-256 hashes, and extract the Java archive outside the repository. Do not silently accept a different JAR or alter system Java. The installation used a private directory under the user's local application data.

Set explicit paths for a verification run:

```sh
export JAVA=/absolute/path/to/temurin/Contents/Home/bin/java
export TLA2TOOLS=/absolute/path/to/tla2tools-1.7.4.jar
```

Use one TLC worker and a bounded Java heap, initially 512 MiB. Inspect a completed exhaustive state search, not a timeout, depth-truncated run, or a process that merely started. The initial toolchain smoke check explored two states and checked a simple type invariant. That smoke check establishes checker readiness only; it proves no product property.

The models are portable source. These initial results do not establish another Java distribution, operating system, native compiler, physical audio device, or deployment. A different environment must run its own checks. Missing tools are a verification-environment failure for Chief, not a reason to waive a product invariant.

## Read model results

Use the current p-stack `/statechart` skill to inspect each TLA+ result in the operator's terms. Its installed commands and paths are not part of this repository's API. Follow that skill's current instructions rather than copying an installation path into a verification script. Supply the same pinned checker through its documented environment interface.

Retain complete failing traces and identify each assumption and bound in the package's contract. Replay a reported model bug against actual code before reporting a product defect. If replay disagrees, investigate the abstraction first. An intentional source mutation is separate evidence that the check is sensitive to a real implementation regression.

## Licensing

TLC's upstream TLA+ tools license is MIT. Temurin's OpenJDK runtime is GPLv2 with the Classpath Exception. The copyleft runtime is used only as a local verification tool and is not bundled with the application. Its archive contains the applicable license notices. Preserve those notices with an installed runtime.
