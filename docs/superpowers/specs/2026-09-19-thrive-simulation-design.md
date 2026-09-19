# Thrive — Species Survival Simulation: Design

Date: 2026-09-19
Status: Approved design, ready for implementation planning

## 1. Purpose and scope

Thrive simulates the survival of a population inside a closed rectangular
world. Agents move in straight lines, bounce off each other and the walls,
age, form unions, produce offspring, and die of old age. The question the
simulation answers is whether a given set of biological parameters lets the
population thrive, stagnate, or die out.

The project serves two goals at once:

- **Experiment.** Runs are seeded and reproducible. Parameters are tunable,
  results are exportable, and a headless runner produces the same numbers as
  the on-screen run.
- **Game foundation.** The simulation core accepts commands from outside, so
  later phases can add player interventions without reshaping the engine.

Both goals are served by the same constraint: the core is pure, seeded, and
decoupled from time and display.

### Scale

Target is approximately 1,000 concurrent agents, all individually visible.
This is small enough that a single-threaded core with a spatial grid is
comfortably fast, and parallelism is not a design driver. The architecture
keeps the door open to a faster core (see Section 2) without requiring it.

### Out of scope

Stated explicitly so it stays out of this spec: resources and food, density
driven mortality, genetics or inherited traits, migration, player
interventions, multiple regions, persistence of runs to a database, and any
performance work beyond the spatial grid.

## 2. Architecture

Four packages in one repository. The governing rule: **the core has no DOM,
no timers, no I/O, and no randomness except its own seeded PRNG.**

### `core/`

The simulation itself. Pure TypeScript, zero runtime dependencies.

Public interface:

```
init(config: SimConfig, seed: number): Simulation
step(deltaYears: number): void
snapshot(): Snapshot
stats(): StatsSeries
command(cmd: Command): void
```

Internal structure:

- `Agent`, `Union` — the entities.
- `World` — bounds and the uniform spatial grid.
- `Rng` — seeded PRNG with independent named streams.
- `rules/` — the tunable biology: lifespan sampling, union formation, birth
  chance, death. Kept separate from mechanics so tuning never touches the
  engine.

`snapshot()` returns a flat, transferable structure (positions, genders,
ages, union links), never live objects. This keeps the worker boundary
honest and means replacing `core/` with a WASM implementation later changes
nothing upstream.

### `worker/`

A thin Web Worker wrapper and **the only place time exists**. It owns the
wall clock, translates the seconds-per-year setting into `step()` calls,
handles play/pause/speed/fast-forward, and posts snapshots to the main
thread.

### `ui/`

The browser application: canvas renderer, control panel, stats panel. It
reads snapshots only and never touches simulation objects.

### `cli/`

A Node entry point that imports `core/` directly and runs headless for N
years, emitting the stats series as JSON or CSV. Used for parameter sweeps
and for golden-run regression tests.

### Delivery

Vite builds the web application; a multi-stage Dockerfile produces a small
static-serving image. A second Dockerfile runs the CLI. `docker compose up`
serves the app on a local port. `docker compose run sim --years 500 --seed
42` produces a CSV.

## 3. Time, movement, and collisions

### Time

The model has one unit: the year. The core advances in fixed sub-steps of
1/12 year (a "month") regardless of wall-clock speed. Fixed timestep is what
makes runs reproducible and makes fast-forward produce results identical to
real-time playback.

The speed setting (x seconds = 1 year) lives entirely in the worker and only
decides how many sub-steps to run per animation frame. Fast-forward runs
sub-steps as fast as possible without waiting on the clock.

Agent velocity is defined in world-units **per year**. Changing the speed
setting therefore changes how fast dots visibly move as a direct consequence
of the model, not as a separate knob.

### Movement

Each agent has a position, a unit direction, and a scalar speed sampled at
birth from a configurable range. Per sub-step: `pos += dir * speed * dt`.
Speed is constant for an agent's lifetime; there is no energy loss, so the
field keeps moving indefinitely.

### Collisions

- **Broad phase:** a uniform spatial grid sized to the collision diameter,
  rebuilt each sub-step. At 1,000 agents this is a few thousand cheap cell
  lookups rather than ~500,000 pair checks.
- **Narrow phase:** a distance test between candidate pairs.
- **Response:** reflect both directions about the line of centers, then
  separate the pair just enough to remove overlap. Equal mass,
  speed-preserving, no momentum bookkeeping.
- **Walls:** flip the relevant direction component.
- **Tunneling:** the sub-step size is constrained so that no agent moves more
  than half a collision radius per step.

Every contact also emits an **encounter event** — a pair of agent ids. This
is the single hook that reproduction consumes, which is why physics and
biology never reference each other.

### Determinism

- Agents are always iterated in id order.
- Collisions are resolved in a stable order.
- The PRNG is split into independent named streams (`movement`, `lifespan`,
  `union`, `birth`) so that adding a random draw in one system cannot shift
  the numbers another system receives.

The same seed plus the same config always produces the same run, in the
browser and in the CLI alike, **for a given JavaScript engine**. Host-and-
container verification (macOS host vs. Linux Docker) confirms this, but both
of those run V8, so that comparison was always going to agree. It does not
demonstrate cross-engine reproducibility: `Math.sin`, `Math.cos`, `Math.log`
and `Math.hypot` — used respectively in `rng.ts`'s Box-Muller transform,
`agent.ts`'s initial direction sampling, and `physics.ts`'s distance
calculation — are explicitly permitted by ECMAScript to be
implementation-approximated, so a different engine (e.g. a non-V8 browser)
is not guaranteed to reproduce a fixture byte-for-byte. Bit-exact
reproducibility across engines would require replacing those transcendental
functions with fixed-point or polynomial implementations; that is a
deliberate future change, not a property the current implementation
provides.

