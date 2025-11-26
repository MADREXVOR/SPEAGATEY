
from typing import Dict

def _ensure_defaults(truck: Dict):
    # Make sure capacity and used fields exist
    truck.setdefault("capacity_weight", 0)
    truck.setdefault("capacity_deck", 0)
    truck.setdefault("used_weight", 0)
    truck.setdefault("used_deck", 0)


def can_assign_load_to_truck(load: Dict, truck: Dict) -> bool:
    """Check if the truck has enough free weight and deck space for the load."""
    _ensure_defaults(truck)
    weight = load.get("weight", 0)
    deck = load.get("deck_space", 0)

    free_weight = truck["capacity_weight"] - truck["used_weight"]
    free_deck = truck["capacity_deck"] - truck["used_deck"]
    return weight <= free_weight and deck <= free_deck


def apply_assignment(load: Dict, truck: Dict) -> str:
    """Assign a load to a truck and update capacity usage.

    Returns a human-readable message summarizing the decision.
    """
    _ensure_defaults(truck)

    # If load was already on another truck, we should have cleared that first.
    prev_truck_id = load.get("assigned_truck_id")
    load["assigned_truck_id"] = truck["id"]
    load["status"] = "working"  # could be 'enroute' later

    board = load.get("board", "open")
    if board == "vip":
        load["is_confirmed"] = True
        confirmation = "VIP load auto-confirmed"
    else:
        # Open board load: mark as tentative until dispatcher confirms with broker
        load["is_confirmed"] = False
        confirmation = "Open-board load marked tentative (needs call confirmation)"

    weight = load.get("weight", 0)
    deck = load.get("deck_space", 0)
    truck["used_weight"] += weight
    truck["used_deck"] += deck

    if truck.get("status") in (None, "idle", "available"):
        truck["status"] = "working"

    return f"Assigned load {load.get('id')} to truck {truck.get('id')} ({confirmation})."


def remove_assignment(load: Dict, truck: Dict):
    """Detach a load from its current truck and restore capacity."""
    _ensure_defaults(truck)
    weight = load.get("weight", 0)
    deck = load.get("deck_space", 0)

    truck["used_weight"] = max(0, truck["used_weight"] - weight)
    truck["used_deck"] = max(0, truck["used_deck"] - deck)

    load["assigned_truck_id"] = None
    load["status"] = "open"
    # Keep board + is_confirmed; caller can adjust if needed
