<template>
  <v-app id="app">
    <h1>Piping Chunk</h1>
    <p>
      🛡 End-to-end encryption streaming file transfer via <a href="https://github.com/nwtgck/piping-server">Piping Server</a><br>
      <a href="https://github.com/nwtgck/piping-chunk-web">
        <v-icon>fab fa-github</v-icon> GitHub
      </a>
    </p>
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
