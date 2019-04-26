<template>
  <v-app id="app">
    <h1>Piping Chunk</h1>
    <PipingChunk />
  </v-app>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import PipingChunk from './components/PipingChunk.vue';

@Component({
  components: {
    PipingChunk: PipingChunk,
  },
})
export default class App extends Vue {}
</script>

<style>
#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  padding-top: 60px;
}
</style>
