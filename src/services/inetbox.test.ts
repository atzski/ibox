import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./native", () => ({ isTauri: () => true }));
vi.mock("./launcher", () => ({ useLauncher: { subscribe: () => () => undefined } }));
import { useInetbox } from "./inetbox";

const user = { id: "a", username: "alice", displayName: "Alice", friendCode: "AAAA-BBBB-CCCC-DDDD", privacy: { shareOnline: false, shareGame: false } };
const snapshot = { user, friends: [], invitations: [], blocks: [] };
beforeEach(() => {
  invoke.mockReset();
  useInetbox.setState({ user: null, friends: [], invitations: [], blocks: [], status: "signedOut", busy: false, error: null, message: null });
});
describe("iNetbox desktop state", () => {
  it("restores only public account data through native commands", async () => {
    invoke.mockImplementation(async (_cmd, { action }) => action === "info" ? { url: "http://127.0.0.1:4318", local: true } : action === "restore" ? user : snapshot);
    await useInetbox.getState().restore();
    expect(useInetbox.getState().user).toEqual(user);
    expect(useInetbox.getState().status).toBe("online");
    expect(useInetbox.getState()).not.toHaveProperty("token");
  });
  it("expired sessions clear friends and account", async () => {
    useInetbox.setState({ user, status: "online" });
    invoke.mockRejectedValue({ code: "UNAUTHENTICATED", message: "Session expirée" });
    await useInetbox.getState().refresh();
    expect(useInetbox.getState().user).toBeNull();
    expect(useInetbox.getState().status).toBe("signedOut");
  });
  it("incorrect deletion password does not sign out the account", async () => {
    useInetbox.setState({ user, status: "online" });
    invoke.mockRejectedValue({ code: "UNAUTHENTICATED", message: "Mot de passe incorrect" });
    expect(await useInetbox.getState().act("deleteAccount", { password: "bad" })).toBe(false);
    expect(useInetbox.getState().user).toEqual(user);
    expect(useInetbox.getState().busy).toBe(false);
  });
  it("offline logout clears local social data and reports failed remote revocation", async () => {
    useInetbox.setState({ user, status: "online" });
    invoke.mockResolvedValue({ revoked: false });
    await useInetbox.getState().act("logout");
    expect(useInetbox.getState().user).toBeNull();
    expect(useInetbox.getState().message).toContain("révocation distante");
  });
  it("network failure keeps the account but marks all presence as unavailable", async () => {
    useInetbox.setState({ user, status: "online" });
    invoke.mockRejectedValue({ code: "NETWORK_ERROR", message: "Hors ligne" });
    await useInetbox.getState().refresh();
    expect(useInetbox.getState().status).toBe("offline");
    expect(useInetbox.getState().user).toEqual(user);
    // Explicit logout remains possible even while retries are backed off.
    invoke.mockResolvedValue({ revoked: false });
    await useInetbox.getState().act("logout");
  });
  it("blocks rapid reactivation locally while allowing Invisible immediately", async () => {
    useInetbox.setState({ user, status: "online" });
    const online = { ...user, privacy: { ...user.privacy, shareOnline: true } };
    invoke.mockImplementation(async (_cmd, { action, body }) =>
      action === "profile" ? (body.shareOnline ? online : user) : null);
    expect(await useInetbox.getState().act("profile", { shareOnline: true })).toBe(true);
    expect(await useInetbox.getState().act("profile", { shareOnline: false })).toBe(true);
    expect(await useInetbox.getState().act("profile", { shareOnline: true })).toBe(false);
    expect(invoke.mock.calls.filter(([, args]) => args.action === "profile")).toHaveLength(2);
    expect(invoke.mock.calls.some(([, args]) => args.action === "snapshot")).toBe(false);
    await useInetbox.getState().act("logout");
  });
  it("late refresh cannot resurrect the account after logout", async () => {
    useInetbox.setState({ user, status: "online" });
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation((_cmd, { action }) => action === "snapshot" ? new Promise((r) => { resolve = r; }) : Promise.resolve({ revoked: true }));
    const refresh = useInetbox.getState().refresh();
    await useInetbox.getState().act("logout");
    resolve(snapshot);
    await refresh;
    expect(useInetbox.getState().user).toBeNull();
    expect(useInetbox.getState().status).toBe("signedOut");
  });
});
