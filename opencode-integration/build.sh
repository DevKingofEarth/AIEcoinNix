#!/usr/bin/env bash
set -e

# Build script for OpenCode tools
# Compiles TypeScript tools to JavaScript for OpenCode
# Usage: ./build.sh

echo "🔧 Building OpenCode tools..."

# Check if @opencode-ai/plugin is available
PLUGIN_FOUND=false

# Check if we're in ~/.config/opencode
if [ "$(pwd)" = "$HOME/.config/opencode" ]; then
    if [ -d "node_modules/@opencode-ai/plugin" ]; then
        PLUGIN_FOUND=true
        echo "📦 Using local node_modules (@opencode-ai/plugin found)"
    fi
else
    # Check if ~/.config/opencode has node_modules
    if [ -d "$HOME/.config/opencode/node_modules/@opencode-ai/plugin" ]; then
        PLUGIN_FOUND=true
        echo "📦 Using global @opencode-ai/plugin from ~/.config/opencode"
    fi
fi

if [ "$PLUGIN_FOUND" = false ]; then
    echo ""
    echo "❌ ERROR: @opencode-ai/plugin not found!"
    echo ""
    echo "The @opencode-ai/plugin module is required to build tools."
    echo ""
    echo "Ensure you have OpenCode installed and configured:"
    echo "  - OpenCode should be at: ~/.config/opencode"
    echo "  - node_modules/@opencode-ai/plugin should exist"
    echo ""
    echo "If OpenCode is installed elsewhere, copy the node_modules:"
    echo "  cp -r /path/to/opencode/node_modules ~/.config/opencode/"
    echo ""
    exit 1
fi

# Check if bun is available
if command -v bun &> /dev/null; then
    echo "📦 Compiling tools with bun..."
    
    bun build tools/local-web.ts --outfile tools/local-web.js --target node
    bun build tools/local-services-start.ts --outfile tools/local-services-start.js --target node
    bun build tools/local-services-status.ts --outfile tools/local-services-status.js --target node
    bun build tools/luffy-loop.ts --outfile tools/luffy-loop.js --target node
    bun build tools/oracle-control.ts --outfile tools/oracle-control.js --target node
    bun build tools/loop-state.ts --outfile tools/loop-state.js --target node
    
    echo "✅ All tools compiled successfully"
else
    # Use nix-shell with bun from nixpkgs
    echo "📦 Using nix-shell with bun..."
    nix-shell -p bun --run "cd $(pwd) && bun build tools/*.ts --outdir tools/ --target node"
    echo "✅ All tools compiled successfully"
fi

echo ""
echo "📁 Compiled files:"
ls -lh tools/*.js 2>/dev/null || echo "No .js files found"

echo ""
echo "📋 Next steps:"
echo "1. Copy compiled tools to your OpenCode config:"
echo "   cp tools/*.js ~/.config/opencode/tools/"
echo ""
echo "2. Or release the tools/ directory as pre-built artifacts"
