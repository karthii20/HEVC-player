# Audio WASM assets

Unmodified upstream libmedia v1.3.1 assets, matching the pinned
`@libmedia/avplayer` dependency. The package's LGPL notice and license also apply
to these bundled libmedia resources. Upstream source and build instructions:
[libmedia v1.3.1](https://github.com/zhaohappy/libmedia/tree/152f629d3021fd8013efa464fcb7b55f9fbe7753).

Downloads use commit `152f629d3021fd8013efa464fcb7b55f9fbe7753` (tag `v1.3.1`):

- `aac-simd.wasm`: `dist/decode/aac-simd.wasm`, SHA-256 `d261e0f99e83e403e62f88be4368e352eafb25ddc690a0aa10e9130637339b2d`
- `resample-simd.wasm`: `dist/resample/resample-simd.wasm`, SHA-256 `e4db620d0878198bcb6b8fb16035a259208b739ace8c54a6507057b4f4c5c9dd`
- `stretchpitch-simd.wasm`: `dist/stretchpitch/stretchpitch-simd.wasm`, SHA-256 `62d52214210a2e7f748cab6e18bbc1d854e76a5bc88df30449109dd6b83c9f91`

The existing H.264 and HEVC assets are unchanged in this release.
