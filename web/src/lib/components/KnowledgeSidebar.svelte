<script lang="ts">
	import { Search, Upload, FileText, Trash2, X } from 'lucide-svelte';
	import { fetchDocuments, deleteDocument, uploadDocument } from '$lib/chat/api.js';
	import type { KnowledgeDocument } from '$lib/chat/types.js';

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let documents = $state<KnowledgeDocument[]>([]);
	let searchQuery = $state('');
	let dragCount = $state(0);
	let uploading = $state(false);
	let deletingId = $state<string | null>(null);

	const isDragging = $derived(dragCount > 0);

	const filteredDocs = $derived(
		searchQuery.trim() === ''
			? documents
			: documents.filter((d) =>
					d.filename.toLowerCase().includes(searchQuery.toLowerCase())
				)
	);

	// ---------------------------------------------------------------------------
	// Document loading
	// ---------------------------------------------------------------------------

	async function loadDocuments(): Promise<void> {
		try {
			documents = await fetchDocuments();
		} catch {
			// Silent fail — show previous state
		}
	}

	$effect(() => {
		loadDocuments();
	});

	// ---------------------------------------------------------------------------
	// Date formatting
	// ---------------------------------------------------------------------------

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// ---------------------------------------------------------------------------
	// Upload
	// ---------------------------------------------------------------------------

	let fileInput: HTMLInputElement | undefined = $state();

	async function handleFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		uploading = true;
		try {
			// Upload first file only for v1
			await uploadDocument(files[0]);
			await loadDocuments();
		} catch {
			// Silent fail — document list may not show new file
		} finally {
			uploading = false;
		}
	}

	function handleClickUpload(): void {
		fileInput?.click();
	}

	function handleFileInputChange(e: Event): void {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		handleFiles(files);
		// Reset so same file can be re-uploaded
		input.value = '';
	}

	// ---------------------------------------------------------------------------
	// Drag-and-drop  (counter approach — RESEARCH Pitfall 4)
	// ---------------------------------------------------------------------------

	function handleDragEnter(e: DragEvent): void {
		e.preventDefault();
		dragCount++;
	}

	function handleDragLeave(): void {
		dragCount--;
	}

	function handleDragOver(e: DragEvent): void {
		e.preventDefault(); // required to enable drop
	}

	function handleDrop(e: DragEvent): void {
		e.preventDefault();
		dragCount = 0;
		const files = Array.from(e.dataTransfer?.files ?? []);
		handleFiles(files);
	}

	// ---------------------------------------------------------------------------
	// Delete
	// ---------------------------------------------------------------------------

	async function handleConfirmDelete(id: string): Promise<void> {
		try {
			await deleteDocument(id);
		} catch {
			// Silent fail — optimistic removal still proceeds
		}
		documents = documents.filter((d) => d.id !== id);
		deletingId = null;
	}

	function handleCancelDelete(): void {
		deletingId = null;
	}
</script>

<!-- Knowledge sidebar content area with sidebar-only drag-and-drop -->
<div
	class="flex flex-col h-full"
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
	ondragover={handleDragOver}
	ondrop={handleDrop}
	role="region"
	aria-label="Knowledge base"
>
	<!-- Search row + upload button -->
	<div class="flex items-center gap-1.5 px-3 py-2 shrink-0">
		<div class="relative flex-1">
			<Search
				size={12}
				class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
			/>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Filter documents..."
				class="w-full pl-6 pr-2 py-1 text-xs rounded bg-muted border border-transparent focus:border-border focus:outline-none placeholder:text-muted-foreground"
			/>
		</div>
		<button
			onclick={handleClickUpload}
			class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
			title="Upload document"
			aria-label="Upload document"
		>
			<Upload size={14} />
		</button>
		<!-- Hidden file input for click-to-upload -->
		<input
			bind:this={fileInput}
			type="file"
			class="hidden"
			onchange={handleFileInputChange}
			aria-hidden="true"
		/>
	</div>

	<!-- Upload progress bar -->
	{#if uploading}
		<div class="mx-3 mb-1 h-0.5 rounded overflow-hidden bg-muted shrink-0">
			<div class="h-full bg-primary/50 animate-pulse w-full"></div>
		</div>
	{/if}

	<!-- Document list / drag overlay area -->
	<div class="relative flex-1 overflow-hidden">
		{#if isDragging}
			<!-- Drop overlay -->
			<div
				class="absolute inset-2 flex flex-col items-center justify-center gap-2 bg-primary/5 border-2 border-dashed border-primary rounded-lg z-10 pointer-events-none"
			>
				<Upload size={20} class="text-primary" />
				<span class="text-xs text-primary font-medium">Drop to upload</span>
			</div>
		{/if}

		<div class="h-full overflow-y-auto py-1">
			{#if filteredDocs.length === 0 && searchQuery.trim() === '' && !uploading}
				<!-- Empty state -->
				<div class="flex flex-col items-center justify-center h-full gap-2 px-4 py-8 text-center">
					<FileText size={24} class="text-muted-foreground/40" />
					<p class="text-xs text-muted-foreground">No documents yet</p>
					<p class="text-[10px] text-muted-foreground/60">Drag files here to upload</p>
				</div>
			{:else if filteredDocs.length === 0 && searchQuery.trim() !== ''}
				<!-- No search results -->
				<p class="px-3 py-4 text-xs text-muted-foreground">No documents match "{searchQuery}"</p>
			{:else}
				{#each filteredDocs as doc (doc.id)}
					{@const isDeleting = deletingId === doc.id}

					{#if isDeleting}
						<!-- Delete confirmation row -->
						<div class="mx-2 mb-0.5 flex items-center gap-1 px-2 py-1.5 rounded bg-destructive/10 text-xs">
							<span class="flex-1 text-destructive font-medium">Delete?</span>
							<button
								onclick={() => handleConfirmDelete(doc.id)}
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
						<!-- Normal document row -->
						<div class="group mx-2 mb-0.5 relative">
							<div
								class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors"
							>
								<FileText size={12} class="text-muted-foreground shrink-0" />
								<span class="flex-1 truncate text-foreground" title={doc.filename}>
									{doc.filename}
								</span>
								<span class="text-[10px] text-muted-foreground shrink-0">
									{formatDate(doc.created_at)}
								</span>
							</div>
							<!-- Trash icon, visible on hover -->
							<button
								onclick={() => (deletingId = doc.id)}
								class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all"
								aria-label="Delete document"
							>
								<Trash2 size={12} />
							</button>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
