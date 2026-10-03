# How the Original Fishing Minigame Actually Works

Reference notes for the Neon River remaster. Summarized (not copied) from the
community decompilation of *Jak and Daxter: The Precursor Legacy* (2001) by the
OpenGOAL project — `goal_src/jak1/levels/jungle/fisher.gc` in
github.com/open-goal/jak-project — plus the Jak and Daxter wiki.

Use this for **mechanics and pacing only**. Neon River must not ship any Jak and
Daxter names, characters, dialogue, audio, or art. Homage lives in the feel.

---

## 1. The big insight: fish come from ONE moving emitter

Neon River v1 gives every fish its own lateral drift and bounces it off the
river edges. That makes the screen noisy and hard to read.

The original does something simpler and much better:

- A single **emitter** sits at the top of the river at a lateral position
  `spawner ∈ [0, 1]` (0 = left bank, 1 = right bank).
- The emitter **sweeps** sideways at velocity `vel` (river-widths per second).
- It **reverses** direction when it hits a bank, and also after a random
  **swing time** drawn from `[swing-min, swing-max]` seconds.
- Every `period` seconds a fish is spawned **at the emitter's current lane**.
- Each fish then travels straight down the river path at speed `fish-vel`,
  **keeping its lane** (no drift).

Result: the stream of fish forms a visible **serpentine chain** that the player
reads ahead of time and traces with the net. Slow `vel` = a lazy S-curve. Fast
`vel` = a zigzag the player cannot fully follow, so they must choose which fish
to chase. That choice is the skill.

### Fairness rule (keep this)
When a *non-eel* fish would spawn more than **0.8 river-widths** away from the
previous spawn, it is pulled to the **midpoint** of the two lanes. Eels are
exempt, so they can appear anywhere — which is what makes them threatening.

### Pinned-bank mode
A special phase setting pins the emitter to the far left or far right bank
instead of sweeping. Alternating pinned phases produce "left bank! right bank!"
lines of fish — the source of the "alternating banks" behaviour players remember.

## 2. Phases ("blocks") — the run is a script, not a slope

The run is an ordered list of phases. Each phase has a duration (`timeout`) and
its own emitter settings. Between every phase is a **2-second rest** with no
spawns. Phase fields:

| Field | Meaning |
| --- | --- |
| timeout | phase length in seconds |
| vel | emitter sweep speed (river-widths/s) |
| swing-min / swing-max | random time before the emitter reverses |
| period | seconds between spawns |
| fish-vel | fish travel speed down the path |
| bad-percent | chance a spawn is an eel |
| powerup-percent | chance a spawn is a 5-lb fish (rolled first) |

### Default difficulty table (first attempt)

| # | Length | Sweep vel | Period | Fish speed | Eel % | 5-lb % | Character |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.5 s | 0.6 | 0.5 | 1.5 | 0 | 0 | warm-up blip |
| 1 | 10 s | 0.6 | 0.6 | 1.5 | 0 | 10 | calm weave, teaches tracing |
| 2 | 8 s | **3.0** | 0.6 | 1.6 | **50** | **25** | first zigzag + eels + big fish: risk/reward |
| 3 | 15 s | 0.6 | 0.45 | 1.7 | 10 | 10 | denser weave |
| 4 | 15 s | 3.0 | 0.40 | 1.8 | 10 | 10 | dense zigzag |
| 5 | 15 s | 3.0 | 0.50 | 1.9 | **90** | 10 | **eel swarm** |
| 6 | until done | 0.8 | 0.35 | 2.0 | 10 | 10 | fastest, densest final stretch |

(2-second rests between every row.)

Observations worth stealing:
- Difficulty moves on **several independent axes** (sweep speed, density, fish
  speed, eel share, reward share) and they are **mixed**, not all raised at once.
  A phase that is hard on one axis is often generous on another (phase 2: brutal
  eels, but a quarter of the fish are worth 5 lb).
- Fish speed only ramps from 1.5 → 2.0 (+33%) across the whole run. Most of the
  felt difficulty comes from sweep speed, density, and eel share.
- There are about **five clearly different phases** in a ~2-minute run, with a
  breath between each.

### Gentler tables after failing
The data contains five more tables. Tables 1–3 are progressively *gentler*
versions of table 0 (longer periods, slower fish, fewer eels). Table 4 is the
gentlest and inserts several 3-second **pinned-bank 5-lb bonanzas**. Table 5 is
the hidden endless **"hard fish"** mode (period down to 0.15 s, fish speed 2.2).
The wiki describes the difficulty as changing with repeated failures; the data
reads like a quiet mercy system. Treat it as: *each loss can make the next
attempt slightly kinder*, as an opt-out assist.

Hard mode was unlocked by entering Left, Left, Right, Right, Left, Left, Right,
Right, then the action button, after beating the game once.

## 3. The net (paddle)

- 1-D position `paddle ∈ [0, 1]` across the river.
- Analog stick adds **acceleration** to a paddle velocity; velocity decays
  toward 0 (strong damping), and is **capped at 2.0 widths/s**.
- Key consequence: during `vel = 3.0` phases the emitter outruns the net.
  Missing some fish is **designed in** — the 20-lb miss budget is the buffer.

## 4. Catching

- Catch test is a **circle**: distance in the water plane between fish and net
  < `net-radius + fish size × scale`. Not an AABB.
- On catch the fish's speed drops to ¼, it is pulled to the net's lane, and it
  shrinks ~7% per frame into the net — a quick, readable "scoop".
- 1 lb normal fish, 5 lb big fish. Eel caught = run fails immediately.
- Fish that reach the end of the path count as missed (eels don't).
- Win at **200 lb caught**, lose at **20 lb missed**.

## 5. Feedback and personality

- A soft "fish spawn" sound plays on **every** spawn — an audio metronome that
  helps the player read rhythm.
- Distinct sounds for small catch, big catch, eel catch, and miss.
- The fisherman comments at contextual moments, each rate-limited (≥10 s apart):
  a big fish spawned (≥30 s apart), the player is close to winning (within
  30 lb), the player is steady, the player is slipping (within 6 lb of failing).

## 6. What Neon River v1 does differently today

| Topic | v1 (current) | Original |
| --- | --- | --- |
| Lanes | each fish drifts and bounces | fish hold the lane they spawned in |
| Spawn source | 3–5 fish sweeps that reverse | continuously sweeping emitter, random swing reversals |
| Ramp | speed/spawn tiers by caught weight | scripted phases with rests and mixed axes |
| Net | per-frame lerp toward pointer (frame-rate dependent) | velocity + damping + speed cap |
| Collision | AABB | circle |
| Touch | absolute finger X (finger covers net) | n/a (analog stick) |
| Eel fairness | 1.8 s min gap | eels exempt from smoothing; swarm phases |

The remaster should adopt the emitter + lanes + phases model, keep v1's eel
spacing idea as an extra fairness guard, and fix the input issues.
