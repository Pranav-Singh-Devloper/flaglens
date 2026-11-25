---
title: "FlagLens: Exact, Server-Verified Reasoning about Feature Flags in the Editor"
subtitle: "Local evaluation, dead-code detection, targeting-rule anomalies and optimal pairwise test plans for self-hosted Flagsmith"
author: "Pranav Singh"
date: "November 2026"
abstract: |
  Feature flags decouple deployment from release, but they move a program's control flow out of the code and into a
  remote service. A developer reading `if (flags.isFeatureEnabled("x"))` cannot tell which branch runs, for whom, or
  whether the flag's targeting rules even make sense. We present FlagLens, a VS Code extension for the open-source
  feature-flag platform Flagsmith, that answers these questions inside the editor with guarantees rather than
  heuristics. FlagLens (1) re-implements Flagsmith's evaluation semantics locally and validates them by differential
  testing against a live server (15,050 checks over every rule operator and flag dependencies, no mismatches); (2) detects code that
  cannot run in a given environment or for a given user, using Kleene's three-valued logic so that it never greys out
  code that might execute; (3) finds anomalies in segment overrides (shadowed, redundant and unsatisfiable rules),
  adapting the firewall-policy anomaly taxonomy of Al-Shaer and Hamed, and proves each finding for every possible user
  through an exact partition of the trait space into equivalence classes, with an over-approximation that keeps the
  analysis sound in the presence of operators it cannot partition; and (4) generates pairwise test plans for sets of
  flags that are provably minimal for on/off flags (the Katona--Kleitman--Spencer construction) and near-minimal with
  a stated lower bound otherwise, including a simple new bound that certifies optimality for a common mixed case. All
  analyses run in milliseconds on real projects, ship in a 62 KB extension with no runtime dependencies, and are
  covered by 190 unit tests and 22 end-to-end tests against a self-hosted Flagsmith instance.
geometry: margin=2.3cm
fontsize: 10pt
numbersections: true
colorlinks: true
linkcolor: blue
urlcolor: blue
---

# Introduction

Feature flags (also called feature toggles) let teams ship code dark and switch it on later, per environment, per
user segment or for a percentage of users. Their costs are well documented: flags accumulate as technical debt, their
removal lags behind their creation, and stale flags leave dead code behind [1, 2, 3].
Industrial tools now remove stale flags automatically, first with rule-based rewriting [4, 5]
and recently with multi-agent LLM pipelines that need the flag's live rollout state as ground truth [6].

A less studied problem sits earlier in the life of a flag: *understanding* it while the code is being written and
reviewed. The state that decides which branch runs lives in a remote service, distributed over environments,
segments with trait-based rules, priority-ordered overrides, percentage splits and per-identity overrides. Existing
IDE integrations show a flag's value in the current environment, but they cannot say whether a branch is dead for
everyone, what a particular user would get, or whether the targeting rules are self-consistent.

FlagLens is a VS Code extension for Flagsmith [7], an open-source feature-flag platform, built for self-hosted
deployments. Beyond the expected features (live state inline, safe toggles, drift and typo detection), it contributes
four analyses that are exact or provably sound:

1. **Server-faithful local evaluation** (Section 3). We port Flagsmith's evaluation engine to TypeScript and evaluate
   the *environment document*, the same data structure server-side SDKs use for local evaluation. Differential testing
   [8] against a live server, using transient identities with random traits, found no disagreement in
   15,050 flag evaluations, including one throwaway segment per rule operator and a flag dependency.
2. **Dead-code detection under flag states** (Section 4). FlagLens greys out branches that cannot run in the selected
   environment, or for a previewed user, like an inactive `#ifdef`. Conditions are evaluated in Kleene's strong
   three-valued logic [9], an abstract interpretation [10] in which unknown operands stay unknown,
   so a branch is greyed only if it is dead under every concretisation.
