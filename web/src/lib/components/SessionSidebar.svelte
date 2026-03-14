<script lang="ts">
	import { ChevronDown, FolderOpen, Plus, Trash2, X, PanelLeftClose, PanelLeftOpen } from 'lucide-svelte';
	import { chatStore } from '$lib/chat/ChatStore.svelte.js';
	import { fetchSessions, deleteSession, fetchProjects, createProject, deleteProject } from '$lib/chat/api.js';
	import type { SessionInfo, Project } from '$lib/chat/types.js';
	import KnowledgeSidebar from './KnowledgeSidebar.svelte';

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let sidebarOpen    = $state(true);
	let sessions       = $state<SessionInfo[]>([]);
	let projects       = $state<Project[]>([]);
	let deletingId     = $state<string | null>(null);
	let activeTab      = $state<'sessions' | 'knowledge'>('sessions');
	let switching      = $state(false);
	let loadError      = $state(false);
	let projectPickerOpen = $state(false);
	let newProjectName = $state('');
	let creatingProject = $state(false);
	let errorRetryDelay = 30_000;

	// ---------------------------------------------------------------------------
	// Derived: sessions filtered by current project
	// ---------------------------------------------------------------------------

	const visibleSessions = $derived(
		chatStore.currentProject
			? sessions.filter((s) => s.projectId === chatStore.currentProject!.id)
			: sessions
	);

	// ---------------------------------------------------------------------------
	// Session grouping helpers
	// ---------------------------------------------------------------------------

	function relativeTime(ts: number): string {
		const diff = ts - Date.now();
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

	interface SessionGroup { label: string; sessions: SessionInfo[]; }

	function groupSessions(list: SessionInfo[]): SessionGroup[] {
		const now = Date.now();
		const todayStart = startOfDay(now);
		const yesterdayStart = todayStart - 86_400_000;
		const sevenDaysAgo = todayStart - 7 * 86_400_000;
		const today: SessionInfo[] = [], yesterday: SessionInfo[] = [],
			lastWeek: SessionInfo[] = [], older: SessionInfo[] = [];
		for (const s of list) {
			const ts = s.lastActive;
			if (ts >= todayStart) today.push(s);
			else if (ts >= yesterdayStart) yesterday.push(s);
			else if (ts >= sevenDaysAgo) lastWeek.push(s);
			else older.push(s);
		}
		const groups: SessionGroup[] = [];
		if (today.length)     groups.push({ label: 'Today', sessions: today });
		if (yesterday.length) groups.push({ label: 'Yesterday', sessions: yesterday });
		if (lastWeek.length)  groups.push({ label: 'Previous 7 Days', sessions: lastWeek });
		if (older.length)     groups.push({ label: 'Older', sessions: older });
		return groups;
	}

	const sessionGroups = $derived(groupSessions(visibleSessions));

	// ---------------------------------------------------------------------------
	// Data loading
	// ---------------------------------------------------------------------------

	async function loadAll(): Promise<void> {
		try {
			[sessions, projects] = await Promise.all([fetchSessions(), fetchProjects()]);
			loadError = false;
			errorRetryDelay = 30_000;
		} catch {
			loadError = true;
			errorRetryDelay = Math.min(errorRetryDelay * 2, 300_000);
		}
	}

	$effect(() => {
		loadAll();
		let timer: ReturnType<typeof setTimeout>;
		function schedule() {
			timer = setTimeout(async () => { await loadAll(); schedule(); }, errorRetryDelay);
		}
		schedule();
		return () => clearTimeout(timer);
	});

	// ---------------------------------------------------------------------------
	// Project actions
	// ---------------------------------------------------------------------------

	function selectProject(p: Project | null): void {
		projectPickerOpen = false;
		chatStore.setProject(p);
	}

	async function handleCreateProject(): Promise<void> {
		const name = newProjectName.trim();
		if (!name || creatingProject) return;
		creatingProject = true;
		try {
			const p = await createProject(name);
			projects = [p, ...projects];
			newProjectName = '';
			chatStore.setProject(p);
			projectPickerOpen = false;
		} finally {
			creatingProject = false;
		}
	}

	async function handleDeleteProject(p: Project, e: MouseEvent): Promise<void> {
		e.stopPropagation();
		await deleteProject(p.id).catch(() => {});
		projects = projects.filter((x) => x.id !== p.id);
		if (chatStore.currentProject?.id === p.id) chatStore.setProject(null);
	}

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
		try { await chatStore.loadSession(session.id); }
		finally { switching = false; }
	}

	async function handleConfirmDelete(id: string): Promise<void> {
		try { await deleteSession(id); } catch { /* silent */ }
		sessions = sessions.filter((s) => s.id !== id);
		if (chatStore.sessionId === id) chatStore.resetSession();
		deletingId = null;
	}

	function handleCancelDelete(): void { deletingId = null; }
