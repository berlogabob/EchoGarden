# EchoGarden

Live, participatory “text garden.” Visitors’ words become the image. A physical button (ESP32) grows the garden through silhouettes; a second ESP32 streams a room value to Firebase that makes the garden breathe.

## Demo
- Live site: https://<username>.github.io/<repo>/
- Short video/screencap: (link)

## Concept
- Letters form the garden. We draw a character grid only where a mask image is bright.
- New lines are “spotlighted” once, then dissolve into the mosaic.
- A button advances the garden silhouette (crossfade). A room value modulates density/scale.

## Tech Stack
- p5.js (rendering), ml5.js (sentiment, optional), Firebase Realtime Database, ESP32 (USB + Wi-Fi), Web Serial API.

## How it works (quick)
1. **Mask → Mosaic.** We sample a PNG mask at grid steps. If brightness > threshold, we draw a letter there.
2. **Text pools.** Lines feed positive / neutral / negative pools; mosaic pulls characters per row (top/middle/bottom).
3. **Highlight.** Planting a line shows it once (haloed word), then it blends into the pool.
4. **Controls.**
   - **ESP32 button** prints `NEXT` over serial → browser switches mask with a soft crossfade.
   - **Firebase value** (0..1) maps to `reveal` (density) and `zoom` (legibility).

## Repository layout
