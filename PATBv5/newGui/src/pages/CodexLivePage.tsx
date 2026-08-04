import { CodexLiveView } from "../components/codex/CodexLiveView";
import { useBotControl } from "../hooks/useBotControl";
import { useTerminalData } from "../hooks/useTerminalData";

export function CodexLivePage() {
  const terminal = useTerminalData();
  const control = useBotControl();
  return <CodexLiveView data={terminal.data} error={terminal.error} stale={terminal.stale} control={control} />;
}
