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
- **State persistence** - Progress saved to `.opencode/luffy-loop.json`
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

# Oracle reviews checkpoint
@oracle action=review

# Oracle finalizes decision
@oracle action=recommend recommendation=continue

# Resume loop
@luffy_loop command=resume

# Terminate loop
@luffy_loop command=terminate
```

### Workflow

```
1. @luffy_loop command=start prompt="..."
2. @luffy_loop command=iterate (advances iterations)
3. Checkpoint reached → Loop auto-pauses
4. @oracle action=review → Oracle analyzes progress
5. Oracle DECIDES: continue/pause/terminate
6. @oracle action=recommend recommendation=[...]
7. @luffy_loop command=resume
8. Repeat until complete
```

## Local Services

### Web Search

`local-web.ts` - Private local web search using SearXNG + Web Parser:

```typescript
// Usage in OpenCode:
@local-web query='machine learning trends' deep=true
```

### Service Management

- `local-services-start.ts` - Start local AI services
- `local-services-status.ts` - Check service status

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
