// Ghost Dispatcher front-end logic
// - Truck-focused & global AI route suggestions
// - Profit-sorted suggestions (most -> least, VIP-first)
// - VIP coverage hint
// - Selected route highlighting + only draw map routes for selected suggestion
// - Quick filters for suggestions (time-safe / profit goal)
// - Small fleet summary + "needs reposition" hint for trucks with no routes
// - Cancel / unassign load from Working board
// - Front-end profit-per-mile calculations using load linehaul rates

let map;
let loadMarkers = [];
let truckMarkers = [];
let routeLines = [];

let state = {
    loads: [],
    trucks: [],
    recommendations: [],
    decisions: [],
    selectedLoadId: null,
    selectedTruckId: null,
    selectedRouteKey: null,
    filterTimeSafe: false,
    filterProfitGoal: false
};

// ---------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------

async function drawRouteSegment(fromLat, fromLon, toLat, toLon) {
    if (fromLat == null || fromLon == null || toLat == null || toLon == null) return;

    const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            drawStraightSegment(fromLat, fromLon, toLat, toLon);
            return;
        }
        const data = await res.json();
        const route = data.routes && data.routes[0];
        if (!route || !route.geometry || !route.geometry.coordinates) {
            drawStraightSegment(fromLat, fromLon, toLat, toLon);
            return;
        }
        const latlngs = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const line = L.polyline(latlngs, { weight: 3 });
        line.addTo(map);
        routeLines.push(line);
    } catch (e) {
        drawStraightSegment(fromLat, fromLon, toLat, toLon);
    }
}

async function drawRouteForLoad(load) {
    if (!load) return;
    await drawRouteSegment(
        load.pickup_lat,
        load.pickup_lng,
        load.drop_lat,
        load.drop_lng
    );
}

function drawStraightSegment(fromLat, fromLon, toLat, toLon) {
    if (fromLat == null || fromLon == null || toLat == null || toLon == null) return;
    const line = L.polyline(
        [[fromLat, fromLon], [toLat, toLon]],
        { weight: 2, dashArray: "4 4" }
    );
    line.addTo(map);
    routeLines.push(line);
}

