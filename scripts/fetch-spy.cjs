// fetch-spy: preload hook that logs every URL the Convex CLI fetches
const orig = global.fetch;
global.fetch = (...args) => {
  try {
    const u = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
    if (u) console.error("FETCH:", u);
  } catch {}
  return orig(...args);
};
