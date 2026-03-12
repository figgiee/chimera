<script lang="ts">
	import { toggleMode, mode } from 'mode-watcher';
	import { Sun, Moon } from 'lucide-svelte';
</script>

<button
	onclick={() => toggleMode()}
	aria-label="Toggle dark mode"
	class="rounded-lg p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
>
	{#if mode.current === 'dark'}
		<Sun size={18} />
	{:else}
		<Moon size={18} />
	{/if}
</button>