function initMap() {
    map = L.map("map").setView([37.8, -96], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
}

function clearLayers(list) {
    list.forEach(l => {
        try { map.removeLayer(l); } catch (e) {}
    });
    list.length = 0;
}

// ---------------------------------------------------------------------
// Data load + main render
// ---------------------------------------------------------------------

async function loadState() {
    const res = await fetch(`/api/company/${COMPANY_ID}/state`);
    const data = await res.json();
    state.loads = data.loads || [];
    state.trucks = data.trucks || [];
    state.recommendations = data.recommendations || [];
    state.decisions = data.decisions || state.decisions || [];
    renderAll();
}

function renderAll() {
    renderSummary();
    renderBoards();
    renderTrucks();
    renderDecisions();
    renderMap();
    updateWorkButton();
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function distanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // miles
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Compute revenue / profit / profitPerMile for a given route recommendation
// using the load linehaul rates on the front-end.
function computeProfitMetrics(rec, loadsById) {
    const COST_PER_MILE = 1.20; // tweak later if you want

    const loadIds = rec.load_ids || [];
    let revenue = 0;

    loadIds.forEach(lid => {
        const l = loadsById[lid] || {};
        const rawRate =
            l.linehaul_rate ??
            l.rate ??
            l.revenue ??
            0;
        const rate = Number(rawRate) || 0;
        revenue += rate;
    });

    const m = rec.metrics || {};
    let totalMiles = m.total_miles;
    if (totalMiles == null) {
        const dead = m.deadhead_miles ?? 0;
        const loaded = m.loaded_miles ?? 0;
        totalMiles = dead + loaded;
    }
    totalMiles = Number(totalMiles) || 0;

    if (totalMiles <= 0) {
        return {
            revenue: revenue,
            profit: 0,
            profitPerMile: 0,
            meetsTarget: false
        };
    }

    const cost = totalMiles * COST_PER_MILE;
    const profit = revenue - cost;
    const profitPerMile = profit / totalMiles;
    const meetsTarget = profitPerMile >= 0.80;

    return { revenue, profit, profitPerMile, meetsTarget };
}

function computeVipCoverage() {
    // All loads that *belong* to VIP, regardless of working/open
    const allVip = state.loads.filter(l => l.board === "vip");
    const waitingVip = allVip.filter(l => l.status !== "working");

    if (!allVip.length) {
        // No VIP contracts at all
        return {
            allVipCount: 0,
            waitingVipCount: 0,
            nearbyTrucks: 0,
            target: 0
        };
    }

    const VIP_RADIUS = 300; // miles around each VIP pickup
    let nearbyTrucks = 0;

    state.trucks.forEach(truck => {
        if (truck.lat == null || truck.lng == null) return;
        let closest = Infinity;
        allVip.forEach(load => {
            if (load.pickup_lat == null || load.pickup_lng == null) return;
            const d = distanceMiles(
                truck.lat,
                truck.lng,
                load.pickup_lat,
                load.pickup_lng
            );
            if (d < closest) closest = d;
        });
        if (closest <= VIP_RADIUS) nearbyTrucks += 1;
    });

    const target = Math.min(3, Math.max(1, allVip.length));
    return {
        allVipCount: allVip.length,
        waitingVipCount: waitingVip.length,
        nearbyTrucks,
        target
    };
}

function getRouteKey(rec) {
    const ids = (rec.load_ids || []).join("-");
    const tid = rec.truck_id || "X";
    return `${tid}::${ids}`;
}

function feasibilityEmoji(feasible) {
    return feasible ? "🕒" : "⏰";
}

// ---------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------

function renderSummary() {
    const el = document.getElementById("fleet-summary");
    if (!el) return;

    const totalTrucks = state.trucks.length;
    const idle = state.trucks.filter(t => (t.status || "").toLowerCase() === "idle").length;
    const working = state.trucks.filter(t => (t.status || "").toLowerCase() === "working").length;
    const broken = state.trucks.filter(t => (t.status || "").toLowerCase() === "broken").length;

    const vipLoads = state.loads.filter(l => l.board === "vip" && l.status !== "working").length;
    const openLoads = state.loads.filter(l => l.board !== "vip" && l.status !== "working").length;

    el.innerHTML = `
        <span>Trucks: ${totalTrucks} total · ${working} working · ${idle} idle · ${broken} broken</span>
        <span>VIP loads waiting: ${vipLoads}</span>
        <span>Open loads: ${openLoads}</span>
    `;
}

// ---------------------------------------------------------------------
// Boards + suggestions
// ---------------------------------------------------------------------

function renderBoards() {
    const vipList = document.getElementById("vip-list");
    const openList = document.getElementById("open-list");
    const workingList = document.getElementById("working-list");
    const suggestedList = document.getElementById("suggested-list");

    vipList.innerHTML = "";
    openList.innerHTML = "";
    workingList.innerHTML = "";
    suggestedList.innerHTML = "";

    const loadsById = {};
    state.loads.forEach(l => { loadsById[l.id] = l; });

    // VIP coverage mini-line (always show something)
    const coverage = computeVipCoverage();
    {
        const meta = document.createElement("div");
        meta.className = "vip-coverage-meta";

        if (!coverage.allVipCount) {
            meta.innerHTML = `
                <span class="label">VIP coverage</span>
                <span class="value ok">No VIP contracts configured.</span>
            `;
        } else if (!coverage.waitingVipCount) {
            // All VIP loads are already in Working
            const colorClass = (coverage.nearbyTrucks >= coverage.target) ? "ok" : "warn";
            meta.innerHTML = `
                <span class="label">VIP coverage</span>
                <span class="value ${colorClass}">
                    ${coverage.allVipCount} VIP lanes · all current loads covered
                </span>
            `;
        } else {
            // Some VIP loads are still waiting
            const colorClass = (coverage.nearbyTrucks >= coverage.target) ? "ok" : "warn";
            meta.innerHTML = `
                <span class="label">VIP coverage</span>
                <span class="value ${colorClass}">
                    ${coverage.waitingVipCount} VIP loads waiting ·
                    ${coverage.nearbyTrucks} trucks near VIP lanes · target ${coverage.target}
                </span>
            `;
        }

        vipList.appendChild(meta);
    }

    // Load cards
    state.loads.forEach(load => {
        const card = document.createElement("div");
        card.className = "card";
        card.dataset.id = load.id;

        const board = load.board || "open";
        const status = load.status || "open";

        if (board === "vip") card.classList.add("vip");
        if (board === "open") card.classList.add("open");
        if (status === "working") card.classList.add("working");
        if (state.selectedLoadId === load.id) card.classList.add("selected");

        const confirmed = load.is_confirmed ? " (confirmed)" : " (pending)";
        const company = load.company_name || "";
        const phone = load.contact_phone || "";

        card.innerHTML = `
            <strong>${load.id}</strong> · ${load.origin} → ${load.destination}<br>
            <span class="meta-line">
                ${load.weight || 0} lbs · deck ${load.deck_space || 0}${confirmed}
            </span><br>
            <span class="meta-line">
                ${company}${company && phone ? " · " : ""}${phone}
            </span>
        `;

        card.addEventListener("click", () => {
            state.selectedLoadId = load.id;
            openLoadDetail(load);
            renderBoards();
            updateWorkButton();
        });

        if (status === "working") {
            // Working board + Cancel button
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel Load";
            cancelBtn.className = "cancel-btn";
            cancelBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                await unassignLoad(load.id);
            });
            card.appendChild(cancelBtn);
            workingList.appendChild(card);
        } else if (board === "vip") {
            vipList.appendChild(card);
        } else {
            openList.appendChild(card);
        }
    });

    renderSuggestedRoutes(suggestedList, loadsById);
}

