# Setup Guide - NixOS + OpenCode

Complete setup instructions for AI-assisted development environment with Luffy Loop + Oracle architecture.

---

## 1. NixOS Services Setup

### Prerequisites
- NixOS with flakes enabled
- Git access

### Installation

#### Option A: Import as NixOS Module

Add to your `configuration.nix`:

```nix
{ config, pkgs, ... }:

{
  imports = [
    ./path/to/smartassist.nix
  ];
  
  # Or import from this repo
  imports = [
    (builtins.fetchGit {
      url = "https://github.com/DevKingofEarth/AIEcoinNix";
      ref = "main";
    } + "/smartassist.nix")
  ];
}
```

#### Option B: Manual Service Setup

1. **Copy service definitions:**
```bash
sudo cp smartassist.nix /etc/nixos/
```

2. **Edit configuration.nix:**
```nix
imports = [ /etc/nixos/smartassist.nix ];
```

3. **Replace placeholders** in smartassist.nix:
   - `$OLLAMA_USER` → your username
   - `$PERPLEXICA_PATH` → path to Perplexica installation
   - `$SEARXNG_SECRET` → generate with: `openssl rand -base64 33`

4. **Rebuild NixOS:**
```bash
sudo nixos-rebuild switch
```

#### Option C: Home Manager

Add to `home.nix`:

```nix
imports = [
  ./path/to/smartassist.nix
];
```

### Verify Services

```bash
# Check all services are running
systemctl status ollama
systemctl status searx
systemctl status perplexica
systemctl status web-parser

# Test Web Parser
curl http://localhost:18090

# Test SearXNG
curl http://localhost:18081
```

---

## 2. OpenCode Setup

### Prerequisites
- OpenCode installed: https://opencode.ai
- Node.js 20+ and Bun

### Installation

#### Step 1: Clone Repository

```bash
git clone https://github.com/DevKingofEarth/AIEcoinNix.git
cd AIEcoinNix/opencode-integration
```

#### Step 2: Build Tools

```bash
# Compile TypeScript to JavaScript
./build.sh

# Or manually with Bun
bun build tools/luffy-loop.ts --outdir=tools --target=node
bun build tools/oracle-control.ts --outdir=tools --target=node
bun build tools/local-web.ts --outdir=tools --target=node
```

#### Step 3: Install to OpenCode Config

```bash
# Create directories if needed
mkdir -p ~/.config/opencode/tools
mkdir -p ~/.config/opencode/agents
mkdir -p ~/.config/opencode/.state

# Copy compiled tools
cp tools/*.js ~/.config/opencode/tools/

# Copy agents
cp agents/*.md ~/.config/opencode/agents/

# Copy main config
cp opencode.json ~/.config/opencode/
```

#### Step 4: Configure Agent Permissions

Edit `~/.config/opencode/opencode.json`:

```json
{
  "agents": {
    "builder": {
      "mode": "primary",
      "file": "agents/builder.md"
    },
    "planner": {
      "mode": "primary",
      "file": "agents/planner.md"
    },
    "oracle": {
      "mode": "subagent",
      "file": "agents/oracle.md"
    },
    "librarian": {
      "mode": "subagent",
      "file": "agents/librarian.md"
    },
    "designer": {
      "mode": "subagent",
      "file": "agents/designer.md"
    },
    "fixer": {
      "mode": "subagent",
      "file": "agents/fixer.md"
    }
  },
  "tools": {
    "luffy_loop": {
      "file": "tools/luffy-loop.js"
    },
    "oracle_control": {
      "file": "tools/oracle-control.js"
    },
    "local_web": {
      "file": "tools/local-web.js"
    }
  }
}
```

#### Step 5: Restart OpenCode

```bash
# Kill existing OpenCode processes
pkill opencode

# Restart (method depends on your installation)
opencode
# or
npx opencode
```

---

## 3. LSP Tools (Optional)

For code analysis and refactoring:

```bash
# Build LSP tools
cd opencode-integration/tools/lsp

# Compile all
for file in *.ts; do
  bun build "$file" --outdir=. --target=node
done

# Copy to OpenCode
cp *.js ~/.config/opencode/tools/lsp/
```

---

## 4. Verification

### Test Local Services

```bash
# Start services
sudo systemctl start web-parser searx perplexica

# Test web search
@local-web query='test search'
```

### Test Luffy Loop

```bash
# Start a simple task
@luffy_loop command=start prompt="Create hello world script" maxIterations=3 checkpointInterval=2

# Iterate
@luffy_loop command=iterate

# At checkpoint, @oracle should be invoked automatically
# (per new builder.md instructions)
```

### Test Oracle Subagent

```bash
# Manual invocation test
@oracle "Test: What is the best way to structure a Python CLI?"

# Should engage @librarian and return strategic advice
```

---

## 5. Architecture Overview

### How It Works

```
User Request
    ↓
Builder (primary) receives task
    ↓
Delegates to @oracle for strategy
    ↓
@oracle plans, creates TODO
    ↓
Builder starts /luffy_loop
    ↓
Luffy iterates autonomously
    ↓
Checkpoint reached → CHECKPOINT_SIGNAL
    ↓
Builder invokes @oracle (NOT /oracle_control directly!)
    ↓
@oracle uses /oracle_control internally
    ↓
@oracle decides: CONTINUE/PAUSE/TERMINATE
    ↓
Builder executes @oracle's decision
    ↓
Repeat until <promise>DONE</promise>
```

**Critical:** Builder NEVER calls `/oracle_control` tool. Only `@oracle` subagent uses it internally.

---

## 6. Troubleshooting

### Services Not Starting

```bash
# Check logs
journalctl -u web-parser -n 50
journalctl -u searx -n 50

# Verify ports not in use
ss -tlnp | grep -E '18090|18081|3000'
```

### OpenCode Can't Find Tools

```bash
# Verify tools compiled
ls ~/.config/opencode/tools/*.js

# Check opencode.json syntax
jq . ~/.config/opencode/opencode.json
```

### Agent Not Loading

```bash
# Verify agent files exist
ls ~/.config/opencode/agents/*.md

# Check file permissions
chmod 644 ~/.config/opencode/agents/*.md
```

### Luffy Loop State Issues

```bash
# Reset state
rm ~/.config/opencode/.state/luffy-loop.json

# Verify state directory exists
mkdir -p ~/.config/opencode/.state
```

---

## 7. Update Procedure

### Update from Repository

```bash
cd ~/Projects/AIEcoinNix  # or wherever you cloned

git pull origin main

# Rebuild tools
cd opencode-integration
./build.sh

# Copy updates
cp tools/*.js ~/.config/opencode/tools/
cp agents/*.md ~/.config/opencode/agents/

# Restart OpenCode
pkill opencode && opencode
```

---

## 8. File Locations Summary

| Component | Source | Destination |
|-----------|--------|-------------|
| NixOS Services | `smartassist.nix` | `/etc/nixos/` or flake import |
| OpenCode Config | `opencode.json` | `~/.config/opencode/` |
| Agent Definitions | `agents/*.md` | `~/.config/opencode/agents/` |
| Tool Source | `tools/*.ts` | `~/.config/opencode/tools/*.js` (compiled) |
| LSP Tools | `tools/lsp/*.ts` | `~/.config/opencode/tools/lsp/*.js` |
| Luffy State | Auto-generated | `~/.config/opencode/.state/luffy-loop.json` |

---

## Credits

- **OpenCode**: https://opencode.ai
- **NixOS**: https://nixos.org
- **Perplexica**: https://github.com/ItzCrazyKns/Perplexica
- **SearXNG**: https://github.com/searxng/searxng
