# OpenCode Integration - AIEcoinNix

Privacy-first AI development environment on NixOS with Luffy Loop + Bright Oracle autonomous execution.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                            │
│                                                              │
│  NerdPlanner (analyzes requirements, creates plans)              │
│       │                                                      │
│       └── @librarian (research with source URLs)             │
│                                                              │
│  → Output: IMPLEMENTATION_PLAN.md with verified sources     │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                 PHASE 1: Strategic Analysis                   │
│                                                              │
│  Builder Bob delegates @oracle                                    │
│  → Bright Oracle analyzes: problem type, complexity, TODOs         │
│  → Bright Oracle decides: iterations, checkpoints                    │
│  → Bright Oracle writes plan to state via oracle-control             │
│  → Builder Bob updates plan file with iteration grouping          │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION PHASE                           │
│                                                              │
│  Builder Bob (implements code, runs tests)                       │
│       │                                                      │
│       └── @oracle + Luffy Loop (checkpoint management)       │
│           → Bright Oracle-planned checkpoints                       │
│           → Human oversight at checkpoints                   │
│                                                              │
│  → Output: Working implementation with verification          │
└─────────────────────────────────────────────────────────────┘
```

## Key Principles

1. **Separation of Concerns**: NerdPlanner researches, Builder Bob implements
2. **Ambiguity Guard**: NerdPlanner asks clarification for vague requests
3. **Source Citations**: All research includes URLs for verification
4. **Gell-Mann Resistance**: Transparency over blind trust

---

## Ambiguity Guard

NerdPlanner prevents token waste by ensuring requirements are clear before planning:

- **Obvious requests** (factual, simple creative) → Skip to planning
- **Complex/ambiguous requests** → Ask clarification questions
- **Hardware feasibility** → Warn if graphics/compute exceeds laptop constraints

---

## Tools

All tools are TypeScript source files (`.ts`). Build to JavaScript for OpenCode.

```bash
# Build all tools
cd opencode-integration
./build.sh

