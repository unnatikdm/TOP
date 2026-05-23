#!/usr/bin/env python3
import sys
import os
import subprocess
import jinja2

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")

def run_skill(skill_id, params):
    file_path = os.path.join(SKILLS_DIR, f"{skill_id}.sql")
    if not os.path.exists(file_path):
        print(f"Error: Skill '{skill_id}' not found.")
        return

    with open(file_path, "r") as f:
        template_str = f.read()

    template = jinja2.Template(template_str)
    # Parse key=value pairs from params
    param_dict = {}
    for p in params:
        if "=" in p:
            k, v = p.split("=", 1)
            param_dict[k] = v

    query = template.render(**param_dict)
    
    print(f"--- Executing {skill_id} ---")
    print(f"Query: {query[:100]}...")
    
    try:
        result = subprocess.run(["coral", "sql", query], capture_output=True, text=True, check=True)
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error: {e.stderr}")
    except FileNotFoundError:
        print("Error: Coral CLI not found. Please install Coral.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: ./agent <skill_id> [param1=value1 param2=value2 ...]")
        print("Available skills:", ", ".join([f.replace(".sql", "") for f in os.listdir(SKILLS_DIR) if f.endswith(".sql")]))
        sys.exit(1)

    run_skill(sys.argv[1], sys.argv[2:])
