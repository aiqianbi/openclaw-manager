English | [中文](./README_zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

# OpenClaw Manager

The project is organized using a two-tier Electron structure:

- `main.js` + `preload.js`: Electron main process and IPC

- `renderer/`: React + TypeScript + Zustand + Tailwind (shadcn style components)

## Screenshot

<p align="center">
  <img src="assets/en/1.png" style="width: 100%; height: auto;">
</p>
<p align="center">
  <img src="assets/en/2.png" style="width: 100%; height: auto;">
</p>
<p align="center">
  <img src="assets/en/3.png" style="width: 100%; height: auto;">
</p>

## Running

1) Install dependencies

```bash
pnpm install
pnpm run renderer:install

```
2) Start the rendering layer (Vite)

```bash
pnpm run renderer:dev

```
3) Start Electron (load React Dev Server)

```bash
pnpm run dev:electron-react

```