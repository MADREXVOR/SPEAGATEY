
import os
import json
from typing import Dict, List

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COMPANIES_ROOT = os.path.join(BASE_DIR, "..", "..", "companies")


def _company_dir(company_id: str) -> str:
    return os.path.join(COMPANIES_ROOT, company_id)


def _ensure_company_files(company_id: str):
    cdir = _company_dir(company_id)
    os.makedirs(cdir, exist_ok=True)
    loads_path = os.path.join(cdir, "loads.json")
    trucks_path = os.path.join(cdir, "trucks.json")

    if not os.path.exists(loads_path):
        with open(loads_path, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2)
    if not os.path.exists(trucks_path):
        with open(trucks_path, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2)


def load_company_data(company_id: str) -> Dict[str, List[Dict]]:
    _ensure_company_files(company_id)
    cdir = _company_dir(company_id)
    loads_path = os.path.join(cdir, "loads.json")
    trucks_path = os.path.join(cdir, "trucks.json")

    with open(loads_path, "r", encoding="utf-8") as f:
        loads = json.load(f)
    with open(trucks_path, "r", encoding="utf-8") as f:
        trucks = json.load(f)

    return {"loads": loads, "trucks": trucks}


def save_company_data(company_id: str, data: Dict[str, List[Dict]]):
    cdir = _company_dir(company_id)
    os.makedirs(cdir, exist_ok=True)
    loads_path = os.path.join(cdir, "loads.json")
    trucks_path = os.path.join(cdir, "trucks.json")

    with open(loads_path, "w", encoding="utf-8") as f:
        json.dump(data.get("loads", []), f, indent=2)
    with open(trucks_path, "w", encoding="utf-8") as f:
        json.dump(data.get("trucks", []), f, indent=2)
