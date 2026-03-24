{ config, pkgs, lib, ... }:

let
  ###########################################################################
  # Lightpanda binary (headless browser)
  # Uses autoPatchelfHook to fix glibc paths for NixOS
  ###########################################################################
  lightpanda = pkgs.stdenv.mkDerivation {
    pname = "lightpanda";
    version = "nightly";
    src = pkgs.fetchurl {
      url = "https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux";
      sha256 = "sha256-tVEIWKfDWce3dFA9sPZ1eRob1OnJ7BBRZnztg9IBf7o=";
    };
    dontConfigure = true;
    dontBuild = true;
    dontUnpack = true;
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    installPhase = ''
      mkdir -p $out/bin
      cp $src $out/bin/lightpanda
      chmod +x $out/bin/lightpanda
    '';
  };

  ###########################################################################
  # AI Services – Web Parser + PDF Extractor + RAG (port 18090)
  # Source files at /etc/nixos/ai-services
  ###########################################################################
  
  # Ragdb as nix derivation (from PyPI wheel)
  ragdb = pkgs.stdenv.mkDerivation {
    pname = "ragdb";
    version = "1.0.6";
    src = pkgs.fetchurl {
      url = "https://files.pythonhosted.org/packages/ragdb-1.0.6-py3-none-any.whl";
      sha256 = "sha256-H81pfhwCeOz05XQ1S+YYuXZr1kwHHllKOwAiLbCFN0g=";
    };
    dontConfigure = true;
    dontBuild = true;
    unpackPhase = ''
      mkdir -p $out/lib/python3.13/site-packages
      unzip -q $src -d $out/lib/python3.13/site-packages
    '';
    installPhase = "true";
  };

  # Python env - all packages from nix including ragdb derivation
  ai-services-python = pkgs.python313.withPackages (ps: with ps; [
    fastapi uvicorn httpx beautifulsoup4 trafilatura pymupdf pdfplumber
    pytesseract pillow
    ragdb
  ]);

  # Wrapper script - uses nix python with LD_LIBRARY_PATH for libstdc++
  ai-services-runner = pkgs.writeScriptBin "ai-services-runner" ''
    #!/bin/sh
    SRC_DIR="/etc/nixos/ai-services"
    export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    export SSL_CERT_DIR="${pkgs.cacert}/etc/ssl/certs"
    export REQUESTS_CA_BUNDLE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    # Fix for libstdc++ - needed for numpy/ragdb
    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:$LD_LIBRARY_PATH"
    
    export PYTHONPATH="$SRC_DIR"
    cd "$SRC_DIR"
    exec ${ai-services-python}/bin/python main.py
  '';

