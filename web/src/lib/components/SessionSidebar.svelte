<script lang="ts">
	import { Plus, Trash2, X, PanelLeftClose, PanelLeftOpen } from 'lucide-svelte';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import { fetchSessions, deleteSession } from '$lib/chat/api.js';
	import type { SessionInfo } from '$lib/chat/types.js';
	import KnowledgeSidebar from './KnowledgeSidebar.svelte';

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let sidebarOpen = $state(true);
	let sessions = $state<SessionInfo[]>([]);
	let deletingId = $state<string | null>(null);
	let activeTab = $state<'sessions' | 'knowledge'>('sessions');
	let switching = $state(false);
	let loadError = $state(false);
	let errorRetryDelay = 30_000; // starts at 30s, backs off on repeated failures

	// ---------------------------------------------------------------------------
	// Session grouping helpers
	// ---------------------------------------------------------------------------

	function relativeTime(ts: number): string {
		const diff = ts - Date.now(); // negative = past
		const abs = Math.abs(diff);
		const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
		if (abs < 60_000) return 'just now';
		if (abs < 3_600_000) return rtf.format(-Math.floor(abs / 60_000), 'minute');
		if (abs < 86_400_000) return rtf.format(-Math.floor(abs / 3_600_000), 'hour');
		return rtf.format(-Math.floor(abs / 86_400_000), 'day');
	}

	function startOfDay(ts: number): number {
		const d = new Date(ts);
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	}

	interface SessionGroup {
		label: string;
		sessions: SessionInfo[];
	}

	function groupSessions(list: SessionInfo[]): SessionGroup[] {
		const now = Date.now();
		const todayStart = startOfDay(now);
		const yesterdayStart = todayStart - 86_400_000;
		const sevenDaysAgo = todayStart - 7 * 86_400_000;

		const today: SessionInfo[] = [];
		const yesterday: SessionInfo[] = [];
		const lastWeek: SessionInfo[] = [];
		const older: SessionInfo[] = [];

		for (const s of list) {
			const ts = s.lastActive;
			if (ts >= todayStart) {
				today.push(s);
			} else if (ts >= yesterdayStart) {
				yesterday.push(s);
			} else if (ts >= sevenDaysAgo) {
				lastWeek.push(s);
			} else {
				older.push(s);
			}
		}

		const groups: SessionGroup[] = [];
		if (today.length > 0) groups.push({ label: 'Today', sessions: today });
		if (yesterday.length > 0) groups.push({ label: 'Yesterday', sessions: yesterday });
		if (lastWeek.length > 0) groups.push({ label: 'Previous 7 Days', sessions: lastWeek });
		if (older.length > 0) groups.push({ label: 'Older', sessions: older });
		return groups;
	}

	const sessionGroups = $derived(groupSessions(sessions));

	// ---------------------------------------------------------------------------
	// Session loading + polling
	// ---------------------------------------------------------------------------

	async function loadSessions(): Promise<void> {
		try {
			sessions = await fetchSessions();
			loadError = false;
			errorRetryDelay = 30_000; // reset backoff on success
		} catch {
			loadError = true;
			errorRetryDelay = Math.min(errorRetryDelay * 2, 300_000); // cap at 5 min
		}
	}

	$effect(() => {
		loadSessions();
		let timer: ReturnType<typeof setTimeout>;
		function schedule() {
			timer = setTimeout(async () => {
				await loadSessions();
				schedule();
			}, errorRetryDelay);
		}
		schedule();
		return () => clearTimeout(timer);
	});

	// ---------------------------------------------------------------------------
	// Session actions
	// ---------------------------------------------------------------------------

	function handleNewChat(): void {
		deletingId = null;
		chatStore.resetSession();
	}

	async function handleSwitchSession(session: SessionInfo): Promise<void> {
		if (deletingId === session.id || switching) return;
		switching = true;
		try {
			await chatStore.loadSession(session.id);
		} finally {
			switching = false;
		}
	}

	async function handleConfirmDelete(id: string): Promise<void> {
		try {
			await deleteSession(id);
		} catch {
			// Silent fail — optimistic removal still proceeds
		}
		sessions = sessions.filter((s) => s.id !== id);
		if (chatStore.sessionId === id) {
			chatStore.resetSession();
		}
		deletingId = null;
	}

	function handleCancelDelete(): void {
		deletingId = null;
	}
</script>

<!-- Sidebar: always in DOM, max-width transition collapses it without removing from flow -->
<aside
	class="transition-[max-width] duration-200 ease-in-out overflow-hidden border-r border-border flex flex-col bg-background shrink-0"
	style="max-width: {sidebarOpen ? '256px' : '0px'};"
