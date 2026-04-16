[English](./README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

# OpenClaw Manager

项目按 Electron 双层结构组织：

- `main.js` + `preload.js`：Electron 主进程与 IPC
- `renderer/`：React + TypeScript + Zustand + Tailwind（shadcn 风格组件）

## 运行

1) 安装依赖

```bash
pnpm install
pnpm run renderer:install
```

2) 启动渲染层（Vite）

```bash
pnpm run renderer:dev
```

3) 启动 Electron（加载 React Dev Server）

```bash
pnpm run dev:electron-react
```

