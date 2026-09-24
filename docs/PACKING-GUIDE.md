# Template ZIP packing guide

Carousel Studio accepts client-private or shared template ZIPs. Uploads are staged and validated before installation; incomplete packs are not visible to projects.

## Option A — five individual slide references

Put exactly five PNG/JPEG/WebP files in the ZIP. If there are exactly five images and no manifest, the importer proposes filename order. If there are more than five, the UI asks you to map five files explicitly.

For repeatable naming and versions, add `pack.json`:

```json
{
  "schemaVersion": 1,
  "id": "salon-elegant",
  "version": "1.0.0",
  "name": "Salon Elegant",
  "businessTypes": ["salon"],
  "templates": [{
    "id": "service-story",
    "name": "Service Story",
    "mode": "slides",
    "slideCount": 5,
    "aspectRatio": "4:5",
    "slides": [
      {"position": 1, "image": "01.png"},
      {"position": 2, "image": "02.png"},
      {"position": 3, "image": "03.png"},
      {"position": 4, "image": "04.png"},
      {"position": 5, "image": "05.png"}
    ]
  }]
}
```

## Option B — one master board

A master-board template needs one image and five normalized crop rectangles. Each rectangle uses values from 0 to 1 and must stay fully inside the image.

```json
{
  "schemaVersion": 1,
  "id": "construction-board",
  "version": "1.0.0",
  "name": "Construction Board",
  "businessTypes": ["construction"],
  "templates": [{
    "id": "project-story",
    "name": "Project Story",
    "mode": "board",
    "image": "board.png",
    "crops": [
      {"x":0.00,"y":0.10,"width":0.19,"height":0.75},
      {"x":0.20,"y":0.10,"width":0.19,"height":0.75},
      {"x":0.40,"y":0.10,"width":0.19,"height":0.75},
      {"x":0.60,"y":0.10,"width":0.19,"height":0.75},
      {"x":0.80,"y":0.10,"width":0.19,"height":0.75}
    ]
  }]
}
```

## Safety and versioning

- STORE and DEFLATE ZIP compression are supported.
- Absolute paths, traversal, symlinks, encrypted entries, duplicate normalized paths, unsupported compression and invalid image signatures are rejected.
- Limits are configurable through the environment variables documented in `.env.example`.
- Re-importing identical content is idempotent.
- If the same template identity/version contains different bytes or mappings, use a new version or pack ID instead of overwriting the old version.
- A manifest cannot grant itself shared scope. Scope is chosen by the user at installation time.
