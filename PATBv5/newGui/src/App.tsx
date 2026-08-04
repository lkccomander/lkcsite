import { resolveTerminalView } from "./lib/route";
import { CodexLivePage } from "./pages/CodexLivePage";
import { LegacyTerminalPage } from "./pages/LegacyTerminalPage";

function App() {
  const view = resolveTerminalView(window.location.pathname, import.meta.env.BASE_URL);
  return view === "codex" ? <CodexLivePage /> : <LegacyTerminalPage />;
}

export default App;
