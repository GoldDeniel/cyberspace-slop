import React, { useState, useRef, useEffect } from "react";

export default function TerminalEmulator({
  spaceState,
  history,
  onSendCommand,
}) {
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef(null);

  const promptStr = spaceState
    ? `${spaceState.username}@${spaceState.hostname}:${spaceState.prompt_path}$`
    : "connecting@fortress:~$";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && input.trim() !== "") {
      onSendCommand(input);
      setCmdHistory((prev) => [input, ...prev]);
      setHistIdx(-1);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx + 1 < cmdHistory.length) {
        const nextIdx = histIdx + 1;
        setHistIdx(nextIdx);
        setInput(cmdHistory[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx > 0) {
        const nextIdx = histIdx - 1;
        setHistIdx(nextIdx);
        setInput(cmdHistory[nextIdx]);
      } else {
        setHistIdx(-1);
        setInput("");
      }
    }
  };

  return (
    <div className="terminal-window">
      <div className="terminal-header">
        <span>SHELL // {promptStr}</span>
        <span>BASH + SPATIAL COMMANDS (cd, find, scan, mark, clear)</span>
      </div>
      <div className="terminal-history">
        {history.map((item, idx) => (
          <div key={idx} className="term-entry">
            <div className="term-cmd-line">
              <span className="term-prompt">{item.prompt} </span>
              {item.cmd}
            </div>
            <div className="term-res-line">{item.output}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="terminal-input-row">
        <span className="term-prompt">{promptStr}</span>
        <input
          className="term-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type any Linux command (ls -la, uname -a, cd .., mark <file>)..."
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  );
}