3. **Targeting-rule anomaly analysis** (Section 5). Segment overrides are priority-ordered rules over identity traits,
   exactly the structure of a firewall policy. We adapt the anomaly taxonomy of Al-Shaer and Hamed
   [11, 12] and decide each anomaly *for every possible user* by checking one representative per
   equivalence class of trait values, an exact form of equivalence partitioning [13] related to packet-space
   segmentation in FAME [14]. Operators that cannot be partitioned are abstracted as free Boolean variables,
   which over-approximates the user space and keeps every reported finding true.
4. **Optimal pairwise test plans** (Section 6). Most interaction faults involve one or two parameters
   [15]. For on/off flags FlagLens builds covering arrays of strength 2 with the provably minimal number of
   rows [16, 17]; for multi-valued flags it combines IPOG [18] with simulated annealing
   [19] and reports a lower bound, which we strengthen for a common mixed case.

Section 7 describes the implementation and evaluation, Section 8 discusses related work, and Section 9 limitations and
future work.

# Background: Flagsmith's evaluation semantics

An *environment document* $D$ contains, for one environment: the default *feature state* of every flag (enabled
bit, value, optional multivariate variants with percentage weights), every *segment* of the project with its rules
and its feature-state *overrides* in this environment (each with a priority), and identity-specific overrides.

**Identities and hashing.** An identity with identifier $i$ in an environment with key $e$ has the composite key
$\kappa = e\_i$. Flagsmith maps a list of ids to a percentage with

$$ h(x_1,\dots,x_m) \;=\; \frac{100 \cdot \big(\mathrm{md5}(x_1,\dots,x_m) \bmod 9999\big)}{9998} \in [0, 100), $$

where $\mathrm{md5}(\cdot)$ is the MD5 digest [20] of the comma-joined ids read as a 128-bit integer (the
value 100 is re-hashed). A *percentage-split* condition of segment $s$ with threshold $p$ matches when
$h(s, \kappa) \le p$. A multivariate flag whose feature state has id $d$ assigns the variant whose cumulative weight
interval contains $h(d, \kappa)$, walking variants in ascending id order.

**Segments.** A segment's rules form a tree of `ALL`/`ANY`/`NONE` nodes over conditions
$\langle \textit{property}, \textit{operator}, \textit{value}\rangle$, with operators `EQUAL`, `NOT_EQUAL`, `IN`,
`CONTAINS`, `NOT_CONTAINS`, `REGEX`, `MODULO`, `IS_SET`, `IS_NOT_SET`, ordering comparisons, SemVer comparisons (a
`:semver` suffix) and `PERCENTAGE_SPLIT`. Before comparing, the engine *casts the condition's value to the runtime
type of the trait*: to a float for numeric traits, and for Boolean traits to `true` unless it is literally `false`
or `False`. A segment with no rules matches nobody.

**Resolution.** For a flag $f$, the matching segment override with the smallest priority number wins (ties keep the
earlier segment); identity overrides beat all segment overrides; otherwise the environment default applies.

**Flag dependencies.** A flag $c$ can require a flag $p$. Flagsmith does not add a new mechanism for this: it creates a
*system segment* named `c-depends-on-p` whose single condition is $\langle$`$.flags["p"].enabled`, `NOT_EQUAL`,
`true`$\rangle$, with an override that disables $c$. The condition reads the *evaluated* state of $p$ for the
current identity (or for no identity), so a dependency is an ordinary override competing by priority: an override of
$c$ with a smaller priority number still wins over it. Flagsmith rejects chains (a prerequisite that has a
prerequisite of its own) with HTTP 400, so the flags referenced by `$.flags` conditions are never themselves the
subject of one.

# Server-faithful local evaluation

FlagLens downloads $D$ for every environment (`GET /environments/{key}/document/`, readable with the same
organisation API key used for the management API) and evaluates it with a port of Flagsmith's open-source engine. This
single capability powers *Preview as a user* (CodeLens and hovers show what a chosen identity with chosen traits gets,
and why: segment and priority, split bucket and interval, or identity override) and supplies exact facts to the
analyses below.