in
{
  ###########################################################################
  # 1.  OLLAMA  – CPU only, LAN reachable for phone app
  ###########################################################################
  services.ollama = {
    enable       = true;
    acceleration = false;
    environmentVariables = {
      OLLAMA_HOST = "0.0.0.0:11434";
      OLLAMA_KEEP_ALIVE = "0";
    };
   };
  systemd.services.ollama = {
    serviceConfig.MemoryMax = "8G";
    wantedBy = lib.mkForce [ ];
  };


 ###########################################################################
 # PERPLEXICA – AI-Powered Research Engine (port 3000)
 # FINAL VERSION: For use AFTER manual 'npm run build'
 ###########################################################################
 systemd.services.perplexica = {
   enable = true;
   wantedBy = [ ]; # Start manually with `assist`
   after = [ "network-online.target" "searx.service" ];
   wants = [ "network-online.target" "searx.service" ];
   # The service only needs Node.js at runtime
   path = with pkgs; [ nodejs_20 ];
   environment = {
     SEARXNG_URL = "http://127.0.0.1:18081";
     OLLAMA_API_URL = "http://127.0.0.1:11434";
     NODE_ENV = "production";
     PORT = "3000";
   };
   serviceConfig = {
     Type = "simple";
      User = "dharrun";
      WorkingDirectory = "/home/dharrun/Perplexica";
     # CORRECT COMMAND: Start the Next.js production server
     ExecStart = "${pkgs.nodejs_20}/bin/node node_modules/.bin/next start";
     Restart = "on-failure";
     RestartSec = "10s";
     MemoryMax = "4G";
   };
  };

  ###########################################################################
  # 2.  YT-DLP  – YouTube transcript extraction
  ###########################################################################
  environment.systemPackages = with pkgs; [
    yt-dlp
    lightpanda
    tesseract tesseract4 tesseract5
  ];

  ###########################################################################
  # 3.  SEARXNG  – Privacy-focused meta search engine
  ###########################################################################
  services.searx = {
   enable = true;
   settings = {
     server = {
       port = 18081;  # Different port from Open WebUI (18080)
       bind_address = "127.0.0.1";
       # Generate with: openssl rand -hex 32
       secret_key = "$SEARXNG_SECRET";  # ⚠️ REPLACE with: openssl rand -hex 32
     };
     search = {
       formats = ["html" "json"];  # JSON is crucial for your API
       safesearch = 0;  # 0=off, 1=moderate, 2=strict
       autocomplete = "duckduckgo";
     };
     engines = [
       {
         name = "duckduckgo";
         engine = "duckduckgo";
         shortcut = "ddg";
         disabled = false;
       }
       {
         name = "startpage";
         engine = "startpage";
         shortcut = "sp";
         disabled = false;
       }
       {
         name = "qwant";
         engine = "qwant";
         shortcut = "qw";
         disabled = false;
       }
       {
         name = "wikipedia";
         engine = "wikipedia";
         shortcut = "wp";
         disabled = false;
       }
     ];
     limiter = {
       enabled = true;
       proxy_strategy = "forward";
     };
   };
 };

 # Add this systemd override for SearXNG
 systemd.services.searx = {
   # This prevents it from starting at boot or with 'multi-user.target'
   wantedBy = lib.mkForce [ ];
   # Optional: Also stop it from starting on system boot-up phases
   before = lib.mkForce [ ];
 };

   ###########################################################################
   # 4. AI SERVICES – Web Parser + PDF Extractor + RAG (port 18090)
   ###########################################################################
  systemd.user.services.ai-services = {
    wantedBy = [ ];
    description = "AI Services - Web Parser, PDF Extractor, RAG (port 18090)";
    after = [ "network-online.target" ];
    serviceConfig = {
      Type = "simple";
      ExecStart = "${ai-services-runner}/bin/ai-services-runner";
      Restart = "on-failure";
      RestartSec = "10s";
      MemoryMax = "1G";
    };
  };

  ###########################################################################
  # 5. GUARD – user service, watches port 18080
  ###########################################################################
  systemd.user.services.ollama-guard = {
    wantedBy = [ ];
    description = "Tab watcher (user mode)";
    script = ''
      echo "👀 Guard: waiting 15s for perplexica to start…"
      sleep 15
      echo "👀 Guard: monitoring Perplexica…"
      while ! ${pkgs.curl}/bin/curl -s http://localhost:3000 > /dev/null; do sleep 8; done
      echo "👀 Guard: perplexica detected, waiting for tab close…"
      while [ $(${pkgs.iproute2}/bin/ss -tlnp | grep -c '"'"':3000'"'"') -gt 0 ]; do sleep 20; done
      echo "👀 Guard: No tabs left, shutting down…"
      systemctl stop perplexica
      sudo systemctl stop ollama
      echo "  ✓ Ollama stopped"
      sudo systemctl stop searx
      echo "  ✓ Searxng stopped"
      systemctl stop --user ai-services ollama-guard
      echo "  ✓ User services stopped"
      echo "👀 Guard: All services stopped. Exiting."
    '';
  };

   ###########################################################################
   # 6. ALIASES – no sudo, user commands only
   ###########################################################################
   environment.shellAliases = {
    assist = lib.concatStringsSep " && " [
      "echo '🚀 Starting LLM & Research services…'"
      "echo '  → Reloading systemd (for new services)…'"
      "systemctl --user daemon-reload"
      "sleep 1"
      "echo '  → SearXNG (search engine)…'"
      "sudo systemctl start searx"
      "sleep 2"
      "echo '  → Ollama (model host)…'"
      "sudo systemctl start ollama"
      "sleep 5" # Increased sleep for Ollama to fully initialize
      "echo '  → AI Services (Web Parser, PDF, RAG)…'"
      "systemctl --user start ai-services"
      "sleep 2"
      "echo '  → Perplexica (research engine)…'"
      "sudo systemctl start perplexica"
      "sleep 3"
      "echo '  → Tab guard (auto-stop watcher)…'"
      "systemctl --user start ollama-guard"
      "echo '✅ All services running.'"
      "echo '   • AI Services: http://localhost:18090'"
      "echo '   • Perplexica (Research): http://localhost:3000'"
    ];

    assist-close = lib.concatStringsSep " && " [
      "echo '🔴 Force-stopping LLM services…'"
      "echo '  → Stopping Perplexica…'"
      "sudo systemctl stop perplexica"
      "echo '  ✓ Perplexica stopped'"
      "systemctl --user stop ai-services"
      "echo '  ✓ AI Services stopped'"
      "systemctl --user stop ollama-guard"
      "echo '  ✓ Guard stopped'"
      "sudo systemctl stop searx"
      "echo '  ✓ SearXNG stopped'"
      "sudo systemctl stop ollama"
      "echo '  ✓ Ollama stopped (model unloaded)'"
      "echo '🟢 All services stopped.'"
    ];
  };

   ###########################################################################
   # 7. FIREWALL – allow Ollama (11434) and user ports (18080-18090)
   ###########################################################################
    networking.firewall.allowedTCPPorts = [ 11434 18081 18090 3000 ];
}


