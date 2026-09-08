# Brand assets

## Which file to upload

For the BUIDL submission logo field (JPEG or PNG, under 2 MB, 480 × 480
recommended):

**`sequence-logo-480.png`** — 480 × 480, 12 KB.

`sequence-logo-960.png` is the same mark at 2x for anywhere that wants a larger
raster. `logo.svg` is the source.

## The mark

Two dots and an arrow: the cyan dot is the market a sequence is watching, the
violet one is the follow-on trade it triggers, and the arrow between them is the
rule that carries one into the other. It is the same pair of dots as the app's
favicon and nav mark, with the relationship between them made explicit — at
favicon size the arrow would not survive, so it is dropped there.

The arrow deliberately stops short of the second dot. Overlapping it hid the
head at tile size and the whole thing read as two blobs touching.

| | |
| --- | --- |
| Watched market | `#50D6ED` |
| Follow-on trade | `#9B7BFF` |
| Rule | `#4B4650` |
| Ground | `#FFFFFF`, `#ECE9EF` hairline |

## Re-rendering

`render.html` points at `logo.svg`; screenshot it at 480 × 480 to regenerate the
PNGs. Editing the SVG and re-rendering is preferred over editing a PNG.