**Differential testing.** Local evaluation is only useful if it is exactly right, so we test it against the
authority. The verifier generates identities with random traits (strings, numbers, Booleans, SemVer strings, unset
traits) and asks the server what each one gets, using *transient* identities that the server evaluates without
storing. Every flag's enabled bit and value must equal the local result. A second pass creates one throwaway segment
per rule operator, each switching on its own throwaway flag, and deletes them afterwards.

| Pass | Identities | Flags | Checks | Agree |
|---|---:|---:|---:|---:|
| Seeded demo (3 environments, 6 segments with overrides) | 300 + none, per env. | 7 | 6,321 | 6,321 |
| Operator coverage (20 single-operator segments and a dependency) | 300 + none | 29 | 8,729 | 8,729 |

"None" is the evaluation with no identity (the environment's flags), compared once per pass.

Each operator segment matched a non-trivial share of identities (for example `EQUAL plan pro` 86 of 400,
`PERCENTAGE_SPLIT 37.5` 142 of 400), so agreement is not vacuous. The verifier surfaced two semantic details that
the engine port must (and does) reproduce: `REGEX` is anchored at the start of the trait, as with Python's
`re.match` (a rule `demo-shop` matches no email in the sample, on both sides), and the Boolean cast above, which makes
a Boolean trait `true` equal to *any* condition value except `"false"`.

**Dependencies in two passes.** Let $R$ be the regular segments and $S$ the dependency segments of $D$. FlagLens
first resolves every flag with the overrides of $R$ only (pass 1), then evaluates each condition of $S$ against the
pass-1 states and resolves again with the matching segments of $R \cup S$ in document order (pass 2). Pass 2 is exact:
a condition of $S$ reads a prerequisite $p$, and since chains are rejected no segment of $S$ overrides $p$, so $p$'s
pass-1 state already equals its final state. The same argument gives each dependency's *blocked* status for the editor:
$c$ is blocked in an environment when its default is on but it resolves to off with no identity. The differential test
includes a dependency whose prerequisite is on only for one segment, so both outcomes occur.

**Uniformity.** For dead-code detection without a previewed user we also need to know whether a flag is the same for
everybody in an environment. A flag's enabled bit is *uniform* in $D$ if no segment or identity override touches it;
its value is uniform if, in addition, no variant has positive weight.

# Dead-code detection under flag states

Given a source file, its flag references (found with the same pattern as Flagsmith's Code References scanner) and a
fact for every flag, FlagLens reports source ranges that cannot execute. A *fact* is the flag's enabled bit and value
if they are uniform (or known for the previewed identity), and *unknown* otherwise. Keys that do not exist in
Flagsmith receive the SDKs' default (disabled).

**Shapes.** A small lexer marks code, strings, comments and template-literal holes. On top of it the analysis
recognises `if`/`else if`/`else` chains (brace languages, and Python by indentation), guards whose body ends in
`return` or `throw` (when the guard is certainly true, the rest of the enclosing block is dead), ternaries (including
inside template literals), and simple aliases (`const x = flags.isFeatureEnabled("f")`, followed into later uses in
the same block unless reassigned).

**Three-valued evaluation.** Conditions are parsed into expressions over flag atoms, literals and *opaque* operands
(any other variable or call). We evaluate them in Kleene's strong logic $K_3$ with truth values
$\{\mathsf{T}, \mathsf{F}, \mathsf{U}\}$, where $\mathsf{U}$ stands for "either" ($\gamma(\mathsf{U}) =
\{\mathsf{T},\mathsf{F}\}$):

$$ \mathsf{F} \wedge x = \mathsf{F}, \qquad \mathsf{T} \vee x = \mathsf{T}, \qquad \neg\mathsf{U} = \mathsf{U}, \qquad
\mathsf{T}\wedge\mathsf{U} = \mathsf{F}\vee\mathsf{U} = \mathsf{U}. $$

Comparisons involving $\mathsf{U}$ yield $\mathsf{U}$; JavaScript truthiness and `??`, and Python truthiness and
`is`/`is not`, are modelled. Anything the parser does not understand (arithmetic, lambdas) makes the whole condition
$\mathsf{U}$.

**Soundness.** $K_3$ is monotone with respect to the information order, so if the abstract result is $\mathsf{T}$
(or $\mathsf{F}$) then every concrete assignment of the unknown operands yields $\mathsf{T}$ (or $\mathsf{F}$).
FlagLens greys a branch only when the condition is definitely the opposite, so it never greys code that can run under
the given facts. In Production of the demo project, for example, `new_checkout` has a segment override, so its
condition is $\mathsf{U}$ for "everyone" and the old-checkout branch stays visible; previewing as a beta tester makes
the fact definite and the branch is greyed.

# Targeting-rule anomalies

## Model and anomalies

Fix an environment document $D$ and a flag $f$. Let $o_1, \dots, o_n$ be the segment overrides of $f$, sorted by
priority (stable), with segment predicates $S_j : \mathcal{U} \to \{0,1\}$ over the space $\mathcal{U}$ of users
(identity key and trait assignment), and served states $\sigma_j$. For a user $u$, let
$\mathrm{next}_j(u)$ be the state of the first $o_k$ with $k > j$ and $S_k(u)$, or the default $\sigma_0$ if there
is none. Following the firewall-policy taxonomy [11, 12], we report:

- **matches nobody**: $\forall u.\; \neg S_j(u)$;
- **shadowed**: $\exists u.\, S_j(u)$ and $\forall u.\; S_j(u) \Rightarrow \exists i<j.\; S_i(u)$, so $o_j$ never applies;
- **redundant**: $\forall u.\; \big(S_j(u) \wedge \forall i<j.\, \neg S_i(u)\big) \Rightarrow \sigma_j = \mathrm{next}_j(u)$, so
  removing $o_j$ changes no user's result (states with a live variant split are never considered equal);
- **default unreachable**: $\forall u.\; \exists i.\; S_i(u)$.

All four are universally quantified over an infinite space. We decide them exactly where possible and soundly
otherwise.

## An exact partition of the trait space

Call an operator *partitionable* if it compares a trait with constants: `EQUAL`, `NOT_EQUAL`, `IN`, `IS_SET`,
`IS_NOT_SET` and the four ordering comparisons (without the SemVer suffix). For a trait $p$, let $K_p$ be the
constants appearing in partitionable conditions on $p$ across $o_1,\dots,o_n$. Define representatives $R_p$:
the value *unset*; every constant as a string; one string different from all constants; when ordering operators are
used, the empty string, a string above all constants and the lexicographic successor of each constant (the constant
followed by a NUL character); every numeric constant, a number in each gap between consecutive numeric constants, one below and one above
them, and one unrelated number; and both Booleans.

**Lemma 1 (exact partition).** For every partitionable condition $\phi$ on trait $p$ and every value $v$ of $p$, there
is $r \in R_p$ such that every partitionable condition on $p$ appearing in the rules has the same truth value at $v$
and at $r$.

*Proof sketch.* After the engine's cast, each partitionable condition compares $v$ against one constant with $=$, $<$
or $\le$ (or membership in a finite set) within one runtime type. Within a type, the constants cut the domain into
points and open intervals on which every such comparison is constant; within the string type, the successor
of $c$ (the string $c$ followed by a NUL character) lies strictly between $c$ and every larger string, so each open interval has a
representative. Unset traits make every condition except `IS_NOT_SET` false. Each class therefore contains an element
of $R_p$. $\square$

Percentage splits on the identity key are handled the same way: for segment $s$ the bucket $b_s = h(s,\kappa)$ is a
number in $[0,100)$ and the condition is $b_s \le p$, so the thresholds of $s$ partition $[0,100)$. Different segments
hash with different ids, so their buckets are separate dimensions.

**Opaque conditions.** `REGEX`, `CONTAINS`, `NOT_CONTAINS`, `MODULO`, SemVer comparisons and splits on a trait are
replaced by fresh Boolean variables; syntactically identical conditions share a variable. Let $A$ be the set of these
variables and $\mathcal{U}^\sharp = \prod_p R_p \times \prod_s B_s \times \{0,1\}^A$.

**Theorem 2 (soundness).** If a finding of any of the four kinds holds when the quantifiers range over
$\mathcal{U}^\sharp$, it holds over $\mathcal{U}$.

*Proof sketch.* By Lemma 1 every real user is equivalent, on all partitionable atoms, to some representative
combination, and every real user's opaque atoms take *some* value in $\{0,1\}^A$. The map from $\mathcal{U}$ into
$\mathcal{U}^\sharp$ therefore preserves every $S_j$, so the image of $\mathcal{U}$ is a subset of
$\mathcal{U}^\sharp$ on which all predicates agree. All four findings are universal statements over users, and a
universal statement true on a superset is true on the subset. $\square$

When the rules contain neither opaque conditions nor percentage splits, every representative combination is the
trait assignment of some real user, the image is all of $\mathcal{U}^\sharp$, and the analysis is complete: it reports
exactly the anomalies that exist. Opaque conditions and splits (whose joint bucket values are fixed by the hash rather
than chosen freely) can only cause an anomaly to be missed, never a false one to be reported.

**Type casting matters.** Because a Boolean trait `true` satisfies `EQUAL c` for every $c \neq$ `"false"`, a
segment `plan = pro AND plan = free` *is* satisfiable (by `plan: true`). An analysis that considered only string
values would wrongly report that it matches nobody. Our representatives include both Booleans for this reason; the
behaviour was confirmed against the live server by the verifier of Section 3.

**Cost.** The check enumerates $|\mathcal{U}^\sharp| = \prod_p |R_p| \cdot \prod_s |B_s| \cdot 2^{|A|}$ users and
evaluates $n$ segment predicates on each. Realistic override lists are small: the demo's Production environment is
analysed in 3 ms. FlagLens skips a flag whose space exceeds 250,000 combinations rather than block the editor.

## Validation

Besides unit tests for each anomaly kind, a randomised test generates 150 rule sets (2 to 4 overrides, random
`ALL`/`ANY`/`NONE` rules over partitionable and opaque operators and splits) and checks every reported finding
against the verified engine for 1,500 random users each: no shadowed override is ever applied, no "matches nobody"
segment ever matches, removing a redundant override never changes a result, and every user of a "default
unreachable" flag gets an override. On the live server, the seeded `pro_eu` override (Pro customers in DE, FR or GB,
below `pro_plan`) is reported as shadowed; of the sampled users inside `pro_eu`, none (32 in the last run) was served
its value.

# Optimal pairwise test plans

A *covering array* $\mathrm{CA}(N; 2, (v_1,\dots,v_k))$ is an $N \times k$ array whose column $j$ takes values in
$\{0,\dots,v_j-1\}$ and in which, for every two columns, every pair of values appears in some row. Its rows are test
runs; columns are flags; values are the states a flag takes (off/on, or every value in use). $\mathrm{CAN}$ denotes
the smallest $N$.

## On/off flags

**Theorem 3 (Katona [16]; Kleitman and Spencer [17]).**
$\mathrm{CAN}(2, k, 2) = \min\{N : \binom{N-1}{\lceil N/2\rceil} \ge k\}$.

FlagLens builds the extremal array directly: column $j$ is the indicator vector of the $j$-th $\lceil N/2\rceil$-subset of
$\{1,\dots,N-1\}$ (row 0 is all zeros). For two distinct columns $c, d$: row 0 gives $(0,0)$; since they have equal
weight neither contains the other, giving $(1,0)$ and $(0,1)$; and $2\lceil N/2\rceil > N-1$ forces a common $1$, giving
$(1,1)$. The resulting plans need 6 runs for 10 flags, 10 for 100 and 14 for 1,000, against $2^k$ exhaustive runs.
Our tests check the size and full coverage for every $k$ from 1 to 200.

## Multi-valued flags

No closed form is known for mixed alphabets; asymptotically $\mathrm{CAN}(2,k,v)$ grows like $\frac{v}{2}\log_2 k$
[21], and constructions are surveyed by Colbourn [22]. FlagLens runs IPOG [18] (largest
factors first, plus a few seeded reorderings) and then tries to shrink the plan one row at a time with simulated
annealing [19], whose cost is the number of uncovered value pairs and whose move writes an uncovered pair into a
random row. It reports the lower bound
$$ L = \max\big(v_{(1)} v_{(2)},\; \mathrm{CAN}(2, k_2, 2)\big), $$
the product of the two largest alphabets and the on/off optimum for the $k_2$ on/off flags, since the plan restricted
to those columns is itself a binary covering array.

**Lemma 4.** Let one flag have $a > 2$ values and the remaining $k_2$ flags be on/off. If $k_2 > 2^{a-1}$ then
$\mathrm{CAN} \ge 2a + 1$.

*Proof.* In a plan with $2a$ rows each value of the big flag must meet both on/off values of every other column, so
it occupies exactly two rows, and every on/off column takes different values on those two rows. Such a column is
determined by choosing, for each of the $a$ row pairs, which row holds the $1$: $2^a$ choices. Two such columns cover
all four on/off pairs if and only if they agree on at least one row pair (giving $(0,0)$ and $(1,1)$) and disagree on
at least one (giving $(0,1)$ and $(1,0)$), that is, if they are neither equal nor complementary. At most one column
from each complementary pair can be used, so at most $2^{a-1}$ columns fit. $\square$

We expect this argument to be folklore; we state it because it certifies optimality in a case that matters in
practice, one multivariate flag among on/off flags. For the demo's six flags (one with 3 values, five on/off) the
bound rises from 6 to 7, and the 7-run plan found by annealing is reported as optimal. A brute-force search confirms
that four on/off flags fit in 6 rows and five do not.

| Value counts | Exhaustive | IPOG | + annealing | Lower bound |
|---|---:|---:|---:|---:|
| $2^{10}$ (exact construction) | 1,024 | | 6 | 6 |
| $3 \cdot 2^5$ (demo) | 96 | 8 | **7** | 7 (Lemma 4) |
| $3^4$ | 81 | 10 | **9** | 9 |
| $4 \cdot 3 \cdot 2^2$ | 48 | 13 | **12** | 12 |
| $4^5$ | 1,024 | 16 | 16 | 16 |
| $5^6$ | 15,625 | 33 | 33 | 25 |

The last row shows the method's limit: an orthogonal array with 25 rows exists for $5^6$, which greedy search and our
short annealing budget do not find. FlagLens states the bound alongside the plan, so the gap is visible to the user.

# Implementation and evaluation

FlagLens is written in strict TypeScript with no runtime dependencies (the packaged extension is 62 KB). The analyses
are pure modules with no editor dependencies: the engine (about 400 lines), dead-code analysis (about 900, including
the lexer and parser), rule analysis (about 330) and covering arrays (about 250). The editor layer adds CodeLens, hovers,
decorations, diagnostics, a status-bar persona switch and Markdown reports.

**Tests.** 190 unit tests (including the randomised soundness test of Section 5 and the exhaustive size checks of
Section 6); 22 end-to-end tests that launch VS Code against a self-hosted Flagsmith 2.295.2 started by the project's
one-command dev kit, including a comparison of *Preview as* with the server's answer for the same identity, a check that
nothing is greyed where users can differ, the rule check, the test plan, and a flag dependency evaluated per identity; and the differential verifier of
Section 3.
Continuous integration runs the unit and end-to-end suites on every push, seeding Flagsmith twice to prove the seed is
idempotent.

**Integration with Flagsmith's lifecycle.** FlagLens also feeds and reads Flagsmith's own flag-management data. It
publishes every flag reference in the repository through the Code References API, in the format of Flagsmith's CI
scanner, after which Flagsmith links each flag to its files and moves it from the *new* to the *live* lifecycle stage.
It reads lifecycle stages, owners and the latest Feature Health event per flag and environment, so a flag that
monitoring has reported unhealthy is marked at every reference and in the confirmation before it is changed.

**Closing the loop.** Segment overrides and identity overrides can be edited from the editor, and every edit is
followed by the rule analysis of Section 5 on the new document. A developer who sees that an override is shadowed can
move it above the override that shadows it and watch the finding disappear; one who creates a redundant override is
told so immediately. A signed Flagsmith webhook delivers changes made elsewhere within a few seconds, so the
analyses always run on current rules.

**Performance.** On the demo project every analysis completes within a few milliseconds per document; the rule
analysis of the Production document takes 3 ms; pairwise plans with annealing finish in under 100 ms for the cases
in the table above.

# Related work

*Feature toggles.* Empirical studies characterise toggle practices, debt and removal [1, 2] and,
recently, toggle growth and lifespan in large systems [3]. Piranha [4] and PolyglotPiranha
[5] remove stale flags by AST rewriting; DoorDash's multi-agent pipeline [6] uses LLM agents
with rollout state obtained through MCP. FlagLens is complementary: it reasons about flags while code is written, and
its facts (uniform states, unreachable branches, shadowed rules) are exactly the ground truth such cleanup tools need.

*Variability-aware analysis.* Software product-line research analyses code under many configurations, for example
variability-aware parsing of preprocessor code [23] and the strategies surveyed by Thüm et al. [24].
FlagLens applies the same idea to run-time flags, with the configuration supplied by a remote service and restricted to
the facts that are certain.

*Policy anomaly analysis.* Our anomaly definitions follow firewall-policy analysis [11, 12]; FAME
[14] segments the packet space into equivalence classes, as our representatives do for traits. The differences are
the type-casting semantics of Flagsmith's operators and the opaque operators, which we handle by over-approximation.

*Combinatorial testing.* Empirical evidence that most failures are triggered by one or two parameters [15]
motivates pairwise testing; we rely on the classical binary result [16, 17], IPOG [18] and
annealing [19].

# Limitations and future work

Dead-code detection recognises common shapes rather than full language semantics (for example JSX `{flag && <X/>}`,
`switch` and values passed through other functions are left alone), but it is conservative by construction. Local
evaluation assumes composite-key hashing, the default in current Flagsmith; older environments may bucket stored
identities differently. Rule analysis is complete only without opaque operators. Natural extensions are *flag
bisection* (finding the flag, or pair of flags, behind a failing test with delta debugging [25] or adaptive
group testing, in about $\log_2 n$ runs for one culprit), *statistically safe rollouts* using always-valid sequential
tests [26, 27], and using FlagLens's proofs as oracles for automated flag removal.

# Reproducibility

Everything in this paper can be reproduced from the repository
(<https://github.com/Pranav-Singh-Devloper/flaglens>):

```bash
make up && make seed          # self-hosted Flagsmith 2.295.2 with the demo project
npm run check                 # lint, type-check, 190 unit tests
make verify-engine            # differential test against the live server
npm run test:integration -w extension   # 22 end-to-end tests in VS Code
```

# References

1. M. T. Rahman, L.-P. Querel, P. C. Rigby, B. Adams. Feature toggles: practitioner practices and a case study. In *Proc. 13th Int. Conf. on Mining Software Repositories (MSR)*, 2016.
2. J. Hoyos, R. Abdalkareem, S. Mujahid, E. Shihab, A. Espinosa Bedoya. On the removal of feature toggles: a study of Python projects and practitioners motivations. *Empirical Software Engineering* 26, 2021.
3. X. Tërnava. Feature toggle dynamics in large-scale systems: prevalence, growth, lifespan, and benchmarking. arXiv:2604.15872, 2026.
4. M. K. Ramanathan, L. Clapp, R. Barik, M. Sridharan. Piranha: reducing feature flag debt at Uber. In *Proc. ICSE Software Engineering in Practice (ICSE-SEIP)*, 2020.
5. A. Ketkar, D. Ramos, L. Clapp, R. Barik, M. K. Ramanathan. A lightweight polyglot code transformation language. *Proc. ACM Program. Lang.* 8 (PLDI), Article 199, 2024.
6. A. Chandratre, J. Datar. Automating feature flag cleanup at scale with multi-agent LLM systems: an industrial experience at DoorDash. arXiv:2610.31351, 2026.
7. Flagsmith Ltd. *Flagsmith: open-source feature flag and remote config service*, v2.295.2. <https://github.com/Flagsmith/flagsmith>, 2026.
8. W. M. McKeeman. Differential testing for software. *Digital Technical Journal* 10(1), 1998.
9. S. C. Kleene. *Introduction to Metamathematics*. North-Holland, 1952.
10. P. Cousot, R. Cousot. Abstract interpretation: a unified lattice model for static analysis of programs by construction or approximation of fixpoints. In *Proc. 4th ACM Symp. on Principles of Programming Languages (POPL)*, 1977.
11. E. Al-Shaer, H. Hamed. Discovery of policy anomalies in distributed firewalls. In *Proc. IEEE INFOCOM*, 2004.
12. E. Al-Shaer, H. Hamed, R. Boutaba, M. Hasan. Conflict classification and analysis of distributed firewall policies. *IEEE Journal on Selected Areas in Communications* 23(10), 2005.
13. G. J. Myers. *The Art of Software Testing*. Wiley, 1979.
14. H. Hu, G.-J. Ahn, K. Kulkarni. Detecting and resolving firewall policy anomalies. *IEEE Transactions on Dependable and Secure Computing* 9(3), 2012.
15. D. R. Kuhn, D. R. Wallace, A. M. Gallo. Software fault interactions and implications for software testing. *IEEE Transactions on Software Engineering* 30(6), 2004.
16. G. O. H. Katona. Two applications (for search theory and truth functions) of Sperner type theorems. *Periodica Mathematica Hungarica* 3, 1973.
17. D. J. Kleitman, J. Spencer. Families of k-independent sets. *Discrete Mathematics* 6(3), 1973.
18. Y. Lei, R. Kacker, D. R. Kuhn, V. Okun, J. Lawrence. IPOG: a general strategy for t-way software testing. In *Proc. 14th IEEE Int. Conf. on the Engineering of Computer-Based Systems (ECBS)*, 2007.
19. M. B. Cohen, C. J. Colbourn, A. C. H. Ling. Augmenting simulated annealing to build interaction test suites. In *Proc. 14th Int. Symp. on Software Reliability Engineering (ISSRE)*, 2003.
20. R. Rivest. The MD5 message-digest algorithm. RFC 1321, 1992.
21. L. Gargano, J. Körner, U. Vaccaro. Sperner capacities. *Graphs and Combinatorics* 9, 1993.
22. C. J. Colbourn. Combinatorial aspects of covering arrays. *Le Matematiche* 59, 2004.
23. C. Kästner, P. G. Giarrusso, T. Rendel, S. Erdweg, K. Ostermann, T. Berger. Variability-aware parsing in the presence of lexical macros and conditional compilation. In *Proc. OOPSLA*, 2011.
24. T. Thüm, S. Apel, C. Kästner, I. Schaefer, G. Saake. A classification and survey of analysis strategies for software product lines. *ACM Computing Surveys* 47(1), 2014.
25. A. Zeller, R. Hildebrandt. Simplifying and isolating failure-inducing input. *IEEE Transactions on Software Engineering* 28(2), 2002.
26. R. Johari, P. Koomen, L. Pekelis, D. Walsh. Peeking at A/B tests: why it matters, and what to do about it. In *Proc. ACM SIGKDD (KDD)*, 2017.
27. M. Lindon, C. Sanden, V. Shirikian. Rapid regression detection in software deployments through sequential testing. arXiv:2205.14762, 2022.
