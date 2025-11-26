
from typing import Dict, List, Any
from .capacity import can_assign_load_to_truck, apply_assignment, remove_assignment
from ..utils.geo import haversine_miles


def handle_breakdown(data: Dict[str, List[Dict]], broken_truck_id: str) -> Dict[str, Any]:
    """Mark a truck as broken and try to reassign its working loads.

    Strategy:
    - Mark truck status = 'broken'.
    - Find all loads assigned to this truck that are still 'working'.
    - For each such load, pick the nearest idle/available truck with enough capacity.
    - Reassign and update capacities.
    """
    trucks = data.get("trucks", [])
    loads = data.get("loads", [])

    broken_truck = next((t for t in trucks if t["id"] == broken_truck_id), None)
    if broken_truck is None:
        return {"ok": False, "message": f"Truck {broken_truck_id} not found.", "events": []}

    broken_truck["status"] = "broken"

    # Collect affected loads
    affected_loads = [l for l in loads if l.get("assigned_truck_id") == broken_truck_id and l.get("status") == "working"]

    events: List[str] = []
    if not affected_loads:
        return {
            "ok": True,
            "message": f"Truck {broken_truck_id} marked broken, no active loads to reassign.",
            "events": events,
        }

    # Location of breakdown
    bx = broken_truck.get("lat")
    by = broken_truck.get("lng")

    for load in affected_loads:
        # Find candidate trucks
        candidates = [
            t for t in trucks
            if t["id"] != broken_truck_id and t.get("status") in ("idle", "available")
        ]

        if not candidates:
            events.append(f"No available trucks to reassign load {load.get('id')} from {broken_truck_id}.")
            continue

        # If we know where the truck is, prefer nearest; otherwise just use first that fits
        best_truck = None
        best_distance = None

        for t in candidates:
            if not can_assign_load_to_truck(load, t):
                continue
            tx = t.get("lat")
            ty = t.get("lng")
            if bx is not None and by is not None and tx is not None and ty is not None:
                d = haversine_miles(by, bx, ty, tx)
            else:
                d = 0.0

            if best_distance is None or d < best_distance:
                best_distance = d
                best_truck = t

        if best_truck is None:
            events.append(f"No truck with enough capacity to take load {load.get('id')} from {broken_truck_id}.")
            continue

        # Detach from broken truck and reassign
        remove_assignment(load, broken_truck)
        msg = apply_assignment(load, best_truck)
        if best_distance is not None:
            msg += f" Reassigned from {broken_truck_id} to {best_truck['id']} (~{best_distance:.1f} mi)."
        else:
            msg += f" Reassigned from {broken_truck_id} to {best_truck['id']}."
        events.append(msg)

    return {
        "ok": True,
        "message": f"Handled breakdown for truck {broken_truck_id}.",
        "events": events,
    }
