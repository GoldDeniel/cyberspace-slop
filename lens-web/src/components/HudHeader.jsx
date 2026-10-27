import React from "react";

export default function HudHeader({ spaceState, connected }) {
  if (!connected || !spaceState) {
    return (
      <div className="hud-top">
        <h1>DATAFORTRESS // REACT LENS</h1>
        <div className="hud-sub">
          Connecting to Core Daemon (ws://127.0.0.1:9001)...
        </div>
      </div>
    );
  }

  const [tx, ty, tz] = spaceState.camera_target;
  return (
    <div className="hud-top">
      <h1>DATAFORTRESS // {spaceState.hostname.toUpperCase()}</h1>
      <div className="hud-sub">
        SECTOR: {spaceState.current_path} | COORDS: ({tx.toFixed(1)},{" "}
        {ty.toFixed(1)}, {tz.toFixed(1)}) | NODES: {spaceState.nodes.length}
      </div>
    </div>
  );
}