function renderSuggestedRoutes(container, loadsById) {
    const selectedTruckId = state.selectedTruckId;

    // ----------------------------------------------------------
    // base routes (before UI filters)
    // ----------------------------------------------------------
    let baseRoutes = [];
    if (selectedTruckId) {
        baseRoutes = state.recommendations.filter(rec => rec.truck_id === selectedTruckId);
    } else {
        baseRoutes = state.recommendations.slice();
    }

    // Drop multi-load routes that are under the profit goal.
    // Single-load routes are allowed even if they are below $0.80/mi.
    const MIN_MULTI_PROFIT = 0.8;
    baseRoutes = baseRoutes.filter(rec => {
        const loadCount = (rec.load_ids || []).length;
        const fin = computeProfitMetrics(rec, loadsById);

        if (loadCount > 1 && fin.profitPerMile < MIN_MULTI_PROFIT) {
            return false;
        }
        return true;
    });

    // ----------------------------------------------------------
    // Apply UI filters (time-safe checkbox, ≥$0.80/mi checkbox)
    // ----------------------------------------------------------
    let routes = baseRoutes.filter(rec => {
        const m = rec.metrics || {};
        const fin = computeProfitMetrics(rec, loadsById);
        if (state.filterTimeSafe && !m.feasible_time) return false;
        if (state.filterProfitGoal && !fin.meetsTarget) return false;
        return true;
    });

    // ----------------------------------------------------------
    // Header (always visible)
    // ----------------------------------------------------------
    const header = document.createElement("div");
    header.className = "route-group-header";
    if (selectedTruckId) {
        header.textContent =
            `Routes for Truck ${selectedTruckId} · ${routes.length} option${routes.length !== 1 ? "s" : ""}`;
    } else {
        header.textContent =
            `Best fleet routes · ${routes.length} option${routes.length !== 1 ? "s" : ""} (top = most profitable)`;
    }
    container.appendChild(header);

    // ----------------------------------------------------------
    // Filter bar (always visible so you can uncheck even with 0 routes)
    // ----------------------------------------------------------
    const filtersBar = document.createElement("div");
    filtersBar.className = "route-filters";
    filtersBar.innerHTML = `
        <label><input type="checkbox" id="filter-time-safe" ${state.filterTimeSafe ? "checked" : ""}> Time-safe only</label>
        <label><input type="checkbox" id="filter-profit-goal" ${state.filterProfitGoal ? "checked" : ""}> ≥ $0.80/mi only</label>
    `;
    container.appendChild(filtersBar);

    const timeSafeBox = filtersBar.querySelector("#filter-time-safe");
    const profitBox = filtersBar.querySelector("#filter-profit-goal");

    timeSafeBox.addEventListener("change", e => {
        state.filterTimeSafe = e.target.checked;
        renderBoards();
    });
    profitBox.addEventListener("change", e => {
        state.filterProfitGoal = e.target.checked;
        renderBoards();
    });

    // ----------------------------------------------------------
    // No routes scenario
    // ----------------------------------------------------------
    if (!routes.length) {
        const msg = document.createElement("div");
        msg.className = "route-empty";

        if (!baseRoutes.length) {
            // No routes at all for this truck (or fleet)
            const openLoads = state.loads.filter(l => l.status !== "working");
            if (!openLoads.length) {
                msg.textContent =
                    "All loads are already in Working. To reset the sandbox, restart the Flask server.";
            } else {
                msg.textContent = selectedTruckId
                    ? "No routes available for this truck."
                    : "No routes available right now.";
            }
        } else {
            msg.textContent =
                "No matching routes for this truck with current filters.";
        }

        container.appendChild(msg);
        return;
    }

    // ----------------------------------------------------------
    // Sort remaining routes: VIP first, then by profit/mi descending
    // ----------------------------------------------------------
    routes.sort((a, b) => {
        const fa = computeProfitMetrics(a, loadsById);
        const fb = computeProfitMetrics(b, loadsById);

        const vipA = (a.load_ids || []).some(id => (loadsById[id] || {}).board === "vip");
        const vipB = (b.load_ids || []).some(id => (loadsById[id] || {}).board === "vip");
        if (vipA !== vipB) return vipA ? -1 : 1;

        return fb.profitPerMile - fa.profitPerMile;
    });

    // ----------------------------------------------------------
    // Render suggestion cards
    // ----------------------------------------------------------
    routes.forEach((rec, idx) => {
        const key = getRouteKey(rec);
        const card = document.createElement("div");
        card.className = "card route-card";
        if (state.selectedRouteKey === key) {
            card.classList.add("selected-route");
        }

        const loadIds = rec.load_ids || [];
        const m = rec.metrics || {};
        const miles = m.total_miles ?? 0;
        const deadhead = m.deadhead_miles ?? 0;
        const loaded = m.loaded_miles ?? 0;
        const idleHours = m.idle_hours ?? 0;

        const fin = computeProfitMetrics(rec, loadsById);
        const profitPerMile = fin.profitPerMile;
        const meetsTarget = fin.meetsTarget;
        const feasible = m.feasible_time;

        const chainLabel = loadIds.join(" → ");
        const feasibilityText = feasible ? "On-time" : "⚠ May miss pickup window";
        const targetText = meetsTarget
            ? "✅ Hits $0.80/mi profit goal"
            : "⚠ Below $0.80/mi profit";

        const callLines = loadIds.map((lid, i) => {
            const l = loadsById[lid] || {};
            const company = l.company_name || "Unknown shipper";
            const phone = l.contact_phone || "N/A";
            return `${i + 1}. ${lid} – ${company} – ${phone}`;
        }).join("<br>");

        const label = idx === 0 ? "⭐ Best route (AI pick)" : `Alt route ${idx + 1}`;
        const truckLabel = selectedTruckId || rec.truck_id || "Unknown";

        card.innerHTML = `
            <div class="route-label">${label}</div>
            <strong>Truck ${truckLabel}</strong><br>
            Route: ${chainLabel}<br>
            <span class="meta-line">
                Miles: ${miles} (deadhead ${deadhead}, loaded ${loaded})
            </span><br>
            <span class="meta-line">
                Idle: ${idleHours} h · Profit/mi: $${profitPerMile.toFixed(2)}
            </span><br>
            <span class="meta-line">
                ${feasibilityEmoji(feasible)} ${feasibilityText}
            </span><br>
            <span class="meta-line">${targetText}</span><br>
            <div class="meta-line"><strong>Call list:</strong><br>${callLines}</div>
            <div class="route-actions">
                <button type="button" class="btn-assign-route">Assign Route</button>
            </div>
        `;

        // Clicking card = select for map
        card.addEventListener("click", e => {
            if (e.target && e.target.closest(".btn-assign-route")) return;
            state.selectedRouteKey = key;
            renderBoards();
            renderMap();
        });

        // Clicking button = actually assign route
        const btn = card.querySelector(".btn-assign-route");
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            await assignRoute(rec);
        });

        container.appendChild(card);
    });
}

