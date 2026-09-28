# DESIGN.md

Direction for the Am-I-Online status page. This file is the source of truth for how the page
looks and feels. `antislop` is applied as the filter on top of it.

## Direction source

`awesome-design-md/framer/DESIGN.md`: a near-black artboard (`#090909`, warm rather than pure
black), a monochrome chrome ladder (`#141414` / `#1c1c1c`), and white display type with tight
negative tracking. Framer's own palette leans on gradient fills and a signal blue; **this page
uses neither**, see the notes below.

## Design Read

> Reading this as: a personal monitoring status board for its own owner, on a Framer near-black
> artboard, monochrome with a neutral spotlight fallback, dial ENERGY 1 / RHYTHM 1 / MOTION 2.

| Dial | Value | Why |
| --- | --- | --- |
| ENERGY | 1 (calm) | The page is glanced at, not read. It should sit quietly in a corner. |
| RHYTHM | 1 (uniform) | There is one card. Inventing varied sections would be structure without content. |
| MOTION | 2 (purposeful motion) | Raised from 1 at the owner's request. Every motion has one job: show that something changed. Loops are limited to live states, all owner-approved. |

## No gradients, no glow, no accent colour

Four owner passes shaped this:

1. Framer's gradient cards were used literally at first: a violet-to-magenta ramp, a three-colour
   hairline across the card top, and two coloured glows. That violated antislop **R-01** (no
   blue-purple gradients, coloured glow backgrounds, or radial orbs as defaults) and **R-13**
   (glow capped at one or two focus accents). All of it was removed.
2. The replacement accent was Klein blue. The owner found it too dark, and asked that the
   fallback tile's background not carry a colour at all.
3. The tile went neutral but was still given a light, drawn as a radial gradient. The owner
   pointed out that a radial gradient is a gradient, not a spotlight.
4. The tile is now a flat solid fill. Framer's own spotlight card is a solid tile, so this is the
   closer reading of that reference anyway.

| Element | Treatment | Why it is allowed |
| --- | --- | --- |
| Album art / app icon fallback tile | Flat neutral fill (`#2b2b2b` dark, `#e9e7ec` light) with the monogram centered | The slot would otherwise be empty or look broken. It introduces no colour and no gradient. |
| Card top edge | None | The coloured hairline was decoration and is gone. |
| Card background | Flat surface | The coloured glows are gone. |

Colour is now reserved for status only:

- chrome, borders, and all body copy stay on the neutral ladder
- **active** is one green: the online mark, the playback progress fill, and the playing equalizer
- the error state uses coral
- focus uses ink, so there is no second blue

Everything chromatic on the page therefore means something. The page contains **zero gradient
declarations of any kind**: no `linear-gradient`, no `radial-gradient`.

Two deviations from Framer, both deliberate and recorded:

- Framer ships dark only. This board keeps a light theme because a status page may be read in a
  bright room, and the owner asked for a theme toggle earlier. The light theme uses off-white
  (`#f2f1f4` canvas, `#fbfafd` card) rather than pure white, and off-black ink, so neither theme
  uses the pure extremes the owner disliked.
- Framer pairs its gradient family with a signal blue. Both are dropped here: the owner asked for
  a calm, non-coloured page, and colour now appears only where it carries state.

## Structural decision

The page has one job: answer "am I online, and what is playing" in one look. So it is one card,
centered on both axes, with one focal point (the device pane). There is no navbar, no hero, no
feature grid, no footer columns, because none of that content exists.

## Palette

Dark is the default. Reason: this is an ambient monitoring surface for a developer, and dark
keeps it quiet in peripheral vision. A working light theme is shipped alongside it.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| canvas | `#090909` | `#f2f1f4` | Page background |
| surface | `#141414` | `#fbfafd` | The card |
| surface raised | `#1c1c1c` | `#f0eff3` | Icon tile, theme toggle fill |
| hairline | `#262626` | `#e2e1e7` | Card edge |
| hairline soft | `#1a1a1a` | `#eceaf1` | Inner dividers |
| ink | `#ffffff` | `#14131a` | Primary text |
| muted | `#999999` | `#5f5d68` | Secondary and meta text |
| online | `#22c55e` | `#0f7a3d` | Online mark |
| offline | `#6e6e6e` | `#7d7b86` | Offline mark |
| danger | `#ff5577` | `#c0264a` | Error state |
| tile fill | `#2b2b2b` | `#e9e7ec` | Fallback tile background |
| tile ink | `#f0f0f0` | `#1a1a1a` | Fallback tile monogram |
| tile border | `transparent` | `#d6d3db` | Fallback tile edge |
| focus | `#ffffff` | `#14131a` | Keyboard focus (ink, so there is no second blue) |

The fallback tile is fully theme-driven and neutral. The monogram changes color with the theme
rather than staying fixed.

Neither theme uses a pure extreme. The dark canvas is `#090909` rather than `#000000`, and the
light canvas is `#f2f1f4` rather than `#ffffff`, which was the owner's specific complaint about
the previous palette.

Colour now has exactly one job: **state**. Chrome, borders, body copy, and the fallback tile are
all on the neutral ladder. Green means up, coral means error, and nothing else is chromatic.
There is no accent colour, which makes every coloured pixel on the page meaningful.

Contrast was computed with `antislop-human/contrast-check.py`, not by eye:

