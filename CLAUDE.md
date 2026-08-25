# fd-logbook-class — facts for any session working in this repo

Student-facing tools for the diabetes data course. Everything here is handed to people
who are **not developers**: no terminal, no installs, no accounts to create.

## Hard rules

- **This repo is separate from `~/fd-logbook` and must stay that way.** That is Chris's
  own pipeline, running his real health data daily. Never edit a file there to serve
  something here — not even additively, not even when the change is backward-compatible.
  If a student feature seems to need a change over there, copy the logic into this repo
  instead and say so. A prior session was told this directly: "I don't want you touching
  MY importer, we are creating separate files for students."
- **FACTS ONLY in anything a student sees.** No interpretation of health data, and never
  a dose recommendation. Same rule as the main project.
- **Never delete a file.** Move it to
  `~/Desktop/Project - Baseline App - Active Working Files/To Delete/` and say where it went.
- **The page's wording is Chris's.** He edits the copy himself and does not want it
  rewritten. Propose wording in chat; change the file only when asked. He has had work
  overwritten here once already — see "Do not regenerate the page" below.

## What is in here

- **`clarity-history.html`** — the whole student handout, one self-contained file. A
  student opens it, drags the button to their bookmarks bar, and clicks it while logged
  in to Dexcom Clarity. Nothing is installed. This file is what gets distributed.
- **`src/get-history.js`** — the bookmark's code as readable JavaScript. **Source of
  truth for the tool's behavior.**
- **`tests/history-test.mjs`** — runs the real code in a fake browser against a fake
  Clarity. See "Testing" below.

### The page and the code are joined by hand, deliberately

A bookmark can only be one long percent-encoded line, so `src/get-history.js` is encoded
into the button's `href` inside `clarity-history.html`. To ship a code change:

```
node -e "const fs=require('fs');const js=fs.readFileSync('src/get-history.js','utf8').trim();
const p='clarity-history.html';const s=fs.readFileSync(p,'utf8');
fs.writeFileSync(p,s.replace(/href=\"javascript:[^\"]*\"/,'href=\"javascript:'+encodeURIComponent(js)+'\"'));"
```

**Do not regenerate the page from a template.** There WAS a `build.mjs` + `src/page.html`
template; it overwrote an hour of Chris's copy edits, because his words were in the built
file while the template still held an older draft. Both were retired 2026-08-25. Replace
the one `href` and leave every other byte of the page alone.

## How the tool works (all of this was proven against live Clarity on 2026-08-25)

- **It runs as a bookmarklet on `clarity.dexcom.com`.** Clarity does not block it.
- **The login is readable from the page** — a JWT in `localStorage` under
  `clarity_externalSession`.
- **The subject number is inside that token**, as `subjectId`. It is NOT in the URL and
  NOT in obvious storage keys; an earlier attempt to find it by watching network traffic
  came back empty. Decode the token instead.
- **The export REQUIRES the name fields.** `POST /api/subject/<id>/export` with just
  `locale, units, dateInterval, accessToken, submitExport` returns **HTTP 400
  RequestValidationError**. Adding `firstName` + `lastName` (also from the token, as
  `given_name` / `family_name`) returns **HTTP 200** and a real CSV. This was the single
  blocking discovery; do not "simplify" those fields away.
- **Clarity caps one export at 90 days**, which is the whole reason this walk exists.

### The backward walk

Starts at today and requests `[anchor − 90d, anchor + 2d]`, imports, then moves the anchor
to the oldest reading it just got. The 2-day overlap covers the seam; duplicates are
dropped on the raw row contents, so no conversion is involved and nothing can drift.

**A stretch that comes back empty does NOT end the walk.** A spell without a sensor looks
exactly like the end of the record. So an empty stretch steps the anchor back a full 90
days and keeps going, and only `DRY_LIMIT` (4) empty stretches in a row — a year of
silence — ends it. This matters: before that change, a student who stopped wearing a
sensor for a few months lost everything older than the gap, and a student whose newest
reading was over 90 days old got nothing at all.

A 40-stretch cap (~10 years) exists so a bug can never loop forever.

### What the student gets

One CSV in Downloads, named `clarity-history-<date>-<Timezone>.csv`. Rows from every
stretch, de-duplicated, sorted oldest to newest, index renumbered. Clarity's own untimed
metadata rows are kept once rather than once per stretch.

**Timestamps are Clarity's, completely unaltered** — naive local times, no conversion.
The student's timezone is added in two places (the filename, and a `Timezone` metadata row
inside the file) purely so the times can't be misread later. That row carries no timestamp,
so any importer skips it the way it already skips Clarity's `FirstName` / `Device` rows.

**The file stays with the student.** It is not sent anywhere and Chris does not collect or
convert student data — he said so plainly: "I am not going to convert every student's
data." Don't add copy telling students to send their file somewhere.

## Testing

`tests/history-test.mjs` runs the actual `src/get-history.js` in a stub browser with a
stub Clarity, so the walk, the merge, the de-duplication and the download are all exercised
without touching Dexcom. Scenarios:

```
node tests/history-test.mjs                                     # ordinary record
HISTORY_DAYS=600 GAP_FROM=400 GAP_TO=150 node tests/history-test.mjs   # 250-day sensor gap
HISTORY_DAYS=400 ENDS_DAYS_AGO=200 node tests/history-test.mjs         # newest reading 200 days old
HISTORY_DAYS=700 ENDS_DAYS_AGO=500 node tests/history-test.mjs         # nothing for 500 days
```

Run all four after any change to the walk. Needs Node 24+ (nothing installed).

## Still open

- Where students actually get this page. Right now it is a file. Hosting it (GitHub Pages
  or similar) has not been decided — do not assume it, and do not rename the page to
  `index.html` on that assumption. A previous session did and was told off for it.
- Whether this repo grows to cover the course's other data sources (InPen, WHOOP,
  nutrition, weight) or stays just the Clarity handout. Undecided. The schema is what makes
  a student's imports agree with each other, so that decision comes before writing more.