// ---------------------------------------------------------------------
// Trucks + decisions
// ---------------------------------------------------------------------

function renderTrucks() {
    const list = document.getElementById("truck-list");
    list.innerHTML = "";

    // Build a quick loadsById map for profit metrics
    const loadsById = {};
    state.loads.forEach(l => { loadsById[l.id] = l; });

    state.trucks.forEach(truck => {
        const card = document.createElement("div");
        card.className = "truck-card";
        if (state.selectedTruckId === truck.id) card.classList.add("selected");

        const usedW = truck.used_weight || 0;
        const capW = truck.capacity_weight || 0;
        const usedD = truck.used_deck || 0;
        const capD = truck.capacity_deck || 0;

        const recsForTruck = state.recommendations.filter(r => r.truck_id === truck.id);
        const needsReposition = recsForTruck.length === 0;

        let bestOfferPpm = 0;
        recsForTruck.forEach(rec => {
            const fin = computeProfitMetrics(rec, loadsById);
            if (fin.profitPerMile > bestOfferPpm) {
                bestOfferPpm = fin.profitPerMile;
            }
        });

        card.innerHTML = `
            <div class="truck-header">
                <span>${truck.id} - ${truck.name || ""}</span>
                <span>${truck.status || "idle"}</span>
            </div>
            <div class="truck-meta">
                ${truck.current_city || ""}<br>
                Weight: ${usedW}/${capW} · Deck: ${usedD}/${capD}
            </div>
            <div class="truck-meta small">
                ${needsReposition ? "⚠ No routes · consider repositioning" : ""}
            </div>
            <div class="truck-meta small">
                Best offer: $${bestOfferPpm.toFixed(2)}/mi
            </div>
            <div class="truck-actions">
                <button type="button" data-truck="${truck.id}">Mark Broken</button>
            </div>
        `;

        card.addEventListener("click", e => {
            if (e.target.tagName.toLowerCase() === "button") return;
            state.selectedTruckId =
                state.selectedTruckId === truck.id ? null : truck.id;
            renderTrucks();
            renderBoards();
            updateWorkButton();
        });

        const btn = card.querySelector("button[data-truck]");
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            await markTruckBroken(truck.id);
        });

        list.appendChild(card);
    });
}

