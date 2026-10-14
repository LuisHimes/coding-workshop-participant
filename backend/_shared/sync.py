"""
Copies the shared backend code into every feature folder.

Each feature area (backend/auth, backend/projects, ...) is its own Lambda, and
Terraform and LocalStack only see the files inside that Lambda's folder. This
script copies the code from backend/_shared into each folder that has a
function.py, along with requirements.txt and the local .env files.

Terraform runs it automatically before packaging (infra/lambda.tf). Run it
yourself after editing shared code during local development, so LocalStack's
hot reload picks up the change:

    python3 backend/_shared/sync.py

Copies are not committed (each feature folder's .gitignore keeps only
function.py, requirements.txt and .gitignore). A manifest in each folder
records what was copied, so files deleted here are removed there too.

It also precompiles every .py file in each folder to bytecode. Lambda's code
folder is read-only, so without .pyc files Python recompiles every module on
every cold start. The .pyc files are "checked-hash": Python checks them
against the source's hash rather than its timestamp (the zip packager resets
timestamps), and ignores them if the source differs.
"""

import importlib.util
import json
import py_compile
import shutil
import sys
from pathlib import Path

SHARED_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SHARED_DIR.parent
MANIFEST = ".synced"

# What a Lambda needs. Listed explicitly so tests, tooling and the packages
# start-dev.sh installs here are never copied.
MODULES = ["app.py", "config.py", "database.py", "dependencies.py", "middleware.py"]
PACKAGES = ["controller", "migrations", "models", "repository", "service"]
ENV_FILES = [".env.development", ".env"]

# The Lambda runtime (infra/locals.tf); .pyc files only work for the Python version that wrote them
LAMBDA_PYTHON = (3, 13)
CHECKED_HASH_FLAGS = (0b11).to_bytes(4, "little")


def shared_files() -> list[Path]:
    """Paths, relative to backend/_shared, of everything a feature Lambda needs."""
    files = [SHARED_DIR / name for name in MODULES]
    for package in PACKAGES:
        files += [p for p in (SHARED_DIR / package).rglob("*")
                  if p.is_file() and "__pycache__" not in p.parts]
    files += [SHARED_DIR / name for name in ENV_FILES if (SHARED_DIR / name).exists()]
    files.append(SHARED_DIR / "requirements.txt")
    return sorted(p.relative_to(SHARED_DIR) for p in files)


def feature_dirs() -> list[Path]:
    return sorted(p.parent for p in BACKEND_DIR.glob("*/function.py") if not p.parent.name.startswith(("_", ".")))


def sync_feature(target: Path, files: list[Path]) -> None:
    manifest = target / MANIFEST
    previous = set(json.loads(manifest.read_text())) if manifest.exists() else set()
    current = {str(path) for path in files}

    # Remove files that no longer exist in the shared code, with their bytecode
    for stale in previous - current:
        (target / stale).unlink(missing_ok=True)
        if stale.endswith(".py"):
            Path(importlib.util.cache_from_source(str(target / stale))).unlink(missing_ok=True)
    for package in PACKAGES:
        for directory in sorted((target / package).rglob("*"), reverse=True) if (target / package).exists() else []:
            if directory.is_dir() and not any(directory.iterdir()):
                directory.rmdir()

    for path in files:
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SHARED_DIR / path, destination)
    manifest.write_text(json.dumps(sorted(current), indent=1))


def compile_feature(target: Path) -> int:
    """
    Writes checked-hash .pyc files for the folder's code and installed packages,
    skipping files whose .pyc already matches. Returns how many were compiled.
    """
    if sys.version_info[:2] != LAMBDA_PYTHON:
        return 0  # bytecode from another Python version would be ignored by Lambda
    compiled = 0
    for source in target.rglob("*.py"):
        if "__pycache__" in source.parts or source.name.startswith("."):
            continue
        cache = Path(importlib.util.cache_from_source(str(source)))
        expected = importlib.util.MAGIC_NUMBER + CHECKED_HASH_FLAGS + importlib.util.source_hash(source.read_bytes())
        try:
            if cache.read_bytes()[:16] == expected:
                continue
        except OSError:
            pass
        try:
            py_compile.compile(str(source), cfile=str(cache), doraise=True,
                               invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH)
            compiled += 1
        except py_compile.PyCompileError:
            pass  # some packages ship files for other Python versions; Lambda never imports them
    return compiled


def main() -> None:
    files = shared_files()
    targets = feature_dirs()
    compiled = 0
    for target in targets:
        sync_feature(target, files)
        compiled += compile_feature(target)
    if "--json" in sys.argv:
        # Terraform's external data source expects a JSON object of strings
        print(json.dumps({"features": ",".join(t.name for t in targets), "files": str(len(files))}))
    else:
        print(f"Synced {len(files)} files into {len(targets)} features: {', '.join(t.name for t in targets)}"
              f" ({compiled} files compiled)")


if __name__ == "__main__":
    main()
