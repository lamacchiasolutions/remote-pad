#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
    echo 'Usage: prepare-extension.sh TARGET_FOLDER' >&2
    exit 2
fi

project_dir=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)
case "$1" in
    /*) target=$1 ;;
    *)  target=$PWD/$1 ;;
esac

manifest=$project_dir/chrome/manifest.json
set -- "$project_dir/chrome/chrome-store.js" "$project_dir/app/controller.js" "$project_dir/app/bindings-store.js" \
    "$project_dir/app/controller-model.js" "$project_dir/app/mapper-ui.js" "$project_dir/app/overlay.js" \
    "$project_dir/app/boot.js" "$project_dir/LICENSE" "$project_dir/EULA.md" "$project_dir/PRIVACY.md" "$manifest"
managed=false
if [ -f "$target/manifest.json" ] && [ ! -L "$target/manifest.json" ]; then
    # The original release predates the shared layout store. Permit upgrading its files.
    original_manifest=f8b6a450ea28fa75e78155bb26dba7c71e689180ae643672fac7a22b84d2ee1d
    target_digest=$(shasum -a 256 "$target/manifest.json")
    without_version() { sed -E '/^  "version": "[0-9]+(\.[0-9]+){0,3}",$/d' "$1"; }
    if [ "$(without_version "$manifest")" = "$(without_version "$target/manifest.json")" ] ||
        [ "${target_digest%% *}" = "$original_manifest" ]; then
        managed=true
    fi
fi

# Check all inputs and destination names before writing anything.
for source_file do
    if [ ! -r "$source_file" ]; then
        echo "Missing extension resource: $source_file" >&2
        exit 1
    fi
    destination=$target/${source_file##*/}
    if [ ! -L "$destination" ]; then
        [ -e "$destination" ] || continue
        if [ "$managed" = true ] && [ -f "$destination" ]; then
            continue
        fi
    fi
    echo "Choose a different folder. A file already exists at $destination" >&2
    exit 1
done

mkdir -p "$target"
for source_file do
    destination=$target/${source_file##*/}
    if ! cmp -s "$source_file" "$destination"; then
        install -S -m 644 "$source_file" "$destination"
    fi
done
