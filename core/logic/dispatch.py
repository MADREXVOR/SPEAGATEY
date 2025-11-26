
from typing import List, Dict

def build_suggestions(loads: List[Dict], trucks: List[Dict]) -> List[Dict]:
    """Build a simple 'live suggested stream' of loads.

    For now: all open loads sorted by priority (desc), then by board (VIP first).
    """
    open_loads = [l for l in loads if l.get("status") == "open"]
    def sort_key(l):
        # VIP first, then higher priority, then id
        board = l.get("board", "open")
        priority = l.get("priority", 0)
        board_rank = 0 if board == "vip" else 1
        return (board_rank, -priority, l.get("id"))

    open_loads.sort(key=sort_key)
    return open_loads
