<template>
  <div>
    <input type="file" ref="inputFile"><br>
    <input type="text" v-model="serverUrl" placeholder="Server URL"><br>
    <input type="text" v-model="dataId" placeholder="Data ID"><br>
    <button v-on:click="send()">Send</button>
    <button v-on:click="get()">Get</button>
    <details>
      <summary>Advanced</summary>
      Simultaneous requests: <input type="number" v-model="nSimultaneousReqs"><br>
      Chunk byte size: <input type="number" v-model="chunkByteSize"><br>
    </details>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { createWriteStream } from 'streamsaver';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';


@Component
export default class PipingChunk extends Vue {
  private dataId: string = '';
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.ml';
  private nSimultaneousReqs: number = 2;
  private chunkByteSize: number = 65536; // NOTE: About 65KB

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
    pipingChunk.sendReadableStream(
      utils.createFileReadableStream(file, this.chunkByteSize),
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );
  }

  private get(): void {
    // Create get-readable-stream
    const readableStream = pipingChunk.getReadableStream(
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );
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
  padding: 0
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