function renderDecisions() {
    const list = document.getElementById("decisions-list");
    if (!list) return;
    list.innerHTML = "";
    state.decisions.slice(-30).forEach(line => {
        const div = document.createElement("div");
        div.className = "decision-line";
        div.textContent = line;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}

// ---------------------------------------------------------------------
// Map render
// ---------------------------------------------------------------------

function renderMap() {
    if (!map) return;
    clearLayers(loadMarkers);
    clearLayers(truckMarkers);
    clearLayers(routeLines);

    // always show pickup markers
    state.loads.forEach(load => {
        const lat = load.pickup_lat;
        const lng = load.pickup_lng;
        if (lat == null || lng == null) return;

        const color = load.board === "vip" ? "#ff9800" : "#2196f3";
        const marker = L.circleMarker([lat, lng], {
            radius: 6,
            weight: 1,
            color: color,
            fillOpacity: 0.8
        }).addTo(map);

        marker.bindPopup(`${load.id}: ${load.origin} → ${load.destination}`);
        loadMarkers.push(marker);
    });

    // trucks
    state.trucks.forEach(truck => {
        const lat = truck.lat;
        const lng = truck.lng;
        if (lat == null || lng == null) return;

        const marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup(`${truck.id}: ${truck.current_city || ""}`);
        truckMarkers.push(marker);
    });

    // only draw a route if one is selected
    if (!state.selectedRouteKey) return;

    const rec = state.recommendations.find(r => getRouteKey(r) === state.selectedRouteKey);
    if (!rec) return;

    const loadsById = {};
    state.loads.forEach(l => { loadsById[l.id] = l; });

    (rec.load_ids || []).forEach(lid => {
        const load = loadsById[lid];
        if (!load) return;
        drawRouteForLoad(load);
    });
}

// ---------------------------------------------------------------------
// Actions: manual assignment, route assignment, breakdown, cancel
// ---------------------------------------------------------------------

function updateWorkButton() {
    const btn = document.getElementById("btn-work-load");
    if (!btn) return;

    const ready = state.selectedLoadId && state.selectedTruckId;
    btn.disabled = !ready;
    btn.textContent = ready
        ? `Work ${state.selectedLoadId} on ${state.selectedTruckId}`
        : "Work This Load";
}

async function workThisLoad() {
    if (!state.selectedLoadId || !state.selectedTruckId) return;
    const payload = {
        load_id: state.selectedLoadId,
        truck_id: state.selectedTruckId
    };

    const res = await fetch(`/api/company/${COMPANY_ID}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
        const msg = data.error || "Failed to assign load.";
        state.decisions.push(`❌ ${msg}`);
    } else {
        state.decisions.push(`✅ ${data.message}`);
    }

    state.selectedLoadId = null;
    state.selectedTruckId = null;
    await loadState();
}

async function assignRoute(rec) {
    const m = rec.metrics || {};
    const loadsById = {};
    state.loads.forEach(l => { loadsById[l.id] = l; });

    const fin = computeProfitMetrics(rec, loadsById);
    const profitPerMile = fin.profitPerMile;
    const feasible = m.feasible_time;

    let warning = "";
    if (!feasible) {
        warning += "This route may miss at least one pickup window.\n";
    }
    if (profitPerMile < 0.8) {
        warning += `This route only makes about $${profitPerMile.toFixed(2)} per mile (below $0.80).\n`;
    }
    if (warning) {
        warning += "\nDo you still want to assign this route?";
        const ok = window.confirm(warning);
        if (!ok) {
            state.decisions.push("⚠ Route assignment cancelled by dispatcher.");
            renderDecisions();
            return;
        }
    }

    const payload = {
        truck_id: rec.truck_id,
        load_ids: rec.load_ids || []
    };

    const res = await fetch(`/api/company/${COMPANY_ID}/assign_route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
        const msg = data.error || "Failed to assign route.";
        state.decisions.push(`❌ ${msg}`);
    } else {
        state.decisions.push(`✅ Route assigned for truck ${rec.truck_id}: ${data.message}`);
    }
    await loadState();
}

async function unassignLoad(loadId) {
    if (!window.confirm(`Cancel and unassign load ${loadId}?`)) return;

    const res = await fetch(`/api/company/${COMPANY_ID}/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ load_id: loadId })
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
        state.decisions.push(`❌ Failed to unassign ${loadId}: ${data.error || 'unknown error'}`);
    } else {
        state.decisions.push(`↩️ ${data.message}`);
    }
    await loadState();
}

async function markTruckBroken(truckId) {
    const res = await fetch(`/api/company/${COMPANY_ID}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truck_id: truckId })
    });
    const data = await res.json();

    if (data.message) {
        state.decisions.push(`⚠ ${data.message}`);
    }
    if (Array.isArray(data.events)) {
        data.events.forEach(e => state.decisions.push(`➡️ ${e}`));
    }
    await loadState();
}

