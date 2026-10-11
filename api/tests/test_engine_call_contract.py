"""Every `engine.<method>(...)` / `eng.<method>(...)` call in app.py and the
route modules must name a method ORBEngine actually defines.

These calls only run when a request or socket hits them, so a missing
method imports fine and breaks in production — 2026-10-11: Master's app.py
called `engine._register_live_client(...)` before orb_engine.py had it, so
every /ws/strategy/<id>/live connection would have failed. Static check, no
engine is constructed.

Run from api/:  python -m pytest tests/test_engine_call_contract.py
"""
import ast
import os

import pytest

import services.strategy.orb_engine as oe

API_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ENGINE_VARS = {"engine", "eng"}


def _sources():
    yield os.path.join(API_ROOT, "app.py")
    routes = os.path.join(API_ROOT, "routes")
    for name in sorted(os.listdir(routes)):
        if name.endswith(".py"):
            yield os.path.join(routes, name)


def _engine_calls():
    for path in _sources():
        tree = ast.parse(open(path).read(), filename=path)
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id in ENGINE_VARS):
                yield os.path.relpath(path, API_ROOT), node.lineno, node.func.attr


CALLS = list(_engine_calls())


def test_scan_finds_engine_calls():
    assert len(CALLS) > 10  # guards against the scan silently matching nothing


@pytest.mark.parametrize("path,line,method", CALLS, ids=[f"{p}:{l}:{m}" for p, l, m in CALLS])
def test_engine_method_exists(path, line, method):
    assert callable(getattr(oe.ORBEngine, method, None)), (
        f"{path}:{line} calls engine.{method}() but ORBEngine has no such method"
    )
