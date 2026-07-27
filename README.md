# mxcli-rssreader

**Feedline** — an RSS reader built as a Mendix app from a Claude Design
prototype, authored entirely in MDL through
[`mxcli`](https://github.com/ako/mxcli).

The design handoff (`RSS Reader.dc.html`) is a dark, three-pane reading client:
a sidebar of source-tag chips, smart views and feeds; a middle article list; and
a serif reading pane — plus four overlays (tag sheet, add-feed wizard, manage
feeds, keyboard shortcuts).

| | |
|---|---|
| Mendix version | 11.12.1 |
| App module | `Feedline` |
| Project | `RssReader/RssReader.mpr` |
| Validation | `mx check` — 0 errors |

## Layout

```
RssReader/
  mdl/                      the MDL that builds the app — this is the source
    01-domain-model.mdl     entities, enum, associations
    02-seed-data.mdl        the 10 feeds / 5 tags / 12 articles from the design
    03-logic.mdl            counters, filtered datasources, every state action
    04-view-wrappers.mdl    per-view wrappers + the add-feed wizard steps
    05-pages.mdl            Reader + the four popup sheets
    06-navigation.mdl       home microflow, after-startup hook, database config
    07-fetch-schema.mdl     Article.Link + per-feed fetch status
    08-fetch-text.mdl       XML/entity/date helpers for the parser
    09-fetch-feeds.mdl      the REST fetch, the RSS/Atom walk, dedupe
    10-open-original.mdl    Open original + the Last fetch column
  theme/web/_feedline.scss  the design's tokens and components
  RssReader.mpr             the model (MPR v2, sources in mprcontents/)
scripts/setup-tools.sh      toolchain bootstrap (see TOOLING.md)
MXCLI-FINDINGS.md           bugs and improvement notes from building this app
```

The `mdl/` scripts are the readable source of the app; the `.mpr` is what they
produce. Re-running them in order against a blank project rebuilds it.

Scripts 02–10 are idempotent and safe to re-run against an existing project.
`01-domain-model.mdl` is not, deliberately — see the note at the top of that
file: making it idempotent with `create or modify` destroys the data in every
column (MXCLI-FINDINGS.md #13). Evolve the model with `alter entity` instead.

## Running it

The `SessionStart` hook installs the toolchain (see [TOOLING.md](TOOLING.md)).
Then:

```bash
cd RssReader
./mxcli run --local -p RssReader.mpr --ensure-db
```

`--ensure-db` starts the local PostgreSQL and provisions the `rssreader`
database; the after-startup microflow seeds the demo dataset on first boot. The
app serves at <http://127.0.0.1:8080/>.

To change the model, edit the relevant `mdl/*.mdl` file and re-run it:

```bash
./mxcli check mdl/05-pages.mdl -p RssReader.mpr --references
./mxcli exec  mdl/05-pages.mdl -p RssReader.mpr
~/.mxcli/mxbuild/11.12.1/modeler/mx check RssReader.mpr
```

## Fetching real feeds

**Refresh actually fetches.** `ACT_RefreshFeeds` walks the ten seeded feeds and
for each one:

1. `rest call get` the feed URL, `returns response` so the status code is known,
   with one retry on a connection-level failure.
2. Detect RSS (`<item>`) or Atom (`<entry>`) and walk up to 15 items.
3. Pull title, link, summary and date, handling both dialects — RSS puts the URL
   in `<link>`'s text and the date in `<pubDate>`; Atom uses `<link href="…"/>`
   and `<updated>`/`<published>`.
4. Strip CDATA, tags and entities; estimate word count and reading time.
5. Create the article unless its `Link` is already known — so refreshing
   repeatedly is idempotent.

The parsing is plain MDL string functions (`find`, `substring`, `replaceAll`) in
a `while` loop over the raw body. No Java action, no import mapping, and no XSD —
which is deliberate: a schema-driven parser would not survive the malformed
feeds that make up much of the real web.

Per-feed outcomes are recorded on `Source.LastFetchStatus` and shown in the
**Last fetch** column of Manage feeds & tags, so a failure is visible in the UI
rather than silent. A typical run in this sandbox:

```
10 feeds checked · 85 new articles · 4 failed
```

Six feeds fetch reliably (Hacker News, Mendix, Smashing, CSS-Tricks,
Stratechery, TechCrunch). Of the four failures, one is by design — Low-Code
Weekly's domain is fictional, invented for the prototype, and it usefully
exercises the error path. The other three (The Verge, Ars Technica, NRC) fail
with connection errors **specific to this sandbox**: `curl` reaches all of them
from the same container with identical headers, the egress proxy logs no denial,
and the same feed sometimes succeeds. They should work in a normal network.

## Domain model

```
SourceTag ──many-to-many── Source ──1:many── Article ──many-to-many── Tag
                                                 │
                                          ReaderView (non-persistent screen state)
```

`ReaderView` holds what the prototype kept in React state — the selected view,
the search box, the active article and the sidebar filter — and is the Reader
page's parameter, so every action is "change the view, refresh the labels,
re-run the datasource".

Unread and tagged counts are denormalised onto `Source`/`Tag` and recalculated
by `ACT_RecalculateCounts`, so sidebar rows bind an attribute instead of needing
an aggregate each.

## Known gaps against the prototype

- **Keyboard shortcuts are documented, not bound.** Mendix has no page-level key
  handler; the shortcuts sheet lists the map and every shortcut has a button.
- **Search runs on the `/` button, not on each keystroke.** mxcli does not
  persist a textbox `onchange`, and it drops `placeholder` — so the field has no
  placeholder text.
- **"Open original" shows the URL in the toast instead of opening it.** The
  right implementation is a nanoflow calling NanoflowCommons' `OpenURL`
  JavaScript action, but mxcli persists `call javascript action` as an empty
  activity (MXCLI-FINDINGS.md #11), so the model would not build. The link
  itself is real — fetched, stored, and used as the dedupe key.
- **Fetching is manual only.** Refresh is a button, as in the design; there is
  no scheduled event. Adding one is a few lines if wanted.
- **IBM Plex is imported from Google Fonts**, which the sandbox blocks, so
  screenshots taken here fall back to system fonts. Colour and layout are
  unaffected.
