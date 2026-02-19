# 🧠 SmartAssist - AI-Assisted Development Setup

Self-hosted services and OpenCode configuration for AI-assisted development.

## 🏗️ Project Architecture

### Services
Written in nix, are the list of systemd services
- Web Parser (port 18090): Content extraction - used by Opencode.
- SearXNG (port 18081): Meta-search engine - used by Perplexica.
- Perplexica (port 3000): AI research (browser-based).

### OpenCode Setup
Configured with local services for AI-assisted development
- Uses /local-web tool for web search
- /local-web connects to Web Parser (port 18090)
And other custom agents as well.

## 📁 Project Structure

```
AIEcoinNix/
├── smartassist.nix          # NixOS module
├── smartassist.nix.example  # Template (replace secrets before using)
├── README.md                # This file
├── .opencode/               # OpenCode configuration (global)
│   ├── opencode.json        # Main config
│   ├── agents/              # Agent definitions
│   │   ├── builder.md
│   │   ├── planner.md
│   │   ├── oracle.md
│   │   ├── librarian.md
│   │   ├── designer.md
│   │   ├── fixer.md
│   │   ├── researcher.md
│   │   └── search-helper.md
│   └── tools/               # Tool implementations
│       ├── luffy-loop.ts
│       ├── oracle-control.ts
│       ├── local-web.ts
│       └── lsp/             # LSP code analysis tools
└── opencode-integration/    # Backup/portable OpenCode setup
    ├── opencode.json        # Main configuration
    ├── agents/              # Agent definitions (.md)
    ├── tools/               # Tool implementations
    │   ├── *.ts            # TypeScript source (IN REPO)
    │   ├── *.js            # Compiled (GENERATED, NOT IN REPO)
    │   └── lsp/            # LSP tools (7 .ts files)
    ├── tools/luffyg5.jpg   # Luffy Loop architecture diagram
    └── build.sh             # Build script (compile TS → JS)
```

## 🛠️ Services

Self-hosted services managed by NixOS:

| Service | Port | Purpose |
|---------|------|---------|
| Perplexica | 3000 | AI research (browser-based) |
| SearXNG | 18081 | Meta-search for private web search |
| Web Parser | 18090 | Content extraction for /local-web |

## 📦 Service File

The `smartassist.nix` module provides systemd services for your AI development environment.

**Usage Options:**
- **NixOS Flake:** Import or include in `flake.nix`
- **Home Manager:** Import in `home.nix`
- **Standalone NixOS:** Import in `configuration.nix`
- **Manual Setup:** Use as reference to create your own `smartassist.service` systemd unit or shell script

**Included Services:**
- `ollama.service` - Local LLM inference
- `searx.service` - Private meta-search engine
- `perplexica.service` - AI research interface
- `web-parser.service` - Content extraction for /local-web

**Example Imports:**
```nix
# In flake.nix
smartassist.nix

# In home.nix
imports = [ ./smartassist.nix ];

# In configuration.nix
imports = [ /path/to/smartassist.nix ];
```

**Note:** Replace placeholder values (`$OLLAMA_USER`, `$PERPLEXICA_PATH`, `$SEARXNG_SECRET`) before using.

## 🤖 Agent System

### Primary Agents (Tab to switch)

| Agent | Role |
|-------|------|
| **Planner** | Creates implementation plans |
| **Builder** | Implements code |

### Subagents (@Mention to invoke)

| Agent | Role |
|-------|------|
| **@oracle** | Strategic controller |
| **@librarian** | Research specialist |
| **@designer** | UI/UX specialist |
| **@fixer** | Bug fixes |
| **@search-helper** | Web search helper |

### Tools

| Tool | Purpose |
|------|---------|
| **/luffy_loop** | Autonomous execution |
| **/oracle_control** | Oracle checkpoint reviews |
| **/local-web** | Private web search |
| **/lsp/** | LSP code analysis (7 tools) |

---

## LSP Tools

Language Server Protocol tools for code analysis and refactoring.

| Tool | Purpose |
|------|---------|
| `/lsp/diagnostics` | Check errors, warnings, hints |
| `/lsp/goto-definition` | Navigate to definitions |
| `/lsp/find-references` | Find symbol references |
| `/lsp/completion` | Code completion |
| `/lsp/code-actions` | Quick fixes |
| `/lsp/rename` | Safe renaming |

**Used by:** @fixer for verification after code fixes

**Implementation:** `opencode-integration/tools/lsp/`

---

## Luffy Loop Architecture

![Luffy Loop Architecture](opencode-integration/tools/luffyg5.jpg)

Autonomous execution with checkpoint-based progress:

- **Autonomous iterations** - Execute tasks until checkpoint or completion
- **State persistence** - Progress saved to `~/.config/opencode/.state/luffy-loop.json`
- **Oracle oversight** - Oracle reviews at every checkpoint

---

### Planner Agent

**Role:** Creates implementation plans

**Subagents:**
- **@oracle**: Strategic advice
- **@librarian**: Research with @local-web

**Tools:**
- **/local-web**: Research with private web search

---

### Builder Agent

**Role:** Implements code with autonomous execution

**Subagents:**
- **@oracle**: Checkpoint reviews
- **@librarian**: Documentation lookup

**Tools:**
- **/luffy_loop**: Autonomous execution
- **/oracle_control**: Oracle checkpoint reviews

---

## 🙏 Credits

### Web Parser Dependencies
| Project | Purpose |
|---------|---------|
| [FastAPI](https://fastapi.tiangolo.com/) | Web framework ([GitHub](https://github.com/fastapi/fastapi)) |
| [Pydantic](https://docs.pydantic.dev/) | Data validation ([GitHub](https://github.com/pydantic/pydantic)) |
| [httpx](https://www.python-httpx.org/) | HTTP client ([GitHub](https://github.com/encode/httpx)) |
| [BeautifulSoup](https://www.crummy.com/software/BeautifulSoup/) | HTML parsing ([GitHub](https://www.crummy.com/software/BeautifulSoup/)) |
| [Trafilatura](https://trafilatura.readthedocs.io/en/latest/) | Web content extraction ([GitHub](https://github.com/adbar/trafilatura)) |

### Services
| Project | Purpose |
|---------|---------|
| [SearXNG](https://searxng.github.io/searxng/) | Privacy-respecting search ([GitHub](https://github.com/searxng/searxng)) |
| [Perplexica](https://github.com/ItzCrazyKns/Perplexica) | AI research ([GitHub](https://github.com/ItzCrazyKns/Perplexica)) |

### Infrastructure
- [NixOS](https://nixos.org/) - Service deployment ([GitHub](https://github.com/NixOS/nix))
- [OpenCode](https://opencode.ai/) - AI coding interface
- [oh-my-opencode-slim](https://ohmyopencodeslim.com) - Agent framework for custom agents ([GitHub](https://github.com/alvinunreal/oh-my-opencode-slim))