# Copy to OpenCode config
cp tools/*.js ~/.config/opencode/tools/
```

## Luffy Loop + Bright Oracle

### What is Luffy Loop?

Luffy Loop is an autonomous execution system with **Bright Oracle-planned checkpoints**:

- **Autonomous iterations** - Execute tasks until checkpoint
- **State persistence** - Progress saved to `~/.config/opencode/.state/sessions/{session-id}.json`
- **Planned checkpoints** - Bright Oracle decides iterations and checkpoints in Phase 1
- **Bright Oracle oversight** - Reviews at every checkpoint
- **Progress tracking** - completedTodos tracked in state

### Bright Oracle's Role

Bright Oracle is **Builder Bob's strategic advisor** (not NerdPlanner). It:

- **Phase 1:** Analyzes IMPLEMENTATION_PLAN.md, decides complexity, iterations, checkpoints
- **Phase 3:** Analyzes checkpoint metrics, makes decisions
- **Phase 4:** Verifies completion against plan
- **DECIDES:** continue / pause / adjust / terminate
- **Escalates to user** - When user input needed at checkpoints

### Problem Analysis (Phase 1)

Bright Oracle analyzes IMPLEMENTATION_PLAN.md and decides:

| Complexity | TODOs | todosPerIteration | Checkpoints |
|------------|-------|------------------|-------------|
| Trivial | 1-2 | Direct | None |
| Simple | 3-5 | 2-3 | 1-2 |
| Medium | 6-12 | 3-4 | 2-3 |
| Complex | 13-25 | 2-3 | 3-4 |
| Epic | 25+ | 1-2 | 4+ |

### Workflow

```
PHASE 1 - Analysis:
1. Builder Bob: Read IMPLEMENTATION_PLAN.md
2. Builder Bob: @oracle "Analyze plan"
3. @oracle: Analyzes, returns TODO sequence
4. @oracle: Calls oracle-control set_intervention_plan
5. Builder Bob: Updates plan file with iteration grouping
6. Builder Bob: @luffy_loop command=start

PHASE 2 - Execution:
1. Builder Bob: todowrite for current iteration TODOs
2. Builder Bob: Execute work
3. Builder Bob: @luffy_loop command=update_metrics filesChanged=X errors=Y
4. Builder Bob: @luffy_loop command=complete_todos completedTodos=["TODO 1", "TODO 2"]
5. Builder Bob: @luffy_loop command=iterate
6. Repeat until checkpoint

PHASE 3 - Checkpoint:
1. Checkpoint reached → Loop pauses
2. Builder Bob: @oracle "Checkpoint reached"
3. @oracle: Reviews metrics, uses question tool if user needed
4. @oracle: Calls oracle-control set_decision
5. Builder Bob: @luffy_loop command=resume

PHASE 4 - Verification:
1. All iterations complete
2. Builder Bob: @oracle "Verify completion"
3. @oracle: Compares against plan, reports result
4. Builder Bob: @luffy_loop command=terminate
```

**Critical:** Builder Bob NEVER uses oracle-control directly. Only @oracle subagent does.

### Metrics Tracked

- `filesChanged` - New files created per iteration
- `filesModified` - Existing files edited
- `errorsEncountered` - Errors/exceptions
- `testsPassed` / `testsFailed` - Test results
- `completedTodos` - TODOs completed this iteration

### @luffy_loop Commands

```bash
# Start a loop (reads plan from state)
@luffy_loop command=start

# Record metrics after work
@luffy_loop command=update_metrics filesChanged=2 filesModified=1 errorsEncountered=0

# Mark TODOs as completed
@luffy_loop command=complete_todos completedTodos=["Configure X", "Setup Y"]

# Advance iteration
@luffy_loop command=iterate

# Check status
@luffy_loop command=status

# Resume loop (after @oracle decision)
@luffy_loop command=resume

# Terminate loop
@luffy_loop command=terminate

# Get Bright Oracle decision from state
@luffy_loop command=get_decision
```

### @oracle Actions (via oracle-control)

```bash
# Phase 1 - Write intervention plan
oracle-control action=set_intervention_plan totalIterations=6 oracleCheckpoints=[2,4] userCheckpoints=[3,6] totalTodos=15

# Phase 3 - Set decision
oracle-control action=set_decision decision=CONTINUE reason="On track"

# Phase 4 - Verify completion
oracle-control action=verify

# Get current status
oracle-control action=status
```

### NerdPlanner + Librarian (Research Phase)

```bash
# NerdPlanner delegates to Librarian for research
@librarian query='best practices for JWT authentication 2024'

# Output: Research findings with source URLs
```

### Builder Bob + Bright Oracle (Execution Phase)

```bash
# Phase 1 - Builder Bob delegates Bright Oracle for analysis
@oracle "Analyze IMPLEMENTATION_PLAN.md"

# Bright Oracle returns:
# - Problem Type: Sequential
# - Complexity: Medium
# - totalIterations: 3
# - oracleCheckpoints: [2]
# - userCheckpoints: [3]
# - TODO Sequence: [list of todos]

# Builder Bob then updates plan file, starts loop
@luffy_loop command=start

# At checkpoint
@oracle "Checkpoint 2 reached"

# Bright Oracle reviews, decides: CONTINUE/PAUSE/ADJUST/TERMINATE
```

## Local Services

### Web Search

`/local-web` - Private local web search using SearXNG + Web Parser:

```
# Usage in OpenCode:
/local-web query='machine learning trends' deep=true
```

## Files

```
opencode-integration/
├── build.sh              # Build script (compile .ts → .js)
├── opencode.json          # OpenCode configuration
├── README.md              # This file
├── agents/               # Agent definitions (.md)
└── tools/
    ├── *.ts              # TypeScript source (IN REPO)
    └── *.js              # Compiled (GENERATED, NOT IN REPO)
```

**Note:** Only `.ts` files are committed. Build generates `.js` files.

## Installation

1. Build and install:
   ```bash
   cd opencode-integration
   ./build.sh
   cp tools/*.js ~/.config/opencode/tools/
   ```

2. Restart OpenCode to load new tools.

## Models

Available Ollama models:
- `devstral-small-2:24b-cloud` - Primary coding model (24B)
- `functiongemma:270m` - Function calling model (270M)

## Credits

- **OpenCode**: https://opencode.ai
- **Ollama**: https://ollama.com
