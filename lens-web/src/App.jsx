import React, { useState } from "react";
import { useCyberspaceSocket } from "./hooks/useCyberspaceSocket";
import HudHeader from "./components/HudHeader";
import ModeSwitcherWindow from "./components/ModeSwitcherWindow";
import TerminalEmulator from "./components/TerminalEmulator";
import CyberspaceViewport from "./components/CyberspaceViewport";

export default function App() {
  const { spaceState, connected, history, sendCommand, toggleMarkNode } =
    useCyberspaceSocket();
  const [viewMode, setViewMode] = useState("3D"); // '3D' or '2D'
  const [showAllLabels, setShowAllLabels] = useState(false);

  return (
    <>
      <HudHeader spaceState={spaceState} connected={connected} />
      <ModeSwitcherWindow
        viewMode={viewMode}
        setViewMode={setViewMode}
        showAllLabels={showAllLabels}
        setShowAllLabels={setShowAllLabels}
        spaceState={spaceState}
      />
      <CyberspaceViewport
        spaceState={spaceState}
        viewMode={viewMode}
        showAllLabels={showAllLabels}
        onToggleMark={toggleMarkNode}
        onWarpToDir={sendCommand}
      />
      <TerminalEmulator
        spaceState={spaceState}
        history={history}
        onSendCommand={sendCommand}
      />
    </>
  );
}
