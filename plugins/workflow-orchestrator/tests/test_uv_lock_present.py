def test_lock_file_exists(plugin_root):
    lock = plugin_root / "servers" / "codex-bridge" / "uv.lock"
    assert lock.is_file(), f"Missing uv.lock: {lock}"
    assert lock.stat().st_size > 0, "uv.lock is empty"
