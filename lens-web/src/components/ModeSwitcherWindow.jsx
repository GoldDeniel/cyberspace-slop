import React from "react";

export default function ModeSwitcherWindow({
  viewMode,
  setViewMode,
  showAllLabels,
  setShowAllLabels,
  spaceState,
}) {
  const visitedCount = spaceState
    ? spaceState.nodes.filter((n) => n.visited).length
    : 0;
  const markedCount = spaceState
    ? spaceState.nodes.filter((n) => n.marked).length
    : 0;

  return (
    <div className="mode-window">
      <div className="mode-window-title">LENS PROJECTION MATRIX</div>
      <div className="mode-btn-group">
        <button
          className={`cyber-btn ${viewMode === "3D" ? "active" : ""}`}
          onClick={() => setViewMode("3D")}
        >
          3D SPACE
        </button>
        <button
          className={`cyber-btn ${viewMode === "2D" ? "active" : ""}`}
          onClick={() => setViewMode("2D")}
        >
          2D TACTICAL
        </button>
      </div>

      <div className="mode-btn-group">
        <button
          className={`cyber-btn ${showAllLabels ? "active" : ""}`}
          onClick={() => setShowAllLabels(!showAllLabels)}
        >
          {showAllLabels ? "LABELS: ALL" : "LABELS: SMART"}
        </button>
      </div>

      <div className="mode-stats">
        <div>VISITED IN BUBBLE: {visitedCount}</div>
        <div>MARKED BEACONS: {markedCount}</div>
      </div>
      <div className="hint-text">
        • Shift+Drag to Pan / Navigate
        <br />
        • Ctrl+Click any node to Mark ★<br />• Double-Click any directory to
        Warp
      </div>
    </div>
  );
}
