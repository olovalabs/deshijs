<script>
  export let title = 'Svelte Island';
  export let count = 100;
</script>

<div class="framework-card svelte-card">
  <div class="framework-header">
    <span class="framework-badge svelte-badge">Svelte 5</span>
    <span class="status-indicator">Island</span>
  </div>
  <h3>{title}</h3>
  <p>Compiles into lean JavaScript without virtual DOM overhead, hydrated on idle.</p>
  <div class="framework-meta">
    <span>File: <code>SvelteWidget.svelte</code></span>
    <span>Count: <strong>{count}</strong></span>
  </div>
</div>
