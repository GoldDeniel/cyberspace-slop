import { useState, useEffect, useRef, useCallback } from "react";

export function useCyberspaceSocket(url = "ws://127.0.0.1:9001") {
  const [spaceState, setSpaceState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState([]);
  const wsRef = useRef(null);
  const lastCmdRef = useRef("init");

  useEffect(() => {
    let reconnectTimer;
    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setSpaceState(data);
        if (data.terminal_output) {
          setHistory((prev) => [
            ...prev,
            {
              prompt: `${data.username}@${data.hostname}:${data.prompt_path}$`,
              cmd: lastCmdRef.current,
              output: data.terminal_output,
            },
          ]);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [url]);

  const sendCommand = useCallback((cmdStr) => {
    if (cmdStr.trim() === "clear") {
      setHistory([]);
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      lastCmdRef.current = cmdStr;
      wsRef.current.send(JSON.stringify({ cmd: cmdStr }));
    }
  }, []);

  const toggleMarkNode = useCallback((pathStr) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      lastCmdRef.current = `mark ${pathStr}`;
      wsRef.current.send(
        JSON.stringify({ cmd: "", toggle_mark_path: pathStr }),
      );
    }
  }, []);

  return { spaceState, connected, history, sendCommand, toggleMarkNode };
}
