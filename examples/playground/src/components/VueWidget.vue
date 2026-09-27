<template>
  <div class="framework-card vue-card">
    <div class="framework-header">
      <span class="framework-badge vue-badge">Vue 3</span>
      <span class="status-indicator">Island</span>
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <div class="framework-meta">
      <span>File: <code>VueWidget.vue</code></span>
      <span>Directive: <code>client:visible</code></span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      default: 'Vue 3 Island'
    },
    description: {
      type: String,
      default: 'Authored in Single-File Component (SFC) syntax with Vue templates.'
    }
  }
}
</script>
