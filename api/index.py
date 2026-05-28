import sys
import os

# Resolve the absolute path of the backend directory and append it to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../enterprise-agent/backend"))
sys.path.append(backend_dir)

from main import app
