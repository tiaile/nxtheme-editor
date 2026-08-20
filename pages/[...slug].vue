<script setup lang="ts">
// 兜底路由：任何未匹配路径都渲染首页。
// 单文件版以 file:// 双击打开时，浏览器会把本地文件路径（如 /D:/.../index.html）
// 当成初始路由，导致 afterEach 判定 matched 为空而显示 404。
import HomePage from "./index.vue"
</script>

<template>
  <HomePage />
</template>
