{ pkgs ? import <nixpkgs> {} }:

pkgs.python313.pkgs.buildPythonPackage {
  pname = "ai-services";
  version = "0.1.0";
  src = ./.;  # Package is at root level

  format = "pyproject";
  
  buildInputs = with pkgs.python313.pkgs; [
    hatchling
  ];

  
  dependencies = with pkgs.python313.pkgs; [
    fastapi uvicorn httpx beautifulsoup4 trafilatura pymupdf pdfplumber
  ];

  doCheck = false;
}
