from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from .capacity import can_assign_load_to_truck
from ..utils.geo import haversine_miles

BASE_RATE_PER_MILE = 2.0
OPERATING_COST_PER_MILE = 1.2
TARGET_PROFIT_PER_MILE = 0.8
AVG_DRIVING_SPEED_MPH = 55.0


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _distance_and_time_miles_hours(lat1, lng1, lat2, lng2):
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return 0.0, 0.0
    miles = haversine_miles(lng1, lat1, lng2, lat2)
    hours = miles / AVG_DRIVING_SPEED_MPH if AVG_DRIVING_SPEED_MPH > 0 else 0.0
    return miles, hours


def evaluate_sequence(truck: Dict, loads: List[Dict]) -> Dict[str, Any]:
    """Evaluate a sequence of loads for a given truck."""
    now = datetime.now()
    current_time = now
    current_lat = truck.get("lat")
    current_lng = truck.get("lng")

    total_miles = 0.0
    deadhead_miles = 0.0
    loaded_miles = 0.0
    idle_hours = 0.0
    feasible_time = True
    legs: List[Dict[str, Any]] = []

    for idx, load in enumerate(loads):
        pickup_lat = load.get("pickup_lat")
        pickup_lng = load.get("pickup_lng")
        drop_lat = load.get("drop_lat")
        drop_lng = load.get("drop_lng")

        # Deadhead
        d_miles, d_hours = _distance_and_time_miles_hours(
            current_lat, current_lng, pickup_lat, pickup_lng
        )
        total_miles += d_miles
        deadhead_miles += d_miles
        arrival_to_pickup = current_time + timedelta(hours=d_hours)

        pickup_time = _parse_time(load.get("pickup_time"))
        pickup_ok = True
        pickup_delay_hours = 0.0
        wait_hours = 0.0

        if pickup_time is not None:
            if arrival_to_pickup > pickup_time:
                pickup_ok = False
                feasible_time = False
                pickup_delay_hours = (
                    (arrival_to_pickup - pickup_time).total_seconds() / 3600.0
                )
                current_time = arrival_to_pickup
            else:
                wait_hours = (pickup_time - arrival_to_pickup).total_seconds() / 3600.0
                idle_hours += max(wait_hours, 0.0)
                current_time = pickup_time
        else:
            current_time = arrival_to_pickup

        # Loaded
        l_miles, l_hours = _distance_and_time_miles_hours(
            pickup_lat, pickup_lng, drop_lat, drop_lng
        )
        loaded_miles += l_miles
        total_miles += l_miles
        depart_time = current_time
        arrive_drop = current_time + timedelta(hours=l_hours)

        current_time = arrive_drop
        current_lat = drop_lat
        current_lng = drop_lng

        legs.append(
            {
                "load_id": load.get("id"),
                "sequence_index": idx,
                "pickup_time": pickup_time.isoformat() if pickup_time else None,
                "arrival_to_pickup": arrival_to_pickup.isoformat(),
                "pickup_ok": pickup_ok,
                "pickup_delay_hours": round(pickup_delay_hours, 2),
                "wait_hours": round(wait_hours, 2),
                "deadhead_miles": round(d_miles, 1),
                "loaded_miles": round(l_miles, 1),
                "depart_time": depart_time.isoformat(),
                "arrival_drop": arrive_drop.isoformat(),
            }
        )

    revenue = loaded_miles * BASE_RATE_PER_MILE
    cost = total_miles * OPERATING_COST_PER_MILE
    profit = revenue - cost

    if total_miles > 0:
        revenue_per_mile = revenue / total_miles
        profit_per_mile = profit / total_miles
    else:
        revenue_per_mile = 0.0
        profit_per_mile = 0.0

    meets_target = profit_per_mile >= TARGET_PROFIT_PER_MILE

    return {
        "total_miles": round(total_miles, 1),
        "deadhead_miles": round(deadhead_miles, 1),
        "loaded_miles": round(loaded_miles, 1),
        "idle_hours": round(idle_hours, 1),
        "revenue": round(revenue, 2),
        "cost": round(cost, 2),
        "profit": round(profit, 2),
        "revenue_per_mile": round(revenue_per_mile, 3),
        "profit_per_mile": round(profit_per_mile, 3),
        "meets_target": meets_target,
        "feasible_time": feasible_time,
        "legs": legs,
    }


def build_recommendations(
    loads: List[Dict], trucks: List[Dict], max_per_truck: int = 3
) -> List[Dict[str, Any]]:
    """Build recommended routes (1–3 load chains) per truck.

    VIP loads and higher-priority freight are preferred when ranking.
    """
    open_loads = [l for l in loads if l.get("status") == "open"]
    load_by_id = {l.get("id"): l for l in loads}

    recommendations: List[Dict[str, Any]] = []

    for truck in trucks:
        truck_id = truck.get("id")
        if not truck_id:
            continue
        if truck.get("status") == "broken":
            continue

        seq_candidates: List[Dict[str, Any]] = []

        # Single-load routes
        for load in open_loads:
            if not can_assign_load_to_truck(load, truck):
                continue
            metrics = evaluate_sequence(truck, [load])
            seq_candidates.append(
                {"truck_id": truck_id, "load_ids": [load.get("id")], "metrics": metrics}
            )

        # Two-load routes
        for i, load_a in enumerate(open_loads):
            if not can_assign_load_to_truck(load_a, truck):
                continue
            for j, load_b in enumerate(open_loads):
                if j == i:
                    continue
                if not can_assign_load_to_truck(load_b, truck):
                    continue
                metrics = evaluate_sequence(truck, [load_a, load_b])
                seq_candidates.append(
                    {
                        "truck_id": truck_id,
                        "load_ids": [load_a.get("id"), load_b.get("id")],
                        "metrics": metrics,
                    }
                )

        # Three-load routes
        for i, load_a in enumerate(open_loads):
            if not can_assign_load_to_truck(load_a, truck):
                continue
            for j, load_b in enumerate(open_loads):
                if j == i:
                    continue
                if not can_assign_load_to_truck(load_b, truck):
                    continue
                for k, load_c in enumerate(open_loads):
                    if k in (i, j):
                        continue
                    if not can_assign_load_to_truck(load_c, truck):
                        continue
                    metrics = evaluate_sequence(truck, [load_a, load_b, load_c])
                    seq_candidates.append(
                        {
                            "truck_id": truck_id,
                            "load_ids": [
                                load_a.get("id"),
                                load_b.get("id"),
                                load_c.get("id"),
                            ],
                            "metrics": metrics,
                        }
                    )

        def rank_key(item: Dict[str, Any]):
            m = item["metrics"]
            load_ids = item["load_ids"]
            boards = [load_by_id.get(lid, {}).get("board") for lid in load_ids]
            priorities = [load_by_id.get(lid, {}).get("priority", 0) for lid in load_ids]

            # VIP sequences come first
            vip_rank = 0 if any(b == "vip" for b in boards) else 1
            # Higher sum of priority is better (negative for descending)
            priority_sum = sum(priorities)

            return (
                vip_rank,
                0 if m["feasible_time"] else 1,
                -priority_sum,
                -m["profit_per_mile"],
                m.get("idle_hours", 0.0),
            )

        seq_candidates.sort(key=rank_key)

        for entry in seq_candidates[:max_per_truck]:
            recommendations.append(
                {
                    "truck_id": entry["truck_id"],
                    "load_ids": entry["load_ids"],
                    "metrics": entry["metrics"],
                }
            )

    return recommendations
