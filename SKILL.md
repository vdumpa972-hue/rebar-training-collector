# Rebar Foundation Extraction Skill v0.1

Goal: read a foundation plan PDF/image and output structured rebar data for the Rebar Training Data Collector and the production rebar app.

## Output principles
- Extract only what is visible in the plan/spec text or drawing callouts.
- Keep separate rows for different wall/location lengths, for example side wall vs end wall.
- Use crop references for visual evidence when the value comes from a drawing detail.
- Use notes when a value is tied to a specific wall, side, end, pier type, vent area, or exception.
- Do not guess missing structural information. Mark it as missing or needs review.

## Key fields
### Foundation shape
- segment: wall/side/end name
- length: real plan length
- turn: wall turn angle/order

### Base mat / footing bars
- numContinuous
- continuousSpacing
- transverseSpacing
- crop reference

### Horizontal continuous wall bars
Create one row per different wall condition.
- horizontalNote: wall/location note, such as side wall, end wall, long wall, short wall, left/right
- length: length of that wall or run
- numHorizontalBars: count of continuous horizontal bars
- horizontalSpacing: vertical spacing between them when shown
- crop reference

### Piers
- numPiers
- diameter
- length/height/depth
- numHorizontalBars, if hoops/ties are specified
- numVerticalBars
- crop reference

### Vents
- x/y location or spacing
- xSpaceFromRebar/ySpaceFromRebar when shown
- crop reference

## Review rules
- If multiple rows share one crop, reference the same crop.
- If the drawing shows different side/end wall heights or lengths, do not combine them.
- If text conflicts with drawing, record both and flag in notes.
