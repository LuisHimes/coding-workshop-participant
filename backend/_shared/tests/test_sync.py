"""
Tests for sync.py: copying the shared code into feature folders, removing
stale copies, and precompiling bytecode.

Everything runs in tmp_path: SHARED_DIR and BACKEND_DIR are pointed at
temporary folders, so the real backend feature folders are never touched.
Run from backend/_shared: pytest
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

import sync

SYNC_SOURCE = Path(sync.__file__)


@pytest.fixture
def backend(tmp_path, monkeypatch):
    """A fake backend folder: a minimal _shared with every listed module and package, and two features."""
    shared = tmp_path / "_shared"
    for name in sync.MODULES:
        (shared / name).parent.mkdir(parents=True, exist_ok=True)
        (shared / name).write_text(f"NAME = {name!r}\n")
    for package in sync.PACKAGES:
        (shared / package).mkdir()
        (shared / package / "__init__.py").write_text("")
    (shared / "models" / "users.py").write_text("ROLES = ('admin', 'manager', 'employee')\n")
    (shared / "requirements.txt").write_text("fastapi\n")
    for feature in ("projects", "users"):
        (tmp_path / feature).mkdir()
        (tmp_path / feature / "function.py").write_text(f"# {feature} entry point\n")
    monkeypatch.setattr(sync, "SHARED_DIR", shared)
    monkeypatch.setattr(sync, "BACKEND_DIR", tmp_path)
    monkeypatch.setattr(sync, "LAMBDA_PYTHON", sys.version_info[:2])
    return tmp_path


def cache_of(source: Path) -> Path:
    return Path(importlib.util.cache_from_source(str(source)))


# Finding feature folders


def test_feature_dirs_are_folders_with_a_function_py(backend):
    (backend / "_template").mkdir()
    (backend / "_template" / "function.py").write_text("")  # underscore folders are not features
    (backend / ".aws-sam").mkdir()
    (backend / ".aws-sam" / "function.py").write_text("")   # nor are hidden ones
    (backend / "notes").mkdir()                              # no function.py, no Lambda
    assert [p.name for p in sync.feature_dirs()] == ["projects", "users"]


def test_shared_files_include_env_files_only_when_present(backend):
    assert ".env" not in {str(p) for p in sync.shared_files()}
    (sync.SHARED_DIR / ".env").write_text("LOG_LEVEL=DEBUG\n")
    (sync.SHARED_DIR / "models" / "__pycache__").mkdir()
    (sync.SHARED_DIR / "models" / "__pycache__" / "users.cpython-313.pyc").write_bytes(b"")
    files = {str(p) for p in sync.shared_files()}
    assert ".env" in files and "models/users.py" in files
    assert not any("__pycache__" in f for f in files)


# Copying and removing stale files


def test_first_sync_copies_everything_and_writes_a_manifest(backend):
    target = backend / "projects"
    files = sync.shared_files()
    sync.sync_feature(target, files)
    assert (target / "models" / "users.py").read_text() == "ROLES = ('admin', 'manager', 'employee')\n"
    assert json.loads((target / sync.MANIFEST).read_text()) == sorted(str(p) for p in files)


def test_stale_files_are_removed_with_their_bytecode_and_empty_folders(backend):
    target = backend / "projects"
    stale_py = target / "models" / "legacy" / "old.py"
    stale_sql = target / "migrations" / "000_dropped.sql"
    for path in (stale_py, stale_sql):
        path.parent.mkdir(parents=True)
        path.write_text("-- removed from _shared\n")
    cache_of(stale_py).parent.mkdir()
    cache_of(stale_py).write_bytes(b"bytecode")
    renamed = target / "controller" / "health.py"  # a package since renamed to controllers/
    renamed.parent.mkdir()
    renamed.write_text("# old copy\n")
    (target / "services" / "kept").mkdir(parents=True)
    (target / "services" / "kept" / "notes.txt").write_text("not ours")  # unlisted files stay
    (target / sync.MANIFEST).write_text(json.dumps(["models/legacy/old.py", "migrations/000_dropped.sql",
                                                    "controller/health.py"]))

    sync.sync_feature(target, sync.shared_files())

    assert not stale_py.exists() and not stale_sql.exists()
    assert not cache_of(stale_py).exists()
    # The emptied __pycache__ and legacy folders are removed; folders with files stay
    assert not (target / "models" / "legacy").exists()
    assert not (target / "controller").exists()  # emptied folders of packages no longer listed go too
    assert (target / "services" / "kept" / "notes.txt").exists()
    assert (target / "function.py").read_text() == "# projects entry point\n"


def test_stale_entries_already_deleted_by_hand_are_ignored(backend):
    target = backend / "projects"
    (target / sync.MANIFEST).write_text(json.dumps(["models/gone.py"]))
    sync.sync_feature(target, sync.shared_files())  # must not raise
    assert "models/gone.py" not in json.loads((target / sync.MANIFEST).read_text())


# Precompiling


def test_compile_writes_checked_hash_bytecode_for_every_module(backend):
    target = backend / "projects"
    sync.sync_feature(target, sync.shared_files())
    sources = [p for p in target.rglob("*.py")]
    assert sync.compile_feature(target) == len(sources)
    header = cache_of(target / "app.py").read_bytes()[:16]
    assert header[:4] == importlib.util.MAGIC_NUMBER
    assert header[4:8] == sync.CHECKED_HASH_FLAGS
    assert header[8:] == importlib.util.source_hash((target / "app.py").read_bytes())


def test_compile_skips_up_to_date_bytecode_and_redoes_changed_files(backend):
    target = backend / "projects"
    sync.sync_feature(target, sync.shared_files())
    sync.compile_feature(target)
    assert sync.compile_feature(target) == 0  # nothing changed
    (target / "app.py").write_text("NAME = 'edited'\n")
    assert sync.compile_feature(target) == 1
    cache_of(target / "config.py").write_bytes(b"truncated")  # corrupt cache: rebuilt
    assert sync.compile_feature(target) == 1


def test_compile_ignores_hidden_files_pycache_and_syntax_errors(backend):
    target = backend / "projects"
    (target / ".hidden.py").write_text("x = 1\n")
    (target / "__pycache__").mkdir()
    (target / "__pycache__" / "stray.py").write_text("x = 1\n")
    # Some packages ship files for other Python versions; they must not stop the build
    (target / "py2_only.py").write_text("print 'hello'\n")
    assert sync.compile_feature(target) == 1  # only function.py
    assert not cache_of(target / ".hidden.py").exists()
    assert not cache_of(target / "py2_only.py").exists()


def test_compile_does_nothing_on_a_different_python_version(backend, monkeypatch):
    monkeypatch.setattr(sync, "LAMBDA_PYTHON", (2, 7))
    target = backend / "projects"
    assert sync.compile_feature(target) == 0
    assert not cache_of(target / "function.py").exists()


# Running the script


def test_main_reports_what_it_synced(backend, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["sync.py"])
    sync.main()
    files = sync.shared_files()
    # Each feature compiles every copied .py file plus its own function.py
    per_feature = sum(1 for p in files if p.suffix == ".py") + 1
    assert capsys.readouterr().out.strip() == (
        f"Synced {len(files)} files into 2 features: projects, users ({2 * per_feature} files compiled)")
    assert (backend / "users" / "app.py").exists()


def test_main_prints_json_for_terraform(backend, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["sync.py", "--json"])
    sync.main()
    result = json.loads(capsys.readouterr().out)
    # Terraform's external data source only accepts string values
    assert result == {"features": "projects,users", "files": str(len(sync.shared_files()))}


def test_running_the_script_syncs_relative_to_its_own_folder(backend, monkeypatch, capsys):
    # Execute sync.py's real code as __main__, but as if it lived in the fake _shared folder
    monkeypatch.setattr(sys, "argv", ["sync.py", "--json"])
    code = compile(SYNC_SOURCE.read_text(), str(SYNC_SOURCE), "exec")
    exec(code, {"__name__": "__main__", "__file__": str(backend / "_shared" / "sync.py")})
    assert json.loads(capsys.readouterr().out)["features"] == "projects,users"
    assert (backend / "projects" / "models" / "users.py").exists()
