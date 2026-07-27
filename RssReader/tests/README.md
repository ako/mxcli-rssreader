# End-to-end tests

Playwright scripts that drive the running app the way a user would — clicking
the sidebar, typing in the search box, tagging articles, adding a feed.

```bash
cd RssReader
./mxcli run --local -p RssReader.mpr --ensure-db      # in one terminal
node tests/e2e.mjs                                    # in another
```

| Script | Covers |
| --- | --- |
| `e2e.mjs` | the whole surface: smart views, source-tag chips, feed selection, search, open/read/star/save, tagging, add feed, manage sheet, shortcuts, mark-all-read, refresh, open original |
| `add-feed.mjs` | the add-feed wizard's failure paths — a non-feed URL, an unreachable host, a duplicate subscription — plus the happy path and entity decoding |
| `tagging.mjs` | attach, create-and-attach, detach, and the tag sheet's per-tag counts |
| `screenshots.mjs` | regenerates `docs/screenshots/` — stages read/starred/saved state, then captures the reader, the two add-feed outcomes, the manage sheet and the tag sheet |

## Regenerating the screenshots

`screenshots.mjs` serves IBM Plex from disk, because Chromium has no outbound
network here and the theme `@import`s it from Google Fonts. Fetch the files
first — `curl` *can* reach the network:

```bash
mkdir -p /tmp/feedline-fonts && cd /tmp/feedline-fonts
curl -sA 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0' \
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap' \
  -o fonts.css
for u in $(grep -o 'https://fonts.gstatic.com[^)]*' fonts.css | sort -u); do
  curl -s "$u" -o "$(basename "$u")"
done
```

Then `node tests/screenshots.mjs`. Captures are 2× and downsampled to 1600px
wide afterwards; without that the six files come to 3.6 MB instead of 812 KB.

## Two things to know before reading a failure

**The tests mutate real data.** They star, save, tag and mark articles read,
and `add-feed.mjs` subscribes to a feed. Re-running them against state left by
a previous run produces confusing failures — an article that already carries
the tag under test gets *un*-tagged, because the tag sheet toggles. Reset
first:

```bash
sudo -u postgres psql -d rssreader -c \
  "update feedline\$article set isread=false, isstarred=false, issaved=false;
   delete from feedline\$source where slug='custom';"
```

**The list pages at 20 rows.** Mendix's listview renders one page and a
`Load more` button, so a view with 115 articles shows 20. Assertions compare
against `min(total, 20)`, not the sidebar count.

## Browser

The image ships Chromium at `/opt/pw-browsers/chromium-1194`, which is older
than the build the installed `playwright` package expects, so each script
passes `executablePath` explicitly rather than calling `playwright install`.

`Open original` hands off to `NanoflowCommons.OpenURL`, which replaces the
current tab. Most article hosts are unreachable from a sandboxed container, so
`e2e.mjs` intercepts the outbound navigation and asserts on the URL that was
requested instead of waiting for a page that will never load.