</script>

<!-- Sidebar -->
<aside
	class="transition-[max-width] duration-200 ease-in-out overflow-hidden border-r border-border flex flex-col bg-background shrink-0"
	style="max-width: {sidebarOpen ? '256px' : '0px'};"
>
	<div class="w-64 flex flex-col h-full">
		<!-- Header: collapse + new chat -->
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

		<!-- Project selector -->
		<div class="px-3 pb-2 shrink-0">
			<button
				onclick={() => (projectPickerOpen = !projectPickerOpen)}
				class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-border text-xs transition-colors hover:bg-accent"
			>
				<FolderOpen size={13} class="shrink-0 text-primary" />
				<span class="flex-1 text-left truncate font-medium">
					{chatStore.currentProject?.name ?? 'All sessions'}
				</span>
				<ChevronDown size={13} class="shrink-0 text-muted-foreground transition-transform {projectPickerOpen ? 'rotate-180' : ''}" />
			</button>

			{#if projectPickerOpen}
				<div class="mt-1 rounded-md border border-border bg-background shadow-lg overflow-hidden">
					<!-- All sessions option -->
					<button
						onclick={() => selectProject(null)}
						class="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors flex items-center gap-2 {!chatStore.currentProject ? 'font-medium text-foreground' : 'text-muted-foreground'}"
					>
						All sessions
					</button>

					{#if projects.length > 0}
						<div class="border-t border-border">
							{#each projects as p (p.id)}
								<div class="group flex items-center">
									<button
										onclick={() => selectProject(p)}
										class="flex-1 text-left px-3 py-2 text-xs hover:bg-accent transition-colors truncate {chatStore.currentProject?.id === p.id ? 'font-medium text-foreground' : 'text-muted-foreground'}"
									>
										{p.name}
									</button>
									<button
										onclick={(e) => handleDeleteProject(p, e)}
										class="p-1.5 mr-1 opacity-0 group-hover:opacity-100 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
										aria-label="Delete project"
									>
										<Trash2 size={11} />
									</button>
								</div>
							{/each}
						</div>
					{/if}

					<!-- New project input -->
					<div class="border-t border-border px-2 py-1.5 flex gap-1">
						<input
							bind:value={newProjectName}
							onkeydown={(e) => e.key === 'Enter' && handleCreateProject()}
							placeholder="New project..."
							class="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
						/>
						<button
							onclick={handleCreateProject}
							disabled={!newProjectName.trim() || creatingProject}
							class="p-1 rounded hover:bg-accent disabled:opacity-40 transition-colors"
							aria-label="Create project"
						>
							<Plus size={12} />
						</button>
					</div>
				</div>
			{/if}
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
			<div class="flex-1 overflow-y-auto py-1">
				{#if loadError && sessions.length === 0}
					<div class="mx-3 my-2 flex items-center gap-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
						<span class="flex-1">Failed to load sessions</span>
						<button onclick={loadAll} class="underline hover:no-underline">Retry</button>
					</div>
				{/if}
				{#if sessionGroups.length === 0 && !loadError}
					<p class="px-3 py-4 text-xs text-muted-foreground">
						{chatStore.currentProject ? 'No sessions in this project yet' : 'No sessions yet'}
					</p>
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
									<div class="mx-2 mb-0.5 flex items-center gap-1 px-2 py-1.5 rounded bg-destructive/10 text-xs">
										<span class="flex-1 text-destructive font-medium">Delete?</span>
										<button
											onclick={() => handleConfirmDelete(session.id)}
											class="px-2 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors text-xs font-medium"
										>Delete</button>
										<button
											onclick={handleCancelDelete}
											class="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground"
											aria-label="Cancel delete"
										>
											<X size={12} />
										</button>
									</div>
								{:else}
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
											<div class="flex items-center gap-2">
												<span class="text-[10px] text-muted-foreground">{relativeTime(session.lastActive)}</span>
												{#if !chatStore.currentProject && session.projectId}
													{@const proj = projects.find((p) => p.id === session.projectId)}
													{#if proj}
														<span class="text-[10px] bg-primary/10 text-primary px-1 rounded">{proj.name}</span>
													{/if}
												{/if}
											</div>
										</button>
										<button
											onclick={(e) => { e.stopPropagation(); deletingId = session.id; }}
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
			<div class="flex-1 overflow-hidden">
				<KnowledgeSidebar />
			</div>
		{/if}
	</div>
</aside>

<!-- Collapsed-state toggle -->
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
