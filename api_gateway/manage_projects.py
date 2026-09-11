"""
Manage projects (tenants) for the payment gateway.

Each project gets its own API key. Callers send that key in the `X-API-Key`
header; every transfer they create is logged in the shared payment-gateway
database, tagged with the project.

Usage:
    python manage_projects.py create "shot24"      # create a project + API key
    python manage_projects.py list                 # list all projects
    python manage_projects.py disable "shot24"     # deactivate a project's key
    python manage_projects.py rotate "shot24"      # issue a new API key
"""

import sys

from dotenv import load_dotenv

load_dotenv()

from lianlian import db  # noqa: E402
from lianlian.db import SessionLocal, Project  # noqa: E402


def _create(name: str) -> None:
    db.init_db()
    with SessionLocal() as s:
        if s.query(Project).filter_by(name=name).first():
            print(f"Project '{name}' already exists.")
            return
        p = db.create_project(s, name)
        print(f"Created project '{p.name}'")
        print(f"  API key: {p.api_key}")
        print("  -> send this in the 'X-API-Key' header. Store it securely.")


def _list() -> None:
    db.init_db()
    with SessionLocal() as s:
        projects = s.query(Project).order_by(Project.id).all()
        if not projects:
            print("No projects yet. Create one: python manage_projects.py create \"name\"")
            return
        for p in projects:
            state = "active" if p.is_active else "disabled"
            print(f"[{p.id}] {p.name:20s} {state:9s} {p.api_key}")


def _disable(name: str) -> None:
    with SessionLocal() as s:
        p = s.query(Project).filter_by(name=name).first()
        if not p:
            print(f"Project '{name}' not found.")
            return
        p.is_active = False
        s.commit()
        print(f"Project '{name}' disabled.")


def _rotate(name: str) -> None:
    with SessionLocal() as s:
        p = s.query(Project).filter_by(name=name).first()
        if not p:
            print(f"Project '{name}' not found.")
            return
        p.api_key = Project.new_api_key()
        p.is_active = True
        s.commit()
        print(f"Project '{name}' new API key: {p.api_key}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "create" and len(sys.argv) == 3:
        _create(sys.argv[2])
    elif cmd == "list":
        _list()
    elif cmd == "disable" and len(sys.argv) == 3:
        _disable(sys.argv[2])
    elif cmd == "rotate" and len(sys.argv) == 3:
        _rotate(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
