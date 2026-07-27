#!/usr/bin/env bash
#
# setup-tools.sh — idempotent bootstrap of the mxcli / Mendix toolchain.
#
# The dev container is ephemeral: it is reclaimed after inactivity and recreated
# from a fresh clone. Everything the workspace needs must therefore be
# re-establishable from this script alone. Run it as often as you like — each
# step detects what is already present and skips the work.
#
# Steps
#   1. Verify base deps (Go, JDK 21, Node, PostgreSQL 16, Chromium) — install
#      only what is missing.
#   2. Pin ANTLR 4.13.1 (jar + `antlr4` shim on PATH) so mxcli's parser regen is
#      deterministic and matches the antlr4-go/antlr v4.13.1 Go runtime.
#   3. Build mxcli from source (github.com/ako/mxcli) and install it.
#   4. Pre-cache MxBuild + Mendix runtime for MENDIX_VERSION.
#   5. Verify everything and fail loudly if a check does not pass.
#
# Environment overrides
#   MXCLI_REPO       git remote for mxcli          (default: https://github.com/ako/mxcli.git)
#   MXCLI_REF        branch/tag/SHA to build       (default: main)
#   MXCLI_SRC        clone location                (default: /opt/mxcli-src)
#   MENDIX_VERSION   Mendix version to pre-cache   (default: 11.12.1)
#   ANTLR_VERSION    pinned ANTLR version          (default: 4.13.1)
#   SKIP_MENDIX_CACHE=1  skip the ~1.2 GB MxBuild/runtime download
#
set -euo pipefail

MXCLI_REPO="${MXCLI_REPO:-https://github.com/ako/mxcli.git}"
MXCLI_REF="${MXCLI_REF:-main}"
MXCLI_SRC="${MXCLI_SRC:-/opt/mxcli-src}"
MENDIX_VERSION="${MENDIX_VERSION:-11.12.1}"
ANTLR_VERSION="${ANTLR_VERSION:-4.13.1}"
ANTLR_HOME="${ANTLR_HOME:-/opt/antlr}"
ANTLR_JAR="${ANTLR_HOME}/antlr-${ANTLR_VERSION}-complete.jar"
PG_MAJOR="${PG_MAJOR:-16}"
PG_BIN="/usr/lib/postgresql/${PG_MAJOR}/bin"
MXCLI_HOME="${MXCLI_HOME:-${HOME}/.mxcli}"

# Installing into /usr/local/bin needs root; fall back to sudo when available.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo" || {
    echo "ERROR: not root and sudo unavailable; cannot install system tools" >&2
    exit 1
  }
fi

log()  { printf '\n=== %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Base dependencies — detect, install only what is missing
# ---------------------------------------------------------------------------
log "Checking base dependencies"

command -v go >/dev/null 2>&1 || die "Go is not installed and is required to build mxcli"
info "go        $(go version | awk '{print $3}')"
# mxcli's go.mod pins the 1.26 toolchain; GOTOOLCHAIN=auto lets the installed Go
# fetch it on demand instead of failing with a 'go.mod requires go >= 1.26' error.
export GOTOOLCHAIN="${GOTOOLCHAIN:-auto}"

command -v java >/dev/null 2>&1 || die "JDK 21 is not installed (needed for ANTLR and the Mendix runtime)"
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ -n "$JAVA_MAJOR" ] && [ "$JAVA_MAJOR" -ge 21 ] || die "JDK 21+ required, found major version '${JAVA_MAJOR:-unknown}'"
info "java      $(java -version 2>&1 | grep -o 'version "[^"]*"' | head -1 | tr -d '"' | awk '{print $2}')"

command -v node >/dev/null 2>&1 || die "Node.js is not installed (needed for Playwright screenshot verification)"
info "node      $(node --version)"

if [ ! -x "${PG_BIN}/postgres" ]; then
  info "PostgreSQL ${PG_MAJOR} server missing — installing"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}"
fi
[ -x "${PG_BIN}/postgres" ] || die "PostgreSQL ${PG_MAJOR} server binary not found at ${PG_BIN}/postgres"

