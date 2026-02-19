# OpenCode Integration - AIEcoinNix

Privacy-first AI development environment on NixOS with Luffy Loop + Oracle autonomous execution.

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

Luffy Loop is an autonomous execution system with checkpoint-based progress:

- **Autonomous iterations** - Execute tasks until checkpoint or completion
- **State persistence** - Progress saved to `~/.config/opencode/.state/luffy-loop.json`
- **Oracle oversight** - Oracle reviews at every checkpoint

### Oracle's Role

Oracle controls Luffy Loop at checkpoints:

- **DECIDES**: continue / pause / terminate
- **Stops wrong direction** - Terminates loops going off-track
- **Protects free tier** - Terminates wasteful iterations
- **Escalates to user** - When Oracle struggles to decide

### Commands

```bash
# Start a loop
@luffy_loop command=start prompt="Build authentication API" maxIterations=15 checkpointInterval=5

# Check status
@luffy_loop command=status

# Advance iteration
@luffy_loop command=iterate

# Resume loop (after @oracle says CONTINUE)
@luffy_loop command=resume

# Terminate loop (after @oracle says TERMINATE)
@luffy_loop command=terminate
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
