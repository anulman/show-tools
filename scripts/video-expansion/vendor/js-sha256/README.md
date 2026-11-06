# Portable SHA-256 for Figma readiness

`sha256.js` is unchanged upstream source from [js-sha256 v0.11.1](https://github.com/emn178/js-sha256/blob/v0.11.1/src/sha256.js), copyright Chen, Yi-Cyuan, under the included MIT license. It is used only by generated Figma inspection/precondition scripts. No Node or Web Crypto API is assumed in that runtime.

- Source SHA-256: `2db6c8e554fbee14672368a0d7551a8ddd841ee96c91526eb7987a0179cfc717`
- License SHA-256: `0fea2e0cffe72ee17adc25c42e55daf5c87c6e9cd5b3362ee4213890bda0ee7c`

The readiness helper checks the exact source digest before embedding it in a private closure. Tests compare the emitted implementation against Node crypto, including padding boundaries and inputs larger than one MiB. Upgrading this vendored source requires updating its recorded hash and rerunning those checks. No package-lock or runtime application dependency changes are needed.