# `mxcli run --local --ensure-db` starts the server with `service postgresql
# start` and provisions the role/db via `sudo -u postgres psql`, so it needs a
# Debian cluster to exist — the package normally creates 'main' on install.
if command -v pg_lsclusters >/dev/null 2>&1 && ! pg_lsclusters -h 2>/dev/null | grep -q "^${PG_MAJOR}[[:space:]]"; then
  info "creating PostgreSQL ${PG_MAJOR} cluster 'main'"
  $SUDO pg_createcluster "${PG_MAJOR}" main >/dev/null
fi
info "postgres  $("${PG_BIN}/postgres" --version | awk '{print $3}') (cluster: $(pg_lsclusters -h 2>/dev/null | awk -v v="$PG_MAJOR" '$1==v {print $2" "$4}' | head -1))"

# Chromium ships with the image at PLAYWRIGHT_BROWSERS_PATH; never re-download it.
CHROMIUM_BIN="$(find /opt/pw-browsers -maxdepth 3 -name chrome -type f 2>/dev/null | head -1 || true)"
if [ -n "$CHROMIUM_BIN" ]; then
  info "chromium  ${CHROMIUM_BIN}"
else
  info "chromium  NOT FOUND under /opt/pw-browsers (screenshot verification unavailable)"
fi

# ---------------------------------------------------------------------------
# 2. ANTLR 4.13.1, pinned
# ---------------------------------------------------------------------------
log "Pinning ANTLR ${ANTLR_VERSION}"

if [ ! -f "$ANTLR_JAR" ]; then
  info "downloading antlr-${ANTLR_VERSION}-complete.jar"
  $SUDO mkdir -p "$ANTLR_HOME"
  $SUDO curl -fsSL -o "$ANTLR_JAR" \
    "https://www.antlr.org/download/antlr-${ANTLR_VERSION}-complete.jar"
else
  info "jar already present at ${ANTLR_JAR}"
fi

# The shim must come first on PATH: mxcli's Makefile invokes whatever `antlr4`
# it finds, and antlr4-tools would otherwise pull "latest", drifting the
# generated Go away from the antlr4-go/antlr v4.13.1 runtime in go.mod.
ANTLR_SHIM="/usr/local/bin/antlr4"
$SUDO tee "$ANTLR_SHIM" >/dev/null <<EOF
#!/usr/bin/env bash
exec java -jar ${ANTLR_JAR} "\$@"
EOF
$SUDO chmod 0755 "$ANTLR_SHIM"

ANTLR_REPORTED="$(antlr4 2>/dev/null | grep -o 'Version [0-9.]*' | awk '{print $2}' | head -1)"
[ "$ANTLR_REPORTED" = "$ANTLR_VERSION" ] \
  || die "antlr4 reports '${ANTLR_REPORTED:-nothing}', expected ${ANTLR_VERSION}"
info "antlr4    ${ANTLR_REPORTED} (via ${ANTLR_SHIM})"

# ---------------------------------------------------------------------------
# 3. Build mxcli from source
# ---------------------------------------------------------------------------
log "Building mxcli from ${MXCLI_REPO} (${MXCLI_REF})"

if [ -d "${MXCLI_SRC}/.git" ]; then
  info "updating existing clone"
  $SUDO git -C "$MXCLI_SRC" fetch --depth 1 origin "$MXCLI_REF"
  $SUDO git -C "$MXCLI_SRC" checkout --detach FETCH_HEAD
else
  $SUDO rm -rf "$MXCLI_SRC"
  $SUDO git clone --depth 1 --branch "$MXCLI_REF" "$MXCLI_REPO" "$MXCLI_SRC" 2>&1 \
    | grep -v '^Updating files' || true
fi

MXCLI_SHA="$(git -C "$MXCLI_SRC" rev-parse HEAD)"
MXCLI_SHORT="$(git -C "$MXCLI_SRC" rev-parse --short HEAD)"
info "HEAD      ${MXCLI_SHA}"