// ---------------------------------------------------------------------
// Load detail modal
// ---------------------------------------------------------------------

function openLoadDetail(load) {
    const overlay = document.getElementById("detail-overlay");
    const body = document.getElementById("detail-body");
    if (!overlay || !body) return;

    const company = load.company_name || "";
    const phone = load.contact_phone || "";
    const pickupTime = load.pickup_time || "flexible";

    body.innerHTML = `
        <h3>${load.id} · ${load.reference || ""}</h3>
        <p>${load.origin} → ${load.destination}</p>
        <p>${load.weight || 0} lbs · deck ${load.deck_space || 0}</p>
        <p>Board: ${load.board || "open"} · Status: ${load.status || "open"}</p>
        <p>Pickup: ${pickupTime}</p>
        <p>Shipper: ${company}${company && phone ? " · " : ""}${phone}</p>

        <hr>

        <h4>Dispatch workflow (manual for now)</h4>
        <ol class="workflow-list">
            <li>Call shipper/broker to confirm rate, pickup window, and any accessorials.</li>
            <li>Mark load as <strong>confirmed</strong> in their TMS / email (get written confirmation).</li>
            <li>Collect required documents (rate con, BOL template, photos if required).</li>
            <li>Send load packet to driver (address, reference #, pickup notes, gate codes, etc.).</li>
            <li>Once all the above are done, you can safely <strong>assign this route</strong> in Ghost Dispatcher.</li>
        </ol>
        <p class="workflow-note">
            Later: this panel can show actual uploaded docs, email status, and photo check-off per load.
        </p>
    `;

    overlay.classList.add("open");
}

function closeLoadDetail() {
    const overlay = document.getElementById("detail-overlay");
    if (overlay) overlay.classList.remove("open");
}

// ---------------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------------

function setupEvents() {
    const btn = document.getElementById("btn-work-load");
    if (btn) btn.addEventListener("click", workThisLoad);

    const overlay = document.getElementById("detail-overlay");
    const closeBtn = document.getElementById("detail-close");

    if (overlay) {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) closeLoadDetail();
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", closeLoadDetail);
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    initMap();
    setupEvents();
    await loadState();
});
