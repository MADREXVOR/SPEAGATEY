import os
from flask import Flask, jsonify, request, render_template

from .utils.data import load_company_data, save_company_data
from .logic.capacity import can_assign_load_to_truck, apply_assignment
from .logic.reassign import handle_breakdown
from .logic.dispatch import build_suggestions
from .logic.optimizer import build_recommendations

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_FOLDER = os.path.join(BASE_DIR, "..", "templates")
STATIC_FOLDER = os.path.join(BASE_DIR, "..", "static")

app = Flask(__name__, template_folder=TEMPLATE_FOLDER, static_folder=STATIC_FOLDER)


@app.route("/")
def index():
    company_id = request.args.get("company", "rexis_trucking")
    return render_template("index.html", company_id=company_id)


@app.route("/api/company/<company_id>/state", methods=["GET"])
def company_state(company_id: str):
    data = load_company_data(company_id)
    loads = data["loads"]
    trucks = data["trucks"]
    suggestions = build_suggestions(loads, trucks)
    recommendations = build_recommendations(loads, trucks)

    return jsonify(
        {
            "loads": loads,
            "trucks": trucks,
            "suggestions": suggestions,
            "recommendations": recommendations,
        }
    )


@app.route("/api/company/<company_id>/assign", methods=["POST"])
def assign_load(company_id: str):
    payload = request.get_json(force=True)
    load_id = payload.get("load_id")
    truck_id = payload.get("truck_id")

    data = load_company_data(company_id)
    loads = data["loads"]
    trucks = data["trucks"]

    load = next((l for l in loads if l["id"] == load_id), None)
    truck = next((t for t in trucks if t["id"] == truck_id), None)

    if load is None or truck is None:
        return jsonify({"ok": False, "error": "Invalid load or truck id"}), 400

    if not can_assign_load_to_truck(load, truck):
        return jsonify({"ok": False, "error": "Truck capacity exceeded"}), 400

    message = apply_assignment(load, truck)
    save_company_data(company_id, data)
    return jsonify({"ok": True, "message": message, "load": load, "truck": truck})


@app.route("/api/company/<company_id>/assign_route", methods=["POST"])
def assign_route(company_id: str):
    payload = request.get_json(force=True)
    load_ids = payload.get("load_ids") or []
    truck_id = payload.get("truck_id")

    if not load_ids or not truck_id:
        return jsonify({"ok": False, "error": "Missing load_ids or truck_id"}), 400

    data = load_company_data(company_id)
    loads = data["loads"]
    trucks = data["trucks"]

    truck = next((t for t in trucks if t["id"] == truck_id), None)
    if truck is None:
        return jsonify({"ok": False, "error": "Truck not found"}), 400

    messages = []
    for lid in load_ids:
        load = next((l for l in loads if l["id"] == lid), None)
        if load is None:
            messages.append(f"Skipped missing load {lid}.")
            continue
        if load.get("status") != "open":
            messages.append(
                f"Skipped load {lid} (status is {load.get('status')})."
            )
            continue
        if not can_assign_load_to_truck(load, truck):
            messages.append(
                f"Truck capacity exceeded when trying to add load {lid}."
            )
            break
        msg = apply_assignment(load, truck)
        messages.append(msg)

    save_company_data(company_id, data)
    return jsonify(
        {
            "ok": True,
            "message": " | ".join(messages),
            "truck_id": truck_id,
            "load_ids": load_ids,
        }
    )


@app.route("/api/company/<company_id>/unassign", methods=["POST"])
def unassign_load(company_id: str):
    """
    Cancel or unassign a load from a truck — moves it back to 'open'.
    Used when dispatcher makes a mistake or needs to reassign.
    """
    payload = request.get_json(force=True)
    load_id = payload.get("load_id")

    if not load_id:
        return jsonify({"ok": False, "error": "Missing load_id"}), 400

    data = load_company_data(company_id)
    loads = data["loads"]
    trucks = data["trucks"]

    load = next((l for l in loads if l["id"] == load_id), None)
    if load is None:
        return jsonify({"ok": False, "error": "Load not found"}), 404

    if load.get("status") != "working":
        return jsonify({"ok": False, "error": "Load is not currently assigned"}), 400

    truck_id = load.get("assigned_truck_id")
    truck = next((t for t in trucks if t["id"] == truck_id), None)

    # Roll back truck's capacity
    if truck:
        used_w = truck.get("used_weight", 0)
        used_d = truck.get("used_deck", 0)
        load_w = load.get("weight", 0)
        load_d = load.get("deck_space", 0)
        truck["used_weight"] = max(0, used_w - load_w)
        truck["used_deck"] = max(0, used_d - load_d)

    # Reset load fields
    load["status"] = "open"
    load["assigned_truck_id"] = None
    load["is_confirmed"] = False

    save_company_data(company_id, data)
    return jsonify({
        "ok": True,
        "message": f"Load {load_id} unassigned from truck {truck_id or 'unknown'}.",
        "load": load,
        "truck": truck
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
