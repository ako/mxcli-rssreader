# Tooling

This repository is a Mendix-app development workspace driven by
[`mxcli`](https://github.com/ako/mxcli) and MDL (Mendix Definition Language).

**No Mendix app has been scaffolded yet** — this commit establishes the toolchain
and the automation that re-establishes it. See
[Scaffolding the Mendix project](#scaffolding-the-mendix-project) for the single
command that creates the app.

## Why this exists

The dev container is ephemeral: it is reclaimed after a period of inactivity and
recreated from a fresh clone of this repository. Anything installed by hand is
gone by the next session. `scripts/setup-tools.sh` is therefore the source of
truth for the toolchain, and a `SessionStart` hook runs it automatically so every
new session comes up with the same tools at the same versions.

## Installed versions

Verified on 2026-07-26.

| Tool | Version | Location | Provenance |
| --- | --- | --- | --- |
| **mxcli** | `8db91bc` | `/usr/local/bin/mxcli` | built from source |
| **MxBuild + `mx` validator** | 11.12.1 | `~/.mxcli/mxbuild/11.12.1/modeler/` | `mxcli setup mxbuild` |
| **Mendix runtime** | 11.12.1 | `~/.mxcli/runtime/11.12.1/` | `mxcli setup mxruntime` |
| **ANTLR** | 4.13.1 (pinned) | `/opt/antlr/antlr-4.13.1-complete.jar` | antlr.org download |
| **Go** | go1.24.7 (+ 1.26 toolchain on demand) | system | pre-installed |
| **JDK** | OpenJDK 21.0.10 | system | pre-installed |
| **Node.js** | v22.22.2 | system | pre-installed |
| **PostgreSQL** | 16.13 | `/usr/lib/postgresql/16/bin` | pre-installed (`postgresql-16`) |
| **Chromium (Playwright)** | build 1194 | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | pre-installed |

### Pinned mxcli commit

```
repo:   https://github.com/ako/mxcli.git
branch: main
commit: 8db91bc99a891133b844bc2d8e71d7117e5d7edb
short:  8db91bc
subject: Merge pull request #36 from ako/feature/typed-design-properties
date:   2026-07-25
```

`scripts/setup-tools.sh` builds `main` HEAD by default, so a future session may
pick up a newer commit. To reproduce exactly this build:

```bash
MXCLI_REF=8db91bc99a891133b844bc2d8e71d7117e5d7edb bash scripts/setup-tools.sh
```

### Update history

| Date | Commit | Brought in |
| --- | --- | --- |
| 2026-07-26 | `57442ec` | initial pin |
| 2026-07-26 | `8db91bc` | `INDEX name ON (cols)` in entity definitions (grammar change), typed design properties with `check` validation, XPath-arithmetic diagnostics, Atlas-first `migrate-design-prototype` skill |

## Notes on the pins

**ANTLR 4.13.1 is pinned deliberately.** `make build` regenerates the MDL parser
from `mdl/grammar/*.g4`, and the generated Go must match the
`github.com/antlr4-go/antlr/v4 v4.13.1` runtime in mxcli's `go.mod`. The setup
script installs a shim at `/usr/local/bin/antlr4`:

```bash
#!/usr/bin/env bash
exec java -jar /opt/antlr/antlr-4.13.1-complete.jar "$@"
```

The Makefile invokes whatever `antlr4` is first on `PATH`; the shim guarantees
that is 4.13.1 rather than antlr4-tools' floating "latest", which would drift the
generated code away from the runtime.

**Go toolchain.** mxcli's `go.mod` declares `go 1.26.0` / `toolchain go1.26.5`
while the image ships Go 1.24.7. The script exports `GOTOOLCHAIN=auto` so `go
build` downloads the pinned 1.26 toolchain on demand instead of failing.

**Engine.** The default model engine is `modelsdk`. Do not pass `--engine legacy`.

**PostgreSQL.** `mxcli run --local --ensure-db` starts the server via `service
postgresql start` and provisions the role/database through `sudo -u postgres
psql`, so it needs the Debian `main` cluster to exist. The setup script creates
it if missing; starting it is left to `--ensure-db`.

## Re-establishing the toolchain

Automatic — `.claude/settings.json` registers a synchronous `SessionStart` hook:

```json
"command": "bash \"$CLAUDE_PROJECT_DIR/scripts/setup-tools.sh\"", "timeout": 3600
```

Synchronous means the session waits for the toolchain before the first turn, so
nothing can race ahead of a half-installed `mxcli`. The first run in a cold
container takes several minutes (~1.2 GB of MxBuild + runtime downloads); later
runs finish in seconds because every step detects what is already present.

Manual run:

```bash
bash scripts/setup-tools.sh
```

Useful overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MXCLI_REF` | `main` | branch, tag or SHA of mxcli to build |
| `MXCLI_REPO` | `https://github.com/ako/mxcli.git` | mxcli git remote |
| `MXCLI_SRC` | `/opt/mxcli-src` | clone location |
| `MENDIX_VERSION` | `11.12.1` | Mendix version to pre-cache |
| `ANTLR_VERSION` | `4.13.1` | pinned ANTLR version |
| `SKIP_MENDIX_CACHE` | `0` | set to `1` to skip the ~1.2 GB download |

Nothing installed by the script is committed: the mxcli clone
(`/opt/mxcli-src`), the built binary (`/usr/local/bin/mxcli`), the ANTLR jar and
the `~/.mxcli` caches all live outside the repository.

## Scaffolding the Mendix project

Not done yet — this is the next step, in a follow-up session. The single command
that bootstraps the app:

```bash
mxcli new RssReader --version 11.12.1
```

`mxcli new` downloads MxBuild for the version, creates a blank project with `mx
create-project`, runs `mxcli init` to lay down the AI tooling and devcontainer
config, and fetches the Linux mxcli binary for that devcontainer. Use
`--output-dir` to place it somewhere other than `./RssReader`.

After scaffolding, the app is driven with MDL:

```bash
mxcli -p RssReader/RssReader.mpr -c "SHOW ENTITIES"   # inspect
mxcli exec script.mdl -p RssReader/RssReader.mpr      # apply changes
mxcli check script.mdl                                # syntax-only check
mxcli run --local -p RssReader/RssReader.mpr --ensure-db --watch
```

## Verification performed

Cold-start run of `scripts/setup-tools.sh` (ANTLR install, mxcli clone and binary
all removed first) completed with every check green:

```
OK  mxcli --help (mxcli version 8db91bc)
OK  antlr4 4.13.1
OK  mx validator /root/.mxcli/mxbuild/11.12.1/modeler/mx
OK  Mendix runtime /root/.mxcli/runtime/11.12.1
OK  postgres /usr/lib/postgresql/16/bin/postgres
OK  chromium /opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

Additionally confirmed: the freshly regenerated parser round-trips MDL (`mxcli
check` on a `SHOW ENTITIES;` script passes), the `mx` validator responds to
`mx help`, and `service postgresql start` + `sudo -u postgres psql` — the exact
path `--ensure-db` takes — bring up the 16/main cluster.

The `57442ec` → `8db91bc` update exercised the upgrade path end to end: the
`SessionStart` hook fetched `main`, saw the installed short SHA no longer
matched, and rebuilt. That update changed `mdl/grammar/domains/MDLDomainModel.g4`,
so the pinned-ANTLR regeneration was load-bearing — `mxcli check` on the new
`mdl-examples/bug-tests/f4-entity-index-on.mdl` and
`typed-design-properties.mdl` both pass with the regenerated parser.
