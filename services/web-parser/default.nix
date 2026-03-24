{ config, pkgs, lib, ... }:

let
  ai-services = pkgs.python313.withPackages (ps: with ps; [
    fastapi uvicorn httpx beautifulsoup4 trafilatura
    pymupdf pdfplumber
    # ragdb  # Add when available in nixpkgs
  ]);
in

{
  options.ai-services = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable AI Services (Web Parser, PDF, RAG)";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 18090;
      description = "Port for AI Services";
    };
  };

  config = lib.mkIf config.ai-services.enable {
    systemd.user.services.ai-services = {
      wantedBy = [ ];
      description = "AI Services - Web Parser, PDF Extractor, RAG";
      serviceConfig = {
        Type = "simple";
        ExecStart = "${ai-services}/bin/python -m ai_services.main";
        Restart = "on-failure";
        RestartSec = "10s";
        Environment = "PORT=${toString config.ai-services.port}";
      };
    };

    environment.systemPackages = with pkgs; [
      yt-dlp
      tesseract tesseract5 tesseract4 tesseract5-langs
    ];
  };
}
