import { LegacyTerminalPage } from "./pages/LegacyTerminalPage";
import { resolveTerminalView } from "./lib/route";

function App() {
  void resolveTerminalView(window.location.pathname, import.meta.env.BASE_URL);
  return <LegacyTerminalPage />;
}

export default App;