| Pairing | Ratio | Note |
| --- | --- | --- |
| ink on card | 18.42:1 | |
| muted on card | 6.47:1 | Lowest body copy pairing |
| green on card | 8.08:1 | Online mark, progress, equalizer |
| coral on card | 5.98:1 | Error state |
| ink focus ring on card | 18.42:1 | |
| tile monogram on the tile | 12.42:1 | Fallback monogram (dark) |
| tile monogram on the tile (light) | 14.18:1 | Fallback monogram (light) |
| unsung lyric word on card | 6.55:1 | Lyric dim state (dark) |
| unsung lyric word on card (light) | 5.20:1 | Lyric dim state (light) |
| muted on card (light) | 6.21:1 | |
| green on card (light) | 5.22:1 | |

The tile is a flat fill and the monogram sits on one solid colour, so there is no gradient stop to
check.

## Typography

System UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Reason: this page
is served from a NAS on a LAN and must render instantly with no external font request; a native
font also matches the host OS, which suits a machine-status board.

Sizes: title 22px/700 at -0.8px tracking (Framer's headline token), body 15px/400, secondary
13px/400, meta 12px/400. Tracking stays tight on the title and near zero on body copy. No
uppercase labels with wide tracking.

## Shape and space

Radii follow Framer's scale: 20px for the card, 15px for artwork tiles, 10px for the app icon,
full circles for the status marks and the theme toggle. Status marks are circles because a round
lamp reads as a state where a square reads as a badge. Spacing scale: 4, 8, 12, 16, 24, 32.

## Motion

MOTION dial is 2. Each motion answers "what did the user just learn?" and nothing is animated
without a change behind it.

| Motion | Trigger | Purpose |
| --- | --- | --- |
| Board scales and fades in | Page load | Confirms the board arrived, once. Scale, not translate, so the entrance adds no scrollable area. |
| Pane width eases to half | A second device joins | Shows the first device compressing and the new one taking the right half, so the change is spatial, not a jump. |
| Pane eases back to full width | A device leaves | Mirrors the join, so the layout change reads as the same event in reverse. |
| New pane rises and fades, with a single green wash | A device joins | Marks which device changed. The wash is one-shot, never a loop. |
| Pane content arrives in sequence | A device joins | Title, then detail, then art, so the pane resolves instead of popping as one block. |
| Status ring expands once | A device or the board flips to online | Draws the eye to the exact thing that changed. One-shot; stops. |
| Status text and mark color ease | Online / offline flip | Shows the state changed rather than replacing text silently. |
| Live mark breathes | While a device is online | Loop, owner-approved: reads as "this is live". Subtle scale and opacity only. |
| Equalizer bars | While audio is playing | Loop, owner-approved: the one place movement carries real information. |
| Album art and app icon scale in | Art or icon loads | Avoids a blank tile flashing before the image. |
| Lyric sweep eases between clock samples | While a lyric line is being sung | The word level sweep would otherwise step every 120ms. |
| A new lyric line eases in | The current line changes | Shows the line advanced rather than swapping text silently. |
| Progress fill eases forward | Playback advances | Makes the bar read as time passing. |
| Sun or moon turns | Theme toggle | Confirms which way the theme went. |
| Theme colors ease | Theme toggle | Lets the eye follow the theme change across the card. |

Owner override, recorded per R-37: the antislop core caps motion and rejects endless loops
(R-19). The owner asked for more motion several times, so MOTION is 2 and the loops above are
kept. They are limited to true live states and they are the only loops on the page. Everything
else is a one-shot transition tied to a state change.
`prefers-reduced-motion: reduce` removes all of it.

Animation must never add a scrollbar. The card uses `overflow: clip`, and no animated transform
translates an element outside its own box in a way that grows the page.

## States

Every data view ships three states, each naming its cause and the next action:

- Loading: "Connecting to the server". The card is marked `aria-busy`.
- Empty: "No devices connected yet" plus what to start.
- Error: "Cannot reach the server", the URL, plus what to check.
- Per device: online, offline ("Nothing Playing"), and online-with-no-track ("No music playing").

State is never colour alone: every indicator is paired with a text label.

## Lyrics

The PC pane shows the song, so it should also show where you are in it. The board reads
`GET http://127.0.0.1:32109/v1/lyric` on the Folia machine, which returns every line with its own
word timings, so the page can light up the exact word being sung.

Layout: the current line is large and heavy, one line above and one below sit small and muted
for context, and the translation appears under the current line only.

The highlight is a **continuous sweep**, not a per-word colour flip. The current line is drawn
twice, once dim and once in ink, and the ink copy is clipped from the right, so the boundary
travels across the line and is interpolated inside the word being sung. Clipping a solid colour
was chosen over a `background-clip: text` gradient so the page still contains zero gradient
functions. A 150ms transition eases the boundary between clock samples, and a new line eases in
over 260ms.

Three decisions worth recording:

- **Both lyric states are readable.** The lit and unlit words are both text above 4.5:1, so the
  highlight reads as progress through the line rather than as the only way to read it. A
  karaoke treatment that dims unsung words below the contrast bar would fail R-25.
- **Nothing is sent twice.** Lyrics change only when the track changes, so the agent sends them
  once per revision and the server keeps the last copy between heartbeats. A heartbeat is about
  80 bytes whether or not there are lyrics.
- **The clock is local.** The server is polled every few seconds, which is too coarse for a word
  level sweep, so the page extrapolates between polls from the last position, the sample time and
  the play state. This also advances the progress bar continuously instead of stepping.

If the Lyric API is off, or the track has no lyrics, the pane simply shows no lyric block. The
rest of the card is unaffected.

## Accessibility

The theme toggle is a real button with a 44px target, a visible `:focus-visible` ring, and
`aria-pressed`. Status changes are announced through `aria-live="polite"`. Both themes were
verified, and text survives 200% zoom without clipping.
