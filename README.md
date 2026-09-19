# Thrive

A seeded, reproducible population simulation. Agents move inside a closed
rectangle, bounce off each other and the walls, age, form unions, produce
offspring, and die of old age.

- Design: `docs/superpowers/specs/2026-09-19-thrive-simulation-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-thrive-simulation.md`

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | The simulation. Pure, seeded, no DOM, timers or I/O. |
| `packages/worker` | The only place wall-clock time exists. |
| `packages/ui` | Canvas renderer, controls, live statistics. |
| `packages/cli` | Headless runs and parameter sweeps. |

## Local development

```bash
npm install
npm test
npm run dev --workspace @thrive/ui
```

## Docker

```bash
docker compose up web
```

The application is then served at http://localhost:8080.

```bash
mkdir -p out
docker compose run --rm sim --years 500 --seed 42 --out /out/run.csv
```

## Reproducibility

A run is fully determined by its configuration and its seed. The same pair
always produces the same result, in the browser and in the CLI alike. The
golden-run fixture at `packages/cli/test/fixtures/` freezes one such run; if a
change alters simulation behaviour, that test fails.

To re-baseline the fixture deliberately after an intended behaviour change:

```bash
npm run golden:update
```
