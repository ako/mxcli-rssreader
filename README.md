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
  theme/web/_feedline.scss  the design's tokens and components
  RssReader.mpr             the model (MPR v2, sources in mprcontents/)
scripts/setup-tools.sh      toolchain bootstrap (see TOOLING.md)
MXCLI-FINDINGS.md           bugs and improvement notes from building this app
```

The `mdl/` scripts are the readable source of the app; the `.mpr` is what they
produce. Re-running them in order against a blank project rebuilds it.

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
- **Refresh does not fetch.** There is no feed fetcher yet; `ACT_RefreshFeeds`
  stamps the "last refresh" label and reports what a fetch would have found.
  Refresh is manual-only in the design, so the interaction shape is right.
- **"Open original" opens the shortcuts sheet** — articles carry no source URL
  of their own yet.
- **IBM Plex is imported from Google Fonts**, which the sandbox blocks, so
  screenshots taken here fall back to system fonts. Colour and layout are
  unaffected.
