// dsh-archive-delete — browser half.
//
// Adds one row to an archived Session's "..." menu: "永久删除…". The row is
// invisible on live/normal Sessions, so the destructive action only appears
// after the user has already archived the Session.
//
// Confirmation is a real modal (not window.confirm): permanent deletion needs
// a deliberate second gesture, an explicit warning, and a visible error state
// when the Host refuses.
window.__ModuleLoader__.load({
	id: "dsh-archive-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		// Optional host primitive: the real menu row styling. A loader lane that
		// does not expose it still works through the plain-button fallback.
		let primitives = null;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (_error) {
			primitives = null;
		}

		const NS = "dshArchiveDelete";
		const ENDPOINT = "/plugin/archive-delete/delete";

		const zh = {
			"menu.delete": "永久删除…",
			"menu.deleteHint": "永久删除这个归档会话",
			"dialog.title": "永久删除归档会话",
			"dialog.body": "「{title}」的会话日志、消息与工具记录将被永久删除，无法恢复。",
			"dialog.bodyUntitled": "这个归档会话的会话日志、消息与工具记录将被永久删除，无法恢复。",
			"dialog.warning": "此操作不可撤销。附件等共享文件不会被修改。",
			"dialog.cancel": "取消",
			"dialog.confirm": "永久删除",
			"dialog.deleting": "正在删除…",
			"dialog.close": "关闭",
			"error.not-archived": "这个会话已不在归档列表中，请刷新后重试。",
			"error.active": "这个会话正在运行，停止后才能删除。",
			"error.locked": "另一个进程正在写入这个会话，请稍后重试。",
			"error.busy": "删除已在进行中，请稍候。",
			"error.network": "无法连接 Host，请确认应用仍在运行后重试。",
			"error.internal": "删除失败，会话可能仍被保留。",
			"error.unavailable": "Host 的会话存储或工作区服务不可用。"
		};
		const en = {
			"menu.delete": "Delete permanently…",
			"menu.deleteHint": "Permanently delete this archived session",
			"dialog.title": "Delete archived session permanently",
			"dialog.body": "The session log, messages, and tool records of “{title}” will be permanently deleted and cannot be recovered.",
			"dialog.bodyUntitled": "The session log, messages, and tool records of this archived session will be permanently deleted and cannot be recovered.",
			"dialog.warning": "This cannot be undone. Shared files such as attachments are not modified.",
			"dialog.cancel": "Cancel",
			"dialog.confirm": "Delete permanently",
			"dialog.deleting": "Deleting…",
			"dialog.close": "Close",
			"error.not-archived": "This session is no longer archived. Refresh and try again.",
			"error.active": "This session is running. Stop it before deleting.",
			"error.locked": "Another process is writing this session. Try again shortly.",
			"error.busy": "A delete is already in progress. Please wait.",
			"error.network": "Cannot reach the Host. Make sure the app is still running.",
			"error.internal": "Deletion failed; the session may still exist.",
			"error.unavailable": "The Host session store or workspace service is unavailable."
		};

		// ── pending-delete store ─────────────────────────────────────────────

		let pending = null;
		const listeners = new Set();

		function emit() {
			for (const listener of [...listeners]) {
				try {
					listener();
				} catch (_error) {}
			}
		}

		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}

		function getPending() {
			return pending;
		}

		function openDelete(target) {
			pending = {
				sessionId: target.sessionId,
				title: typeof target.title === "string" ? target.title : "",
				phase: "confirm",
				error: null
			};
			emit();
		}

		function closeDelete() {
			if (pending === null || pending.phase === "deleting") return;
			pending = null;
			emit();
		}

		function failDelete(code) {
			if (pending === null) return;
			pending = { ...pending, phase: "confirm", error: code || "internal" };
			emit();
		}

		async function confirmDelete() {
			const target = pending;
			if (target === null || target.phase === "deleting") return;
			pending = { ...target, phase: "deleting", error: null };
			emit();
			try {
				const response = await fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					credentials: "same-origin",
					body: JSON.stringify({ sessionId: target.sessionId })
				});
				let data = null;
				try {
					data = await response.json();
				} catch (_error) {}
				if (!response.ok || data === null || data.ok !== true) {
					failDelete(data && typeof data.code === "string" ? data.code : "internal");
					return;
				}
				pending = null;
				emit();
			} catch (_error) {
				failDelete("network");
			}
		}

		// ── icons ────────────────────────────────────────────────────────────

		function TrashIcon({ size = 16 }) {
			return react.createElement(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.8,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true"
				},
				react.createElement("path", { d: "M3 6h18" }),
				react.createElement("path", { d: "M8 6V4h8v2" }),
				react.createElement("path", { d: "M19 6l-1 14H6L5 6" }),
				react.createElement("path", { d: "M10 11v5M14 11v5" })
			);
		}

		// ── menu row ─────────────────────────────────────────────────────────

		function DeleteMenuItem({ sessionId, displayTitle, useWorkspaces, useMenuOpenState, t }) {
			const archived = useWorkspaces((state) =>
				Boolean(state && Array.isArray(state.archivedSessionIds) && state.archivedSessionIds.includes(sessionId))
			);
			const [, setMenuOpen] = useMenuOpenState();

			if (!archived) return null;

			const label = t("menu.delete");
			const onSelect = () => {
				setMenuOpen(false);
				openDelete({ sessionId, title: displayTitle });
			};

			const MenuItemButton = primitives && primitives.MenuItemButton;
			if (typeof MenuItemButton === "function") {
				return react.createElement(
					MenuItemButton,
					{ separatorBefore: true, onSelect, title: t("menu.deleteHint") },
					react.createElement("span", { className: "dsh-ad-menu-icon" }, react.createElement(TrashIcon, { size: 14 })),
					label
				);
			}

			return react.createElement(
				"button",
				{
					type: "button",
					role: "menuitem",
					className: "dsh-ad-menu-item",
					title: t("menu.deleteHint"),
					onClick: onSelect
				},
				react.createElement("span", { className: "dsh-ad-menu-icon" }, react.createElement(TrashIcon, { size: 14 })),
				label
			);
		}

		// ── confirmation modal ───────────────────────────────────────────────

		function DeleteDialog({ t }) {
			const state = react.useSyncExternalStore(subscribe, getPending, getPending);
			const confirmRef = react.useRef(null);

			react.useEffect(() => {
				if (state === null) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						closeDelete();
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				return () => document.removeEventListener("keydown", onKeyDown, true);
			}, [state !== null]);

			react.useEffect(() => {
				if (state !== null && state.phase === "confirm" && confirmRef.current !== null) {
					confirmRef.current.focus();
				}
			}, [state !== null, state && state.phase, state && state.error]);

			if (state === null) return null;

			const title = state.title.trim();
			const body = title === "" ? t("dialog.bodyUntitled") : t("dialog.body", { title });
			const busy = state.phase === "deleting";
			const errorText = state.error === null ? null : t("error." + state.error);

			return react.createElement(
				"div",
				{
					className: "dsh-ad-backdrop",
					"data-dsh-archive-delete-dialog": true,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) closeDelete();
					}
				},
				react.createElement(
					"div",
					{
						className: "dsh-ad-dialog",
						role: "dialog",
						"aria-modal": "true",
						"aria-labelledby": "dsh-ad-dialog-title",
						"aria-describedby": "dsh-ad-dialog-body"
					},
					react.createElement(
						"div",
						{ className: "dsh-ad-dialog-head" },
						react.createElement("span", { className: "dsh-ad-dialog-icon" }, react.createElement(TrashIcon, { size: 18 })),
						react.createElement("h2", { id: "dsh-ad-dialog-title", className: "dsh-ad-dialog-title" }, t("dialog.title")),
						react.createElement(
							"button",
							{
								type: "button",
								className: "dsh-ad-close",
								"aria-label": t("dialog.close"),
								disabled: busy,
								onClick: closeDelete
							},
							"×"
						)
					),
					react.createElement("p", { id: "dsh-ad-dialog-body", className: "dsh-ad-dialog-body" }, body),
					react.createElement("p", { className: "dsh-ad-dialog-warning" }, t("dialog.warning")),
					errorText === null ? null : react.createElement("p", { className: "dsh-ad-dialog-error", role: "alert" }, errorText),
					react.createElement(
						"div",
						{ className: "dsh-ad-dialog-actions" },
						react.createElement(
							"button",
							{ type: "button", className: "dsh-ad-btn", disabled: busy, onClick: closeDelete },
							t("dialog.cancel")
						),
						react.createElement(
							"button",
							{
								ref: confirmRef,
								type: "button",
								className: "dsh-ad-btn dsh-ad-btn-danger",
								disabled: busy,
								onClick: confirmDelete
							},
							busy ? t("dialog.deleting") : t("dialog.confirm")
						)
					)
				)
			);
		}

		// ── styles ───────────────────────────────────────────────────────────

		const CSS = [
			".dsh-ad-menu-item{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;border:none;border-top:.5px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-state-error-primary,#d33);cursor:pointer;font:inherit;font-size:13px;line-height:20px;text-align:left;padding:7px 10px;border-radius:0 0 var(--dsw-radius-sm,6px) var(--dsw-radius-sm,6px)}",
			".dsh-ad-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".dsh-ad-menu-icon{display:inline-flex;align-items:center;color:currentColor}",
			".dsh-ad-backdrop{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.36);pointer-events:auto}",
			".dsh-ad-dialog{box-sizing:border-box;width:min(440px,100%);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-overlay,#fff);box-shadow:var(--dsw-elevation-panel,0 12px 40px rgba(0,0,0,.26));padding:18px 18px 16px;color:var(--dsw-alias-label-primary)}",
			".dsh-ad-dialog-head{display:flex;align-items:center;gap:9px}",
			".dsh-ad-dialog-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 auto;border-radius:8px;color:var(--dsw-alias-state-error-primary,#d33);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 12%,transparent)}",
			".dsh-ad-dialog-title{margin:0;font-size:15px;line-height:22px;font-weight:600;flex:1 1 auto}",
			".dsh-ad-close{display:grid;place-items:center;width:26px;height:26px;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;line-height:1;padding:0}",
			".dsh-ad-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary)}",
			".dsh-ad-dialog-body{margin:12px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
			".dsh-ad-dialog-warning{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#a60)}",
			".dsh-ad-dialog-error{margin:10px 0 0;padding:7px 9px;border-radius:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d33);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 10%,transparent)}",
			".dsh-ad-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}",
			".dsh-ad-btn{min-width:72px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;line-height:18px;padding:7px 14px}",
			".dsh-ad-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".dsh-ad-btn:disabled{opacity:.55;cursor:default}",
			".dsh-ad-btn-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary,#d33);color:#fff}",
			".dsh-ad-btn-danger:hover:not(:disabled){filter:brightness(.94);background:var(--dsw-alias-state-error-primary,#d33)}"
		].join("\n");

		function installStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css="dsh-archive-delete/dialog.css"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-archive-delete";
			tag.dataset.pluginCss = "dsh-archive-delete/dialog.css";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		// ── plugin body ──────────────────────────────────────────────────────

		const inject = ["slots", "locale"];

		function apply(ctx) {
			installStyles();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-archive-delete: dictionaries");

			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => {
				const dispose = ctx.slots.register(
					{
						name: "sidebar.workspaces.session.menu.item",
						id: "archive-delete",
						order: 500,
						locale: NS
					},
					DeleteMenuItem
				);
				return () => dispose();
			});

			ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register(
					{
						name: "shell.overlay",
						id: "archive-delete-dialog",
						order: 900,
						locale: NS
					},
					DeleteDialog
				);
				return () => dispose();
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__test = {
			closeDelete,
			confirmDelete,
			getPending,
			openDelete,
			subscribe
		};
		return module.exports;
	}
});
