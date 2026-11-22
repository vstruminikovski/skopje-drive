# Скопје · Дебар Маало

One game, two modes, one build.

- **Играј** (`/play/`): drive through Skopje. Only this page loads the game.
- **Градител** (`/build/`): add and delete signs, lights, poles and markings, then save them into the game.
- The home page (`/`) is the welcome screen and loads nothing else.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # production build in dist/
```

## Where things live

| Path | What |
| --- | --- |
| `index.html`, `play/`, `build/` | the three pages |
| `src/game/` | the game engine (map, physics, traffic, rendering) |
| `src/builder/` | the builder |
| `src/shared/db.ts` | the small key-value store both modes use |
| `public/mapng/prviot_krug/` | the map data |
| `public/items/default.json` | the published items, for everyone |

## How items reach the game

1. The builder saves your items **in this browser** (**Зачувај во играта**). The game shows them the next time you play in this browser.
2. To publish items for everyone, use **Објави како основно** in the builder, which downloads `default.json`. Replace `public/items/default.json` and push.
3. **Врати основно** removes your saved items from this browser so the game shows the published ones again.

Map data © OpenStreetMap contributors.
