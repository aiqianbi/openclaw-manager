const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getStatus: (payload) => ipcRenderer.invoke("manager:getStatus", payload),
  openExternal: (payload) => ipcRenderer.invoke("manager:openExternal", payload),
  getOnboardingState: () => ipcRenderer.invoke("manager:getOnboardingState"),
  retryOnboardingStep: (payload) => ipcRenderer.invoke("manager:retryOnboardingStep", payload),
  finishOnboarding: () => ipcRenderer.invoke("manager:finishOnboarding"),
  controlGateway: (action) => ipcRenderer.invoke("manager:controlGateway", action),
  checkUpdates: () => ipcRenderer.invoke("manager:checkUpdates"),
  updateOpenClaw: () => ipcRenderer.invoke("manager:updateOpenClaw"),
  installOpenClaw: () => ipcRenderer.invoke("manager:installOpenClaw"),
  setupOpenClaw: () => ipcRenderer.invoke("manager:setupOpenClaw"),
  uninstallOpenClaw: () => ipcRenderer.invoke("manager:uninstallOpenClaw"),
  chat: (payload) => ipcRenderer.invoke("manager:chat", payload),
  getGatewayConnectInfo: () => ipcRenderer.invoke("manager:getGatewayConnectInfo"),
  gatewayCall: (payload) => ipcRenderer.invoke("manager:gatewayCall", payload),
  httpFetch: (payload) => ipcRenderer.invoke("manager:httpFetch", payload),
  skillsInstall: (payload) => ipcRenderer.invoke("manager:skillsInstall", payload),
  pairingCli: (payload) => ipcRenderer.invoke("manager:pairingCli", payload),
  channelsLoginStart: (payload) => ipcRenderer.invoke("manager:channelsLoginStart", payload),
  channelsLoginCancel: (payload) => ipcRenderer.invoke("manager:channelsLoginCancel", payload),
  channelsLoginOnEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("manager:channelsLoginEvent", listener);
    return () => ipcRenderer.removeListener("manager:channelsLoginEvent", listener);
  },
  pluginCli: (payload) => ipcRenderer.invoke("manager:pluginCli", payload),
  pluginsList: () => ipcRenderer.invoke("manager:pluginsList"),
  pluginToggle: (payload) => ipcRenderer.invoke("manager:pluginToggle", payload),
  saveAgent: (payload) => ipcRenderer.invoke("manager:saveAgent", payload),
  addAgent: (payload) => ipcRenderer.invoke("manager:addAgent", payload),
  deleteAgent: (payload) => ipcRenderer.invoke("manager:deleteAgent", payload),
  testModelConnection: (payload) => ipcRenderer.invoke("manager:testModelConnection", payload)
});
