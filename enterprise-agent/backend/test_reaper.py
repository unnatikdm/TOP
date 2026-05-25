import sys
import os
import json
import time

# Add current dir to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import execute_pr_reaper, CONNECTED_TOKENS

# Set a mock token if you have one, or read GITHUB_TOKEN from env
# We'll use the user's WSL token if available, but for testing we can just run it
if os.environ.get("GITHUB_TOKEN"):
    CONNECTED_TOKENS['github'] = os.environ.get("GITHUB_TOKEN")

params = {
    "OWNER": "open-metadata",
    "REPO": "OpenMetadata",
    "STALE_DAYS": "7"
}

print("Starting PR reaper test...")
start = time.time()
try:
    results = execute_pr_reaper(params)
    print(f"Success! Finished in {time.time() - start:.2f} seconds.")
    print(json.dumps(results[:2], indent=2))
except Exception as e:
    print(f"Error occurred after {time.time() - start:.2f} seconds:")
    import traceback
    traceback.print_exc()