## 4. Biology

### Agent

Fields: id, gender, position, direction, speed, radius, birth year, lifespan,
union state (partner id or none, re-pair cooldown remaining).

Radius is uniform across agents (`agentRadius` in config) and defines both the
drawn size and the collision distance. A bonded pair is treated as a single
body whose extent covers both members plus their fixed offset.

**Lifespan** is sampled once at birth from a truncated normal distribution,
clamped to the configured `[lifespanMin, lifespanMax]` range (default 15 to
95), with a separate configurable mean per gender and a configurable spread.
All four parameters are config, so the distribution can be flattened toward
uniform if desired.

### Initial population

The starting population is created with the configured size and sex ratio.
Each initial agent receives a lifespan roll, then a starting age sampled
uniformly from `[0, lifespan)`. Starting them all at age zero would create a
single synchronized cohort that dies off in one wave, which is an artifact of
initialization rather than a property of the parameters being studied.

### Union formation

On an encounter event, a union forms with probability `unionChance` if all
of the following hold:

- the two agents are of opposite gender,
- both are unpartnered,
- both are within their gender's fertility window
  (`fertileAgeMin` / `fertileAgeMax`, configured per gender),
- both have completed any re-pair cooldown.

Union duration is sampled from a configurable range in years.

### Bonded movement

On formation the pair adopts a single shared direction and speed and holds a
fixed small offset. They are drawn as two linked dots. Collisions and walls
act on the pair as one body, so both redirect together, and the pair occupies
space as a unit.

### Births

At each year boundary, every active union rolls `birthChancePerYear`. On
success, one offspring spawns at the pair's midpoint with:

- a random direction,
- a speed sampled from the configured range,
- a gender drawn against the configured sex ratio,
- its own lifespan roll.

Offspring count per union therefore emerges from duration multiplied by
chance rather than being predetermined.

### Union end

A union ends when its duration expires or when either partner dies. Survivors
are released, receive the re-pair cooldown, and become eligible again if
still inside their fertility window.

### Death

Evaluated at year boundaries: an agent whose age has reached its lifespan is
removed. Old age is the only cause of death in this spec. There is no density
mortality and no resource mortality.

### Growth guardrail

Because growth is throttled only by biology and time, a configuration whose
mean offspring per union exceeds replacement grows without bound. A
configurable `maxAgents` cap therefore suppresses births rather than letting
the renderer degrade. Suppressed births are counted and surfaced in stats, so
it is always visible when a run hit the ceiling and its numbers stopped being
biologically meaningful.

### Configuration

Every parameter above — `unionChance`, fertility windows per gender, union
duration range, `birthChancePerYear`, sex ratio, lifespan parameters, speed
range, `agentRadius`, box dimensions, starting population, `maxAgents` — lives in a single
config object passed to `init` alongside the seed, and is emitted with any
run's results.

Changing configuration requires a reset. Mid-run parameter edits would break
reproducibility; that capability belongs in the game phase as an explicit
command, not as a settings edit.

## 5. Interface

### Canvas

The box fills the viewport at a fixed aspect ratio; world coordinates map to
pixels on resize, so the simulation never depends on window size. Agents draw
as small circles colored by gender. Bonded pairs draw with a connecting line.
An optional overlay tints agents by age (young to old) for reading population
aging at a glance.

The renderer reads only the latest snapshot. If the simulation outruns the
display during fast-forward, frames are skipped, never queued.

### Controls

Seconds-per-year slider, play/pause, step-one-year, fast-forward with a
"run to year N" input, reset, seed field, and a configuration editor for the
parameters in Section 4.

### Stats

The core records one sample per simulated year:

- total population
- count by gender
- births this year
- deaths this year
- active unions
- mean age
- age histogram buckets
- suppressed births

The panel shows current values plus a live population-over-time chart. The
full series exports as CSV in the same shape the CLI emits, so a watched run
and a swept run are directly comparable.

### Command seam

`command(cmd)` is the single entry point for anything that perturbs a running
simulation, and is the foundation for the game phase. `Command` is a
discriminated union so later interventions (a plague, a policy, a resource
shock) are added as new variants without reshaping the interface.

This spec implements exactly these core commands: `reset`, `runToYear`, and
`exportStats`. Speed and play/pause are worker-side concerns and are not core
commands. No speculative game commands are implemented.

## 6. Testing

The core being pure and seeded is what makes testing cheap.

**Unit tests:**

- PRNG streams: same seed produces the same sequence; adding a draw to one
  stream does not shift another.
- Lifespan sampling: bounds respected; per-gender means converge over many
  samples.
- Collision response: two known bodies produce known outgoing directions; no
  overlap remains after resolution; no tunneling at maximum speed.
- Union eligibility: every rule in the gate, tested for both accept and
  reject.
- Births and deaths at year boundaries.

**Golden-run tests:** a fixed seed and configuration run 200 years headlessly
through the CLI, asserting the exact final population and stats series. This
is the regression net — any accidental change to iteration order or rule
evaluation fails loudly.

**UI tests:** world-to-screen coordinate mapping only. Canvas pixel output is
not tested.

## 7. Failure modes

Designed for explicitly:

- **Population reaches zero.** The run ends cleanly, stats are preserved, and
  the interface reports extinction rather than appearing frozen.
- **Population reaches `maxAgents`.** Births are suppressed and counted, the
  run continues, and the condition is clearly flagged.
- **Fast-forward to a distant year.** Stepping is chunked with progress
  reporting so the worker stays responsive and the operation can be
  cancelled.
- **Invalid configuration.** Validated at `init` with a clear error, rather
  than a silent NaN propagating through the physics.
- **Worker crash.** The main thread reports the failure instead of leaving a
  stopped canvas on screen.
