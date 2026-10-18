# roadster.game

A free 3D browser game: lift a two-seat flying roadster off a night desert, then fly the **Mars Run** through ring gates and an asteroid field from Earth orbit to Mars.

Built by [Aswini](https://www.linkedin.com/in/iam-aswini) with React, TypeScript, Vite, Three.js / React Three Fiber and Zustand.

## Run
```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview
```
Query flags: `?q=high|medium|low` pins render quality, `?view=drive` opens the Mars Run directly.

## Controls
| Key | Action |
|---|---|
| W / S | thrust / brake |
| A / D | steer |
| ↑ / ↓ (or R / F) | climb / dive |
| Shift | boost (fly through red rings to recharge) |
| Space | air-brake |
| Esc | pause |

Gamepad and on-screen touch controls are supported. Hands-off, the car eases back onto the course line.

## What's inside
- **Landing**: the car hovers about 2.4 m above a night desert on four recessed lift modules with cold-gas vapour, then climbs into orbit as you scroll. Butterfly doors open in the garage view.
- **Garage**: Street / Thrust / Flight variants and a finish studio (colour, metallic, roughness, clearcoat, flake, wheel finish) with `.glb` export.
- **The Mars Run**: a one-way course of about 5 km; the HUD counts down the 54.6 million km to Mars.
- **SEO / AEO**: meta and social tags, JSON-LD (VideoGame, WebSite, Person, FAQPage), `robots.txt`, `sitemap.xml`, `llms.txt`, and crawlable pre-render content. The canonical URL assumes `https://roadster.game/`.

## Project map
- `src/car/`: procedural car (`Car.tsx`, `loft.ts`) and vapour (`Gas.tsx`)
- `src/scenes/`: landing (`SiteScene.tsx`, `Desert.tsx`), Mars Run (`DriveScene.tsx`), planets (`Planet.tsx`)
- `src/game/`: course (`track.ts`), input, HUD data
- `src/ui/`: landing page and HUD

## Note
The vehicle is procedural geometry, not a scanned or licensed model. roadster.game is an independent prototype, not affiliated with Tesla or any automaker; the vehicle and world are original work.
