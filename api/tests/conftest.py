"""Shared test setup: run from api/ (`python -m pytest tests`) with the api
root importable, the same way the app imports its modules."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
