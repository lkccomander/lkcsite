import { spawn } from "child_process";

export type CliAlertKind = "buy" | "sell" | "error" | "critical";

const WINDOWS_SOUND_FILE: Record<CliAlertKind, string> = {
    buy: "C:\\Windows\\Media\\Windows Ding.wav",
    sell: "C:\\Windows\\Media\\Windows Notify.wav",
    error: "C:\\Windows\\Media\\Windows Error.wav",
    critical: "C:\\Windows\\Media\\Windows Critical Stop.wav",
};

export function playCliAlertSound(kind: CliAlertKind): void {
    if (process.platform === "win32") {
        const soundFile = WINDOWS_SOUND_FILE[kind];
        const script = `$player = New-Object System.Media.SoundPlayer '${soundFile}'; $player.PlaySync()`;
        try {
            spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
                stdio: "ignore",
                windowsHide: true,
            });
            return;
        } catch {
            // Fall through to the terminal bell.
        }
    }

    process.stdout.write("\u0007");
}
