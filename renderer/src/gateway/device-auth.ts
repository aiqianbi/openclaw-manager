import { getSafeLocalStorage } from "./local-storage";

export type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

export type DeviceAuthStore = {
  version: 1;
  deviceId: string;
  tokens: Record<string, DeviceAuthEntry>;
};

function normalizeDeviceAuthRole(role: string): string {
  return role.trim();
}

function normalizeDeviceAuthScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const out = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

type DeviceAuthStoreAdapter = {
  readStore: () => DeviceAuthStore | null;
  writeStore: (store: DeviceAuthStore) => void;
};

function loadDeviceAuthTokenFromStore(params: {
  adapter: DeviceAuthStoreAdapter;
  deviceId: string;
  role: string;
}): DeviceAuthEntry | null {
  const store = params.adapter.readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return null;
  }
  const role = normalizeDeviceAuthRole(params.role);
  const entry = store.tokens[role];
  if (!entry || typeof entry.token !== "string") {
    return null;
  }
  return entry;
}

function storeDeviceAuthTokenInStore(params: {
  adapter: DeviceAuthStoreAdapter;
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}): DeviceAuthEntry {
  const role = normalizeDeviceAuthRole(params.role);
  const existing = params.adapter.readStore();
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens ? { ...existing.tokens } : {},
  };
  const entry: DeviceAuthEntry = {
    token: params.token,
    role,
    scopes: normalizeDeviceAuthScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;
  params.adapter.writeStore(next);
  return entry;
}

function clearDeviceAuthTokenFromStore(params: {
  adapter: DeviceAuthStoreAdapter;
  deviceId: string;
  role: string;
}): void {
  const store = params.adapter.readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const role = normalizeDeviceAuthRole(params.role);
  if (!store.tokens[role]) {
    return;
  }
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  delete next.tokens[role];
  params.adapter.writeStore(next);
}

const STORAGE_KEY = "openclaw.device.auth.v1";

function readStore(): DeviceAuthStore | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    if (!parsed || parsed.version !== 1) {
      return null;
    }
    if (!parsed.deviceId || typeof parsed.deviceId !== "string") {
      return null;
    }
    if (!parsed.tokens || typeof parsed.tokens !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(store: DeviceAuthStore) {
  try {
    getSafeLocalStorage()?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // best-effort
  }
}

const adapter: DeviceAuthStoreAdapter = { readStore, writeStore };

export function loadDeviceAuthToken(params: { deviceId: string; role: string }): DeviceAuthEntry | null {
  return loadDeviceAuthTokenFromStore({
    adapter,
    deviceId: params.deviceId,
    role: params.role,
  });
}

export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}): DeviceAuthEntry {
  return storeDeviceAuthTokenInStore({
    adapter,
    deviceId: params.deviceId,
    role: params.role,
    token: params.token,
    scopes: params.scopes,
  });
}

export function clearDeviceAuthToken(params: { deviceId: string; role: string }) {
  clearDeviceAuthTokenFromStore({
    adapter,
    deviceId: params.deviceId,
    role: params.role,
  });
}
