let
  unstable = import (fetchTarball https://nixos.org/channels/nixos-unstable/nixexprs.tar.xz) { };
in
{ pkgs ? import <nixpkgs> { } }:
with pkgs;
mkShell {
  nativeBuildInputs = [
    unstable.nodejs
    unstable.yarn
    git
    jq
    moreutils
  ];
  shellHook = with pkgs; ''
    export PATH="$(pwd)/node_modules/.bin:$PATH"
  '';
}

