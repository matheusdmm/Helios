import { getLanguage, t } from "./i18n.js";
export const isDesktop = document.documentElement.hasAttribute("data-desktop");
export function setupDesktop() {
  if (!isDesktop)
    return () => {};
  for (const element of document.querySelectorAll("[data-desktop-only]"))
    element.hidden = false;
  const entries = document.getElementById("log-entries");
  const logStatus = document.getElementById("logs-status");
  let logs = [];
  let unavailable = false;
  let loading = false;
  const renderLogs = () => {
    const formatTime = new Intl.DateTimeFormat(getLanguage(), { dateStyle: "short", timeStyle: "medium" });
    const rows = logs.map((entry) => {
      const row = document.createElement("li");
      row.dataset.level = entry.level;
      const time = document.createElement("time");
      time.dateTime = entry.at;
      time.textContent = formatTime.format(new Date(entry.at));
      const level = document.createElement("strong");
      level.textContent = t(entry.level === "error" ? "Erro" : "Informação");
      const message = document.createElement("span");
      message.className = "log-message";
      message.textContent = t(entry.message);
      row.append(time, level, message);
      return row;
    });
    entries.replaceChildren(...rows);
    entries.hidden = rows.length === 0;
    logStatus.hidden = !unavailable && rows.length > 0;
    logStatus.textContent = logStatus.hidden ? "" : t(unavailable ? "Não foi possível atualizar os logs." : "Nenhuma mensagem registrada.");
  };
  const loadLogs = async () => {
    if (loading || document.hidden)
      return;
    loading = true;
    try {
      const response = await fetch(`/api/desktop/logs?after=${logs[0]?.id ?? 0}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (response.status !== 204) {
        if (!response.ok)
          throw new Error;
        logs = await response.json();
      } else if (!unavailable)
        return;
      unavailable = false;
      renderLogs();
    } catch {
      if (!unavailable) {
        unavailable = true;
        renderLogs();
      }
    } finally {
      loading = false;
    }
  };
  loadLogs();
  setInterval(loadLogs, 3000);
  document.addEventListener("visibilitychange", loadLogs);
  const exportMessage = document.getElementById("export-message");
  const exports = [...document.querySelectorAll(".data-actions a")];
  let exporting = false;
  for (const link of exports) {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      if (exporting)
        return;
      exporting = true;
      for (const action of exports)
        action.setAttribute("aria-disabled", "true");
      exportMessage.hidden = false;
      exportMessage.textContent = t("Preparando exportação…");
      try {
        const scope = new URL(link.href).searchParams.get("scope");
        const query = new URLSearchParams({ scope, lang: getLanguage() });
        const response = await fetch(`/api/desktop/export?${query}`, {
          method: "POST",
          headers: { "X-Local-Setup": "1" }
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error);
        exportMessage.hidden = !result.saved;
        exportMessage.textContent = result.saved ? t("CSV salvo.") : "";
      } catch (error) {
        exportMessage.textContent = t(error.message || "Não foi possível exportar o CSV. Consulte os logs.");
      } finally {
        exporting = false;
        for (const action of exports)
          action.removeAttribute("aria-disabled");
        loadLogs();
      }
    });
  }
  return renderLogs;
}