# `make build` regenerates the ANTLR parser, syncs embedded skills/commands and
# links bin/mxcli. Rebuild only when the installed binary is not from this SHA.
INSTALLED_SHA=""
command -v mxcli >/dev/null 2>&1 && \
  INSTALLED_SHA="$(mxcli --version 2>/dev/null | awk '{print $3}' || true)"

if [ "$INSTALLED_SHA" = "$MXCLI_SHORT" ]; then
  info "mxcli ${MXCLI_SHORT} already installed — skipping build"
else
  ( cd "$MXCLI_SRC" && $SUDO env "PATH=$PATH" GOTOOLCHAIN=auto make build )
  $SUDO install -m 0755 "${MXCLI_SRC}/bin/mxcli" /usr/local/bin/mxcli
  info "installed /usr/local/bin/mxcli"
fi

# ---------------------------------------------------------------------------
# 4. Pre-cache MxBuild + Mendix runtime
# ---------------------------------------------------------------------------
MXBUILD_MX="${MXCLI_HOME}/mxbuild/${MENDIX_VERSION}/modeler/mx"
RUNTIME_DIR="${MXCLI_HOME}/runtime/${MENDIX_VERSION}"

if [ "${SKIP_MENDIX_CACHE:-0}" = "1" ]; then
  log "Skipping Mendix ${MENDIX_VERSION} cache (SKIP_MENDIX_CACHE=1)"
else
  log "Caching Mendix ${MENDIX_VERSION} build engine and runtime"
  if [ -x "$MXBUILD_MX" ]; then
    info "mxbuild already cached"
  else
    mxcli setup mxbuild --version "$MENDIX_VERSION"
  fi
  if [ -d "$RUNTIME_DIR/runtime" ]; then
    info "runtime already cached"
  else
    mxcli setup mxruntime --version "$MENDIX_VERSION"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
log "Verifying toolchain"

mxcli --help >/dev/null 2>&1 || die "mxcli --help did not run"
info "OK  mxcli --help ($(mxcli --version 2>/dev/null))"

[ "$(antlr4 2>/dev/null | grep -o 'Version [0-9.]*' | awk '{print $2}' | head -1)" = "$ANTLR_VERSION" ] \
  || die "antlr4 is not ${ANTLR_VERSION}"
info "OK  antlr4 ${ANTLR_VERSION}"

if [ "${SKIP_MENDIX_CACHE:-0}" != "1" ]; then
  [ -x "$MXBUILD_MX" ] || die "mx validator missing at ${MXBUILD_MX}"
  info "OK  mx validator ${MXBUILD_MX}"
  [ -d "$RUNTIME_DIR/runtime" ] || die "Mendix runtime missing at ${RUNTIME_DIR}/runtime"
  info "OK  Mendix runtime ${RUNTIME_DIR}"
fi

[ -x "${PG_BIN}/postgres" ] || die "PostgreSQL server binary missing"
info "OK  postgres ${PG_BIN}/postgres"

[ -n "$CHROMIUM_BIN" ] || die "Chromium not found under /opt/pw-browsers"
info "OK  chromium ${CHROMIUM_BIN}"

# Make the PostgreSQL server binaries reachable for `mxcli run --local --ensure-db`
# (Debian keeps them out of PATH) for the rest of the session.
case ":${PATH}:" in
  *":${PG_BIN}:"*) ;;
  *) export PATH="${PATH}:${PG_BIN}" ;;
esac
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PATH=\"\$PATH:${PG_BIN}\""
    echo "export GOTOOLCHAIN=auto"
    echo "export MENDIX_VERSION=${MENDIX_VERSION}"
  } >> "$CLAUDE_ENV_FILE"
fi

log "Toolchain ready"
cat <<EOF
    mxcli      ${MXCLI_SHORT}  (${MXCLI_SHA})
    mendix     ${MENDIX_VERSION}
    antlr      ${ANTLR_VERSION}
    go         $(go version | awk '{print $3}')
    java       $(java -version 2>&1 | grep -o 'version "[^"]*"' | head -1 | tr -d '"' | awk '{print $2}')
    node       $(node --version)
    postgres   $("${PG_BIN}/postgres" --version | awk '{print $3}')
EOF
