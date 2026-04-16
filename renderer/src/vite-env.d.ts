/// <reference types="vite/client" />

import type { OpenClawApi } from "./types/electron-api";

declare global {
  interface Window {
    api?: OpenClawApi;
  }
}

export {};