>
	<!-- Inner wrapper keeps content at a fixed width so it clips cleanly during collapse -->
	<div class="w-64 flex flex-col h-full">
		<!-- Sidebar header: toggle + new chat -->
		<div class="flex items-center gap-2 px-3 py-3 shrink-0">
			<button
				onclick={() => (sidebarOpen = !sidebarOpen)}
				class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
				title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
				aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
			>
				{#if sidebarOpen}
					<PanelLeftClose size={16} />
				{:else}
					<PanelLeftOpen size={16} />
				{/if}
			</button>

			<button
				onclick={handleNewChat}
				class="flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors text-foreground"
				title="New chat"
			>
				<Plus size={14} />
				<span>New chat</span>
			</button>
		</div>

		<!-- Tab row -->
		<div class="flex border-b border-border shrink-0">
			<button
				onclick={() => (activeTab = 'sessions')}
				class="flex-1 py-1.5 text-xs font-medium transition-colors {activeTab === 'sessions'
					? 'border-b-2 border-foreground text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				Sessions
			</button>
			<button
				onclick={() => (activeTab = 'knowledge')}
				class="flex-1 py-1.5 text-xs font-medium transition-colors {activeTab === 'knowledge'
					? 'border-b-2 border-foreground text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				Knowledge
			</button>
		</div>

		<!-- Tab content -->
		{#if activeTab === 'sessions'}
			<!-- Session list -->
			<div class="flex-1 overflow-y-auto py-1">
				{#if loadError}
					<div class="mx-3 my-2 flex items-center gap-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
						<span class="flex-1">Failed to load sessions</span>
						<button onclick={loadSessions} class="underline hover:no-underline">Retry</button>
					</div>
				{/if}
				{#if sessionGroups.length === 0 && !loadError}
					<p class="px-3 py-4 text-xs text-muted-foreground">No sessions yet</p>
				{:else}
					{#each sessionGroups as group (group.label)}
						<div class="mb-1">
							<p class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								{group.label}
							</p>
							{#each group.sessions as session (session.id)}
								{@const isActive = chatStore.sessionId === session.id}
								{@const isDeleting = deletingId === session.id}

								{#if isDeleting}
									<!-- Delete confirmation row -->
									<div class="mx-2 mb-0.5 flex items-center gap-1 px-2 py-1.5 rounded bg-destructive/10 text-xs">
										<span class="flex-1 text-destructive font-medium">Delete?</span>
										<button
											onclick={() => handleConfirmDelete(session.id)}
											class="px-2 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors text-xs font-medium"
										>
											Delete
										</button>
										<button
											onclick={handleCancelDelete}
											class="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground"
											aria-label="Cancel delete"
										>
											<X size={12} />
										</button>
									</div>
								{:else}
									<!-- Normal session row -->
									<div class="group mx-2 mb-0.5 relative">
										<button
											onclick={() => handleSwitchSession(session)}
											disabled={switching}
											class="w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex flex-col gap-0.5 {isActive
												? 'bg-accent text-foreground'
												: 'text-muted-foreground hover:bg-accent hover:text-foreground'} disabled:opacity-50 disabled:cursor-wait"
										>
											<span class="truncate font-medium text-foreground leading-tight">{session.title}</span>
											{#if session.lastMessagePreview}
												<span class="truncate text-[11px] text-muted-foreground/70 leading-tight">{session.lastMessagePreview}</span>
											{/if}
											<span class="text-[10px] text-muted-foreground">{relativeTime(session.lastActive)}</span>
										</button>
										<!-- Trash icon, visible on hover -->
										<button
											onclick={(e) => {
												e.stopPropagation();
												deletingId = session.id;
											}}
											class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
											aria-label="Delete session"
										>
											<Trash2 size={12} />
										</button>
									</div>
								{/if}
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		{:else}
			<!-- Knowledge tab -->
			<div class="flex-1 overflow-hidden">
				<KnowledgeSidebar />
			</div>
		{/if}
	</div>
</aside>

<!-- Collapsed-state toggle button: visible when sidebar is closed -->
{#if !sidebarOpen}
	<button
		onclick={() => (sidebarOpen = true)}
		class="fixed left-0 top-3 z-10 p-2 bg-background border border-border rounded-r-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shadow-sm"
		title="Expand sidebar"
		aria-label="Expand sidebar"
	>
		<PanelLeftOpen size={16} />
	</button>
{/if}
