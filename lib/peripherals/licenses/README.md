# I-PAC LED command provenance

The encoder and interface guards were checked against Ultimarc's published [PacDriveSDK.zip](https://www.ultimarc.com/PacDriveSDK.zip), downloaded for source inspection without running its executables.

The inspected archive SHA-256 is `5dc667914719ce4cbf4e6cc814a172de5cade28d6b4a9c3ed5bd1b46fd709e53`. `dll/PacDrive.cpp` defines `Pac64SetLEDIntensity`, selecting report ID 3 for I-PAC Ultimate I/O and a four-byte body containing the zero-based channel, intensity, and two zero bytes. `dll/PacDrive.h` defines the Ultimarc vendor ID and I-PAC product range. The encoder admits single indices 0 through 95 and does not expose the SDK's all-channel special command.

The archive includes the [MIT license](PacDriveSDK.txt), copyright Ben Baker. Its Windows binaries are not bundled or executed. This package adds no native library dependency. The command layout and descriptor guards are tested as bytes; acceptance by the operator's actual firmware and electrical setup remains unverified until an explicit wiring test.

The Mac adapter uses Apple's [IOHIDManager input API](https://developer.apple.com/documentation/iokit/1438367-iohidmanagerregisterinputvalueca) and `IOHIDDeviceSetReport`. The local Xcode header states that numbered reports include their ID in the report buffer. Linux uses the kernel's documented [input event](https://docs.kernel.org/input/event-codes.html) and [hidraw](https://docs.kernel.org/hid/hidraw.html) interfaces. No code from a third-party Linux driver is incorporated.
