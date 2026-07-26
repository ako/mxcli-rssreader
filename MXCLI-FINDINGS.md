# mxcli findings

Issues hit while building the Feedline app (`RssReader/`) — a full three-pane
Mendix app authored end-to-end in MDL from a Claude Design prototype. Roughly
1,900 lines of MDL across six scripts: a domain model, 30 microflows, five
pages and a seeded dataset.

Every item below was re-verified with a minimal reproduction after the build
finished. Items I first suspected and then disproved are listed at the end so
they are not re-reported.

**Environment**

| | |
|---|---|
| mxcli | `8db91bc` (built from `ako/mxcli` `main`) |
| Mendix | 11.12.1 (`mxbuild` + `mx` from the CDN) |
| Engine | `modelsdk` (default) |
| Platform | Linux x86-64, Go 1.26 toolchain, JDK 21 |

Severity is about impact on authoring an app in MDL: **high** = blocks a
documented workflow, **medium** = costs real debugging time or forces a
workaround, **low** = polish.

---

## 1. `alter page … set <prop> on <widget>` fails for every built-in widget

**Severity: high** — this blocks the entire ALTER PAGE workflow on pages mxcli
itself created.

`alter page` is documented (`.ai-context/skills/alter-page.md`, and the
`create-page` skill's "Modifying Existing Pages" section) as the way to make
targeted edits without rewriting a page. On `Feedline.Reader` — a page created
minutes earlier by `create or replace page` — every widget-scoped `set` fails:

```
alter page Feedline.Reader { set class = 'fl-topbar' on topBar; };
→ Error: failed to set: failed to set class on topBar:
  property "class" not found (widget has no pluggable Object)
```

Reproduced identically on a `container` (`topBar`), a `dynamictext`
(`rowBadge`), and an `actionbutton` (`btnKeys`), and for both `class` and
`dynamicclasses` and `caption`. Page-level `set` works fine:

```
alter page Feedline.Reader { set Title = 'Feedline'; };
→ Altered page Feedline.Reader          ✅
```

**Expected:** `set class = … on topBar` updates the widget, since `class` is a
property `create page` accepts on that same widget type.

**Observed:** rejected for every built-in widget tried. The message *"widget has
no pluggable Object"* is doubly confusing — none of these are pluggable widgets,
and the property in question is a first-class one on the built-in.

**Impact:** every page change had to go through `create or replace page` on the
whole document. For a 300-line page that is a lot of churn for a one-line edit,
and it discards anything MDL does not model.

The `migrate-design-prototype` skill already notes a neighbouring symptom
("`alter styling` can't find widgets in MDL-builder-created pages"), so this may
be a known gap — but the ALTER PAGE docs do not carry that caveat, and the error
message does not point at it.

---

## 2. Widget-argument and microflow-call grammars have different reserved words

**Severity: medium**

A microflow argument name that is fine in `call microflow` is a parse error in a
widget's `OnClick:`/`action:` argument list. Same identifiers, two answers:

| argument name | widget argument | `call microflow` |
|---|---|---|
| `View` | ✗ parse error | ✅ |
| `Source` | ✗ parse error | ✅ |
| `Item` | ✗ parse error | ✅ |
| `Page` | ✗ parse error | ✅ |
| `Entity` | ✗ parse error | ✅ |
| `Tag`, `Article`, `SourceTag`, `Kind`, `Feed`, `Target` | ✅ | ✅ |

```sql
-- rejected
container r (OnClick: microflow Feedline.ACT_SelectSource(Source: $currentObject)) { … }
-- accepted
container r (OnClick: microflow Feedline.ACT_SelectSource("Source": $currentObject)) { … }
-- accepted, same name, different grammar
call microflow Feedline.ACT_SelectSource(Source = $Source);
```

Quoting is a fine workaround once you know, and the project's own `CLAUDE.md`
recommends quoting identifiers generally. The problem is discovering it — see
the next item.

**Suggestion:** an argument name is always an identifier in a known position;
it should not need to be keyword-free in either grammar.

---

## 3. Parse errors for a bad widget argument point at the wrong token

**Severity: medium** (compounds #2 badly)

```sql
container r (class: 'x', OnClick: microflow Feedline.ACT_SelectSource(Source: $currentObject)) {
--           ^ col 33                                                 ^ col 62 — actual problem
```

```
line 7:33 no viable alternative at input 'OnClick'
```

The offending token is `Source` at column ~62; the error is reported at column
33, on `OnClick` — a property that is perfectly valid. Everything after it
cascades into dozens of "extraneous input" lines, so the real cause is buried.

This cost the most time of anything in the build: the reported column pointed at
`OnClick`, which had worked on three earlier widgets in the same file, so the
natural conclusion was "`OnClick` is not allowed inside a listview template" —
which is wrong.

**Suggestion:** report the error at the token that failed, and stop cascading
once a property list fails to parse. Even better, a targeted message:
`argument name 'Source' is a reserved word — quote it as "Source"`.

---

## 4. `mxcli check` misses CE0117 for association traversal in widget expressions

**Severity: medium**

A `dynamicclasses` expression that walks an association passes `mxcli check
--references` and then fails the build:

```sql
dynamictext rowBadge (
  content: '{1}', contentparams: [{1} = Article_Source/Mono],
  dynamicclasses: '''fl-tint-'' + $currentObject/Feedline.Article_Source/Slug'
)
```

```
mxcli check … --references   → ✓ All references valid / Check passed!
mx check RssReader.mpr       → [error] [CE0117] "Error(s) in expression." at Text 'rowBadge'
```

Five widgets were affected in one pass (`rowBadge`, `rowThumb`, `artBadge`,
`btnStarActive`, `btnSaveActive`). Note the asymmetry that makes this easy to
trip over: `contentparams: [{1} = Article_Source/Mono]` on the *same widget*
traverses the same association and is perfectly valid — it is a data binding,
not an expression. So "associations work here" is a reasonable inference right
up until the build fails.

This is statically checkable: an association step inside a widget
expression property is always CE0117. Given the checker already implements
MDL-WIDGET04/11/12 and MDL041/043/044, this feels in scope, and it is exactly
the class of error the checker exists to catch before a 60-second build.

**Workaround used:** denormalise the needed attribute onto the entity the widget
is bound to (`Article.SourceSlug`).

---

## 5. CE0111 (retrieve-then-reassign) is detected inconsistently

**Severity: medium**

The same microflow body is accepted or rejected depending on whether the
statement is `create microflow` or `create or replace microflow`:

```sql
retrieve $Existing from Feedline.Tag where [Name = $Name] limit 1;
if $Existing = empty then
  $Existing = create Feedline.Tag (Name = $Name);   -- CE0111
end if;
```

- Written as `create microflow Feedline.ACT_CommitNewTag …` →
  `mxcli check --references` reports **Check passed**. `mx check` then fails with
  `[CE0111] "Duplicate variable name 'Existing'."`
- Written as `create or replace microflow Feedline.ACT_CommitNewTag …` (identical
  body) → `mxcli check --references` reports
  `duplicate variable name '$Existing' — create output variable is already declared in this scope (CE0111)` ✅

Both observed in this repo: the first during the initial build of
`mdl/03-logic.mdl`, the second when the same file was later made re-runnable
with `create or replace`. The validation is clearly implemented and good — it
just does not run on the create path.

---

## 6. A newline inside a property string yields a misleading diagnostic

**Severity: low-medium**

Wrapping a long expression across two lines:

```sql
dynamicclasses: 'if $View/…_ActiveArticle = $currentObject then ''is-active''
                 else if $currentObject/IsRead then ''is-read'' else ''is-unread'''
```

```
line 186:110 token recognition error at: ''
'
  This may be caused by an unescaped apostrophe in a string literal.
  In MDL strings, use '' (two single quotes) to escape apostrophes:
```

The hint is wrong — the quoting was correct; the problem is that a string
literal cannot span lines. The suggested fix ("double your apostrophes") makes
the code worse. A newline inside an unterminated literal is distinguishable from
a stray apostrophe and deserves its own message: *"string literal is not
terminated before end of line; MDL strings cannot span lines"*.

---

## 7. MDL044's suggestion for `count()` sends you the wrong way

**Severity: low, but actively misleading**

```
✗ if condition calls 'count()', which is not a Mendix expression function —
  the build fails CE0117 "Error(s) in expression"  [MDL044]
  → Did you mean 'round()'? Use a built-in Mendix expression function.
```

Catching this is genuinely valuable — it saved a build. But `count()` is not a
typo for `round()`; it is a real, correct MDL aggregate that simply has to be
its own statement:

```sql
$n = count($List);        -- ✅ aggregate activity
if $n > 0 then …          -- ✅
if count($List) > 0 then  -- ✗ MDL044
```

**Suggestion:** for the known aggregates (`count`, `sum`, `average`, `minimum`,
`maximum`) emit *"assign it to a variable first: `$n = count($List);` then use
`$n` in the expression"* rather than a did-you-mean against unrelated functions.

---

## 8. MDL001's suggested fix is not valid MDL

**Severity: medium** — the hint tells you to write something that cannot compile.

```
⚠ nested loop detected (loop inside a loop). Use retrieve $Match from $List
  where ... limit 1 for list matching instead of nested loops (O(N^2)).  [MDL001]
  → Replace nested loop with retrieve ... where ... limit 1 for O(N) lookup
```

Taking the advice literally:

```sql
retrieve $Tags from Feedline.Tag;
retrieve $Match from $Tags where Name = 'Long read' limit 1;
```

```
line 5:29 missing '/' at 'where'
line 5:35 missing END at 'Name'
```

`retrieve … from <list variable>` with a `where` is a parse error, and
`patterns-data-processing.md` states the association form "does not support
WHERE, SORT BY, LIMIT, or OFFSET". So either the syntax the rule recommends is
missing, or the rule's message should recommend the form that does exist (a
database `retrieve … where` per iteration, or accepting the loop for small
lists).

Four MDL001 warnings were raised in this build; all were in-memory matching over
lists of ≤ 12 objects, where the nested loop is the right call.

---

## 9. `textbox` drops `placeholder` and `onchange`

**Severity: medium** — both are standard Mendix TextBox properties and both are
common in real designs.

```
⚠ page Feedline.Reader: widget `txtQuery` (textbox) property `placeholder`
  is not recognized and will be silently dropped on write  [MDL-WIDGET07]
⚠ … property `onchange` is not recognized …
```

The warning itself is excellent — it is exactly why this was caught before the
build rather than after a confusing screenshot. But the underlying gap is real:

- **`onchange`** — Mendix TextBox has an *On change* action. Without it there is
  no way to react to typing from MDL, so the design's live search box became a
  search *button*. This is the single most visible fidelity loss in the app.
- **`placeholder`** — dropped, so the search field has no "Search all articles"
  hint text. There is no CSS workaround (`::placeholder` styles it, it cannot
  supply it).

Verified by round-trip: after `create page` with both properties,
`DESCRIBE PAGE Feedline.Reader` shows
`textbox txtQuery (Label: 'Search', Attribute: Query)` — both gone.

---

## 10. `mxcli init`'s generated `CLAUDE.md` contradicts the shipped skills

**Severity: low-medium** — it is the first file an agent reads, and it is wrong
on two points the skills get right.

`CLAUDE.md` / `AGENTS.md` (generated into every project by `mxcli init`) says:

| generated `CLAUDE.md` | reality |
|---|---|
| line 537 — `CASE … WHEN … END CASE` listed under "NOT Supported (Will Cause Parse Errors)", "use nested IF" | The grammar accepts `case`; `write-microflows.md` documents it as *"CASE Statements (Enum Split)"*; the checker's MDL008 correctly rejects only an `else` branch on an enum split. |
| line 509 — `DECLARE $Entity Module.Entity;` listed as a supported statement | Rejected: `MDL043 … Mendix does not allow the Create Variable activity to hold an object (CE0053)`. `write-microflows.md` says the same. |
| line 510 — `DECLARE $List List of Module.Entity = empty;` listed as supported | Rejected: MDL040, same story. |

Both wrong entries are in the "Microflows — Supported Statements" table, which
is precisely the table you consult while writing a microflow. Regenerating that
table from the same source as the skills (or the feature registry behind
`mxcli syntax`) would keep them from drifting.

---

## 11. Smaller things

- **`mxcli new` copies a 111 MB binary into every project.** It is correctly
  gitignored, but it is a full copy per project. A wrapper script that resolves
  the binary from `~/.mxcli`, or a symlink, would keep project trees small.
- **Reference validation requires create-order within a script.** A page
  referencing a page defined later in the same file fails with
  *"references page X before it is created — move the create statement earlier"*.
  The message is clear and actionable, but a two-pass resolve would remove the
  manual ordering (the Reader page had to be moved below its four popups).
- **`mxcli syntax expressions` is advertised but does not exist.** MDL044's hint
  says *"see 'mxcli syntax expressions'"*; that topic returns
  `Unknown topic: expressions`. The closest real topic is `microflow`.

---

## What worked well

Worth recording, since a findings list reads more negatively than the experience
was — a complete, pixel-close app was built without opening Studio Pro once:

- **`mxcli check --references` caught most errors before the build.** MDL008
  (`else` on an enum split), MDL043/040/041/044, and MDL-WIDGET07 (silently
  dropped properties) each caught a real defect that would otherwise have
  surfaced as a confusing runtime or build failure.
- **The error messages that are right are very good.** MDL043's *"Get the object
  from a microflow parameter, a retrieve, or a create object instead"* is exactly
  what a newcomer needs.
- **`mxcli run --local --ensure-db` is excellent.** It provisioned PostgreSQL,
  created the role and database, built and started the runtime in about 25
  seconds from a cold database, with no Docker.
- **`create or replace` round-trips faithfully.** Re-running the page and
  microflow scripts repeatedly produced identical, valid models; `DESCRIBE`
  output was a reliable way to confirm what actually persisted.
- **Pluggable-widget-free authoring covered the whole design.** `container` with
  `OnClick:` plus `DynamicClasses:` was enough for every interactive element in
  a fairly elaborate prototype.

---

## Not bugs (initially suspected, then disproved)

Recorded so they are not re-reported:

- **Zero-argument `call microflow`.** `call microflow M.Foo();` parses fine. The
  parse error that looked like this was actually a positional `show page`
  argument on a nearby line — the reported column belonged to the `show page`
  statement.
- **`show page` argument separator.** Both documented forms work:
  `show page M.P($View = $View)` and `show page M.P(View: $View)`. The failing
  form (`View = $View`, unprefixed name with `=`) is an undocumented hybrid, and
  the error `mismatched input '=' expecting ':'` is correct and clear.
- **Reference-set assignment.** `change $Obj (Mod.Assoc = $List)` for a
  many-to-many works exactly as expected, both in check and at runtime.
