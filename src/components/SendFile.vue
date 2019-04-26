<template>
  <div>
    <file-pond
      ref="pond"
      label-idle="<img src='img/file-icon.svg' style='width: 2em'><br>Drop a file here or <span class='filepond--label-action'>Browse</span>"
      allow-multiple="false"
      maxFiles="1"
    />
    <v-text-field
      label="Server URL"
      v-model="serverUrl"
    />
    <v-text-field
      label="Data ID"
      v-model="dataId"
      placeholder="e.g. mydata"
    />
    <v-text-field
      label="Simultaneous requests"
      v-model="nSimultaneousReqs"
    />

    <v-text-field
      label="Chunk bytes"
      v-model="chunkByteSize"
    />
    <v-btn color="success" v-on:click="send()">Send</v-btn>
    <v-progress-linear
      v-show="progressSetting.show"
      :value="progressSetting.percentage"
    />
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';

import vueFilePond from 'vue-filepond';
import 'filepond/dist/filepond.min.css';

// Create component
const FilePond = vueFilePond();

@Component({
  components: {
    FilePond,
  },
})
export default class SendFile extends Vue {
  private dataId: string = '';
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.ml';
  private nSimultaneousReqs: number = 2;
  private chunkByteSize: number = 65536; // NOTE: About 65KB
  // Progress bar setting
  private progressSetting: {show: boolean, percentage: number} = {
    show: false,
    percentage: 0,
  };

  private async send() {
    // Get file in FilePond
    const pondFile: {file: File} | null = (this.$refs.pond as any).getFile();
    if (pondFile === null) {
      console.error('Error: No first file');
      return;
    }
    const file: File = pondFile.file;

    // Create ReadableStream from a file
    const fileReadableStream = utils.createFileReadableStream(file, this.chunkByteSize);

    // Get total size
    const totalSize: number = file.size;
    // Show progress bar
    this.progressSetting.show = true;
    // Set initial percentage
    this.progressSetting.percentage = 0;

    // Stream for progress bar
    const progressStream: ReadableStream<Uint8Array> =
      utils.getPregressReadableStream(fileReadableStream, (currentSize) => {
        this.progressSetting.percentage = (currentSize / totalSize) * 100;
      });

    // Send
    pipingChunk.sendReadableStream(
      progressStream,
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
