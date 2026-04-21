# Third-Party Licenses

Runtime dependencies of `@coopenomics/coopos-ship-reader`:

## @wharfkit/antelope

- License: BSD-3-Clause
- Repository: https://github.com/wharfkit/antelope
- Copyright (c) 2022-2024 Greymass Inc.

## ws

- License: MIT
- Repository: https://github.com/websockets/ws
- Copyright (c) 2011 Einar Otto Stangvik

## @eosrio/node-abieos (optional)

- License: MIT
- Repository: https://github.com/eosrio/node-abieos
- Copyright (c) 2019-2024 EOS Rio
- Note: Optional dependency. If not installed, the package falls back to
  `@wharfkit/antelope` for deserialization automatically.
