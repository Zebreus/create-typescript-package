#!/bin/sh

set +e

PROJECT_PATH="project"
RESOURCE_PATH="$(pwd)/resources/"
NAME="my-test-project"
VERSION="0.0.0"
DESCRIPTION="Description text"
AUTHOR_NAME="Author name"
AUTHOR_EMAIL="author@email.com"
LICENSE="MIT"

TYPE="application"
# TYPE="library"

# True if the project is the root of a git repo, false if the project is nested in another git repo.
GIT_ROOT=true
GIT_ORIGIN="git@github.com:Zebreus/create-typescript-thing.git"
GIT_MAIN_BRANCH="master"

jqi() {
    file=$1
    query=$2
    cat $file | jq --indent 2 "$query" | sponge $file
}

add_script() {
    name=$1
    content=$2
    cat package.json | jq --indent 2  '.scripts.'"$name"'="'"$content"'"' | sponge package.json 
}

append_script() {
    name=$1
    content=$2
    jqi package.json ".scripts.$name = if .scripts.$name then (.scripts.$name + \" && \" + \"$content\") else \"$content\" end"
}

add_ignore() {
    file=$1
    value=$2
    label=$3
    touch "$file"
    comment="# $label"
    comment_line="$(grep -Fxn "$comment" "$file" | cut -f1 -d: | head -n1)"
    if test -z "$comment_line"; then
        echo "$comment" >> "$file"
        echo "$value" >> "$file"
        echo "" >> "$file"
        return 0
    fi
    first_content_line=$(expr $comment_line + 1)
    content_length_maybe="$(tail "$file" -n +"$first_content_line" | grep -Pn "^(#.*)?$"  | cut -f1 -d: | head -n 1)"
    content_length="$(expr $(test -n "$content_length_maybe" && echo "$content_length_maybe" || echo 99999 ) - 1)"
    if tail "$file" -n +"$first_content_line" | head -n"$content_length" | grep -Fxn "$value" > /dev/null ; then
      # Already exists
      return 0
    fi
    insert_line=$(expr $first_content_line + $content_length)
    sed -i "$insert_line i $value" "$file"
}

add_gitignore() {
    add_ignore .gitignore "$1" "$2"
}

mkdir -p $PROJECT_PATH
cd $PROJECT_PATH

# Make sure we are inside a git repo
if $GIT_ROOT && ! test -e .git
then
    git init -b "$GIT_MAIN_BRANCH"
    if test -n "$GIT_ORIGIN"
    then
        git remote add origin "$GIT_ORIGIN"
        git pull -f --set-upstream origin "$GIT_MAIN_BRANCH"
    fi
else
    if test -n "$GIT_ORIGIN" && test "$(git remote get-url origin)" != "$GIT_ORIGIN"
    then
        echo "You specified an origin for your git repo, but the project is already a git repo with a different origin." >&2
        exit 1
    fi
fi

if ! git rev-parse --is-inside-work-tree
then
    echo "The project has to be inside a nested git repo, if GIT_ROOT is false" >&2
    exit 1
fi

# Ensure that package.json does not already exist
if test -e package.json
then
    echo "package.json already exists" >&2
    exit 1
fi

# Add nix-shell
cp "$RESOURCE_PATH"shell.nix .
git add .
git commit -m "Add nix shell"

# Initialize project
yarn init --yes
test -z "$VERSION" || jqi package.json ".version = \"$VERSION\""
test -z "$DESCRIPTION" || jqi package.json ".description = \"$DESCRIPTION\""
jqi package.json "del(.author)"
test -z "$AUTHOR_NAME" || jqi package.json ".author.name = \"$AUTHOR_NAME\""
test -z "$AUTHOR_EMAIL" || jqi package.json ".author.email = \"$AUTHOR_EMAIL\""
jqi package.json "del(.repository)"
if ! $GIT_ROOT
then
    GIT_ORIGIN="$(git remote get-url origin)"
    jqi package.json ".repository.directory = \"$(git rev-parse --show-prefix)\""
fi
if test -n "$GIT_ORIGIN"
then
    jqi package.json ".repository.type = \"git\""
    if echo "$GIT_ORIGIN" | grep -Po "^https://"
    then
        jqi package.json ".repository.url = \"$GIT_ORIGIN\""
    elif echo "$GIT_ORIGIN" | grep -Po "^git@"
    then
        value="$(echo "$GIT_ORIGIN" | sed 's/:/\//' | sed 's/^git@/https:\/\//' | sed 's/.git$//')"
        jqi package.json ".repository.url = \"$value\""
    else
        jqi package.json ".repository.url = \"$GIT_ORIGIN\""
    fi
fi
jqi package.json ".license = \"$LICENSE\""
add_gitignore "node_modules" "node"
git add .
git commit -m "Initialize node project"

# Add typescript
yarn add --dev typescript@latest
cp "$RESOURCE_PATH"tsconfig.json .
mkdir -p src
add_gitignore dist/ typescript
add_gitignore '*.tsbuildinfo' typescript
add_script "build" "tsc"
git add .
git commit -m "Install typescript"

# Add prettier
yarn add --dev prettier@latest prettier-plugin-organize-imports
cp "$RESOURCE_PATH".prettierrc.js .
add_script "format" "prettier ."
git add .
git commit -m "Install prettier"

# Add eslint
yarn add --dev eslint @types/eslint @typescript-eslint/eslint-plugin@latest @typescript-eslint/parser@latest eslint-plugin-import@latest
cp "$RESOURCE_PATH".eslintrc.json .
add_script "lint" "eslint --cache && tsc --noEmit"
add_gitignore ".eslintcache" "eslint"
git add .
git commit -m "Install eslint"

# Add jest
yarn add --dev jest@latest @types/jest@latest ts-jest@latest ts-node@latest eslint-plugin-jest@latest
cp "$RESOURCE_PATH"jest.config.js .
mkdir -p src/tests
cp "$RESOURCE_PATH"example.test.ts src/tests/example.test.ts
jqi tsconfig.json '.exclude |= (.+ ["src/tests"] | unique)'
jqi .eslintrc.json '.extends |= (.+ ["plugin:jest/recommended"] | unique)'
jqi .eslintrc.json '.rules["jest/expect-expect"] = "off"'
git add .
git commit -m "Install jest"

# Add lint-staged
yarn add --dev lint-staged@latest tsc-files@latest
cp "$RESOURCE_PATH".lintstagedrc.json .
git add .
git commit -m "Install lint-staged"

# Add husky
if $GIT_ROOT
then
  yarn add --dev husky@latest pinst@latest
  yarn husky install
  yarn husky add .husky/pre-commit "FORCE_COLOR=1 yarn lint-staged"
  add_script "postinstall" "husky install"
  add_script "prepack" "pinst --disable"
  add_script "postpack" "pinst --enable"
  git add .
  git commit -m "Install pre-commit hook"
fi

# Add vscode presets
mkdir -p .vscode
cp "$RESOURCE_PATH"extensions.json ./.vscode
cp "$RESOURCE_PATH"settings.json ./.vscode
git add .
git commit -m "Add vscode extensions and settings"

# Configure library project
if test "$TYPE" = "library"
then
  yarn add --dev @vercel/ncc@latest
  jqi package.json '.files |= (.+ ["dist/**"] | unique)'
  jqi package.json '.keywords |= (.+ ["library"] | unique)'
  jqi package.json '.main = "dist/index.js"'
  add_script "build" "ncc build --out dist --minify src/index.ts"
  append_script "prepack" "ncc build --out dist --minify src/index.ts"
  append_script "prepublish" "eslint --cache && tsc --noEmit"
  mkdir -p src
  cp "$RESOURCE_PATH"libraryIndex.ts src/index.ts
  git add .
  git commit -m "Configured project as library"
fi

# Configure executable project
if test "$TYPE" = "application"
then
  yarn add --dev @vercel/ncc@latest
  jqi package.json '.files |= (.+ ["dist/**"] | unique)'
  jqi package.json '.keywords |= (.+ ["executable", "application", "bin"] | unique)'
  jqi package.json '.main = "dist/index.js"'
  jqi package.json ".bin[\"$NAME\"] = \"dist/index.js\""
  add_script "build" "ncc build --out dist --minify src/index.ts"
  append_script "prepack" "ncc build --out dist --minify src/index.ts"
  append_script "prepublish" "eslint --cache && tsc --noEmit"
  mkdir -p src
  cp "$RESOURCE_PATH"applicationIndex.ts src/index.ts
  git add .
  git commit -m "Configured project as application"
fi