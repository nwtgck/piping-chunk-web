<template>
  <div>
    <input type="file" ref="inputFile"><br>
    <input type="text" v-model="serverUrl" placeholder="Server URL"><br>
    <input type="text" v-model="dataId" placeholder="Data ID"><br>
    <button v-on:click="send()">Send</button>
    <button v-on:click="get()">Get</button>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { createWriteStream } from 'streamsaver';
import * as chunkPiping from '@/chunk-piping';
import * as utils from '@/utils';


@Component
export default class ChunkPiping extends Vue {
  private dataId: string = '';
  private serverUrl: string = 'http://localhost:8080';

  private async send() {
    const files: FileList | null = (this.$refs.inputFile as HTMLInputElement).files;
    if (files === null) {
      console.error('Error: No file list');
      return;
    }
    const file: File | null = files.item(0);
    if (file === null) {
      console.error('Error: No first file');
      return;
    }

    // Send
    chunkPiping.sendReadableStream(
      // TODO: Hard code: chunk size
      // NOTE: About 65KB
      utils.createFileReadableStream(file, 65536),
      // TODO: Hard code number
      2,
      this.serverUrl,
      this.dataId,
    );
  }

  private get(): void {
    // Create get-readable-stream
    // TODO: Hard code 2
    const readableStream = chunkPiping.getReadableStream(2,  this.serverUrl,  this.dataId);
    const filename = 'download';
    // Save as file streamingly
    readableStream.pipeTo(createWriteStream(filename));
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
