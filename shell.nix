{ pkgs ? import <nixpkgs> { } }:
with pkgs;
mkShell {
  nativeBuildInputs = [
    nodejs-18_x
    yarn
    git
    jq
    moreutils
    argbash
  ];
  shellHook = with pkgs; ''
    export PATH="$(pwd)/node_modules/.bin:$PATH"
  '';
}
