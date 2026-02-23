# OpenCode Integration - AIEcoinNix

Privacy-first AI development environment on NixOS with Luffy Loop + Oracle autonomous execution.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                            │
│                                                              │
│  Planner (analyzes requirements, creates plans)              │
│       │                                                      │
│       └── @librarian (research with source URLs)             │
│                                                              │
│  → Output: IMPLEMENTATION_PLAN.md with verified sources     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION PHASE                           │
│                                                              │
│  Builder (implements code, runs tests)                       │
│       │                                                      │
│       └── @oracle + Luffy Loop (checkpoint management)       │
│           → Convergence-based dynamic intervals              │
│           → Human oversight at checkpoints                   │
│                                                              │
│  → Output: Working implementation with verification          │
└─────────────────────────────────────────────────────────────┘
```

## Key Principles

1. **Separation of Concerns**: Planner researches, Builder implements
2. **Ambiguity Guard**: Planner asks clarification for vague requests
3. **Source Citations**: All research includes URLs for verification
4. **Gell-Mann Resistance**: Transparency over blind trust

---

## Ambiguity Guard

Planner prevents token waste by ensuring requirements are clear before planning:

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

## Luffy Loop + Oracle

### What is Luffy Loop?

Luffy Loop is an autonomous execution system with **convergence-based dynamic checkpoints**:

- **Autonomous iterations** - Execute tasks until checkpoint
- **State persistence** - Progress saved to `~/.config/opencode/.state/luffy-loop.json`
- **Dynamic intervals** - Checkpoint interval adapts based on progress (1-7 iterations)
- **Oracle oversight** - Reviews at every checkpoint

### Dynamic Checkpoint Intervals

Oracle calculates next checkpoint based on convergence score:

| Convergence Score | Interval | Meaning |
|-------------------|----------|---------|
| > 2.0 | 7 | Excellent progress - check less |
| 1.0 - 2.0 | 5 | Good progress - standard |
| 0.5 - 1.0 | 3 | Slow progress - more checks |
| < 0.5 | 2 | Poor progress - frequent |
| 0 (stuck) | 1 | No progress - immediate |

### Oracle's Role

Oracle is **Builder-only** (not Planner). It:

- **Analyzes checkpoint metrics** - progressRate, errorRate, convergenceScore
- **DECIDES**: continue / pause / terminate
- **Stops wrong direction** - Terminates loops going off-track
- **Protects free tier** - Terminates wasteful iterations
- **Escalates to user** - When uncertain

### Workflow

```
1. Builder: @luffy_loop command=start prompt="..." maxIterations=15
2. Builder: @luffy_loop command=iterate (repeatedly)
3. Checkpoint reached → Loop auto-pauses → CHECKPOINT_SIGNAL
4. Builder: @oracle "Checkpoint X reached. What should I do?"
5. @oracle: Analyzes metrics, returns decision with reasoning
6. Builder: @luffy_loop command=set_decision decision=CONTINUE reason="..."
7. Builder: @luffy_loop command=resume
8. Repeat until complete
```

**Critical:** Builder NEVER uses oracle-control directly. Only @oracle subagent does.

### Metrics Tracked

- `filesChanged` - New files created per iteration
- `filesModified` - Existing files edited
- `errorsEncountered` - Errors/exceptions
- `testsPassed` / `testsFailed` - Test results

**Calculated by Tool:**
- `progressRate` = files per iteration
- `errorRate` = errors per iteration
- `convergenceScore` = progressRate / (errorRate + 1)

### Commands

```bash
# Start a loop
@luffy_loop command=start prompt="Build authentication API" maxIterations=15 checkpointInterval=5

# Record metrics after work
@luffy_loop command=update_metrics filesChanged=2 filesModified=1 errorsEncountered=0

# Check if at checkpoint
@luffy_loop command=check_checkpoint

# Advance iteration
@luffy_loop command=iterate

# Check status
@luffy_loop command=status

# Resume loop (after @oracle says CONTINUE)
@luffy_loop command=resume

# Terminate loop (after @oracle says TERMINATE)
@luffy_loop command=terminate

# Get Oracle decision from state
@luffy_loop command=get_decision

# Write Oracle decision to state
@luffy_loop command=set_decision decision=CONTINUE reason="Good progress"
```

### Planner + Librarian (Research Phase)

```bash
# Planner delegates to Librarian for research
@librarian query='best practices for JWT authentication 2024'

# Output: Research findings with source URLs
```

### Builder + Oracle (Execution Phase)

```bash
# At checkpoint, Builder invokes Oracle
@oracle "Checkpoint 5/10 reached. Convergence: 2.5. Continue?"

# Oracle returns decision:
# Decision: CONTINUE
# Next Checkpoint: Iteration 10 (interval: 5)
# Reason: Convergence score 2.5 indicates good progress

# Builder then:
@luffy_loop command=set_decision decision=CONTINUE reason="Convergence: 2.5"
@luffy_loop command=resume
```

### Workflow

```
1. Builder starts: @luffy_loop command=start prompt="..."
2. Luffy iterates: @luffy_loop command=iterate
3. Checkpoint reached → Loop auto-pauses → CHECKPOINT_SIGNAL
4. Builder invokes: @oracle "Checkpoint X reached. What should I do?"
5. @oracle internally uses /oracle_control, decides: CONTINUE/PAUSE/TERMINATE
6. @oracle returns decision with reasoning
7. Builder executes: /luffy_loop command=resume (or terminate)
8. Repeat until complete
```

**Critical:** Builder NEVER uses /oracle_control directly. Only @oracle subagent uses it internally.

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
