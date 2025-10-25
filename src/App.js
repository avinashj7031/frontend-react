import { useEffect, useState } from "react";

export default function App() {
  const [apiMsg, setApiMsg] = useState("loading...");

  useEffect(() => {
    fetch("/api/data")
      .then(r => { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .then(d => setApiMsg(d.data ?? JSON.stringify(d)))
      .catch(e => setApiMsg("error: " + e.message));
  }, []);

  return (
    <div style={{fontFamily:"system-ui, sans-serif", padding:"2rem"}}>
      <h1>React + Flask</h1>
      <p><b>API:</b> {apiMsg}</p>
    </div>
  );
}
